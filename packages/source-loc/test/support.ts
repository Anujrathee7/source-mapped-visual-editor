import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformSync, type PluginObj } from '@babel/core';
import type * as t from '@babel/types';
import { SYNTAX_PLUGINS, sourceLocBabelPlugin } from '../src/index.js';

/**
 * The fixture is read from disk rather than inlined, because AC-1's line and column
 * numbers are derived from the file exactly as it is committed.
 */
export const FIXTURE_PATH = fileURLToPath(new URL('./fixtures/Sample.tsx', import.meta.url));
export const FIXTURE = readFileSync(FIXTURE_PATH, 'utf8');

/** The filename AC-1.2 and AC-1.3 pin their expected values against. */
export const FIXTURE_FILENAME = 'apps/demo/src/Sample.tsx';

export interface Attr {
  name: string;
  /** The literal value, or `null` for an expression container / spread / bare attribute. */
  value: string | null;
}

export interface Stamped {
  tag: string;
  attrs: Attr[];
}

export function jsxName(node: t.JSXOpeningElement['name']): string {
  switch (node.type) {
    case 'JSXIdentifier':
      return node.name;
    case 'JSXNamespacedName':
      return `${node.namespace.name}:${node.name.name}`;
    case 'JSXMemberExpression':
      return `${jsxName(node.object)}.${node.property.name}`;
  }
}

function attrName(node: t.JSXAttribute['name']): string {
  return node.type === 'JSXIdentifier'
    ? node.name
    : `${node.name.namespace.name}:${node.name.name.name}`;
}

/** Runs the plugin under test and returns the emitted code. */
export function stamp(code: string, filename: string, root?: string): string {
  const result = transformSync(code, {
    filename,
    babelrc: false,
    configFile: false,
    plugins: [...SYNTAX_PLUGINS, [sourceLocBabelPlugin, root === undefined ? {} : { root }]],
  });
  if (result?.code == null) throw new Error('babel produced no code');
  return result.code;
}

/** Re-parses code and reports every JSX opening element in source order. */
export function collect(code: string): Stamped[] {
  const found: Stamped[] = [];
  transformSync(code, {
    filename: 'collect.tsx',
    babelrc: false,
    configFile: false,
    code: false,
    plugins: [
      ...SYNTAX_PLUGINS,
      (): PluginObj => ({
        name: 'sve-test-collect',
        visitor: {
          JSXOpeningElement(path) {
            found.push({
              tag: jsxName(path.node.name),
              attrs: path.node.attributes.map((attr) =>
                attr.type === 'JSXSpreadAttribute'
                  ? { name: '...', value: null }
                  : {
                      name: attrName(attr.name),
                      value: attr.value?.type === 'StringLiteral' ? attr.value.value : null,
                    },
              ),
            });
          },
        },
      }),
    ],
  });
  return found;
}

/** The single element with this tag name. Throws when the tag is absent or repeated. */
export function element(code: string, tag: string): Stamped {
  const matches = collect(code).filter((el) => el.tag === tag);
  if (matches.length !== 1) {
    throw new Error(`expected exactly one <${tag}>, found ${matches.length}`);
  }
  return matches[0]!;
}

export function attr(el: Stamped, name: string): string | null | undefined {
  return el.attrs.find((a) => a.name === name)?.value;
}

/** Every attribute name in the order it appears on the element. */
export function attrNames(el: Stamped): string[] {
  return el.attrs.map((a) => a.name);
}

/** Canonical Babel re-print, so comparisons are about the AST and not about formatting. */
export function reprint(code: string): string {
  const result = transformSync(code, {
    filename: 'reprint.tsx',
    babelrc: false,
    configFile: false,
    plugins: [...SYNTAX_PLUGINS],
  });
  if (result?.code == null) throw new Error('babel produced no code');
  return result.code;
}

/** Canonical re-print with every `data-sve-*` attribute removed. */
export function reprintWithoutSve(code: string): string {
  const result = transformSync(code, {
    filename: 'reprint.tsx',
    babelrc: false,
    configFile: false,
    plugins: [
      ...SYNTAX_PLUGINS,
      (): PluginObj => ({
        name: 'sve-test-strip',
        visitor: {
          JSXOpeningElement(path) {
            path.node.attributes = path.node.attributes.filter(
              (a) =>
                a.type === 'JSXSpreadAttribute' || !attrName(a.name).startsWith('data-sve-'),
            );
          },
        },
      }),
    ],
  });
  if (result?.code == null) throw new Error('babel produced no code');
  return result.code;
}
