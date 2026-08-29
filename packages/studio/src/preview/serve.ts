/**
 * The half of the studio that runs *inside* the preview frame.
 *
 * AC-12.4: "the overlay's mechanism still inside the frame". The overlay stays exactly
 * where it is — same document, same `MutationObserver`, same injected stylesheet — and
 * this module is the thin thing that answers `@sve/rpc` on its behalf. Nothing here
 * reimplements a step of the loop; every handler is a delegation, and the two that are not
 * (`buildInspectorState` and the selection listeners) exist because `RemoteOverlay` hands
 * out a snapshot of its selection and never announces one.
 *
 * The listeners are the reason this is event-driven rather than polled. The overlay
 * registers its click handler on the document in the capture phase and stops propagation;
 * a second capture listener on the *same* target still runs, and it runs after, so by the
 * time it fires the overlay has already re-anchored. Focus and Escape/arrow keys are
 * observed for the same reason: AC-4.2's keyboard selection has to reach the chrome too,
 * and the chrome is now in another window.
 */
import {
  buildExcerpt,
  inferKind,
  normalizeText,
  type Anchor,
  type Override,
  type RemoteOverlay,
} from '@sve/overlay';
import { parseLoc } from '@sve/protocol';
import {
  createRpcServer,
  type InspectorState,
  type RpcDiagnostic,
  type RpcHandlers,
  type RpcServer,
  type Transport,
} from '@sve/rpc';

/** Mirrors `SVE_SOURCE_PATH` in `@sve/bridge`, which is Node-only and unimportable here. */
const SOURCE_PATH = '/__sve/source';

const SOURCE_UNREADABLE = 'Source unavailable — the dev server did not return this file.';
const SOURCE_READING = 'Reading source…';

/**
 * How long the frame waits for hot reload before answering "it never settled", and how
 * long the page must stay quiet to count as settled.
 *
 * The same two numbers `@sve/vite` uses. They are re-declared rather than imported for the
 * same reason the two verdict sentences are: that package publishes its Node entry and its
 * boot entry, and neither carries them.
 */
export const DEFAULT_VERIFY_TIMEOUT_MS = 10_000;
export const DEFAULT_SETTLE_MS = 120;

export interface HotLike {
  on(event: string, handler: () => void): void;
  off(event: string, handler: () => void): void;
}

export interface WatchOptions {
  timeoutMs?: number;
  settleMs?: number;
}

export interface WatchDeps extends WatchOptions {
  /** `import.meta.hot`. `null` when there is no hot reload to wait for. */
  hot: HotLike | null;
  raf?: (callback: () => void) => void;
}

const defaultRaf = (callback: () => void): void => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(callback);
  else setTimeout(callback, 16);
};

/**
 * Resolves once the page has re-rendered from source and gone quiet, or false if it never
 * does. Realm-bound on purpose: the socket is the user's dev server and the frames are the
 * user's compositor, and both are in this window rather than in the studio's.
 */
export function waitForUpdate(deps: WatchDeps): Promise<boolean> {
  const raf = deps.raf ?? defaultRaf;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS;
  const settleMs = deps.settleMs ?? DEFAULT_SETTLE_MS;

  return new Promise<boolean>((resolve) => {
    let done = false;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (value: boolean): void => {
      if (done) return;
      done = true;
      deps.hot?.off('vite:afterUpdate', onUpdate);
      if (settleTimer !== undefined) clearTimeout(settleTimer);
      clearTimeout(deadline);
      resolve(value);
    };

    function onUpdate(): void {
      if (done) return;
      if (settleTimer !== undefined) clearTimeout(settleTimer);
      // One edit can produce more than one update — the module, and then the stylesheet
      // Tailwind regenerated — and comparing between the two reads old CSS as drift.
      settleTimer = setTimeout(() => raf(() => raf(() => finish(true))), settleMs);
    }

    deps.hot?.on('vite:afterUpdate', onUpdate);
    const deadline = setTimeout(() => finish(false), timeoutMs);
  });
}

