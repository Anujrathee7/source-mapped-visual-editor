/**
 * The studio's handle on a page it cannot touch.
 *
 * Every member below is one `@sve/rpc` call. What this adds over the raw client is the
 * thing AC-12.4 asks for: a *state*. A preview that navigated, crashed or was stopped
 * rejects rather than waits — that is `@sve/rpc`'s doing — and this is where a rejection
 * stops being an exception somebody has to catch and becomes "the preview is gone",
 * rendered once, with a way back.
 */
import type { Override } from '@sve/overlay';
import type { EditIntent, EditKind, Snapshot } from '@sve/protocol';
import {
  createRpcClient,
  isRpcError,
  type AnchorRef,
  type InspectorState,
  type RpcClient,
  type RpcDiagnostic,
  type RpcMethod,
  type RpcParams,
  type RpcResult,
  type Transport,
} from '@sve/rpc';
import type { AsyncLoopTarget } from './loop.js';

export type PreviewStatus = 'connecting' | 'connected' | 'disconnected';

/**
 * How long the frame is allowed to wait for hot reload before it must answer.
 *
 * Deliberately under the rpc client's own deadline. If the two were equal the client would
 * time the call out at the same instant the frame answered "it never settled", and a
 * caught stall would surface as a lost connection.
 */
export const WATCH_TIMEOUT_MS = 8_000;

export interface PreviewControllerOptions {
  client: RpcClient;
  watchTimeoutMs?: number;
}

export interface PreviewController {
  readonly status: PreviewStatus;
  readonly state: InspectorState | null;
  /** Why the preview is not connected, in the words the failure arrived in. */
  readonly lastError: string | null;
  /** The six calls the verification loop makes, and nothing else. */
  readonly target: AsyncLoopTarget;
  subscribe(listener: () => void): () => void;
  select(anchor: AnchorRef | null): Promise<void>;
  captureIntent(kind: EditKind): Promise<EditIntent | null>;
  getOverride(eid: string): Promise<Override | null>;
  setOverride(eid: string, override: Override): Promise<void>;
  clearOverride(eid: string): Promise<Override | null>;
  refresh(): Promise<void>;
  currentLoc(eid: string, eidIndex: number): Promise<string | null>;
  readSnapshot(eid: string, eidIndex: number): Promise<Snapshot | null>;
  /** Marks the preview gone. In-flight calls reject; new ones fail fast. */
  disconnect(reason?: string): void;
  /**
   * The peer announced a boot — the handshake, or a reload on the far side.
   *
   * Called by whatever owns the client, because `RpcClient` takes `onReady` at
   * construction and the client necessarily exists before this does.
   */
  noteReady(): void;
  dispose(): void;
}

export function createPreviewController(options: PreviewControllerOptions): PreviewController {
  const { client } = options;
  const watchTimeoutMs = options.watchTimeoutMs ?? WATCH_TIMEOUT_MS;
  const listeners = new Set<() => void>();

  let status: PreviewStatus = 'connecting';
  let state: InspectorState | null = null;
  let lastError: string | null = null;

  const announce = (): void => {
    for (const listener of [...listeners]) listener();
  };

  const setStatus = (next: PreviewStatus, error: string | null): void => {
    if (status === next && lastError === error) return;
    status = next;
    lastError = error;
    announce();
  };

  const unsubscribeState = client.on('inspectorState', (payload) => {
    state = payload;
    announce();
  });

  /**
   * One place where a failed call becomes a state.
   *
   * `disconnected` and `timeout` are the two codes that mean the far side is not there —
   * AC-9.3 and AC-9.4 make them distinguishable precisely so this can say which. Anything
   * else is a handler fault and leaves the connection standing.
   */
  async function call<M extends RpcMethod>(method: M, params: RpcParams<M>): Promise<RpcResult<M>> {
    try {
      const result = await client.call(method, params);
      setStatus('connected', null);
      return result;
    } catch (error) {
      if (isRpcError(error, 'disconnected') || isRpcError(error, 'timeout') || isRpcError(error, 'version')) {
        setStatus('disconnected', error.message);
      }
      throw error;
    }
  }

  const target: AsyncLoopTarget = {
    currentLoc: (eid, eidIndex) => call('currentLoc', { eid, eidIndex }),
    readSnapshot: (eid, eidIndex) => call('readSnapshot', { eid, eidIndex }),
    liftOverride: (eid) => call('liftOverride', { eid }),
    restoreOverride: async (eid, override) => {
      await call('restoreOverride', { eid, override });
    },
    refresh: async () => {
      await call('refresh', {});
    },
    watchForUpdate: async () => (await call('watchForUpdate', { timeoutMs: watchTimeoutMs })).settled,
  };

  return {
    get status() {
      return status;
    },
    get state() {
      return state;
    },
    get lastError() {
      return lastError;
    },
    target,

    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    async select(anchor) {
      await call('select', { anchor });
    },

    captureIntent: (kind) => call('captureIntent', { kind }),
    getOverride: (eid) => call('getOverride', { eid }),
    async setOverride(eid, override) {
      await call('restoreOverride', { eid, override });
    },
    clearOverride: (eid) => call('liftOverride', { eid }),
    async refresh() {
      await call('refresh', {});
    },
    currentLoc: (eid, eidIndex) => call('currentLoc', { eid, eidIndex }),
    readSnapshot: (eid, eidIndex) => call('readSnapshot', { eid, eidIndex }),

    disconnect(reason) {
      client.disconnect(reason);
      setStatus('disconnected', reason ?? 'the preview is no longer connected');
    },

    noteReady() {
      setStatus('connected', null);
    },

    dispose() {
      unsubscribeState();
      listeners.clear();
    },
  };
}

export interface PreviewLinkOptions {
  transport: Transport;
  /** The preview's origin. Configuration, never inferred, and never a wildcard. */
  peerOrigin: string;
  peerSource?: unknown;
  timeoutMs?: number;
  watchTimeoutMs?: number;
  onDiagnostic?(diagnostic: RpcDiagnostic): void;
}

export interface PreviewLink {
  client: RpcClient;
  controller: PreviewController;
  dispose(): void;
}

/**
 * A client and a controller, joined so that a boot on the far side is a reconnection here.
 *
 * The order matters and is the reason this exists: the client subscribes to the transport,
 * and a frame that announced itself before anyone was listening is a handshake nobody
 * completes. Build this before the iframe is given a window to post into.
 */
export function connectPreview(options: PreviewLinkOptions): PreviewLink {
  let announceReady: () => void = () => undefined;

  const client = createRpcClient({
    transport: options.transport,
    peerOrigin: options.peerOrigin,
    ...(options.peerSource === undefined ? {} : { peerSource: options.peerSource }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
    onReady: () => announceReady(),
  });

  const controller = createPreviewController({
    client,
    ...(options.watchTimeoutMs === undefined ? {} : { watchTimeoutMs: options.watchTimeoutMs }),
  });
  announceReady = () => controller.noteReady();

  return {
    client,
    controller,
    dispose: () => {
      controller.dispose();
      client.dispose();
    },
  };
}
