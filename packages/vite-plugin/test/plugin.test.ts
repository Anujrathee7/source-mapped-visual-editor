import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { Plugin } from 'vite';
import { SVE_APPLY_PATH, type ConnectHandle } from '@sve/bridge';
import { CLIENT_ENTRY_SPECIFIER, RESOLVED_ENTRY_ID, VIRTUAL_ENTRY_ID, sve } from '../src/index.js';

/* ── harness ──────────────────────────────────────────────────────────────── */

const created: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'sve-vite-'));
  created.push(root);
  mkdirSync(path.join(root, 'src'));
  writeFileSync(path.join(root, 'src', 'App.tsx'), 'export const App = () => <h1>Hi</h1>;\n');
  return root;
}

afterAll(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Just enough of a resolved config for `configResolved` to have something to read. */
function resolveConfig(plugins: Plugin[], root: string): void {
  for (const plugin of plugins) {
    const hook = plugin.configResolved;
    const run = typeof hook === 'function' ? hook : hook?.handler;
    run?.call({} as never, { root } as never);
  }
}

interface FakeServer {
  middlewares: { use(handle: ConnectHandle): unknown };
  handles: ConnectHandle[];
  httpServer: { once(event: string, cb: () => void): void };
  closers: Array<() => void>;
}

function fakeServer(): FakeServer {
  const handles: ConnectHandle[] = [];
  const closers: Array<() => void> = [];
  return {
    handles,
    closers,
    middlewares: {
      use(handle) {
        handles.push(handle);
        return undefined;
      },
    },
    httpServer: {
      once(_event, cb) {
        closers.push(cb);
      },
    },
  };
}

function configureAll(plugins: Plugin[], server: FakeServer): void {
  for (const plugin of plugins) {
    const hook = plugin.configureServer;
    const run = typeof hook === 'function' ? hook : hook?.handler;
    run?.call({} as never, server as never);
  }
}

const byName = (plugins: Plugin[], name: string): Plugin => {
  const found = plugins.find((plugin) => plugin.name === name);
  if (!found) {
    throw new Error(`no plugin named ${name} in [${plugins.map((p) => p.name).join(', ')}]`);
  }
  return found;
};

/* ── the three parts, joined ──────────────────────────────────────────────── */

describe('sve() — the dev-server integration', () => {
  it('composes origin stamping with the editor, in that order', () => {
    const plugins = sve({ root: makeRoot() });
    expect(plugins.map((plugin) => plugin.name)).toEqual(['sve:source-loc', 'sve:editor']);
  });

  it('is dev-only on both halves: a production build sees neither', () => {
    for (const plugin of sve({ root: makeRoot() })) expect(plugin.apply).toBe('serve');
  });

  it('stamps origins, because the whole loop depends on the element knowing its line', () => {
    const root = makeRoot();
    const plugins = sve({ root });
    resolveConfig(plugins, root);

    const transform = byName(plugins, 'sve:source-loc').transform;
    const hook = typeof transform === 'function' ? transform : transform?.handler;
    const out = hook?.call(
      {} as never,
      'export const A = () => <h1>Hi</h1>;',
      `${root.replace(/\\/g, '/')}/src/App.tsx`,
      undefined as never,
    );

    const code = typeof out === 'object' && out !== null && 'code' in out ? out.code : '';
    expect(code).toContain('data-sve-loc');
  });

  it('no-ops entirely when disabled, rather than mounting a bridge nobody asked for', () => {
    expect(sve({ enabled: false, root: makeRoot() })).toEqual([]);
  });

  it('mounts the bridge middleware on the dev server', async () => {
    const root = makeRoot();
    const plugins = sve({ root });
    resolveConfig(plugins, root);
    const server = fakeServer();
    configureAll(plugins, server);

    expect(server.handles).toHaveLength(1);

    // It is the bridge's middleware, not some other handler: it answers /__sve/apply and
    // passes everything else through.
    const handle = server.handles[0]!;
    let passedThrough = false;
    handle({ url: '/index.html', method: 'GET' } as never, {} as never, () => {
      passedThrough = true;
    });
    expect(passedThrough).toBe(true);

    const answered = await new Promise<number>((resolve) => {
      const res = {
        setHeader() {},
        writeHead(status: number) {
          resolve(status);
        },
        end() {},
      };
      handle({ url: SVE_APPLY_PATH, method: 'GET' } as never, res as never, () => resolve(-1));
    });
    // GET is the wrong verb for apply, and being told so proves the route is ours.
    expect(answered).toBe(405);
  });

  it('closes the bridge with the dev server, so a queue does not outlive it', () => {
    const root = makeRoot();
    const plugins = sve({ root });
    resolveConfig(plugins, root);
    const server = fakeServer();
    configureAll(plugins, server);

    expect(server.closers.length).toBeGreaterThan(0);
    expect(() => {
      for (const close of server.closers) close();
    }).not.toThrow();
  });

  it('injects the overlay entry into the page, so the app needs no wiring of its own', () => {
    const root = makeRoot();
    const plugins = sve({ root });
    resolveConfig(plugins, root);

    const hook = byName(plugins, 'sve:editor').transformIndexHtml;
    const handler = typeof hook === 'function' ? hook : hook?.handler;
    const tags = handler?.call(
      {} as never,
      '<html></html>',
      { path: '/', filename: 'index.html' } as never,
    );
    const list = Array.isArray(tags) ? tags : ((tags as { tags?: unknown[] } | undefined)?.tags ?? []);

    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      tag: 'script',
      attrs: { type: 'module', src: `/@id/${VIRTUAL_ENTRY_ID}` },
      injectTo: 'body',
    });
  });

  it('serves the injected entry from a virtual module that boots the overlay', () => {
    const root = makeRoot();
    const plugins = sve({ root, viteRoot: 'apps/demo' });
    resolveConfig(plugins, root);
    const editor = byName(plugins, 'sve:editor');

    const resolveId =
      typeof editor.resolveId === 'function' ? editor.resolveId : editor.resolveId?.handler;
    expect(resolveId?.call({} as never, VIRTUAL_ENTRY_ID, undefined, {} as never)).toBe(
      RESOLVED_ENTRY_ID,
    );
    expect(resolveId?.call({} as never, './App.tsx', undefined, {} as never)).toBeUndefined();

    const load = typeof editor.load === 'function' ? editor.load : editor.load?.handler;
    const code = load?.call({} as never, RESOLVED_ENTRY_ID, {} as never);
    const source = typeof code === 'string' ? code : '';

    // A bare specifier, not a filesystem path: the dev server resolves it the same way it
    // resolves any workspace import, which is the one thing that works on every platform.
    expect(source).toContain(CLIENT_ENTRY_SPECIFIER);
    expect(source).toMatch(/boot\(/);
    // The overlay maps a loc onto a dev-server URL, so it has to be told the vite root.
    expect(source).toContain('"viteRoot":"apps/demo"');
    expect(load?.call({} as never, '\0other', {} as never)).toBeUndefined();
  });

  it('lets the agent write inside the vite root by default, and nothing above it', () => {
    const root = makeRoot();
    const plugins = sve({ root });
    resolveConfig(plugins, root);
    const server = fakeServer();
    configureAll(plugins, server);

    const middleware = server.handles[0] as unknown as {
      bridge: { root: string; editRoots: readonly string[] };
    };
    expect(middleware.bridge.root).toBe(path.resolve(root));
    expect(middleware.bridge.editRoots).toEqual([path.resolve(root, 'src')]);
  });
});

