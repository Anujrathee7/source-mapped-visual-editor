// The root tsconfig typechecks apps/*/src without Vite's ambient types (its `types`
// array is pinned for the Vitest packages), so the CSS side-effect import needs a
// declaration of its own. Nothing else in the app relies on bundler globals.
declare module '*.css';
