// The overlay is dev-only and gates on `import.meta.env.DEV` (AC-4.1). The root tsconfig
// pins `types` to vitest's globals, which switches off automatic @types inclusion, so pull
// Vite's client types in explicitly here rather than widening the setting for every
// package. This is a browser-only package: nothing under src/ may reference node's types.
/// <reference types="vite/client" />
