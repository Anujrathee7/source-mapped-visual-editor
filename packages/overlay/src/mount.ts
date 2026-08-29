/**
 * Mounting, wiring, and the seam M6 drives (AC-4.1, AC-4.2).
 *
 * Everything the overlay owns hangs off one handle, and everything it registered comes
 * back off on `unmount()`. The two halves of applying an override — the injected
 * stylesheet and the re-assertion observer — are both driven from a single store
 * subscription, so there is exactly one place where "the override changed" turns into
 * "the page changed".
 *
 * ## The seam for M6 (AC-5)
 *
 * This milestone stops at producing an `EditIntent`. The verification loop is not here.
 * What is here is every hook that loop needs, in the order AC-5 lists them:
 *
 *   1. wait for `vite:afterUpdate` + two rAFs .............. M6's
 *   2. re-anchor by eid + eidIndex ......................... `resolveAnchor`
 *   3. lift the override ................................... `liftOverride`
 *   4. read the live DOM ................................... `readSnapshot`
 *   5. compare against the intent .......................... `diffComputed` (compare.ts)
 *   6. report, or re-apply and report drift ................ `restoreOverride`, `setVerdict`
 *
 * `onApply` hands M6 a parsed intent and does nothing else with it: no request is made
 * from this package. `refresh()` re-reads the DOM so a loc the agent's own write shifted
 * reaches the inspector (AC-5.4).
 */
import type { EditIntent, EditKind, Snapshot } from '@sve/protocol';
import { createOverrideStyleSheet, declarationsForStore, type OverrideStyleSheet } from './apply.js';
import { ATTR_EID } from './attrs.js';
import { buildExcerpt, defaultSourceUrl, type Excerpt } from './excerpt.js';
import { buildIntent, inferKind } from './intent.js';
import {
  createInspector,
  type ApplyPhase,
  type InspectorState,
  type Verdict,
} from './inspector.js';
import { createReasserter, type Reasserter } from './reassert.js';
import {
  anchorFor,
  createHighlight,
  moveSelection,
  resolveAnchor as resolveAnchorIn,
  stampedAncestor,
  type Anchor,
  type SelectionMove,
} from './selection.js';
import { captureSnapshot } from './snapshot.js';
import { createOverrideStore, type Override, type OverrideStore } from './store.js';
import { CHROME_CSS } from './inspector.js';
import { normalizeText } from './compare.js';
import { parseLoc } from '@sve/protocol';

/** Marks the overlay's host element in the page's document. */
export const HOST_ATTR = 'data-sve-overlay';

export interface MountOptions {
  /** Defaults to `import.meta.env.DEV`. The overlay no-ops entirely when false. */
  dev?: boolean;
  document?: Document;
  /** Vite's root, relative to the repo root, used to map a loc onto a dev-server URL. */
  viteRoot?: string;
  /** Overridable so the bridge can serve excerpts itself later; `null` means unreadable. */
  fetchSource?: (file: string) => Promise<string | null>;
  /** Lines of context either side of the caret. */
  contextLines?: number;
}

export interface OverlayHandle {
  readonly store: OverrideStore;
  readonly overrideStyleSheet: OverrideStyleSheet;
  readonly reasserter: Reasserter;
  readonly selection: Anchor | null;

  select(el: Element | null): void;
  /** Step 2 of the loop: find the element again after HMR replaced it. */
  resolveAnchor(eid: string, eidIndex: number): HTMLElement | null;
  /** Step 4: read the live DOM. */
  readSnapshot(eid: string, eidIndex: number): Snapshot | null;
  /** Step 3: drop the CSS rule and stop re-asserting. Returns what was lifted. */
  liftOverride(eid: string): Override | undefined;
  /** Step 6, drift branch: put the user's illusion back. */
  restoreOverride(eid: string, override: Override): void;

  captureIntent(kind: EditKind): EditIntent | null;
  onApply(handler: (intent: EditIntent) => void): () => void;
  /** AC-5.8: the user asks for the bridge's snapshot of this element's file back. */
  onRevert(handler: (eid: string) => void): () => void;

  setPhase(phase: ApplyPhase): void;
  setVerdict(eid: string, verdict: Verdict | null): void;
  /** Whether a job has written a file this element's edit can be taken back out of. */
  setRevertable(eid: string, revertable: boolean): void;

