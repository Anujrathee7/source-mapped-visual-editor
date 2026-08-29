/**
 * The session: what turns an `EditIntent` the overlay emitted into a verdict on the panel.
 *
 * The overlay stops at producing an intent and the bridge stops at writing a file. This is
 * the piece between them, and it owns exactly three things:
 *
 *  - the wire (`POST /__sve/apply`, `POST /__sve/revert`);
 *  - a **serial** queue, mirroring the bridge's own;
 *  - the memory of which job last wrote each element's file, which is what Revert needs.
 *
 * The queue is not a duplicate of the bridge's. The bridge serialises *writes*; this
 * serialises whole loops, so job two is captured and sent only after job one's hot reload
 * has landed and the page has been re-stamped. That is what makes AC-5.9's "none targets a
 * stale line" true of the browser as well as of the server: by the time the second intent
 * is sent, the `data-sve-loc` it carries has already been re-read from the re-rendered DOM.
 */
import type { OverlayHandle } from '@sve/overlay';
import { EditResultSchema, type EditIntent, type EditResult } from '@sve/protocol';
import { DEFAULT_SETTLE_MS, DEFAULT_VERIFY_TIMEOUT_MS } from '../constants.js';
import { runVerification, watchForUpdate, type HotLike, type UpdateWatch } from './verify.js';

export const APPLY_URL = '/__sve/apply';
export const REVERT_URL = '/__sve/revert';

export const REVERTED_MESSAGE = 'The file was restored byte for byte.';

export interface BridgeTransport {
  apply(intent: EditIntent): Promise<EditResult>;
  revert(jobId: string): Promise<EditResult>;
}

async function post(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      payload !== null && typeof payload === 'object' && 'message' in payload
        ? String((payload as { message: unknown }).message)
        : response.statusText;
    throw new Error(`${url} answered ${response.status}: ${detail}`);
  }
  return payload;
}

/**
 * The default transport: one job per intent, over the routes the bridge middleware mounts.
 *
 * Responses are parsed with the protocol schema rather than trusted. The bridge is not
 * hostile, but a shape mismatch here would surface three steps later as an unexplained
 * verdict, and failing at the boundary is cheaper than debugging that.
 */
export function createHttpTransport(): BridgeTransport {
  return {
    async apply(intent) {
      const payload = await post(APPLY_URL, { intents: [intent] });
      const results = (payload as { results?: unknown[] } | null)?.results ?? [];
      const first = results[0];
      if (first === undefined) throw new Error(`${APPLY_URL} returned no result`);
      return EditResultSchema.parse(first);
    },

    async revert(jobId) {
      return EditResultSchema.parse(await post(REVERT_URL, { jobId }));
    },
  };
}

export interface SessionOptions {
  handle: OverlayHandle;
  /** `import.meta.hot`. `null` when there is no hot reload to wait for. */
  hot?: HotLike | null;
  transport?: BridgeTransport;
  raf?: (callback: () => void) => void;
  timeoutMs?: number;
  settleMs?: number;
  /**
   * Overrides the wait for hot reload wholesale. Only a test has cause to: jsdom has no
   * dev server to fire `vite:afterUpdate`, and the wait is covered on its own by
   * `watchForUpdate`'s specs.
   */
  settled?: () => Promise<boolean>;
}

export interface EditorSession {
  dispose(): void;
}

export function createEditorSession(options: SessionOptions): EditorSession {
  const { handle } = options;
  const transport = options.transport ?? createHttpTransport();
  const hot = options.hot ?? null;

  /** eid -> the job whose snapshot Revert would restore. */
  const lastWrite = new Map<string, string>();
  const disposers: Array<() => void> = [];
  let disposed = false;

  // Whole loops, one at a time: see the note at the top of the file.
  let tail: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    // A failed job must not wedge the queue behind it.
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const watch = (): UpdateWatch => {
    if (options.settled) {
      const settled = options.settled();
      return { settled, cancel: () => {} };
    }
    return watchForUpdate({
      hot,
      ...(options.raf ? { raf: options.raf } : {}),
      timeoutMs: options.timeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS,
      settleMs: options.settleMs ?? DEFAULT_SETTLE_MS,
    });
  };

  disposers.push(
    handle.onApply((intent) => {
      // Read now, not when the job runs: this is the override the user was looking at when
      // they pressed Apply, and it is what the loop compares against before dropping it.
      const applied = handle.getOverride(intent.eid);
      void serial(async () => {
        if (disposed) return;
        const outcome = await runVerification(intent, {
          target: handle,
          apply: (fresh) => transport.apply(fresh),
          watch,
          applied,
        });
        // A snapshot is only worth offering when the agent actually wrote. AC-5.2 leaves a
        // drifted file exactly as written, so drift offers Revert too.
        if (outcome.wrote && outcome.jobId !== null) {
          lastWrite.set(intent.eid, outcome.jobId);
          handle.setRevertable(intent.eid, true);
        }
      });
    }),
  );

  disposers.push(
    handle.onRevert((eid) => {
      const jobId = lastWrite.get(eid);
      if (jobId === undefined) return;

      void serial(async () => {
        if (disposed) return;
        handle.setVerdict(eid, null);
        handle.setPhase('applying');

        const pending = watch();
        let result: EditResult;
        try {
          result = await transport.revert(jobId);
        } catch (error) {
          pending.cancel();
          handle.setVerdict(eid, {
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
          return;
        }

        if (result.status !== 'reverted') {
          pending.cancel();
          handle.setVerdict(eid, { status: 'error', ...(result.message ? { message: result.message } : {}) });
          return;
        }

        // The file is back, so the page is about to be too. Wait for that before clearing
        // the override, or the user sees React's old render flash through the gap.
        await pending.settled;
        handle.refresh();
        // AC-5.8: the override goes, and the element returns to what it was before the
        // edit — which is now what the restored source renders.
        handle.liftOverride(eid);
        lastWrite.delete(eid);
        handle.setRevertable(eid, false);
        handle.setVerdict(eid, { status: 'reverted', message: REVERTED_MESSAGE });
      });
    }),
  );

  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const dispose of disposers.splice(0)) dispose();
      lastWrite.clear();
    },
  };
}
