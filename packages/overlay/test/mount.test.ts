// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOST_ATTR, mountOverlay, type OverlayHandle } from '../src/mount.js';
import { OVERRIDE_STYLE_ATTR } from '../src/apply.js';
import { CARD_EID, FILE, H1_EID, H1_LOC, P_EID, fetchFixtureSource, renderPage } from './fixture.js';
import { addPageStyle, rerenderText, resetDocument, tick } from './support.js';

let handle: OverlayHandle | null = null;

const mountForTest = (overrides: Parameters<typeof mountOverlay>[0] = {}): OverlayHandle => {
  handle = mountOverlay({ fetchSource: fetchFixtureSource, ...overrides });
  if (!handle) throw new Error('expected the overlay to mount');
  return handle;
};

afterEach(() => {
  handle?.unmount();
  handle = null;
  resetDocument();
});

const host = (): HTMLElement | null => document.querySelector(`[${HOST_ATTR}]`);
const chrome = (): ShadowRoot => host()!.shadowRoot!;

// AC-4.1
describe('mounting is isolated', () => {
  it('attaches a shadow root to an element appended to body, outside the app root', () => {
    renderPage();
    mountForTest();
    expect(host()!.parentElement).toBe(document.body);
    expect(host()!.shadowRoot).not.toBeNull();
    expect(document.querySelector('#app-root')!.contains(host())).toBe(false);
  });

  it('keeps its own chrome out of the page: a document query cannot reach it', () => {
    renderPage();
    mountForTest();
    expect(chrome().querySelector('.sve-panel')).not.toBeNull();
    // A ShadowRoot is not traversed by document queries. This is the isolation, and it is
    // the direction jsdom can prove; that the demo's Tailwind does not *style* the chrome
    // needs real computed styles and is asserted in M6's Playwright suite (AC-5.1).
    expect(document.querySelectorAll('.sve-panel')).toHaveLength(0);
    expect(document.querySelectorAll('.sve-highlight')).toHaveLength(0);
  });

  it('puts its chrome stylesheet inside the shadow root, never in the page head', () => {
    renderPage();
    mountForTest();
    expect(chrome().querySelector('style')).not.toBeNull();
    for (const style of document.head.querySelectorAll('style')) {
      expect(style.hasAttribute(OVERRIDE_STYLE_ATTR)).toBe(true);
    }
  });

  it('leaks nothing into the page but eid-keyed rules', () => {
    renderPage();
    const overlay = mountForTest();
    overlay.restoreOverride(H1_EID, { style: { color: 'red' } });

    const injected = document.querySelectorAll<HTMLStyleElement>(`style[${OVERRIDE_STYLE_ATTR}]`);
    expect(injected).toHaveLength(1);
    const rules = Array.from(injected[0]!.sheet!.cssRules) as CSSStyleRule[];
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) expect(rule.selectorText.startsWith('[data-sve-eid=')).toBe(true);
  });
});

// AC-4.1 — "No-ops entirely when import.meta.env.DEV is false."
describe('the overlay is dev-only', () => {
  it('returns null and touches nothing', () => {
    renderPage();
    const before = document.body.innerHTML;
    expect(mountOverlay({ dev: false })).toBeNull();
    expect(host()).toBeNull();
    expect(document.querySelector(`style[${OVERRIDE_STYLE_ATTR}]`)).toBeNull();
    expect(document.body.innerHTML).toBe(before);
  });

  it('mounts under vitest, where import.meta.env.DEV is true, with no flag passed', () => {
    renderPage();
    handle = mountOverlay({ fetchSource: fetchFixtureSource });
    expect(handle).not.toBeNull();
  });
});

// AC-4.1
describe('unmounting', () => {
  it('removes the host and the injected stylesheet', () => {
    renderPage();
    const overlay = mountForTest();
    overlay.restoreOverride(H1_EID, { style: { color: 'red' } });
    overlay.unmount();
    handle = null;

    expect(host()).toBeNull();
    expect(document.querySelector(`style[${OVERRIDE_STYLE_ATTR}]`)).toBeNull();
  });

  it('stops re-asserting, and restores what React last rendered', async () => {
    renderPage();
    const overlay = mountForTest();
    overlay.restoreOverride(H1_EID, { text: 'Ship faster' });
    const h1 = document.querySelector('h1')!;
    expect(h1.textContent).toBe('Ship faster');

    overlay.unmount();
    handle = null;
    expect(h1.textContent).toBe('Swim today');

    rerenderText(h1, 'later render');
    await tick();
    expect(h1.textContent).toBe('later render');
  });

  it('stops listening: a click no longer selects', () => {
    renderPage();
    const overlay = mountForTest();
    overlay.unmount();
    handle = null;

    document.querySelector('h1')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(overlay.selection).toBeNull();
  });

  it('leaves no duplicates across mount, unmount, mount', () => {
    renderPage();
    mountForTest().unmount();
    handle = null;
    mountForTest();

    expect(document.querySelectorAll(`[${HOST_ATTR}]`)).toHaveLength(1);
    expect(document.querySelectorAll(`style[${OVERRIDE_STYLE_ATTR}]`)).toHaveLength(1);
  });

  it('is safe to call twice', () => {
    renderPage();
    const overlay = mountForTest();
    overlay.unmount();
    handle = null;
    expect(() => overlay.unmount()).not.toThrow();
  });
});