  /** Re-read the DOM: new loc, new excerpt, same element. */
  refresh(): void;
  unmount(): void;
}

const SOURCE_UNREADABLE = 'Source unavailable — the dev server did not return this file.';

const ARROW_MOVES: Readonly<Record<string, SelectionMove>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'previous',
  ArrowRight: 'next',
};

export function mountOverlay(options: MountOptions = {}): OverlayHandle | null {
  const dev = options.dev ?? Boolean(import.meta.env?.DEV);
  // Dev-only, and no-op means no-op: nothing is created, nothing is appended, nothing is
  // observed. A production bundle that reaches this call pays for one boolean.
  if (!dev) return null;

  const doc = options.document ?? document;
  const view = doc.defaultView;
  const viteRoot = options.viteRoot ?? '';
  const contextLines = options.contextLines ?? 2;
  const fetchSource =
    options.fetchSource ??
    (async (file: string) => {
      try {
        const response = await fetch(defaultSourceUrl(file, viteRoot));
        return response.ok ? await response.text() : null;
      } catch {
        return null;
      }
    });

  // A host left behind by a crashed mount is removed rather than joined, so
  // mount-unmount-mount cannot leave two (AC-4.1).
  for (const stale of doc.querySelectorAll(`[${HOST_ATTR}]`)) stale.remove();

  const host = doc.createElement('div');
  host.setAttribute(HOST_ATTR, '');
  const shadow = host.attachShadow({ mode: 'open' });
  const chromeStyle = doc.createElement('style');
  chromeStyle.textContent = CHROME_CSS;
  const layer = doc.createElement('div');
  layer.className = 'sve-layer';
  shadow.append(chromeStyle, layer);
  doc.body.append(host);

  const store = createOverrideStore();
  const sheet = createOverrideStyleSheet(doc);
  const reasserter = createReasserter(doc);

  const hoverHighlight = createHighlight(layer, 'hover');
  const selectedHighlight = createHighlight(layer, 'selected');

  let selection: Anchor | null = null;
  let phase: ApplyPhase = 'idle';
  const verdicts = new Map<string, Verdict>();
  const revertable = new Set<string>();
  const sources = new Map<string, string | null>();
  const applyHandlers = new Set<(intent: EditIntent) => void>();
  const revertHandlers = new Set<(eid: string) => void>();
  const disposers: Array<() => void> = [];
  let unmounted = false;

  const selectedElement = (): HTMLElement | null =>
    selection ? resolveAnchorIn(selection.eid, selection.eidIndex, doc) : null;

  /* ── rendering ──────────────────────────────────────────────────────────── */

  /**
   * React's class list, reconstructed: the element carries whatever the overlay added,
   * and still carries whatever the overlay "removed" (removal is a CSS reset, not a DOM
   * write). Diffing a class edit against the raw DOM would read the overlay's own
   * additions as the app's.
   */
  const baseClasses = (el: Element, override: Override | undefined): string[] => {
    const added = new Set(override?.classes?.add ?? []);
    return Array.from(el.classList).filter((name) => !added.has(name));
  };

  const desiredClasses = (el: Element, override: Override | undefined): string[] => {
    const removed = new Set(override?.classes?.remove ?? []);
    return [
      ...baseClasses(el, override).filter((name) => !removed.has(name)),
      ...(override?.classes?.add ?? []),
    ];
  };

  const excerptFor = (anchor: Anchor): { excerpt: Excerpt | null; message: string | null } => {
    const loc = parseLoc(anchor.loc);
    if (!loc) return { excerpt: null, message: SOURCE_UNREADABLE };
    const source = sources.get(loc.file);
    if (source === undefined) return { excerpt: null, message: 'Reading source…' };
    if (source === null) return { excerpt: null, message: SOURCE_UNREADABLE };
    return { excerpt: buildExcerpt(source, loc, contextLines), message: null };
  };

  const buildState = (): InspectorState => {
    if (!selection) {
      return {
        anchor: null,
        excerpt: null,
        sourceMessage: null,
        textValue: '',
        classValue: '',
        styleValues: {},
        canApply: false,
        canRevert: false,
        phase,
        verdict: null,
      };
    }

    const el = selectedElement();
    const override = store.get(selection.eid);
    const { excerpt, message } = excerptFor(selection);

    return {
      anchor: selection,
      excerpt,
      sourceMessage: message,
      textValue: override?.text ?? normalizeText(el?.textContent ?? ''),
      classValue: el ? desiredClasses(el, override).join(' ') : '',
      styleValues: { ...override?.style },
      canApply: override !== undefined && inferKind(override) !== null,
      canRevert: revertable.has(selection.eid),
      phase,
      verdict: verdicts.get(selection.eid) ?? null,
    };
  };

  const render = (): void => {
    if (unmounted) return;
    inspector.render(buildState());
    const el = selectedElement();
    if (el) selectedHighlight.show(el);
    else selectedHighlight.hide();
  };

  /* ── the inspector's controls ───────────────────────────────────────────── */

  const inspector = createInspector(doc, {
    onText: (value) => {
      if (!selection) return;
      store.patch(selection.eid, { text: value });
    },

    onClass: (value) => {
      const el = selectedElement();
      if (!selection || !el) return;
      const override = store.get(selection.eid);
      const base = baseClasses(el, override);
      const next = value.split(/\s+/).filter((name) => name !== '');
      store.patch(selection.eid, {
        classes: {
          add: next.filter((name) => !base.includes(name)),
          remove: base.filter((name) => !next.includes(name)),
        },
      });
    },

    onStyle: (prop, value) => {
      if (!selection) return;
      const style = { ...store.get(selection.eid)?.style };
      if (value.trim() === '') delete style[prop];
      else style[prop] = value;
      store.set(selection.eid, { ...store.get(selection.eid), style });
    },

    onApply: () => {
      if (!selection) return;
      const override = store.get(selection.eid);
      if (!override) return;
      const kind = inferKind(override);
      if (!kind) return;
      const intent = handle.captureIntent(kind);
      if (!intent) return;
      // M6 owns everything past this point. The overlay does not fetch, wait, or verify.
      for (const handler of [...applyHandlers]) handler(intent);
    },

    onRevert: () => {
      if (!selection) return;
      for (const handler of [...revertHandlers]) handler(selection.eid);
    },
  });
  layer.append(inspector.element);

  /* ── source loading ─────────────────────────────────────────────────────── */

  const loadSource = (file: string, force = false): void => {
    if (!force && sources.has(file)) return;
    if (force) sources.delete(file);
    void fetchSource(file).then((source) => {
      if (unmounted) return;
      sources.set(file, source);
      render();
    });
  };

  /* ── selection ──────────────────────────────────────────────────────────── */

  const select = (el: Element | null): void => {
    selection = el ? anchorFor(el, doc) : null;
    if (selection) {
      const loc = parseLoc(selection.loc);
      if (loc) loadSource(loc.file);
    }
    render();
  };

  /* ── store subscription: one place where an override becomes a page change ── */

  disposers.push(
    store.subscribe(() => {
      sheet.update(declarationsForStore(store, doc));
      reasserter.apply(store.entries());
      render();
    }),
  );

  /* ── listeners ──────────────────────────────────────────────────────────── */

  const listen = <T extends Event>(
    target: EventTarget,
    type: string,
    handler: (event: T) => void,
    capture = false,
  ): void => {
    const listener = handler as EventListener;
    target.addEventListener(type, listener, capture);
    disposers.push(() => target.removeEventListener(type, listener, capture));
  };

  listen<PointerEvent>(doc, 'pointerover', (event) => {
    const target = stampedAncestor(event.target as Node | null, host);
    if (target) hoverHighlight.show(target);
    else hoverHighlight.hide();
  });

  listen(doc, 'pointerleave', () => hoverHighlight.hide());

  listen<MouseEvent>(
    doc,
    'click',
    (event) => {
      const target = stampedAncestor(event.target as Node | null, host);
      if (!target) return;
      // The page under edit stays put: a click here is a selection, not navigation.
      event.preventDefault();
      event.stopPropagation();
      select(target);
    },
    true,
  );

  // Keyboard reachability (AC-4.2). Focus reaches only focusable elements, so the arrows
  // walk the stamped tree directly and a heading is reachable without being made tabbable.
  listen<FocusEvent>(doc, 'focusin', (event) => {
    const target = stampedAncestor(event.target as Node | null, host);
    if (target) select(target);
  });

  listen<KeyboardEvent>(doc, 'keydown', (event) => {
    if (event.key === 'Escape') {
      select(null);
      hoverHighlight.hide();
      return;
    }
    const move = ARROW_MOVES[event.key];
    if (!move) return;
    const el = selectedElement();
    if (!el) return;
    const next = moveSelection(el, move);
    if (!next) return;
    event.preventDefault();
    select(next);
  });

  const reposition = (): void => {
    const el = selectedElement();
    if (el) selectedHighlight.show(el);
    hoverHighlight.hide();
  };
  listen(doc, 'scroll', reposition, true);
  if (view) listen(view, 'resize', reposition);

  /* ── the handle ─────────────────────────────────────────────────────────── */

  const handle: OverlayHandle = {
    store,
    overrideStyleSheet: sheet,
    reasserter,

    get selection() {
      return selection;
    },

    select,

    resolveAnchor: (eid, eidIndex) => resolveAnchorIn(eid, eidIndex, doc),

    readSnapshot: (eid, eidIndex) => {
      const el = resolveAnchorIn(eid, eidIndex, doc);
      return el ? captureSnapshot(el) : null;
    },

    liftOverride: (eid) => {
      const override = store.get(eid);
      store.clear(eid);
      return override;
    },

    restoreOverride: (eid, override) => {
      store.set(eid, override);
    },

    /**
     * AC-4.10: the intent is the snapshot taken *with the override applied*.
     *
     * `before` is read by lifting the override and reading again — the same lift M6
     * performs at step 3, which is why it is one code path and not two. Both reads happen
     * inside one task, so nothing is painted in between and the user sees no flicker.
     */
    captureIntent: (kind) => {
      if (!selection) return null;
      const override = store.get(selection.eid);
      if (!override) return null;
      const el = selectedElement();
      if (!el) return null;

      // A class *removal* is a CSS reset, not a DOM write (AC-4.4), so the element still
      // carries the class the user took off. The intent records what the user asked for,
      // which is the list the class field shows — otherwise a removal would reach the
      // agent as "change nothing" and be refused as not matching the line.
      const after = { ...captureSnapshot(el), classes: desiredClasses(el, override) };
      const lifted = handle.liftOverride(selection.eid);
      const before = captureSnapshot(el);
      if (lifted) handle.restoreOverride(selection.eid, lifted);

      return buildIntent({ anchor: selection, kind, before, after, override });
    },

    onApply: (handler) => {
      applyHandlers.add(handler);
      return () => {
        applyHandlers.delete(handler);
      };
    },

    onRevert: (handler) => {
      revertHandlers.add(handler);
      return () => {
        revertHandlers.delete(handler);
      };
    },

    setPhase: (next) => {
      phase = next;
      render();
    },

    setVerdict: (eid, verdict) => {
      if (verdict) verdicts.set(eid, verdict);
      else verdicts.delete(eid);
      // A verdict ends the flight, whichever way it went.
      phase = 'idle';
      render();
    },

    setRevertable: (eid, canRevert) => {
      if (canRevert) revertable.add(eid);
      else revertable.delete(eid);
      render();
    },

    refresh: () => {
      if (!selection) {
        render();
        return;
      }
      const el = resolveAnchorIn(selection.eid, selection.eidIndex, doc);
      selection = el ? anchorFor(el, doc) : null;
      if (selection) {
        const loc = parseLoc(selection.loc);
        // The file changed on disk, so the cached excerpt is stale by definition.
        if (loc) loadSource(loc.file, true);
      }
      render();
    },

    unmount: () => {
      if (unmounted) return;
      unmounted = true;
      for (const dispose of disposers.splice(0)) dispose();
      applyHandlers.clear();
      revertHandlers.clear();
      // Order matters: the reasserter restores React's DOM on the way out, so it has to go
      // before the host it was drawn beside.
      reasserter.dispose();
      sheet.dispose();
      host.remove();
    },
  };

  render();
  return handle;
}
