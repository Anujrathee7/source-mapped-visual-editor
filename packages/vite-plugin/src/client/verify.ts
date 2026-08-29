/**
 * The verification loop — the project's thesis, as code.
 *
 * "Hot reload returning the same result is the proof the edit landed." Everything the
 * other four packages built exists to make these six steps possible, and AC-5 fixes their
 * order:
 *
 *   1. wait for `vite:afterUpdate`, then two `requestAnimationFrame`s;
 *   2. re-anchor by `data-sve-eid` plus the recorded `eidIndex`;
 *   3. **lift the override** — drop the CSS rule, stop re-asserting text;
 *   4. read the live DOM;
 *   5. compare it to the recorded intent;
 *   6. report `landed`, or re-apply the override and report `drifted`.
 *
 * Step 3 is the one that carries the weight. The override is an illusion the overlay
 * paints over the page; a verifier that reads the DOM with it still applied reads its own
 * paint back and reports green every time. AC-5.2 exists to catch exactly that, and the
 * `liftOverride`-then-`readSnapshot` pairing below is the only place it is prevented.
 *
 * Nothing here touches the network or the DOM directly: the loop is handed a target and a
 * transport, which is what lets it be driven by fake timers in a unit test rather than
 * only through a browser.
 */
import { diffComputed, normalizeText, type ApplyPhase, type Override, type Verdict } from '@sve/overlay';
import { ATTR_LOC } from '@sve/overlay';
import { parseLoc, type Computed, type EditIntent, type EditResult, type Mismatch, type Snapshot } from '@sve/protocol';
import { DEFAULT_SETTLE_MS, DEFAULT_VERIFY_TIMEOUT_MS } from '../constants.js';

/* ── copy ─────────────────────────────────────────────────────────────────── */

/** AC-5.7: the UI has to explain that the file did not change, not merely time out. */
export const STALLED_MESSAGE = 'The file did not change, so nothing re-rendered.';

export const DRIFTED_MESSAGE = 'The file changed, but the result is not what you asked for.';

export const MISSING_MESSAGE = 'the element did not come back after hot reload';

/* ── the slice of the overlay the loop drives ─────────────────────────────── */

/**
 * Deliberately narrower than `OverlayHandle`.
 *
 * These six calls are the entire seam M5 left for this milestone. Naming them as their own
 * interface keeps the loop honest — it cannot reach into the store, cannot select, cannot
 * render — and keeps it testable without a browser.
 */
export interface LoopTarget {
  resolveAnchor(eid: string, eidIndex: number): HTMLElement | null;
  readSnapshot(eid: string, eidIndex: number): Snapshot | null;
  liftOverride(eid: string): Override | undefined;
  restoreOverride(eid: string, override: Override): void;
  refresh(): void;
  setPhase(phase: ApplyPhase): void;
  setVerdict(eid: string, verdict: Verdict | null): void;
}

/* ── step 1: waiting for hot reload ───────────────────────────────────────── */

export interface UpdateWatch {
  /** True once hot reload landed and the page settled; false if it never did. */
  readonly settled: Promise<boolean>;
  cancel(): void;
}

export interface HotLike {
  on(event: string, handler: () => void): void;
  off(event: string, handler: () => void): void;
}

export interface WatchOptions {
  /** `import.meta.hot`. `null` means there is no hot reload to wait for. */
  hot: HotLike | null;
  raf?: (callback: () => void) => void;
  timeoutMs?: number;
  settleMs?: number;
}

const defaultRaf = (callback: () => void): void => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(callback);
  else setTimeout(callback, 16);
};

/**
 * Resolves once the page has re-rendered from source and settled, or false if it never
 * does.
 *
 * Two subtleties, both learned from the thing being measured:
 *
 * The listener is attached before the request goes out, never after the response comes
 * back. A small file on a warm dev server can produce its module update before `fetch`
 * resolves, and a watcher started afterwards would wait for an event that already happened.
 *
 * One edit can produce more than one update — the module that changed, and then the
 * stylesheet Tailwind regenerated because the file it scans changed. Comparing computed
 * values between the two reads the old CSS as drift, so the page has to go quiet for
 * `settleMs` before the two frames that let React commit and the browser lay out.
 */
