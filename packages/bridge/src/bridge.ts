import path from 'node:path';
import {
  parseLoc,
  type ApplyRequest,
  type EditIntent,
  type EditResult,
  type ProgressEvent,
  type ProgressPhase,
} from '@sve/protocol';
import { resolveAgentRunner } from './agent/index.js';
import type { AgentEnv, AgentRunner } from './agent/types.js';
import { lineDiff } from './diff.js';
import { nodeFs, type BridgeFs } from './fs.js';
import { denialMessage, isInsideEditRoots } from './guard.js';
import { ProgressHub } from './progress.js';
import { buildPrompt } from './prompt.js';
import { SerialQueue } from './queue.js';
import { SnapshotStore } from './snapshot.js';

export interface BridgeOptions {
  /** Project root. Relative locs resolve against it, and `.sve/undo` lives under it. */
  root: string;
  /** Paths the agent may write. Defaults to `[root]`. */
  editRoots?: readonly string[];
  fs?: BridgeFs;
  /** Defaults to whatever `SVE_AGENT` selects. */
  agent?: AgentRunner;
  env?: AgentEnv;
  contextLines?: number;
  newJobId?: () => string;
  undoRoot?: string;
}

export interface Bridge {
  readonly root: string;
  readonly editRoots: readonly string[];
  readonly agent: AgentRunner;
  readonly queue: SerialQueue;
  readonly progress: ProgressHub;
  readonly snapshots: SnapshotStore;
  /** One job per intent; resolves when every one of them has settled. */
  apply(request: ApplyRequest): Promise<EditResult[]>;
  revert(jobId: string): Promise<EditResult>;
  close(): void;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createBridge(options: BridgeOptions): Bridge {
  const root = path.resolve(options.root);
  const editRoots = (options.editRoots ?? [root]).map((editRoot) => path.resolve(editRoot));
  const fs = options.fs ?? nodeFs;
  const agent = options.agent ?? resolveAgentRunner(options.env);
  const queue = new SerialQueue();
  const progress = new ProgressHub();
  const snapshots = new SnapshotStore({ root, fs, undoRoot: options.undoRoot });
  const lifetime = new AbortController();

  let counter = 0;
  const newJobId =
    options.newJobId ?? (() => `job_${Date.now().toString(36)}_${(counter++).toString(36)}`);

  function emit(event: ProgressEvent): void {
    progress.emit(event);
  }

  function announce(jobId: string, phase: ProgressPhase, detail?: string, tool?: string): void {
    emit({ jobId, phase, ...(detail ? { detail } : {}), ...(tool ? { tool } : {}) });
  }

  async function permit(target: string | undefined) {
    if (target === undefined) return { behavior: 'allow' } as const;
    const resolved = path.isAbsolute(target) ? target : path.resolve(root, target);
    return (await isInsideEditRoots(resolved, editRoots, fs))
      ? ({ behavior: 'allow' } as const)
      : ({ behavior: 'deny', message: denialMessage(resolved, editRoots) } as const);
  }

  async function runJob(jobId: string, intent: EditIntent): Promise<EditResult> {
    try {
      const loc = parseLoc(intent.loc);
      if (loc === null) {
        return { jobId, status: 'error', message: `unparseable loc: ${intent.loc}` };
      }

      const file = path.isAbsolute(loc.file) ? path.resolve(loc.file) : path.resolve(root, loc.file);

      // Checked before the snapshot, not only inside canUseTool: a path the
      // agent may not write is a path we may not read or copy either.
      if (!(await isInsideEditRoots(file, editRoots, fs))) {
        return { jobId, status: 'blocked', message: denialMessage(file, editRoots) };
      }

      announce(jobId, 'snapshot', file);
      await snapshots.snapshot(jobId, [file]);

      // Fresh at job time. The queue is serial precisely so this read reflects
      // every write that came before it, and never a copy taken at enqueue time.
      const source = await fs.readFile(file);
      const prompt = buildPrompt({ intent, source, contextLines: options.contextLines });

      announce(jobId, 'agent', agent.name);

      let sawWriting = false;
      const outcome = await agent.run({
        jobId,
        intent,
        loc,
        file,
        root,
        editRoots,
        prompt,
        fs,
        signal: lifetime.signal,
        canUseTool: (request) => permit(request.path),
        report(update) {
          const phase = update.phase ?? 'agent';
          if (phase === 'writing') sawWriting = true;
          emit({
            jobId,
            phase,
            ...(update.detail ? { detail: update.detail } : {}),
            ...(update.tool ? { tool: update.tool } : {}),
          });
        },
      });

      switch (outcome.kind) {
        case 'edited': {
          if (!sawWriting) announce(jobId, 'writing', file);
          const after = await fs.readFile(file);
          const diff = lineDiff(source, after, loc.file);
          return {
            jobId,
            status: 'landed',
            ...(diff ? { diff } : {}),
            ...(outcome.message ? { message: outcome.message } : {}),
            ...(outcome.sessionId ? { sessionId: outcome.sessionId } : {}),
          };
        }

        case 'blocked':
          return {
            jobId,
            status: 'blocked',
            message: outcome.message,
            ...(outcome.sessionId ? { sessionId: outcome.sessionId } : {}),
          };

        case 'noop':
          // Success reported, nothing written: the change never landed, so the
          // honest status is stalled rather than a green light.
          return {
            jobId,
            status: 'stalled',
            message: outcome.message ?? 'the agent reported success but wrote nothing',
            ...(outcome.sessionId ? { sessionId: outcome.sessionId } : {}),
          };
      }
    } catch (error) {
      return { jobId, status: 'error', message: message(error) };
    } finally {
      announce(jobId, 'done');
    }
  }

  return {
    root,
    editRoots,
    agent,
    queue,
    progress,
    snapshots,

    async apply(request) {
      const pending = request.intents.map((intent) => {
        const jobId = newJobId();
        // Announced at enqueue, so a client watching already knows the job
        // exists while it is still waiting its turn behind another.
        announce(jobId, 'queued', intent.loc);
        return queue
          .enqueue(() => runJob(jobId, intent))
          .catch((error: unknown): EditResult => ({ jobId, status: 'error', message: message(error) }));
      });
      return Promise.all(pending);
    },

    async revert(jobId) {
      const result = await snapshots.revert(jobId);
      return result.ok
        ? { jobId, status: 'reverted', message: `reverted ${result.restored.length} file(s)` }
        : { jobId, status: 'error', message: result.message ?? `unknown jobId: ${jobId}` };
    },

    close() {
      lifetime.abort();
      progress.close();
    },
  };
}
