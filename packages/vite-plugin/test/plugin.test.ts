import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
