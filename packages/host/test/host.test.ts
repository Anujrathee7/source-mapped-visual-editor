/**
 * AC-11.1, 11.2, 11.3, 11.6, 11.7, 11.8 — the host driving real dev servers.
 *
 * Every project here is built in a temp directory that cannot resolve `@sve/*` (see
 * `support.ts`), and every assertion is made over HTTP with no browser: AC-11.8 asks for a
 * host the suite can drive directly, and a criterion that needs Playwright to observe it
 * is a criterion the studio in M14 would be a prerequisite for.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { AgentRunner } from '@sve/bridge';
import { createHost, type Host, type HostSession } from '../src/index.js';
import {
  assertUnrelated,
  cleanupTempDirs,
  diffTrees,
  hashTree,
  makeProject,
  tempDir,
} from './support.js';

const SERVER_TIMEOUT = 60_000;

/** A runner that never runs. These suites are about serving, not about editing. */
const idleAgent = (name = 'host-test'): AgentRunner => ({
  name,
  requiresNetwork: false,
  run: async () => ({ kind: 'noop' as const, message: 'idle' }),
});

const hosts: Host[] = [];

function newHost(overrides: Partial<Parameters<typeof createHost>[0]> = {}): Host {
  const host = createHost({
    workspaceDir: tempDir('sve-host-ws-'),
    createAgent: () => idleAgent(),
    ...overrides,
  });
  hosts.push(host);
  return host;
}

async function connect(host: Host, folder: string): Promise<HostSession> {
  const result = await host.connect({ folder });
  if (!result.ok) throw new Error(`connect refused: ${result.message}`);
  return result.session;
}

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.closeAll();
}, 60_000);

afterAll(cleanupTempDirs);

async function get(session: HostSession, url: string): Promise<{ status: number; body: string }> {
  // `connection: close` so the suite's own client does not pool a socket per session and
  // then have those sockets counted as the host's leak.
  const response = await fetch(new URL(url, session.url), { headers: { connection: 'close' } });
  return { status: response.status, body: await response.text() };
}

/* == AC-11.1 — connecting writes nothing ================================== */

describe('AC-11.1 — connecting a folder writes nothing to it', () => {
  it(
    'leaves the working tree byte-for-byte unchanged across open, serve and close',
    async () => {
      const root = makeProject();
      assertUnrelated(root);
      const before = hashTree(root);

      const host = newHost();
      const session = await connect(host, root);
      expect((await get(session, '/')).status).toBe(200);
      expect((await get(session, '/src/App.jsx')).status).toBe(200);
      await session.close();

      expect(diffTrees(before, hashTree(root))).toEqual({ added: [], removed: [], changed: [] });
    },
    SERVER_TIMEOUT,
  );

  it(
    'keeps its dependency cache out of the project',
    async () => {
      // vite's default `cacheDir` is `<root>/node_modules/.vite`, and its default config
      // loader writes a bundled copy of the config into `<root>/node_modules/.vite-temp`.
      // Both are writes into someone else's repository.
      const root = makeProject();
      const host = newHost();
      const session = await connect(host, root);
      await get(session, '/');

      expect(hashTree(path.join(root, 'node_modules')).size).toBeGreaterThan(0);
      const cached = [...hashTree(root).keys()].filter((file) => file.includes('/.vite'));
      expect(cached).toEqual([]);
      expect(session.status().cacheDir.startsWith(path.resolve(root))).toBe(false);
    },
    SERVER_TIMEOUT,
  );
});

/* == AC-11.2 / AC-11.3 — merged in, from outside ========================== */

describe('AC-11.2 — the editor is merged into the project config, not written into it', () => {
  it(
    "runs the project's own plugins and stamps its elements",
    async () => {
      const root = makeProject();
      const host = newHost();
      const session = await connect(host, root);

      const page = await get(session, '/');
      expect(page.body).toContain('name="fixture-plugin"');
      expect(page.body).toContain('/@id/virtual:sve-overlay');

      const module = await get(session, '/src/App.jsx');
      expect(module.status).toBe(200);
      expect(module.body).toContain('data-sve-loc');
      expect(module.body).toContain('src/App.jsx');
    },
    SERVER_TIMEOUT,
  );

  it(
    'never edits the config it merged with',
    async () => {
      const root = makeProject();
      const before = hashTree(root).get('vite.config.js');
      const host = newHost();
      await connect(host, root);
      expect(hashTree(root).get('vite.config.js')).toBe(before);
    },
    SERVER_TIMEOUT,
  );
});

