/**
 * Regenerating the studio's images in `docs/images/`:
 *
 *   npx playwright test --config packages/studio/playwright.shots.config.ts
 *
 * Separate from `playwright.config.ts` for the reason the demo's `playwright.shots.config.ts`
 * is: these "tests" assert almost nothing and write into the documentation, so keeping them
 * out of the suite means a documentation refresh can never be mistaken for a passing
 * verification run, and CI never spends time on it.
 *
 * It poses nothing: what it photographs is the studio running, driven the way AC-15.6
 * drives it. The fixture tree and the port are its own rather than that suite's, because a
 * project only answers the studio origin written into its own `vite.config.ts` (AC-15.3)
 * and both runs write real files — sharing either would mean the documentation could only
 * be refreshed while the suite was not running.
 */
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { SHOTS_PORT, SHOTS_URL, SHOTS_WORKSPACE } from './e2e/shots.fixture.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig({
  testDir: fileURLToPath(new URL('./e2e/', import.meta.url)),
  testMatch: /shots\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 240_000,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: SHOTS_URL,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  },

  webServer: [
    {
      command: `npm run dev -w @sve/studio -- --port ${SHOTS_PORT} --strictPort`,
      cwd: REPO_ROOT,
      url: SHOTS_URL,
      reuseExistingServer: false,
      timeout: 180_000,
      env: { SVE_AGENT: 'fake', SVE_STUDIO_WORKSPACE: SHOTS_WORKSPACE },
    },
  ],
});
