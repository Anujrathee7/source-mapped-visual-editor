/**
 * Where this package, and the two the overlay is built from, actually live on disk.
 *
 * Node-only, and imported only by `src/plugin.ts`. It exists because of AC-11.3: once the
 * editor serves a project it does not live inside, the dev server can no longer find any
 * of our modules by walking up from the project's own `node_modules`. Nothing here asks
 * the *project* where we are — every answer is derived from this file's own location, or
 * from Node's resolver run from this file.
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

/** `<...>/packages/vite-plugin/src/client/entry.ts` — the module the page ends up running. */
export const CLIENT_ENTRY_PATH = fileURLToPath(new URL('./client/entry.ts', import.meta.url));

/**
 * Every package that ends up in the browser: this one, and everything it imports there.
 *
 * `@sve/studio` and `@sve/rpc` joined for AC-15.5. A framed page loads
 * `@sve/studio/preview`, which imports `@sve/rpc`, so both directories have to be readable
 * by the dev server and both have to stay out of the optimizer — otherwise the preview
 * works in this workspace, where `fs.allow` happens to cover the repository root, and
 * fails for exactly the foreign project AC-11.3 was about.
 *
 * `@sve/studio`'s own `.` entry reaches `@sve/host` and `@sve/bridge`; only `./preview` is
 * browser-safe, and it imports neither. Listing the directory makes its *files* servable,
 * not its Node entry reachable — and the Node entry's imports are not on this list.
 *
 * `@sve/bridge` is deliberately absent. It holds file-write capability and is reached only
 * from the Node half, so putting it on an allow list the dev server serves from would
 * offer the page a path to it.
 */
export const CLIENT_PACKAGES = [
  '@sve/vite',
  '@sve/overlay',
  '@sve/protocol',
  '@sve/rpc',
  '@sve/studio',
] as const;

/**
 * The directory holding the `package.json` that `specifier` resolves into.
 *
 * Walked up from the resolved entry rather than assumed to be two levels above it: this
 * workspace exports `./src/index.ts` directly, a published build would not, and an allow
 * list that is right for one layout and wrong for the other is an allow list that fails in
 * exactly the situation this milestone is about.
 */
function packageDirOf(specifier: string): string | null {
  let current: string;
  try {
    current = path.dirname(require.resolve(specifier));
  } catch {
    return null;
  }

  for (;;) {
    if (existsSync(path.join(current, 'package.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Every directory the dev server has to be allowed to read from to serve the overlay.
 *
 * A package directory rather than its `src/`, because each one also carries the
 * dependencies resolved from inside it — `@sve/protocol`'s own nested `zod`, in particular,
 * which the browser reaches through the wire schemas.
 */
export function clientPackageDirs(): string[] {
  const dirs = new Set<string>();
  for (const specifier of CLIENT_PACKAGES) {
    const dir = packageDirOf(specifier);
    if (dir !== null) dirs.add(dir);
  }
  // Our own directory is derivable without the resolver, and must be present even in a
  // layout where `@sve/vite` cannot resolve itself by name.
  dirs.add(path.resolve(path.dirname(CLIENT_ENTRY_PATH), '..', '..'));
  return [...dirs];
}
