/**
 * Opening a session, in the one order that works.
 *
 * The wire has to be listening before the frame exists. `createRpcServer` announces its
 * boot the instant the framed document evaluates, and a `ready` posted at a window nobody
 * has subscribed to is a handshake nobody completes — `connectPreview` says so in its own
 * doc comment. Building the client from the iframe's ref callback got that backwards, and
 * because the workspace is what makes the panel holding that iframe render at all, it also
 * deadlocked: no workspace until the frame mounts, no frame until there is a workspace.
 *
 * These four are the shape of the answer. The link is opened from the session, the frame is
 * looked up per post rather than captured, and the origin is the session's own.
 */
import { describe, expect, it, vi } from 'vitest';
import { readyMessage, type MessageEventLike } from '@sve/rpc';
import { openSession, type SessionLink } from '../src/client/link.js';

const SESSION_URL = 'http://127.0.0.1:5310/';
const SESSION_ORIGIN = 'http://127.0.0.1:5310';

interface Posted {
  data: unknown;
  targetOrigin: string;
}

function harness(): {
  open(): SessionLink;
  /** Sets, or removes, the frame the link posts into. */
  setFrame(present: boolean): void;
  posts: Posted[];
  /** A message arriving on the studio's window, as the browser would deliver it. */
  send(data: unknown, origin?: string): void;
} {
  const posts: Posted[] = [];
  const listeners = new Set<(event: MessageEventLike) => void>();
  let frame: { contentWindow: { postMessage(data: unknown, targetOrigin: string): void } | null } | null =
    null;

  return {
    posts,
    setFrame(present) {
      frame = present
        ? {
            contentWindow: {
              postMessage: (data, targetOrigin) => posts.push({ data, targetOrigin }),
            },
          }
        : null;
    },
    send(data, origin = SESSION_ORIGIN) {
      for (const listener of [...listeners]) listener({ data, origin, source: null });
    },
    open: () =>
      openSession({
        sessionId: 's1',
        sessionUrl: SESSION_URL,
        frame: () => frame,
        listenOn: {
          addEventListener: (_type, listener) => {
            listeners.add(listener);
          },
          removeEventListener: (_type, listener) => {
            listeners.delete(listener);
          },
        },
        apply: vi.fn(),
        revert: vi.fn(),
        plan: vi.fn(),
      }),
  };
}

describe('openSession', () => {
  it('gives back a workspace without any frame having existed', () => {
    const h = harness();
    const link = h.open();
    // This is the deadlock, stated: the panel that mounts the iframe is only rendered
    // once there is a workspace, so a workspace that waits for the iframe waits forever.
    expect(link.workspace).toBeDefined();
    expect(link.workspace.log.rows()).toEqual([]);
    expect(link.preview.status).toBe('connecting');
    link.dispose();
  });

  it('is already listening when the frame announces its boot', () => {
    const h = harness();
    const link = h.open();
    // No frame has been attached, and the framed document has just evaluated.
    h.send(readyMessage());
    expect(link.preview.status).toBe('connected');
    link.dispose();
  });

  it('refuses a boot announced from any other origin', () => {
    const h = harness();
    const link = h.open();
    h.send(readyMessage(), 'http://evil.example');
    expect(link.preview.status).toBe('connecting');
    link.dispose();
  });

  it('posts into whatever frame is there at the time, and at the session origin', () => {
    const h = harness();
    const link = h.open();

    // Looked up per post rather than captured: the frame arrives after the link, and
    // leaves again whenever React unmounts the panel.
    void link.preview.refresh().catch(() => undefined);
    expect(h.posts).toHaveLength(0);

    h.setFrame(true);
    void link.preview.refresh().catch(() => undefined);
    expect(h.posts).toHaveLength(1);
    expect(h.posts[0]!.targetOrigin).toBe(SESSION_ORIGIN);
    expect(h.posts[0]!.data).toMatchObject({ kind: 'request', method: 'refresh' });

    link.dispose();
  });
});
