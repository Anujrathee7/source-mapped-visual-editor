// @vitest-environment jsdom
/**
 * The verification loop, driven from outside the document (AC-12.1, AC-12.3).
 *
 * v1 ran these six steps inside the page, where every one of them was a function call. In
 * the studio the page is a frame the chrome cannot reach into, so each step is a round
 * trip — and step 3, lifting the override before reading, is the one that still carries
 * all the weight. The trap test below is the whole reason this file exists: a loop that
 * read the DOM with the override still applied would report `landed` every single time.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { EditIntent, EditResult } from '@sve/protocol';
import { runVerification } from '../src/client/loop.js';
import { DRIFTED_MESSAGE, STALLED_MESSAGE } from '../src/client/verdicts.js';
import { H1_ANCHOR, H1_EID, H1_LOC, settle } from './fixture.js';
import { wirePreview, type Wire } from './support.js';

let wire: Wire | null = null;

afterEach(() => {
  wire?.dispose();
  wire = null;
});

/** What React does on the far side of a write that landed. */
function rerender(text: string): void {
  const el = document.querySelector(`[data-sve-eid="${H1_EID}"]`);
  if (el?.firstChild) el.firstChild.nodeValue = text;
}

interface Scripted {
  apply(intent: EditIntent): Promise<EditResult>;
  readonly sent: EditIntent[];
}

function scripted(
  result: EditResult | ((intent: EditIntent) => EditResult),
  onApply?: () => void,
): Scripted {
  const sent: EditIntent[] = [];
  return {
    sent,
    async apply(intent) {
      sent.push(intent);
      onApply?.();
      return typeof result === 'function' ? result(intent) : result;
    },
  };
}

async function prepare(text = 'Ship faster'): Promise<{ wire: Wire; intent: EditIntent }> {
  const w = await wirePreview({ timeoutMs: 1000 });
  wire = w;
  await w.controller.select(H1_ANCHOR);
  await settle();
  await w.controller.setOverride(H1_EID, { text });
  await settle();
  const intent = await w.controller.captureIntent('text');
  if (!intent) throw new Error('no intent was captured');
  return { wire: w, intent };
}

describe('the six steps', () => {
  it('reports landed when the page renders what the intent asked for', async () => {
    const { wire: w, intent } = await prepare();
    const bridge = scripted({ jobId: 'job_1', status: 'landed' }, () => rerender('Ship faster'));

    const outcome = await runVerification(intent, {
      target: w.controller.target,
      apply: bridge.apply,
      applied: { text: 'Ship faster' },
    });

    expect(outcome.verdict.status).toBe('landed');
    expect(outcome.jobId).toBe('job_1');
    expect(outcome.wrote).toBe(true);
    // The source now says it, so the illusion has nothing left to do.
    expect(await w.controller.getOverride(H1_EID)).toBeNull();
  });

  it('reports drifted, with both sides, when the page renders something else', async () => {
    const { wire: w, intent } = await prepare();
    const bridge = scripted({ jobId: 'job_2', status: 'landed' }, () => rerender('Ship Faster'));

    const outcome = await runVerification(intent, {
      target: w.controller.target,
      apply: bridge.apply,
      applied: { text: 'Ship faster' },
    });

    expect(outcome.verdict.status).toBe('drifted');
    expect(outcome.verdict.message).toBe(DRIFTED_MESSAGE);
    expect(outcome.verdict.mismatch).toEqual([
      { prop: 'text', intent: 'Ship faster', rendered: 'Ship Faster' },
    ]);
    // AC-5.6: the user asked for something and has not got it.
    expect(await w.controller.getOverride(H1_EID)).toEqual({ text: 'Ship faster' });
  });

  it('does not read its own paint back — an unchanged page is drift, not a pass', async () => {
    const { wire: w, intent } = await prepare();
    // The bridge claims it wrote; nothing re-rendered. With the override still applied the
    // DOM would read exactly as the intent, which is the failure this asserts against.
    const bridge = scripted({ jobId: 'job_3', status: 'landed' });

    const outcome = await runVerification(intent, {
      target: w.controller.target,
      apply: bridge.apply,
      applied: { text: 'Ship faster' },
    });

    expect(outcome.verdict.status).toBe('drifted');
  });

  it('reports stalled when hot reload never arrives', async () => {
    const { wire: w, intent } = await prepare();
    w.setSettled(false);
    const bridge = scripted({ jobId: 'job_4', status: 'landed' });

    const outcome = await runVerification(intent, {
      target: w.controller.target,
      apply: bridge.apply,
      applied: { text: 'Ship faster' },
    });

    expect(outcome.verdict.status).toBe('stalled');
    expect(outcome.verdict.message).toBe(STALLED_MESSAGE);
  });

  it('passes a refusal through with the reason the bridge gave', async () => {
    const { wire: w, intent } = await prepare();
    const bridge = scripted({
      jobId: 'job_5',
      status: 'blocked',
      message: 'The agent found no plain string literal at src/Hero.tsx:3:5.',
    });

    const outcome = await runVerification(intent, {
      target: w.controller.target,
      apply: bridge.apply,
      applied: { text: 'Ship faster' },
    });

    expect(outcome.verdict.status).toBe('blocked');
    expect(outcome.verdict.message).toBe(
      'The agent found no plain string literal at src/Hero.tsx:3:5.',
    );
    expect(outcome.wrote).toBe(false);
    expect(await w.controller.getOverride(H1_EID)).toEqual({ text: 'Ship faster' });
  });

  it('turns a transport failure into a verdict rather than an exception', async () => {
    const { wire: w, intent } = await prepare();

    const outcome = await runVerification(intent, {
      target: w.controller.target,
      apply: async () => {
        throw new Error('/api/apply answered 500');
      },
      applied: { text: 'Ship faster' },
    });

    expect(outcome.verdict.status).toBe('error');
    expect(outcome.verdict.message).toContain('/api/apply answered 500');
  });
});

describe('re-anchoring', () => {
  it('sends the loc the page carries now, not the one recorded at capture', async () => {
    const { wire: w, intent } = await prepare();
    // The previous job's write moved every line below it, and the page has been re-stamped.
    document
      .querySelector(`[data-sve-eid="${H1_EID}"]`)
      ?.setAttribute('data-sve-loc', 'src/Hero.tsx:9:5');

    const bridge = scripted({ jobId: 'job_6', status: 'landed' }, () => rerender('Ship faster'));
    await runVerification(intent, {
      target: w.controller.target,
      apply: bridge.apply,
      applied: { text: 'Ship faster' },
    });

    expect(intent.loc).toBe(H1_LOC);
    expect(bridge.sent[0]?.loc).toBe('src/Hero.tsx:9:5');
  });
});
