/**
 * Throwaway projects that have never heard of `@sve`.
 *
 * AC-11.3 turns on where the fixture lives. A project inside this workspace resolves
 * `@sve/overlay` by walking up to the repository's own `node_modules` — by accident, and
 * without the plugin doing anything at all — so a fixture under `apps/` would pass the
 * criterion while the case it describes stayed broken. Everything here is built in the
 * system temp directory, and {@link assertUnrelated} is the standing proof that it is
 * genuinely unrelated rather than merely elsewhere.
 *
 * The React in it is a stub. These suites drive no browser: what they need is for
 * `react/jsx-dev-runtime` to *resolve*, so the served module is a 200 whose body can be
 * read for stamps, and a real React would only make that slower.
 */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const temporary: string[] = [];

/** Every directory these suites created, for an `afterAll` to remove. */
export function cleanupTempDirs(): void {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export function tempDir(prefix = 'sve-host-'): string {
  // `realpathSync` because macOS hands back `/var/...` for a `/private/var/...` directory,
  // and the path guard compares real paths on both sides.
  const dir = mkdtempSync(path.join(realpathSync(tmpdir()), prefix));
  temporary.push(dir);
  return dir;
}

export interface ProjectFile {
  path: string;
  content: string;
}

export interface ProjectShape {
  /** Where source lives. `src` unless a fixture is testing detection of something else. */
  sourceDir?: string;
  /** Written verbatim. Omit for the default, which imports nothing. */
  viteConfig?: string | null;
  /** Omit `react` here to build a project the host must refuse. */
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  /** Relative to the project root, so a fixture can add JSX in `.js`. */
  files?: readonly ProjectFile[];
  /** Skips the stub React, for detection fixtures that never start a server. */
  withReact?: boolean;
}

/**
 * A vite config that imports nothing.
 *
 * It has to: the fixture has no `vite` in its own `node_modules`, and `defineConfig` is a
 * convenience rather than a requirement. The marker plugin is what AC-11.2 reads to check
 * that a project's own plugins still run once ours are merged in.
 */
export const DEFAULT_VITE_CONFIG = `export default {
  plugins: [
    {
      name: 'fixture:marker',
      transformIndexHtml(html) {
        return html.replace('<head>', '<head><meta name="fixture-plugin" content="ran">');
      },
    },
  ],
};
`;

const DEFAULT_HTML = `<!doctype html>
<html>
  <head><title>fixture</title></head>
  <body>
    <div id="root"></div>
    <script type="module" src="/SOURCE/main.jsx"></script>
  </body>
</html>
`;

const DEFAULT_APP = `export function App() {
  return (
    <section className="wrap">
      <h1 className="title">Fixture</h1>
      <p>hello</p>
    </section>
  );
}
`;

const DEFAULT_MAIN = `import { App } from './App.jsx';

export { App };
`;

function writeStubReact(root: string): void {
  const dir = path.join(root, 'node_modules', 'react');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'react',
        version: '19.0.0',
        type: 'module',
        main: './index.js',
        exports: {
          '.': './index.js',
          './jsx-runtime': './jsx-runtime.js',
          './jsx-dev-runtime': './jsx-dev-runtime.js',
        },
      },
      null,
      2,
    ),
    'utf8',
  );
  writeFileSync(
    path.join(dir, 'index.js'),
    'export function createElement() { return null; }\nexport const Fragment = Symbol.for("react.fragment");\nexport default { createElement, Fragment };\n',
    'utf8',
  );
  const runtime =
    'export const Fragment = Symbol.for("react.fragment");\nexport function jsx() { return null; }\nexport function jsxs() { return null; }\nexport function jsxDEV() { return null; }\n';
  writeFileSync(path.join(dir, 'jsx-runtime.js'), runtime, 'utf8');
  writeFileSync(path.join(dir, 'jsx-dev-runtime.js'), runtime, 'utf8');
}

/** Builds a project in a temp directory and hands back its root. */
export function makeProject(shape: ProjectShape = {}): string {
  const root = tempDir();
  const source = shape.sourceDir ?? 'src';

  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-app',
        private: true,
        version: '0.0.0',
        type: 'module',
        dependencies: shape.dependencies ?? { react: '^19.0.0', 'react-dom': '^19.0.0' },
        devDependencies: shape.devDependencies ?? { vite: '^8.0.0' },
      },
      null,
      2,
    ),
    'utf8',
  );

  const config = shape.viteConfig === undefined ? DEFAULT_VITE_CONFIG : shape.viteConfig;
  if (config !== null) writeFileSync(path.join(root, 'vite.config.js'), config, 'utf8');

  writeFileSync(path.join(root, 'index.html'), DEFAULT_HTML.replaceAll('SOURCE', source), 'utf8');

  mkdirSync(path.join(root, source), { recursive: true });
  writeFileSync(path.join(root, source, 'main.jsx'), DEFAULT_MAIN, 'utf8');
  writeFileSync(path.join(root, source, 'App.jsx'), DEFAULT_APP, 'utf8');

  for (const file of shape.files ?? []) {
    const full = path.join(root, file.path);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, file.content, 'utf8');
  }

  if (shape.withReact !== false) writeStubReact(root);
  return root;
}

/**
 * Fails loudly if the fixture can reach `@sve/*` on its own.
 *
 * This is the whole of AC-11.3. If node resolution finds the overlay by walking up from
 * the project, the criterion is not being tested — the plugin could do nothing at all and
 * every assertion below would still pass.
 */
export function assertUnrelated(root: string): void {
  const require = createRequire(path.join(root, 'probe.cjs'));
  for (const specifier of ['@sve/vite', '@sve/overlay', '@sve/protocol']) {
    let resolved: string | null = null;
    try {
      resolved = require.resolve(specifier);
    } catch {
      resolved = null;
    }
    if (resolved !== null) {
      throw new Error(
        `fixture at ${root} resolves ${specifier} to ${resolved}; AC-11.3 requires a project ` +
          `that cannot, or the criterion is not being tested`,
      );
    }
  }
}

/* == byte-for-byte, for AC-11.1 =========================================== */

/** Every file under `dir`, keyed by its relative path, valued by a digest of its bytes. */
export function hashTree(dir: string): Map<string, string> {
  const tree = new Map<string, string>();
  const walk = (current: string): void => {
    for (const entry of readdirSync(current).sort()) {
      const full = path.join(current, entry);
      // `lstat`, not `stat`: a symlink's target is somebody else's tree.
      const stats = statSync(full, { throwIfNoEntry: false });
      if (stats === undefined) continue;
      if (stats.isDirectory()) walk(full);
      else if (stats.isFile()) {
        tree.set(
          path.relative(dir, full).replace(/\\/g, '/'),
          createHash('sha256').update(readFileSync(full)).digest('hex'),
        );
      }
    }
  };
  walk(dir);
  return tree;
}

export interface TreeDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

export function diffTrees(before: Map<string, string>, after: Map<string, string>): TreeDiff {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const [file, digest] of after) {
    const previous = before.get(file);
    if (previous === undefined) added.push(file);
    else if (previous !== digest) changed.push(file);
  }
  for (const file of before.keys()) if (!after.has(file)) removed.push(file);
  return { added: added.sort(), removed: removed.sort(), changed: changed.sort() };
}