describe('AC-11.3 — a project outside this monorepo', () => {
  it(
    'serves the overlay entry, and everything it imports, from our own package',
    async () => {
      const root = makeProject();
      assertUnrelated(root);

      const host = newHost();
      const session = await connect(host, root);

      // 1. The page asks for the virtual module.
      const page = await get(session, '/');
      expect(page.body).toContain('/@id/virtual:sve-overlay');

      // 2. Which is served, and imports the client entry as a bare specifier resolved for
      //    it — the project's own `node_modules` has never heard of `@sve`.
      const virtual = await get(session, '/@id/virtual:sve-overlay');
      expect(virtual.status).toBe(200);
      expect(virtual.body).toMatch(/boot\(/);

      // 3. Follow every import, transitively, and require each to be served. This is the
      //    criterion: `@sve/overlay` and `@sve/protocol` are reached from `@sve/vite`,
      //    and all three live outside the vite root.
      const reached = await crawlModules(session, '/@id/virtual:sve-overlay', 400);
      const bad = [...reached].filter(([, status]) => status !== 200);
      expect(bad).toEqual([]);
      expect([...reached.keys()].some((url) => url.includes('overlay'))).toBe(true);
      expect([...reached.keys()].some((url) => url.includes('protocol'))).toBe(true);
    },
    SERVER_TIMEOUT,
  );
});

/** Fetches a module and everything it imports, breadth first, and records each status. */
async function crawlModules(
  session: HostSession,
  entry: string,
  limit: number,
): Promise<Map<string, number>> {
  const seen = new Map<string, number>();
  const queue = [entry];

  while (queue.length > 0 && seen.size < limit) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    const response = await get(session, url);
    seen.set(url, response.status);
    if (response.status !== 200) continue;

    for (const match of response.body.matchAll(/(?:from|import)\s*["']([^"']+)["']/g)) {
      const next = match[1];
      if (next === undefined || !next.startsWith('/')) continue;
      if (next.startsWith('/@vite/') || next.startsWith('/@react-refresh')) continue;
      if (!seen.has(next)) queue.push(next);
    }
  }
  return seen;
}

/* == AC-11.4 — silence is impossible ====================================== */

describe('AC-11.4 — a project where nothing was stamped is an error', () => {
  it(
    'reports the stamping it did, so a working project says so',
    async () => {
      const host = newHost();
      const session = await connect(host, makeProject());
      const status = session.status();

      expect(status.stamping.probed).toBe(true);
      expect(status.stamping.elementsStamped).toBeGreaterThan(0);
      expect(status.diagnostics).toEqual([]);
    },
    SERVER_TIMEOUT,
  );

  it(
    'stamps JSX kept in .js, because a project need not have adopted .jsx',
    async () => {
      const root = makeProject({
        files: [
          { path: 'src/main.jsx', content: "import './Legacy.js';\n" },
          {
            path: 'src/Legacy.js',
            content: 'export const Legacy = () => <article>old</article>;\n',
          },
        ],
      });
      const host = newHost();
      const session = await connect(host, root);

      // Asserted on the stamping report rather than on the served body: *compiling* JSX
      // in a `.js` file is the project's own business (`@vitejs/plugin-react` includes
      // `.js` by default; this deliberately bare fixture has no react plugin at all).
      // What AC-11.4 asks of us is that the origin pass covers the file, and it does.
      const stamping = session.status().stamping;
      expect(stamping.files).toContain('src/Legacy.js');
      expect(stamping.elementsStamped).toBeGreaterThan(0);
    },
    SERVER_TIMEOUT,
  );

  it(
    'surfaces an error when a connected project stamped nothing at all',
    async () => {
      // The failure mode most likely to be mistaken for a broken product: the editor
      // mounts, the page renders, and clicking selects nothing because no element in the
      // project ever carried an origin.
      const root = makeProject({
        files: [
          { path: 'src/main.jsx', content: "import { text } from './copy.js';\nexport { text };\n" },
          { path: 'src/copy.js', content: 'export const text = "no markup here";\n' },
          { path: 'src/App.jsx', content: 'export const App = () => null;\n' },
        ],
      });
      const host = newHost();
      const session = await connect(host, root);
      const status = session.status();

      expect(status.stamping.elementsStamped).toBe(0);
      expect(status.diagnostics.map((d) => d.code)).toContain('no-elements-stamped');
      const diagnostic = status.diagnostics.find((d) => d.code === 'no-elements-stamped')!;
      expect(diagnostic.level).toBe('error');
      expect(diagnostic.message).toContain(path.resolve(root));
    },
    SERVER_TIMEOUT,
  );
});

