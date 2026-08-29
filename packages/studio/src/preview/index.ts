/**
 * `@sve/studio/preview` — the studio's foot inside the frame.
 *
 * Browser-only, and it must stay that way: this module is served into the page being
 * edited, so nothing here may reach `@sve/bridge`, `@sve/host` or Node. It imports the
 * overlay (already in that page) and `@sve/rpc` (browser-safe) and nothing else.
 */
export {
  buildInspectorState,
  createPreviewServer,
  overlayHandlers,
  waitForUpdate,
  DEFAULT_SETTLE_MS,
  DEFAULT_VERIFY_TIMEOUT_MS,
  type HandlerDeps,
  type HotLike,
  type PreviewServer,
  type PreviewServerOptions,
  type StateDeps,
  type WatchDeps,
  type WatchOptions,
} from './serve.js';
