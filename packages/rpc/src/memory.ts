/**
 * A pair of in-memory transports.
 *
 * This ships in `src` rather than in a test folder because AC-9.5 makes it load-bearing:
 * every criterion — the origin checks included — is asserted against it in Node, and
 * M13/M14 will drive the studio and the overlay against it for the same reason. A test
 * double the product depends on for its security assertions is part of the product.
 *
 * It models the two properties of `postMessage` that change behaviour: delivery is
 * asynchronous, and every message arrives stamped with the sender's origin and window.
 */
import type { Transport, TransportMessage } from './transport.js';

export interface MemoryPeer {
  origin: string;
  /** Stands in for a `Window`. Compared by identity only, so any object will do. */
  source?: unknown;
}

export interface MemoryTransport extends Transport {
  readonly origin: string;
  readonly source: unknown;
  /** Everything handed to `post`, in order. */
  readonly sent: readonly unknown[];
  /** AC-9.4: a re-handshake must not grow this. */
  readonly listenerCount: number;
  /**
   * Deliver a message as if it came from an arbitrary peer — the attacker's move, and
   * the only way to exercise the origin checks without a second browsing context.
   */
  inject(message: TransportMessage): void;
  /** Posts become no-ops, the way they do to a window that has gone away. */
  close(): void;
}

type Listeners = Set<(message: TransportMessage) => void>;

/**
 * One listener throwing must not swallow the others' messages. That is also how a real
 * `message` handler behaves: an exception goes to the page's error handler, not back to
 * whoever dispatched the event.
 */
function fan(targets: Listeners, message: TransportMessage): void {
  for (const listener of [...targets]) {
    try {
      listener(message);
    } catch {
      /* an endpoint reports its own faults on the diagnostics channel */
    }
  }
}

function createSide(self: MemoryPeer, own: Listeners, peer: Listeners): MemoryTransport {
  const sent: unknown[] = [];
  let closed = false;

  return {
    origin: self.origin,
    source: self.source,
    sent,
    get listenerCount() {
      return own.size;
    },
    post(message) {
      sent.push(message);
      if (closed) return;
      // A microtask, not a synchronous call: `postMessage` is a task, and a transport
      // that delivered inline would hide every ordering bug the correlation specs exist
      // to catch.
      queueMicrotask(() => fan(peer, { data: message, origin: self.origin, source: self.source }));
    },
    subscribe(listener) {
      own.add(listener);
      return () => void own.delete(listener);
    },
    inject(message) {
      fan(own, message);
    },
    close() {
      closed = true;
    },
  };
}

/**
 * Two transports wired to each other. `a.post(x)` arrives at `b`'s subscribers on a
 * microtask, stamped `{ origin: a.origin, source: a.source }`.
 */
export function createTransportPair(
  a: MemoryPeer,
  b: MemoryPeer,
): [MemoryTransport, MemoryTransport] {
  const listenersA: Listeners = new Set();
  const listenersB: Listeners = new Set();
  return [createSide(a, listenersA, listenersB), createSide(b, listenersB, listenersA)];
}
