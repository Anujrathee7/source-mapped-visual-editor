// @vitest-environment jsdom
/**
 * The client entry as the thing that decides, and the wire it opens when it decides yes.
 *
 * AC-15.1 is a *pair* of conditions — framed, and a configured studio — and the whole risk
 * is in it being read as one. So the four ways this page can end up not serving anybody are
 * each named and each asserted, and the fifth is driven end to end: a real `mountOverlay`
 * in a real jsdom document, answering real `@sve/rpc` envelopes posted at a stand-in for a
 * parent window.
 *
 * What none of this can prove is that the two halves ever meet in a browser. That is
 * AC-15.6's job and it lives in `e2e/studio.spec.ts`; this file is why that suite has a
 * short list of things left to be surprised by.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RPC_MARKER,
  RPC_VERSION,
  parseEnvelope,
  requestMessage,
  type MessageEventLike,
  type RpcMessage,
} from '@sve/rpc';
import { startEditor, type EditorHandle } from '../src/client/entry.js';
import { studioPeer, type FrameView } from '../src/client/preview.js';

const STUDIO = 'http://localhost:5300';
const FILE = 'src/Hero.tsx';
const H1_LOC = `${FILE}:3:5`;
const H1_EID = `${FILE}#section:0/h1:0`;

const PAGE = `
<main id="app-root">
  <section data-sve-loc="${FILE}:2:3" data-sve-eid="${FILE}#section:0" data-sve-text="none" data-sve-class="literal" class="wrap">
    <h1 data-sve-loc="${H1_LOC}" data-sve-eid="${H1_EID}" data-sve-text="static" data-sve-class="literal" class="title">Swim today</h1>
  </section>
</main>`;

const SOURCE = [
  'export const Hero = () => (',
  '  <section className="wrap">',
  '    <h1 className="title">Swim today</h1>',
  '  </section>',
  ');',
].join('\n');

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/* ── a parent window that is not a window ─────────────────────────────────── */

interface Studio {
  view: FrameView;
  parent: { postMessage(data: unknown, targetOrigin: string): void };
  /** Everything the frame posted at us, in order, already through the envelope parser. */
  received: Array<{ message: RpcMessage; targetOrigin: string }>;
  /** Posts a message *from* the studio, as the browser would deliver it. */
  send(data: unknown, origin?: string, source?: unknown): void;
}

function studioWindow(): Studio {
  const received: Studio['received'] = [];
  const listeners = new Set<(event: MessageEventLike) => void>();

  const parent = {
    postMessage(data: unknown, targetOrigin: string): void {
      // Round-tripped through JSON on the way in, because `postMessage` structured-clones
      // and a test that passed live object references would not notice a value that
      // cannot make the trip (AC-8.5).
      const parsed = parseEnvelope(JSON.parse(JSON.stringify(data)));
      if (parsed.ok) received.push({ message: parsed.message, targetOrigin });
    },
  };

  const view = {
    parent,
    addEventListener: (_type: 'message', listener: (event: MessageEventLike) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: 'message', listener: (event: MessageEventLike) => void) => {
      listeners.delete(listener);
    },
  } as unknown as FrameView;

  return {
    view,
    parent,
    received,
    send(data, origin = STUDIO, source = parent) {
      for (const listener of [...listeners]) listener({ data, origin, source });
    },
  };
}

/**
 * A document whose `defaultView` is the stand-in above.
 *
 * jsdom's `window.parent` is itself, which is exactly the unframed case — so the framed
 * one has to be built rather than mutated into existence.
 */
function framedDocument(studio: Studio): Document {
  document.body.innerHTML = PAGE;
  Object.defineProperty(document, 'defaultView', {
    configurable: true,
    get: () => studio.view,
  });
  return document;
}

let editor: EditorHandle | null = null;

afterEach(() => {
  editor?.stop();
  editor = null;
  Reflect.deleteProperty(document, 'defaultView');
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

/* == who this page will answer (AC-15.1, AC-15.3) ========================= */

describe('studioPeer — the trigger is framed *and* configured', () => {
  const framed = { parent: { postMessage() {} } } as unknown as FrameView;
  const alone = {} as unknown as FrameView;
  // What `window.parent` is in a top-level document: the window itself.
  const top = { parent: undefined as unknown } as { parent: unknown };
  top.parent = top;

  it('refuses a page nobody framed, however well configured it is', () => {
    expect(studioPeer(top as unknown as FrameView, STUDIO)).toEqual({
      ok: false,
      reason: 'unframed',
    });
    expect(studioPeer(alone, STUDIO)).toEqual({ ok: false, reason: 'unframed' });
    expect(studioPeer(null, STUDIO)).toEqual({ ok: false, reason: 'unframed' });
  });

  it('refuses a framed page that named no studio', () => {
    // The heart of AC-15.1: `window.parent !== window` is not the trigger. A project
    // somebody else iframed must not start answering them.
    expect(studioPeer(framed, undefined)).toEqual({ ok: false, reason: 'unconfigured' });
    expect(studioPeer(framed, '')).toEqual({ ok: false, reason: 'unconfigured' });
    expect(studioPeer(framed, '   ')).toEqual({ ok: false, reason: 'unconfigured' });
  });

  it('refuses a wildcard, as @sve/rpc does', () => {
    expect(studioPeer(framed, '*')).toEqual({ ok: false, reason: 'wildcard' });
  });

  it('refuses a URL where an origin was wanted, rather than narrowing it quietly', () => {
    // `postMessage` would compare only the origin part of each of these, so accepting them
    // would mean accepting a wider set of senders than the config appears to name.
    expect(studioPeer(framed, `${STUDIO}/`)).toEqual({ ok: false, reason: 'not-an-origin' });
    expect(studioPeer(framed, `${STUDIO}/studio`)).toEqual({ ok: false, reason: 'not-an-origin' });
    expect(studioPeer(framed, 'localhost:5300')).toEqual({ ok: false, reason: 'not-an-origin' });
  });

  it('accepts a framed page with a bare origin, and posts at the parent', () => {
    const decision = studioPeer(framed, STUDIO);
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.peer.origin).toBe(STUDIO);
    expect(decision.peer.target).toBe(framed.parent);
    expect(decision.peer.listenOn).toBe(framed);
  });
});

/* == what the entry actually does about it ================================ */

describe('startEditor — unframed, or unconfigured', () => {
  it('mounts the in-page editor exactly as before, and posts nothing (AC-15.4)', () => {
    const studio = studioWindow();
    framedDocument(studio);

    // Framed, but no studio named.
    editor = startEditor({}, document);
    expect(editor).not.toBeNull();
    const shadow = document.querySelector('[data-sve-overlay]')!.shadowRoot!;
    expect(shadow.querySelector('.sve-panel')).not.toBeNull();
    expect(editor!.session).not.toBeNull();
    expect(studio.received).toHaveLength(0);
  });

  it('says so, loudly, when the origin it was given is not one', () => {
    const studio = studioWindow();
    framedDocument(studio);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    editor = startEditor({ studioOrigin: '*' }, document);

    // Refused, and the fallback is announced rather than silent: a preview that never
    // connects for a reason nobody printed is the failure this whole project is about.
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]![0])).toContain('studioOrigin');
    expect(studio.received).toHaveLength(0);
    const shadow = document.querySelector('[data-sve-overlay]')!.shadowRoot!;
    expect(shadow.querySelector('.sve-panel')).not.toBeNull();
  });
});

