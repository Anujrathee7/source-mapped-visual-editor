// @vitest-environment jsdom
/**
 * AC-8.1 and AC-8.6 — the overlay drives the document it was handed, and only that one.
 *
 * v2 renders the page under edit in an iframe on a different origin. The mechanism stays
 * inside that iframe, which means every realm-bound thing it reaches for — the style
 * engine, the mutation observer, the canvas the colour parser borrows, `fetch` — has to be
 * the *injected* document's, not the one the module happened to be evaluated in.
 *
 * The assertion is deliberately the negative one. Checking that the injected realm was
 * used proves the happy path; checking that the ambient realm was never touched proves
 * there is no second, quieter path that still works in jsdom because both documents happen
 * to be reachable here — and in v2 will not be reachable at all.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeColor } from '../src/compare.js';
import { HOST_ATTR, mountOverlay, type OverlayHandle } from '../src/mount.js';
import { FILE, H1_EID, PAGE, SOURCE, fetchFixtureSource } from './fixture.js';
import { resetDocument, tick } from './support.js';

interface Realm {
  doc: Document;
  view: Window & typeof globalThis;
}

let handle: OverlayHandle | null = null;
let ambient: AmbientWatch | null = null;

/**
 * A second realm, as close to v2's iframe as jsdom gets: its own `Window`, and so its own
 * `getComputedStyle` and its own `MutationObserver`, distinct objects from the ambient
 * ones the module would otherwise close over.
 */
function createRealm(): Realm {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const doc = frame.contentDocument;
  if (!doc?.defaultView) throw new Error('expected the iframe to have its own realm');
  doc.body.innerHTML = PAGE;
  const style = doc.createElement('style');
  style.textContent = '.title { color: rgb(14, 17, 22) }';
  doc.head.append(style);
  return { doc, view: doc.defaultView as Window & typeof globalThis };
}

/**
 * Counts constructions of a realm's `MutationObserver` without changing what it
 * constructs. A subclass rather than a spy: `new` on a mock is not a thing this needs to
 * rely on, and the instances handed to `observe()` have to be genuine.
 */
function countObservers(view: { MutationObserver: typeof MutationObserver }): {
  count: () => number;
  restore(): void;
} {
  const Real = view.MutationObserver;
  let count = 0;
  class Counting extends Real {
    constructor(callback: MutationCallback) {
      super(callback);
      count += 1;
    }
  }
  view.MutationObserver = Counting;
  return {
    count: () => count,
    restore: () => {
      view.MutationObserver = Real;
    },
  };
}

interface AmbientWatch {
  readonly calls: Record<'getComputedStyle' | 'MutationObserver' | 'createElement' | 'fetch', number>;
  restore(): void;
}

/**
 * Every reach for the ambient realm, counted.
 *
 * In vitest's jsdom environment `globalThis` *is* the page's `window`, so a bare
 * `getComputedStyle(el)` and a `window.getComputedStyle(el)` read the same property slot
 * and one spy catches both.
 */
function watchAmbient(): AmbientWatch {
  const getComputedStyle = vi.spyOn(globalThis, 'getComputedStyle');
  const createElement = vi.spyOn(document, 'createElement');
  const fetch = vi.spyOn(globalThis, 'fetch');
  const observers = countObservers(globalThis);

  return {
    get calls() {
      return {
        getComputedStyle: getComputedStyle.mock.calls.length,
        MutationObserver: observers.count(),
        createElement: createElement.mock.calls.length,
        fetch: fetch.mock.calls.length,
      };
    },
    restore() {
      getComputedStyle.mockRestore();
      createElement.mockRestore();
      fetch.mockRestore();
      observers.restore();
    },
  };
}

/** The realm's own click, on the realm's own element: what a user does inside the iframe. */
function clickIn(realm: Realm, selector: string): HTMLElement {
  const el = realm.doc.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`no ${selector} in the injected document`);
  el.dispatchEvent(new realm.view.MouseEvent('click', { bubbles: true }));
  return el;
}

function mountInto(realm: Realm, options: Parameters<typeof mountOverlay>[0] = {}): OverlayHandle {
  handle = mountOverlay({ document: realm.doc, fetchSource: fetchFixtureSource, ...options });
  if (!handle) throw new Error('expected the overlay to mount');
  return handle;
}

