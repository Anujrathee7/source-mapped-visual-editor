/**
 * AC-9.3, AC-9.4 and AC-9.6, end to end over the in-memory pair that AC-9.5 requires —
 * correlation, timeouts, leaks, disconnection, re-handshaking and version refusal, all
 * asserted in Node with no browser anywhere near them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RPC_MARKER,
  RPC_VERSION,
  RpcError,
  createRpcClient,
  createRpcServer,
  createTransportPair,
  isRpcError,
  requestMessage,
  resultMessage,
  type MemoryTransport,
  type RpcClient,
  type RpcDiagnostic,
  type RpcHandlers,
  type RpcServer,
} from '../src/index.js';
import { inspectorState, intent, override, snapshot } from './fixture.js';

const STUDIO = 'https://studio.example';
const PREVIEW = 'http://localhost:5173';
const EVIL = 'https://evil.example';

const studioWindow = { name: 'studio' };
const previewWindow = { name: 'preview' };
const attackerWindow = { name: 'attacker' };

const LOC = 'apps/demo/src/Hero.tsx:42:7';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Enough microtask turns for a full request → handler → reply round trip. */
async function flush(turns = 12): Promise<void> {
  for (let i = 0; i < turns; i += 1) await Promise.resolve();
}

const defaultHandlers = (): RpcHandlers => ({
  currentLoc: () => LOC,
  select: () => null,
  getOverride: () => override,
  readSnapshot: () => snapshot,
  liftOverride: () => override,
  restoreOverride: () => null,
  captureIntent: () => intent,
  refresh: () => null,
  watchForUpdate: () => ({ settled: true }),
});

interface Harness {
  studio: MemoryTransport;
  preview: MemoryTransport;
  client: RpcClient;
  server: RpcServer;
  clientDiagnostics: RpcDiagnostic[];
  serverDiagnostics: RpcDiagnostic[];
  bootServer(): RpcServer;
}

