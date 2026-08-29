/**
 * The change log (AC-12.3).
 *
 * One row per intent, newest first, each carrying the *live* verdict — a row opens as
 * `applying` and resolves in place. In place is not a detail: the log is the only running
 * account of what the agent has done to the project, and a row that jumped to the top when
 * its verdict arrived would move every row a reader was in the middle of.
 *
 * It is studio state, not page state. The preview can reload, crash, or be reconnected to
 * a different session and the recap survives, because the recap is about what was asked
 * and what came back — neither of which is a fact about the current document.
 */
import type { EditIntent, EditKind, EditStatus, Mismatch } from '@sve/protocol';
import type { LoopOutcome } from './loop.js';
import { REVERTED_MESSAGE } from './verdicts.js';

/** Where an intent came from. Both paths run the same loop; only the label differs. */
export type ChangeOrigin = 'preview' | 'chat';

/** `applying` is a phase, not a verdict — which is why it is spelled apart from the rest. */
export type RowStatus = 'applying' | EditStatus;

export interface ChangeRow {
  id: string;
  eid: string;
  eidIndex: number;
  /** The coordinate the intent was captured at. */
  loc: string;
  tag: string;
  kind: EditKind;
  origin: ChangeOrigin;
  /** What changed, in the intent's own resolved words — `describeEdit`'s sentence. */
  summary: string;
  status: RowStatus;
  message?: string;
  /** Intent versus rendered, both sides, for a row that drifted. */
  mismatch?: Mismatch[];
  diff?: string;
  jobId: string | null;
  /** Whether a snapshot exists for this row's job, and so whether Revert is offered. */
  revertable: boolean;
}

export interface StartInput {
  intent: EditIntent;
  origin: ChangeOrigin;
}

export interface ChangeLog {
  /** Newest first. A stable array: the same row keeps the same index as it resolves. */
  rows(): ChangeRow[];
  row(id: string): ChangeRow | undefined;
  subscribe(listener: () => void): () => void;
  start(input: StartInput): string;
  resolve(id: string, outcome: LoopOutcome): void;
  /** AC-12.3: `reverted`, and never `landed` — nothing landed, it was undone. */
  markReverted(id: string): void;
  fail(id: string, message: string): void;
  clear(): void;
}

export function createChangeLog(newId?: () => string): ChangeLog {
  const rows: ChangeRow[] = [];
  const listeners = new Set<() => void>();
  let counter = 0;
  const nextId = newId ?? (() => `row_${(counter += 1).toString(36)}`);

  const announce = (): void => {
    for (const listener of [...listeners]) listener();
  };

  const find = (id: string): ChangeRow | undefined => rows.find((row) => row.id === id);

  const patch = (id: string, change: Partial<ChangeRow>): void => {
    const row = find(id);
    if (!row) return;
    Object.assign(row, change);
    announce();
  };

  return {
    // Newest first is a view, not the storage order: rows are appended, so a row's identity
    // and its neighbours are fixed for its whole life.
    rows: () => [...rows].reverse(),
    row: find,

    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    start({ intent, origin }) {
      const id = nextId();
      rows.push({
        id,
        eid: intent.eid,
        eidIndex: intent.eidIndex,
        loc: intent.loc,
        tag: intent.tag,
        kind: intent.kind,
        origin,
        summary: intent.instruction,
        status: 'applying',
        jobId: null,
        revertable: false,
      });
      announce();
      return id;
    },

    resolve(id, outcome) {
      patch(id, {
        status: outcome.verdict.status,
        jobId: outcome.jobId,
        // A snapshot is only worth offering once a job has actually touched disk. AC-5.2
        // leaves a drifted file exactly as written, so drift offers Revert too.
        revertable: outcome.wrote && outcome.jobId !== null,
        ...(outcome.verdict.message === undefined ? {} : { message: outcome.verdict.message }),
        ...(outcome.verdict.mismatch === undefined ? {} : { mismatch: outcome.verdict.mismatch }),
        ...(outcome.verdict.diff === undefined ? {} : { diff: outcome.verdict.diff }),
      });
    },

    markReverted(id) {
      patch(id, {
        status: 'reverted',
        message: REVERTED_MESSAGE,
        revertable: false,
        mismatch: undefined,
      });
    },

    fail(id, message) {
      patch(id, { status: 'error', message });
    },

    clear() {
      rows.length = 0;
      announce();
    },
  };
}