/* == the editor as a package the project has never heard of (AC-11.3) ====== */

interface UserConfigLike {
  server?: { fs?: { allow?: string[] } };
  optimizeDeps?: { exclude?: string[] };
}

/** Runs a plugin's `config` hook the way vite does, and hands back what it asked for. */
function callConfig(plugin: Plugin, userConfig: Record<string, unknown>): UserConfigLike {
  const hook = plugin.config;
  const run = typeof hook === 'function' ? hook : hook?.handler;
  const result = run?.call({} as never, userConfig as never, { command: 'serve' } as never);
  return (result ?? {}) as UserConfigLike;
}

function callResolveId(plugin: Plugin, id: string): unknown {
  const hook = plugin.resolveId;
  const run = typeof hook === 'function' ? hook : hook?.handler;
  return run?.call({} as never, id, undefined, {} as never);
}

const SVE_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PACKAGES_ROOT = path.dirname(SVE_ROOT);

describe('sve() — serving a project that has never heard of @sve (AC-11.3)', () => {
  it('resolves the client entry to an absolute path of its own', () => {
    const editor = byName(sve({ root: makeRoot() }), 'sve:editor');
    const resolved = callResolveId(editor, CLIENT_ENTRY_SPECIFIER);

    expect(typeof resolved).toBe('string');
    expect(path.isAbsolute(resolved as string)).toBe(true);
    expect(existsSync(resolved as string)).toBe(true);
    expect(resolved).toBe(path.join(SVE_ROOT, 'src', 'client', 'entry.ts'));
  });

  it('still leaves everything else to the dev server', () => {
    const editor = byName(sve({ root: makeRoot() }), 'sve:editor');
    expect(callResolveId(editor, '@sve/overlay')).toBeUndefined();
    expect(callResolveId(editor, 'react')).toBeUndefined();
  });

  it('widens fs.allow to the packages the overlay is built from', () => {
    const root = makeRoot();
    const editor = byName(sve({ root }), 'sve:editor');
    const allow = (callConfig(editor, { root }).server?.fs?.allow ?? []).map((entry) =>
      path.resolve(entry),
    );

    for (const pkg of ['vite-plugin', 'overlay', 'protocol']) {
      expect(allow).toContain(path.join(PACKAGES_ROOT, pkg));
    }
  });

  it('keeps the default allow list rather than replacing it', () => {
    // `server.fs.allow` defaults to `[workspaceRoot]`, and vite takes the *raw* value
    // whenever one is present — so a plugin that returns only its own directories
    // silently locks the project out of serving its own source.
    const root = makeRoot();
    const editor = byName(sve({ root }), 'sve:editor');
    const allow = (callConfig(editor, { root }).server?.fs?.allow ?? []).map((entry) =>
      path.resolve(entry),
    );
    expect(allow.some((entry) => root === entry || root.startsWith(entry + path.sep))).toBe(true);
  });

  it('adds only its own directories when the project set an allow list itself', () => {
    // vite concatenates the two arrays, so repeating theirs back would duplicate it.
    const root = makeRoot();
    const editor = byName(sve({ root }), 'sve:editor');
    const theirs = path.join(root, 'shared');
    const allow = callConfig(editor, { root, server: { fs: { allow: [theirs] } } }).server?.fs
      ?.allow;
    expect(allow).not.toContain(theirs);
    expect((allow ?? []).map((entry) => path.resolve(entry))).toContain(
      path.join(PACKAGES_ROOT, 'overlay'),
    );
  });

  it('keeps the overlay and everything under it out of the dependency optimizer', () => {
    const editor = byName(sve({ root: makeRoot() }), 'sve:editor');
    const exclude = callConfig(editor, { root: makeRoot() }).optimizeDeps?.exclude ?? [];
    expect(exclude).toEqual(expect.arrayContaining(['@sve/vite', '@sve/overlay', '@sve/protocol']));
  });
});

