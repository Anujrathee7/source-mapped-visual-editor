import path from 'node:path';
import { isPathNotPermitted } from '../guarded-fs.js';
import { refusalIn, systemPromptWith, WRITING_TOOLS } from './shared.js';
import { blocked, type AgentContext, type AgentEnv, type AgentOutcome, type AgentRunner } from './types.js';

/**
 * The runner for anything speaking OpenAI's chat-completions API (AC-10.3).
 *
 * DeepSeek, Ollama, OpenRouter, LM Studio and Groq are the same protocol behind
 * three settings — base URL, key, model — so this is one runner configured three
 * ways rather than five runners sharing a copied tool loop.
 *
 * These are the cheap models, and cheap models are the point. A weak model that
 * miswrites an edit is normally unusable, because telling a good edit from a bad
 * one means reading every diff. Here the overlay lifts its override after hot
 * reload and compares the rendered result to the recorded intent, so a miswrite
 * is caught, shown and retried. That turns a weak model from a gamble into a
 * trade — which is why most of this file is about surviving bad output rather
 * than about the happy path.
 */

/* ── the wire ─────────────────────────────────────────────────────────────── */

export const OPENAI_CHAT_PATH = '/chat/completions';

/**
 * The HTTP surface this runner needs, as one injectable function (AC-10.7).
 *
 * Narrower than `fetch` on purpose: a scripted client in a test is four lines,
 * and `globalThis.fetch` satisfies it structurally, so the unit suite never has
 * to stub a `Response`. Nothing in this package calls `fetch` at a call site.
 */
export interface HttpResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export interface HttpRequest {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}

export type HttpClient = (url: string, init: HttpRequest) => Promise<HttpResponse>;

/* ── the shape of the capability ──────────────────────────────────────────── */

/**
 * The entire tool surface, and it is this runner's own design.
 *
 * `read_file` and `apply_edit`, and nothing that could search. Every element the
 * editor touches arrives with a `file:line:col` the build stamped into the
 * source, so the search step — where agent edits usually go wrong — does not
 * exist here. A model that can list or grep is a model that can decide the
 * stamped coordinate was wrong and go looking for a better one.
 */
export const OPENAI_TOOLS = ['read_file', 'apply_edit'] as const;

/**
 * Read the file, write one line, say so.
 *
 * A bound rather than a hope: small models loop. Reaching it is a reported
 * outcome (AC-10.6), never a hang, and it is counted in requests so a model
 * that answers with the same tool call forever costs a fixed number of them.
 */
export const OPENAI_MAX_TURNS = 12;

/** The settings that make this runner one vendor rather than another. */
export const OPENAI_ENV = {
  baseUrl: 'SVE_OPENAI_BASE_URL',
  apiKey: 'SVE_OPENAI_API_KEY',
  model: 'SVE_OPENAI_MODEL',
} as const;

const SYSTEM_PROMPT = systemPromptWith(
  [
    'You have exactly two tools: `read_file`, which takes a `path`, and `apply_edit`,',
    'which takes a `path`, the exact `old_text` to replace and the `new_text` to put in',
    'its place. There is no other tool, and inventing one does nothing.',
    '',
    'Call them as tool calls. A tool call written out as JSON in your reply is prose,',
    'and prose is not executed. `old_text` must appear in the file exactly once, so',
    'include enough surrounding characters to make it unique, and copy it byte for byte',
    'from what `read_file` returned.',
  ].join('\n'),
);

const TOOL_SCHEMA = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Return the current contents of the file named in the request.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'The file named in the request.' },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'apply_edit',
      description:
        'Replace one exact run of text in the file with another. The old text must ' +
        'occur exactly once. Nothing else in the file changes.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'The file named in the request.' },
          old_text: { type: 'string', description: 'Text to replace, occurring exactly once.' },
          new_text: { type: 'string', description: 'What to put in its place.' },
        },
        required: ['path', 'old_text', 'new_text'],
        additionalProperties: false,
      },
    },
  },
];

/* ── configuration ────────────────────────────────────────────────────────── */

export interface OpenAiSettings {
  readonly baseUrl: string;
  readonly model: string;
  /** Absent, not empty, when the endpoint needs none (AC-10.9). */
  readonly apiKey?: string;
}

export type OpenAiSettingsResult =
  | { readonly ok: true; readonly settings: OpenAiSettings }
  | { readonly ok: false; readonly message: string };

/**
 * Hosts that are the developer's own machine, where there is nothing to
 * authenticate against and no key to invent (AC-10.9).
 *
 * Matched on the parsed hostname rather than on the string, so
 * `https://localhost.evil.example/v1` is the remote endpoint it actually is.
 */
