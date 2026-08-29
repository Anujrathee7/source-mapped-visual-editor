// @vitest-environment jsdom
/**
 * AC-12.3 — the change log is the recap.
 *
 * One row per intent, newest first, each carrying the live verdict. The two assertions
 * that matter most are the ones about *not* moving: a row resolving must not reorder the
 * log (AC-12.7 asks for no layout shift, and a reorder is the largest one there is), and a
 * reverted row must never read `landed`, because nothing landed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { APPLY_LABELS } from '@sve/overlay';
import { REVERTED_MESSAGE } from '../src/client/verdicts.js';
import { H1_ANCHOR, H1_EID, P_EID, SECTION_EID, settle } from './fixture.js';
import { createHarness, type Harness } from './harness.js';

let h: Harness | null = null;

afterEach(() => {
  h?.dispose();
  h = null;
});

async function applyText(harness: Harness, text: string): Promise<string> {
  await harness.wire.controller.select(H1_ANCHOR);
  await settle();
  await harness.wire.controller.setOverride(H1_EID, { text });
  await settle();
  const intent = await harness.wire.controller.captureIntent('text');
  if (!intent) throw new Error('no intent was captured');
  const outcome = await harness.workspace.applyIntent(intent, 'preview');
  // `error` is the harness having broken, not a verdict this file is ever about.
  if (outcome.verdict.status === 'error') throw new Error(outcome.verdict.message ?? 'error');
  return outcome.rowId;
}

describe('the log', () => {
  it('opens a row the moment Apply is pressed, before any verdict exists', async () => {
    h = await createHarness();
    await h.wire.controller.select(H1_ANCHOR);
    await settle();
    await h.wire.controller.setOverride(H1_EID, { text: 'Ship faster' });
    await settle();
    const intent = await h.wire.controller.captureIntent('text');

    const pending = h.workspace.applyIntent(intent!, 'preview');
    expect(h.workspace.log.rows()[0]?.status).toBe('applying');
    expect(APPLY_LABELS[h.workspace.log.rows()[0]!.status]).toBe('Applying…');

    await pending;
    expect(h.workspace.log.rows()[0]?.status).toBe('landed');
  });

  it('names the element, the coordinate and what changed', async () => {
    h = await createHarness();
    await applyText(h, 'Ship faster');

    const row = h.workspace.log.rows()[0];
    expect(row?.eid).toBe(H1_EID);
    expect(row?.tag).toBe('h1');
    expect(row?.loc).toMatch(/^src\/Hero\.tsx:\d+:\d+$/);
    expect(row?.summary).toContain('Ship faster');
    expect(row?.kind).toBe('text');
  });

  it('is newest first, and resolving a row does not move the ones below it', async () => {
    h = await createHarness();
    const first = await applyText(h, 'Ship faster');
    const second = await applyText(h, 'Ship sooner');

    expect(h.workspace.log.rows().map((row) => row.id)).toEqual([second, first]);

    // A verdict arriving late must change the row in place and nothing else.
    const orderBefore = h.workspace.log.rows().map((row) => row.id);
    h.workspace.log.resolve(first, {
      jobId: 'job_x',
      wrote: true,
      verdict: { status: 'drifted', message: 'later' },
    });
    expect(h.workspace.log.rows().map((row) => row.id)).toEqual(orderBefore);
    expect(h.workspace.log.row(first)?.status).toBe('drifted');
  });

  it('shows a drifted row as intent versus rendered, both sides', async () => {
    h = await createHarness({ mode: 'wrong' });
    const id = await applyText(h, 'Ship faster');

    const row = h.workspace.log.row(id);
    expect(row?.status).toBe('drifted');
    expect(row?.mismatch?.[0]).toMatchObject({ prop: 'text', intent: 'Ship faster' });
    expect(row?.mismatch?.[0]?.rendered).not.toBe('Ship faster');
  });

  it('survives a preview reload — it is session state, not page state', async () => {
    h = await createHarness();
    const id = await applyText(h, 'Ship faster');

    // The frame reloaded: a fresh boot, a fresh document, a fresh overlay.
    h.wire.preview.server.ready();
    await settle();

    expect(h.wire.controller.status).toBe('connected');
    expect(h.workspace.log.rows().map((row) => row.id)).toEqual([id]);
    expect(h.workspace.log.row(id)?.status).toBe('landed');
  });
});

describe('selecting a row', () => {
  it('selects its element in the preview', async () => {
    h = await createHarness();
    const id = await applyText(h, 'Ship faster');
    // Somewhere else entirely, so the selection has to actually move.
    await h.wire.controller.select({ eid: SECTION_EID, eidIndex: 0 });
    await settle();
    expect(h.wire.overlay.selection?.eid).toBe(SECTION_EID);

    await h.workspace.selectRow(id);
    await settle();

    expect(h.wire.overlay.selection?.eid).toBe(H1_EID);
  });

  it('does nothing for a row whose element the page no longer offers', async () => {
    h = await createHarness();
    const id = h.workspace.log.start({
      intent: {
        eid: P_EID,
        eidIndex: 9,
        loc: 'src/Hero.tsx:6:5',
        tag: 'p',
        kind: 'text',
        before: { text: '', classes: [], computed: {} },
        after: { text: '', classes: [], computed: {} },
        instruction: 'nothing',
      },
      origin: 'preview',
    });

    await expect(h.workspace.selectRow(id)).resolves.toBeUndefined();
  });
});

describe('revert', () => {
  it('restores the file byte for byte and marks the row reverted, never landed', async () => {
    h = await createHarness();
    const before = h.project.snapshot();
    const id = await applyText(h, 'Ship faster');

    expect(h.project.changedSince(before)).toContain('src/Hero.tsx');
    expect(h.workspace.log.row(id)?.revertable).toBe(true);

    await h.workspace.revertRow(id);
    await settle();

    expect(h.project.changedSince(before)).toEqual([]);
    expect(h.workspace.log.row(id)?.status).toBe('reverted');
    expect(h.workspace.log.row(id)?.message).toBe(REVERTED_MESSAGE);
    expect(APPLY_LABELS[h.workspace.log.row(id)!.status]).toBe('Reverted');
  });

  it('takes the override off the page as well, so the element is what the file renders', async () => {
    h = await createHarness();
    const id = await applyText(h, 'Ship faster');

    await h.workspace.revertRow(id);
    await settle();

    expect(h.wire.overlay.getOverride(H1_EID)).toBeUndefined();
    expect(h.workspace.log.row(id)?.revertable).toBe(false);
  });

  it('is not offered for a row that never reached disk', async () => {
    h = await createHarness({ mode: 'blocked' });
    const id = await applyText(h, 'Ship faster');

    expect(h.workspace.log.row(id)?.status).toBe('blocked');
    expect(h.workspace.log.row(id)?.revertable).toBe(false);

    await h.workspace.revertRow(id);
    expect(h.workspace.log.row(id)?.status).toBe('blocked');
  });

  it('is offered after drift, because the file is left as the agent wrote it', async () => {
    h = await createHarness({ mode: 'wrong' });
    const id = await applyText(h, 'Ship faster');

    expect(h.workspace.log.row(id)?.status).toBe('drifted');
    expect(h.workspace.log.row(id)?.revertable).toBe(true);
  });
});

describe('the queue', () => {
  it('runs whole loops one at a time, so the second never targets a stale line', async () => {
    h = await createHarness({ mode: 'verbose' });
    await applyText(h, 'Ship faster');
    await applyText(h, 'Ship sooner');

    const sent = h.apply.mock.calls.map(([intent]) => intent.loc);
    expect(sent).toHaveLength(2);
    // The first write added a line above the element, so the second intent must not carry
    // the coordinate the first one used.
    expect(sent[1]).not.toBe(sent[0]);
  });
});
