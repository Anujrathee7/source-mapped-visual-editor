/**
 * The browser half of `@sve/vite`: what the injected `<script>` ends up running.
 *
 * Nothing in this file may reach Node. It is served to the page by the dev server, so it
 * imports `@sve/overlay` and nothing else from the workspace.
 */
import { mountOverlay, type OverlayHandle } from '@sve/overlay';

export interface BootOptions {
  /** Vite's root as the loc spells it, so the overlay can fetch a source excerpt. */
  viteRoot?: string;
  verifyTimeoutMs?: number;
  settleMs?: number;
}

let mounted: OverlayHandle | null = null;

/**
 * Mounts the editor into the page it is editing.
 *
 * Called once, from the virtual module the plugin injects. It is idempotent because a
 * full page reload re-runs it and an interrupted one may have left a handle behind.
 */
export function boot(options: BootOptions = {}): void {
  if (typeof document === 'undefined') return;

  const start = (): void => {
    mounted?.unmount();
    mounted = mountOverlay({ viteRoot: options.viteRoot ?? '' });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}