// AC-4.2
describe('selection', () => {
  it('selects on click, and reports the element the babel pass stamped', () => {
    renderPage();
    const overlay = mountForTest();
    document.querySelector('h1')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(overlay.selection).toMatchObject({ eid: H1_EID, loc: H1_LOC, tag: 'h1' });
  });

  it('selects the nearest stamped ancestor when the click lands on unstamped markup', () => {
    renderPage();
    const overlay = mountForTest();
    document.querySelector('#deep')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(overlay.selection!.tag).toBe('section');
  });

  it('deselects on Escape', () => {
    renderPage();
    const overlay = mountForTest();
    overlay.select({ eid: H1_EID, eidIndex: 0 });
    expect(overlay.selection).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(overlay.selection).toBeNull();
  });

  it('is reachable from the keyboard: focusing an element selects it', () => {
    renderPage();
    const overlay = mountForTest();
    document.querySelector('h1')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(overlay.selection!.eid).toBe(H1_EID);
  });

  it('walks the tree with the arrow keys, so a non-focusable element is still reachable', () => {
    renderPage();
    const overlay = mountForTest();
    overlay.select({ eid: H1_EID, eidIndex: 0 });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(overlay.selection!.tag).toBe('section');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(overlay.selection!.eid).toBe(H1_EID);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(overlay.selection!.eid).toBe(P_EID);
  });

  it('never selects its own chrome', () => {
    renderPage();
    const overlay = mountForTest();
    overlay.select({ eid: H1_EID, eidIndex: 0 });
    const before = overlay.selection;

    host()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(overlay.selection).toEqual(before);
  });

  it('draws the highlight as a separate element and never touches the target', () => {
    renderPage();
    const overlay = mountForTest();
    const h1 = document.querySelector('h1')!;
    const classBefore = h1.className;

    h1.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    overlay.select({ eid: H1_EID, eidIndex: 0 });

    expect(chrome().querySelectorAll('.sve-highlight').length).toBeGreaterThan(0);
    expect(h1.getAttribute('style')).toBeNull();
    expect(h1.className).toBe(classBefore);
    // The highlight lives in the overlay's shadow root, so it is not a child of the target
    // and cannot be affected by the app re-rendering it.
    expect(h1.querySelector('.sve-highlight')).toBeNull();
  });

  // AC-4.2 — "Selection survives a React re-render of the target."
  it('survives the target being replaced', () => {
    renderPage();
    const overlay = mountForTest();
    overlay.select({ eid: H1_EID, eidIndex: 0 });

    renderPage();
    // A distinct loc on the replacement, so this cannot pass by reading the old node.
    document.querySelector('h1')!.setAttribute('data-sve-loc', `${FILE}:9:5`);
    expect(overlay.selection!.eid).toBe(H1_EID);
    expect(overlay.currentLoc(H1_EID, 0)).toBe(`${FILE}:9:5`);
  });
});

// AC-4.6 — "Assert that all six visibly change, not just the clicked one."
describe('blast radius', () => {
  it('applies the override to every element rendering from the line', async () => {
    renderPage();
    addPageStyle('.card { color: rgb(14, 17, 22) }');
    const overlay = mountForTest();
    overlay.select({ eid: CARD_EID, eidIndex: 2 });
    overlay.restoreOverride(CARD_EID, { style: { color: 'rgb(59, 130, 246)' } });
    await tick();

    const cards = document.querySelectorAll('article');
    expect(cards).toHaveLength(6);
    for (const card of cards) expect(getComputedStyle(card).color).toBe('rgb(59, 130, 246)');
  });

  it('re-asserts text on all six, not only the clicked one', () => {
    renderPage();
    const overlay = mountForTest();
    overlay.restoreOverride(CARD_EID, { text: 'edited' });
    for (const card of document.querySelectorAll('article')) {
      expect(card.textContent).toBe('edited');
    }
  });
});

