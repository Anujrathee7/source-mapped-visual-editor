// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { EditIntentSchema, MAX_INSTRUCTION_LENGTH, TRACKED_PROPS } from '@sve/protocol';
import { HOST_ATTR, mountOverlay, type OverlayHandle } from '../src/mount.js';
import { describeEdit } from '../src/intent.js';
import { anchorFor } from '../src/selection.js';
import { CARD_EID, H1_EID, H1_LOC, fetchFixtureSource, renderPage } from './fixture.js';
import { addPageStyle, resetDocument, tick } from './support.js';

let handle: OverlayHandle | null = null;

afterEach(() => {
  handle?.unmount();
  handle = null;
  resetDocument();
});

function overlay(): OverlayHandle {
  renderPage();
  handle = mountOverlay({ fetchSource: fetchFixtureSource });
  return handle!;
}

// AC-4.10
describe('captureIntent', () => {
  it('produces something @sve/protocol accepts, so the bridge has nothing to reject', async () => {
    const o = overlay();
    o.select({ eid: H1_EID, eidIndex: 0 });
    o.restoreOverride(H1_EID, { text: 'Ship faster' });
    await tick();

    const intent = o.captureIntent('text')!;
    expect(EditIntentSchema.safeParse(intent).success).toBe(true);
    expect(intent).toMatchObject({ eid: H1_EID, eidIndex: 0, loc: H1_LOC, tag: 'h1', kind: 'text' });
  });

  // "The intent recorded for an edit is the snapshot taken **with the override applied**."
  it('records after as the overridden result and before as what the page had', async () => {
    const o = overlay();
    o.select({ eid: H1_EID, eidIndex: 0 });
    o.restoreOverride(H1_EID, { text: 'Ship faster' });
    await tick();

    const intent = o.captureIntent('text')!;
    expect(intent.after.text).toBe('Ship faster');
    expect(intent.before.text).toBe('Swim today');
  });

  // The resolved value, not the source syntax: this is what lets AC-5.3 verify a Tailwind
  // class edit against an inline style edit expressing the same change.
  it('records the computed result of a style override, not the declaration written', async () => {
    addPageStyle('.title { color: rgb(14, 17, 22) }');
    const o = overlay();
    o.select({ eid: H1_EID, eidIndex: 0 });
    o.restoreOverride(H1_EID, { style: { color: '#3b82f6' } });
    await tick();

    const intent = o.captureIntent('style')!;
    expect(intent.after.computed.color).toBe('rgb(59, 130, 246)');
    expect(intent.before.computed.color).toBe('rgb(14, 17, 22)');
  });

  it('leaves the override in place afterwards — capturing is not applying', async () => {
    const o = overlay();
    o.select({ eid: H1_EID, eidIndex: 0 });
    o.restoreOverride(H1_EID, { text: 'Ship faster' });
    await tick();

    o.captureIntent('text');
    expect(document.querySelector('h1')!.textContent).toBe('Ship faster');
    expect(o.getOverride(H1_EID)).toEqual({ text: 'Ship faster' });
  });

  it('covers exactly TRACKED_PROPS on both sides', async () => {
    const o = overlay();
    o.select({ eid: H1_EID, eidIndex: 0 });
    o.restoreOverride(H1_EID, { text: 'Ship faster' });
    await tick();

    const intent = o.captureIntent('text')!;
    expect(Object.keys(intent.before.computed)).toEqual([...TRACKED_PROPS]);
    expect(Object.keys(intent.after.computed)).toEqual([...TRACKED_PROPS]);
  });

  it('carries the index of the instance that was selected, not just the eid', async () => {
    const o = overlay();
    o.select({ eid: CARD_EID, eidIndex: 4 });
    o.restoreOverride(CARD_EID, { text: 'edited' });
    await tick();

    expect(o.captureIntent('text')!).toMatchObject({ eid: CARD_EID, eidIndex: 4 });
  });

  it('returns null with nothing selected, or with nothing overridden', async () => {
    const o = overlay();
    expect(o.captureIntent('text')).toBeNull();
    o.select({ eid: H1_EID, eidIndex: 0 });
    await tick();
    expect(o.captureIntent('text')).toBeNull();
  });
});

// The instruction is pasted verbatim into an agent prompt, so it states the change in
// resolved terms and stays inside the protocol's bound.
describe('describeEdit', () => {
  it('names the element, the coordinate and the new text', () => {
    renderPage();
    const anchor = anchorFor(document.querySelector('h1')!, document)!;
    const instruction = describeEdit(anchor, 'text', { text: 'Ship faster' }, {
      text: 'Ship faster',
      classes: ['title'],
      computed: {},
    });
    expect(instruction).toContain('h1');
    expect(instruction).toContain(H1_LOC);
    expect(instruction).toContain('Ship faster');
  });

  it('states a class edit as what was added and what was removed', () => {
    renderPage();
    const anchor = anchorFor(document.querySelector('h1')!, document)!;
    const instruction = describeEdit(
      anchor,
      'class',
      { classes: { add: ['text-6xl'], remove: ['title'] } },
      { text: '', classes: ['text-6xl'], computed: {} },
    );
    expect(instruction).toContain('text-6xl');
    expect(instruction).toContain('title');
  });

  it('states a style edit in resolved values, not in what the user typed', () => {
    renderPage();
    const anchor = anchorFor(document.querySelector('h1')!, document)!;
    const instruction = describeEdit(
      anchor,
      'style',
      { style: { color: '#3b82f6' } },
      { text: '', classes: [], computed: { color: 'rgb(59, 130, 246)' } },
    );
    expect(instruction).toContain('rgb(59, 130, 246)');
  });

  it('stays inside the protocol bound however long the text is', () => {
    renderPage();
    const anchor = anchorFor(document.querySelector('h1')!, document)!;
    const instruction = describeEdit(anchor, 'text', { text: 'x'.repeat(9000) }, {
      text: 'x'.repeat(9000),
      classes: [],
      computed: {},
    });
    expect(instruction.length).toBeLessThanOrEqual(MAX_INSTRUCTION_LENGTH);
    expect(instruction.length).toBeGreaterThan(0);
  });
});

// AC-4.10 read through the mounted overlay: the button hands M6 a parsed intent and does
// nothing else. The network call, the wait for HMR, the lift and the comparison are M6's.
describe('the Apply button is the end of this milestone', () => {
  it('hands the intent to whoever subscribed and makes no request of its own', async () => {
    const o = overlay();
    const seen: unknown[] = [];
    o.onApply((intent) => seen.push(intent));

    o.select({ eid: H1_EID, eidIndex: 0 });
    o.restoreOverride(H1_EID, { text: 'Ship faster' });
    await tick();

    const chrome = document.querySelector(`[${HOST_ATTR}]`)!.shadowRoot!;
    chrome.querySelector<HTMLButtonElement>('.sve-apply')!.click();

    expect(seen).toHaveLength(1);
    expect(EditIntentSchema.safeParse(seen[0]).success).toBe(true);
  });

  it('emits nothing when there is no override to apply', async () => {
    const o = overlay();
    const seen: unknown[] = [];
    o.onApply((intent) => seen.push(intent));
    o.select({ eid: H1_EID, eidIndex: 0 });
    await tick();

    const chrome = document.querySelector(`[${HOST_ATTR}]`)!.shadowRoot!;
    chrome.querySelector<HTMLButtonElement>('.sve-apply')!.click();
    expect(seen).toEqual([]);
  });
});
