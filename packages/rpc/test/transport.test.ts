import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  RpcError,
  WILDCARD_ORIGIN,
  acceptsPeer,
  createTransportPair,
  createWindowTransport,
  isRpcError,
  readyMessage,
  type MessageEventLike,
  type MessageSource,
  type TransportMessage,
} from '../src/index.js';

const STUDIO = 'https://studio.example';
const PREVIEW = 'http://localhost:5173';

/* ────────────────────────────────────────────────────────────────────────────
 * AC-9.2 — the inbound check, as a pure function
 * ──────────────────────────────────────────────────────────────────────────── */

const overlayWindow = { name: 'overlay' };
const attackerWindow = { name: 'attacker' };

const inbound = (patch: Partial<TransportMessage> = {}): TransportMessage => ({
  data: readyMessage(),
  origin: PREVIEW,
  source: overlayWindow,
  ...patch,
});

describe('acceptsPeer', () => {
  it('admits a message from the configured origin and window', () => {
    expect(acceptsPeer(inbound(), { origin: PREVIEW, source: overlayWindow })).toBe('ok');
  });

  it('rejects a message from another origin', () => {
    expect(acceptsPeer(inbound({ origin: 'https://evil.example' }), { origin: PREVIEW })).toBe('origin');
  });

  it('rejects a look-alike origin rather than matching on a prefix', () => {
    for (const origin of [
      'http://localhost:5174',
      'http://localhost:5173.evil.example',
      'https://localhost:5173',
      'http://localhost:5173/',
      'HTTP://LOCALHOST:5173',
    ]) {
      expect(acceptsPeer(inbound({ origin }), { origin: PREVIEW }), origin).toBe('origin');
    }
  });

  it('rejects the right origin from the wrong window', () => {
    const verdict = acceptsPeer(inbound({ source: attackerWindow }), {
      origin: PREVIEW,
      source: overlayWindow,
    });
    expect(verdict).toBe('source');
  });

  it('checks the origin before the window, so a hostile frame never reaches the identity check', () => {
    const verdict = acceptsPeer(inbound({ origin: 'https://evil.example', source: attackerWindow }), {
      origin: PREVIEW,
      source: overlayWindow,
    });
    expect(verdict).toBe('origin');
  });

  it('accepts any window when no expected window is configured yet', () => {
    // The studio does not hold the iframe's contentWindow until it has loaded; the origin
    // check still applies in the meantime.
    expect(acceptsPeer(inbound({ source: attackerWindow }), { origin: PREVIEW })).toBe('ok');
  });

  it('rejects a null source when a window is expected', () => {
    expect(acceptsPeer(inbound({ source: null }), { origin: PREVIEW, source: overlayWindow })).toBe('source');
  });

  it('refuses to treat a wildcard as a configured origin', () => {
    expect(() => acceptsPeer(inbound(), { origin: WILDCARD_ORIGIN })).toThrow(RpcError);
    try {
      acceptsPeer(inbound({ origin: WILDCARD_ORIGIN }), { origin: WILDCARD_ORIGIN });
    } catch (error) {
      expect(isRpcError(error, 'insecure-target')).toBe(true);
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * AC-9.2 — the real window adapter names an explicit target origin
 * ──────────────────────────────────────────────────────────────────────────── */

function fakeWindow() {
  const listeners = new Set<(event: MessageEventLike) => void>();
  const posted: Array<{ data: unknown; targetOrigin: string }> = [];
  const source: MessageSource = {
    addEventListener: (_type, listener) => void listeners.add(listener),
    removeEventListener: (_type, listener) => void listeners.delete(listener),
  };
  return {
    source,
    posted,
    get listenerCount() {
      return listeners.size;
    },
    postMessage: (data: unknown, targetOrigin: string) => void posted.push({ data, targetOrigin }),
    deliver: (event: MessageEventLike) => {
      for (const listener of [...listeners]) listener(event);
    },
  };
}

describe('createWindowTransport', () => {
  it('names the configured target origin on every post', () => {
    const peer = fakeWindow();
    const transport = createWindowTransport({
      target: peer,
      targetOrigin: PREVIEW,
      listenOn: peer.source,
    });

    transport.post(readyMessage());
    transport.post(readyMessage());

    expect(peer.posted).toHaveLength(2);
    for (const call of peer.posted) {
      expect(call.targetOrigin).toBe(PREVIEW);
      expect(call.targetOrigin).not.toBe(WILDCARD_ORIGIN);
    }
  });

  it('refuses to be constructed with a wildcard target origin', () => {
    const peer = fakeWindow();
    expect(() =>
      createWindowTransport({ target: peer, targetOrigin: WILDCARD_ORIGIN, listenOn: peer.source }),
    ).toThrow(RpcError);
  });

  it.each(['', '   ', 'not-an-origin', 'https://studio.example/preview'])(
    'refuses the target origin %o',
    (targetOrigin) => {
      const peer = fakeWindow();
      expect(() => createWindowTransport({ target: peer, targetOrigin, listenOn: peer.source })).toThrow(
        RpcError,
      );
    },
  );

  it('surfaces the event origin and source untouched, leaving the decision to acceptsPeer', () => {
    const peer = fakeWindow();
    const transport = createWindowTransport({
      target: peer,
      targetOrigin: PREVIEW,
      listenOn: peer.source,
    });
    const seen: TransportMessage[] = [];
    transport.subscribe((message) => void seen.push(message));

    peer.deliver({ data: 'payload', origin: 'https://evil.example', source: attackerWindow });

    expect(seen).toEqual([{ data: 'payload', origin: 'https://evil.example', source: attackerWindow }]);
  });

  it('unsubscribes its listener', () => {
    const peer = fakeWindow();
    const transport = createWindowTransport({
      target: peer,
      targetOrigin: PREVIEW,
      listenOn: peer.source,
    });
    const stop = transport.subscribe(() => {});
    expect(peer.listenerCount).toBe(1);
    stop();
    expect(peer.listenerCount).toBe(0);
  });
});

/**
 * AC-9.2 — "`'*'` appears nowhere" enforced by the suite rather than by review.
 *
 * A convention that only a reviewer upholds is a convention that eventually does not hold.
 */
describe('the source of this package', () => {
  const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
  const files = readdirSync(srcDir).filter((name) => name.endsWith('.ts'));

  const lines = (): Array<{ file: string; line: number; text: string }> =>
    files.flatMap((file) =>
      readFileSync(srcDir + file, 'utf8')
        .split(/\r?\n/)
        .map((text, index) => ({ file, line: index + 1, text })),
    );

  it('has source files to scan', () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it('contains exactly one wildcard-origin literal: the constant that exists to reject it', () => {
    const hits = lines().filter(({ text }) => /(['"])\*\1/.test(text));
    expect(hits.map(({ file, text }) => `${file}: ${text.trim()}`)).toEqual([
      "transport.ts: export const WILDCARD_ORIGIN = '*';",
    ]);
  });

  it('imports nothing from node: — this wire runs in two browsers', () => {
    const hits = lines().filter(({ text }) => /from\s+['"]node:/.test(text));
    expect(hits.map(({ file, line }) => `${file}:${line}`)).toEqual([]);
  });

  it('imports no sibling but @sve/protocol', () => {
    const hits = lines()
      .filter(({ text }) => /from\s+['"]@sve\//.test(text))
      .filter(({ text }) => !/from\s+['"]@sve\/protocol['"]/.test(text));
    expect(hits.map(({ file, line, text }) => `${file}:${line} ${text.trim()}`)).toEqual([]);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * AC-9.5 — the in-memory pair the rest of the suite runs on
 * ──────────────────────────────────────────────────────────────────────────── */

describe('createTransportPair', () => {
  it("delivers each side a message stamped with the other side's identity", async () => {
    const [studio, preview] = createTransportPair(
      { origin: STUDIO, source: 'studio-window' },
      { origin: PREVIEW, source: 'preview-window' },
    );
    const seen: TransportMessage[] = [];
    preview.subscribe((message) => void seen.push(message));

    studio.post({ hello: true });
    await Promise.resolve();

    expect(seen).toEqual([{ data: { hello: true }, origin: STUDIO, source: 'studio-window' }]);
  });

  it('does not deliver synchronously, matching postMessage', async () => {
    const [studio, preview] = createTransportPair({ origin: STUDIO }, { origin: PREVIEW });
    const seen: unknown[] = [];
    preview.subscribe((message) => void seen.push(message.data));

    studio.post('a');
    expect(seen).toEqual([]);
    await Promise.resolve();
    expect(seen).toEqual(['a']);
  });

  it('records what was sent and how many listeners are attached', () => {
    const [studio] = createTransportPair({ origin: STUDIO }, { origin: PREVIEW });
    expect(studio.listenerCount).toBe(0);
    const stop = studio.subscribe(() => {});
    expect(studio.listenerCount).toBe(1);
    studio.post('x');
    expect(studio.sent).toEqual(['x']);
    stop();
    expect(studio.listenerCount).toBe(0);
  });

  it('lets a test inject a message from an arbitrary origin — the attacker move', async () => {
    const [, preview] = createTransportPair({ origin: STUDIO }, { origin: PREVIEW });
    const seen: TransportMessage[] = [];
    preview.subscribe((message) => void seen.push(message));

    preview.inject({ data: readyMessage(), origin: 'https://evil.example', source: attackerWindow });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.origin).toBe('https://evil.example');
  });

  it('drops posts once closed, the way a detached window does', async () => {
    const [studio, preview] = createTransportPair({ origin: STUDIO }, { origin: PREVIEW });
    const seen: unknown[] = [];
    preview.subscribe((message) => void seen.push(message.data));

    studio.close();
    studio.post('a');
    await Promise.resolve();

    expect(seen).toEqual([]);
  });

  it('does not let one listener throwing stop the others', async () => {
    const [studio, preview] = createTransportPair({ origin: STUDIO }, { origin: PREVIEW });
    const onError = vi.fn();
    preview.subscribe(() => {
      throw new Error('boom');
    });
    preview.subscribe(onError);

    studio.post('a');
    await Promise.resolve();

    expect(onError).toHaveBeenCalledOnce();
  });
});
