/**
 * The projects AC-13 connects, and the studio that connects them.
 *
 * A *third* throwaway copy of `apps/demo`, and a second studio to open it with. The reason
 * is the one `e2e/studio.fixture.ts` already gives for being separate from
 * `e2e/fixture.ts`: these suites write real files, and Playwright runs projects in
 * parallel, so two suites sharing one tree would each restore the other's files out from
 * under it. AC-13 additionally writes more, and in a different order, than AC-15.6 does.
 *
 * Two further fixtures exist here that are not copies of anything: the two projects AC-13.7
 * asks to be *refused*. Both are the smallest thing that produces the refusal — a folder
 * with no Vite config, and a Vite + React project that renders no host element at all — so
 * that what is being asserted is the host's own reason and not some incidental breakage.
 */
import path from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { REPO_ROOT, copyDemoTo, snapshotFixture, type FixtureSnapshot } from './fixture.js';

/** Clear of 5173/5176 (the demo), 5174 (the verification fixture) and 5400 (AC-15.6's). */
export const V2_STUDIO_PORT = 5401;
export const V2_STUDIO_URL = `http://localhost:${V2_STUDIO_PORT}`;

/** The project the studio is asked to open, and where its caches go (AC-11.1). */
export const V2_FIXTURE_ROOT = path.join(REPO_ROOT, '.sve-e2e', 'v2-demo');
export const V2_WORKSPACE = path.join(REPO_ROOT, '.sve-e2e', 'v2-workspace');

/** AC-13.7's two refusals. */
export const NO_VITE_ROOT = path.join(REPO_ROOT, '.sve-e2e', 'v2-no-vite');
export const UNSTAMPED_ROOT = path.join(REPO_ROOT, '.sve-e2e', 'v2-unstamped');

/* ── the three elements this suite edits ──────────────────────────────────── */

export const HERO = 'src/components/Hero.tsx';

/**
 * Each is a stamp, and the line the text it renders actually lives on — which is not the
 * same line for a multi-line element. The `<h1>` opens on 17 and its text sits on 21.
 */
export const HERO_H1_LOC = `${HERO}:17:11`;
export const HERO_H1_TEXT_LINE = 21;

/** `<span className="label block text-slate">Next safe window</span>`. */
export const HERO_SPAN_LOC = `${HERO}:30:13`;
export const HERO_SPAN_TEXT_LINE = 30;

/** `<p className="label text-slate">At the harbour gauge</p>`. */
export const HERO_GAUGE_LOC = `${HERO}:41:11`;
export const HERO_GAUGE_TEXT_LINE = 41;

/* ── the project under edit ───────────────────────────────────────────────── */

/**
 * The fixture's Vite config, naming *this* studio's origin (AC-15.3).
 *
 * Written here rather than copied from `apps/demo/vite.config.ts` for the reason
 * `studio.fixture.ts` gives: the demo's config is the app's, and the app has no studio.
 * `server.port` is left out because the host assigns one.
 */
const CONFIG = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { sve } from '@sve/vite';