afterEach(() => {
  handle?.unmount();
  handle = null;
  ambient?.restore();
  ambient = null;
  resetDocument();
});

// AC-8.1
describe('an injected document is honoured everywhere', () => {
  it('reads computed values through the injected realm, and never the ambient one', () => {
    const realm = createRealm();
    const injected = vi.spyOn(realm.view, 'getComputedStyle');
    ambient = watchAmbient();

    const overlay = mountInto(realm);
    clickIn(realm, 'h1');
    const snapshot = overlay.readSnapshot(H1_EID, 0);

    // The verification thesis reads through this call, so it is the one that cannot be
    // subtly wrong: the value has to come from the document the element actually lives in.
    expect(snapshot?.text).toBe('Swim today');
    expect(snapshot?.computed.color).toBe('rgb(14, 17, 22)');
    expect(ambient.calls.getComputedStyle).toBe(0);
    expect(injected).toHaveBeenCalled();
  });

  it('constructs its MutationObserver in the injected realm', async () => {
    const realm = createRealm();
    const injected = countObservers(realm.view);
    ambient = watchAmbient();

    const overlay = mountInto(realm);
    // Text re-assertion is what needs an observer at all, so an override that asserts text
    // is what makes the observer connect and run.
    overlay.restoreOverride(H1_EID, { text: 'Ship faster' });
    await tick();

    expect(realm.doc.querySelector('h1')?.textContent).toBe('Ship faster');
    expect(ambient.calls.MutationObserver).toBe(0);
    expect(injected.count()).toBe(1);
  });

  it('borrows the colour parser’s canvas from the injected document', () => {
    const realm = createRealm();
    const injected = vi.spyOn(realm.doc, 'createElement');
    ambient = watchAmbient();

    mountInto(realm);
    // A colour the pure path cannot resolve, which is the only thing that reaches for a
    // canvas at all.
    normalizeColor('lab(50% 40 59)');

    expect(ambient.calls.createElement).toBe(0);
    expect(injected.mock.calls.filter(([tag]) => tag === 'canvas')).toHaveLength(1);
  });

  it('fetches source through the injected realm’s fetch', async () => {
    const realm = createRealm();
    const injectedFetch = vi.fn(async () => ({ ok: true, text: async () => SOURCE }));
    Object.defineProperty(realm.view, 'fetch', { configurable: true, value: injectedFetch });
    ambient = watchAmbient();

    mountInto(realm, { fetchSource: undefined });
    clickIn(realm, 'h1');
    await tick();

    expect(ambient.calls.fetch).toBe(0);
    expect(injectedFetch).toHaveBeenCalledWith(`/${FILE}`);
  });

  it('leaves the ambient document without so much as a host element', () => {
    const realm = createRealm();
    mountInto(realm);

    expect(realm.doc.querySelector(`[${HOST_ATTR}]`)).not.toBeNull();
    expect(document.querySelector(`[${HOST_ATTR}]`)).toBeNull();
  });
});

// AC-8.6
describe('highlights stay inside the iframe', () => {
  it('draws them in the injected document, in that document’s viewport coordinates', () => {
    const realm = createRealm();
    mountInto(realm);
    const h1 = clickIn(realm, 'h1');

    const host = realm.doc.querySelector(`[${HOST_ATTR}]`);
    const highlights = Array.from(host?.shadowRoot?.querySelectorAll<HTMLElement>('.sve-highlight') ?? []);
    expect(highlights.length).toBeGreaterThan(0);
    for (const highlight of highlights) {
      expect(highlight.ownerDocument).toBe(realm.doc);
      expect(highlight.ownerDocument).not.toBe(document);
    }

    // No scroll or offset compensation: the box is placed at the rect the iframe itself
    // reports, which is only correct because both live in the same viewport.
    const rect = h1.getBoundingClientRect();
    const selected = highlights.find((el) => el.className.includes('--selected'));
    expect(selected?.style.transform).toBe(`translate(${rect.left}px, ${rect.top}px)`);
    expect(selected?.hidden).toBe(false);
  });
});
