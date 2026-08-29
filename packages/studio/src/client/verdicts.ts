/**
 * The words a verdict is said in.
 *
 * `APPLY_LABELS` is imported, never restated: one verb runs through the whole product —
 * Apply, Applying…, Landed / Drifted / Blocked / Stalled / Reverted — and a second copy of
 * that table in the studio would be a second answer to "what is this called".
 *
 * The two sentences below are the exception, and they are a duplicate of
 * `@sve/vite`'s `src/client/verify.ts`, which does not export them: that package publishes
 * `.` (node) and `./client` (the boot entry) and nothing else. They are written out here
 * rather than reached for through a relative path across package boundaries. See the
 * milestone report — the right home for them is `@sve/protocol`, beside `EDIT_STATUSES`.
 */
import { APPLY_LABELS } from '@sve/overlay';
import type { EditStatus } from '@sve/protocol';

export { APPLY_LABELS };

/** AC-5.7: the UI has to explain that the file did not change, not merely time out. */
export const STALLED_MESSAGE = 'The file did not change, so nothing re-rendered.';

export const DRIFTED_MESSAGE = 'The file changed, but the result is not what you asked for.';

/** AC-5.8: a snapshot was restored, so the words are about restoration, not about landing. */
export const REVERTED_MESSAGE = 'The file was restored byte for byte.';

/**
 * The statuses that mean the verifier reached a conclusion about rendered output, as
 * opposed to the ones that mean nothing was written to conclude anything about.
 */
export const VERIFIED_STATUSES: ReadonlySet<EditStatus> = new Set<EditStatus>(['landed', 'drifted']);

/** Every status, in the order a reader meets them. Used for the log's filter chips. */
export function labelFor(status: EditStatus | 'idle' | 'applying'): string {
  return APPLY_LABELS[status];
}