/* == AC-11.6 — a session releases everything it took ====================== */

describe('AC-11.6 — a session releases everything it took', () => {
  it(
    'stops the server, closes the bridge and frees the port',
    async () => {
      const host = newHost();
      const session = await connect(host, makeProject());
      const url = session.url;
      expect((await get(session, '/')).status).toBe(200);

      await session.close();
      expect(session.status().state).toBe('closed');
      await expect(fetch(url)).rejects.toThrow();
    },
    SERVER_TIMEOUT,
  );

  it(
    'leaves no listeners or handles behind over many open/close cycles',
    async () => {
      const root = makeProject();
      const host = newHost();

      // One warm-up cycle: the first server in a process installs process-level listeners
      // and a dep-optimizer cache that are paid for once, not per session.
      await (await connect(host, root)).close();

      const before = { listeners: countProcessListeners(), handles: censusHandles() };

      for (let i = 0; i < 4; i += 1) {
        const session = await connect(host, root);
        expect((await get(session, '/')).status).toBe(200);
        await session.close();
      }

      expect(host.sessions()).toEqual([]);
      expect(countProcessListeners()).toBeLessThanOrEqual(before.listeners);
      expect(await settledGrowth(before.handles)).toEqual([]);
    },
    SERVER_TIMEOUT * 3,
  );

  it(
    'closing twice is not an error',
    async () => {
      const host = newHost();
      const session = await connect(host, makeProject());
      await session.close();
      await expect(session.close()).resolves.toBeUndefined();
    },
    SERVER_TIMEOUT,
  );
});

/** Active handles by libuv type, so a leak names itself instead of being a number. */
function censusHandles(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const kind of process.getActiveResourcesInfo()) counts[kind] = (counts[kind] ?? 0) + 1;
  return counts;
}

function grewBy(before: Record<string, number>, after: Record<string, number>): string[] {
  return Object.entries(after)
    .filter(([kind, count]) => count > (before[kind] ?? 0))
    .map(([kind, count]) => `${kind}: ${before[kind] ?? 0} -> ${count}`)
    .sort();
}

/**
 * The same census, once libuv has caught up.
 *
 * `server.close()` resolving is not the same instant as the handles it owned being
 * released — chokidar's watchers in particular are reported as active for a turn or two
 * afterwards, and on a loaded machine for rather longer. Polling for a bounded while is
 * what makes this measure the leak rather than the scheduler.
 */
async function settledGrowth(before: Record<string, number>): Promise<string[]> {
  let growth = grewBy(before, censusHandles());
  for (let attempt = 0; attempt < 40 && growth.length > 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    growth = grewBy(before, censusHandles());
  }
  return growth;
}

function countProcessListeners(): number {
  return (['exit', 'SIGINT', 'SIGTERM', 'SIGHUP', 'uncaughtException'] as const).reduce(
    (total, event) => total + process.listenerCount(event),
    0,
  );
}

/* == AC-11.7 — two projects at once ======================================= */

