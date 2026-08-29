import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { sve } from '@sve/vite';

// The page under edit still knows nothing about the editor: `src/**` imports no `@sve/*`
// package, and `sve()` is build configuration rather than app code. It stamps origins,
// mounts the bridge, and injects the overlay into the served HTML — so `npm run dev` is
// the demo *and* the editor, and neither half is wired in by the other.
//
// `SVE_EDITOR=off` takes the editor back out. The demo's own smoke suite (AC-2.5) is the
// proof that this page stands up as a plain React app, so it has to be able to run against
// a server with nothing injected into it.
//
// Both halves are `apply: 'serve'`, so `vite build` never sees them.
export default defineConfig({
  plugins: [sve({ enabled: process.env.SVE_EDITOR !== 'off' }), react(), tailwindcss()],
  server: { port: 5173, strictPort: true },
});
