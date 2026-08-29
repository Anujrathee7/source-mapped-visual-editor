/**
 * The caller's side: the studio talking to an overlay it cannot reach into.
 *
 * Three things can happen to a request other than an answer, and all three are states
 * rather than crashes: it can time out, the peer can go away, or the peer can turn out
 * to speak another protocol. Each ends the same way — the promise rejects with an
 * `RpcError` whose `code` says which — because AC-9.4's requirement is that the studio be
 * able to *say* the preview is gone, and it can only say what it can distinguish.
 */
import { RpcError } from './errors.js';
import {
  createEndpoint,
  type Endpoint,
  type RpcDiagnostic,
  type RpcDiagnosticKind,
} from './endpoint.js';
import {
  RPC_METHODS,
  RPC_VERSION,
  requestMessage,
  type RpcEventName,
  type RpcMethod,
  type RpcParams,
  type RpcPayload,
  type RpcResult,
} from './schema.js';
import type { Transport } from './transport.js';

/**
 * Long enough that a cold agent round trip inside `watchForUpdate` is not cut short,
 * short enough that a frozen preview surfaces while the user still remembers what they
 * clicked. Per-call deadlines belong to the caller; this is the floor.
 */
export const DEFAULT_TIMEOUT_MS = 10_000;

export interface RpcClientOptions {
  transport: Transport;
  peerOrigin: string;
  peerSource?: unknown;
  timeoutMs?: number;
  onDiagnostic?: (diagnostic: RpcDiagnostic) => void;
  /** Fired when the peer announces a boot — including a re-boot after a reload. */
  onReady?: () => void;
  /** Ids are only ever meaningful inside this client's own pending map. */
  newId?: () => string;
}

export interface RpcClient {
  call<M extends RpcMethod>(method: M, params: RpcParams<M>): Promise<RpcResult<M>>;
  on<E extends RpcEventName>(event: E, handler: (payload: RpcPayload<E>) => void): () => void;
  /**
   * How many requests are awaiting a reply.
   *
   * AC-9.3 requires the pending map to return to empty after a settle, a timeout and a
   * late duplicate. This is the smallest thing that makes that assertable without
   * publishing the map itself.
   */
  readonly pending: number;
  readonly connected: boolean;
  /** AC-9.4: the iframe navigated, reloaded, or was removed. */
  disconnect(reason?: string): void;
  dispose(): void;
}

interface PendingRequest {
  method: RpcMethod;
  resolve: (value: never) => void;
  reject: (error: RpcError) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_DISCONNECT_REASON = 'the preview is no longer connected';

function defaultIdFactory(): () => string {
  // A per-client prefix keeps ids readable in a log where two clients interleave; the
  // counter does the actual work, since an id only has to be unique within one map.
  const prefix = Math.random().toString(36).slice(2, 8);
  let n = 0;
  return () => `${prefix}-${(n += 1)}`;
}

export function createRpcClient(options: RpcClientOptions): RpcClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const newId = options.newId ?? defaultIdFactory();
  const pending = new Map<string, PendingRequest>();
  const listeners = new Map<RpcEventName, Set<(payload: never) => void>>();

  /**
   * Non-null means "no request can succeed until something changes". Set by `disconnect`
   * and by a version refusal, cleared only by the peer announcing a fresh boot.
   */
  let failure: RpcError | null = null;
  /** A version refusal outlives a reload; a disconnection does not. See `onVersionMismatch`. */
  let terminal = false;
  /**
   * Boots announced by the peer. The first is the handshake completing — requests posted
   * while it was in flight are addressed to the document now announcing itself. Every
   * later one is a *re*-boot: a document boundary, on the far side of which nothing this
   * client sent will ever be answered.
   */
  let boots = 0;
  let disposed = false;

  const settle = (id: string): PendingRequest | undefined => {
    const entry = pending.get(id);
    if (!entry) return undefined;
    pending.delete(id);
    clearTimeout(entry.timer);
    return entry;
  };

  /** Empties the map in one pass. Every waiter learns why; none is left hanging. */
  const failAll = (error: RpcError): void => {
    const entries = [...pending.values()];
    pending.clear();
    for (const entry of entries) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
  };

