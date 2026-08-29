/**
 * `@sve/host` — opening someone else's project, and serving it with the editor in it.
 *
 * v1 asked a project to register a plugin in its own `vite.config.ts`. v2 asks for a
 * folder, or a GitHub url, and the repository is never ours to modify — which is where
 * every decision in this package comes from.
 *
 * The API is typed and returns answers rather than throwing them (AC-11.8). A refusal is
 * something a user is *told*: "this project has no Vite config" is a sentence, and turning
 * it into an exception would push the sentence into a stack trace at the exact moment the
 * user needs to read it.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { AgentRunner } from '@sve/bridge';
import {
  cloneRepository,
  spawnCommand,
  type CommandRunner,
  type GitRunner,
  type Repository,
} from './clone.js';
import { ask, confirmRequest, type HostConfirm } from './confirm.js';
import { detectProject, type RefusalReason } from './detect.js';
import { startSession, type HostSession, type SessionStatus } from './session.js';

/** The first port a host tries. Clear of 5173/5174, which v1's servers use. */
export const DEFAULT_PORT_BASE = 5310;

export interface AgentContextForSession {
  sessionId: string;
  root: string;
  source: 'folder' | 'repository';
}

export interface HostOptions {
  /**
   * Where clones, and every dependency cache, live.
   *
   * Never inside a connected project: AC-11.1 is that a project is byte-for-byte unchanged
   * by having been opened, and a pre-bundled dependency cache is a file appearing in
   * somebody's repository.
   */
  workspaceDir: string;
  /**
   * Builds the coding agent for a session.
   *
   * Required, and deliberately not defaulted to `resolveAgentRunner`. A host serves several
   * projects at once (AC-11.7) and `SVE_AGENT` is a single string for the whole process:
   * one env var cannot describe two sessions, and letting it try would mean the second
   * session's agent depended on nothing the caller said.
   */
  createAgent: (context: AgentContextForSession) => AgentRunner;
  /**
   * The studio's own origin, handed to every session it opens (AC-15.3).
   *
   * A function rather than a string because a dev server does not know its own URL until
   * it listens, and the host is constructed before that. Resolved per session, and the
   * answer must come from that server — never from a value a browser supplied, which
   * would let the first page to frame a project drive its filesystem.
   */
  studioOrigin?: () => string | undefined;
  /** Asked before anything from a cloned repository is executed. Absent means no. */
  confirm?: HostConfirm;
  git?: GitRunner;
  runCommand?: CommandRunner;
  newSessionId?: () => string;
  portBase?: number;
  /** Skips the post-listen load that detects a project where nothing was stamped. */
  probe?: boolean;
}

export interface ConnectFolderRequest {
  folder: string;
  /** Overrides detection, still guarded against escaping the project. */
  editRoots?: readonly string[];
}

export interface ConnectRepositoryRequest {
  repository: string;
  editRoots?: readonly string[];
  /** Asks to run `npm install` in the clone. Confirmed separately, never implied. */
  install?: boolean;
}

export type ConnectRequest = ConnectFolderRequest | ConnectRepositoryRequest;

export type ConnectFailure =
  | RefusalReason
  | 'not-a-repository'
  | 'unsafe-target'
  | 'already-exists'
  | 'clone-failed'
  | 'not-confirmed'
  | 'install-failed'
  | 'server-failed';

export type ConnectResult =
  | { ok: true; session: HostSession }
  | { ok: false; reason: ConnectFailure; message: string };

export interface Host {
  readonly workspaceDir: string;
  connect(request: ConnectRequest): Promise<ConnectResult>;
  /** One session's status, or null when nothing by that id is open. */
  status(id: string): SessionStatus | null;
  sessions(): SessionStatus[];
  close(id: string): Promise<void>;
  closeAll(): Promise<void>;
}

function isRepositoryRequest(request: ConnectRequest): request is ConnectRepositoryRequest {
  return 'repository' in request;
}