// The seam M6 (AC-5) drives. Everything below is a hook this milestone exposes and does
// not itself use: the verification loop is not implemented here.
describe('the hooks M6 drives', () => {
  it('re-anchors by eid and index after the DOM is rebuilt', () => {
    renderPage();
    const overlay = mountForTest();
    renderPage();
    // Six elements share the eid, so the index has to be what picks one out: they are
    // stamped apart here rather than compared by identity.
    document.querySelectorAll('article').forEach((card, index) => {
      card.setAttribute('data-sve-loc', `${FILE}:${20 + index}:9`);
    });
    expect(overlay.currentLoc(CARD_EID, 4)).toBe(`${FILE}:24:9`);
  });

  it('reads the live DOM into a snapshot', () => {
    renderPage();
    const overlay = mountForTest();
    expect(overlay.readSnapshot(H1_EID, 0)!.text).toBe('Swim today');
    expect(overlay.readSnapshot('missing', 0)).toBeNull();
  });

  it('lifts an override — CSS rule gone, re-assertion stopped — and can put it back', async () => {
    renderPage();
    const overlay = mountForTest();
    const h1 = document.querySelector('h1')!;
    overlay.restoreOverride(H1_EID, { text: 'Ship faster', style: { color: 'rgb(59, 130, 246)' } });
    await tick();
    expect(h1.textContent).toBe('Ship faster');
    expect(getComputedStyle(h1).color).toBe('rgb(59, 130, 246)');

    const lifted = overlay.liftOverride(H1_EID)!;
    expect(lifted).toEqual({ text: 'Ship faster', style: { color: 'rgb(59, 130, 246)' } });
    expect(h1.textContent).toBe('Swim today');
    expect(overlay.overrideStyleSheet.element.sheet!.cssRules).toHaveLength(0);
    expect(overlay.reasserter.active).toBe(false);

    overlay.restoreOverride(H1_EID, lifted);
    expect(h1.textContent).toBe('Ship faster');
    expect(getComputedStyle(h1).color).toBe('rgb(59, 130, 246)');
  });

  it('emits the intent on Apply rather than sending it anywhere itself', async () => {
    renderPage();
    const overlay = mountForTest();
    const applied = vi.fn();
    overlay.onApply(applied);

    overlay.select({ eid: H1_EID, eidIndex: 0 });
    overlay.restoreOverride(H1_EID, { text: 'Ship faster' });
    await tick();

    chrome().querySelector<HTMLButtonElement>('.sve-apply')!.click();
    expect(applied).toHaveBeenCalledTimes(1);
    expect(applied.mock.calls[0]![0]).toMatchObject({
      eid: H1_EID,
      eidIndex: 0,
      loc: H1_LOC,
      tag: 'h1',
      kind: 'text',
    });
  });

  it('re-reads the DOM on demand, so a shifted loc reaches the inspector', async () => {
    renderPage();
    const overlay = mountForTest();
    overlay.select({ eid: H1_EID, eidIndex: 0 });
    await tick();

    document.querySelector('h1')!.setAttribute('data-sve-loc', 'apps/demo/src/Hero.tsx:9:5');
    overlay.refresh();
    await tick();
    expect(overlay.selection!.loc).toBe('apps/demo/src/Hero.tsx:9:5');
  });
});

/* == mounting without chrome (AC-15.2) ==================================== */

describe('mounting without chrome', () => {
  it('creates no inspector panel at all, rather than hiding one', async () => {
    renderPage();
    const overlay = mountForTest({ chrome: false });
    overlay.select({ eid: H1_EID, eidIndex: 0 });
    await tick();

    // Not `hidden`, not `display: none` — absent. A panel that exists is a panel a
    // stylesheet can reveal, and inside the frame it would cover the design the studio
    // is drawing the diagnostic *about*.
    expect(chrome().querySelector('.sve-panel')).toBeNull();
    expect(chrome().querySelector('.sve-excerpt')).toBeNull();
    expect(chrome().querySelectorAll('input')).toHaveLength(0);
    expect(chrome().querySelector('.sve-apply')).toBeNull();
  });

  it('still selects, overrides, re-asserts and captures — only the chrome is gone', async () => {
    renderPage();
    const overlay = mountForTest({ chrome: false });
    const h1 = document.querySelector('h1')!;

    // Selection by click: the listener is the mechanism, not the panel.
    h1.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(overlay.selection).toMatchObject({ eid: H1_EID, loc: H1_LOC, tag: 'h1' });

    overlay.restoreOverride(H1_EID, { text: 'Ship faster', style: { color: 'rgb(59, 130, 246)' } });
    await tick();
    expect(h1.textContent).toBe('Ship faster');
    expect(getComputedStyle(h1).color).toBe('rgb(59, 130, 246)');
    expect(overlay.reasserter.active).toBe(true);

    // And the re-asserter still fights React for the text it was given.
    rerenderText(h1, 'Swim today');
    await tick();
    expect(h1.textContent).toBe('Ship faster');

    expect(overlay.currentLoc(H1_EID, 0)).toBe(H1_LOC);
    expect(overlay.readSnapshot(H1_EID, 0)!.text).toBe('Ship faster');
    expect(overlay.captureIntent('text')).toMatchObject({ eid: H1_EID, kind: 'text' });
  });

  it('leaves the source it has no excerpt to render unfetched', async () => {
    renderPage();
    const fetchSource = vi.fn(fetchFixtureSource);
    const overlay = mountForTest({ chrome: false, fetchSource });
    overlay.select({ eid: H1_EID, eidIndex: 0 });
    await tick();
    overlay.refresh();
    await tick();
    // The excerpt belongs to the studio, which fetches the file from inside the frame
    // itself. Reading it here as well would be two requests for one selection.
    expect(fetchSource).not.toHaveBeenCalled();
  });

  it('defaults to drawing the chrome, so nothing that worked stops working', () => {
    renderPage();
    mountForTest();
    expect(chrome().querySelector('.sve-panel')).not.toBeNull();
  });
});
