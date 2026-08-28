import { defineConfig, devices } from '@playwright/test';

const DEMO_URL = 'http://localhost:5173';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: DEMO_URL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // The demo's own dev server, with nothing injected into it. `reuseExistingServer` is
  // off on purpose: a dev server already on 5173 may be the editor-hosting one, and
  // AC-2.5 is specifically the demo standing up without the editor. A busy port should
  // fail loudly rather than quietly test the wrong server.
  webServer: {
    command: 'npm run dev -w @sve/demo',
    url: DEMO_URL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
