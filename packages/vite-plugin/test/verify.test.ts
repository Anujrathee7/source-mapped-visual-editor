// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditIntent, EditResult, Snapshot } from '@sve/protocol';
import type { Override } from '@sve/overlay';
import {
  DRIFTED_MESSAGE,
  MISSING_MESSAGE,
  STALLED_MESSAGE,
  compareToIntent,
  questionedComputed,
  reanchorIntent,
  runVerification,
  watchForUpdate,
  type LoopTarget,
  type UpdateWatch,
} from '../src/client/verify.js';

/* ── fixtures ─────────────────────────────────────────────────────────────── */

const EID = 'src/components/Hero.tsx#Hero/section:0/div:0/h1:0';

const computed = (over: Record<string, string> = {}): Snapshot['computed'] =>
  ({ color: 'rgb(11, 37, 43)', fontSize: '40px', width: '600px', ...over }) as Snapshot['computed'];

function makeIntent(over: Partial<EditIntent> = {}): EditIntent {
  return {
    eid: EID,
    eidIndex: 0,
    loc: 'src/components/Hero.tsx:17:11',
    tag: 'h1',
    kind: 'text',
    before: { text: 'Four of six beaches are swimmable.', classes: ['title'], computed: computed() },
    after: { text: 'Ship faster', classes: ['title'], computed: computed() },
    instruction: 'Replace the text.',
    ...over,
  };
}

const landed = (over: Partial<EditResult> = {}): EditResult => ({
  jobId: 'job_1',
  status: 'landed',
  diff: '- old\n+ new',
  ...over,
});

/**
 * A stand-in for the overlay handle, recording the order of the calls the loop makes.
 *
 * The order is the point. `readSnapshot` answers from `rendered`, which is what React put
 * on the page — but only once `liftOverride` has run. Before that it answers with the
 * override still painted over it, exactly as a real DOM read would, which is what makes
 * the lift-before-read step observable rather than assumed.
 */
function makeTarget(options: {
  rendered: Snapshot | null;
  override?: Override;
  loc?: string;
}): LoopTarget & {
  calls: string[];
  overrides: Map<string, Override>;
  verdicts: Array<{ eid: string; verdict: unknown }>;
  phases: string[];
} {
  const calls: string[] = [];
  const overrides = new Map<string, Override>();
  const verdicts: Array<{ eid: string; verdict: unknown }> = [];
  const phases: string[] = [];
  if (options.override) overrides.set(EID, options.override);

  const element = document.createElement('h1');
  element.setAttribute('data-sve-eid', EID);
  element.setAttribute('data-sve-loc', options.loc ?? 'src/components/Hero.tsx:17:11');

  return {
    calls,
    overrides,
    verdicts,
    phases,

    resolveAnchor: () => {
      calls.push('resolveAnchor');
      return options.rendered === null ? null : element;
    },

    readSnapshot: () => {
      calls.push('readSnapshot');
      if (options.rendered === null) return null;
      const held = overrides.get(EID);
      // While the override is applied, the page shows the override — that is the illusion
      // the loop exists to stop measuring.
      return held?.text === undefined ? options.rendered : { ...options.rendered, text: held.text };
    },

    liftOverride: (eid) => {
      calls.push('liftOverride');
      const held = overrides.get(eid);
      overrides.delete(eid);
      return held;
    },

    restoreOverride: (eid, override) => {
      calls.push('restoreOverride');
      overrides.set(eid, override);
    },

    refresh: () => {
      calls.push('refresh');
    },

    setPhase: (phase) => {
      phases.push(phase);
    },

    setVerdict: (eid, verdict) => {
      verdicts.push({ eid, verdict });
    },
  };
}

const alwaysUpdated = (): UpdateWatch => ({ settled: Promise.resolve(true), cancel: () => {} });
const neverUpdated = (): UpdateWatch => ({ settled: Promise.resolve(false), cancel: () => {} });

/* ── what the intent actually asks ────────────────────────────────────────── */

describe('questionedComputed', () => {
  it('asks nothing of computed values for a text edit', () => {
    // A longer heading is a wider heading. Reading that as drift would fail every text
    // edit that changed the word count, which is all of them.
    const intent = makeIntent({
      before: { text: 'a', classes: [], computed: computed({ width: '100px' }) },
      after: { text: 'a much longer heading', classes: [], computed: computed({ width: '600px' }) },
    });
    expect(questionedComputed(intent)).toEqual({});
  });

  it('asks only about the properties the edit itself changed', () => {
    const intent = makeIntent({
      kind: 'class',
      before: { text: 'Safe', classes: ['a'], computed: computed({ color: 'rgb(1, 1, 1)' }) },
      after: { text: 'Safe', classes: ['b'], computed: computed({ color: 'rgb(2, 2, 2)' }) },
    });
    expect(questionedComputed(intent)).toEqual({ color: 'rgb(2, 2, 2)' });
  });
});