const LOCAL_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
  '0.0.0.0',
  'host.docker.internal',
]);

export function isLocalEndpoint(baseUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return LOCAL_HOSTS.has(host) || host.endsWith('.localhost') || host.endsWith('.local');
}

function trimmed(value: string | undefined): string {
  return (value ?? '').trim();
}

/**
 * The settings, or the sentence naming what is missing (AC-10.9).
 *
 * Resolved before anything is constructed, so selecting a provider with nothing
 * to authenticate with fails by naming the variable rather than as a 401
 * surfacing from inside an HTTP client three layers down, four seconds into the
 * first edit a user tried to make.
 */
export function openAiSettings(env: AgentEnv): OpenAiSettingsResult {
  const baseUrl = trimmed(env[OPENAI_ENV.baseUrl]);
  if (baseUrl === '') {
    return {
      ok: false,
      message:
        `SVE_AGENT=openai needs an endpoint, and none is set. Export ${OPENAI_ENV.baseUrl} — ` +
        'for example https://api.deepseek.com/v1, https://openrouter.ai/api/v1, or ' +
        'http://localhost:11434/v1 for Ollama.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return {
      ok: false,
      message: `${OPENAI_ENV.baseUrl} is not a URL: ${baseUrl}`,
    };
  }

  const model = trimmed(env[OPENAI_ENV.model]);
  if (model === '') {
    return {
      ok: false,
      message:
        `SVE_AGENT=openai needs a model name, and none is set. Export ${OPENAI_ENV.model} — ` +
        'whatever the endpoint calls it, such as deepseek-chat or qwen2.5-coder.',
    };
  }

  const apiKey = trimmed(env[OPENAI_ENV.apiKey]);
  if (apiKey === '' && !isLocalEndpoint(baseUrl)) {
    return {
      ok: false,
      message:
        `SVE_AGENT=openai needs a credential for ${parsed.host}, and none is set. Export ` +
        `${OPENAI_ENV.apiKey}, or point ${OPENAI_ENV.baseUrl} at a local endpoint such as ` +
        'http://localhost:11434/v1, which needs none.',
    };
  }

  // Absent rather than empty: a local endpoint is not made to carry a blank
  // Authorization header, and nothing downstream has to know the difference.
  return {
    ok: true,
    settings: { baseUrl, model, ...(apiKey === '' ? {} : { apiKey }) },
  };
}

export function missingOpenAiSettingMessage(env: AgentEnv): string | null {
  const resolved = openAiSettings(env);
  return resolved.ok ? null : resolved.message;
}

/* ── reading what came back ───────────────────────────────────────────────── */

interface ChatToolCall {
  id: string;
  name: string;
  /** Raw. Whether it is JSON at all is one of the things this runner survives. */
  arguments: string;
}

interface ChatReply {
  content: string;
  toolCalls: ChatToolCall[];
}

interface WireMessage {
  role: string;
  content?: string | null;
  tool_calls?: unknown;
  tool_call_id?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * The assistant turn out of a response body, however loosely it was shaped.
 *
 * Everything is narrowed rather than asserted. A local model behind a proxy can
 * return a body missing `choices`, a `content` that is an array of parts, or a
 * `tool_calls` entry with no `function` — and every one of those has to be a
 * turn this runner reports on, not an exception thrown out of a property access.
 */
function readReply(body: unknown): ChatReply | null {
  if (!isRecord(body)) return null;
  const choices = body['choices'];
  if (!Array.isArray(choices) || choices.length === 0) return null;

  const first = choices[0];
  const message = isRecord(first) ? first['message'] : undefined;
  if (!isRecord(message)) return null;

  const reply: ChatReply = { content: '', toolCalls: [] };

  const content = message['content'];
  if (typeof content === 'string') {
    reply.content = content;
  } else if (Array.isArray(content)) {
    // Some gateways hand back Anthropic-style content parts.
    reply.content = content
      .map((part) => (isRecord(part) && typeof part['text'] === 'string' ? part['text'] : ''))
      .join('');
  }

  const calls = message['tool_calls'];
  if (Array.isArray(calls)) {
    for (const [index, call] of calls.entries()) {
      if (!isRecord(call)) continue;
      const fn = call['function'];
      if (!isRecord(fn) || typeof fn['name'] !== 'string') continue;
      reply.toolCalls.push({
        id: typeof call['id'] === 'string' ? call['id'] : `call_${index}`,
        name: fn['name'],
        arguments: typeof fn['arguments'] === 'string' ? fn['arguments'] : '',
      });
    }
  }

  return reply;
}

/** A parsed record, or the reason it is not one. Strict on purpose — see AC-10.6. */
function readArguments(raw: string): { ok: true; value: Record<string, unknown> } | { ok: false; why: string } {
  const text = raw.trim();
  if (text === '') return { ok: true, value: {} };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    // Not repaired, and not scraped out of a fence. A runner that dug JSON out
    // of whatever a model wrapped it in would be guessing at an edit, and a
    // guessed edit lands somewhere nobody asked for. Told plainly instead, the
    // model gets a turn to emit it properly.
    return {
      ok: false,
      why: `the arguments were not valid JSON (${(error as Error).message})`,
    };
  }

