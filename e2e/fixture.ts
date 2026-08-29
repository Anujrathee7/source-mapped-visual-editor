/**
 * A disposable copy of `apps/demo`, which is what the verification suite edits.
 *
 * AC-5 drives a coding agent that writes to disk, so these tests change real files. Three
 * reasons they must not be the checked-in ones:
 *
 *  - a test that fails halfway leaves the demo dirty, and a suite that corrupts the app it
 *    is testing is worse than no suite;
 *  - the demo's own smoke suite (AC-2.5) runs against the same tree at the same time, and
 *    would see half-applied edits;
 *  - AC-5.8 is "verified on a file with CRLF endings", and forcing CRLF on a checked-in
 *    source file to satisfy a test is the test dictating to the app.
 *
 * The copy lives inside the repo rather than in a temp directory so that `react`,
 * `@vitejs/plugin-react`, `@tailwindcss/vite` and every `@sve/*` package resolve by walking
 * up to the workspace's own `node_modules`, exactly as the demo does.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(here, '..');
export const DEMO_ROOT = path.join(REPO_ROOT, 'apps', 'demo');
export const FIXTURE_ROOT = path.join(REPO_ROOT, '.sve-e2e', 'demo');

/** The editor-hosting server. 5173 is the demo on its own, which AC-2.5 needs kept clean. */
export const FIXTURE_PORT = 5174;
export const FIXTURE_URL = `http://localhost:${FIXTURE_PORT}`;

/**
 * The file AC-5.8's Revert is checked against: rewritten with CRLF terminators when the
 * fixture is built, so the snapshot has line endings a careless round-trip would normalise.
 */
export const CRLF_FILE = 'src/components/Method.tsx';

const SKIP = new Set(['node_modules', 'dist', '.sve', '.vite']);

export function fixturePath(relative: string): string {
  return path.join(FIXTURE_ROOT, relative);
}

export function readFixture(relative: string): string {
  return readFileSync(fixturePath(relative), 'utf8');
}

export function readFixtureLines(relative: string): string[] {
  return readFixture(relative).split(/\r\n|\n|\r/);
}

/**
 * Builds the fixture from scratch.
 *
 * Called from `e2e/fixture.vite.config.ts` at config-load time rather than from Playwright's
 * `globalSetup`, because Playwright starts its `webServer` plugins *before* global setup
 * runs — the server would be pointed at a directory that does not exist yet.
 */
export function prepareFixture(): void {
  rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  mkdirSync(path.dirname(FIXTURE_ROOT), { recursive: true });
  cpSync(DEMO_ROOT, FIXTURE_ROOT, {
    recursive: true,
    filter: (source) => !SKIP.has(path.basename(source)),
  });

  // AC-3.2's hostile bytes, in the file AC-5.8 reverts.
  const crlf = fixturePath(CRLF_FILE);
  writeFileSync(crlf, readFileSync(crlf, 'utf8').replace(/\r?\n/g, '\r\n'), 'utf8');

  // Tailwind v4 discovers its sources by scanning, and skips anything a `.gitignore`
  // excludes — which this whole directory is. Its own ignore file, allowing everything,
  // keeps the fixture's utilities being generated.
  writeFileSync(path.join(FIXTURE_ROOT, '.gitignore'), '!*\n', 'utf8');
}

/* ── keeping it clean between tests ───────────────────────────────────────── */

export type FixtureSnapshot = Map<string, Buffer>;

function collect(dir: string, into: FixtureSnapshot): void {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, into);
    else into.set(full, readFileSync(full));
  }
}

/**
 * Every byte of the fixture's `src/`, so a test can put back exactly what it found.
 *
 * Byte-oriented on purpose: the point of the CRLF file is that a line-oriented round-trip
 * would quietly normalise it, and a restore that did so would hide the very thing AC-5.8
 * checks for.
 */
export function snapshotFixture(): FixtureSnapshot {
  const snapshot: FixtureSnapshot = new Map();
  collect(path.join(FIXTURE_ROOT, 'src'), snapshot);
  return snapshot;
}

/** Restores only what actually changed, so an untouched file's mtime does not move. */
export function restoreFixture(snapshot: FixtureSnapshot): string[] {
  const restored: string[] = [];
  for (const [file, bytes] of snapshot) {
    if (existsSync(file) && Buffer.compare(readFileSync(file), bytes) === 0) continue;
    writeFileSync(file, bytes);
    restored.push(path.relative(FIXTURE_ROOT, file).replace(/\\/g, '/'));
  }
  return restored;
}
