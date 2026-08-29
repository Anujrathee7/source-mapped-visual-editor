/**
 * Connecting, as a state (AC-12.2).
 *
 * Two of the states here exist because of failures that are easy to render badly.
 *
 * `refused` carries the host's own message verbatim. The host already names what it looked
 * for and where — "no vite config; looked for vite.config.js, .mjs, .ts in /path" — and a
 * studio that replaced that with "could not connect" would be throwing away the only part
 * a user can act on.
 *
 * `blocked` exists because `no-elements-stamped` is not a warning. An editor that loads,
 * renders the project, and then does nothing when clicked is the failure most easily
 * mistaken for a broken product. The session is open and the diagnostic says exactly why
 * nothing will be selectable, so it stands in front of the workspace rather than beside it.
 */
import {
  targetOf,
  type ConnectEvent,
  type ConnectFailure,
  type ConnectPhase,
  type ConnectOutcome,
  type ConnectRequestBody,
  type HostConfirmRequest,
  type HostDiagnostic,
  type SessionSummary,
} from '../session.js';

export interface PendingConfirmation {
  id: string;
  request: HostConfirmRequest;
}

export type ConnectState =
  | { kind: 'idle' }
  | { kind: 'connecting'; phase: ConnectPhase; detail?: string; target: string }
  | { kind: 'confirming'; request: HostConfirmRequest; target: string }
  | { kind: 'refused'; reason: ConnectFailure; message: string; target: string }
  /** Connected, and unusable, and told so. */
  | { kind: 'blocked'; session: SessionSummary; diagnostic: HostDiagnostic }
  | { kind: 'connected'; session: SessionSummary; warnings: HostDiagnostic[] };

export interface ConnectTransport {
  connect(
    request: ConnectRequestBody,
    onEvent: (event: ConnectEvent) => void,
  ): Promise<ConnectOutcome>;
  answerConfirm(id: string, allow: boolean): Promise<void>;
}

export interface ConnectController {
  readonly state: ConnectState;
  confirmations(): PendingConfirmation[];
  subscribe(listener: () => void): () => void;
  connect(request: ConnectRequestBody): Promise<ConnectState>;
  answer(id: string, allow: boolean): Promise<void>;
  reset(): void;
}

export interface ConnectControllerOptions {
  transport: ConnectTransport;
}

export function createConnectController(options: ConnectControllerOptions): ConnectController {
  const listeners = new Set<() => void>();
  let state: ConnectState = { kind: 'idle' };
  let pending: PendingConfirmation[] = [];

  const announce = (): void => {
    for (const listener of [...listeners]) listener();
  };

  const set = (next: ConnectState): void => {
    state = next;
    announce();
  };

  return {
    get state() {
      return state;
    },

    confirmations: () => [...pending],

    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    async connect(request) {
      const target = targetOf(request);
      pending = [];
      // The first phase is known from the request rather than waited for: a clone is what
      // happens first for a repository and detection is what happens first for a folder,
      // and a panel with nothing in it while the round trip completes is a panel that
      // looks broken.
      set({
        kind: 'connecting',
        phase: 'repository' in request ? 'cloning' : 'detecting',
        target,
      });

      const outcome = await options.transport.connect(request, (event) => {
        if (event.kind === 'phase') {
          set({
            kind: 'connecting',
            phase: event.phase,
            ...(event.detail === undefined ? {} : { detail: event.detail }),
            target,
          });
          return;
        }
        pending = [...pending, { id: event.id, request: event.request }];
        set({ kind: 'confirming', request: event.request, target });
      });

      pending = [];

      if (!outcome.ok) {
        set({ kind: 'refused', reason: outcome.reason, message: outcome.message, target });
        return state;
      }

      const blocking = outcome.session.diagnostics.find((d) => d.level === 'error');
      if (blocking) {
        set({ kind: 'blocked', session: outcome.session, diagnostic: blocking });
        return state;
      }

      set({
        kind: 'connected',
        session: outcome.session,
        warnings: outcome.session.diagnostics.filter((d) => d.level !== 'error'),
      });
      return state;
    },

    async answer(id, allow) {
      pending = pending.filter((entry) => entry.id !== id);
      announce();
      await options.transport.answerConfirm(id, allow);
    },

    reset() {
      pending = [];
      set({ kind: 'idle' });
    },
  };
}
