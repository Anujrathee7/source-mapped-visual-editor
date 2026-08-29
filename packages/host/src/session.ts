/**
 * One project, served with the editor in it, and everything that has to be given back.
 *
 * The whole of v2's promise lives in `createServer` below: the project's own config is
 * discovered and merged by vite, our plugin is appended to the array vite built, and no
 * file in the project is touched to make that happen (AC-11.1, AC-11.2).
 *
 * Two of the options exist purely so that promise holds:
 *
 *  - `cacheDir` is moved out of the project. vite's default is `<root>/node_modules/.vite`,
 *    and pre-bundled dependencies written there are files appearing in someone's
 *    repository the moment they connect it.
 *  - `configLoader: 'runner'` is not a preference. The default loader bundles the config
 *    and writes the bundle to `<root>/node_modules/.vite-temp/` — creating that directory
 *    and leaving it behind — or, in a project with no `node_modules` at all, next to
 *    `vite.config.ts` itself. The runner loads the config in-process and writes nothing.
 */
import path from 'node:path';
import { createServer, type InlineConfig, type ViteDevServer } from 'vite';
import type { AgentRunner, BridgeMiddleware } from '@sve/bridge';
import { sve } from '@sve/vite';
import type { StampReport } from '@sve/source-loc';
import { probeProject } from './probe.js';

export interface SessionSource {
  kind: 'folder' | 'repository';
  /** The folder that was opened. For a clone, where it landed. */
  path: string;
  /** `owner/name`, for a session that came from a clone. */
  repository?: string;
}

export interface StampingReport {
  /** False until the host has actually asked the server for the project's modules. */
  probed: boolean;
  /** Files the stamping pass looked at. */
  filesConsidered: number;
  /** Of those, the ones that yielded at least one origin. */
  filesStamped: number;
  elementsStamped: number;
  modulesFetched: number;
  /** The stamped files, project-relative, so a UI can say *what* it found. */
  files: string[];
}

export interface HostDiagnostic {
  code: 'no-elements-stamped' | 'page-not-served';
  level: 'error' | 'warning';
  message: string;
}

export interface SessionStatus {
  id: string;
  state: 'serving' | 'closed';
  root: string;
  url: string;
  port: number;
  /** Deliberately outside the project. Asserted, because AC-11.1 turns on it. */
  cacheDir: string;
  editRoots: string[];
  source: SessionSource;
  /** The runner's name — the one the caller constructed, never one an env var chose. */
  agent: string;
  stamping: StampingReport;
  diagnostics: HostDiagnostic[];
}

export interface HostSession {
  readonly id: string;
  readonly root: string;
  readonly url: string;
  status(): SessionStatus;
  /** Re-runs the stamping probe, for a caller that changed the project underneath. */
  probe(): Promise<StampingReport>;
  close(): Promise<void>;
}

/** How long a session waits for in-flight transforms before it stops caring. */
export const DRAIN_TIMEOUT_MS = 5_000;
/** And how long vite gets to shut down before the session gives up on the promise. */
export const CLOSE_TIMEOUT_MS = 10_000;

