import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Options as SdkOptions } from '@anthropic-ai/claude-agent-sdk';
import { afterAll, describe, expect, it } from 'vitest';
import {
  CLAUDE_MAX_TURNS,
  CLAUDE_MODEL,
  CLAUDE_TOOLS,
  createClaudeAgent,
  type AgentStreamMessage,
  type SdkQuery,
} from '../src/agent/claude.js';
import type { AgentContext } from '../src/agent/types.js';
import { agentRunnerNames, resolveAgentRunner } from '../src/agent/index.js';
import { permitPath } from '../src/guard.js';
import { buildRetryPrompt } from '../src/prompt.js';
import {
  cleanupTempDirs,
  HERO_SOURCE,
  makeAgentContext,
  makeProject,
  makeTempDir,
} from './helpers.js';

afterAll(cleanupTempDirs);

/**
 * AC-6 — the live agent, asserted without ever reaching the network.
 *
 * Every test here injects `query`. Nothing in this file constructs an SDK client,
 * spawns the Claude Code process, or reads an API key: the runner is exercised by
 * asserting the options object it hands over and by driving a scripted message
 * stream back at it (AC-6.6). A test in this file that would cost a token is a bug
 * in the test.
 */

const SESSION = 'session_01AC6';

/* ── the scripted stream ──────────────────────────────────────────────────── */

interface QueryCall {
  prompt: string;
  options: SdkOptions;
}

type Script = (call: QueryCall) => Promise<AgentStreamMessage[]>;

interface QuerySpy {
  query: SdkQuery;
  calls: QueryCall[];
  /** The options of the last call — every AC-6.2 assertion reads this. */
  options(): SdkOptions;
}

/**
 * A `query` that never leaves the process.
 *
 * The script receives the call, so it can do the two things a real run does that
 * matter here: ask `options.canUseTool` before touching a path, and write to the
 * file. What it returns is the message stream the runner then reads.
 */
function querySpy(script: Script): QuerySpy {
  const calls: QueryCall[] = [];

  const query: SdkQuery = ({ prompt, options }) => {
    const call: QueryCall = { prompt, options: options ?? {} };
    calls.push(call);
    return (async function* stream() {
      for (const message of await script(call)) yield message;
    })();
  };

  return {
    query,
    calls,
    options: () => calls[calls.length - 1]!.options,
  };
}

const systemInit = (session = SESSION): AgentStreamMessage => ({
  type: 'system',
  subtype: 'init',
  session_id: session,
});

const says = (text: string, session = SESSION): AgentStreamMessage => ({
  type: 'assistant',
  session_id: session,
  message: { content: [{ type: 'text', text }] },
});

const usesEdit = (file: string, session = SESSION): AgentStreamMessage => ({
  type: 'assistant',
  session_id: session,
  message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: file } }] },
});

const finishes = (result: string, session = SESSION): AgentStreamMessage => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result,
  session_id: session,
});

/** The one edit every happy-path script makes: the intent, applied to the fixture. */
function writeTheEdit(file: string, text = 'Ship faster'): void {
  const source = readFileSync(file).toString('utf8');
  writeFileSync(file, Buffer.from(source.replace('Swim today', text), 'utf8'));
}

/* ── AC-6.1 — it registers, and it is not the default ─────────────────────── */

