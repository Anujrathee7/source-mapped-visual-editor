import { defineConfig, devices } from '@playwright/test';
import { FIXTURE_URL } from './e2e/fixture.js';

/**
 * Regenerating the README images:
 *
 *   npx playwright test --config playwright.shots.config.ts
 *
 * Separate from `playwright.config.ts` on purpose. These "tests" assert almost nothing and
 * write into `docs/images/`, so keeping them out of the suite means a documentation
 * refresh can never be mistaken for a passing verification run, and CI never spends time
 * on it.
 *
 * It serves the same throwaway fixture the AC-5 suite does, so the screenshots are of the
 * editor actually running — a posed screenshot is one that stops being true.
 */
export default defineConfig({
  testDir: 'e2e',
  testMatch: /screenshots\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: FIXTURE_URL,
    deviceScaleFactor: 2,
  },

  webServer: [
    {
      command: 'npx vite --config e2e/fixture.vite.config.ts --configLoader runner',
      url: FIXTURE_URL,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { SVE_AGENT: 'fake' },
    },
  ],
});
