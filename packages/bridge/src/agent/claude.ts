import path from 'node:path';
import type {
  Options as SdkOptions,
  PermissionResult,
  query as sdkQuery,
} from '@anthropic-ai/claude-agent-sdk';
import { blocked, BLOCKED_PREFIX, type AgentContext, type AgentOutcome, type AgentRunner } from './types.js';

/* ── the seam ─────────────────────────────────────────────────────────────── */

/**
 * The slice of the SDK's message stream this runner reads.
 *
 * Deliberately narrow. `SDKMessage` is a union of thirty-odd frame types, and a
 * test that had to construct one faithfully would be asserting the SDK's shape
 * rather than the runner's behaviour. Everything below is structurally
 * satisfied by the real messages — `_QuerySeamHolds` is the compiler proving it.
 */
export interface AgentStreamMessage {
  type: string;
  session_id?: string;
  subtype?: string;
  result?: string;
  is_error?: boolean;
  errors?: string[];
  /**
   * `unknown`, not `{ content }`: some frames of the union carry a bare string
   * here. Narrowed where it is read, so a shape that was never anticipated is a
   * frame this runner ignores rather than a crash mid-job.
   */
  message?: unknown;
}

/**
 * `query`, as this runner needs it. Injected so the unit suite can drive a
 * scripted stream and assert the options object without a request leaving the
 * process (AC-6.6). The real function is imported lazily, inside `run`.
 */
export type SdkQuery = (params: {
  prompt: string;
  options?: SdkOptions;
}) => AsyncIterable<AgentStreamMessage>;

/** Fails to compile if the installed SDK's `query` stops fitting the seam. */
type Assert<_T extends SdkQuery> = true;
export type _QuerySeamHolds = Assert<typeof sdkQuery>;

/* ── the shape of the capability ──────────────────────────────────────────── */

export const CLAUDE_MODEL = 'claude-opus-5';

/**
 * The entire tool surface (AC-6.2).
 *
 * `Glob` and `Grep` are absent on purpose. Every element the editor touches
 * arrives with a `file:line:col` the build stamped into the source, so the
 * search step — where agent edits usually go wrong — does not exist here. An
 * agent that can search is an agent that can decide the coordinate was wrong
 * and go looking for a better one, and adding either tool back is a change to
 * the premise of this project rather than a convenience.
 */
export const CLAUDE_TOOLS = ['Read', 'Edit'] as const;

/** Read the file, write one line, say so. Anything longer is the agent lost. */
export const CLAUDE_MAX_TURNS = 12;

/** Tool names whose use means something was written. */
const WRITING_TOOLS = new Set(['Edit', 'MultiEdit', 'NotebookEdit', 'Write']);

/**
 * A credential the SDK can actually authenticate with. Checked here so that
 * `SVE_AGENT=claude` on a machine with no key fails by naming what is missing,
 * rather than with a stack trace out of the SDK's own transport (AC-6.1).
 */
export const CLAUDE_CREDENTIAL_ENV = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
] as const;

const SYSTEM_PROMPT = [
  'You are the writing half of a source-mapped visual editor.',
  '',
  'The element to change has already been located. Every request names the file, the',
  'line and the column that the build stamped into the source, and quotes the source',
  'around it as it is on disk right now.',
  '',
  'So: do not search. Do not look for a better place to make the change, do not open a',
  'file you were not given, and do not widen the edit to tidy anything up. Read the',
  'named file, apply the one described change with Edit, and stop.',
  '',
  'Reply `DONE` once the edit is written, or `BLOCKED: <reason>` if it cannot be made',
  'as described. Those are the only two replies that mean anything downstream.',
].join('\n');

/* ── reading the stream ───────────────────────────────────────────────────── */

interface ToolUse {
  name: string;
  input: Record<string, unknown>;
}

