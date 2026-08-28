/**
 * Join class names, dropping anything falsy.
 *
 * Deliberately ~10 lines rather than a `clsx` dependency: the demo is the page under
 * edit, and every dependency it carries is one more thing the visual editor has to be
 * innocent of. Conditional branches are kept whole (`safe ? 'a b' : 'c d'`) so the
 * class attribute a human wrote still reads as the class attribute in the DOM.
 */
export type ClassValue = string | false | null | undefined;

export function cn(...values: ClassValue[]): string {
  let out = '';
  for (const value of values) {
    if (!value) continue;
    out = out === '' ? value : `${out} ${value}`;
  }
  return out;
}
