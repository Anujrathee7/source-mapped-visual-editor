// This package is the seam, so it is the one package with a foot in both worlds.
//
//   src/plugin.ts   runs in Node, inside the dev server, and needs node's types;
//   src/client/**   is served to the browser by that dev server and needs Vite's client
//                   types for `import.meta.hot`.
//
// The root tsconfig pins `types` to vitest's globals, which switches off automatic @types
// inclusion, so both are pulled in explicitly here rather than widening the setting for
// every package. The split is enforced by imports, not by the type system: nothing under
// `src/client/` may import `./plugin.js`, and `src/index.ts` never re-exports the client.
/// <reference types="node" />
/// <reference types="vite/client" />