export function watchForUpdate(options: WatchOptions): UpdateWatch {
  const raf = options.raf ?? defaultRaf;
  const timeoutMs = options.timeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS;
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;

  let done = false;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let announce: (value: boolean) => void = () => {};

  const settled = new Promise<boolean>((resolve) => {
    announce = resolve;
  });

  const stopListening = (): void => {
    options.hot?.off('vite:afterUpdate', onUpdate);
    if (settleTimer !== undefined) clearTimeout(settleTimer);
    if (deadline !== undefined) clearTimeout(deadline);
  };

  const finish = (value: boolean): void => {
    if (done) return;
    done = true;
    stopListening();
    announce(value);
  };

  function onUpdate(): void {
    if (done) return;
    if (settleTimer !== undefined) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      raf(() => raf(() => finish(true)));
    }, settleMs);
  }

  options.hot?.on('vite:afterUpdate', onUpdate);
  // The overlay must not wait forever (AC-5.7). A write that reached disk but produced no
  // module update looks identical to one still in flight, and only a clock tells them apart.
  deadline = setTimeout(() => finish(false), timeoutMs);

  return {
    settled,
    cancel: () => finish(false),
  };
}

/* ── step 5: what the intent actually asked ───────────────────────────────── */

/**
 * The closed question the edit posed, as computed values.
 *
 * A text edit asks nothing here. The user changed words, not paint; a longer heading is a
 * wider heading, and comparing `width` would fail every text edit that changed the word
 * count. For a class or style edit the question is exactly the properties the override
 * moved — a property the user never expressed an opinion about drifting is layout, not
 * drift, and `diffComputed` only compares what it is given.
 */
export function questionedComputed(intent: EditIntent): Computed {
  if (intent.kind === 'text') return {};

  const before = intent.before.computed as Record<string, string | undefined>;
  const asked: Record<string, string> = {};
  for (const [prop, after] of Object.entries(intent.after.computed)) {
    if (after === undefined || before[prop] === after) continue;
    asked[prop] = after;
  }
  return asked as Computed;
}

/**
 * The comparison the verdict is made of.
 *
 * Text is compared through `normalizeText`, so JSX indentation is not a difference.
 * Everything else goes through `diffComputed`, which resolves both sides before comparing:
 * `text-flare` and `text-[#ff5a1f]` are the same edit, and the class list the agent
 * actually wrote is never looked at (AC-5.3).
 */
export function compareToIntent(intent: EditIntent, rendered: Snapshot | null): Mismatch[] {
  if (rendered === null) {
    return [{ prop: 'element', intent: intent.loc, rendered: MISSING_MESSAGE }];
  }

  const mismatch: Mismatch[] = [];
  if (normalizeText(intent.after.text) !== normalizeText(rendered.text)) {
    mismatch.push({ prop: 'text', intent: intent.after.text, rendered: rendered.text });
  }
  mismatch.push(...diffComputed(questionedComputed(intent), rendered.computed));
  return mismatch;
}

/* ── step 2, early: the loc is stale before it is sent ────────────────────── */

/**
 * Replaces the intent's loc with the one the page carries right now.
 *
 * `data-sve-loc` is invalidated by every write to its file, and the queue is serial
 * precisely because of that. An intent captured while an earlier job was still in flight
 * holds the line number from before that job's write; the element itself has been
 * re-stamped by then, so the DOM is the authority and the recorded loc is not (AC-5.4,
 * AC-5.9).
 */
export function reanchorIntent(intent: EditIntent, target: LoopTarget): EditIntent {
  const element = target.resolveAnchor(intent.eid, intent.eidIndex);
  const loc = element?.getAttribute(ATTR_LOC);
  if (!loc || loc === intent.loc || parseLoc(loc) === null) return intent;
  return { ...intent, loc };
}

