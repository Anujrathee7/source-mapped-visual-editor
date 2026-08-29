/**
 * The half of the client and the server that is identical: one subscription, and one
 * gauntlet every inbound value walks before anything else sees it.
 *
 * Order is the design. Origin, then window, then marker, then version, then schema —
 * each step's failure mode is cheaper than the next one's, and more importantly the
 * version step refuses the peer *permanently*, so it must sit behind the origin check or
 * any page on the internet could jam the wire with a single message.
 */
import { RpcError } from './errors.js';
import { RPC_VERSION, parseEnvelope, type RpcMessage } from './schema.js';
import { WILDCARD_ORIGIN, acceptsPeer, type Transport, type TransportMessage } from './transport.js';

export const RPC_DIAGNOSTIC_KINDS = [
  /** A message arrived from an unexpected origin. */
  'origin',
  /** The origin matched but the window did not. */
  'source',
  /** The peer speaks another protocol version (AC-9.6). */
  'version',
  /** Our marker, our version, malformed body (AC-9.1). */
  'parse',
  /** A reply for an id that is not pending: late, duplicate, or invented. */
  'unknown-response',
  /** A request naming a method this peer has no handler for. */
  'unknown-method',
  /** A handler threw, or returned a value its own result schema rejects. */
  'handler',
  /** The peer went away, or came back (AC-9.4). */
  'connection',
] as const;

export type RpcDiagnosticKind = (typeof RPC_DIAGNOSTIC_KINDS)[number];

/**
 * Never swallowed and never thrown. A malformed message is data about the peer, not an
 * exception in this process — throwing past a `message` handler produces an unhandled
 * rejection with no owner, which is precisely the shape of failure AC-9.1 forbids.
 */
export interface RpcDiagnostic {
  kind: RpcDiagnosticKind;
  message: string;
  detail?: string;
}

export interface EndpointOptions {
  transport: Transport;
  /** Configuration, never inferred from the first message to arrive (AC-9.2). */
  peerOrigin: string;
  /** The expected window, once it is known. */
  peerSource?: unknown;
  onDiagnostic?: (diagnostic: RpcDiagnostic) => void;
  onMessage: (message: RpcMessage) => void;
  /** Called once per mismatched-version message, from an accepted origin only. */
  onVersionMismatch: (peerVersion: number) => void;
}

export interface Endpoint {
  post(message: RpcMessage): void;
  report(diagnostic: RpcDiagnostic): void;
  dispose(): void;
}

export function createEndpoint(options: EndpointOptions): Endpoint {
  const { transport, peerOrigin, peerSource, onMessage, onVersionMismatch } = options;

  // Checked at construction rather than on the first message, so a misconfiguration is a
  // startup failure the developer sees instead of a hole that opens under traffic.
  if (peerOrigin === WILDCARD_ORIGIN) {
    throw new RpcError('insecure-target', 'the expected peer origin may not be a wildcard');
  }

  const report = (diagnostic: RpcDiagnostic): void => options.onDiagnostic?.(diagnostic);

  const receive = (inbound: TransportMessage): void => {
    const verdict = acceptsPeer(inbound, { origin: peerOrigin, source: peerSource });
    if (verdict === 'origin') {
      report({
        kind: 'origin',
        message: `refused a message from ${inbound.origin}; this peer is ${peerOrigin}`,
      });
      return;
    }
    if (verdict === 'source') {
      report({
        kind: 'source',
        message: `refused a message from ${inbound.origin}: right origin, wrong window`,
      });
      return;
    }

    const parsed = parseEnvelope(inbound.data);
    if (parsed.ok) {
      onMessage(parsed.message);
      return;
    }

    switch (parsed.reason) {
      // Not ours. A window message channel carries the HMR client, devtools bridges and
      // extensions; reporting all of that would bury the faults worth reading.
      case 'foreign':
        return;
      case 'version':
        report({
          kind: 'version',
          message: `peer speaks @sve/rpc v${parsed.peerVersion}; this build speaks v${RPC_VERSION}`,
        });
        onVersionMismatch(parsed.peerVersion);
        return;
      case 'parse':
        report({ kind: 'parse', message: 'refused a malformed message', detail: parsed.detail });
        return;
    }
  };

  // Exactly one subscription for the endpoint's whole life. AC-9.4's re-handshake goes
  // through `ready`, not through re-subscribing, so a reloading iframe cannot grow this.
  const unsubscribe = transport.subscribe((inbound) => {
    try {
      receive(inbound);
    } catch (error) {
      // Only a listener of ours can get here — `parseEnvelope` does not throw. Reporting
      // it keeps a bug in a handler from escaping as an unhandled rejection.
      report({
        kind: 'handler',
        message: 'a message handler threw',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });

  let disposed = false;

  return {
    post(message) {
      if (disposed) return;
      transport.post(message);
    },
    report,
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
    },
  };
}
