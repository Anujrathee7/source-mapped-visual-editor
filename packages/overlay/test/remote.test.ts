// @vitest-environment jsdom
/**
 * AC-8.2 to AC-8.5 — the handle as something a parent frame can drive.
 *
 * v2 renders the page under edit in an iframe on a different origin, so every call the
 * chrome makes into the mechanism becomes a `postMessage`. A method that returns an
 * `HTMLElement` cannot make that trip; neither can a live `OverrideStore`. This suite
 * fixes the shape that can.
 *
 * The last describe is the load-bearing one. It does not spot-check a type or two: it
 * walks `REMOTE_SURFACE` — which the type system forces to name every member of
 * `RemoteOverlay` — and round-trips everything each member sends or receives through
 * `JSON`. A member added later is covered by the same test, or does not compile.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Verdict } from '../src/inspector.js';
import {
  HOST_ATTR,
  REMOTE_SURFACE,
  mountOverlay,
  type OverlayHandle,
  type RemoteOverlay,
} from '../src/mount.js';
import type { Override } from '../src/store.js';
import { CARD_EID, FILE, H1_EID, H1_LOC, fetchFixtureSource, renderPage } from './fixture.js';
import { resetDocument, tick } from './support.js';

let handle: OverlayHandle | null = null;

const mountForTest = (): OverlayHandle => {
  handle = mountOverlay({ fetchSource: fetchFixtureSource });
  if (!handle) throw new Error('expected the overlay to mount');
  return handle;
};

const chrome = (): ShadowRoot => document.querySelector(`[${HOST_ATTR}]`)!.shadowRoot!;

const press = (selector: string): void => {
  chrome().querySelector<HTMLButtonElement>(selector)!.click();
};

afterEach(() => {
  handle?.unmount();
  handle = null;
  resetDocument();
});

// AC-8.2
describe('currentLoc replaces resolveAnchor', () => {
  it('answers with the loc the page carries now, which is all its callers wanted', () => {
    renderPage();
    const overlay = mountForTest();
    expect(overlay.currentLoc(H1_EID, 0)).toBe(H1_LOC);

    // What the agent's write does to every line below it, in miniature.
    document.querySelector('h1')!.setAttribute('data-sve-loc', `${FILE}:9:5`);
    expect(overlay.currentLoc(H1_EID, 0)).toBe(`${FILE}:9:5`);
  });

  it('picks the instance the index names out of a shared line', () => {
    renderPage();
    const overlay = mountForTest();
    document.querySelectorAll('article').forEach((card, index) => {
      card.setAttribute('data-sve-loc', `${FILE}:${20 + index}:9`);
    });
    expect(overlay.currentLoc(CARD_EID, 4)).toBe(`${FILE}:24:9`);
  });

  it('answers null for an element hot reload never brought back', () => {
    renderPage();
    const overlay = mountForTest();
    expect(overlay.currentLoc(CARD_EID, 6)).toBeNull();
    expect(overlay.currentLoc('no-such-eid', 0)).toBeNull();
  });

  // AC-8.7: replaced, not deprecated alongside its replacement.
  it('does not leave resolveAnchor on the handle beside it', () => {
    renderPage();
    expect('resolveAnchor' in mountForTest()).toBe(false);
  });
});

// AC-8.3
describe('select takes an anchor, not an element', () => {
  it('selects an element the caller knows only by id', () => {
    renderPage();
    const overlay = mountForTest();
    overlay.select({ eid: H1_EID, eidIndex: 0 });
    expect(overlay.selection).toMatchObject({ eid: H1_EID, eidIndex: 0, loc: H1_LOC, tag: 'h1' });
  });

  it('tells apart the six instances that share one line', () => {
    renderPage();
    const overlay = mountForTest();
    overlay.select({ eid: CARD_EID, eidIndex: 3 });
    expect(overlay.selection).toMatchObject({ eid: CARD_EID, eidIndex: 3, count: 6 });
  });

  it('clears on null, and on an anchor nothing on the page answers to', () => {
    renderPage();
    const overlay = mountForTest();

    overlay.select({ eid: H1_EID, eidIndex: 0 });
    overlay.select(null);
    expect(overlay.selection).toBeNull();

    overlay.select({ eid: H1_EID, eidIndex: 0 });
    overlay.select({ eid: CARD_EID, eidIndex: 99 });
    expect(overlay.selection).toBeNull();
  });

  it('still selects on click, which happens inside the iframe either way', () => {
    renderPage();
    const overlay = mountForTest();
    document.querySelector('h1')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(overlay.selection).toMatchObject({ eid: H1_EID, eidIndex: 0 });
  });
});

// AC-8.4
describe('the live store leaves the handle', () => {
  it('answers for one eid instead of handing out the store', async () => {
    renderPage();
    const overlay = mountForTest();
    expect(overlay.getOverride(H1_EID)).toBeUndefined();

    overlay.restoreOverride(H1_EID, { text: 'Ship faster' });
    await tick();
    expect(overlay.getOverride(H1_EID)).toEqual({ text: 'Ship faster' });

    overlay.liftOverride(H1_EID);
    expect(overlay.getOverride(H1_EID)).toBeUndefined();
  });

  it('answers with a copy, so a caller that mutates it changes nothing', () => {
    renderPage();
    const overlay = mountForTest();
    overlay.restoreOverride(H1_EID, { text: 'Ship faster' });

    const held = overlay.getOverride(H1_EID)!;
    held.text = 'tampered';
    expect(overlay.getOverride(H1_EID)).toEqual({ text: 'Ship faster' });
  });

  // AC-8.7 again: the store is replaced, not kept alive next to `getOverride`.
  it('does not leave the live store on the handle beside it', () => {
    renderPage();
    expect('store' in mountForTest()).toBe(false);
  });

  it('keeps the two in-page-only objects off the remote surface', () => {
    renderPage();
    const overlay = mountForTest();
    // They stay for v1's tests, and a parent frame can hold neither.
    expect(overlay.overrideStyleSheet).toBeDefined();
    expect(overlay.reasserter).toBeDefined();
    const surface: readonly string[] = REMOTE_SURFACE;
    expect(surface).not.toContain('overrideStyleSheet');
    expect(surface).not.toContain('reasserter');
  });
});

/* ── AC-8.5 — nothing that crosses the seam is un-serialisable ────────────── */

