// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountOverlay, type OverlayHandle } from '@sve/overlay';
import type { EditIntent, EditResult } from '@sve/protocol';
import { createEditorSession, type BridgeTransport } from '../src/client/session.js';

/**
 * These run against the *real* overlay handle, not a stand-in.
 *
 * The seam M5 left is the thing under test, so faking it would test the fake. What is
 * faked is the far side of the wire — the bridge — and hot reload, which no jsdom has.
 */

const FILE = 'src/components/Hero.tsx';
const H1_EID = `${FILE}#Hero/section:0/h1:0`;
const H1_LOC = `${FILE}:3:5`;

const PAGE = `
<main>
  <section data-sve-loc="${FILE}:2:3" data-sve-eid="${FILE}#Hero/section:0" data-sve-text="none" data-sve-class="literal" class="wrap">
    <h1 data-sve-loc="${H1_LOC}" data-sve-eid="${H1_EID}" data-sve-text="static" data-sve-class="literal" class="title">Swim today</h1>
  </section>
</main>`;

let handle: OverlayHandle | null = null;
let session: { dispose(): void } | null = null;

afterEach(() => {
  session?.dispose();
  session = null;
  handle?.unmount();
  handle = null;
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function setUp(transport: BridgeTransport): OverlayHandle {
  document.body.innerHTML = PAGE;
  handle = mountOverlay({ fetchSource: async () => 'x\ny\nz\n' });
  if (!handle) throw new Error('expected the overlay to mount');
  session = createEditorSession({
    handle,
    hot: null,
    transport,
    raf: (cb) => cb(),
    // Hot reload cannot fire in jsdom, so the loop is told the page has settled directly.
    settled: async () => true,
  });
  return handle;
}

async function applyText(overlay: OverlayHandle, text: string): Promise<void> {
  overlay.select(document.querySelector('h1'));
  overlay.store.set(H1_EID, { text });
  await tick();
  const chrome = document.querySelector('[data-sve-overlay]')!.shadowRoot!;
  chrome.querySelector<HTMLButtonElement>('.sve-apply')!.click();
}

/* ── AC-5.9 — serial application under concurrent user input ──────────────── */

describe('the editor session', () => {
  it('runs queued edits one at a time, in the order they were pressed', async () => {
    const order: string[] = [];
    let live = 0;
    const overlay = setUp({
      async apply(intent) {
        live += 1;
        expect(live).toBe(1);
        order.push(`start ${intent.after.text}`);
        await tick();
        // The write, and the re-render it causes.
        document.querySelector('h1')!.textContent = intent.after.text;
        order.push(`end ${intent.after.text}`);
        live -= 1;
        return { jobId: `job_${order.length}`, status: 'landed' };
      },
      async revert(jobId) {
        return { jobId, status: 'reverted' };
      },
    });

    await applyText(overlay, 'one');
    await applyText(overlay, 'two');
    await applyText(overlay, 'three');
    await vi.waitFor(() => expect(order).toHaveLength(6));

    expect(order).toEqual([
      'start one',
      'end one',
      'start two',
      'end two',
      'start three',
      'end three',
    ]);
  });

  it('re-reads the loc from the page before each job, so none targets a stale line', async () => {
    const sent: EditIntent[] = [];
    const overlay = setUp({
      async apply(intent) {
        sent.push(intent);
        // What the agent's write does to every line below it, in miniature.
        document.querySelector('h1')!.setAttribute('data-sve-loc', `${FILE}:9:5`);
        return { jobId: `job_${sent.length}`, status: 'landed' };
      },
      async revert(jobId) {
        return { jobId, status: 'reverted' };
      },
    });

    await applyText(overlay, 'one');
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await applyText(overlay, 'two');
    await vi.waitFor(() => expect(sent).toHaveLength(2));

    expect(sent[0]!.loc).toBe(H1_LOC);
    expect(sent[1]!.loc).toBe(`${FILE}:9:5`);
  });

  /* ── AC-5.8 — revert ────────────────────────────────────────────────────── */

  it('offers Revert once the agent has written, and not before', async () => {
    const overlay = setUp({
      async apply(intent) {
        document.querySelector('h1')!.textContent = intent.after.text;
        return { jobId: 'job_1', status: 'landed' };
      },
      async revert(jobId) {
        return { jobId, status: 'reverted' };
      },
    });
    const chrome = document.querySelector('[data-sve-overlay]')!.shadowRoot!;
    const revert = (): HTMLButtonElement => chrome.querySelector<HTMLButtonElement>('.sve-revert')!;

    overlay.select(document.querySelector('h1'));
    await tick();
    expect(revert().hidden).toBe(true);

    await applyText(overlay, 'Ship faster');
    await vi.waitFor(() => expect(revert().hidden).toBe(false));
  });

  it('restores the file, clears the override, and says so', async () => {
    const reverted: string[] = [];
    const overlay = setUp({
      async apply(intent) {
        // The agent writes and React renders the result.
        document.querySelector('h1')!.textContent = intent.after.text;
        return { jobId: 'job_1', status: 'landed' };
      },
      async revert(jobId) {
        reverted.push(jobId);
        // The agent's write is undone, so React renders the original again.
        document.querySelector('h1')!.textContent = 'Swim today';
        return { jobId, status: 'reverted', message: 'reverted 1 file(s)' };
      },
    });

    await applyText(overlay, 'Ship faster');
    await vi.waitFor(() => expect(overlay.store.has(H1_EID)).toBe(false));

    const chrome = document.querySelector('[data-sve-overlay]')!.shadowRoot!;
    chrome.querySelector<HTMLButtonElement>('.sve-revert')!.click();

    await vi.waitFor(() => expect(reverted).toEqual(['job_1']));
    await vi.waitFor(() =>
      expect(chrome.querySelector('.sve-verdict')!.getAttribute('data-status')).toBe('reverted'),
    );
    expect(overlay.store.has(H1_EID)).toBe(false);
    expect(document.querySelector('h1')!.textContent).toBe('Swim today');
    // Nothing left to revert to.
    expect(chrome.querySelector<HTMLButtonElement>('.sve-revert')!.hidden).toBe(true);
  });

  it('keeps the override, and the offer to revert, when the result drifted', async () => {
    const overlay = setUp({
      async apply() {
        // The agent wrote something else.
        document.querySelector('h1')!.textContent = 'Ship Faster';
        return { jobId: 'job_1', status: 'landed' };
      },
      async revert(jobId) {
        return { jobId, status: 'reverted' };
      },
    });

    await applyText(overlay, 'Ship faster');
    const chrome = document.querySelector('[data-sve-overlay]')!.shadowRoot!;
    await vi.waitFor(() =>
      expect(chrome.querySelector('.sve-verdict')!.getAttribute('data-status')).toBe('drifted'),
    );
    expect(overlay.store.get(H1_EID)).toEqual({ text: 'Ship faster' });
    expect(chrome.querySelector<HTMLButtonElement>('.sve-revert')!.hidden).toBe(false);
  });

  it('sends one intent per press and nothing on disposal', async () => {
    const calls: EditResult[] = [];
    const overlay = setUp({
      async apply(intent) {
        document.querySelector('h1')!.textContent = intent.after.text;
        const result: EditResult = { jobId: `job_${calls.length + 1}`, status: 'landed' };
        calls.push(result);
        return result;
      },
      async revert(jobId) {
        return { jobId, status: 'reverted' };
      },
    });

    await applyText(overlay, 'once');
    await vi.waitFor(() => expect(calls).toHaveLength(1));

    session!.dispose();
    session = null;
    const chrome = document.querySelector('[data-sve-overlay]')!.shadowRoot!;
    chrome.querySelector<HTMLButtonElement>('.sve-apply')!.click();
    await tick();
    expect(calls).toHaveLength(1);
  });
});
