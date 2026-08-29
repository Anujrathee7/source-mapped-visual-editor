/**
 * The one place the three panels meet.
 *
 * Changes, preview and chat are each ignorant of the other two: the log does not know how
 * a verdict was produced, the chat does not know what a change log is, and the preview
 * knows nothing about either. This is what joins them, and it is deliberately the only
 * thing that does — so "what happens when an edit is applied" has one answer, whether the
 * edit came from a click on the preview or from a sentence in the chat.
 *
 * The queue is the other reason this exists. The bridge serialises *writes*; this
 * serialises whole loops, so the second job is captured and sent only after the first
 * one's hot reload has landed and the page has been re-stamped. That is what makes "none
 * targets a stale line" true in the browser as well as on the server.
 */
import type { EditIntent, EditResult } from '@sve/protocol';
import { createChat, type AppliedOutcome, type Chat } from './chat.js';
import { createChangeLog, type ChangeLog, type ChangeOrigin } from './changes.js';
import { runVerification } from './loop.js';
import type { PreviewController } from './preview.js';
import type { PlanTarget, Planner } from '../plan.js';

export interface WorkspaceOptions {
  preview: PreviewController;
  /** The write. One function, one call site, one loop around it. */
  apply(intent: EditIntent): Promise<EditResult>;
  revert(jobId: string): Promise<EditResult>;
  planner: Planner;
}

export interface Workspace {
  readonly preview: PreviewController;
  readonly log: ChangeLog;
  readonly chat: Chat;
  /** Everything the studio has seen, so the planner names rather than invents. */
  elements(): PlanTarget[];
  applyIntent(intent: EditIntent, origin: ChangeOrigin): Promise<AppliedOutcome>;
  selectRow(id: string): Promise<void>;
  revertRow(id: string): Promise<void>;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

export function createWorkspace(options: WorkspaceOptions): Workspace {
  const { preview } = options;
  const log = createChangeLog();
  const listeners = new Set<() => void>();
  const disposers: Array<() => void> = [];

  /**
   * Every element the studio has been told about, keyed by eid.
   *
   * The wire has no "list the page's elements" method — `@sve/rpc`'s table is the remote
   * surface from AC-8 and nothing more — so the catalogue is what the studio has actually
   * seen: everything selected, by click, by keyboard, or by the studio itself. That is a
   * real limit and it is the honest one: the planner may name what the user has shown it.
   */
  const catalogue = new Map<string, PlanTarget>();
  let selectedEid: string | null = null;

  const announce = (): void => {
    for (const listener of [...listeners]) listener();
  };

  disposers.push(
    preview.subscribe(() => {
      const state = preview.state;
      const anchor = state?.anchor ?? null;
      selectedEid = anchor?.eid ?? null;
      if (state && anchor) {
        catalogue.set(anchor.eid, {
          eid: anchor.eid,
          eidIndex: anchor.eidIndex,
          loc: anchor.loc,
          tag: anchor.tag,
          text: state.textValue,
          classes: state.classValue.split(/\s+/).filter((name) => name !== ''),
          textKind: anchor.textKind,
          classKind: anchor.classKind,
          selected: true,
        });
      }
      announce();
    }),
  );

  disposers.push(log.subscribe(announce));

  const elements = (): PlanTarget[] =>
    [...catalogue.values()].map((target) => ({ ...target, selected: target.eid === selectedEid }));

  /** Whole loops, one at a time. A failed job must not wedge the queue behind it. */
  let tail: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  async function applyIntent(intent: EditIntent, origin: ChangeOrigin): Promise<AppliedOutcome> {
    // The row opens now, not when the job starts: a user who pressed Apply and is waiting
    // behind another job should see that theirs exists.
    const rowId = log.start({ intent, origin });

    return serial(async () => {
      // Read at the moment Apply was pressed, so a further edit typed while the job is in
      // flight is not silently discarded by a verdict about the previous one.
      let applied = null;
      try {
        applied = await preview.getOverride(intent.eid);
      } catch {
        /* the preview going away is reported by the loop's own first call */
      }

      const outcome = await runVerification(intent, {
        target: preview.target,
        apply: options.apply,
        applied,
      });
      log.resolve(rowId, outcome);
      return { ...outcome, rowId };
    });
  }

  const chat = createChat({
    planner: options.planner,
    preview,
    elements,
    applyIntent,
  });
  disposers.push(chat.subscribe(announce));

  return {
    preview,
    log,
    chat,
    elements,
    applyIntent,

    async selectRow(id) {
      const row = log.row(id);
      if (!row) return;
      try {
        await preview.select({ eid: row.eid, eidIndex: row.eidIndex });
      } catch {
        // A row can outlive its element — the log is session state and the page is not.
      }
    },

    async revertRow(id) {
      const row = log.row(id);
      if (!row || row.jobId === null || !row.revertable) return;

      return serial(async () => {
        let result: EditResult;
        // Started before the request: the restore is a write like any other, and the page
        // is about to re-render from it.
        const settling = preview.target.watchForUpdate().catch(() => false);
        try {
          result = await options.revert(row.jobId as string);
        } catch (error) {
          log.fail(id, error instanceof Error ? error.message : String(error));
          return;
        }

        if (result.status !== 'reverted') {
          log.fail(id, result.message ?? 'the snapshot could not be restored');
          return;
        }

        // The file is back, so the page is about to be. Wait before lifting the override,
        // or the user sees React's old render flash through the gap.
        await settling;
        try {
          await preview.refresh();
          await preview.clearOverride(row.eid);
        } catch {
          /* the verdict below is still the truth about the file */
        }
        log.markReverted(id);
      });
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    dispose() {
      for (const dispose of disposers.splice(0)) dispose();
      listeners.clear();
    },
  };
}