describe('compareToIntent', () => {
  it('reports a text difference with both sides', () => {
    const intent = makeIntent();
    const mismatch = compareToIntent(intent, {
      text: 'Ship Faster',
      classes: ['title'],
      computed: computed(),
    });
    expect(mismatch).toEqual([{ prop: 'text', intent: 'Ship faster', rendered: 'Ship Faster' }]);
  });

  it('ignores JSX indentation, which is whitespace and not a change', () => {
    const intent = makeIntent();
    expect(
      compareToIntent(intent, { text: '\n  Ship faster\n', classes: [], computed: computed() }),
    ).toEqual([]);
  });

  // AC-5.3, in the small: the class list the agent wrote is never compared as text.
  it('accepts a class list that differs from the one sent, when the colour resolves the same', () => {
    const intent = makeIntent({
      kind: 'class',
      before: { text: 'Safe', classes: ['text-kelp'], computed: computed({ color: 'rgb(1, 1, 1)' }) },
      after: { text: 'Safe', classes: ['text-flare'], computed: computed({ color: 'rgb(255, 90, 31)' }) },
    });
    const mismatch = compareToIntent(intent, {
      text: 'Safe',
      classes: ['text-[#ff5a1f]'],
      computed: computed({ color: '#ff5a1f' }),
    });
    expect(mismatch).toEqual([]);
  });

  it('rejects a plausible class that resolves to a different colour', () => {
    const intent = makeIntent({
      kind: 'class',
      before: { text: 'Safe', classes: ['text-kelp'], computed: computed({ color: 'rgb(1, 1, 1)' }) },
      after: { text: 'Safe', classes: ['text-flare'], computed: computed({ color: 'rgb(255, 90, 31)' }) },
    });
    const mismatch = compareToIntent(intent, {
      text: 'Safe',
      classes: ['text-flare-alt'],
      computed: computed({ color: 'rgb(217, 169, 44)' }),
    });
    expect(mismatch).toEqual([
      { prop: 'color', intent: 'rgb(255, 90, 31)', rendered: 'rgb(217, 169, 44)' },
    ]);
  });

  it('reports an element that never came back rather than passing it', () => {
    expect(compareToIntent(makeIntent(), null)).toEqual([
      { prop: 'element', intent: 'src/components/Hero.tsx:17:11', rendered: MISSING_MESSAGE },
    ]);
  });
});

/* ── re-anchoring (AC-5.4, AC-5.9) ────────────────────────────────────────── */

describe('reanchorIntent', () => {
  it('takes the loc from the live DOM, so an earlier write cannot leave it stale', () => {
    const target = makeTarget({ rendered: null, loc: 'src/components/Hero.tsx:18:11' });
    // `rendered: null` would refuse the element, so give it one that exists.
    const withElement = makeTarget({
      rendered: { text: '', classes: [], computed: computed() },
      loc: 'src/components/Hero.tsx:18:11',
    });
    expect(reanchorIntent(makeIntent(), withElement).loc).toBe('src/components/Hero.tsx:18:11');
    expect(reanchorIntent(makeIntent(), target).loc).toBe('src/components/Hero.tsx:17:11');
  });

  it('keeps the recorded loc when the DOM offers nothing better', () => {
    const target = makeTarget({ rendered: { text: '', classes: [], computed: computed() } });
    expect(reanchorIntent(makeIntent(), target).loc).toBe('src/components/Hero.tsx:17:11');
  });
});

/* ── the loop ─────────────────────────────────────────────────────────────── */

