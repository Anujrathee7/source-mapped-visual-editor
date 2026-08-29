/**
 * A real project on disk, for the assertions that have to be made on files.
 *
 * AC-12.1's last sentence is "a test asserts that a chat turn alone, with no Apply, leaves
 * the project byte-for-byte unchanged". Asserted on the UI that would pass while a write
 * happened underneath it, so it is asserted here instead: every byte of the tree, before
 * and after, compared as bytes.
 */
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FILE, SOURCE } from './fixture.js';

export interface Project {
  root: string;
  editRoots: string[];
  /** The file the fixture's stamps point into, absolute. */
  file: string;
  read(): string;
  snapshot(): Map<string, Buffer>;
  /** Paths that differ from the snapshot, project-relative, sorted. */
  changedSince(snapshot: Map<string, Buffer>): string[];
  remove(): void;
}

function collect(dir: string, into: Map<string, Buffer>): void {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, into);
    else into.set(full, readFileSync(full));
  }
}

export function createProject(): Project {
  const root = mkdtempSync(path.join(tmpdir(), 'sve-studio-'));
  const file = path.join(root, FILE);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${SOURCE}\n`, 'utf8');
  writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({ name: 'subject', private: true, dependencies: { react: '^19.0.0' } }, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(path.join(root, 'vite.config.ts'), 'export default {};\n', 'utf8');

  return {
    root,
    file,
    editRoots: [path.join(root, 'src')],
    read: () => readFileSync(file, 'utf8'),
    snapshot() {
      const snapshot = new Map<string, Buffer>();
      collect(root, snapshot);
      return snapshot;
    },
    changedSince(snapshot) {
      const now = new Map<string, Buffer>();
      collect(root, now);
      const changed = new Set<string>();
      for (const [absolute, bytes] of now) {
        const before = snapshot.get(absolute);
        if (before === undefined || Buffer.compare(before, bytes) !== 0) changed.add(absolute);
      }
      for (const absolute of snapshot.keys()) if (!now.has(absolute)) changed.add(absolute);
      return [...changed].map((p) => path.relative(root, p).replace(/\\/g, '/')).sort();
    },
    remove: () => rmSync(root, { recursive: true, force: true }),
  };
}
