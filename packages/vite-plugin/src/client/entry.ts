/**
 * The browser half of `@sve/vite`: what the injected `<script>` ends up running.
 *
 * Nothing in this file may reach Node. It is served to the page by the dev server, so it
 * imports `@sve/overlay` and `@sve/protocol` and nothing else from the workspace — the
 * plugin's own Node entry is never on this side of the wire.
 *
 * There are two shapes the editor can take, and this is where they part:
 *
 *  - **in the page**, as v1 has always been — the overlay draws its own chrome and a
 *    session in this document runs the verification loop;
 *  - **inside a studio's frame** — the overlay mounts without chrome and an RPC server
 *    hands the handle to the parent window, which draws the diagnostic and runs the loop.
 *
 * The second requires a *configured* studio origin (AC-15.1, AC-15.3). Being framed is not
 * consent; a project someone else iframed must not start answering them.
 */
import { mountOverlay, type OverlayHandle } from '@sve/overlay';
import { createEditorSession, type EditorSession } from './session.js';
import { studioPeer, type FrameView, type PreviewHandle } from './preview.js';
import type { HotLike } from './verify.js';

/** Mirrors `SVE_SOURCE_PATH` in `@sve/bridge`, which is Node-only and cannot be imported here. */
const SOURCE_PATH = '/__sve/source';

export interface BootOptions {
  /** Vite's root as the loc spells it, so the overlay can fetch a source excerpt. */
  viteRoot?: string;
  verifyTimeoutMs?: number;
  settleMs?: number;
  /**
   * The origin of the studio allowed to drive this page (AC-15.3).
   *
   * Configuration, and only configuration. It is never inferred from `document.referrer`,
   * `location.ancestorOrigins`, or the first message to arrive — every one of those is
   * chosen by whoever framed the page, and this origin decides who may reach the bridge.
   * Absent, or not a bare origin, and the page keeps its own chrome and serves nobody.
   */
  studioOrigin?: string;
}

/** One boot's worth of state, so re-booting can take back exactly what it put down. */
export interface EditorHandle {
  overlay: OverlayHandle;
  /** The in-page verification loop. Null when the studio is running the loop instead. */
  session: EditorSession | null;
  /** Resolves when the preview server is listening, or to null when this page serves nobody. */
  preview: Promise<PreviewHandle | null>;
  stop(): void;
}

/**
 * Mounts the editor into the page it is editing, and joins it to whichever of the two
 * things is going to drive it.
 *
 * Separated from `boot` so that both branches are reachable from a test without a browser:
 * `boot` is the module-scope singleton and the `DOMContentLoaded` wait, and this is the
 * whole of the decision.
 */
export function startEditor(options: BootOptions = {}, doc: Document = document): EditorHandle | null {
  const view = doc.defaultView as unknown as FrameView | null;
  const decision = studioPeer(view, options.studioOrigin);

  // A wildcard, or a URL where an origin was wanted, is a misconfiguration rather than a
  // choice not to be framed — and it is refused loudly. `sve()` refuses it at startup too,
  // but a page that reached here with one would otherwise fall back in silence.
  if (!decision.ok && (decision.reason === 'wildcard' || decision.reason === 'not-an-origin')) {
    console.error(
      `[sve] studioOrigin ${JSON.stringify(options.studioOrigin)} is not an origin this page ` +
        `will answer; name the studio's origin exactly, e.g. "http://localhost:5300". ` +
        `The in-page editor is running instead.`,
    );
  }

  // The excerpt comes from the bridge, not from Vite's module graph. Asking the dev
  // server for the module returns the *transformed* source — JSX already lowered to a
  // props object carrying the data-sve-* attributes this editor added — and a caret at
  // column 11 of that points at nothing anyone wrote. The bridge serves the bytes on
  // disk, behind the same path guard as every write.
  const fetchSource = async (file: string): Promise<string | null> => {
    try {
      const response = await fetch(`${SOURCE_PATH}?file=${encodeURIComponent(file)}`);
      return response.ok ? await response.text() : null;
    } catch {
      return null;
    }
  };

  const overlay = mountOverlay({
    document: doc,
    viteRoot: options.viteRoot ?? '',
    fetchSource,
    // AC-15.2: one inspector, and when there is a studio it is the studio's.
    ...(decision.ok ? { chrome: false } : {}),
  });
  if (!overlay) return null;

  // `import.meta.hot` is how step 1 of the loop knows the page re-rendered. Without a
  // dev server there is none, and every edit reports stalled rather than hanging.
  const hot = (import.meta.hot as HotLike | undefined) ?? null;

  if (decision.ok) {
    let handle: PreviewHandle | null = null;
    let stopped = false;
    // Lazy: this is the only path that pays for `@sve/rpc` and `@sve/studio/preview`.
    const preview = import('./preview.js')
      .then((module) =>
        module.startPreviewServer({
          overlay,
          peer: decision.peer,
          document: doc,
          hot,
          fetchSource,
          ...(options.verifyTimeoutMs === undefined ? {} : { verifyTimeoutMs: options.verifyTimeoutMs }),
          ...(options.settleMs === undefined ? {} : { settleMs: options.settleMs }),
        }),
      )
      .then((started) => {
        handle = started;
        // A reload that raced the import must not leave a server listening on a document
        // nobody is editing any more.
        if (stopped) started?.dispose();
        return started;
      })
      .catch((error: unknown) => {
        console.error('[sve] the studio preview server could not start', error);
        return null;
      });

    return {
      overlay,
      session: null,
      preview,
      stop() {
        stopped = true;
        handle?.dispose();
        overlay.unmount();
      },
    };
  }

  const session = createEditorSession({
    handle: overlay,
    hot,
    ...(options.verifyTimeoutMs === undefined ? {} : { timeoutMs: options.verifyTimeoutMs }),
    ...(options.settleMs === undefined ? {} : { settleMs: options.settleMs }),
  });

  return {
    overlay,
    session,
    preview: Promise.resolve(null),
    stop() {
      session.dispose();
      overlay.unmount();
    },
  };
}

let current: EditorHandle | null = null;

/**
 * Called once from the virtual module the plugin injects. It tears down whatever it finds
 * first: a full page reload re-runs it, and an interrupted mount may have left a handle
 * behind.
 */
export function boot(options: BootOptions = {}): void {
  if (typeof document === 'undefined') return;

  const start = (): void => {
    current?.stop();
    current = startEditor(options);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}
