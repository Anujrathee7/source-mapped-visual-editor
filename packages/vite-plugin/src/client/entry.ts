/**
 * The browser half of `@sve/vite`: what the injected `<script>` ends up running.
 *
 * Nothing in this file may reach Node. It is served to the page by the dev server, so it
 * imports `@sve/overlay` and `@sve/protocol` and nothing else from the workspace — the
 * plugin's own Node entry is never on this side of the wire.
 */
import { mountOverlay, type OverlayHandle } from '@sve/overlay';
import { createEditorSession, type EditorSession } from './session.js';
import type { HotLike } from './verify.js';

export interface BootOptions {
  /** Vite's root as the loc spells it, so the overlay can fetch a source excerpt. */
  viteRoot?: string;
  verifyTimeoutMs?: number;
  settleMs?: number;
}

let overlay: OverlayHandle | null = null;
let session: EditorSession | null = null;

/**
 * Mounts the editor into the page it is editing, and joins it to the bridge.
 *
 * Called once from the virtual module the plugin injects. It tears down whatever it finds
 * first: a full page reload re-runs it, and an interrupted mount may have left a handle
 * behind.
 */
export function boot(options: BootOptions = {}): void {
  if (typeof document === 'undefined') return;

  const start = (): void => {
    session?.dispose();
    overlay?.unmount();

    overlay = mountOverlay({ viteRoot: options.viteRoot ?? '' });
    if (!overlay) return;

    session = createEditorSession({
      handle: overlay,
      // `import.meta.hot` is how step 1 of the loop knows the page re-rendered. Without a
      // dev server there is none, and every edit reports stalled rather than hanging.
      hot: (import.meta.hot as HotLike | undefined) ?? null,
      ...(options.verifyTimeoutMs === undefined ? {} : { timeoutMs: options.verifyTimeoutMs }),
      ...(options.settleMs === undefined ? {} : { settleMs: options.settleMs }),
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}
