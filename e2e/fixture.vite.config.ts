import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { sve } from '@sve/vite';
import { FIXTURE_PORT, FIXTURE_ROOT, prepareFixture } from './fixture.js';

// The verification suite's server: the demo, editor and all, on a throwaway copy of the
// app so that AC-5's real file writes never touch `apps/demo`. See `e2e/fixture.ts`.
//
// Building the copy here, as a side effect of loading the config, is deliberate.
// Playwright starts its `webServer` before `globalSetup` runs, so global setup would be
// pointing the server at a directory that does not exist yet; loading a config, on the
// other hand, is the first thing the server does.
//
// The plugin list mirrors `apps/demo/vite.config.ts` exactly. It is a second copy rather
// than an import because the demo's config is the app's, and giving it a fixture-shaped
// seam to be reused through would be the test dictating to the app.
prepareFixture();

export default defineConfig({
  root: FIXTURE_ROOT,
  plugins: [sve(), react(), tailwindcss()],
  server: { port: FIXTURE_PORT, strictPort: true },
});
