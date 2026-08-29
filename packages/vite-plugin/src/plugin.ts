/**
 * `@sve/vite` — the three-part dev-server integration the other packages left unjoined.
 *
 * Until this milestone the editor was four packages that never met. `sourceLoc()` stamped
 * origins into a transform nobody mounted; `createBridgeMiddleware()` answered routes no
 * server exposed; `mountOverlay()` was a browser module the page never imported. This
 * plugin is the whole of the joining, and it is deliberately the *only* place the joining
 * happens, so "how does the editor get into the page?" has one answer:
 *
 *   1. `sourceLoc()`         — every JSX host element is stamped with `file:line:col`;
 *   2. `configureServer`     — the bridge's routes are mounted on the dev server;
 *   3. `transformIndexHtml`  — a `<script>` for a virtual module is injected into the page,
 *      and that module boots the overlay.
 *
 * Step 3 is why `apps/demo/src` can stay free of every `@sve/*` import: the page under
 * edit is not asked to wire in the thing editing it. Registering this plugin in
 * `vite.config.ts` is build configuration, and it is the only line the app ever sees.
 *
 * Everything here is `apply: 'serve'`. A production build has no bridge to answer a stamp
 * and no overlay to read one, so a stamp in a shipped bundle is dead weight that also
 * leaks source paths.
 */
import path from 'node:path';
import { searchForWorkspaceRoot, type Plugin } from 'vite';
import { createBridgeMiddleware, type AgentRunner, type BridgeMiddleware } from '@sve/bridge';
import { sourceLoc, type StampReport } from '@sve/source-loc';
import {
  CLIENT_ENTRY_SPECIFIER,
  DEFAULT_SETTLE_MS,
  DEFAULT_VERIFY_TIMEOUT_MS,
  RESOLVED_ENTRY_ID,
  VIRTUAL_ENTRY_ID,
} from './constants.js';
import { CLIENT_ENTRY_PATH, CLIENT_PACKAGES, clientPackageDirs } from './locate.js';

export interface SveOptions {
  /**
   * Turns the editor off entirely — no stamping, no bridge, no overlay.
   *
   * The demo's own smoke suite (AC-2.5) runs against the page with the editor absent, and
   * a switch here is what lets one `vite.config.ts` serve both that and `npm run dev`.
   */
  enabled?: boolean;

  /**
   * The root every stamped loc is relative to, and the root the bridge resolves those
   * locs against. Defaults to Vite's own root.
   *
   * Keeping the three in step is the point: a loc is written by the Babel pass, read back
   * by the overlay to fetch a source excerpt over the dev server, and resolved to an
   * absolute path by the bridge. One root means those three never disagree.
   */
  root?: string;

  /**
   * Paths the agent may write. Defaults to `<root>/src`.
   *
   * Not `root` itself: the config files that decide what the agent may touch live there,
   * and an agent that can rewrite its own guard has no guard.
   */
  editRoots?: readonly string[];

  /**
   * Vite's root as the *loc* spells it, when the two differ. Used by the overlay to turn
   * `src/components/Hero.tsx` into a dev-server URL.
   */
  viteRoot?: string;

  /** How long the overlay waits for hot reload before reporting `stalled` (AC-5.7). */
  verifyTimeoutMs?: number;

  /** How long hot reload must stay quiet before the page counts as settled. */
  settleMs?: number;

  /**
   * The coding agent this server's bridge runs. Defaults to whatever `SVE_AGENT` selects.
   *
   * A host opens several projects in one process (AC-11.7), and `SVE_AGENT` is one string
   * for the whole of it. Constructing the runner per session and passing it in is what
   * lets two sessions differ — and what keeps a process-wide environment variable from
   * deciding something a caller already decided.
   */
  agent?: AgentRunner;

  /**
   * Called with the mounted middleware, so its owner can close it.
   *
   * `configureServer` is the only place the middleware exists, and in middleware mode
   * there is no `httpServer` whose `close` event could stand in for one (AC-11.6).
   */
  onMiddleware?: (middleware: BridgeMiddleware) => void;

  /** Forwarded to the stamping pass: one report per file it considered (AC-11.4). */
  onStamp?: (report: StampReport) => void;
}

/** The shape serialised into the virtual module and handed to the client's `boot()`. */
export interface ClientConfig {
  viteRoot: string;
  verifyTimeoutMs: number;
  settleMs: number;
}