describe('AC-6.1 registration', () => {
  it('registers under `claude`, and `SVE_AGENT=claude` selects it', () => {
    expect(agentRunnerNames()).toContain('claude');

    const runner = resolveAgentRunner({ SVE_AGENT: 'claude', ANTHROPIC_API_KEY: 'sk-ant-test' });

    expect(runner.name).toBe('claude');
    expect(runner.requiresNetwork).toBe(true);
  });

  it('leaves the fake as the default, so nothing implicitly reaches the network', () => {
    const runner = resolveAgentRunner({});

    expect(runner.name).toBe('fake');
    expect(runner.requiresNetwork).toBe(false);
  });

  it('names the missing credential rather than failing inside the SDK', () => {
    let thrown: unknown;
    try {
      resolveAgentRunner({ SVE_AGENT: 'claude' });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain('ANTHROPIC_API_KEY');
    expect(message).toContain('SVE_AGENT=claude');
    // The old M7-is-not-here error is gone, and no SDK internals leak out.
    expect(message).not.toContain('M7');
    expect(message).not.toContain('claude-agent-sdk');
  });

  it('accepts an OAuth token in place of an API key', () => {
    const runner = resolveAgentRunner({
      SVE_AGENT: 'claude',
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-test',
    });

    expect(runner.name).toBe('claude');
  });
});

/* ── AC-6.2 — the tool surface is exactly Read and Edit ───────────────────── */

describe('AC-6.2 the options handed to query', () => {
  async function runOnce(): Promise<QuerySpy> {
    const { root, file } = makeProject();
    const { ctx } = makeAgentContext({ root, file });
    const spy = querySpy(async () => [systemInit(), finishes('DONE')]);

    await createClaudeAgent({ query: spy.query }).run(ctx);
    return spy;
  }

  it('allows exactly Read and Edit', async () => {
    const spy = await runOnce();

    expect(spy.options().allowedTools).toEqual(['Read', 'Edit']);
    expect(CLAUDE_TOOLS).toEqual(['Read', 'Edit']);
  });

  it('does not so much as mention Glob, Grep, Bash, Write, WebFetch or WebSearch', async () => {
    const spy = await runOnce();
    const serialised = JSON.stringify(spy.options());

    // Glob and Grep especially: an agent that can search is an agent that can
    // decide the stamped coordinate was wrong and go looking for a better one,
    // which is the failure mode this project exists to remove.
    for (const tool of ['Glob', 'Grep', 'Bash', 'Write', 'WebFetch', 'WebSearch']) {
      expect(spy.options().allowedTools).not.toContain(tool);
      expect(serialised).not.toContain(tool);
    }
  });

  it('restricts the base tool set as well as the permission list', async () => {
    const spy = await runOnce();

    // `allowedTools` auto-allows; `tools` is what decides which tools exist at
    // all. Only the pair actually narrows the surface (see the SDK's own docs).
    expect(spy.options().tools).toEqual(['Read', 'Edit']);
  });

  it('pins the model, the working directory and a turn bound', async () => {
    const { root, file } = makeProject();
    const { ctx } = makeAgentContext({ root, file });
    const spy = querySpy(async () => [finishes('DONE')]);

    await createClaudeAgent({ query: spy.query }).run(ctx);

    expect(spy.options().model).toBe('claude-opus-5');
    expect(CLAUDE_MODEL).toBe('claude-opus-5');
    expect(spy.options().cwd).toBe(root);
    expect(spy.options().maxTurns).toBe(CLAUDE_MAX_TURNS);
    expect(CLAUDE_MAX_TURNS).toBeGreaterThan(0);
    expect(CLAUDE_MAX_TURNS).toBeLessThanOrEqual(20);
  });

  it('loads no filesystem settings, so a developer machine cannot widen the surface', async () => {
    const spy = await runOnce();

    expect(spy.options().settingSources).toEqual([]);
  });

  it('hands over the prompt the bridge built, unchanged', async () => {
    const { root, file } = makeProject();
    const { ctx } = makeAgentContext({ root, file });
    const spy = querySpy(async () => [finishes('DONE')]);

    await createClaudeAgent({ query: spy.query }).run(ctx);

    expect(spy.calls[0]!.prompt).toBe(ctx.prompt);
  });
});

/* ── AC-6.3 — canUseTool is the enforced boundary ─────────────────────────── */

describe('AC-6.3 canUseTool', () => {
  /** A context whose permission callback is the bridge's own guard, not a stub. */
  function guarded(): { root: string; file: string; ctx: AgentContext } {
    const { root, file } = makeProject();
    const { ctx } = makeAgentContext({
      root,
      file,
      canUseTool: (request) => permitPath(request.path, { root, editRoots: [root] }),
    });
    return { root, file, ctx };
  }

  /** The callback as the SDK would receive it: taken off the options object. */
  async function callbackFor(ctx: AgentContext) {
    const spy = querySpy(async () => [finishes('DONE')]);
    await createClaudeAgent({ query: spy.query }).run(ctx);
    const callback = spy.options().canUseTool;
    expect(callback).toBeTypeOf('function');
    return callback!;
  }

  it('allows a Read inside the edit roots', async () => {
    const { file, ctx } = guarded();
    const callback = await callbackFor(ctx);

    const decision = await callback('Read', { file_path: file }, meta());

    expect(decision).toEqual({ behavior: 'allow' });
  });

  it('denies an Edit outside the edit roots, with a reason and without throwing', async () => {
    const { ctx } = guarded();
    const callback = await callbackFor(ctx);
    const outside = path.join(makeTempDir('sve-outside-'), 'Secret.tsx');

    const decision = await callback('Edit', { file_path: outside }, meta());

    expect(decision).toMatchObject({ behavior: 'deny' });
    expect((decision as { message: string }).message).toContain('outside the configured editRoots');
    expect((decision as { message: string }).message).toContain(outside);
  });

  it('denies a traversal spelled relative to the working directory', async () => {
    const { ctx } = guarded();
    const callback = await callbackFor(ctx);

    const decision = await callback('Edit', { file_path: '../escape.tsx' }, meta());

    expect(decision).toMatchObject({ behavior: 'deny' });
  });

  it('resolves the job as blocked when a path was denied and nothing was written', async () => {
    const { root, file } = makeProject();
    const outside = path.join(makeTempDir('sve-outside-'), 'Secret.tsx');
    const { ctx } = makeAgentContext({
      root,
      file,
      canUseTool: (request) => permitPath(request.path, { root, editRoots: [root] }),
    });

    const spy = querySpy(async (call) => {
      const decision = await call.options.canUseTool!('Edit', { file_path: outside }, meta());
      return [says(`I was told: ${(decision as { message?: string }).message ?? ''}`), finishes('')];
    });

    const outcome = await createClaudeAgent({ query: spy.query }).run(ctx);

    expect(outcome.kind).toBe('blocked');
    expect(outcome.kind === 'blocked' && outcome.message).toContain('outside the configured editRoots');
    expect(readFileSync(file)).toEqual(HERO_SOURCE);
  });
});

function meta() {
  return {
    signal: new AbortController().signal,
    toolUseID: 'toolu_test',
    requestId: 'req_test',
  };
}

/* ── AC-6.4 — BLOCKED is parsed, not guessed ──────────────────────────────── */

describe('AC-6.4 a refusal', () => {
  it('is read out of the final reply, with the reason preserved', async () => {
    const { root, file } = makeProject();
    const { ctx } = makeAgentContext({ root, file });
    const reason = 'the element at line 4 renders an expression, not a string literal';
    const spy = querySpy(async () => [systemInit(), says(`BLOCKED: ${reason}`), finishes(`BLOCKED: ${reason}`)]);

    const outcome = await createClaudeAgent({ query: spy.query }).run(ctx);

    expect(outcome).toMatchObject({
      kind: 'blocked',
      reason,
      message: `BLOCKED: ${reason}`,
      sessionId: SESSION,
    });
    // A refusal leaves the file exactly as it was.
    expect(readFileSync(file)).toEqual(HERO_SOURCE);
  });

  it('is read out of the result message when the agent said nothing else', async () => {
    const { root, file } = makeProject();
    const { ctx } = makeAgentContext({ root, file });
    const spy = querySpy(async () => [finishes('BLOCKED: nothing at that column')]);

    const outcome = await createClaudeAgent({ query: spy.query }).run(ctx);

    expect(outcome).toMatchObject({ kind: 'blocked', reason: 'nothing at that column' });
  });

  it('is not improvised from prose that merely mentions being blocked', async () => {
    const { root, file } = makeProject();
    const { ctx } = makeAgentContext({ root, file });
    const spy = querySpy(async () => [says('I was nearly blocked, but the edit is done.'), finishes('DONE')]);

    const outcome = await createClaudeAgent({ query: spy.query }).run(ctx);

    expect(outcome.kind).toBe('noop');
  });
});

/* ── the three outcomes ───────────────────────────────────────────────────── */

describe('the outcome the runner reports', () => {
  it('edited — when the file changed, with the session id from the stream', async () => {
    const { root, file } = makeProject();
    const { ctx, progress } = makeAgentContext({ root, file });
    const spy = querySpy(async () => {
      writeTheEdit(file);
      return [systemInit(), usesEdit(file), finishes('DONE')];
    });

    const outcome = await createClaudeAgent({ query: spy.query }).run(ctx);

    expect(outcome).toMatchObject({ kind: 'edited', files: [file], sessionId: SESSION });
    expect(readFileSync(file).toString('utf8')).toContain('Ship faster');
    // The bridge listens for this to announce the write.
    expect(progress.some((update) => update.phase === 'writing')).toBe(true);
  });

  it('noop — when it claimed success and the file is untouched', async () => {
    const { root, file } = makeProject();
    const { ctx } = makeAgentContext({ root, file });
    const spy = querySpy(async () => [systemInit(), finishes('DONE')]);

    const outcome = await createClaudeAgent({ query: spy.query }).run(ctx);

    expect(outcome).toMatchObject({ kind: 'noop', sessionId: SESSION });
    expect(readFileSync(file)).toEqual(HERO_SOURCE);
  });

  it('blocked — when the SDK ended the turn early, naming why', async () => {
    const { root, file } = makeProject();
    const { ctx } = makeAgentContext({ root, file });
    const spy = querySpy(async () => [
      systemInit(),
      { type: 'result', subtype: 'error_max_turns', is_error: true, session_id: SESSION },
    ]);

    const outcome = await createClaudeAgent({ query: spy.query }).run(ctx);

    expect(outcome.kind).toBe('blocked');
    expect(outcome.kind === 'blocked' && outcome.reason).toContain('error_max_turns');
  });

  it('edited wins over a BLOCKED reply, because the file really did change', async () => {
    const { root, file } = makeProject();
    const { ctx } = makeAgentContext({ root, file });
    const spy = querySpy(async () => {
      writeTheEdit(file);
      return [usesEdit(file), finishes('BLOCKED: on reflection I should not have')];
    });

    const outcome = await createClaudeAgent({ query: spy.query }).run(ctx);

    // Reporting `blocked` here would tell the user nothing was written while the
    // file on disk says otherwise. The verifier is the judge of what landed.
    expect(outcome.kind).toBe('edited');
  });
});

/* ── AC-6.5 — retry resumes the same session ──────────────────────────────── */

describe('AC-6.5 a retry', () => {
  const mismatch = [{ prop: 'text', intent: 'Ship faster', rendered: 'Ship Faster' }];

  it('passes the prior session id as `resume`', async () => {
    const { root, file } = makeProject();
    const { ctx } = makeAgentContext({
      root,
      file,
      retry: { sessionId: 'session_prior', mismatch },
    });
    const spy = querySpy(async () => [finishes('DONE')]);

    await createClaudeAgent({ query: spy.query }).run(ctx);

    expect(spy.options().resume).toBe('session_prior');
  });

  it('starts a fresh session when there is nothing to resume', async () => {
    const { root, file } = makeProject();
    const { ctx } = makeAgentContext({ root, file });
    const spy = querySpy(async () => [finishes('DONE')]);

    await createClaudeAgent({ query: spy.query }).run(ctx);

    expect(spy.options().resume).toBeUndefined();
  });

  it('carries the recorded mismatch — intent versus rendered — in the prompt', () => {
    const prompt = buildRetryPrompt({ prompt: 'the original instruction', mismatch });

    expect(prompt).toContain('the original instruction');
    expect(prompt).toContain('Ship faster');
    expect(prompt).toContain('Ship Faster');
    expect(prompt).toMatch(/text/);
    // The agent is told what its own edit produced, not asked the question again.
    expect(prompt.toLowerCase()).toContain('previous');
  });
});

/* ── AC-6.6 — no network, and the abort signal is honoured ────────────────── */

describe('AC-6.6 the unit path', () => {
  it('needs no credentials at all when query is injected', async () => {
    const { root, file } = makeProject();
    const { ctx } = makeAgentContext({ root, file });
    const spy = querySpy(async () => [finishes('DONE')]);

    // No ANTHROPIC_API_KEY is read, set, or required on this path.
    await expect(createClaudeAgent({ query: spy.query }).run(ctx)).resolves.toBeTruthy();
  });

  it('gives the SDK an abort controller wired to the bridge lifetime', async () => {
    const lifetime = new AbortController();
    const { root, file } = makeProject();
    const { ctx } = makeAgentContext({ root, file });
    const running: AgentContext = { ...ctx, signal: lifetime.signal };

    let controller: AbortController | undefined;
    let abortedMidRun = false;
    const spy = querySpy(async (call) => {
      controller = call.options.abortController;
      // Closing the bridge mid-run must reach the SDK, not be noticed afterwards.
      lifetime.abort();
      abortedMidRun = controller?.signal.aborted === true;
      return [finishes('DONE')];
    });

    await createClaudeAgent({ query: spy.query }).run(running);

    expect(controller).toBeInstanceOf(AbortController);
    expect(abortedMidRun).toBe(true);
  });
});
