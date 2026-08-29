/**
 * What a session looks like once it has crossed to the browser.
 *
 * A deliberate subset of `@sve/host`'s `SessionStatus`: `cacheDir` and `editRoots` are
 * facts about this machine's filesystem, and a page has no use for them that is worth the
 * paths appearing in a browser's memory. Everything the studio actually renders is here.
 *
 * Browser-safe. Nothing in this file imports Node or `@sve/host`'s implementation — only
 * its types, which are erased.
 */
import type { ConnectFailure, HostConfirmRequest, HostDiagnostic, SessionSource, StampingReport } from '@sve/host';

export type { ConnectFailure, HostConfirmRequest, HostDiagnostic };

export interface SessionSummary {
  id: string;
  url: string;
  root: string;
  port: number;
  /** The runner's name — the one the picker chose, never one an env var chose. */
  agent: string;
  source: SessionSource;
  stamping: StampingReport;
  diagnostics: HostDiagnostic[];
}

/** The states a connection passes through that the studio can honestly observe. */
export const CONNECT_PHASES = ['cloning', 'confirming', 'installing', 'detecting', 'starting'] as const;
export type ConnectPhase = (typeof CONNECT_PHASES)[number];

export type ConnectEvent =
  | { kind: 'phase'; phase: ConnectPhase; detail?: string }
  /** AC-11.5: nothing from a stranger's repository runs without this being answered. */
  | { kind: 'confirm'; id: string; request: HostConfirmRequest };

export type ConnectOutcome =
  | { ok: true; session: SessionSummary }
  | { ok: false; reason: ConnectFailure; message: string };

export interface ConnectFolder {
  folder: string;
  editRoots?: string[];
}

export interface ConnectRepository {
  repository: string;
  editRoots?: string[];
  install?: boolean;
}

export type ConnectRequestBody = ConnectFolder | ConnectRepository;

export function isRepositoryRequest(request: ConnectRequestBody): request is ConnectRepository {
  return 'repository' in request;
}

/** What the user typed, echoed back so a refusal is about something they recognise. */
export function targetOf(request: ConnectRequestBody): string {
  return isRepositoryRequest(request) ? request.repository : request.folder;
}
