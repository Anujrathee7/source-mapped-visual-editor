/**
 * Whether this page is a studio's preview — and, if it is, the joining of the two.
 *
 * `@sve/studio/preview` has been able to answer for the overlay since M14 and `@sve/rpc`
 * has been able to carry the answers since M10. Nothing called either of them: the client
 * entry mounted the overlay and kept the handle in module scope, so a parent window had a
 * picture of the project and no way to drive it. This file is that call.
 *
 * Two rules shape it.
 *
 * **The trigger is configuration.** Being in a frame is not consent. `document.referrer`,
 * `location.ancestorOrigins` and "whoever posts first" are all attacker-influenced, and
 * inferring the peer from any of them means the first page to frame somebody's project
 * gets to drive their filesystem through the bridge. The origin is named in
 * `sve({ studioOrigin })` or the page serves nobody (AC-15.3).
 *
 * **Nothing heavy loads until it is needed.** `@sve/rpc` and `@sve/studio/preview` are
 * reached through a dynamic import inside `startPreviewServer`, so a project running the
 * in-page editor — `apps/demo` under `npm run dev` — fetches exactly the modules it
 * fetched before (AC-15.4). Everything imported at the top of this file is a type.
 */
import type { OverlayHandle } from '@sve/overlay';
import type { MessageSource, PostTarget, RpcDiagnostic } from '@sve/rpc';
import { DEFAULT_SETTLE_MS, DEFAULT_VERIFY_TIMEOUT_MS } from '../constants.js';
import type { HotLike } from './verify.js';

/**
 * Mirrors `WILDCARD_ORIGIN` in `@sve/rpc`, which is refused there for the same reason it
 * is refused here: a wildcard target delivers to whatever document occupies the window,
 * and a wildcard *expectation* accepts whatever document posts into it.
 */
const WILDCARD_ORIGIN = '*';

/** The two members of `window` this module needs, plus the one it compares. */
export interface FrameView extends MessageSource {
  /** `window.parent`. The view itself when the page is not framed. */
  readonly parent: unknown;
}

export interface StudioPeer {
  /** The origin messages are posted to, and the only origin accepted from. */
  origin: string;
  target: PostTarget;
  listenOn: MessageSource;
}

/**
 * Why this page is not serving a studio. Each is a different thing to say, and one of
 * them — `wildcard` — is a misconfiguration a developer needs told about rather than
 * quietly worked around.
 */
export type PeerRefusal = 'unframed' | 'unconfigured' | 'wildcard' | 'not-an-origin';

export type PeerDecision = { ok: true; peer: StudioPeer } | { ok: false; reason: PeerRefusal };

/** `assertTargetOrigin`'s rule in `@sve/rpc`, asked rather than thrown. */
function isOrigin(value: string): boolean {
  try {
    // A path, a query or a trailing slash means this is a URL, and `postMessage` would
    // silently compare only its origin part.
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}

/**
 * The studio this page answers to, or the reason there is none (AC-15.1, AC-15.3).
 *
 * Both halves have to be true. Being framed on its own is not the trigger — a project
 * someone else happened to iframe must not start answering that someone — and a named
 * origin on its own is not either, because there is no parent to answer.
 */
export function studioPeer(
  view: FrameView | null | undefined,
  studioOrigin: string | undefined,
): PeerDecision {
  const parent = view?.parent;
  if (!view || parent === undefined || parent === null || (parent as unknown) === (view as unknown)) {
    return { ok: false, reason: 'unframed' };
  }

  const origin = (studioOrigin ?? '').trim();
  if (origin === '') return { ok: false, reason: 'unconfigured' };
  if (origin === WILDCARD_ORIGIN) return { ok: false, reason: 'wildcard' };
  if (!isOrigin(origin)) return { ok: false, reason: 'not-an-origin' };

  return {
    ok: true,
    peer: { origin, target: parent as PostTarget, listenOn: view },
  };
}

/* ── starting the server ──────────────────────────────────────────────────── */

export interface PreviewBootOptions {
  overlay: OverlayHandle;
  peer: StudioPeer;
  /** The frame's own document, for the listeners that observe selection. */
  document: Document;
  /** `import.meta.hot`, so step 1 of the loop is answered from inside this realm. */
  hot: HotLike | null;
  fetchSource(file: string): Promise<string | null>;
  verifyTimeoutMs?: number;
  settleMs?: number;
  onDiagnostic?(diagnostic: RpcDiagnostic): void;
}

export interface PreviewHandle {
  dispose(): void;
}

/**
 * Starts the RPC server that exposes the overlay handle to the studio.
 *
 * `watchForUpdate` is wired explicitly and is the reason this is not a two-liner.
 * `createPreviewServer`'s own default watches with `hot: null`, which can only ever time
 * out — every verification would come back `stalled` and the loop would look broken rather
 * than unwired. Hot reload is observable only from inside this realm, so the socket the
 * frame already has is the one the studio's deadline is measured against.
 */
export async function startPreviewServer(
  options: PreviewBootOptions,
): Promise<PreviewHandle | null> {
  const { peer } = options;

  const [{ createWindowTransport }, { createPreviewServer, waitForUpdate }] = await Promise.all([
    import('@sve/rpc'),
    import('@sve/studio/preview'),
  ]);

  const preview = createPreviewServer({
    overlay: options.overlay,
    transport: createWindowTransport({
      target: peer.target,
      targetOrigin: peer.origin,
      listenOn: peer.listenOn,
    }),
    peerOrigin: peer.origin,
    // The window as well as the origin: another document on the studio's origin is still
    // not the studio, and the parent is by definition the only window we post into.
    peerSource: peer.target,
    document: options.document,
    fetchSource: options.fetchSource,
    watchForUpdate: (watch) =>
      waitForUpdate({
        hot: options.hot,
        timeoutMs: watch.timeoutMs ?? options.verifyTimeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS,
        settleMs: watch.settleMs ?? options.settleMs ?? DEFAULT_SETTLE_MS,
      }),
    onDiagnostic:
      options.onDiagnostic ??
      // Never swallowed: a refused origin or a malformed envelope is why the studio looks
      // frozen, and the frame's console is the only place that can say so.
      ((diagnostic) => {
        const detail = diagnostic.detail === undefined ? '' : ` — ${diagnostic.detail}`;
        console.warn(`[sve] preview rpc: ${diagnostic.kind}: ${diagnostic.message}${detail}`);
      }),
  });

  return { dispose: () => preview.dispose() };
}