  if (!isRecord(parsed) || Array.isArray(parsed)) {
    return { ok: false, why: 'the arguments were not a JSON object' };
  }
  return { ok: true, value: parsed };
}

function requiredString(input: Record<string, unknown>, key: string): string | null {
  const value = input[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function occurrences(haystack: string, needle: string): number {
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    count += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* ── the runner ───────────────────────────────────────────────────────────── */

export interface OpenAiAgentOptions extends OpenAiSettings {
  /** Injected by the unit suite; `globalThis.fetch` otherwise (AC-10.7). */
  http?: HttpClient;
  maxTurns?: number;
}

function defaultHttp(): HttpClient {
  const global = (globalThis as { fetch?: typeof fetch }).fetch;
  if (typeof global !== 'function') {
    throw new Error('no global fetch is available; pass an http client to createOpenAiAgent');
  }
  return (url, init) => global(url, init);
}

export function createOpenAiAgent(options: OpenAiAgentOptions): AgentRunner {
  const endpoint = options.baseUrl.replace(/\/+$/, '') + OPENAI_CHAT_PATH;
  const maxTurns = options.maxTurns ?? OPENAI_MAX_TURNS;

  return {
    name: 'openai',
    requiresNetwork: true,

    async run(ctx: AgentContext): Promise<AgentOutcome> {
      const http = options.http ?? defaultHttp();

      // Read before and after: whether the file changed is a fact about the
      // file, not a claim in a transcript. A model that says DONE and wrote
      // nothing reaches the bridge as `noop`, which it turns into `stalled`.
      const before = await ctx.fs.readFile(ctx.file);

      const messages: WireMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: ctx.prompt },
      ];

      const replies: string[] = [];
      const written = new Set<string>();
      /** The last thing the model got wrong. Reported if nothing was written. */
      let fault: string | undefined;
      let failure: string | undefined;
      let denial: string | undefined;
      let exhausted = true;

      ctx.report({ phase: 'agent', detail: ctx.retry ? 'openai — retrying' : 'openai' });

      /** Resolves an argument path the way the prompt spelled it: against the root. */
      const resolve = (target: string): string =>
        path.isAbsolute(target) ? path.resolve(target) : path.resolve(ctx.root, target);

      turns: for (let turn = 0; turn < maxTurns; turn += 1) {
        let raw: string;
        try {
          const response = await http(endpoint, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              // Only when there is one. A local endpoint is not made to invent
              // a credential it has no use for (AC-10.9).
              ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
            },
            body: JSON.stringify({
              model: options.model,
              messages,
              tools: TOOL_SCHEMA,
              tool_choice: 'auto',
              // The edit is described exactly; there is nothing here to be
              // creative about, and determinism makes a drift reproducible.
              temperature: 0,
              stream: false,
            }),
            signal: ctx.signal,
          });
          raw = await response.text();
          if (!response.ok) {
            failure = `the endpoint answered ${response.status}: ${raw.slice(0, 400)}`;
            exhausted = false;
            break;
          }
        } catch (error) {
          failure = `the request to ${endpoint} failed: ${describe(error)}`;
          exhausted = false;
          break;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          failure = `the endpoint answered with something that is not JSON: ${raw.slice(0, 200)}`;
          exhausted = false;
          break;
        }

        const reply = readReply(parsed);
        if (reply === null) {
          failure = 'the endpoint answered with no assistant message in it';
          exhausted = false;
          break;
        }

        if (reply.content !== '') replies.push(reply.content);

        if (reply.toolCalls.length === 0) {
          // The model's turn is over and it asked for nothing. Whether that is
          // a refusal, a DONE, or a fenced tool call it only described, is
          // settled below against the file rather than guessed at here.
          exhausted = false;
          break;
        }

        messages.push({
          role: 'assistant',
          content: reply.content === '' ? null : reply.content,
          tool_calls: reply.toolCalls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: call.arguments },
          })),
        });

        for (const call of reply.toolCalls) {
          const answer = async (text: string): Promise<void> => {
            messages.push({ role: 'tool', tool_call_id: call.id, content: text });
          };

          if (!(OPENAI_TOOLS as readonly string[]).includes(call.name)) {
            // Not executed, under any name it invented. A tool that does not
            // exist is told so, and the model gets its turn back.
            fault = `the model called a tool that does not exist: ${call.name}`;
            await answer(
              `error: there is no tool called ${call.name}. The only tools are ` +
                `${OPENAI_TOOLS.join(' and ')}.`,
            );
            continue;
          }

          const args = readArguments(call.arguments);
          if (!args.ok) {
            fault = `${call.name}: ${args.why}`;
            await answer(`error: ${args.why}. Send the arguments as a JSON object and nothing else.`);
            continue;
          }

          const target = requiredString(args.value, 'path');
          if (target === null) {
            fault = `${call.name}: the call named no path`;
            await answer('error: the call is missing its required `path`.');
            continue;
          }
          const absolute = resolve(target);

          const permission = await ctx.canUseTool({
            tool: call.name,
            path: absolute,
            input: args.value,
          });
          if (permission.behavior === 'deny') {
            // A denial is an answer, not a hint to try somewhere else. The run
            // stops here and reports it (AC-10.4).
            denial = permission.message;
            break turns;
          }

          let current: string;
          try {
            current = (await ctx.fs.readFile(absolute)).toString('utf8');
          } catch (error) {
            if (isPathNotPermitted(error)) {
              // The guarded fs refused, whatever the courtesy call said. This
              // is the boundary; it is not something to retry around.
              denial = error.message;
              break turns;
            }
            fault = `${call.name}: ${describe(error)}`;
            await answer(`error: ${describe(error)}`);
            continue;
          }

          if (call.name === 'read_file') {
            await answer(current);
            continue;
          }

          const oldText = requiredString(args.value, 'old_text');
          const newText = typeof args.value['new_text'] === 'string' ? args.value['new_text'] : null;
          if (oldText === null || newText === null) {
            fault = 'apply_edit: the call is missing `old_text` or `new_text`';
            await answer('error: apply_edit needs both `old_text` and `new_text` as strings.');
            continue;
          }

          const found = occurrences(current, oldText);
          if (found === 0) {
            fault = 'apply_edit: `old_text` does not occur in the file';
            await answer(
              'error: that text is not in the file. Call read_file and copy it byte for byte.',
            );
            continue;
          }
          if (found > 1) {
            // Replacing the first of several is how an edit lands in the wrong
            // element — the exact failure this project exists to remove.
            fault = `apply_edit: \`old_text\` occurs ${found} times, so which one is meant is unknown`;
            await answer(
              `error: that text occurs ${found} times. Include enough surrounding ` +
                'characters to make it unique.',
            );
            continue;
          }

          const next = current.replace(oldText, newText);
          try {
            await ctx.fs.writeFile(absolute, Buffer.from(next, 'utf8'));
          } catch (error) {
            if (isPathNotPermitted(error)) {
              denial = error.message;
              break turns;
            }
            fault = `apply_edit: ${describe(error)}`;
            await answer(`error: ${describe(error)}`);
            continue;
          }

          if (WRITING_TOOLS.has(call.name)) written.add(absolute);
          ctx.report({ phase: 'writing', tool: call.name, detail: ctx.intent.loc });
          await answer('ok: the edit was applied. Reply DONE.');
        }
      }

      const after = await ctx.fs.readFile(ctx.file);

      if (Buffer.compare(before, after) !== 0) {
        // Reported even when the model then said BLOCKED, or went on to emit
        // nonsense. The file on disk disagrees, and telling the user nothing
        // was written while something was is the one certainly-wrong answer.
        // Whether it was the *right* change is the verifier's question.
        return {
          kind: 'edited',
          files: written.size > 0 ? [...written] : [ctx.file],
          ...(replies.length > 0 ? { message: replies[replies.length - 1] } : {}),
        };
      }

      if (denial !== undefined) return blocked(denial);

      const refusal = refusalIn(replies);
      if (refusal !== null) return blocked(refusal);

      if (failure !== undefined) return blocked(failure);

      if (exhausted) {
        return blocked(
          `the model ran on past ${maxTurns} turns without writing anything` +
            (fault ? ` (last fault: ${fault})` : ''),
        );
      }

      if (fault !== undefined) {
        return blocked(`the model produced output this runner could not act on — ${fault}`);
      }

      return {
        kind: 'noop',
        message: replies[replies.length - 1] ?? 'the model finished without writing anything',
      };
    },
  };
}