function withTimeout(work: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // `unref` so a bound that is never reached cannot be the reason a process stays alive.
    timer.unref?.();
    void work.catch(() => undefined).then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

interface DrainableEnvironment {
  waitForRequestsIdle(): Promise<void>;
}

function drain(server: ViteDevServer, ms: number): Promise<void> {
  const environments = Object.values(
    server.environments as unknown as Record<string, DrainableEnvironment>,
  );
  return withTimeout(
    Promise.all(environments.map((environment) => environment.waitForRequestsIdle())),
    ms,
  );
}

export interface StartSessionOptions {
  id: string;
  root: string;
  editRoots: readonly string[];
  source: SessionSource;
  agent: AgentRunner;
  cacheDir: string;
  port: number;
  /** Skips the load that makes AC-11.4's silence detectable. Tests only. */
  probe?: boolean;
  probeLimit?: number;
}

export async function startSession(options: StartSessionOptions): Promise<HostSession> {
  const root = path.resolve(options.root);
  const editRoots = options.editRoots.map((editRoot) => path.resolve(editRoot));

  /**
   * One entry per file the stamping pass considered, keyed by file.
   *
   * A map rather than a counter because hot reload re-transforms a file, and a running
   * total would report a project as more thoroughly stamped every time somebody saved.
   */
  const stamps = new Map<string, number>();
  let middleware: BridgeMiddleware | null = null;
  let probed = false;
  let modulesFetched = 0;
  let state: 'serving' | 'closed' = 'serving';

  const config: InlineConfig = {
    root,
    // The project's own config, found and merged by vite. Nothing is written to it.
    configLoader: 'runner',
    cacheDir: options.cacheDir,
    logLevel: 'silent',
    clearScreen: false,
    server: {
      port: options.port,
      // Not strict: two sessions racing for a port should get two ports, not one failure.
      strictPort: false,
      host: '127.0.0.1',
    },
    plugins: [
      sve({
        root,
        editRoots,
        agent: options.agent,
        onMiddleware: (mounted) => {
          middleware = mounted;
        },
        onStamp: (report: StampReport) => {
          stamps.set(report.file, report.elements);
        },
      }),
    ],
  };

  const server: ViteDevServer = await createServer(config);
  await server.listen();

  const address = server.httpServer?.address();
  const port =
    typeof address === 'object' && address !== null ? address.port : (options.port ?? 0);
  const url = server.resolvedUrls?.local[0] ?? `http://127.0.0.1:${port}/`;

  const stamping = (): StampingReport => {
    let elements = 0;
    const files: string[] = [];
    for (const [file, count] of stamps) {
      elements += count;
      if (count > 0) files.push(file);
    }
    return {
      probed,
      filesConsidered: stamps.size,
      filesStamped: files.length,
      elementsStamped: elements,
      modulesFetched,
      files: files.sort(),
    };
  };

  const diagnose = (report: StampingReport): HostDiagnostic[] => {
    if (!report.probed) return [];
    if (report.modulesFetched === 0) {
      return [
        {
          code: 'page-not-served',
          level: 'warning',
          message:
            `${root} served no module of its own from index.html, so nothing could be ` +
            `stamped. Check that the page has a <script type="module"> pointing into the ` +
            `project.`,
        },
      ];
    }
    if (report.elementsStamped > 0) return [];
    return [
      {
        code: 'no-elements-stamped',
        level: 'error',
        message:
          `Nothing in ${root} was stamped with an origin. ${report.modulesFetched} module(s) ` +
          `reachable from index.html were served and ${report.filesConsidered} of them were ` +
          `examined, and none contained a JSX host element. The editor will load and select ` +
          `nothing when clicked. Check that the project renders host elements — a <div>, not ` +
          `only components — in .js, .jsx or .tsx files under ${editRoots.join(', ')}.`,
      },
    ];
  };

  const runProbe = async (): Promise<StampingReport> => {
    const result = await probeProject(url, {
      ...(options.probeLimit === undefined ? {} : { limit: options.probeLimit }),
    });
    modulesFetched = result.modulesFetched;
    probed = true;
    return stamping();
  };

  if (options.probe !== false) await runProbe();

  return {
    id: options.id,
    root,
    url,

    status(): SessionStatus {
      const report = stamping();
      return {
        id: options.id,
        state,
        root,
        url,
        port,
        cacheDir: path.resolve(options.cacheDir),
        editRoots: [...editRoots],
        source: options.source,
        agent: options.agent.name,
        stamping: report,
        diagnostics: state === 'serving' ? diagnose(report) : [],
      };
    },

    probe: runProbe,

    /**
     * Everything this session took, given back (AC-11.6).
     *
     * The middleware is closed here rather than left to the plugin's `httpServer` hook,
     * because that hook is registered on nothing in middleware mode; and the plugin's own
     * `buildEnd` will close it a second time when vite tears the container down, which is
     * why closing is idempotent on both sides.
     *
     * The drain in front of it is not politeness. `DevEnvironment.close()` ends with
     * `while (pendingRequests.size > 0) await ...`, and a request parked on a dependency
     * the optimizer is still rewriting never settles once the optimizer is being torn
     * down — so closing mid-optimization waits forever. Reproduced reliably by opening a
     * project, fetching one module, and closing immediately. Draining first is what makes
     * the second and every later session close at all; the bounds below are there so that
     * a project which never goes idle costs a delay rather than a stuck host.
     */
    async close(): Promise<void> {
      if (state === 'closed') return;
      state = 'closed';
      await drain(server, DRAIN_TIMEOUT_MS);
      middleware?.close();
      // `server.close()` runs its parts with `allSettled`, and freeing the port is one of
      // them — so even in the pathological case the bound expires on, the port is gone.
      await withTimeout(server.close(), CLOSE_TIMEOUT_MS);
    },
  };
}
