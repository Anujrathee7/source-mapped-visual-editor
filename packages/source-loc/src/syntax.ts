import { createRequire } from 'node:module';
import type { PluginItem } from '@babel/core';

const require = createRequire(import.meta.url);

/**
 * Syntax-only plugins: they teach the parser to read JSX and TypeScript without
 * transforming either. Stamping must not strip types or lower JSX — this pass runs
 * `enforce: 'pre'`, ahead of whatever the app's own React plugin does, and AC-1.8
 * requires the output to differ from the input by attributes alone.
 *
 * Resolved from this package rather than passed by name, so Babel does not have to
 * find them relative to whatever `cwd` the dev server happens to run under.
 */
export const SYNTAX_PLUGINS: PluginItem[] = [
  require.resolve('@babel/plugin-syntax-jsx'),
  [require.resolve('@babel/plugin-syntax-typescript'), { isTSX: true }],
];
