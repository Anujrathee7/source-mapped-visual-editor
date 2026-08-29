/**
 * The transport seam.
 *
 * The client and the server never touch a `Window`. They take `post` and `subscribe`,
 * which is the whole of what a message channel is, and the `window.postMessage`
 * implementation is supplied here at the edge. That is not a testing convenience bolted
 * on afterwards: AC-9.5 makes it the mechanism by which the origin checks are asserted at
 * all, in Node, on every run.
 */
import { RpcError } from './errors.js';

/**
 * The one place this literal is allowed to appear, and `test/transport.test.ts` scans
 * `src/` to keep it that way — comments included, so the guard cannot be talked around.
 *
 * A wildcard target delivers to whatever document currently occupies the target window,
 * which after a navigation the sender did not observe is an attacker's. Nothing here ever
 * names one as a destination; the constant exists to be compared against and refused.
 */
export const WILDCARD_ORIGIN = '*';

/** What a peer's message looks like once the realm has been stripped off it. */
export interface TransportMessage {
  data: unknown;
  /** `MessageEvent.origin`, verbatim. Never trusted, always compared. */
  origin: string;
  /** `MessageEvent.source`, verbatim. Compared by identity, never inspected. */
  source: unknown;
}

export interface Transport {
  post(message: unknown): void;
  /** Returns an unsubscribe function. */
  subscribe(listener: (message: TransportMessage) => void): () => void;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Inbound admission (AC-9.2)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface PeerIdentity {
  /**
   * Configuration, never inference. Adopting the origin of the first message to arrive
   * would hand the handshake to whichever page posts first, which is a race an attacker
   * wins by simply posting in a loop.
   */
  origin: string;
  /**
   * The expected window, when it is known. The studio does not hold the iframe's
   * `contentWindow` until it has loaded, and the overlay does not hold `window.parent`'s
   * identity as anything but `parent`; while it is unknown the origin check stands alone.
   */
  source?: unknown;
}

export type PeerVerdict = 'ok' | 'origin' | 'source';

/**
 * Origin first, window second. A message from a hostile origin must be refused before
 * anything else looks at it — including the version check, which on a mismatch refuses
 * the peer permanently and would otherwise be a one-message denial of service.
 */
export function acceptsPeer(message: TransportMessage, peer: PeerIdentity): PeerVerdict {
  if (peer.origin === WILDCARD_ORIGIN) {
    throw new RpcError('insecure-target', 'the expected peer origin may not be a wildcard');
  }
  // Exact string equality: `MessageEvent.origin` is already the serialised origin, so a
  // prefix or case-insensitive comparison only ever widens the set of accepted senders.
  if (message.origin !== peer.origin) return 'origin';
  if (peer.source !== undefined && message.source !== peer.source) return 'source';
  return 'ok';
}

/* ────────────────────────────────────────────────────────────────────────────
 * The window adapter
 * ──────────────────────────────────────────────────────────────────────────── */

export interface MessageEventLike {
  data: unknown;
  origin: string;
  source: unknown;
}

/** The two members of `Window` this file uses, so nothing here needs a DOM lib type. */
export interface PostTarget {
  postMessage(data: unknown, targetOrigin: string): void;
}

export interface MessageSource {
  addEventListener(type: 'message', listener: (event: MessageEventLike) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEventLike) => void): void;
}

export interface WindowTransportOptions {
  /** The peer window: `iframe.contentWindow` from the studio, `window.parent` from inside. */
  target: PostTarget;
  /** Where replies are sent. Validated as a real origin, and never a wildcard. */
  targetOrigin: string;
  /**
   * The window whose `message` events are ours. Injected rather than reached for, the
   * same discipline AC-8.1 imposes on the overlay's document.
   */
  listenOn: MessageSource;
}

function assertTargetOrigin(targetOrigin: string): void {
  if (targetOrigin === WILDCARD_ORIGIN) {
    throw new RpcError(
      'insecure-target',
      'a wildcard target origin delivers to whatever document occupies the window; name the peer origin',
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(targetOrigin);
  } catch {
    throw new RpcError('insecure-target', `not an origin: ${JSON.stringify(targetOrigin)}`);
  }
  // A path, a query or a trailing slash means the caller passed a URL, and `postMessage`
  // would silently compare only its origin part — so say so instead of narrowing quietly.
  if (parsed.origin !== targetOrigin) {
    throw new RpcError(
      'insecure-target',
      `expected an origin, got ${JSON.stringify(targetOrigin)} (did you mean ${parsed.origin}?)`,
    );
  }
}

export function createWindowTransport(options: WindowTransportOptions): Transport {
  const { target, targetOrigin, listenOn } = options;
  assertTargetOrigin(targetOrigin);

  return {
    post(message) {
      target.postMessage(message, targetOrigin);
    },
    subscribe(listener) {
      // The event is passed on with `origin` and `source` intact and no judgement applied:
      // the decision belongs to `acceptsPeer`, where it is testable without a browser.
      const handler = (event: MessageEventLike): void => {
        listener({ data: event.data, origin: event.origin, source: event.source });
      };
      listenOn.addEventListener('message', handler);
      return () => listenOn.removeEventListener('message', handler);
    },
  };
}
