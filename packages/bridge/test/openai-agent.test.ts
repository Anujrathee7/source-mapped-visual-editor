import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { agentRunnerNames, resolveAgentRunner } from '../src/agent/index.js';
import {
  createOpenAiAgent,
  isLocalEndpoint,
  openAiSettings,
  OPENAI_CHAT_PATH,
  OPENAI_ENV,
  OPENAI_MAX_TURNS,
  OPENAI_TOOLS,
  type HttpClient,
  type HttpResponse,
} from '../src/agent/openai.js';
import type { AgentContext, AgentOutcome } from '../src/agent/types.js';
import { createBridge } from '../src/bridge.js';
import { nodeFs } from '../src/fs.js';
import { guardFs } from '../src/guarded-fs.js';
import { permitPath } from '../src/guard.js';
import {
  cleanupTempDirs,
  HERO_H1_COL,
  HERO_H1_LINE,
  HERO_SOURCE,
  makeAgentContext,
  makeIntent,
  makeProject,
  makeTempDir,
} from './helpers.js';

afterAll(cleanupTempDirs);

/**
 * AC-10.3 to AC-10.9 — one runner for every OpenAI-compatible endpoint.
 *
 * DeepSeek, Ollama, OpenRouter, LM Studio and Groq differ by base URL, key and
 * model name and by nothing else that matters here, so there is one runner
 * configured three ways rather than five runners.
 *
 * Every test in this file injects the HTTP client (AC-10.7). Nothing here opens
 * a socket, reads a key or needs a model running locally; a test in this file
 * that would reach a real endpoint is a bug in the test. The live suite is
 * `openai-live.test.ts`, and it is skipped unless asked for.
 */

/* ── the scripted endpoint ────────────────────────────────────────────────── */

interface ChatMessage {
  role: string;
  content?: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

interface ChatBody {
  model: string;
  messages: ChatMessage[];
  tools?: { type: string; function: { name: string; parameters?: unknown } }[];
  tool_choice?: unknown;
}

interface ChatCall {
  url: string;
  headers: Record<string, string>;
  body: ChatBody;
}

interface ToolCall {
  name: string;
  /** Deliberately a raw string: half of AC-10.6 is what happens when it is not JSON. */
  arguments: string;
}

interface Turn {
  content?: string | null;
  toolCalls?: ToolCall[];
  /** A raw body, for the cases where the endpoint does not answer with JSON at all. */
  raw?: string;
  status?: number;
}

type Script = (call: ChatCall, turn: number) => Turn;

interface HttpSpy {
  http: HttpClient;
  calls: ChatCall[];
  last(): ChatCall;
}

function httpSpy(script: Script): HttpSpy {
  const calls: ChatCall[] = [];

  const http: HttpClient = async (url, init) => {
    const call: ChatCall = {
      url,
      headers: init.headers,
      body: JSON.parse(init.body) as ChatBody,
    };
    calls.push(call);
    const turn = script(call, calls.length - 1);

    const body =
      turn.raw ??
      JSON.stringify({
        id: `chatcmpl-${calls.length}`,
        choices: [
          {
            index: 0,
            finish_reason: turn.toolCalls ? 'tool_calls' : 'stop',
            message: {
              role: 'assistant',
              content: turn.content ?? null,
              ...(turn.toolCalls
                ? {
                    tool_calls: turn.toolCalls.map((tool, index) => ({
                      id: `call_${index}`,
                      type: 'function',
                      function: { name: tool.name, arguments: tool.arguments },
                    })),
                  }
                : {}),
            },
          },
        ],
      });

    const status = turn.status ?? 200;
    const response: HttpResponse = {
      ok: status >= 200 && status < 300,
      status,
      async text() {
        return body;
      },
    };
    return response;
  };

  return { http, calls, last: () => calls[calls.length - 1]! };
}

/** The one edit the fixture wants: `Swim today` becomes `Ship faster`. */
const THE_EDIT: ToolCall = {
  name: 'apply_edit',
  arguments: JSON.stringify({
    path: 'src/Hero.tsx',
    old_text: 'Swim today',
    new_text: 'Ship faster',
  }),
};

const DEEPSEEK = {
  [OPENAI_ENV.baseUrl]: 'https://api.deepseek.com/v1',
  [OPENAI_ENV.apiKey]: 'sk-deepseek-test',
  [OPENAI_ENV.model]: 'deepseek-chat',
};

function agent(options: { http: HttpClient; maxTurns?: number; apiKey?: string; baseUrl?: string }) {
  return createOpenAiAgent({
    baseUrl: options.baseUrl ?? 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : { apiKey: 'sk-test' }),
    http: options.http,
    ...(options.maxTurns !== undefined ? { maxTurns: options.maxTurns } : {}),
  });
}

