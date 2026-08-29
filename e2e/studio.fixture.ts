/**
 * The project AC-15.6 connects, and the studio that connects it.
 *
 * A *second* throwaway copy of `apps/demo`, separate from `e2e/fixture.ts`'s. The two
 * suites both write real files, and the servers are started by different things — Playwright
 * starts the verification fixture's, `@sve/host` starts this one from inside the studio — so
 * one shared tree would mean each suite restoring the other's files out from under it.
 *
 * The copy's own `vite.config.ts` is rewritten to name the studio's origin. That is the
 * whole of AC-15.3: the origin allowed to drive a project is written down in that project's
 * configuration, never inferred from who happens to be framing it. It also puts this suite
 * on the double-registration path AC-14 is about — the project registers `sve()` and the
 * host injects another — which is the shape any real connected project has.
 */
import path from 'node:path';
import { rmSync, writeFileSync } from 'node:fs';
import { REPO_ROOT, copyDemoTo } from './fixture.js';

/** Clear of 5173 (the demo), 5174 (the verification fixture) and 5310+ (the host's). */
export const STUDIO_PORT = 5400;
export const STUDIO_URL = `http://localhost:${STUDIO_PORT}`;

/** The project the studio is asked to open. */
export const STUDIO_FIXTURE_ROOT = path.join(REPO_ROOT, '.sve-e2e', 'studio-demo');

/**
 * Where the host puts clones and every dependency cache (AC-11.1).
 *
 * Named rather than left to `mkdtemp`, so a run that leaves something behind leaves it
 * somewhere a person can look at instead of in the system temp directory.
 */
export const STUDIO_WORKSPACE = path.join(REPO_ROOT, '.sve-e2e', 'studio-workspace');

/** Where the hero heading is stamped, and the line the text it renders actually lives on. */
export const HERO = 'src/components/Hero.tsx';
export const HERO_H1_LOC = `${HERO}:17:11`;
export const HERO_H1_TEXT_LINE = 21;

/**
 * The fixture's Vite config.
 *
 * Deliberately not `apps/demo/vite.config.ts` with a line added: the demo's config is the
 * app's, and the app has no studio. `server.port` is left out because the host assigns one.
 */
const CONFIG = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { sve } from '@sve/vite';

// AC-15.3: the studio allowed to drive this project is named here, in the project's own
// configuration, and nowhere else. Framed by anything on another origin, the page keeps
// its own chrome and answers nobody.
export default defineConfig({
  plugins: [sve({ studioOrigin: ${JSON.stringify(STUDIO_URL)} }), react(), tailwindcss()],
});
`;

export function prepareStudioFixture(): void {
  copyDemoTo(STUDIO_FIXTURE_ROOT);
  writeFileSync(path.join(STUDIO_FIXTURE_ROOT, 'vite.config.ts'), CONFIG, 'utf8');

  // The host writes one dependency cache per session, and a suite that never cleared them
  // would grow a directory nobody looks at. Swallowed rather than asserted: a previous
  // run's server may still hold a handle on Windows, and a stale cache is a slow start,
  // not a wrong answer.
  try {
    rmSync(STUDIO_WORKSPACE, { recursive: true, force: true });
  } catch {
    /* it will be reused, which is only a cost */
  }
}