export default defineConfig({
  plugins: [sve({ studioOrigin: ${JSON.stringify(V2_STUDIO_URL)} }), react(), tailwindcss()],
});
`;

/* ── the two projects that must be refused ────────────────────────────────── */

/**
 * A React project with no Vite config.
 *
 * It has a `package.json` naming React, so detection gets past its first two gates and
 * fails on the one AC-13.7 is about. A folder with nothing in it would be refused too, for
 * a reason that says nothing about Vite.
 */
function writeNoViteProject(): void {
  mkdirSync(NO_VITE_ROOT, { recursive: true });
  mkdirSync(path.join(NO_VITE_ROOT, 'src'), { recursive: true });
  writeFileSync(
    path.join(NO_VITE_ROOT, 'package.json'),
    `${JSON.stringify(
      {
        name: 'sve-e2e-no-vite',
        private: true,
        type: 'module',
        dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

/**
 * A Vite + React project that stamps nothing.
 *
 * Every gate the host checks before it starts a server passes: there is a `package.json`
 * naming React, a Vite config, and a `src/` to write into. What there is not is a single
 * JSX *host* element — `<App />` is a component, and the stamping pass has nothing to put
 * a coordinate on. That is exactly the project AC-12.2 calls the failure most easily
 * mistaken for a broken product: it loads, it renders, and it selects nothing when clicked.
 *
 * The host's probe fetches the page and follows its imports, so `main.tsx` has to be
 * genuinely reachable from `index.html` for `modulesFetched` to be non-zero — otherwise the
 * diagnostic would be `page-not-served`, which is a warning and a different criterion.
 */
function writeUnstampedProject(): void {
  const src = path.join(UNSTAMPED_ROOT, 'src');
  mkdirSync(src, { recursive: true });

  writeFileSync(
    path.join(UNSTAMPED_ROOT, 'package.json'),
    `${JSON.stringify(
      {
        name: 'sve-e2e-unstamped',
        private: true,
        type: 'module',
        dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
        devDependencies: { '@vitejs/plugin-react': '^5.0.0', vite: '^8.0.0' },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  writeFileSync(
    path.join(UNSTAMPED_ROOT, 'vite.config.ts'),
    `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({ plugins: [react()] });\n`,
    'utf8',
  );

  writeFileSync(
    path.join(UNSTAMPED_ROOT, 'index.html'),
    `<!doctype html>\n<html lang="en">\n  <head><meta charset="utf-8" /><title>unstamped</title></head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.tsx"></script>\n  </body>\n</html>\n`,
    'utf8',
  );

  // No host element anywhere: `<App />` is a component, and `App` itself returns a string.
  writeFileSync(
    path.join(src, 'main.tsx'),
    `import { createRoot } from 'react-dom/client';\n\nfunction App(): string {\n  return 'nothing here is a host element';\n}\n\nconst root = document.getElementById('root');\nif (root) createRoot(root).render(<App />);\n`,
    'utf8',
  );

  writeFileSync(path.join(UNSTAMPED_ROOT, '.gitignore'), '!*\n', 'utf8');
}

/**
 * Rebuilds the project under edit.
 *
 * Retried, and the reason is specific to this suite. Playwright discards a worker after a
 * failed test and runs `beforeAll` again — which AC-13.8 makes a *normal* occurrence, since
 * it fails two tests on purpose — while the connected session's dev server is still holding
 * a directory watcher on this tree, and Windows will refuse to unlink a directory somebody
 * has open. A rebuild that gave up there would leave the next worker editing the last one's
 * files, which is a stale fixture reported as a mysteriously wrong verdict.
 */
function rebuild(): void {
  for (let attempt = 3; ; attempt -= 1) {
    try {
      copyDemoTo(V2_FIXTURE_ROOT);
      return;
    } catch (error) {
      if (attempt <= 1) throw error;
      // Busy-wait rather than sleep: this runs in a worker's `beforeAll`, and the handle is
      // released by the other process, not by anything this one is waiting on.
      const until = Date.now() + 250;
      while (Date.now() < until) {
        /* give the watcher a moment to let go */
      }
    }
  }
}

export function prepareV2Fixture(): void {
  rebuild();
  writeFileSync(path.join(V2_FIXTURE_ROOT, 'vite.config.ts'), CONFIG, 'utf8');

  rmSync(NO_VITE_ROOT, { recursive: true, force: true });
  rmSync(UNSTAMPED_ROOT, { recursive: true, force: true });
  writeNoViteProject();
  writeUnstampedProject();

  // Swallowed for the reason `studio.fixture.ts` gives: a previous run's server may still
  // hold a handle on Windows, and a stale cache is a slow start, not a wrong answer.
  try {
    rmSync(V2_WORKSPACE, { recursive: true, force: true });
  } catch {
    /* it will be reused, which is only a cost */
  }
}

/* ── "byte-for-byte unchanged", as a question rather than a repair ────────── */

/**
 * Which of the project's source files differ from `before` — reading only.
 *
 * `restoreFixture` answers the same question, but it answers it by *writing*, which is the
 * wrong tool for AC-13.4: "the project is byte-for-byte unchanged at that moment" has to be
 * asserted without changing what is being asserted about. Byte-oriented for the reason
 * `snapshotFixture` is: a line-oriented comparison would quietly forgive a normalised
 * terminator.
 */
export function changedSince(before: FixtureSnapshot, root: string = V2_FIXTURE_ROOT): string[] {
  const now = snapshotFixture(root);
  const changed = new Set<string>();
  const name = (file: string): string => path.relative(root, file).replace(/\\/g, '/');

  for (const [file, bytes] of before) {
    const current = now.get(file);
    if (current === undefined || Buffer.compare(current, bytes) !== 0) changed.add(name(file));
  }
  for (const file of now.keys()) if (!before.has(file)) changed.add(name(file));
  return [...changed].sort();
}