/* ── AC-10.3 — one runner, configured ─────────────────────────────────────── */

describe('AC-10.3 registration', () => {
  it('registers under `openai`', () => {
    expect(agentRunnerNames()).toContain('openai');
  });

  it('is selected by SVE_AGENT and knows it needs the network', () => {
    const runner = resolveAgentRunner({ SVE_AGENT: 'openai', ...DEEPSEEK });

    expect(runner.name).toBe('openai');
    expect(runner.requiresNetwork).toBe(true);
  });

  it('is one runner for every vendor, not one per vendor', async () => {
    const seen: string[] = [];

    for (const baseUrl of [
      'https://api.deepseek.com/v1',
      'http://localhost:11434/v1',
      'https://openrouter.ai/api/v1',
      'https://api.groq.com/openai/v1',
    ]) {
      const { root, file } = makeProject();
      const { ctx } = makeAgentContext({ root, file });
      const spy = httpSpy(() => ({ content: 'DONE' }));

      const runner = createOpenAiAgent({ baseUrl, model: 'a-model', apiKey: 'k', http: spy.http });
      await runner.run(ctx);

      expect(runner.name).toBe('openai');
      seen.push(spy.last().url);
    }

    // Base URL, key and model are the whole of the difference between them.
    expect(seen).toEqual([
      `https://api.deepseek.com/v1${OPENAI_CHAT_PATH}`,
      `http://localhost:11434/v1${OPENAI_CHAT_PATH}`,
      `https://openrouter.ai/api/v1${OPENAI_CHAT_PATH}`,
      `https://api.groq.com/openai/v1${OPENAI_CHAT_PATH}`,
    ]);
  });

  it('tolerates a base URL written with a trailing slash', async () => {
    const { root, file } = makeProject();
    const { ctx } = makeAgentContext({ root, file });
    const spy = httpSpy(() => ({ content: 'DONE' }));

    await createOpenAiAgent({
      baseUrl: 'https://api.deepseek.com/v1/',
      model: 'deepseek-chat',
      apiKey: 'k',
      http: spy.http,
    }).run(ctx);

    expect(spy.last().url).toBe(`https://api.deepseek.com/v1${OPENAI_CHAT_PATH}`);
  });
});