/* ── the loop ─────────────────────────────────────────────────────────────── */

export interface LoopDeps {
  target: LoopTarget;
  apply(intent: EditIntent): Promise<EditResult>;
  /** Called *before* the request, so an update that beats the response is not missed. */
  watch(): UpdateWatch;
  /**
   * The override this intent was built from, read at the moment Apply was pressed.
   *
   * A landed edit makes its own override redundant, but only its own. A user who typed a
   * further change while this job was in flight is asking for something the source does
   * not say yet, and dropping that ask because an *earlier* edit landed would silently
   * discard their input — and disable Apply underneath their next press.
   */
  applied: Override | undefined;
}

export interface LoopOutcome {
  jobId: string | null;
  verdict: Verdict;
  /** Whether a file was written, and so whether there is a snapshot worth reverting to. */
  wrote: boolean;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Overrides are shallow trees of strings, so serialising is a sound equality test. */
function sameOverride(a: Override | undefined, b: Override | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export async function runVerification(
  intent: EditIntent,
  deps: LoopDeps,
): Promise<LoopOutcome> {
  const { target } = deps;
  const { eid, eidIndex } = intent;

  const settle = (jobId: string | null, verdict: Verdict, wrote: boolean): LoopOutcome => {
    target.setVerdict(eid, verdict);
    return { jobId, verdict, wrote };
  };

  target.setVerdict(eid, null);
  target.setPhase('applying');

  const watch = deps.watch();

  let result: EditResult;
  try {
    result = await deps.apply(reanchorIntent(intent, target));
  } catch (error) {
    watch.cancel();
    return settle(null, { status: 'error', message: messageOf(error) }, false);
  }

  if (result.status !== 'landed') {
    // Blocked, stalled, error: nothing was written, so nothing re-rendered and there is
    // nothing to compare. The override stays applied — the user asked for something and
    // has not got it, and clearing it here would lose the ask silently (AC-5.6).
    watch.cancel();
    return settle(
      result.jobId,
      {
        status: result.status,
        message:
          result.status === 'stalled'
            ? [STALLED_MESSAGE, result.message].filter(Boolean).join(' ')
            : result.message,
        ...(result.diff === undefined ? {} : { diff: result.diff }),
      },
      false,
    );
  }

  // 1. Hot reload, then two frames, so React has committed and the browser has laid out.
  if (!(await watch.settled)) {
    return settle(result.jobId, { status: 'stalled', message: STALLED_MESSAGE }, true);
  }

  // 2. Re-anchor. The write moved every line below it, so the recorded loc is stale by
  //    construction and only the eid still means anything.
  target.refresh();
  const element = target.resolveAnchor(eid, eidIndex);

  // 3. Lift the override. Everything below this line is only true because of it.
  const lifted = target.liftOverride(eid);

  // 4. Read the live DOM — what React rendered from the file the agent wrote.
  const rendered = element === null ? null : target.readSnapshot(eid, eidIndex);

  // 5. Compare against the recorded intent.
  const mismatch = compareToIntent(intent, rendered);

  // 6. Report.
  const diff = result.diff === undefined ? {} : { diff: result.diff };
  if (mismatch.length === 0) {
    // Landed: the source now says what the override was saying, so the override has
    // nothing left to do and stays lifted — unless the user has since asked for something
    // else, which the source does not say and must not be thrown away.
    if (lifted !== undefined && !sameOverride(lifted, deps.applied)) {
      target.restoreOverride(eid, lifted);
    }
    return settle(result.jobId, { status: 'landed', ...diff }, true);
  }

  if (lifted !== undefined) target.restoreOverride(eid, lifted);
  return settle(
    result.jobId,
    { status: 'drifted', message: DRIFTED_MESSAGE, mismatch, ...diff },
    true,
  );
}