describe('runVerification', () => {
  it('lifts the override before it reads the DOM', async () => {
    const target = makeTarget({
      rendered: { text: 'Ship faster', classes: ['title'], computed: computed() },
      override: { text: 'Ship faster' },
    });

    await runVerification(makeIntent(), {
      target,
      apply: async () => landed(),
      watch: alwaysUpdated,
    });

    const lift = target.calls.indexOf('liftOverride');
    const read = target.calls.indexOf('readSnapshot');
    expect(lift).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(lift);
    // And the re-anchor comes before both, because the element the loop reads has to be
    // the one hot reload just put on the page.
    expect(target.calls.indexOf('resolveAnchor')).toBeLessThan(lift);
  });

  it('reports landed and leaves the override lifted', async () => {
    const target = makeTarget({
      rendered: { text: 'Ship faster', classes: ['title'], computed: computed() },
      override: { text: 'Ship faster' },
    });

    const outcome = await runVerification(makeIntent(), {
      target,
      apply: async () => landed(),
      watch: alwaysUpdated,
    });

    expect(outcome.verdict.status).toBe('landed');
    expect(outcome.wrote).toBe(true);
    expect(outcome.jobId).toBe('job_1');
    expect(target.overrides.has(EID)).toBe(false);
    expect(target.phases).toContain('applying');
  });

  /**
   * The criterion this whole milestone turns on. The agent wrote `Ship Faster`; the
   * override still says `Ship faster`. A loop that reads the DOM without lifting reads its
   * own override back and calls it landed — so if this test ever goes green while
   * `liftOverride` is commented out, the verifier is theatre.
   */
  it('reports drifted, shows both sides, and puts the override back', async () => {
    const target = makeTarget({
      rendered: { text: 'Ship Faster', classes: ['title'], computed: computed() },
      override: { text: 'Ship faster' },
    });

    const outcome = await runVerification(makeIntent(), {
      target,
      apply: async () => landed(),
      watch: alwaysUpdated,
    });

    expect(outcome.verdict.status).toBe('drifted');
    expect(outcome.verdict.message).toBe(DRIFTED_MESSAGE);
    expect(outcome.verdict.mismatch).toEqual([
      { prop: 'text', intent: 'Ship faster', rendered: 'Ship Faster' },
    ]);
    // The user still sees what they asked for.
    expect(target.overrides.get(EID)).toEqual({ text: 'Ship faster' });
    expect(target.calls.indexOf('restoreOverride')).toBeGreaterThan(
      target.calls.indexOf('readSnapshot'),
    );
    // The agent did write, so the snapshot is worth offering back.
    expect(outcome.wrote).toBe(true);
  });

  // AC-5.6
  it('keeps the override applied when the agent refuses', async () => {
    const target = makeTarget({
      rendered: { text: 'unchanged', classes: [], computed: computed() },
      override: { text: 'Ship faster' },
    });

    const outcome = await runVerification(makeIntent(), {
      target,
      apply: async () => ({ jobId: 'job_2', status: 'blocked', message: 'BLOCKED: not that line' }),
      watch: alwaysUpdated,
    });

    expect(outcome.verdict.status).toBe('blocked');
    expect(outcome.verdict.message).toContain('not that line');
    expect(target.overrides.get(EID)).toEqual({ text: 'Ship faster' });
    expect(target.calls).not.toContain('liftOverride');
    expect(outcome.wrote).toBe(false);
  });

  // AC-5.7 — the bridge already knows nothing was written.
  it('reports stalled, and says the file did not change', async () => {
    const target = makeTarget({
      rendered: { text: 'unchanged', classes: [], computed: computed() },
      override: { text: 'Ship faster' },
    });

    const outcome = await runVerification(makeIntent(), {
      target,
      apply: async () => ({ jobId: 'job_3', status: 'stalled', message: 'wrote nothing' }),
      watch: alwaysUpdated,
    });

    expect(outcome.verdict.status).toBe('stalled');
    expect(outcome.verdict.message).toContain(STALLED_MESSAGE);
    expect(target.overrides.get(EID)).toEqual({ text: 'Ship faster' });
  });

  // AC-5.7 — the other half: the write landed but nothing ever re-rendered.
  it('reports stalled rather than waiting forever when hot reload never fires', async () => {
    const target = makeTarget({
      rendered: { text: 'Ship faster', classes: [], computed: computed() },
      override: { text: 'Ship faster' },
    });

    const outcome = await runVerification(makeIntent(), {
      target,
      apply: async () => landed(),
      watch: neverUpdated,
    });

    expect(outcome.verdict.status).toBe('stalled');
    expect(outcome.verdict.message).toBe(STALLED_MESSAGE);
    expect(target.calls).not.toContain('readSnapshot');
  });

  it('reports an error rather than throwing when the bridge is unreachable', async () => {
    const target = makeTarget({ rendered: null, override: { text: 'Ship faster' } });

    const outcome = await runVerification(makeIntent(), {
      target,
      apply: async () => {
        throw new Error('Failed to fetch');
      },
      watch: alwaysUpdated,
    });

    expect(outcome.verdict.status).toBe('error');
    expect(outcome.verdict.message).toContain('Failed to fetch');
    expect(target.overrides.get(EID)).toEqual({ text: 'Ship faster' });
  });

  it('does not silently pass an element hot reload never brought back', async () => {
    const target = makeTarget({ rendered: null, override: { text: 'Ship faster' } });

    const outcome = await runVerification(makeIntent(), {
      target,
      apply: async () => landed(),
      watch: alwaysUpdated,
    });

    expect(outcome.verdict.status).toBe('drifted');
    expect(target.overrides.get(EID)).toEqual({ text: 'Ship faster' });
  });
});

