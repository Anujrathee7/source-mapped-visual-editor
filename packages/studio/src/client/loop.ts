/**
 * The verification loop, run from the other side of a window boundary.
 *
 * The six steps are AC-5's and they have not changed:
 *
 *   1. wait for hot reload, then let the page settle;
 *   2. re-anchor by `eid` + `eidIndex`;
 *   3. **lift the override**;
 *   4. read the live DOM;
 *   5. compare against the recorded intent;
 *   6. report, or re-apply the override and report drift.
 *
 * What has changed is that every one of them is now a `postMessage` round trip, so the
 * target is asynchronous. That is the only difference: the comparison is still
 * `diffComputed` and `normalizeText` from `@sve/overlay` — the comparators live in one
 * place (CLAUDE.md) and this file does not get an opinion about equality — and the order
 * is still the order, because step 3 before step 4 is what stops the verifier reading its
 * own paint back.
 *
 * There is no DOM here and no `fetch` here. The loop is handed a target and an `apply`,
 * which is what lets one implementation serve a click on the preview and a proposal
 * accepted in the chat panel. AC-12.1 turns on there being only one.
 */
import { diffComputed, normalizeText, type Override, type Verdict } from '@sve/overlay';
import {
  parseLoc,
  type Computed,
  type EditIntent,
  type EditResult,
  type Mismatch,
  type Snapshot,
} from '@sve/protocol';
import { DRIFTED_MESSAGE, STALLED_MESSAGE } from './verdicts.js';

export const MISSING_MESSAGE = 'the element did not come back after hot reload';

/**
 * The slice of the preview the loop drives.
 *
 * Deliberately narrower than the rpc client: the loop cannot select, cannot read inspector
 * state, and cannot write a file. Naming it keeps that true as the studio grows.
 */
export interface AsyncLoopTarget {
  currentLoc(eid: string, eidIndex: number): Promise<string | null>;
  readSnapshot(eid: string, eidIndex: number): Promise<Snapshot | null>;
  liftOverride(eid: string): Promise<Override | null>;
  restoreOverride(eid: string, override: Override): Promise<void>;
  refresh(): Promise<void>;
  /**
   * Started inside the frame, where `import.meta.hot` and the compositor are. Resolves
   * true once the page re-rendered and went quiet, false if it never did.
   */
  watchForUpdate(): Promise<boolean>;
}

export interface LoopDeps {
  target: AsyncLoopTarget;
  apply(intent: EditIntent): Promise<EditResult>;
  /**
   * The override this intent was built from, read at the moment Apply was pressed.
   *
   * A landed edit makes its own override redundant, but only its own: a user who typed
   * something further while the job was in flight is asking for something the source does
   * not say yet, and dropping it would discard their input silently.
   */
  applied: Override | null;
}

export interface LoopOutcome {
  jobId: string | null;
  verdict: Verdict;
  /** Whether a file was written — and so whether there is a snapshot worth reverting to. */
  wrote: boolean;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Overrides are shallow trees of strings, so serialising is a sound equality test. */
function sameOverride(a: Override | null, b: Override | null): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * The closed question the edit posed, as computed values.
 *
 * A text edit asks nothing here: the user changed words, not paint, and a longer heading
 * is a wider heading. For a class or style edit the question is exactly the properties the
 * override moved — anything else drifting is layout, not drift.
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

/**
 * Replaces the intent's loc with the one the page carries right now.
 *
 * `data-sve-loc` is invalidated by every write to its file. An intent captured while an
 * earlier job was in flight holds the line from before that write; the element has been
 * re-stamped since, so the DOM is the authority and the recorded loc is not.
 */
async function reanchor(intent: EditIntent, target: AsyncLoopTarget): Promise<EditIntent> {
  const loc = await target.currentLoc(intent.eid, intent.eidIndex);
  if (!loc || loc === intent.loc || parseLoc(loc) === null) return intent;
  return { ...intent, loc };
}

export async function runVerification(
  intent: EditIntent,
  deps: LoopDeps,
): Promise<LoopOutcome> {
  const { target } = deps;
  const { eid, eidIndex } = intent;

  /**
   * Started before the request goes out, never after the response comes back. A small
   * file on a warm dev server can produce its module update before the write is
   * acknowledged, and a watcher opened afterwards waits for an event that has happened.
   *
   * Across the wire that ordering costs one round trip rather than one call — hence the
   * un-awaited promise here and the `await` at step 1.
   */
  const settling = target.watchForUpdate();
  // Nothing may reject unobserved while the request is in flight.
  const settled = settling.catch(() => false);

  let result: EditResult;
  try {
    result = await deps.apply(await reanchor(intent, target));
  } catch (error) {
    return { jobId: null, verdict: { status: 'error', message: messageOf(error) }, wrote: false };
  }

  if (result.status !== 'landed') {
    // Blocked, stalled, error: nothing was written, so nothing re-rendered and there is
    // nothing to compare. The override stays applied — the user asked for something and
    // has not got it, and clearing it here would lose the ask silently (AC-5.6).
    return {
      jobId: result.jobId,
      verdict: {
        status: result.status,
        message:
          result.status === 'stalled'
            ? [STALLED_MESSAGE, result.message].filter(Boolean).join(' ')
            : result.message,
        ...(result.diff === undefined ? {} : { diff: result.diff }),
      },
      wrote: false,
    };
  }

  // 1. Hot reload, then the settle, so React has committed and the browser has laid out.
  if (!(await settled)) {
    return {
      jobId: result.jobId,
      verdict: { status: 'stalled', message: STALLED_MESSAGE },
      wrote: true,
    };
  }

  // 2. Re-anchor. The write moved every line below it; only the eid still means anything.
  await target.refresh();
  const loc = await target.currentLoc(eid, eidIndex);

  // 3. Lift the override. Everything below this line is only true because of it.
  const lifted = await target.liftOverride(eid);

  // 4. Read what React rendered from the file the agent wrote.
  const rendered = loc === null ? null : await target.readSnapshot(eid, eidIndex);

  // 5. Compare against the recorded intent.
  const mismatch = compareToIntent(intent, rendered);

  // 6. Report.
  const diff = result.diff === undefined ? {} : { diff: result.diff };
  if (mismatch.length === 0) {
    if (lifted !== null && !sameOverride(lifted, deps.applied)) {
      await target.restoreOverride(eid, lifted);
    }
    return { jobId: result.jobId, verdict: { status: 'landed', ...diff }, wrote: true };
  }

  if (lifted !== null) await target.restoreOverride(eid, lifted);
  return {
    jobId: result.jobId,
    verdict: { status: 'drifted', message: DRIFTED_MESSAGE, mismatch, ...diff },
    wrote: true,
  };
}