export function createHost(options: HostOptions): Host {
  const workspaceDir = path.resolve(options.workspaceDir);
  const sessions = new Map<string, HostSession>();
  const runCommand = options.runCommand ?? spawnCommand;

  let counter = 0;
  const newSessionId =
    options.newSessionId ?? (() => `sve_${Date.now().toString(36)}_${(counter++).toString(36)}`);
  /**
   * A different starting port per session (AC-11.7).
   *
   * vite will walk upward from here if the port is taken, so this only has to make two
   * sessions *start* looking in different places; it does not have to be right.
   */
  let nextPort = options.portBase ?? DEFAULT_PORT_BASE;

  async function acquire(request: ConnectRequest): Promise<
    | { ok: true; folder: string; source: 'folder' | 'repository'; repository?: Repository }
    | { ok: false; reason: ConnectFailure; message: string }
  > {
    if (!isRepositoryRequest(request)) {
      return { ok: true, folder: path.resolve(request.folder), source: 'folder' };
    }

    const cloned = await cloneRepository(request.repository, {
      workspaceDir,
      ...(options.git === undefined ? {} : { git: options.git }),
    });
    if (!cloned.ok) return { ok: false, reason: cloned.reason, message: cloned.message };

    if (request.install === true) {
      const install = confirmRequest(
        'install',
        cloned.repository.slug,
        cloned.directory,
        'npm install',
      );
      if (!(await ask(options.confirm, install))) {
        return {
          ok: false,
          reason: 'not-confirmed',
          message:
            `Installing dependencies for ${cloned.repository.slug} was not confirmed, so ` +
            `nothing was run. ${install.message}`,
        };
      }
      const result = await runCommand('npm', ['install'], cloned.directory);
      if (!result.ok) {
        return {
          ok: false,
          reason: 'install-failed',
          message: `npm install in ${cloned.directory} failed: ${result.stderr.trim() || 'no output'}`,
        };
      }
    }

    // Starting the dev server loads the repository's own vite config, which is code from
    // the same stranger. Confirmed separately from the install: saying yes to one is not
    // saying yes to the other.
    const run = confirmRequest('run', cloned.repository.slug, cloned.directory, 'vite dev server');
    if (!(await ask(options.confirm, run))) {
      return {
        ok: false,
        reason: 'not-confirmed',
        message:
          `Starting the dev server for ${cloned.repository.slug} was not confirmed, so ` +
          `nothing was run. ${run.message}`,
      };
    }

    return {
      ok: true,
      folder: cloned.directory,
      source: 'repository',
      repository: cloned.repository,
    };
  }

  return {
    workspaceDir,

    async connect(request: ConnectRequest): Promise<ConnectResult> {
      const acquired = await acquire(request);
      if (!acquired.ok) return acquired;

      const detected = await detectProject(acquired.folder, {
        ...(request.editRoots === undefined ? {} : { editRoots: request.editRoots }),
      });
      if (!detected.ok) {
        return { ok: false, reason: detected.reason, message: detected.message };
      }

      const id = newSessionId();
      const cacheDir = path.join(workspaceDir, 'cache', id);
      await mkdir(cacheDir, { recursive: true });

      try {
        const studioOrigin = options.studioOrigin?.();
        const session = await startSession({
          id,
          root: detected.root,
          editRoots: detected.editRoots,
          source: {
            kind: acquired.source,
            path: detected.root,
            ...(acquired.repository ? { repository: acquired.repository.slug } : {}),
          },
          agent: options.createAgent({ sessionId: id, root: detected.root, source: acquired.source }),
          cacheDir,
          port: nextPort++,
          ...(studioOrigin === undefined ? {} : { studioOrigin }),
          ...(options.probe === undefined ? {} : { probe: options.probe }),
        });
        // Wrapped so that closing the session a caller holds is the same event as closing
        // it through the host: `sessions()` must not keep listing a server that has stopped.
        const tracked: HostSession = {
          ...session,
          close: async () => {
            sessions.delete(id);
            await session.close();
          },
        };
        sessions.set(id, tracked);
        return { ok: true, session: tracked };
      } catch (error) {
        return {
          ok: false,
          reason: 'server-failed',
          message: `starting vite on ${detected.root} failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
    },

    status(id: string): SessionStatus | null {
      return sessions.get(id)?.status() ?? null;
    },

    sessions(): SessionStatus[] {
      return [...sessions.values()].map((session) => session.status());
    },

    async close(id: string): Promise<void> {
      const session = sessions.get(id);
      if (session === undefined) return;
      sessions.delete(id);
      await session.close();
    },

    async closeAll(): Promise<void> {
      const open = [...sessions.values()];
      sessions.clear();
      // Settled rather than all: one server refusing to shut down must not strand the rest.
      await Promise.allSettled(open.map((session) => session.close()));
    },
  };
}