describe('startEditor — framed by the studio it was told about', () => {
  const boot = async (): Promise<Studio> => {
    const studio = studioWindow();
    framedDocument(studio);
    editor = startEditor(
      { studioOrigin: STUDIO, viteRoot: '' },
      document,
    );
    await editor!.preview;
    await tick();
    return studio;
  };

  it('mounts without chrome and announces itself to the parent (AC-15.1, AC-15.2)', async () => {
    const studio = await boot();

    const shadow = document.querySelector('[data-sve-overlay]')!.shadowRoot!;
    expect(shadow.querySelector('.sve-panel')).toBeNull();
    // The in-page loop is the studio's now; two of them would each wait on the other's
    // hot reload.
    expect(editor!.session).toBeNull();

    const ready = studio.received.find((entry) => entry.message.kind === 'ready');
    expect(ready).toBeDefined();
    // Named, never a wildcard — this is the value that decides who receives it.
    expect(ready!.targetOrigin).toBe(STUDIO);
    expect(ready!.message).toMatchObject({ sve: RPC_MARKER, v: RPC_VERSION });
  });

  it('answers the studio, and the answer is about the real DOM', async () => {
    const studio = await boot();
    studio.send(requestMessage('r1', 'select', { anchor: { eid: H1_EID, eidIndex: 0 } }));
    await tick();

    // The selection happened in *this* document.
    expect(editor!.overlay.selection).toMatchObject({ eid: H1_EID, loc: H1_LOC, tag: 'h1' });

    const reply = studio.received.find(
      (entry) => entry.message.kind === 'response' && entry.message.id === 'r1',
    );
    expect(reply).toBeDefined();
    expect(reply!.message).toMatchObject({ kind: 'response', ok: true });

    // And the studio is told what to draw, unasked.
    const state = studio.received
      .filter((entry) => entry.message.kind === 'event')
      .map((entry) => entry.message as Extract<RpcMessage, { kind: 'event' }>)
      .filter((message) => message.event === 'inspectorState')
      .pop();
    expect(state).toBeDefined();
    expect(state!.payload).toMatchObject({ anchor: { eid: H1_EID, loc: H1_LOC } });
  });

  it('reads the source for the studio to draw a caret on', async () => {
    const fetched: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      fetched.push(String(url));
      return { ok: true, text: async () => SOURCE } as unknown as Response;
    });

    const studio = await boot();
    studio.send(requestMessage('r1', 'select', { anchor: { eid: H1_EID, eidIndex: 0 } }));
    await tick();
    await tick();

    // The bridge's guarded route, requested from inside the frame — where the dev server
    // is same-origin — and exactly once, because the panel that used to read it too is
    // not here (AC-15.2).
    expect(fetched).toEqual([`/__sve/source?file=${encodeURIComponent(FILE)}`]);

    const state = studio.received
      .filter((entry) => entry.message.kind === 'event')
      .map((entry) => entry.message as Extract<RpcMessage, { kind: 'event' }>)
      .filter((message) => message.event === 'inspectorState')
      .pop();
    expect(state!.payload).toMatchObject({
      excerpt: { caret: { line: 3, column: 5, offset: 4 } },
    });
    vi.unstubAllGlobals();
  });

  it('refuses a message from any other origin', async () => {
    const studio = await boot();
    const before = studio.received.length;
    studio.send(requestMessage('r1', 'select', { anchor: { eid: H1_EID, eidIndex: 0 } }), 'http://evil.example');
    await tick();

    expect(editor!.overlay.selection).toBeNull();
    expect(studio.received).toHaveLength(before);
  });

  it('stops answering once the editor is torn down', async () => {
    const studio = await boot();
    editor!.stop();
    const before = studio.received.length;

    studio.send(requestMessage('r1', 'select', { anchor: { eid: H1_EID, eidIndex: 0 } }));
    await tick();
    expect(studio.received).toHaveLength(before);
    editor = null;
  });
});
