/**
 * The whole seam, joined, with only the two windows faked.
 *
 * These suites run against the *real* overlay handle and the *real* `@sve/rpc` client and
 * server, wired to the in-memory transport pair that AC-9.5 put in `src` for exactly this.
 * What is not real is the pair of browsing contexts — and a studio that were tested against
 * a stubbed preview would be a studio whose every claim about the preview was a claim about
 * the stub.
 */
import { mountOverlay, type OverlayHandle } from '@sve/overlay';
import {
  createRpcClient,
  createTransportPair,
  type MemoryTransport,
  type RpcClient,
} from '@sve/rpc';
import { createPreviewController, type PreviewController } from '../src/client/preview.js';
import { createPreviewServer, type PreviewServer } from '../src/preview/serve.js';
import { PREVIEW_ORIGIN, STUDIO_ORIGIN, fetchFixtureSource, renderPage, settle } from './fixture.js';

export interface Wire {
  overlay: OverlayHandle;
  preview: PreviewServer;
  controller: PreviewController;
  client: RpcClient;
  studioTransport: MemoryTransport;
  previewTransport: MemoryTransport;
  /** Resolves the frame-side wait for hot reload. Defaults to "the page settled". */
  setSettled(value: boolean): void;
  dispose(): void;
}

export interface WireOptions {
  timeoutMs?: number;
  settled?: boolean;
}

const studioWindow = { name: 'studio' };
const previewWindow = { name: 'preview' };

export async function wirePreview(options: WireOptions = {}): Promise<Wire> {
  renderPage();

  const overlay = mountOverlay({ dev: true, fetchSource: fetchFixtureSource });
  if (!overlay) throw new Error('the overlay refused to mount');

  const [studioTransport, previewTransport] = createTransportPair(
    { origin: STUDIO_ORIGIN, source: studioWindow },
    { origin: PREVIEW_ORIGIN, source: previewWindow },
  );

  let settled = options.settled ?? true;

  const preview = createPreviewServer({
    overlay,
    transport: previewTransport,
    peerOrigin: STUDIO_ORIGIN,
    peerSource: studioWindow,
    fetchSource: fetchFixtureSource,
    watchForUpdate: async () => settled,
  });

  const client = createRpcClient({
    transport: studioTransport,
    peerOrigin: PREVIEW_ORIGIN,
    peerSource: previewWindow,
    timeoutMs: options.timeoutMs ?? 200,
  });

  const controller = createPreviewController({ client });
  await settle();

  return {
    overlay,
    preview,
    controller,
    client,
    studioTransport,
    previewTransport,
    setSettled: (value) => {
      settled = value;
    },
    dispose: () => {
      controller.dispose();
      client.dispose();
      preview.dispose();
      overlay.unmount();
      document.body.innerHTML = '';
    },
  };
}

/** Dispatches the click the user makes, as the page's own listeners see it. */
export function clickIn(selector: string): void {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`no element matches ${selector}`);
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}