describe('AC-10.3 the request', () => {
  async function once(): Promise<HttpSpy & { ctx: AgentContext }> {
    const { root, file } = makeProject();
    const { ctx } = makeAgentContext({ root, file });
    const spy = httpSpy(() => ({ content: 'DONE' }));
    await agent({ http: spy.http }).run(ctx);
    return { ...spy, ctx };
  }

  it('names the configured model', async () => {
    const spy = await once();

    expect(spy.last().body.model).toBe('deepseek-chat');
  });

  it('sends the key as a bearer token', async () => {
    const spy = await once();
    const headers = Object.fromEntries(
      Object.entries(spy.last().headers).map(([key, value]) => [key.toLowerCase(), value]),
    );

    expect(headers['authorization']).toBe('Bearer sk-test');
    expect(headers['content-type']).toContain('application/json');
  });

  it('declares exactly two tools of its own design', async () => {
    const spy = await once();
    const names = (spy.last().body.tools ?? []).map((tool) => tool.function.name);

    expect(names).toEqual(['read_file', 'apply_edit']);
    expect(OPENAI_TOOLS).toEqual(['read_file', 'apply_edit']);
  });

  it('grants nothing that could search, because the coordinate is already known', async () => {
    const spy = await once();
    const serialised = JSON.stringify(spy.last().body.tools);

    for (const forbidden of ['glob', 'grep', 'search', 'find_', 'bash', 'shell', 'list_files']) {
      expect(serialised.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('hands over the prompt the bridge built, unchanged, as the user turn', async () => {
    const spy = await once();
    const messages = spy.last().body.messages;

    expect(messages[0]?.role).toBe('system');
    expect(messages[1]).toEqual({ role: 'user', content: spy.ctx.prompt });
  });

  it('holds the model to the shared reply contract, and names its own tools', async () => {
    const spy = await once();
    const system = spy.last().body.messages[0]?.content ?? '';

    expect(system).toContain('BLOCKED:');
    expect(system).toContain('do not search');
    expect(system).toContain('read_file');
    expect(system).toContain('apply_edit');
  });
});

describe('AC-10.3 the tool loop', () => {
  it('reads the file when asked, and feeds the contents back as a tool result', async () => {
    const { root, file } = makeProject();
    const { ctx } = makeAgentContext({ root, file });
    const spy = httpSpy((_call, turn) =>
      turn === 0
        ? { toolCalls: [{ name: 'read_file', arguments: JSON.stringify({ path: 'src/Hero.tsx' }) }] }
        : { content: 'DONE' },
    );

    await agent({ http: spy.http }).run(ctx);

    const followUp = spy.calls[1]!.body.messages;
    const toolResult = followUp.find((message) => message.role === 'tool');
    expect(toolResult?.content).toContain('Swim today');
    // The assistant turn that asked has to be replayed too, or the endpoint
    // rejects a tool result that answers nothing.
    expect(followUp.some((message) => message.tool_calls !== undefined)).toBe(true);
    expect(readFileSync(file)).toEqual(HERO_SOURCE);
  });

  it('applies the edit and reports it, with the file as the evidence', async () => {
    const { root, file } = makeProject();
    const { ctx, progress } = makeAgentContext({ root, file });
    const spy = httpSpy((_call, turn) =>
      turn === 0 ? { toolCalls: [THE_EDIT] } : { content: 'DONE' },
    );

    const outcome = await agent({ http: spy.http }).run(ctx);

    expect(outcome).toMatchObject({ kind: 'edited', files: [file] });
    expect(readFileSync(file).toString('utf8')).toContain('Ship faster');
    expect(progress.some((update) => update.phase === 'writing')).toBe(true);
  });

  it('preserves CRLF terminators and non-ASCII bytes it never touched', async () => {
    const { root, file } = makeProject();
    const { ctx } = makeAgentContext({ root, file });
    const spy = httpSpy((_call, turn) =>
      turn === 0 ? { toolCalls: [THE_EDIT] } : { content: 'DONE' },
    );

    await agent({ http: spy.http }).run(ctx);
    const after = readFileSync(file).toString('utf8');

    expect(after).toContain('Café-cold water, warm code.');
    expect(after.split('\r\n').length).toBe(HERO_SOURCE.toString('utf8').split('\r\n').length);
  });

  it('reports a refusal read off the shared BLOCKED parser', async () => {
    const { root, file } = makeProject();
    const { ctx } = makeAgentContext({ root, file });
    const spy = httpSpy(() => ({ content: 'BLOCKED: the element renders an expression' }));

    const outcome = await agent({ http: spy.http }).run(ctx);

    expect(outcome).toMatchObject({
      kind: 'blocked',
      reason: 'the element renders an expression',
      message: 'BLOCKED: the element renders an expression',
    });
    expect(readFileSync(file)).toEqual(HERO_SOURCE);
  });

  it('reports noop when the model says DONE and wrote nothing', async () => {
    const { root, file } = makeProject();
    const { ctx } = makeAgentContext({ root, file });
    const spy = httpSpy(() => ({ content: 'DONE' }));

    const outcome = await agent({ http: spy.http }).run(ctx);

    expect(outcome.kind).toBe('noop');
    expect(readFileSync(file)).toEqual(HERO_SOURCE);
  });
});

/* ── AC-10.4 — it asks first, and is bound regardless ─────────────────────── */

describe('AC-10.4 the courtesy call', () => {
  it('asks canUseTool before every write, naming the path', async () => {
    const { root, file } = makeProject();
    const { ctx, requests } = makeAgentContext({ root, file });
    const spy = httpSpy((_call, turn) =>
      turn === 0 ? { toolCalls: [THE_EDIT] } : { content: 'DONE' },
    );

    await agent({ http: spy.http }).run(ctx);

    const write = requests.find((request) => request.tool === 'apply_edit');
    expect(write).toBeDefined();
    expect(write?.path).toBe(file);
  });

  it('honours a denial by reporting blocked rather than trying elsewhere', async () => {
    const { root, file } = makeProject();
    const { ctx, requests } = makeAgentContext({
      root,
      file,
      canUseTool: async () => ({ behavior: 'deny', message: 'the guard said no' }),
    });
    const spy = httpSpy(() => ({ toolCalls: [THE_EDIT] }));

    const outcome = await agent({ http: spy.http }).run(ctx);

    expect(outcome).toMatchObject({ kind: 'blocked', reason: 'the guard said no' });
    expect(readFileSync(file)).toEqual(HERO_SOURCE);
    // It stopped. A runner that answered a denial by asking for a second path
    // would have kept the loop going.
    expect(spy.calls).toHaveLength(1);
    expect(requests).toHaveLength(1);
  });

  it('reports blocked for a path the bridge guard denies, without throwing', async () => {
    const { root, file } = makeProject();
    const outside = path.join(makeTempDir('sve-outside-'), 'Secret.tsx');
    writeFileSync(outside, 'export const secret = 1;\n');
    const { ctx } = makeAgentContext({
      root,
      file,
      canUseTool: (request) => permitPath(request.path, { root, editRoots: [root] }),
    });
    const spy = httpSpy(() => ({
      toolCalls: [
        {
          name: 'apply_edit',
          arguments: JSON.stringify({ path: outside, old_text: 'secret', new_text: 'stolen' }),
        },
      ],
    }));

    const outcome = await agent({ http: spy.http }).run(ctx);

    expect(outcome.kind).toBe('blocked');
    expect(outcome.kind === 'blocked' && outcome.message).toContain(
      'outside the configured editRoots',
    );
    expect(readFileSync(outside).toString('utf8')).toContain('secret');
  });
});

/**
 * The half that matters. `canUseTool` is a courtesy — a runner that forgets to
 * call it is a bug, and with several runners shipping, one of them eventually
 * will. The guarded `fs` from AC-7 is what actually binds, so it is asserted
 * here against a runner whose courtesy call has been defanged to always allow.
 */
describe('AC-10.4 the binding guard', () => {
  /** A context whose permission callback says yes to everything, deliberately. */
  function permissive(root: string, file: string) {
    return makeAgentContext({
      root,
      file,
      fs: guardFs(nodeFs, [root]),
      canUseTool: async () => ({ behavior: 'allow' }),
    });
  }

  it('refuses a write outside editRoots even when the courtesy call allows it', async () => {
    const { root, file } = makeProject();
    const outsideDir = makeTempDir('sve-outside-');
    const outside = path.join(outsideDir, 'Secret.tsx');
    const before = 'export const secret = 1;\n';
    writeFileSync(outside, before);

    const { ctx, requests } = permissive(root, file);
    const spy = httpSpy(() => ({
      toolCalls: [
        {
          name: 'apply_edit',
          arguments: JSON.stringify({ path: outside, old_text: 'secret', new_text: 'stolen' }),
        },
      ],
    }));

    const outcome = await agent({ http: spy.http }).run(ctx);

    // Permission was granted and the write still did not happen: the boundary
    // is the fs the bridge handed over, not the question the runner asked.
    expect(requests.every((request) => request.tool !== undefined)).toBe(true);
    expect(outcome.kind).toBe('blocked');
    expect(outcome.kind === 'blocked' && outcome.message).toContain(
      'outside the configured editRoots',
    );
    expect(readFileSync(outside).toString('utf8')).toBe(before);
  });

  it('refuses a read outside editRoots too, so nothing is exfiltrated into a prompt', async () => {
    const { root, file } = makeProject();
    const outside = path.join(makeTempDir('sve-outside-'), 'id_rsa');
    writeFileSync(outside, 'PRIVATE KEY MATERIAL\n');

    const { ctx } = permissive(root, file);
    const spy = httpSpy(() => ({
      toolCalls: [{ name: 'read_file', arguments: JSON.stringify({ path: outside }) }],
    }));

    const outcome = await agent({ http: spy.http }).run(ctx);

    expect(outcome.kind).toBe('blocked');
    // And the contents never reached a request body on the way out.
    for (const call of spy.calls) {
      expect(JSON.stringify(call.body)).not.toContain('PRIVATE KEY MATERIAL');
    }
  });

  it('refuses a traversal spelled relative to the project root', async () => {
    const { root, file } = makeProject();
    const { ctx } = permissive(root, file);
    const spy = httpSpy(() => ({
      toolCalls: [
        {
          name: 'apply_edit',
          arguments: JSON.stringify({
            path: '../escape.tsx',
            old_text: 'a',
            new_text: 'b',
          }),
        },
      ],
    }));

    const outcome = await agent({ http: spy.http }).run(ctx);

    expect(outcome.kind).toBe('blocked');
  });
});

/* ── AC-10.5 — stateless retry ────────────────────────────────────────────── */

describe('AC-10.5 no session', () => {
  const outcomes: Script[] = [
    () => ({ content: 'DONE' }),
    () => ({ content: 'BLOCKED: no' }),
    (_call, turn) => (turn === 0 ? { toolCalls: [THE_EDIT] } : { content: 'DONE' }),
  ];

  it.each(outcomes.map((script, index) => [index, script] as const))(
    'returns no sessionId (%i)',
    async (_index, script) => {
      const { root, file } = makeProject();
      const { ctx } = makeAgentContext({ root, file });

      const outcome: AgentOutcome = await agent({ http: httpSpy(script).http }).run(ctx);

      expect(outcome.sessionId).toBeUndefined();
      expect(Object.hasOwn(outcome, 'sessionId')).toBe(false);
    },
  );

  it('retries after a drift and succeeds, with the file re-read at job time', async () => {
    const { root, file, rel } = makeProject();
    const prompts: string[] = [];
    const spy = httpSpy((call, turn) => {
      const user = call.body.messages.find((message) => message.role === 'user');
      if (turn % 2 === 0) prompts.push(user?.content ?? '');
      // Every even turn is the model's first look at a job; the odd one is the
      // acknowledgement after its tool call.
      if (turn === 0) {
        return {
          toolCalls: [
            {
              name: 'apply_edit',
              arguments: JSON.stringify({
                path: rel.replace(/\\/g, '/'),
                old_text: 'Swim today',
                new_text: 'Ship Faster',
              }),
            },
          ],
        };
      }
      if (turn === 2) {
        return {
          toolCalls: [
            {
              name: 'apply_edit',
              arguments: JSON.stringify({
                path: rel.replace(/\\/g, '/'),
                old_text: 'Ship Faster',
                new_text: 'Ship faster',
              }),
            },
          ],
        };
      }
      return { content: 'DONE' };
    });

    const bridge = createBridge({
      root,
      agent: agent({ http: spy.http }),
      undoRoot: path.join(root, '.sve-undo'),
    });
    const intent = makeIntent({ loc: `${rel.replace(/\\/g, '/')}:${HERO_H1_LINE}:${HERO_H1_COL}` });

    const [first] = await bridge.apply({ intents: [intent] });
    const [second] = await bridge.apply(
      { intents: [intent] },
      { retry: { mismatch: [{ prop: 'text', intent: 'Ship faster', rendered: 'Ship Faster' }] } },
    );
    bridge.close();

    expect(first?.status).toBe('landed');
    expect(second?.status).toBe('landed');
    expect(first?.sessionId).toBeUndefined();
    expect(second?.sessionId).toBeUndefined();

    // The retry prompt is not the first question asked twice: it carries the
    // file as the previous attempt left it, and says so.
    expect(prompts[0]).toContain('Swim today');
    expect(prompts[1]).toContain('Ship Faster');
    expect(prompts[1]?.toLowerCase()).toContain('retry');
    expect(readFileSync(file).toString('utf8')).toContain('Ship faster');
  });
});

/* ── AC-10.6 — malformed model output ─────────────────────────────────────── */

describe('AC-10.6 what cheap models actually do', () => {
  async function run(script: Script, maxTurns = 4) {
    const { root, file } = makeProject();
    const { ctx, requests } = makeAgentContext({ root, file });
    const spy = httpSpy(script);
    const outcome = await agent({ http: spy.http, maxTurns }).run(ctx);
    return { outcome, file, spy, requests };
  }

  function settled(outcome: AgentOutcome): string {
    expect(['blocked', 'noop']).toContain(outcome.kind);
    const message = outcome.kind === 'blocked' ? outcome.message : outcome.message;
    expect(message).toBeTypeOf('string');
    expect((message ?? '').length).toBeGreaterThan(0);
    return message ?? '';
  }

  it('a tool call whose arguments are not valid JSON', async () => {
    const { outcome, file } = await run((_call, turn) =>
      turn === 0
        ? { toolCalls: [{ name: 'apply_edit', arguments: '{path: src/Hero.tsx, old_text:' }] }
        : { content: 'I could not manage it.' },
    );

    expect(settled(outcome).toLowerCase()).toContain('json');
    expect(readFileSync(file)).toEqual(HERO_SOURCE);
  });

  it('arguments that parse but are not the shape the tool declared', async () => {
    const { outcome, file } = await run((_call, turn) =>
      turn === 0
        ? { toolCalls: [{ name: 'apply_edit', arguments: JSON.stringify({ file: 'Hero.tsx' }) }] }
        : { content: 'giving up' },
    );

    settled(outcome);
    expect(readFileSync(file)).toEqual(HERO_SOURCE);
  });

  it('a call naming a tool that does not exist', async () => {
    const { outcome, file, requests } = await run((_call, turn) =>
      turn === 0
        ? {
            toolCalls: [
              { name: 'write_file', arguments: JSON.stringify({ path: 'src/Hero.tsx', content: '' }) },
            ],
          }
        : { content: 'ok' },
    );

    expect(settled(outcome)).toContain('write_file');
    // Invented tools are not executed, so nothing was even asked about.
    expect(requests).toHaveLength(0);
    expect(readFileSync(file)).toEqual(HERO_SOURCE);
  });

  it('a tool call the model wrapped in prose instead of emitting as a tool call', async () => {
    const { outcome, file } = await run(() => ({
      content: [
        'Sure! Here is the edit I would make:',
        '```json',
        '{"tool":"apply_edit","path":"src/Hero.tsx","old_text":"Swim today","new_text":"Ship faster"}',
        '```',
      ].join('\n'),
    }));

    // Not executed: a fenced block in the reply is prose, and a runner that
    // scraped tool calls out of prose would be executing text no protocol
    // marked as a call.
    settled(outcome);
    expect(readFileSync(file)).toEqual(HERO_SOURCE);
  });

  it('a markdown fence wrapped around the arguments of a real tool call', async () => {
    const { outcome, file } = await run((_call, turn) =>
      turn === 0
        ? {
            toolCalls: [
              {
                name: 'apply_edit',
                arguments: '```json\n{"path":"src/Hero.tsx","old_text":"Swim today"}\n```',
              },
            ],
          }
        : { content: 'sorry' },
    );

    settled(outcome);
    expect(readFileSync(file)).toEqual(HERO_SOURCE);
  });

  it('a loop that never terminates', async () => {
    const { outcome, spy, file } = await run(
      () => ({
        toolCalls: [{ name: 'read_file', arguments: JSON.stringify({ path: 'src/Hero.tsx' }) }],
      }),
      4,
    );

    // A bound reached is a reported outcome, not a hang.
    expect(outcome.kind).toBe('blocked');
    expect(settled(outcome)).toContain('4');
    expect(spy.calls).toHaveLength(4);
    expect(readFileSync(file)).toEqual(HERO_SOURCE);
  });

  it('has a turn bound small enough to be a bound at all', () => {
    expect(OPENAI_MAX_TURNS).toBeGreaterThan(0);
    expect(OPENAI_MAX_TURNS).toBeLessThanOrEqual(20);
  });

  it('an old_text the file does not contain', async () => {
    const { outcome, file } = await run((_call, turn) =>
      turn === 0
        ? {
            toolCalls: [
              {
                name: 'apply_edit',
                arguments: JSON.stringify({
                  path: 'src/Hero.tsx',
                  old_text: 'Dive today',
                  new_text: 'Ship faster',
                }),
              },
            ],
          }
        : { content: 'BLOCKED: the text was not there' },
    );

    expect(outcome.kind).toBe('blocked');
    expect(readFileSync(file)).toEqual(HERO_SOURCE);
  });

  it('an old_text that matches in more than one place', async () => {
    const { outcome, file } = await run((_call, turn) =>
      turn === 0
        ? {
            toolCalls: [
              {
                name: 'apply_edit',
                arguments: JSON.stringify({
                  path: 'src/Hero.tsx',
                  old_text: 'className',
                  new_text: 'class',
                }),
              },
            ],
          }
        : { content: 'giving up' },
    );

    // Replacing the first of several is how an edit lands in the wrong element.
    settled(outcome);
    expect(readFileSync(file)).toEqual(HERO_SOURCE);
  });

  it('a body that is not JSON at all', async () => {
    const { outcome, file } = await run(() => ({ raw: '<html>502 Bad Gateway</html>' }));

    settled(outcome);
    expect(readFileSync(file)).toEqual(HERO_SOURCE);
  });

  it('a JSON body with no choices in it', async () => {
    const { outcome } = await run(() => ({ raw: JSON.stringify({ id: 'x', choices: [] }) }));

    settled(outcome);
  });

  it('an HTTP error, named rather than thrown', async () => {
    const { outcome } = await run(() => ({
      status: 503,
      raw: JSON.stringify({ error: { message: 'model is loading' } }),
    }));

    expect(settled(outcome)).toContain('503');
  });

  it('a transport that throws outright', async () => {
    const { root, file } = makeProject();
    const { ctx } = makeAgentContext({ root, file });
    const http: HttpClient = async () => {
      throw new Error('ECONNREFUSED 127.0.0.1:11434');
    };

    const outcome = await agent({ http }).run(ctx);

    expect(outcome.kind).toBe('blocked');
    expect(outcome.kind === 'blocked' && outcome.message).toContain('ECONNREFUSED');
    expect(readFileSync(file)).toEqual(HERO_SOURCE);
  });

  it('reports what it did write when a fault followed a real edit', async () => {
    const { root, file } = makeProject();
    const { ctx } = makeAgentContext({ root, file });
    const spy = httpSpy((_call, turn) =>
      turn === 0
        ? { toolCalls: [THE_EDIT] }
        : { toolCalls: [{ name: 'write_file', arguments: 'not json either' }] },
    );

    const outcome = await agent({ http: spy.http, maxTurns: 3 }).run(ctx);

    // The file changed. Telling the user nothing was written while the disk
    // says otherwise is the one answer that is certainly wrong.
    expect(outcome.kind).toBe('edited');
    expect(readFileSync(file).toString('utf8')).toContain('Ship faster');
  });
});

/* ── AC-10.7 — no network in the unit suite ───────────────────────────────── */

describe('AC-10.7 the injected client', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('never reaches for the global fetch when a client was injected', async () => {
    let reached = false;
    globalThis.fetch = (() => {
      reached = true;
      throw new Error('a unit test reached the network');
    }) as typeof fetch;

    const { root, file } = makeProject();
    const { ctx } = makeAgentContext({ root, file });
    const spy = httpSpy((_call, turn) =>
      turn === 0 ? { toolCalls: [THE_EDIT] } : { content: 'DONE' },
    );

    const outcome = await agent({ http: spy.http }).run(ctx);

    expect(outcome.kind).toBe('edited');
    expect(reached).toBe(false);
  });

  it('needs no key at all on the injected path', async () => {
    const { root, file } = makeProject();
    const { ctx } = makeAgentContext({ root, file });
    const spy = httpSpy(() => ({ content: 'DONE' }));

    await createOpenAiAgent({
      baseUrl: 'http://localhost:1234/v1',
      model: 'local-model',
      http: spy.http,
    }).run(ctx);

    const headers = Object.keys(spy.last().headers).map((key) => key.toLowerCase());
    expect(headers).not.toContain('authorization');
  });
});

/* ── AC-10.9 — a missing credential is named ──────────────────────────────── */

describe('AC-10.9 configuration errors', () => {
  function selecting(env: Record<string, string>): string {
    let thrown: unknown;
    try {
      resolveAgentRunner({ SVE_AGENT: 'openai', ...env });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    return (thrown as Error).message;
  }

  it('names the base URL when there is none', () => {
    const message = selecting({});

    expect(message).toContain(OPENAI_ENV.baseUrl);
    // Not a 401 surfacing from three layers down inside an HTTP client.
    expect(message).not.toContain('401');
  });

  it('names the model when there is none', () => {
    const message = selecting({ [OPENAI_ENV.baseUrl]: 'https://api.deepseek.com/v1' });

    expect(message).toContain(OPENAI_ENV.model);
  });

  it('names the key for a remote endpoint that has none', () => {
    const message = selecting({
      [OPENAI_ENV.baseUrl]: 'https://api.deepseek.com/v1',
      [OPENAI_ENV.model]: 'deepseek-chat',
    });

    expect(message).toContain(OPENAI_ENV.apiKey);
    expect(message).toContain('api.deepseek.com');
  });

  it('treats whitespace as absent rather than as a credential', () => {
    const message = selecting({
      [OPENAI_ENV.baseUrl]: 'https://api.deepseek.com/v1',
      [OPENAI_ENV.model]: 'deepseek-chat',
      [OPENAI_ENV.apiKey]: '   ',
    });

    expect(message).toContain(OPENAI_ENV.apiKey);
  });

  it('rejects a base URL that is not a URL, before any request is attempted', () => {
    const message = selecting({
      [OPENAI_ENV.baseUrl]: 'not a url',
      [OPENAI_ENV.model]: 'm',
      [OPENAI_ENV.apiKey]: 'k',
    });

    expect(message).toContain(OPENAI_ENV.baseUrl);
  });
});

describe('AC-10.9 local endpoints invent no key', () => {
  it.each([
    'http://localhost:11434/v1',
    'http://127.0.0.1:1234/v1',
    'http://[::1]:8080/v1',
    'http://host.docker.internal:11434/v1',
  ])('accepts %s with no key set', (baseUrl) => {
    const runner = resolveAgentRunner({
      SVE_AGENT: 'openai',
      [OPENAI_ENV.baseUrl]: baseUrl,
      [OPENAI_ENV.model]: 'qwen2.5-coder',
    });

    expect(runner.name).toBe('openai');
    expect(isLocalEndpoint(baseUrl)).toBe(true);
  });

  it('does not call a hosted endpoint local', () => {
    expect(isLocalEndpoint('https://api.deepseek.com/v1')).toBe(false);
    expect(isLocalEndpoint('https://localhost.evil.example/v1')).toBe(false);
  });

  it('still honours a key when a local endpoint was given one', () => {
    const resolved = openAiSettings({
      [OPENAI_ENV.baseUrl]: 'http://localhost:11434/v1',
      [OPENAI_ENV.model]: 'qwen2.5-coder',
      [OPENAI_ENV.apiKey]: 'ollama-proxy-token',
    });

    expect(resolved.ok).toBe(true);
    expect(resolved.ok && resolved.settings.apiKey).toBe('ollama-proxy-token');
  });

  it('reports a local endpoint with no key as having none, rather than an empty one', () => {
    const resolved = openAiSettings({
      [OPENAI_ENV.baseUrl]: 'http://localhost:11434/v1',
      [OPENAI_ENV.model]: 'qwen2.5-coder',
    });

    expect(resolved.ok).toBe(true);
    expect(resolved.ok && resolved.settings.apiKey).toBeUndefined();
  });
});
