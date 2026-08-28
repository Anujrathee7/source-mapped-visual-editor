import path from 'node:path';
import type { PluginObj, PluginPass } from '@babel/core';
import type * as t from '@babel/types';
import { formatLoc } from '@sve/protocol';

/** Exact origin: `file:line:col`, 1-based, valid only until the next write to the file. */
export const ATTR_LOC = 'data-sve-loc';
/** Structural id: survives the line shifts the agent's own write causes. */
export const ATTR_EID = 'data-sve-eid';
/** Whether the children can be replaced with a literal. */
export const ATTR_TEXT = 'data-sve-text';
/** Whether `className` can be rewritten as a literal. */
export const ATTR_CLASS = 'data-sve-class';

export const SVE_ATTRS = [ATTR_LOC, ATTR_EID, ATTR_TEXT, ATTR_CLASS] as const;

export type TextKind = 'static' | 'dynamic' | 'mixed' | 'none';
export type ClassKind = 'literal' | 'dynamic' | 'none';

export interface SourceLocOptions {
  /** Directory every stamped path is made relative to. Defaults to `process.cwd()`. */
  root?: string;
}

interface State extends PluginPass {
  /** One tag-name counter per element scope, innermost last. */
  sveScopes: Array<Map<string, number>>;
  /** The `tag:n` segments from the outermost element down to the current one. */
  sveSegments: string[];
  sveFile: string;
  /** How many host elements this pass stamped, surfaced on `file.metadata`. */
  sveStamped: number;
}

/** Shape of the Babel `metadata` this plugin contributes. */
export interface SourceLocMetadata {
  sveStamped: number;
}

/**
 * Project-relative, forward slashes, on every platform. `path.relative` hands back
 * backslashes on Windows and a backslash does not survive the round-trip through the
 * agent prompt and back out of `parseLoc` intact.
 */
export function toProjectPath(filename: string, root: string): string {
  return path.relative(root, path.resolve(root, filename)).replace(/\\/g, '/');
}

export function elementName(name: t.JSXOpeningElement['name']): string {
  switch (name.type) {
    case 'JSXIdentifier':
      return name.name;
    case 'JSXNamespacedName':
      return `${name.namespace.name}:${name.name.name}`;
    case 'JSXMemberExpression':
      return `${elementName(name.object)}.${name.property.name}`;
  }
}

/**
 * Host elements only. A component, a member expression (`<motion.div>`) and a fragment
 * all emit no DOM node of their own, so a coordinate on one would point at markup that
 * is not in the document.
 */
function isHostName(name: t.JSXOpeningElement['name']): boolean {
  if (name.type !== 'JSXIdentifier') return false;
  return /^[a-z]/.test(name.name) || name.name.includes('-');
}

function classifyText(children: readonly t.JSXElement['children'][number][]): TextKind {
  let hasText = false;
  let hasElement = false;
  let hasExpression = false;

  for (const child of children) {
    switch (child.type) {
      case 'JSXText':
        // Whitespace between elements is layout, not content.
        if (/\S/.test(child.value)) hasText = true;
        break;
      case 'JSXElement':
      case 'JSXFragment':
        hasElement = true;
        break;
      case 'JSXExpressionContainer':
        // `{/* a comment */}` is a JSXEmptyExpression and renders nothing.
        if (child.expression.type !== 'JSXEmptyExpression') hasExpression = true;
        break;
      case 'JSXSpreadChild':
        hasExpression = true;
        break;
    }
  }

  // `mixed` is checked first: element children make a wholesale text replacement wrong
  // whether or not an expression is also present, and adding one must not make the
  // element look *more* replaceable than it was.
  if (hasText && hasElement) return 'mixed';
  if (hasExpression) return 'dynamic';
  if (hasText) return 'static';
  return 'none';
}

function classifyClass(attributes: readonly t.JSXOpeningElement['attributes'][number][]): ClassKind {
  let kind: ClassKind = 'none';
  for (const attribute of attributes) {
    if (attribute.type !== 'JSXAttribute') continue;
    if (attribute.name.type !== 'JSXIdentifier' || attribute.name.name !== 'className') continue;
    // Last one wins, the same way JSX itself resolves a repeated attribute.
    if (attribute.value?.type === 'StringLiteral') kind = 'literal';
    else if (attribute.value?.type === 'JSXExpressionContainer') kind = 'dynamic';
    else kind = 'none';
  }
  return kind;
}

function hasAttribute(node: t.JSXOpeningElement, name: string): boolean {
  return node.attributes.some(
    (attribute) =>
      attribute.type === 'JSXAttribute' &&
      attribute.name.type === 'JSXIdentifier' &&
      attribute.name.name === name,
  );
}

/**
 * Stamps every JSX host element with the source location it came from, so the agent is
 * *told* which line to edit rather than asked to search for it.
 */
export function sourceLocBabelPlugin(
  api: { types: typeof t },
  options: SourceLocOptions = {},
): PluginObj<State> {
  const { types } = api;
  const root = options.root ?? process.cwd();

  const attribute = (name: string, value: string): t.JSXAttribute =>
    types.jsxAttribute(types.jsxIdentifier(name), types.stringLiteral(value));

  return {
    name: 'sve-source-loc',

    post(file) {
      (file.metadata as SourceLocMetadata).sveStamped = this.sveStamped ?? 0;
    },

    visitor: {
      Program: {
        enter(_path, state) {
          state.sveScopes = [new Map()];
          state.sveSegments = [];
          state.sveStamped = 0;
          state.sveFile = toProjectPath(state.filename ?? 'unknown.jsx', root);
        },
      },

      JSXOpeningElement: {
        enter(elementPath, state) {
          const node = elementPath.node;
          const name = elementName(node.name);

          // Every element takes a slot, host or not, so that wrapping a run of elements
          // in a component does not renumber its neighbours.
          const scope = state.sveScopes[state.sveScopes.length - 1]!;
          const index = scope.get(name) ?? 0;
          scope.set(name, index + 1);
          state.sveSegments.push(`${name}:${index}`);
          // A fragment has no JSXOpeningElement, so it never opens a scope: its children
          // are numbered in the enclosing element's scope, matching the DOM they produce.
          state.sveScopes.push(new Map());

          if (!isHostName(node.name)) return;
          // AC-1.6: transforming an already-stamped file must not duplicate anything.
          if (hasAttribute(node, ATTR_LOC)) return;

          const start = node.loc?.start;
          // A synthesised node has no origin to report.
          if (!start) return;

          const parent = elementPath.parent;
          const children = parent.type === 'JSXElement' ? parent.children : [];
          // Read before appending, so the stamps themselves are never classified.
          const classKind = classifyClass(node.attributes);
          state.sveStamped += 1;

          node.attributes.push(
            // Babel's columns are 0-based; every editor and compiler prints 1-based.
            attribute(
              ATTR_LOC,
              formatLoc({ file: state.sveFile, line: start.line, col: start.column + 1 }),
            ),
            attribute(ATTR_EID, `${state.sveFile}#${state.sveSegments.join('/')}`),
            attribute(ATTR_TEXT, classifyText(children)),
            attribute(ATTR_CLASS, classKind),
          );
        },
      },

      JSXElement: {
        exit(_path, state) {
          state.sveScopes.pop();
          state.sveSegments.pop();
        },
      },
    },
  };
}
