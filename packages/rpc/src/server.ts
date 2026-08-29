/**
 * The handler side: the overlay, inside the iframe, answering a parent it does not trust.
 *
 * The whole surface is `parse, dispatch, reply`, and the only real rule is that no path
 * out of here throws. A handler that throws past the message listener becomes an
 * unhandled rejection in the user's own page, and the studio waits on a promise that will
 * never settle until its deadline — a hang dressed up as a slow edit.
 */
import { RpcError } from './errors.js';
import {
  createEndpoint,
  type Endpoint,
  type RpcDiagnostic,
} from './endpoint.js';
import {
  RPC_EVENTS,
  RPC_METHODS,
  errorMessage,
  eventMessage,
  readyMessage,
  resultMessage,
  type RpcEventName,
  type RpcMethod,
  type RpcParams,
  type RpcPayload,
  type RpcResult,
} from './schema.js';
import type { Transport } from './transport.js';

export type RpcHandlers = {
  [M in RpcMethod]: (params: RpcParams<M>) => RpcResult<M> | Promise<RpcResult<M>>;
};

export interface RpcServerOptions {
  transport: Transport;
  peerOrigin: string;
  peerSource?: unknown;
  handlers: RpcHandlers;
  onDiagnostic?: (diagnostic: RpcDiagnostic) => void;
  /**
   * Announce a boot on construction. On by default: this *is* AC-9.4's handshake, and a
   * reload that did not announce itself would leave the studio waiting on requests the
   * previous document took with it.
   */
  announce?: boolean;
}

export interface RpcServer {
  emit<E extends RpcEventName>(event: E, payload: RpcPayload<E>): void;
  /** Announce a boot. Called for you on construction unless `announce` is false. */
  ready(): void;
  /** Requests whose handlers have not returned yet. */
  readonly inflight: number;
  dispose(): void;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createRpcServer(options: RpcServerOptions): RpcServer {
  const { handlers } = options;
  let inflight = 0;
  let disposed = false;

  const endpoint: Endpoint = createEndpoint({
    transport: options.transport,
    peerOrigin: options.peerOrigin,
    peerSource: options.peerSource,
    onDiagnostic: options.onDiagnostic,

    // The overlay cannot usefully answer a peer on another version — its reply would be
    // refused in turn — so it reports and drops. The studio's own deadline is what turns
    // that into a visible failure rather than a hang.
    onVersionMismatch: () => {},

    onMessage: (message) => {
      if (message.kind !== 'request') return;
      const { id, method, params } = message;

      const handler: RpcHandlers[RpcMethod] | undefined = handlers[method];
      if (typeof handler !== 'function') {
        endpoint.report({ kind: 'unknown-method', message: `no handler for ${method}` });
        endpoint.post(errorMessage(id, { code: 'unknown-method', message: `no handler for ${method}` }));
        return;
      }

      const fail = (error: unknown): void => {
        const detail = messageOf(error);
        endpoint.report({ kind: 'handler', message: `${method} failed`, detail });
        endpoint.post(errorMessage(id, new RpcError('handler', detail).toPayload()));
      };

      const succeed = (value: unknown): void => {
        // The result is validated on the way out as well as on the way in. A handler
        // returning something un-serialisable — a DOM node, an undefined — would
        // otherwise cross as a message the studio can only report as malformed, with no
        // trace of which handler produced it.
        const parsed = RPC_METHODS[method].result.safeParse(value);
        if (!parsed.success) {
          fail(new Error(`${method} returned a value its result schema rejects: ${parsed.error.issues[0]?.message ?? 'invalid'}`));
          return;
        }
        endpoint.post(resultMessage(id, parsed.data));
      };

      inflight += 1;
      const done = (): void => void (inflight -= 1);

      let outcome: unknown;
      try {
        outcome = (handler as (p: unknown) => unknown)(params);
      } catch (error) {
        done();
        fail(error);
        return;
      }

      Promise.resolve(outcome).then(
        (value) => {
          done();
          succeed(value);
        },
        (error: unknown) => {
          done();
          fail(error);
        },
      );
    },
  });

  const server: RpcServer = {
    emit(event, payload) {
      // Thrown, not reported: emitting a malformed event is a bug on this side of the
      // wire, and the peer would only be able to say "something arrived broken".
      const parsed = RPC_EVENTS[event].safeParse(payload);
      if (!parsed.success) {
        throw new RpcError(
          'parse',
          `${event}: ${parsed.error.issues[0]?.message ?? 'invalid payload'}`,
        );
      }
      endpoint.post(eventMessage(event, parsed.data as RpcPayload<typeof event>));
    },

    ready() {
      endpoint.post(readyMessage());
    },

    get inflight() {
      return inflight;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      endpoint.dispose();
    },
  };

  if (options.announce ?? true) server.ready();

  return server;
}
