/**
 * The attributes `@sve/source-loc`'s babel pass stamps onto every JSX host element.
 *
 * They are declared here rather than imported because that package opens with
 * `import path from 'node:path'` and this one runs in the browser. `test/attrs.test.ts`
 * runs in Node, imports both, and fails if the two copies ever disagree.
 */

/** Exact origin: `file:line:col`, 1-based, valid only until the next write to the file. */
export const ATTR_LOC = 'data-sve-loc';
/** Structural id: survives the line shifts the agent's own write causes. */
export const ATTR_EID = 'data-sve-eid';
/** Whether the children can be replaced with a literal. */
export const ATTR_TEXT = 'data-sve-text';
/** Whether `className` can be rewritten as a literal. */
export const ATTR_CLASS = 'data-sve-class';

export const SVE_ATTRS = [ATTR_LOC, ATTR_EID, ATTR_TEXT, ATTR_CLASS] as const;

/** Mirrors `TextKind` in @sve/source-loc. `mixed` is text alongside element children. */
export type TextKind = 'static' | 'dynamic' | 'mixed' | 'none';
/** Mirrors `ClassKind` in @sve/source-loc. */
export type ClassKind = 'literal' | 'dynamic' | 'none';

const TEXT_KINDS: readonly string[] = ['static', 'dynamic', 'mixed', 'none'];
const CLASS_KINDS: readonly string[] = ['literal', 'dynamic', 'none'];

/** The DOM is untrusted input too: an unstamped or hand-edited attribute reads as `none`. */
export function readTextKind(value: string | null): TextKind {
  return value !== null && TEXT_KINDS.includes(value) ? (value as TextKind) : 'none';
}

export function readClassKind(value: string | null): ClassKind {
  return value !== null && CLASS_KINDS.includes(value) ? (value as ClassKind) : 'none';
}
