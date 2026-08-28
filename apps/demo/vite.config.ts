import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The page under edit knows nothing about the editor: no @sve/* plugin is wired in here.
// The overlay is injected by the dev server that hosts this app, so both `npm run dev`
// and the E2E fixture run the app exactly as it ships.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true },
});