const ANCHOR = { eid: H1_EID, eidIndex: 0 };

const OVERRIDE: Override = {
  text: 'Ship faster',
  classes: { add: ['text-6xl'], remove: ['title'] },
  style: { color: '#3b82f6' },
};

const VERDICT: Verdict = {
  status: 'drifted',
  message: 'The file changed, but the result is not what you asked for.',
  mismatch: [{ prop: 'color', intent: 'rgb(59, 130, 246)', rendered: 'rgb(14, 17, 22)' }],
};

/** What crosses the seam for one member: what the parent sends, and what comes back. */
interface Crossing {
  sent: unknown[];
  received: unknown[];
}

/**
 * One probe per member of the remote surface.
 *
 * Typed as a *total* `Record<keyof RemoteOverlay, …>`, so a member added to the interface
 * does not compile until it is probed here — which is what makes AC-8.5's assertion hold
 * for methods that do not exist yet.
 */
const PROBES: Record<keyof RemoteOverlay, (overlay: OverlayHandle) => Crossing> = {
  selection: (overlay) => {
    overlay.select(ANCHOR);
    return { sent: [], received: [overlay.selection] };
  },

  select: (overlay) => {
    overlay.select(ANCHOR);
    return { sent: [ANCHOR], received: [] };
  },

  currentLoc: (overlay) => ({
    sent: [H1_EID, 0],
    received: [overlay.currentLoc(H1_EID, 0)],
  }),

  readSnapshot: (overlay) => ({
    sent: [H1_EID, 0],
    received: [overlay.readSnapshot(H1_EID, 0)],
  }),

  getOverride: (overlay) => {
    overlay.restoreOverride(H1_EID, OVERRIDE);
    return { sent: [H1_EID], received: [overlay.getOverride(H1_EID)] };
  },

  liftOverride: (overlay) => {
    overlay.restoreOverride(H1_EID, OVERRIDE);
    return { sent: [H1_EID], received: [overlay.liftOverride(H1_EID)] };
  },

  restoreOverride: (overlay) => {
    overlay.restoreOverride(H1_EID, OVERRIDE);
    return { sent: [H1_EID, OVERRIDE], received: [] };
  },

  captureIntent: (overlay) => {
    overlay.select(ANCHOR);
    overlay.restoreOverride(H1_EID, OVERRIDE);
    return { sent: ['text'], received: [overlay.captureIntent('text')] };
  },

  // A subscription's argument is the transport's own callback and never crosses; what
  // crosses is what it is handed.
  onApply: (overlay) => {
    const seen: unknown[] = [];
    overlay.onApply((intent) => seen.push(intent));
    overlay.select(ANCHOR);
    overlay.restoreOverride(H1_EID, OVERRIDE);
    press('.sve-apply');
    expect(seen).toHaveLength(1);
    return { sent: [], received: seen };
  },

  onRevert: (overlay) => {
    const seen: unknown[] = [];
    overlay.onRevert((eid) => seen.push(eid));
    overlay.select(ANCHOR);
    overlay.setRevertable(H1_EID, true);
    press('.sve-revert');
    expect(seen).toEqual([H1_EID]);
    return { sent: [], received: seen };
  },

  setPhase: (overlay) => {
    overlay.setPhase('applying');
    return { sent: ['applying'], received: [] };
  },

  setVerdict: (overlay) => {
    overlay.setVerdict(H1_EID, VERDICT);
    return { sent: [H1_EID, VERDICT], received: [] };
  },

  setRevertable: (overlay) => {
    overlay.setRevertable(H1_EID, true);
    return { sent: [H1_EID, true], received: [] };
  },

  refresh: (overlay) => {
    overlay.select(ANCHOR);
    overlay.refresh();
    return { sent: [], received: [] };
  },

  unmount: (overlay) => {
    overlay.unmount();
    return { sent: [], received: [] };
  },
};

describe('nothing that crosses the seam is un-serialisable', () => {
  it('enumerates the whole handle, so a member added later is covered or fails here', () => {
    renderPage();
    const overlay = mountForTest();
    // The two AC-8.4 keeps for in-page mode. Everything else on the handle is remote, and
    // everything remote has a probe.
    const inPageOnly = ['overrideStyleSheet', 'reasserter'];
    const remote = Object.keys(overlay).filter((key) => !inPageOnly.includes(key));

    expect(remote.sort()).toEqual([...REMOTE_SURFACE].sort());
    expect(Object.keys(PROBES).sort()).toEqual([...REMOTE_SURFACE].sort());
  });

  it.each(REMOTE_SURFACE)('%s carries only values JSON can carry', (member) => {
    renderPage();
    const overlay = mountForTest();
    const { sent, received } = PROBES[member](overlay);

    for (const value of [...sent, ...received]) {
      // Wrapped: `undefined` is a legitimate answer from `getOverride`, and
      // `JSON.stringify(undefined)` is not a document.
      expect(JSON.parse(JSON.stringify({ value }))).toEqual({ value });
    }
  });
});
