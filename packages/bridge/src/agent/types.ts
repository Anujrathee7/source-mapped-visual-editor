import type { EditIntent, Loc, Mismatch, ProgressPhase } from '@sve/protocol';
import type { BridgeFs } from '../fs.js';

/**
 * The seam the real Claude Agent SDK runner drops into in M7.
 *
 * Everything a runner is allowed to do arrives through {@link AgentContext}:
 * the resolved intent, the prompt, the fs it may use, the permission callback
 * it must ask first, and a progress channel. It returns an outcome; it does not
 * decide the job's status, format an `EditResult`, or touch the snapshot. That
 * keeps the fake and the real runner interchangeable, and keeps the security
 * boundary out of the runner's hands — a runner cannot widen its own reach.
 */
export type ToolPermission = { behavior: 'allow' } | { behavior: 'deny'; message: string };

export interface AgentToolRequest {
  /** Tool name as the SDK reports it, e.g. `Edit`, `Write`, `Read`. */
  tool: string;
  /** The path the tool wants to touch, when it names one. */
  path?: string;
  input?: Record<string, unknown>;
}

export interface AgentProgress {
  phase?: ProgressPhase;
  detail?: string;
  tool?: string;
}

/**
 * What makes an attempt a *retry* rather than a fresh job (AC-6.5).
 *
 * The mismatch is the overlay's own recording — intent on one side, what the
 * page rendered after hot reload on the other. It is passed through rather than
 * re-derived here: the comparison that produced it is the verifier's, and the
 * bridge taking a second opinion on what "differs" would be a second comparator.
 *
 * `sessionId` is the session the previous attempt ran in, so a runner that has
 * sessions can continue that conversation instead of starting one that has no
 * memory of having answered.
 */
export interface AgentRetry {
  readonly sessionId?: string;
  readonly mismatch: readonly Mismatch[];
}

export interface AgentContext {
  readonly jobId: string;
  readonly intent: EditIntent;
  /** `intent.loc` already parsed — every runner needs it, none should re-parse it. */
  readonly loc: Loc;
  /** Absolute, already resolved against the project root. */
  readonly file: string;
  readonly root: string;
  readonly editRoots: readonly string[];
  /** Built by the bridge from source read fresh at job time. */
  readonly prompt: string;
  /** Present only when this attempt follows one that drifted (AC-6.5). */
  readonly retry?: AgentRetry;
  /**
   * Guarded (AC-7.1): every member checks `isInsideEditRoots` before delegating,
   * reads included, and rejects with a `PathNotPermittedError` otherwise. Asking
   * {@link AgentContext.canUseTool} first is still the courteous path — a refusal
   * answered there becomes a clean `blocked` instead of an exception mid-edit —
   * but it is no longer what makes the boundary hold.
   */
  readonly fs: BridgeFs;
  /** Aborted when the bridge is closed; a long-running runner should honour it. */
  readonly signal: AbortSignal;
  /**
   * Asked before every filesystem-touching tool call. A denial is an answer,
   * not an exception: the runner is told no and is expected to stop and report
   * `blocked` (AC-3.3).
   */
  canUseTool(request: AgentToolRequest): Promise<ToolPermission>;
  report(update: AgentProgress): void;
}

export interface AgentEdited {
  kind: 'edited';
  /** Absolute paths actually written. */
  files: string[];
  message?: string;
  sessionId?: string;
}

export interface AgentBlocked {
  kind: 'blocked';
  reason: string;
  /** Always `BLOCKED: <reason>` — the literal reply shape the prompt asks for. */
  message: string;
  sessionId?: string;
}

export interface AgentNoop {
  kind: 'noop';
  message?: string;
  sessionId?: string;
}

export type AgentOutcome = AgentEdited | AgentBlocked | AgentNoop;

export const BLOCKED_PREFIX = 'BLOCKED: ';

export function blocked(reason: string, sessionId?: string): AgentBlocked {
  const trimmed = reason.startsWith(BLOCKED_PREFIX) ? reason.slice(BLOCKED_PREFIX.length) : reason;
  return { kind: 'blocked', reason: trimmed, message: `${BLOCKED_PREFIX}${trimmed}`, sessionId };
}

export interface AgentRunner {
  readonly name: string;
  /** False for the CI path, so a test can assert it runs without an API key. */
  readonly requiresNetwork: boolean;
  run(ctx: AgentContext): Promise<AgentOutcome>;
}

export type AgentEnv = Readonly<Record<string, string | undefined>>;

export interface AgentRunnerOptions {
  env: AgentEnv;
}

export type AgentRunnerFactory = (options: AgentRunnerOptions) => AgentRunner;