function harness(overrides: Partial<RpcHandlers> = {}, timeoutMs = 1000): Harness {
  const [studio, preview] = createTransportPair(
    { origin: STUDIO, source: studioWindow },
    { origin: PREVIEW, source: previewWindow },
  );
  const clientDiagnostics: RpcDiagnostic[] = [];
  const serverDiagnostics: RpcDiagnostic[] = [];

  const bootServer = (): RpcServer =>
    createRpcServer({
      transport: preview,
      peerOrigin: STUDIO,
      peerSource: studioWindow,
      handlers: { ...defaultHandlers(), ...overrides },
      onDiagnostic: (d) => void serverDiagnostics.push(d),
    });

  const client = createRpcClient({
    transport: studio,
    peerOrigin: PREVIEW,
    peerSource: previewWindow,
    timeoutMs,
    onDiagnostic: (d) => void clientDiagnostics.push(d),
  });

  return {
    studio,
    preview,
    client,
    server: bootServer(),
    clientDiagnostics,
    serverDiagnostics,
    bootServer,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * AC-9.1 — parsed at the receiving end, in both directions
 * ──────────────────────────────────────────────────────────────────────────── */

describe('dispatch', () => {
  it('round-trips every method on the remote surface', async () => {
    const h = harness();
    await expect(h.client.call('currentLoc', { eid: 'a', eidIndex: 0 })).resolves.toBe(LOC);
    await expect(h.client.call('select', { anchor: { eid: 'a', eidIndex: 0 } })).resolves.toBeNull();
    await expect(h.client.call('getOverride', { eid: 'a' })).resolves.toEqual(override);
    await expect(h.client.call('readSnapshot', { eid: 'a', eidIndex: 0 })).resolves.toEqual(snapshot);
    await expect(h.client.call('liftOverride', { eid: 'a' })).resolves.toEqual(override);
    await expect(h.client.call('restoreOverride', { eid: 'a', override })).resolves.toBeNull();
    await expect(h.client.call('captureIntent', { kind: 'text' })).resolves.toEqual(intent);
    await expect(h.client.call('refresh', {})).resolves.toBeNull();
    await expect(h.client.call('watchForUpdate', {})).resolves.toEqual({ settled: true });
  });

  it('hands the handler params that have already been parsed', async () => {
    const readSnapshot = vi.fn(() => snapshot);
    const h = harness({ readSnapshot });
    await h.client.call('readSnapshot', { eid: 'hero', eidIndex: 3 });
    expect(readSnapshot).toHaveBeenCalledWith({ eid: 'hero', eidIndex: 3 });
  });

  it('reports a malformed request and never dispatches it', async () => {
    const readSnapshot = vi.fn(() => snapshot);
    const h = harness({ readSnapshot });

    h.preview.inject({
      data: { sve: RPC_MARKER, v: RPC_VERSION, kind: 'request', id: 'x', method: 'readSnapshot', params: { eid: 'a' } },
      origin: STUDIO,
      source: studioWindow,
    });
    await flush();

    expect(readSnapshot).not.toHaveBeenCalled();
    expect(h.serverDiagnostics.map((d) => d.kind)).toContain('parse');
  });

  it('rejects the caller when a reply fails the method result schema', async () => {
    const h = harness({ currentLoc: () => LOC });
    const pending = h.client.call('currentLoc', { eid: 'a', eidIndex: 0 });
    await flush(1);

    const id = (h.studio.sent.at(-1) as { id: string }).id;
    h.studio.inject({
      data: resultMessage(id, 'Hero.tsx:42'),
      origin: PREVIEW,
      source: previewWindow,
    });

    await expect(pending).rejects.toMatchObject({ code: 'parse' });
    expect(h.clientDiagnostics.map((d) => d.kind)).toContain('parse');
    expect(h.client.pending).toBe(0);
  });

  it('refuses to post a result its own schema rejects, rather than shipping it', async () => {
    const h = harness({ currentLoc: () => 'Hero.tsx:42' as never });
    await expect(h.client.call('currentLoc', { eid: 'a', eidIndex: 0 })).rejects.toMatchObject({
      code: 'handler',
    });
    expect(h.serverDiagnostics.map((d) => d.kind)).toContain('handler');
  });

  it('turns a throwing handler into an error reply, not an unhandled rejection', async () => {
    const h = harness({
      refresh: () => {
        throw new Error('the overlay is not mounted');
      },
    });
    await expect(h.client.call('refresh', {})).rejects.toMatchObject({
      code: 'handler',
      message: expect.stringContaining('not mounted'),
    });
  });

  it('turns a rejecting handler into an error reply', async () => {
    const h = harness({ watchForUpdate: () => Promise.reject(new Error('hot reload never came')) });
    await expect(h.client.call('watchForUpdate', {})).rejects.toMatchObject({ code: 'handler' });
  });

  it('replies unknown-method when a handler is missing', async () => {
    const handlers = defaultHandlers();
    delete (handlers as Partial<RpcHandlers>).refresh;
    const [studio, preview] = createTransportPair(
      { origin: STUDIO, source: studioWindow },
      { origin: PREVIEW, source: previewWindow },
    );
    createRpcServer({ transport: preview, peerOrigin: STUDIO, peerSource: studioWindow, handlers });
    const client = createRpcClient({ transport: studio, peerOrigin: PREVIEW, peerSource: previewWindow });

    await expect(client.call('refresh', {})).rejects.toMatchObject({ code: 'unknown-method' });
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * AC-9.1 — InspectorState travels parent-ward
 * ──────────────────────────────────────────────────────────────────────────── */

describe('events', () => {
  it('carries inspector state to the studio', async () => {
    const h = harness();
    const seen: unknown[] = [];
    h.client.on('inspectorState', (state) => void seen.push(state));

    h.server.emit('inspectorState', inspectorState);
    await flush();

    expect(seen).toEqual([inspectorState]);
  });

  it('stops delivering after unsubscribe', async () => {
    const h = harness();
    const seen: unknown[] = [];
    const stop = h.client.on('inspectorState', (state) => void seen.push(state));

    h.server.emit('inspectorState', inspectorState);
    await flush();
    stop();
    h.server.emit('inspectorState', inspectorState);
    await flush();

    expect(seen).toHaveLength(1);
  });

  it('drops a malformed event payload and reports it', async () => {
    const h = harness();
    const seen: unknown[] = [];
    h.client.on('inspectorState', (state) => void seen.push(state));

    h.studio.inject({
      data: { sve: RPC_MARKER, v: RPC_VERSION, kind: 'event', event: 'inspectorState', payload: { phase: 'idle' } },
      origin: PREVIEW,
      source: previewWindow,
    });
    await flush();

    expect(seen).toEqual([]);
    expect(h.clientDiagnostics.map((d) => d.kind)).toContain('parse');
  });

  it('refuses to emit a payload its own schema rejects', () => {
    const h = harness();
    expect(() => h.server.emit('inspectorState', { phase: 'idle' } as never)).toThrow(RpcError);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * AC-9.2 — origins are checked, over the in-memory pair (AC-9.5)
 * ──────────────────────────────────────────────────────────────────────────── */

describe('origin enforcement', () => {
  it('ignores a request injected from an unexpected origin', async () => {
    const refresh = vi.fn(() => null);
    const h = harness({ refresh });

    h.preview.inject({
      data: requestMessage('evil-1', 'refresh', {}),
      origin: EVIL,
      source: attackerWindow,
    });
    await flush();

    expect(refresh).not.toHaveBeenCalled();
    expect(h.preview.sent.some((m) => (m as { id?: string }).id === 'evil-1')).toBe(false);
    expect(h.serverDiagnostics.map((d) => d.kind)).toContain('origin');
  });

  it('ignores a response injected from an unexpected origin, leaving the call pending', async () => {
    const h = harness({ currentLoc: () => new Promise<string>(() => LOC) });
    const pending = h.client.call('currentLoc', { eid: 'a', eidIndex: 0 });
    let settled = false;
    void pending.then(
      () => void (settled = true),
      () => void (settled = true),
    );
    await flush(1);

    const id = (h.studio.sent.at(-1) as { id: string }).id;
    h.studio.inject({ data: resultMessage(id, 'evil.tsx:1:1'), origin: EVIL, source: attackerWindow });
    await flush();

    expect(settled).toBe(false);
    expect(h.client.pending).toBe(1);
    expect(h.clientDiagnostics.map((d) => d.kind)).toContain('origin');
  });

  it('ignores the right origin from the wrong window', async () => {
    const h = harness({ currentLoc: () => new Promise<string>(() => LOC) });
    void h.client.call('currentLoc', { eid: 'a', eidIndex: 0 }).catch(() => {});
    await flush(1);
    const id = (h.studio.sent.at(-1) as { id: string }).id;

    h.studio.inject({ data: resultMessage(id, LOC), origin: PREVIEW, source: attackerWindow });
    await flush();

    expect(h.client.pending).toBe(1);
    expect(h.clientDiagnostics.map((d) => d.kind)).toContain('source');
  });

  /**
   * The expected origin is configuration, not inference. If it were adopted from the
   * first message to arrive, the first attacker to post would win the handshake.
   */
  it('does not adopt the origin of whatever posts first', async () => {
    const h = harness();

    h.preview.inject({ data: requestMessage('evil-1', 'refresh', {}), origin: EVIL, source: attackerWindow });
    await flush();
    h.preview.inject({ data: requestMessage('evil-2', 'refresh', {}), origin: EVIL, source: attackerWindow });
    await flush();

    expect(h.serverDiagnostics.filter((d) => d.kind === 'origin')).toHaveLength(2);
    await expect(h.client.call('refresh', {})).resolves.toBeNull();
  });

  it('refuses to be constructed against a wildcard peer origin', () => {
    const [studio] = createTransportPair({ origin: STUDIO }, { origin: PREVIEW });
    expect(() => createRpcClient({ transport: studio, peerOrigin: '*' })).toThrow(RpcError);
    expect(() =>
      createRpcServer({ transport: studio, peerOrigin: '*', handlers: defaultHandlers() }),
    ).toThrow(RpcError);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * AC-9.3 — correlation, timeout, and no leaks
 * ──────────────────────────────────────────────────────────────────────────── */

describe('correlation', () => {
  it('resolves two in-flight requests to their own results, replied out of order', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const h = harness({
      currentLoc: ({ eid }) => (eid === 'first' ? first.promise : second.promise),
    });

    const a = h.client.call('currentLoc', { eid: 'first', eidIndex: 0 });
    const b = h.client.call('currentLoc', { eid: 'second', eidIndex: 0 });
    await flush();
    expect(h.client.pending).toBe(2);

    // Deliberately backwards.
    second.resolve('b.tsx:2:2');
    await flush();
    first.resolve('a.tsx:1:1');

    await expect(a).resolves.toBe('a.tsx:1:1');
    await expect(b).resolves.toBe('b.tsx:2:2');
    expect(h.client.pending).toBe(0);
  });

  it('gives every request a distinct id', async () => {
    const h = harness();
    await Promise.all([
      h.client.call('refresh', {}),
      h.client.call('refresh', {}),
      h.client.call('refresh', {}),
    ]);
    const ids = h.studio.sent.map((m) => (m as { id?: string }).id).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(3);
  });

  it('ignores a duplicate reply for an id that already settled, and does not leak it', async () => {
    const h = harness();
    await expect(h.client.call('currentLoc', { eid: 'a', eidIndex: 0 })).resolves.toBe(LOC);
    const id = (h.studio.sent.at(-1) as { id: string }).id;
    expect(h.client.pending).toBe(0);

    h.studio.inject({ data: resultMessage(id, 'other.tsx:9:9'), origin: PREVIEW, source: previewWindow });
    await flush();

    expect(h.client.pending).toBe(0);
    expect(h.clientDiagnostics.map((d) => d.kind)).toContain('unknown-response');
  });

  it('ignores a reply for an id it never sent', async () => {
    const h = harness();
    h.studio.inject({ data: resultMessage('never-sent', null), origin: PREVIEW, source: previewWindow });
    await flush();
    expect(h.client.pending).toBe(0);
    expect(h.clientDiagnostics.map((d) => d.kind)).toContain('unknown-response');
  });
});

describe('timeouts', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  /**
   * AC-9.3: the verification loop already depends on `stalled` being reachable. An RPC
   * that hung would turn a caught failure into a frozen UI.
   */
  it('rejects a request that is never answered', async () => {
    const h = harness({ watchForUpdate: () => new Promise<{ settled: boolean }>(() => {}) }, 5000);
    const pending = h.client.call('watchForUpdate', {});
    const assertion = expect(pending).rejects.toMatchObject({ code: 'timeout' });

    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });

  it('empties the pending map when a request times out', async () => {
    const h = harness({ refresh: () => new Promise<null>(() => {}) }, 5000);
    const pending = h.client.call('refresh', {});
    const assertion = expect(pending).rejects.toThrow(RpcError);
    expect(h.client.pending).toBe(1);

    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    expect(h.client.pending).toBe(0);
  });

  it('does not time out a request that was answered in time', async () => {
    const h = harness({}, 5000);
    const pending = h.client.call('refresh', {});
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBeNull();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.clientDiagnostics.map((d) => d.kind)).not.toContain('timeout');
    expect(h.client.pending).toBe(0);
  });

  it('ignores a reply that arrives after the deadline', async () => {
    const late = deferred<null>();
    const h = harness({ refresh: () => late.promise }, 5000);
    const pending = h.client.call('refresh', {});
    const assertion = expect(pending).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;

    late.resolve(null);
    await vi.advanceTimersByTimeAsync(1);

    expect(h.client.pending).toBe(0);
    expect(h.clientDiagnostics.map((d) => d.kind)).toContain('unknown-response');
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * AC-9.4 — disconnection is a state, not a crash
 * ──────────────────────────────────────────────────────────────────────────── */

describe('disconnection', () => {
  it('rejects in-flight requests with a distinguishable error', async () => {
    const h = harness({ refresh: () => new Promise<null>(() => {}) });
    const pending = h.client.call('refresh', {});
    await flush(1);

    h.client.disconnect('the preview iframe was removed');

    const error = await pending.catch((e: unknown) => e);
    expect(isRpcError(error, 'disconnected')).toBe(true);
    expect((error as RpcError).message).toContain('removed');
    expect(h.client.pending).toBe(0);
    expect(h.client.connected).toBe(false);
  });

  it('fails new requests fast rather than hanging', async () => {
    const h = harness();
    h.client.disconnect();
    await expect(h.client.call('refresh', {})).rejects.toMatchObject({ code: 'disconnected' });
    expect(h.studio.sent.some((m) => (m as { kind?: string }).kind === 'request')).toBe(false);
  });

  it('does not throw uncaught when a call is made after disconnect', async () => {
    const h = harness();
    h.client.disconnect();
    // A rejected promise, not a synchronous throw: the studio awaits these.
    const value = h.client.call('refresh', {});
    expect(value).toBeInstanceOf(Promise);
    await expect(value).rejects.toBeInstanceOf(RpcError);
  });

  /* A full page reload inside the iframe re-runs the overlay's boot. */
  describe('re-handshaking', () => {
    it('rejects requests left over from the previous document', async () => {
      const h = harness({ refresh: () => new Promise<null>(() => {}) });
      const orphan = h.client.call('refresh', {});
      await flush();
      expect(h.client.pending).toBe(1);

      h.server.dispose();
      h.bootServer();
      await flush();

      const error = await orphan.catch((e: unknown) => e);
      expect(isRpcError(error, 'disconnected')).toBe(true);
      expect(h.client.pending).toBe(0);
    });

    it('is usable again after the reload', async () => {
      const h = harness();
      h.client.disconnect();
      await expect(h.client.call('refresh', {})).rejects.toMatchObject({ code: 'disconnected' });

      h.server.dispose();
      h.bootServer();
      await flush();

      expect(h.client.connected).toBe(true);
      await expect(h.client.call('currentLoc', { eid: 'a', eidIndex: 0 })).resolves.toBe(LOC);
    });

    it('does not accumulate transport listeners across reloads', async () => {
      const h = harness();
      let server = h.server;
      for (let i = 0; i < 25; i += 1) {
        server.dispose();
        server = h.bootServer();
        await flush();
      }

      expect(h.studio.listenerCount).toBe(1);
      expect(h.preview.listenerCount).toBe(1);
      await expect(h.client.call('refresh', {})).resolves.toBeNull();
    });

    it('leaves no listener behind when either side is disposed', () => {
      const h = harness();
      expect(h.studio.listenerCount).toBe(1);
      expect(h.preview.listenerCount).toBe(1);
      h.client.dispose();
      h.server.dispose();
      expect(h.studio.listenerCount).toBe(0);
      expect(h.preview.listenerCount).toBe(0);
    });
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * AC-9.6 — versioned, and mismatch is loud
 * ──────────────────────────────────────────────────────────────────────────── */

describe('version mismatch', () => {
  const stale = (message: Record<string, unknown>): Record<string, unknown> => ({
    ...message,
    v: RPC_VERSION + 1,
  });

  it('stamps every outbound message with the protocol version', async () => {
    const h = harness();
    await h.client.call('refresh', {});
    h.server.emit('inspectorState', inspectorState);
    await flush();

    for (const message of [...h.studio.sent, ...h.preview.sent]) {
      expect(message).toMatchObject({ sve: RPC_MARKER, v: RPC_VERSION });
    }
  });

  it('refuses a peer speaking another version, loudly and by name', async () => {
    const h = harness({ refresh: () => new Promise<null>(() => {}) });
    const pending = h.client.call('refresh', {});
    await flush(1);

    h.studio.inject({
      data: stale({ sve: RPC_MARKER, kind: 'ready' }),
      origin: PREVIEW,
      source: previewWindow,
    });

    const error = await pending.catch((e: unknown) => e);
    expect(isRpcError(error, 'version')).toBe(true);

    const diagnostic = h.clientDiagnostics.find((d) => d.kind === 'version');
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.message).toContain(String(RPC_VERSION));
    expect(diagnostic?.message).toContain(String(RPC_VERSION + 1));
  });

  it('fails subsequent calls fast rather than half-speaking the wire', async () => {
    const h = harness();
    h.studio.inject({
      data: stale({ sve: RPC_MARKER, kind: 'ready' }),
      origin: PREVIEW,
      source: previewWindow,
    });
    await flush();

    await expect(h.client.call('refresh', {})).rejects.toMatchObject({ code: 'version' });
    expect(h.client.connected).toBe(false);
  });

  it('never dispatches a request from another version', async () => {
    const refresh = vi.fn(() => null);
    const h = harness({ refresh });

    h.preview.inject({
      data: stale({ ...requestMessage('stale-1', 'refresh', {}) }),
      origin: STUDIO,
      source: studioWindow,
    });
    await flush();

    expect(refresh).not.toHaveBeenCalled();
    expect(h.serverDiagnostics.map((d) => d.kind)).toContain('version');
  });

  it('is not reachable from an unexpected origin, so it cannot be used to jam the wire', async () => {
    const h = harness();
    h.studio.inject({
      data: stale({ sve: RPC_MARKER, kind: 'ready' }),
      origin: EVIL,
      source: attackerWindow,
    });
    await flush();

    expect(h.client.connected).toBe(true);
    expect(h.clientDiagnostics.map((d) => d.kind)).not.toContain('version');
    await expect(h.client.call('refresh', {})).resolves.toBeNull();
  });
});
