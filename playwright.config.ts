import { defineConfig, devices } from '@playwright/test';
import { FIXTURE_URL } from './e2e/fixture.js';
import { STUDIO_PORT, STUDIO_URL, STUDIO_WORKSPACE } from './e2e/studio.fixture.js';

const DEMO_URL = 'http://localhost:5173';

/**
 * Whether this run is the opt-in live-agent one (AC-6.7 / AC-5.10).
 *
 * It decides two things together, and they must not be decided apart: which
 * agent the editor server runs, and which suite is pointed at it. `SVE_AGENT=fake`
 * gets `verification.spec.ts`, whose outcomes are scripted; `SVE_AGENT=claude`
 * gets `live.spec.ts` instead. Running both against one server would mean asking
 * the fake suite to drive a real model, which is neither test.
 *
 * The live project is registered either way, so a default run reports it as
 * skipped rather than silently not existing — the file's own `test.skip` is what
 * skips it, and it costs nothing to see that it was there.
 */
const LIVE = process.env['SVE_AGENT'] === 'claude';

/**
 * Two servers, because the suite asks two different questions.
 *
 * `demo` is the page on its own, with `SVE_EDITOR=off` taking the plugin back out of
 * `apps/demo/vite.config.ts`. AC-2.5 is specifically the demo standing up without the
 * editor, and it must keep passing on a checkout where the editor does not exist.
 *
 * `editor` is the whole thing joined, serving a throwaway copy of the demo (see
 * `e2e/fixture.ts`). AC-5's tests drive a real agent that writes real files, so they must
 * not be pointed at the checked-in app — and they must not be pointed at the same tree the
 * smoke suite is reading from while it reads it.
 *
 * `reuseExistingServer` is off on both: a dev server already on a port may be the other
 * one, and a busy port should fail loudly rather than quietly test the wrong server.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: 'list',
  use: { trace: 'on-first-retry' },

  projects: [
    {
      name: 'demo',
      testMatch: /demo\.smoke\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: DEMO_URL },
    },
    // The fake-agent suite, dropped when the server is running the real one.
    ...(LIVE
      ? []
      : [
          {
            name: 'editor',
            testMatch: /verification\.spec\.ts/,
            // One worker's worth of these at a time: they write to one shared fixture, and
            // two running at once would each restore the other's file out from under it.
            fullyParallel: false,
            use: { ...devices['Desktop Chrome'], baseURL: FIXTURE_URL },
          },
        ]),
    // AC-15.6. The only suite that drives the studio rather than the in-page editor, and
    // the only one whose project server is started by `@sve/host` rather than by
    // Playwright. Serial for the same reason the others are: one fixture tree, real writes.
    ...(LIVE
      ? []
      : [
          {
            name: 'studio',
            testMatch: /studio\.spec\.ts/,
            fullyParallel: false,
            use: { ...devices['Desktop Chrome'], baseURL: STUDIO_URL },
          },
        ]),
    {
      name: 'live',
      testMatch: /live\.spec\.ts/,
      // Same shared fixture, same reason — and a real agent takes long enough that
      // overlapping runs would also be paying for each other's retries.
      fullyParallel: false,
      use: { ...devices['Desktop Chrome'], baseURL: FIXTURE_URL },
    },
  ],

  webServer: [
    {
      command: 'npm run dev -w @sve/demo',
      url: DEMO_URL,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { SVE_EDITOR: 'off' },
    },
    {
      // `--configLoader runner` for the same reason the demo's scripts pass it: the
      // default loader hands `@sve/vite` to Node, which will not resolve a `.js`
      // specifier inside a `.ts` file.
      command: 'npx vite --config e2e/fixture.vite.config.ts --configLoader runner',
      url: FIXTURE_URL,
      reuseExistingServer: false,
      timeout: 120_000,
      // Spelled out rather than passed through: the only two agents this server
      // may be started with are the scripted one and the live one, and a typo in
      // `SVE_AGENT` must not quietly select something else.
      env: { SVE_AGENT: LIVE ? 'claude' : 'fake' },
    },
    {
      // The studio, on a port it can be named by (AC-15.3): the fixture project's own
      // config writes this origin down, and the frame answers nothing else.
      command: `npm run dev -w @sve/studio -- --port ${STUDIO_PORT} --strictPort`,
      url: STUDIO_URL,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        SVE_AGENT: 'fake',
        // Clones and dependency caches, deliberately outside the project (AC-11.1) and
        // named rather than left in the system temp directory, so a run that leaves
        // something behind leaves it somewhere a person can look.
        SVE_STUDIO_WORKSPACE: STUDIO_WORKSPACE,
      },
    },
  ],
});