describe('AC-11.7 — two projects open at once do not touch each other', () => {
  it(
    'gives each session its own port, bridge, editRoots and agent',
    async () => {
      const host = newHost({
        createAgent: ({ root }) => idleAgent(`agent-for-${path.basename(root)}`),
      });
      const first = await connect(host, makeProject());
      const second = await connect(host, makeProject({ sourceDir: 'app' }));

      expect(first.status().port).not.toBe(second.status().port);
      expect(first.status().root).not.toBe(second.status().root);
      expect(first.status().agent).not.toBe(second.status().agent);
      expect(path.basename(first.status().editRoots[0]!)).toBe('src');
      expect(path.basename(second.status().editRoots[0]!)).toBe('app');

      // Each server serves its own project and knows nothing of the other's. Asserted on
      // the stamp rather than on a status code, because vite answers an unknown path with
      // the SPA fallback — a 200 carrying index.html, which is not a module at all.
      expect((await get(first, '/src/App.jsx')).body).toContain('src/App.jsx');
      expect((await get(second, '/app/App.jsx')).body).toContain('app/App.jsx');
      expect((await get(second, '/src/App.jsx')).body).not.toContain('data-sve-loc');
      expect(first.status().stamping.files).toEqual(['src/App.jsx']);
      expect(second.status().stamping.files).toEqual(['app/App.jsx']);
    },
    SERVER_TIMEOUT * 2,
  );

  it(
    'an edit applied through one session never reaches the other',
    async () => {
      // Each session has its own bridge, its own serial queue and its own snapshot store,
      // and this is what that means in practice: the same request posted to one server
      // writes to one project and leaves the other untouched.
      const renamer = (name: string): AgentRunner => ({
        name,
        requiresNetwork: false,
        async run(ctx) {
          const source = (await ctx.fs.readFile(ctx.file)).toString('utf8');
          await ctx.fs.writeFile(ctx.file, Buffer.from(source.replace('Fixture', name), 'utf8'));
          return { kind: 'edited', files: [ctx.file] };
        },
      });

      const host = newHost({ createAgent: ({ sessionId }) => renamer(`renamed-by-${sessionId}`) });
      const first = await connect(host, makeProject());
      const second = await connect(host, makeProject());

      const response = await fetch(new URL('/__sve/apply', first.url), {
        method: 'POST',
        headers: { 'content-type': 'application/json', connection: 'close' },
        body: JSON.stringify({
          intents: [
            {
              eid: 'src/App.jsx#h1:0',
              eidIndex: 0,
              loc: 'src/App.jsx:3:7',
              tag: 'h1',
              kind: 'text',
              before: { text: 'Fixture', classes: ['title'], computed: {} },
              after: { text: 'Renamed', classes: ['title'], computed: {} },
              instruction: 'rename the heading',
            },
          ],
        }),
      });
      expect(response.status).toBe(200);
      await response.json();

      expect(readFileSync(path.join(first.root, 'src', 'App.jsx'), 'utf8')).toContain(
        `renamed-by-${first.id}`,
      );
      expect(readFileSync(path.join(second.root, 'src', 'App.jsx'), 'utf8')).toContain('Fixture');
    },
    SERVER_TIMEOUT * 2,
  );

  it(
    'closing one leaves the other serving',
    async () => {
      const host = newHost();
      const first = await connect(host, makeProject());
      const second = await connect(host, makeProject());

      await first.close();
      expect(host.sessions().map((s) => s.id)).toEqual([second.id]);
      expect((await get(second, '/')).status).toBe(200);
    },
    SERVER_TIMEOUT * 2,
  );
});

/* == AC-11.8 — drivable without a browser ================================= */

describe('AC-11.8 — the host is drivable without a browser', () => {
  it(
    'reports a refusal as an answer rather than an exception',
    async () => {
      const host = newHost();
      const result = await host.connect({ folder: makeProject({ viteConfig: null }) });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('no-vite-config');
      expect(result.message).toContain('vite.config.ts');
      expect(host.sessions()).toEqual([]);
    },
    SERVER_TIMEOUT,
  );

  it(
    'answers status for one session and for all of them',
    async () => {
      const host = newHost();
      const session = await connect(host, makeProject());
      const status = host.status(session.id);

      expect(status).not.toBeNull();
      expect(status!.state).toBe('serving');
      expect(status!.url).toBe(session.url);
      expect(status!.source.kind).toBe('folder');
      expect(host.sessions()).toHaveLength(1);
      expect(host.status('nope')).toBeNull();
    },
    SERVER_TIMEOUT,
  );

  it(
    'runs the agent the caller constructed, not the one SVE_AGENT names',
    async () => {
      const previous = process.env['SVE_AGENT'];
      process.env['SVE_AGENT'] = 'claude';
      try {
        const host = newHost({ createAgent: () => idleAgent('caller-constructed') });
        const session = await connect(host, makeProject());
        expect(session.status().agent).toBe('caller-constructed');
      } finally {
        if (previous === undefined) delete process.env['SVE_AGENT'];
        else process.env['SVE_AGENT'] = previous;
      }
    },
    SERVER_TIMEOUT,
  );
});