/* ── inspector state ──────────────────────────────────────────────────────── */

export interface StateDeps {
  overlay: RemoteOverlay;
  /** Cached file contents. `undefined` means still loading, `null` means unreadable. */
  source(file: string): string | null | undefined;
  contextLines?: number;
}

/**
 * The `InspectorState` the studio renders, built where the DOM is.
 *
 * Four of its fields are deliberately left at rest here — `canRevert`, `phase`, `verdict`,
 * and the `Applying…` the caret travels for. In v1 they were the panel's, and the panel
 * was in this document; in v2 the chrome is the studio and it is the studio that knows
 * whether a job is in flight. The frame reports what the *page* knows and nothing else.
 */
export function buildInspectorState(deps: StateDeps): InspectorState {
  const { overlay } = deps;
  const anchor: Anchor | null = overlay.selection;

  if (!anchor) {
    return {
      anchor: null,
      excerpt: null,
      sourceMessage: null,
      textValue: '',
      classValue: '',
      styleValues: {},
      canApply: false,
      canRevert: false,
      phase: 'idle',
      verdict: null,
    };
  }

  const override = overlay.getOverride(anchor.eid);
  const snapshot = overlay.readSnapshot(anchor.eid, anchor.eidIndex);

  // A class *removal* is a CSS reset, not a DOM write, so the element still carries the
  // class the user took off. The field shows what was asked for, which is what the intent
  // will record — the same reconstruction `mountOverlay` makes for its own panel.
  const added = new Set(override?.classes?.add ?? []);
  const removed = new Set(override?.classes?.remove ?? []);
  const base = (snapshot?.classes ?? []).filter((name) => !added.has(name));
  const desired = [...base.filter((name) => !removed.has(name)), ...added];

  const loc = parseLoc(anchor.loc);
  const source = loc === null ? null : deps.source(loc.file);
  const excerpt =
    loc !== null && typeof source === 'string' ? buildExcerpt(source, loc, deps.contextLines ?? 2) : null;
  const sourceMessage =
    excerpt !== null ? null : source === undefined && loc !== null ? SOURCE_READING : SOURCE_UNREADABLE;

  return {
    anchor,
    excerpt,
    sourceMessage,
    textValue: override?.text ?? normalizeText(snapshot?.text ?? ''),
    classValue: desired.join(' '),
    styleValues: { ...override?.style },
    canApply: override !== undefined && inferKind(override) !== null,
    canRevert: false,
    phase: 'idle',
    verdict: null,
  };
}

/* ── the handlers ─────────────────────────────────────────────────────────── */

export interface HandlerDeps {
  overlay: RemoteOverlay;
  /** Called after any handler that can change what the studio is looking at. */
  state(): InspectorState;
  watchForUpdate(options: WatchOptions): Promise<boolean>;
  onChanged?: () => void;
}

/**
 * Every method in the table, and only ever a delegation.
 *
 * `undefined` becomes `null` on the way out: `JSON.stringify` drops an undefined field
 * entirely, and AC-8.5 requires every value crossing the seam to round-trip unchanged.
 */
export function overlayHandlers(deps: HandlerDeps): RpcHandlers {
  const { overlay } = deps;
  const changed = (): void => deps.onChanged?.();

  return {
    currentLoc: ({ eid, eidIndex }) => overlay.currentLoc(eid, eidIndex),
    select: ({ anchor }) => {
      overlay.select(anchor);
      changed();
      return null;
    },
    getOverride: ({ eid }) => overlay.getOverride(eid) ?? null,
    readSnapshot: ({ eid, eidIndex }) => overlay.readSnapshot(eid, eidIndex),
    liftOverride: ({ eid }) => {
      const lifted = overlay.liftOverride(eid) ?? null;
      changed();
      return lifted;
    },
    restoreOverride: ({ eid, override }) => {
      overlay.restoreOverride(eid, override as Override);
      changed();
      return null;
    },
    captureIntent: ({ kind }) => overlay.captureIntent(kind),
    refresh: () => {
      overlay.refresh();
      changed();
      return null;
    },
    watchForUpdate: async (options) => ({ settled: await deps.watchForUpdate(options) }),
  };
}

