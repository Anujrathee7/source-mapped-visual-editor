import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { createFakeAgent, FAKE_MODES } from '../src/agent/fake.js';
import { resolveAgentRunner } from '../src/agent/index.js';
import { cleanupTempDirs, HERO_SOURCE, makeAgentContext, makeIntent, makeProject } from './helpers.js';

afterAll(cleanupTempDirs);

// AC-3.5
describe('the fake agent', () => {
  // "at least four modes". M6 added two more to prove the verifier with; see
  // test/fake-modes.test.ts.
  it('offers the four scripted modes', () => {
    for (const mode of ['blocked', 'correct', 'noop', 'wrong'] as const) {
      expect(FAKE_MODES).toContain(mode);
    }
  });

  it('correct — applies the intent exactly as asked', async () => {
    const { root, file } = makeProject();
    const { ctx } = makeAgentContext({ root, file });

    const outcome = await createFakeAgent({ mode: 'correct' }).run(ctx);

    expect(outcome.kind).toBe('edited');
    const after = readFileSync(file);
    expect(after.toString('utf8')).toContain('<h1 className="text-5xl font-bold">Ship faster</h1>');
    expect(after.toString('utf8')).not.toContain('Swim today');
  });

  it('correct — touches nothing but the target line, bytes included', async () => {
    const { root, file } = makeProject();
    const { ctx } = makeAgentContext({ root, file });
    await createFakeAgent({ mode: 'correct' }).run(ctx);

    const before = HERO_SOURCE.toString('utf8').split('\r\n');
    const after = readFileSync(file).toString('utf8').split('\r\n');

    expect(after).toHaveLength(before.length);
    for (const [index, line] of before.entries()) {
      if (index === 3) continue; // the h1, line 4
      expect(after[index]).toBe(line);
    }
    // CRLF and the trailing newline survive.
    expect(readFileSync(file).subarray(-2).toString('binary')).toBe('\r\n');
    expect(readFileSync(file).includes(Buffer.from('Café', 'utf8'))).toBe(true);
  });

  it('correct — applies a class edit', async () => {
    const { root, file } = makeProject();
    const intent = makeIntent({
      kind: 'class',
      after: { text: 'Swim today', classes: ['text-6xl', 'font-black'], computed: {} },
      instruction: 'Make the heading heavier.',
    });
    const { ctx } = makeAgentContext({ root, file, intent });

    const outcome = await createFakeAgent({ mode: 'correct' }).run(ctx);

    expect(outcome.kind).toBe('edited');
    expect(readFileSync(file).toString('utf8')).toContain(
      '<h1 className="text-6xl font-black">Swim today</h1>',
    );
  });

  it('wrong — writes a plausible but different value, so the verifier has something to catch', async () => {
    const { root, file } = makeProject();
    const { ctx } = makeAgentContext({ root, file });

    const outcome = await createFakeAgent({ mode: 'wrong' }).run(ctx);

    expect(outcome.kind).toBe('edited');
    const after = readFileSync(file).toString('utf8');
    expect(after).not.toContain('Swim today'); // it did write
    expect(after).not.toContain('>Ship faster<'); // but not what was asked
    expect(after).toContain('>Ship Faster<'); // different capitalisation
  });

  it('blocked — writes nothing and returns BLOCKED: <reason>', async () => {
    const { root, file } = makeProject();
    const { ctx } = makeAgentContext({ root, file });

    const outcome = await createFakeAgent({ mode: 'blocked' }).run(ctx);

    expect(outcome.kind).toBe('blocked');
    expect(outcome.kind === 'blocked' && outcome.message).toMatch(/^BLOCKED: .+/);
    expect(Buffer.compare(readFileSync(file), HERO_SOURCE)).toBe(0);
  });

  it('noop — reports success without writing', async () => {
    const { root, file } = makeProject();
    const { ctx } = makeAgentContext({ root, file });

    const outcome = await createFakeAgent({ mode: 'noop' }).run(ctx);

    expect(outcome.kind).toBe('noop');
    expect(Buffer.compare(readFileSync(file), HERO_SOURCE)).toBe(0);
  });

  it('asks permission before writing, and is blocked when told no', async () => {
    const { root, file } = makeProject();
    const { ctx, requests } = makeAgentContext({
      root,
      file,
      canUseTool: async () => ({ behavior: 'deny', message: 'Denied: outside editRoots' }),
    });

    const outcome = await createFakeAgent({ mode: 'correct' }).run(ctx);

    expect(requests.map((request) => request.tool)).toContain('Edit');
    expect(outcome.kind).toBe('blocked');
    expect(outcome.kind === 'blocked' && outcome.reason).toContain('outside editRoots');
    expect(Buffer.compare(readFileSync(file), HERO_SOURCE)).toBe(0);
  });

  it('blocks rather than guesses when the target element is not what was described', async () => {
    const { root, file } = makeProject();
    const intent = makeIntent({
      before: { text: 'Something else entirely', classes: [], computed: {} },
    });
    const { ctx } = makeAgentContext({ root, file, intent });

    const outcome = await createFakeAgent({ mode: 'correct' }).run(ctx);

    expect(outcome.kind).toBe('blocked');
    expect(Buffer.compare(readFileSync(file), HERO_SOURCE)).toBe(0);
  });

  it('runs a script of modes in order', async () => {
    const { root, file } = makeProject();
    const agent = createFakeAgent({ script: ['noop', 'blocked', 'correct'] });

    expect((await agent.run(makeAgentContext({ root, file }).ctx)).kind).toBe('noop');
    expect((await agent.run(makeAgentContext({ root, file }).ctx)).kind).toBe('blocked');
    expect((await agent.run(makeAgentContext({ root, file }).ctx)).kind).toBe('edited');
  });

  it('reports progress while it works', async () => {
    const { root, file } = makeProject();
    const { ctx, progress } = makeAgentContext({ root, file });
    await createFakeAgent({ mode: 'correct' }).run(ctx);
    expect(progress.some((update) => update.phase === 'writing')).toBe(true);
  });

  it('needs no API key and no network', () => {
    const agent = createFakeAgent();
    expect(agent.name).toBe('fake');
    expect(agent.requiresNetwork).toBe(false);
  });
});

// AC-3.5 — selected by environment variable, so no test reaches into module internals
describe('resolveAgentRunner', () => {
  it('selects the fake when SVE_AGENT=fake', () => {
    expect(resolveAgentRunner({ SVE_AGENT: 'fake' }).name).toBe('fake');
  });

  it('defaults to the fake when SVE_AGENT is unset', () => {
    expect(resolveAgentRunner({}).name).toBe('fake');
  });

  it('takes the fake mode from SVE_AGENT_MODE', async () => {
    const { root, file } = makeProject();
    const agent = resolveAgentRunner({ SVE_AGENT: 'fake', SVE_AGENT_MODE: 'wrong' });
    await agent.run(makeAgentContext({ root, file }).ctx);
    expect(readFileSync(file).toString('utf8')).toContain('>Ship Faster<');
  });

  it('rejects an unknown SVE_AGENT_MODE rather than silently editing correctly', () => {
    expect(() => resolveAgentRunner({ SVE_AGENT: 'fake', SVE_AGENT_MODE: 'sideways' })).toThrow(
      /SVE_AGENT_MODE/,
    );
  });

  it('reports that the real runner is not wired up yet, naming the milestone', () => {
    expect(() => resolveAgentRunner({ SVE_AGENT: 'claude' })).toThrow(/M7/);
  });

  it('rejects an unknown runner name', () => {
    expect(() => resolveAgentRunner({ SVE_AGENT: 'gpt' })).toThrow(/gpt/);
  });
});
