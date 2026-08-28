import { transformSync } from '@babel/core';
import type { Plugin } from 'vite';
import {
  sourceLocBabelPlugin,
  type SourceLocMetadata,
  type SourceLocOptions,
} from './babel-plugin.js';
import { SYNTAX_PLUGINS } from './syntax.js';

const JSX_EXTENSION = /\.[jt]sx$/;
const IN_NODE_MODULES = /(^|\/)node_modules\//;
/** Cheap gate: no `<` followed by a tag start means no JSX, so no Babel round-trip. */
const LOOKS_LIKE_JSX = /<[A-Za-z_$>]/;

export type SourceLocViteOptions = SourceLocOptions;

/**
 * Dev-only origin stamping.
 *
 * `enforce: 'pre'` puts this ahead of the app's React plugin, so it sees the source as
 * written; `apply: 'serve'` keeps every stamp out of a production build, where there is
 * no editor to consume them.
 */
export function sourceLoc(options: SourceLocViteOptions = {}): Plugin {
  let root = options.root ?? process.cwd();

  return {
    name: 'sve:source-loc',
    enforce: 'pre',
    apply: 'serve',

    configResolved(config) {
      // An explicit root wins; otherwise follow the dev server's.
      if (options.root === undefined) root = config.root;
    },

    transform(code, id) {
      const file = (id.split('?', 1)[0] ?? id).replace(/\\/g, '/');
      if (!JSX_EXTENSION.test(file)) return null;
      if (IN_NODE_MODULES.test(file)) return null;
      if (!LOOKS_LIKE_JSX.test(code)) return null;

      const result = transformSync(code, {
        filename: file,
        babelrc: false,
        configFile: false,
        sourceMaps: true,
        // React stack traces and devtools have to keep pointing at real source lines,
        // so name the source by the module id Vite knows rather than its basename.
        sourceFileName: file,
        plugins: [...SYNTAX_PLUGINS, [sourceLocBabelPlugin, { root }]],
      });

      if (result?.code == null || result.map == null) return null;
      // Parsed as JSX but nothing was stamped: the output is the input, so hand back
      // null rather than a gratuitous map.
      if (((result.metadata as SourceLocMetadata | undefined)?.sveStamped ?? 0) === 0) {
        return null;
      }

      return { code: result.code, map: result.map };
    },
  };
}
