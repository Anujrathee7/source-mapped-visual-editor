/**
 * The studio's own dev server, with the host running behind it in the same process.
 *
 * `sveStudio` mounts `/api/`; everything else is the React app. The projects a user
 * connects get servers of their own from `@sve/host`, on their own ports — this one never
 * serves anybody else's source.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sveStudio } from './src/host/middleware.js';
import { createStudioService } from './src/host/service.js';

/**
 * Clones and dependency caches, deliberately outside every project (AC-11.1).
 *
 * `SVE_STUDIO_WORKSPACE` when a person wants them somewhere they can look at; a temporary
 * directory otherwise, because a default that wrote into this repository would be the
 * exact thing the project promises not to do to anybody else's.
 */
const workspaceDir =
  process.env['SVE_STUDIO_WORKSPACE'] ?? mkdtempSync(path.join(tmpdir(), 'sve-studio-'));

export default defineConfig({
  plugins: [react(), sveStudio(createStudioService({ workspaceDir }))],
  // Clear of 5173/5174 (the demo and the E2E fixture) and of 5310 upward, where the host
  // starts looking for ports of its own.
  server: { port: 5300, strictPort: false },
});