/* ── waiting for hot reload ───────────────────────────────────────────────── */

interface FakeHot {
  on(event: string, handler: () => void): void;
  off(event: string, handler: () => void): void;
  fire(event: string): void;
  listeners: number;
}

function fakeHot(): FakeHot {
  const handlers = new Map<string, Set<() => void>>();
  return {
    on(event, handler) {
      const set = handlers.get(event) ?? new Set();
      handlers.set(event, set);
      set.add(handler);
    },
    off(event, handler) {
      handlers.get(event)?.delete(handler);
    },
    fire(event) {
      for (const handler of [...(handlers.get(event) ?? [])]) handler();
    },
    get listeners() {
      return [...handlers.values()].reduce((total, set) => total + set.size, 0);
    },
  };
}

describe('watchForUpdate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Frames run when asked, so "two rAFs" is a thing the test can count. */
  function frames(): { raf: (cb: () => void) => void; flush(): void; pending: number } {
    let queue: Array<() => void> = [];
    return {
      raf: (cb) => {
        queue.push(cb);
      },
      flush() {
        const due = queue;
        queue = [];
        for (const cb of due) cb();
      },
      get pending() {
        return queue.length;
      },
    };
  }

  it('waits for the update, then two frames, before saying the page has settled', async () => {
    const hot = fakeHot();
    const frame = frames();
    const watch = watchForUpdate({ hot, raf: frame.raf, timeoutMs: 5000, settleMs: 100 });

    let resolved: boolean | null = null;
    void watch.settled.then((value) => {
      resolved = value;
    });

    hot.fire('vite:afterUpdate');
    await vi.advanceTimersByTimeAsync(100);

    expect(frame.pending).toBe(1);
    frame.flush();
    expect(frame.pending).toBe(1);
    expect(resolved).toBeNull();

    frame.flush();
    await Promise.resolve();
    expect(resolved).toBe(true);
    // Listening stops with the watch.
    expect(hot.listeners).toBe(0);
  });

  it('restarts the settle window when a second update arrives', async () => {
    const hot = fakeHot();
    const frame = frames();
    const watch = watchForUpdate({ hot, raf: frame.raf, timeoutMs: 5000, settleMs: 100 });
    let resolved: boolean | null = null;
    void watch.settled.then((value) => {
      resolved = value;
    });

    // One edit, two updates: the module, and then the stylesheet Tailwind regenerated.
    hot.fire('vite:afterUpdate');
    await vi.advanceTimersByTimeAsync(60);
    hot.fire('vite:afterUpdate');
    await vi.advanceTimersByTimeAsync(60);
    expect(frame.pending).toBe(0); // the first window was abandoned, not honoured

    await vi.advanceTimersByTimeAsync(40);
    frame.flush();
    frame.flush();
    await Promise.resolve();
    expect(resolved).toBe(true);
  });

  it('gives up at the timeout rather than waiting forever', async () => {
    const hot = fakeHot();
    const frame = frames();
    const watch = watchForUpdate({ hot, raf: frame.raf, timeoutMs: 5000, settleMs: 100 });

    await expect(
      (async () => {
        const settled = watch.settled;
        await vi.advanceTimersByTimeAsync(5000);
        return settled;
      })(),
    ).resolves.toBe(false);
    expect(hot.listeners).toBe(0);
  });

  it('stops listening when cancelled, so an abandoned edit leaves nothing behind', async () => {
    const hot = fakeHot();
    const watch = watchForUpdate({ hot, raf: (cb) => cb(), timeoutMs: 5000, settleMs: 100 });
    watch.cancel();
    expect(hot.listeners).toBe(0);
    await expect(watch.settled).resolves.toBe(false);
  });

  it('never resolves true without hot reload to wait on', async () => {
    const watch = watchForUpdate({ hot: null, raf: (cb) => cb(), timeoutMs: 200, settleMs: 100 });
    const settled = watch.settled;
    await vi.advanceTimersByTimeAsync(200);
    await expect(settled).resolves.toBe(false);
  });
});
