/**
 * The chat panel's state (AC-12.1).
 *
 * Read the dependency list below: a planner, a preview, and `applyIntent`. There is no
 * `fetch` here, no bridge, no path to a file. A turn can do exactly two things — put an
 * override on the page, or hand an intent to the one loop the click path also uses — and
 * that is the whole of "there is no path from the chat panel to the filesystem that skips
 * the loop". It is a structural property, not a discipline.
 *
 * The other half is `send` never calling `applyIntent`. Proposing is not applying: the
 * user sees the change, the file does not, and if they close the tab nothing happened.
 */
import type { EditIntent } from '@sve/protocol';
import type { LoopOutcome } from './loop.js';
import type { ChangeOrigin } from './changes.js';
import type { PlanTarget, Planner, Proposal } from '../plan.js';
import type { PreviewController } from './preview.js';

export type TurnState =
  | 'thinking'
  | 'proposed'
  | 'unresolved'
  | 'applying'
  | 'settled'
  | 'discarded'
  | 'failed';

export interface ChatTurn {
  id: string;
  /** The user's words, verbatim. */
  request: string;
  /** The planner's sentence. Shown as written; never replaced with a summary. */
  reply: string;
  proposal: Proposal | null;
  state: TurnState;
  /** The change-log row this turn produced, once it was accepted. */
  rowId?: string;
  error?: string;
}

export type AppliedOutcome = LoopOutcome & { rowId: string };

export interface Chat {
  turns(): ChatTurn[];
  subscribe(listener: () => void): () => void;
  send(message: string): Promise<ChatTurn>;
  accept(turnId: string): Promise<AppliedOutcome | null>;
  discard(turnId: string): Promise<void>;
}

export interface ChatDeps {
  planner: Planner;
  preview: PreviewController;
  elements(): PlanTarget[];
  applyIntent(intent: EditIntent, origin: ChangeOrigin): Promise<AppliedOutcome>;
  newId?: () => string;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createChat(deps: ChatDeps): Chat {
  const turns: ChatTurn[] = [];
  const listeners = new Set<() => void>();
  let counter = 0;
  const nextId = deps.newId ?? (() => `turn_${(counter += 1).toString(36)}`);

  const announce = (): void => {
    for (const listener of [...listeners]) listener();
  };

  const find = (id: string): ChatTurn | undefined => turns.find((turn) => turn.id === id);
  const snapshot = (turn: ChatTurn): ChatTurn => ({ ...turn });

  return {
    turns: () => turns.map(snapshot),

    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    async send(message) {
      const turn: ChatTurn = {
        id: nextId(),
        request: message,
        reply: '',
        proposal: null,
        state: 'thinking',
      };
      turns.push(turn);
      announce();

      let result;
      try {
        result = await deps.planner.plan({ message, elements: deps.elements() });
      } catch (error) {
        turn.state = 'failed';
        turn.error = messageOf(error);
        turn.reply = turn.error;
        announce();
        return snapshot(turn);
      }

      turn.reply = result.reply;
      if (!result.resolved) {
        turn.state = 'unresolved';
        announce();
        return snapshot(turn);
      }

      const { proposal } = result;
      try {
        // Selected as well as overridden: a proposal the user cannot see the target of is
        // a proposal they cannot judge.
        await deps.preview.select({ eid: proposal.eid, eidIndex: proposal.eidIndex });
        await deps.preview.setOverride(proposal.eid, proposal.override);
      } catch (error) {
        turn.state = 'failed';
        turn.error = messageOf(error);
        announce();
        return snapshot(turn);
      }

      turn.proposal = proposal;
      turn.state = 'proposed';
      announce();
      return snapshot(turn);
    },

    async accept(turnId) {
      const turn = find(turnId);
      if (!turn || turn.proposal === null || turn.state !== 'proposed') return null;
      const { proposal } = turn;

      turn.state = 'applying';
      announce();

      try {
        // Re-selected first: the user may have clicked elsewhere while reading the reply,
        // and `captureIntent` captures whatever is selected.
        await deps.preview.select({ eid: proposal.eid, eidIndex: proposal.eidIndex });
        const intent = await deps.preview.captureIntent(proposal.kind);
        if (intent === null) {
          turn.state = 'failed';
          turn.error = 'The element this change was proposed for is no longer on the page.';
          announce();
          return null;
        }

        const outcome = await deps.applyIntent(intent, 'chat');
        turn.rowId = outcome.rowId;
        turn.state = 'settled';
        announce();
        return outcome;
      } catch (error) {
        turn.state = 'failed';
        turn.error = messageOf(error);
        announce();
        return null;
      }
    },

    async discard(turnId) {
      const turn = find(turnId);
      if (!turn || turn.proposal === null || turn.state !== 'proposed') return;
      try {
        await deps.preview.clearOverride(turn.proposal.eid);
      } catch {
        // The preview going away is not a reason to keep a proposal the user rejected.
      }
      turn.state = 'discarded';
      announce();
    },
  };
}
