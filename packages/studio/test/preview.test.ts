// @vitest-environment jsdom
/**
 * AC-12.4 — the preview.
 *
 * The project renders in a frame the studio cannot reach into, so everything here goes
 * over `@sve/rpc`: the click that selects, the coordinate that comes back, and the
 * disconnection that must be a state rather than a hang.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  CLASS_DYNAMIC_REASON,
  TEXT_EXPRESSION_REASON,
  TEXT_EMPTY_REASON,
} from '@sve/overlay';
import { RPC_METHOD_NAMES } from '@sve/rpc';
import { overlayHandlers } from '../src/preview/serve.js';
import { fieldStates } from '../src/client/fields.js';
import {
  FILE,
  H1_ANCHOR,
  H1_EID,
  H1_LOC,
  ORPHAN_EID,
  P_EID,
  SECTION_EID,
  SOURCE,
  settle,
} from './fixture.js';
import { clickIn, wirePreview, type Wire } from './support.js';

let wire: Wire | null = null;

afterEach(() => {
  wire?.dispose();
  wire = null;
});

describe('the remote surface', () => {
  it('answers every method the wire declares', () => {
    const handlers = overlayHandlers({
      overlay: null as never,
      state: () => null as never,
      watchForUpdate: async () => true,
    });
    for (const method of RPC_METHOD_NAMES) {
      expect(typeof handlers[method]).toBe('function');
    }
  });
});

describe('selecting', () => {
  it('tells the studio which element was clicked in the frame', async () => {
    wire = await wirePreview();

    clickIn(`[data-sve-eid="${H1_EID}"]`);
    await settle();

    expect(wire.controller.state?.anchor?.eid).toBe(H1_EID);
    expect(wire.controller.state?.anchor?.tag).toBe('h1');
    expect(wire.controller.state?.anchor?.loc).toBe(H1_LOC);
  });

  it('selects an element the studio knows only by id', async () => {
    wire = await wirePreview();

    await wire.controller.select(H1_ANCHOR);
    await settle();

    expect(wire.overlay.selection?.eid).toBe(H1_EID);
    expect(wire.controller.state?.anchor?.eid).toBe(H1_EID);
  });

  it('deselects, the way clicking off the page does', async () => {
    wire = await wirePreview();
    await wire.controller.select(H1_ANCHOR);
    await settle();

    await wire.controller.select(null);
    await settle();

    expect(wire.overlay.selection).toBeNull();
    expect(wire.controller.state?.anchor).toBeNull();
  });

  it('notices a selection made with the keyboard', async () => {
    wire = await wirePreview();
    const section = document.querySelector(`[data-sve-eid="${SECTION_EID}"]`);
    section?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await settle();

    expect(wire.controller.state?.anchor?.eid).toBe(SECTION_EID);
  });
});

describe('the diagnostic', () => {
  it('puts the caret under the exact column, checked against the file itself', async () => {
    wire = await wirePreview();
    await wire.controller.select(H1_ANCHOR);
    await settle();

    const excerpt = wire.controller.state?.excerpt;
    expect(excerpt).not.toBeNull();
    // `H1_LOC` is line 3, column 5.
    expect(excerpt?.caret.line).toBe(3);
    expect(excerpt?.caret.column).toBe(5);
    expect(excerpt?.caret.offset).toBe(4);
    expect(excerpt?.caret.pad).toBe('    ');

    const target = excerpt?.lines.find((line) => line.isTarget);
    expect(target?.number).toBe(3);
    expect(target?.text).toBe(SOURCE.split('\n')[2]);
    // The character the caret points at, read out of the source rather than assumed.
    expect(target?.text[excerpt!.caret.offset]).toBe('<');
  });

  it('names the file and the coordinate', async () => {
    wire = await wirePreview();
    await wire.controller.select(H1_ANCHOR);
    await settle();

    expect(wire.controller.state?.anchor?.loc).toBe(`${FILE}:3:5`);
  });

  it('says so when the source cannot be read, rather than drawing an empty strip', async () => {
    wire = await wirePreview();
    await wire.controller.select({ eid: ORPHAN_EID, eidIndex: 0 });
    await settle();

    expect(wire.controller.state?.excerpt).toBeNull();
    expect(wire.controller.state?.sourceMessage).toMatch(/Source unavailable/);
  });
});

describe('the fields', () => {
  it('carries the values the overlay reports', async () => {
    wire = await wirePreview();
    await wire.controller.select(H1_ANCHOR);
    await settle();

    expect(wire.controller.state?.textValue).toBe('Swim today');
    expect(wire.controller.state?.classValue).toBe('title');
    expect(wire.controller.state?.canApply).toBe(false);
  });

  it('reflects an override the studio set, and offers Apply once there is one', async () => {
    wire = await wirePreview();
    await wire.controller.select(H1_ANCHOR);
    await settle();

    await wire.controller.setOverride(H1_EID, { text: 'Ship faster' });
    await settle();

    expect(wire.controller.state?.textValue).toBe('Ship faster');
    expect(wire.controller.state?.canApply).toBe(true);
  });

  it('keeps the AC-4.7 reasons verbatim, from one definition', async () => {
    wire = await wirePreview();
    await wire.controller.select({ eid: P_EID, eidIndex: 0 });
    await settle();

    const anchor = wire.controller.state?.anchor;
    expect(anchor).not.toBeNull();
    const states = fieldStates(anchor!);
    expect(states.text.reason).toBe(TEXT_EXPRESSION_REASON);
    expect(states.class.reason).toBe(CLASS_DYNAMIC_REASON);
    // A dynamic className disables the class editor and nothing else.
    expect(states.style.disabled).toBe(false);
  });

  it('says an element renders no text of its own, in the same words', async () => {
    wire = await wirePreview();
    await wire.controller.select({ eid: SECTION_EID, eidIndex: 0 });
    await settle();

    expect(fieldStates(wire.controller.state!.anchor!).text.reason).toBe(TEXT_EMPTY_REASON);
  });
});

describe('disconnection', () => {
  it('says the preview is gone rather than hanging', async () => {
    wire = await wirePreview({ timeoutMs: 30 });
    expect(wire.controller.status).toBe('connected');

    // The document went away: nothing answers any more.
    wire.preview.dispose();

    await expect(wire.controller.select(H1_ANCHOR)).rejects.toThrow();
    expect(wire.controller.status).toBe('disconnected');
    expect(wire.controller.lastError).toMatch(/preview|timeout|did not answer/i);
  });

  it('reconnects when the frame announces a fresh boot', async () => {
    wire = await wirePreview({ timeoutMs: 30 });
    wire.controller.disconnect('the preview navigated');
    expect(wire.controller.status).toBe('disconnected');

    wire.preview.server.ready();
    await settle();

    expect(wire.controller.status).toBe('connected');
  });
});
