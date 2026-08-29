/**
 * The project the screenshot run opens, and the studio that opens it.
 *
 * A copy of `apps/demo` of its own, on a port of its own, deliberately not AC-15.6's. The
 * two runs both write real files into the tree they are pointed at, and the studio suite's
 * fixture project names *its* studio's origin in its own `vite.config.ts` (AC-15.3) — so
 * sharing either the tree or the port would mean a documentation refresh could only run
 * when the suite was not, and would restore the suite's files out from under it if it did.
 *
 * Same shape as `e2e/studio.fixture.ts` and same reasoning; only the numbers differ.
 */
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { REPO_ROOT, copyDemoTo } from '../../../e2e/fixture.js';

/** Clear of 5173/5174 (the demo and the verification fixture), 5300 and 5400 (studios). */
export const SHOTS_PORT = 5410;
export const SHOTS_URL = `http://localhost:${SHOTS_PORT}`;

export const SHOTS_FIXTURE_ROOT = path.join(REPO_ROOT, '.sve-e2e', 'studio-shots');

/** Clones and dependency caches, outside every project (AC-11.1) and named, not temporary. */
export const SHOTS_WORKSPACE = path.join(REPO_ROOT, '.sve-e2e', 'studio-shots-workspace');

const CONFIG = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { sve } from '@sve/vite';

// AC-15.3: the studio allowed to drive this project is named here and nowhere else.
export default defineConfig({
  plugins: [sve({ studioOrigin: ${JSON.stringify(SHOTS_URL)} }), react(), tailwindcss()],
});
`;

export function prepareShotsFixture(): void {
  copyDemoTo(SHOTS_FIXTURE_ROOT);
  writeFileSync(path.join(SHOTS_FIXTURE_ROOT, 'vite.config.ts'), CONFIG, 'utf8');
}