/* ── the server ───────────────────────────────────────────────────────────── */

export interface PreviewServerOptions {
  overlay: RemoteOverlay;
  transport: Transport;
  /** Configuration, never inference: the studio's origin, and never a wildcard. */
  peerOrigin: string;
  peerSource?: unknown;
  /** The frame's own document, for the listeners that observe selection. */
  document?: Document;
  /** Reads a project file for the excerpt. Defaults to the bridge's guarded route. */
  fetchSource?(file: string): Promise<string | null>;
  contextLines?: number;
  watchForUpdate?(options: WatchOptions): Promise<boolean>;
  onDiagnostic?(diagnostic: RpcDiagnostic): void;
}

export interface PreviewServer {
  readonly server: RpcServer;
  /** Rebuilds the state and emits it if it changed. Idempotent. */
  emit(): void;
  dispose(): void;
}

export function createPreviewServer(options: PreviewServerOptions): PreviewServer {
  const doc = options.document ?? (typeof document === 'undefined' ? undefined : document);
  const view = doc?.defaultView;
  const realmFetch = view?.fetch?.bind(view) ?? (typeof fetch === 'function' ? fetch : undefined);

  const fetchSource =
    options.fetchSource ??
    (async (file: string): Promise<string | null> => {
      if (!realmFetch) return null;
      try {
        const response = await realmFetch(`${SOURCE_PATH}?file=${encodeURIComponent(file)}`);
        return response.ok ? await response.text() : null;
      } catch {
        return null;
      }
    });

  const sources = new Map<string, string | null>();
  const disposers: Array<() => void> = [];
  let disposed = false;
  let last = '';

  const state = (): InspectorState =>
    buildInspectorState({
      overlay: options.overlay,
      source: (file) => sources.get(file),
      ...(options.contextLines === undefined ? {} : { contextLines: options.contextLines }),
    });

  const load = (file: string): void => {
    if (sources.has(file)) return;
    void fetchSource(file).then((source) => {
      if (disposed) return;
      sources.set(file, source);
      emit();
    });
  };

  function emit(): void {
    if (disposed) return;
    const next = state();
    const loc = next.anchor === null ? null : parseLoc(next.anchor.loc);
    if (loc) load(loc.file);
    // Only when something actually changed: a click that re-selects the same element must
    // not turn into a render, and a chatty event channel buries the ones that matter.
    const encoded = JSON.stringify(next);
    if (encoded === last) return;
    last = encoded;
    server.emit('inspectorState', next);
  }

  const server = createRpcServer({
    transport: options.transport,
    peerOrigin: options.peerOrigin,
    ...(options.peerSource === undefined ? {} : { peerSource: options.peerSource }),
    ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
    handlers: overlayHandlers({
      overlay: options.overlay,
      state,
      watchForUpdate:
        options.watchForUpdate ??
        ((watch) =>
          waitForUpdate({
            hot: null,
            ...(watch.timeoutMs === undefined ? {} : { timeoutMs: watch.timeoutMs }),
            ...(watch.settleMs === undefined ? {} : { settleMs: watch.settleMs }),
          })),
      onChanged: () => emit(),
    }),
  });

  if (doc) {
    const listen = (type: string): void => {
      const handler = (): void => {
        // A microtask, so the overlay's own capture-phase handler has re-anchored first.
        queueMicrotask(emit);
      };
      // Capture, and registered after the overlay's: `stopPropagation` in the capture phase
      // does not stop a second listener on the same target from running.
      doc.addEventListener(type, handler, true);
      disposers.push(() => doc.removeEventListener(type, handler, true));
    };
    for (const type of ['click', 'focusin', 'keydown']) listen(type);
  }

  emit();

  return {
    server,
    emit,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const dispose of disposers.splice(0)) dispose();
      server.dispose();
    },
  };
}