/* == what a host needs from the plugin ==================================== */

describe('sve() — driven by a host rather than by a config file', () => {
  it('takes a constructed agent instead of reading SVE_AGENT', () => {
    const root = makeRoot();
    const agent = {
      name: 'host-supplied',
      requiresNetwork: false,
      run: async () => ({ kind: 'noop' as const }),
    };
    const plugins = sve({ root, agent });
    resolveConfig(plugins, root);
    const server = fakeServer();
    configureAll(plugins, server);

    const middleware = server.handles[0] as unknown as { bridge: { agent: { name: string } } };
    expect(middleware.bridge.agent.name).toBe('host-supplied');
  });

  it('hands the middleware to whoever mounted it, so it can be closed explicitly', () => {
    const root = makeRoot();
    const seen: Array<{ close(): void }> = [];
    const plugins = sve({ root, onMiddleware: (middleware) => seen.push(middleware) });
    resolveConfig(plugins, root);
    configureAll(plugins, fakeServer());

    expect(seen).toHaveLength(1);
    expect(typeof seen[0]!.close).toBe('function');
  });

  it('closes the bridge on server close even with no http server (AC-11.6)', async () => {
    // In middleware mode `server.httpServer` is null, so the `once('close')` the plugin
    // registers never fires and the serial queue and lifetime controller outlive the
    // server that owned them. `buildEnd` is what vite calls on close either way.
    const root = makeRoot();
    const plugins = sve({ root });
    resolveConfig(plugins, root);
    const server = { ...fakeServer(), httpServer: null };
    for (const plugin of plugins) {
      const hook = plugin.configureServer;
      const run = typeof hook === 'function' ? hook : hook?.handler;
      run?.call({} as never, server as never);
    }

    const middleware = server.handles[0] as unknown as {
      bridge: { progress: { subscribe(fn: () => void): () => void; listenerCount: number } };
    };
    middleware.bridge.progress.subscribe(() => {});
    expect(middleware.bridge.progress.listenerCount).toBe(1);

    const editor = byName(plugins, 'sve:editor');
    const hook = editor.buildEnd;
    const run = typeof hook === 'function' ? hook : hook?.handler;
    await run?.call({} as never, undefined as never);

    expect(middleware.bridge.progress.listenerCount).toBe(0);
  });
});