  const endpoint: Endpoint = createEndpoint({
    transport: options.transport,
    peerOrigin: options.peerOrigin,
    peerSource: options.peerSource,
    onDiagnostic: options.onDiagnostic,

    onVersionMismatch: (peerVersion) => {
      // Loud, and terminal. Parsing a half-compatible wire on a best-effort basis
      // produces failures that look like verification bugs, which is the worst possible
      // disguise for them — so once a peer has spoken another version, this client stops
      // speaking to it at all. A peer that re-announces itself is still the stale build;
      // recovering means a new client, which is what a studio reload gives you.
      const error = new RpcError(
        'version',
        `peer speaks @sve/rpc v${peerVersion}; this build speaks v${RPC_VERSION}`,
      );
      terminal = true;
      failure = error;
      failAll(error);
    },

    onMessage: (message) => {
      switch (message.kind) {
        case 'ready': {
          boots += 1;
          // A reload re-runs the overlay's boot. Anything still pending belongs to the
          // document that just went away and will never be answered.
          if (boots > 1 && pending.size > 0) {
            report('connection', 'the preview reloaded; in-flight requests were dropped');
            failAll(new RpcError('disconnected', 'the preview reloaded while this request was in flight'));
          }
          // Note there is no re-subscription here: the transport listener is attached
          // once, for the endpoint's whole life, so re-handshaking cannot grow it.
          if (!terminal) failure = null;
          options.onReady?.();
          return;
        }
        case 'response': {
          const entry = settle(message.id);
          if (!entry) {
            // Late, duplicate, or invented. Dropped, and counted — this is the path that
            // would otherwise leave a handler in the map forever.
            report('unknown-response', `no request is pending for id ${message.id}`);
            return;
          }
          if (!message.ok) {
            entry.reject(new RpcError(message.error.code, message.error.message));
            return;
          }
          // The result's schema is chosen by the *pending* method, which only this side
          // knows. Parsed before the promise resolves: never dispatched partially.
          const parsed = RPC_METHODS[entry.method].result.safeParse(message.result);
          if (!parsed.success) {
            const detail = parsed.error.issues[0]?.message ?? 'invalid result';
            report('parse', `${entry.method} returned a result its schema rejects`, detail);
            entry.reject(new RpcError('parse', `${entry.method}: ${detail}`));
            return;
          }
          entry.resolve(parsed.data as never);
          return;
        }
        case 'event': {
          for (const handler of [...(listeners.get(message.event) ?? [])]) {
            handler(message.payload as never);
          }
          return;
        }
        case 'request':
          // The studio answers nothing. A request arriving here is a peer confusion, not
          // a surface to grow by accident.
          report('unknown-method', `the studio does not serve requests (${message.method})`);
          return;
      }
    },
  });

  function report(kind: RpcDiagnosticKind, message: string, detail?: string): void {
    endpoint.report(detail === undefined ? { kind, message } : { kind, message, detail });
  }

  return {
    call<M extends RpcMethod>(method: M, params: RpcParams<M>): Promise<RpcResult<M>> {
      if (disposed) {
        return Promise.reject(new RpcError('disconnected', 'this client has been disposed'));
      }
      // Fail fast, as a rejection rather than a throw: every caller already awaits.
      if (failure) return Promise.reject(failure);

      const id = newId();
      return new Promise<RpcResult<M>>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(
            new RpcError('timeout', `${method} did not answer within ${timeoutMs}ms`),
          );
        }, timeoutMs);

        pending.set(id, {
          method,
          resolve: resolve as (value: never) => void,
          reject,
          timer,
        });
        endpoint.post(requestMessage(id, method, params));
      });
    },

    on<E extends RpcEventName>(event: E, handler: (payload: RpcPayload<E>) => void): () => void {
      const set = listeners.get(event) ?? new Set();
      listeners.set(event, set);
      set.add(handler as (payload: never) => void);
      return () => void set.delete(handler as (payload: never) => void);
    },

    get pending() {
      return pending.size;
    },

    get connected() {
      return !disposed && failure === null;
    },

    disconnect(reason) {
      const error = new RpcError('disconnected', reason ?? DEFAULT_DISCONNECT_REASON);
      failure = error;
      failAll(error);
    },

    dispose() {
      disposed = true;
      failAll(new RpcError('disconnected', 'this client has been disposed'));
      listeners.clear();
      endpoint.dispose();
    },
  };
}