function editorPlugin(options: SveOptions): Plugin {
  let root = options.root === undefined ? process.cwd() : path.resolve(options.root);
  let middleware: BridgeMiddleware | null = null;

  const clientConfig = (): ClientConfig => ({
    viteRoot: options.viteRoot ?? '',
    verifyTimeoutMs: options.verifyTimeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS,
    settleMs: options.settleMs ?? DEFAULT_SETTLE_MS,
  });

  return {
    name: 'sve:editor',
    apply: 'serve',

    /**
     * What the dev server needs to know before it can serve a package the project has
     * never heard of (AC-11.3).
     *
     * `fs.allow` is the delicate one. vite resolves it as `raw?.fs?.allow ?? [workspaceRoot]`,
     * so once *anything* sets it the default is gone — a plugin that returns only its own
     * directories takes the project's own source away from it. When the project set no
     * list we therefore spell the default out ourselves and add to it; when it set one,
     * vite concatenates, so we return only ours and repeat none of theirs.
     */
    config(userConfig) {
      const configRoot = path.resolve(userConfig.root ?? options.root ?? process.cwd());
      const explicit = userConfig.server?.fs?.allow;
      const ours = clientPackageDirs();

      return {
        server: {
          fs: { allow: explicit === undefined ? [searchForWorkspaceRoot(configRoot), ...ours] : ours },
        },
        // Our packages are TypeScript source living outside the project, and pre-bundling
        // them would both fail to find them and freeze a copy the dev server cannot
        // hot-replace. Named transitively: excluding only the entry leaves the optimizer
        // free to swallow what it imports.
        optimizeDeps: { exclude: [...CLIENT_PACKAGES] },
      };
    },

    configResolved(config) {
      // An explicit root wins; otherwise follow the dev server's, so the loc the Babel
      // pass writes and the path the bridge resolves are the same string.
      if (options.root === undefined) root = config.root;
    },

    configureServer(server) {
      middleware = createBridgeMiddleware({
        root,
        editRoots: options.editRoots ?? [path.resolve(root, 'src')],
        ...(options.agent === undefined ? {} : { agent: options.agent }),
      });
      server.middlewares.use(middleware);
      options.onMiddleware?.(middleware);
      // A queue that outlives its server is a queue writing to a project nobody is
      // watching. `once` rather than `on`: closing twice must not double-abort.
      server.httpServer?.once('close', () => middleware?.close());
    },

    /**
     * The other half of the close path (AC-11.6).
     *
     * In middleware mode `server.httpServer` is null and the hook above is registered on
     * nothing, so the queue and the lifetime controller outlive the server. `buildEnd` is
     * what vite's plugin container calls from `server.close()` in either mode, and
     * `close()` is idempotent, so registering both is a belt and not a second abort.
     */
    buildEnd() {
      middleware?.close();
    },

    resolveId(id) {
      if (id === VIRTUAL_ENTRY_ID) return RESOLVED_ENTRY_ID;
      /**
       * The specifier stays bare in the emitted module — see `constants.ts` for why an
       * `/@fs/` id written into source is the wrong shape — and is turned into a path
       * here, where a path is just a resolver's answer and vite spells the URL itself.
       *
       * Without this the import is resolved through the *project's* `node_modules`, which
       * in someone else's repository has never heard of `@sve`; and the importer is a
       * virtual module, so there is not even a directory to resolve it relative to.
       */
      if (id === CLIENT_ENTRY_SPECIFIER) return CLIENT_ENTRY_PATH;
      return undefined;
    },

    load(id) {
      if (id !== RESOLVED_ENTRY_ID) return undefined;
      // Two lines, and neither of them is the overlay: the virtual module exists only to
      // give the injected script tag something to import, so that the real entry stays a
      // normal module the dev server transforms, watches and can hot-replace.
      return [
        `import { boot } from ${JSON.stringify(CLIENT_ENTRY_SPECIFIER)};`,
        `boot(${JSON.stringify(clientConfig())});`,
        '',
      ].join('\n');
    },

    transformIndexHtml() {
      return [
        {
          tag: 'script',
          attrs: { type: 'module', src: `/@id/${VIRTUAL_ENTRY_ID}` },
          // At the end of the body: the overlay appends its host to `document.body`, and
          // a module script in `<head>` would run before there is one.
          injectTo: 'body' as const,
        },
      ];
    },
  };
}

/**
 * The editor, as one entry in a `plugins` array.
 *
 * Returns an array because the stamping pass and the server integration are genuinely two
 * plugins with different hooks and different `enforce` needs — and because Vite flattens
 * nested plugin arrays, an app registers both by writing `sve()` once.
 */
export function sve(options: SveOptions = {}): Plugin[] {
  if (options.enabled === false) return [];
  return [
    sourceLoc({
      ...(options.root === undefined ? {} : { root: options.root }),
      ...(options.onStamp === undefined ? {} : { onStamp: options.onStamp }),
    }),
    editorPlugin(options),
  ];
}