interface Spoken {
  texts: string[];
  toolUses: ToolUse[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Text and tool calls out of one assistant frame, whatever shape its content took. */
function read(message: AgentStreamMessage): Spoken {
  const spoken: Spoken = { texts: [], toolUses: [] };
  const content = isRecord(message.message) ? message.message['content'] : message.message;

  if (typeof content === 'string') {
    spoken.texts.push(content);
    return spoken;
  }
  if (!Array.isArray(content)) return spoken;

  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block['type'] === 'text' && typeof block['text'] === 'string') {
      spoken.texts.push(block['text']);
    } else if (block['type'] === 'tool_use' && typeof block['name'] === 'string') {
      spoken.toolUses.push({
        name: block['name'],
        input: isRecord(block['input']) ? block['input'] : {},
      });
    }
  }
  return spoken;
}

/** The path a tool call names, under any of the keys the built-in tools use. */
function pathOf(input: Record<string, unknown>): string | undefined {
  for (const key of ['file_path', 'path', 'notebook_path']) {
    const value = input[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

/**
 * The refusal, if the agent gave one.
 *
 * Anchored to the start of a line: the prompt asks for `BLOCKED: <reason>` and
 * nothing else, and an agent that merely *mentions* being blocked in prose has
 * not refused. Guessing a refusal out of prose would turn a successful edit into
 * a reported failure, which is the same lie as the reverse.
 */
const BLOCKED_LINE = /^\s*BLOCKED:[ \t]*(.+)$/m;

function refusalIn(replies: readonly string[]): string | null {
  for (const reply of [...replies].reverse()) {
    const found = BLOCKED_LINE.exec(reply);
    if (found) return found[1]!.trim();
  }
  return null;
}

/* ── the runner ───────────────────────────────────────────────────────────── */

export interface ClaudeAgentOptions {
  /** Injected by the unit suite; the real `query` is imported lazily otherwise. */
  query?: SdkQuery;
  model?: string;
  maxTurns?: number;
}

async function loadQuery(): Promise<SdkQuery> {
  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  return sdk.query;
}

/**
 * The live runner (AC-6): the Claude Agent SDK behind the seam M4 left.
 *
 * It hands over the prompt the bridge already built and the narrowest capability
 * that can carry it out, then maps what comes back onto an `AgentOutcome`. It
 * decides nothing else — not the job's status, not what landed. Whether the edit
 * was *right* is settled after hot reload by comparing the rendered DOM to the
 * recorded intent, and this runner is not consulted about it.
 */
export function createClaudeAgent(options: ClaudeAgentOptions = {}): AgentRunner {
  const model = options.model ?? CLAUDE_MODEL;
  const maxTurns = options.maxTurns ?? CLAUDE_MAX_TURNS;
  let query = options.query;

  return {
    name: 'claude',
    requiresNetwork: true,

    async run(ctx: AgentContext): Promise<AgentOutcome> {
      query ??= await loadQuery();

      // Read before and after: whether the file changed is a fact about the
      // file, not a claim in the transcript. An agent that says DONE and wrote
      // nothing must reach the bridge as `noop`, which it turns into `stalled`.
      const before = await ctx.fs.readFile(ctx.file);

      // The SDK wants a controller; the bridge hands out a signal. Closing the
      // bridge mid-run has to reach the subprocess, not be noticed afterwards.
      const controller = new AbortController();
      const relay = (): void => controller.abort();
      if (ctx.signal.aborted) controller.abort();
      else ctx.signal.addEventListener('abort', relay, { once: true });

      let sessionId: string | undefined;
      let denial: string | undefined;
      let failure: string | undefined;
      const replies: string[] = [];
      const written = new Set<string>();

      const sdkOptions: SdkOptions = {
        model,
        // Both, and for different reasons: `tools` is what decides which tools
        // exist at all, `allowedTools` is what decides which run without a
        // prompt. Either one alone leaves the surface wider than AC-6.2 allows.
        tools: [...CLAUDE_TOOLS],
        allowedTools: [...CLAUDE_TOOLS],
        permissionMode: 'default',
        // No `~/.claude/settings.json`, no project settings, no CLAUDE.md: a
        // permission rule sitting on a developer's machine must not be able to
        // widen what this runner may do.
        settingSources: [],
        systemPrompt: SYSTEM_PROMPT,
        cwd: ctx.root,
        maxTurns,
        abortController: controller,
        ...(ctx.retry?.sessionId ? { resume: ctx.retry.sessionId } : {}),

        async canUseTool(tool, input): Promise<PermissionResult> {
          const decision = await ctx.canUseTool({
            tool,
            ...(pathOf(input) !== undefined ? { path: pathOf(input)! } : {}),
            input,
          });
          // Remembered, because a denial is the reason the job ends up blocked:
          // the SDK tells the agent no and carries on, so by the time the stream
          // ends this is the only record of why nothing was written.
          if (decision.behavior === 'deny') denial = decision.message;
          return decision;
        },
      };

      ctx.report({
        phase: 'agent',
        detail: ctx.retry ? `claude — resuming ${ctx.retry.sessionId ?? 'previous session'}` : 'claude',
      });

      try {
        for await (const message of query({ prompt: ctx.prompt, options: sdkOptions })) {
          if (typeof message.session_id === 'string') sessionId = message.session_id;

          if (message.type === 'assistant') {
            const spoken = read(message);
            replies.push(...spoken.texts);
            for (const use of spoken.toolUses) {
              if (!WRITING_TOOLS.has(use.name)) continue;
              const target = pathOf(use.input);
              if (target !== undefined) {
                written.add(path.isAbsolute(target) ? target : path.resolve(ctx.root, target));
              }
              ctx.report({ phase: 'writing', tool: use.name, detail: ctx.intent.loc });
            }
            continue;
          }

          if (message.type === 'result') {
            if (typeof message.result === 'string') replies.push(message.result);
            if (message.subtype !== undefined && message.subtype !== 'success') {
              const detail = message.errors?.join('; ');
              failure = detail ? `${message.subtype}: ${detail}` : message.subtype;
            }
          }
        }
      } finally {
        ctx.signal.removeEventListener('abort', relay);
      }

      const after = await ctx.fs.readFile(ctx.file);
      const changed = Buffer.compare(before, after) !== 0;

      if (changed) {
        // Reported even when the agent then said BLOCKED. The file on disk
        // disagrees with that reply, and telling the user nothing was written
        // while something was is the one answer that is certainly wrong.
        // Whether it was the *right* change is the verifier's question.
        const files = written.size > 0 ? [...written] : [ctx.file];
        return {
          kind: 'edited',
          files,
          ...(replies.length > 0 ? { message: replies[replies.length - 1] } : {}),
          ...(sessionId ? { sessionId } : {}),
        };
      }

      if (denial !== undefined) return blocked(denial, sessionId);

      const refusal = refusalIn(replies);
      if (refusal !== null) return blocked(refusal, sessionId);

      if (failure !== undefined) {
        return blocked(`the agent stopped before writing anything (${failure})`, sessionId);
      }

      return {
        kind: 'noop',
        message: replies[replies.length - 1] ?? 'the agent finished without writing anything',
        ...(sessionId ? { sessionId } : {}),
      };
    },
  };
}

/* ── selection ────────────────────────────────────────────────────────────── */

export interface ClaudeCredentials {
  readonly ok: boolean;
  readonly missing: string;
}

export function claudeCredentials(env: Readonly<Record<string, string | undefined>>): ClaudeCredentials {
  const ok = CLAUDE_CREDENTIAL_ENV.some((name) => (env[name] ?? '').trim().length > 0);
  return { ok, missing: CLAUDE_CREDENTIAL_ENV.join(' or ') };
}

/**
 * The message a developer gets for `SVE_AGENT=claude` with nothing to
 * authenticate with (AC-6.1). It names the credential, because "401" out of the
 * SDK's transport names nothing a person can act on.
 */
export function missingCredentialMessage(): string {
  return (
    'SVE_AGENT=claude needs a credential, and none is set. Export ' +
    `${CLAUDE_CREDENTIAL_ENV[0]} (or ${CLAUDE_CREDENTIAL_ENV.slice(1).join(', ')}), ` +
    'or run with SVE_AGENT=fake, which needs none.'
  );
}
