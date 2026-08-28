import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ProgressEvent } from '@sve/protocol';
import { createFakeAgent } from '../src/agent/fake.js';
import type { AgentContext, AgentOutcome, AgentRunner } from '../src/agent/types.js';
import { createBridge } from '../src/bridge.js';
import { cleanupTempDirs, HERO_SOURCE, makeIntent, makeProject } from './helpers.js';

afterAll(cleanupTempDirs);

function runner(run: (ctx: AgentContext) => Promise<AgentOutcome>, name = 'stub'): AgentRunner {
  return { name, requiresNetwork: false, run };
}

/** Collapses repeats so a runner's own progress reports do not break the phase order. */
function phaseOrder(events: ProgressEvent[]): string[] {
  return events.map((event) => event.phase).filter((phase, index, all) => phase !== all[index - 1]);
}

describe('createBridge', () => {
  // AC-3.1
  it('runs concurrently submitted jobs strictly serially', async () => {
    const { root } = makeProject();
    const log: string[] = [];
    const bridge = createBridge({
      root,
      agent: runner(async (ctx) => {
        const name = ctx.intent.eid;
        log.push(`start ${name}`);
        await new Promise((resolve) => setTimeout(resolve, name === 'A' ? 20 : 0));
        log.push(`end ${name}`);
        return { kind: 'noop' };
      }),
    });

    await Promise.all([
      bridge.apply({ intents: [makeIntent({ eid: 'A' })] }),
      bridge.apply({ intents: [makeIntent({ eid: 'B' })] }),
    ]);

    expect(log).toEqual(['start A', 'end A', 'start B', 'end B']);
    bridge.close();
  });

  // AC-3.1 — the reason the queue is serial at all
  it('re-reads the target file at job time, not at enqueue time', async () => {
    const { root, file } = makeProject();
    const bridge = createBridge({ root, agent: createFakeAgent({ mode: 'correct' }) });

    // The second intent describes the text the *first* job will produce. It can
    // only succeed if job two reads the file after job one has written it.
    const results = await bridge.apply({
      intents: [
        makeIntent(),
        makeIntent({
          before: { text: 'Ship faster', classes: [], computed: {} },
          after: { text: 'Sail sooner', classes: [], computed: {} },
          instruction: 'Replace the heading text with "Sail sooner".',
        }),
      ],
    });

    expect(results.map((result) => result.status)).toEqual(['landed', 'landed']);
    expect(readFileSync(file).toString('utf8')).toContain('>Sail sooner<');
    bridge.close();
  });

  it('resolves a throwing job as an error and still runs the next one', async () => {
    const { root } = makeProject();
    let runs = 0;
    const bridge = createBridge({
      root,
      agent: runner(async () => {
        runs += 1;
        if (runs === 1) throw new Error('the agent exploded');
        return { kind: 'noop' };
      }),
    });

    const [first, second] = await bridge.apply({ intents: [makeIntent(), makeIntent()] });

    expect(first?.status).toBe('error');
    expect(first?.message).toContain('the agent exploded');
    expect(second?.status).toBe('stalled');
    expect(runs).toBe(2);
    bridge.close();
  });

  // AC-3.3
  it('resolves a job targeting a path outside editRoots as blocked, having written nothing', async () => {
    const { root } = makeProject();
    const bridge = createBridge({
      root,
      editRoots: [path.join(root, 'src')],
      agent: createFakeAgent({ mode: 'correct' }),
    });

    const [result] = await bridge.apply({
      intents: [makeIntent({ loc: '../outside/Secret.tsx:4:7' })],
    });

    expect(result?.status).toBe('blocked');
    expect(result?.message).toMatch(/outside the configured editRoots/);
    // No snapshot either: a denied path must not be read, let alone copied.
    expect(existsSync(path.join(root, '.sve', 'undo', result!.jobId))).toBe(false);
    bridge.close();
  });

  it('hands the agent a deny decision rather than throwing at it', async () => {
    const { root } = makeProject();
    const seen: string[] = [];
    const bridge = createBridge({
      root,
      editRoots: [root],
      agent: runner(async (ctx) => {
        const outside = path.join(root, '..', 'escape.txt');
        const permission = await ctx.canUseTool({ tool: 'Write', path: outside });
        seen.push(permission.behavior);
        if (permission.behavior === 'deny') {
          return { kind: 'blocked', reason: permission.message, message: `BLOCKED: ${permission.message}` };
        }
        return { kind: 'noop' };
      }),
    });

    const [result] = await bridge.apply({ intents: [makeIntent()] });

    expect(seen).toEqual(['deny']);
    expect(result?.status).toBe('blocked');
    expect(result?.message).toMatch(/^BLOCKED: /);
    bridge.close();
  });

  // AC-3.5 — status mapping
  it.each([
    ['correct', 'landed'],
    ['wrong', 'landed'],
    ['blocked', 'blocked'],
    ['noop', 'stalled'],
  ] as const)('maps the %s fake mode to status %s', async (mode, status) => {
    const { root } = makeProject();
    const bridge = createBridge({ root, agent: createFakeAgent({ mode }) });
    const [result] = await bridge.apply({ intents: [makeIntent()] });
    expect(result?.status).toBe(status);
    bridge.close();
  });

  // AC-3.2
  it('snapshots before the agent runs, so revert restores the original bytes', async () => {
    const { root, file } = makeProject();
    const bridge = createBridge({ root, agent: createFakeAgent({ mode: 'correct' }) });

    const [result] = await bridge.apply({ intents: [makeIntent()] });
    expect(result?.status).toBe('landed');
    expect(Buffer.compare(readFileSync(file), HERO_SOURCE)).not.toBe(0);

    const reverted = await bridge.revert(result!.jobId);
    expect(reverted.status).toBe('landed');
    expect(Buffer.compare(readFileSync(file), HERO_SOURCE)).toBe(0);
    bridge.close();
  });

  it('reverts an unknown jobId as an error result rather than throwing', async () => {
    const { root } = makeProject();
    const bridge = createBridge({ root });
    const result = await bridge.revert('job_never_ran');
    expect(result).toMatchObject({ jobId: 'job_never_ran', status: 'error' });
    bridge.close();
  });

  it('carries a diff of what changed', async () => {
    const { root } = makeProject();
    const bridge = createBridge({ root, agent: createFakeAgent({ mode: 'correct' }) });
    const [result] = await bridge.apply({ intents: [makeIntent()] });

    expect(result?.diff).toContain('-      <h1 className="text-5xl font-bold">Swim today</h1>');
    expect(result?.diff).toContain('+      <h1 className="text-5xl font-bold">Ship faster</h1>');
    bridge.close();
  });

  // AC-3.6
  it('emits queued -> snapshot -> agent -> writing -> done, each carrying its jobId', async () => {
    const { root } = makeProject();
    const bridge = createBridge({ root, agent: createFakeAgent({ mode: 'correct' }) });

    const events: ProgressEvent[] = [];
    bridge.progress.subscribe((event) => events.push(event));

    const [result] = await bridge.apply({ intents: [makeIntent()] });

    expect(phaseOrder(events)).toEqual(['queued', 'snapshot', 'agent', 'writing', 'done']);
    expect(new Set(events.map((event) => event.jobId))).toEqual(new Set([result!.jobId]));
    bridge.close();
  });

  it('skips the writing phase when nothing was written', async () => {
    const { root } = makeProject();
    const bridge = createBridge({ root, agent: createFakeAgent({ mode: 'blocked' }) });

    const events: ProgressEvent[] = [];
    bridge.progress.subscribe((event) => events.push(event));
    await bridge.apply({ intents: [makeIntent()] });

    expect(phaseOrder(events)).toEqual(['queued', 'snapshot', 'agent', 'done']);
    bridge.close();
  });

  it('drops a subscriber that unsubscribes, without disturbing the rest', async () => {
    const { root } = makeProject();
    const bridge = createBridge({ root, agent: createFakeAgent({ mode: 'noop' }) });

    const kept: ProgressEvent[] = [];
    const dropped: ProgressEvent[] = [];
    bridge.progress.subscribe((event) => kept.push(event));
    const unsubscribe = bridge.progress.subscribe((event) => dropped.push(event));
    expect(bridge.progress.listenerCount).toBe(2);

    unsubscribe();
    expect(bridge.progress.listenerCount).toBe(1);

    await bridge.apply({ intents: [makeIntent()] });
    expect(kept.length).toBeGreaterThan(0);
    expect(dropped).toEqual([]);
    bridge.close();
  });
});
