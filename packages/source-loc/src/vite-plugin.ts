import { transformSync } from '@babel/core';
import type { Plugin } from 'vite';
import {
  sourceLocBabelPlugin,
  toProjectPath,
  type SourceLocMetadata,
  type SourceLocOptions,
} from './babel-plugin.js';
import { SYNTAX_PLUGINS } from './syntax.js';

/**
 * Which files are worth a look.
 *
 * `.js` is in here because a project the host connects to was not written for this
 * editor: React apps that predate the `.jsx` convention keep JSX in plain `.js`, and a
 * gate that skips them produces an editor that mounts and then does nothing when clicked
 * (AC-11.4). `.ts` stays out — TypeScript reads `<T>` there as a type parameter, so
 * parsing it as JSX would be parsing it wrong.
 */
const JSX_EXTENSION = /\.([jt]sx|js)$/;
const IN_NODE_MODULES = /(^|\/)node_modules\//;
/** Cheap gate: no `<` followed by a tag start means no JSX, so no Babel round-trip. */
const LOOKS_LIKE_JSX = /<[A-Za-z_$>]/;

/** What one file's pass produced, for whoever is counting (AC-11.4). */
export interface StampReport {
  /** Project-relative, forward slashes — the same spelling a loc uses. */
  file: string;
  /** Host elements stamped. Zero for a candidate that turned out to hold no JSX. */
  elements: number;
}

export interface SourceLocViteOptions extends SourceLocOptions {
  /**
   * Called once per file this pass considered, stamped or not.
   *
   * Reporting rather than deciding: a file with nothing in it is unremarkable on its own,
   * and only a caller that knows a page was actually served can tell "no JSX here" from
   * "this project is not being stamped at all".
   */
  onStamp?: (report: StampReport) => void;
}

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

      const report = (elements: number): null => {
        options.onStamp?.({ file: toProjectPath(file, root), elements });
        return null;
      };

      if (!LOOKS_LIKE_JSX.test(code)) return report(0);

      let result: ReturnType<typeof transformSync>;
      try {
        result = transformSync(code, {
          filename: file,
          babelrc: false,
          configFile: false,
          sourceMaps: true,
          // React stack traces and devtools have to keep pointing at real source lines,
          // so name the source by the module id Vite knows rather than its basename.
          sourceFileName: file,
          plugins: [...SYNTAX_PLUGINS, [sourceLocBabelPlugin, { root }]],
        });
      } catch {
        // Widening to `.js` means this pass reads files nobody wrote for it — Flow, a
        // half-saved edit, a bundled vendor blob. The parse error is the app's own and
        // its own plugin will report it with a better frame than we can; throwing from a
        // `pre` transform would only replace that message with ours.
        return report(0);
      }

      const stamped = (result?.metadata as SourceLocMetadata | undefined)?.sveStamped ?? 0;
      if (result?.code == null || result.map == null) return report(stamped);
      // Parsed as JSX but nothing was stamped: the output is the input, so hand back
      // null rather than a gratuitous map.
      if (stamped === 0) return report(0);

      options.onStamp?.({ file: toProjectPath(file, root), elements: stamped });
      return { code: result.code, map: result.map };
    },
  };
}
