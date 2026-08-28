// This package is the only node-side half of the toolchain so far: it reads paths and
// resolves Babel plugins off disk. The root tsconfig pins `types` to vitest's globals,
// which switches off automatic @types inclusion, so pull node's in explicitly here
// rather than widening the setting for every package.
/// <reference types="node" />
