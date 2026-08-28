/**
 * The source excerpt and the caret (AC-4.8).
 *
 * docs/design.md §1: "No other visual editor can draw this, because no other one knows the
 * column." This module is the arithmetic behind that claim, kept pure and separate from
 * the chrome so the off-by-one the criterion cares about is testable on its own.
 */
import type { Loc } from '@sve/protocol';

export interface ExcerptLine {
  /** 1-based, as the file itself numbers them and as the diagnostic prints them. */
  number: number;
  text: string;
  isTarget: boolean;
}

export interface Caret {
  line: number;
  /** 1-based, straight from the loc. */
  column: number;
  /** 0-based index into the target line's text. `column - 1`, clamped to the line. */
  offset: number;
  /**
   * The target line's leading text with every non-tab character replaced by a space.
   * Rendering this as the caret row's prefix keeps the marker under the column even when
   * the line is indented with tabs, which a run of `offset` spaces would not.
   */
  pad: string;
}

export interface Excerpt {
  lines: ExcerptLine[];
  caret: Caret;
}

/** Splits on any line ending. AC-3.2 keeps CRLF files intact on disk, so they arrive here. */
function splitLines(source: string): string[] {
  return source.split(/\r\n|\n|\r/);
}

/**
 * The window of lines around `loc`, with the caret positioned under its column.
 *
 * A loc past the end of the file is clamped rather than rejected: `data-sve-loc` is stale
 * the moment the agent writes, and an inspector that renders nothing is worse than one
 * that renders the closest real line while M6 re-anchors.
 */
export function buildExcerpt(source: string, loc: Loc, context = 2): Excerpt {
  const all = splitLines(source);
  const lastLine = Math.max(1, all.length);
  const targetLine = Math.min(Math.max(1, loc.line), lastLine);

  const first = Math.max(1, targetLine - context);
  const last = Math.min(lastLine, targetLine + context);

  const lines: ExcerptLine[] = [];
  for (let number = first; number <= last; number += 1) {
    lines.push({ number, text: all[number - 1] ?? '', isTarget: number === targetLine });
  }

  const text = all[targetLine - 1] ?? '';
  // Columns are 1-based (see the babel pass), so column 1 is offset 0. This subtraction is
  // the whole of AC-4.8 and the only place it happens.
  const offset = Math.min(Math.max(0, loc.col - 1), text.length);

  return {
    lines,
    caret: { line: targetLine, column: loc.col, offset, pad: text.slice(0, offset).replace(/[^\t]/g, ' ') },
  };
}

/**
 * Maps a project-relative loc onto a dev-server URL.
 *
 * Locs are relative to the repo root; Vite serves relative to its own root, which for the
 * demo is `apps/demo`. The two differ, so the mapping is configuration rather than a
 * guess, and `MountOptions.fetchSource` overrides it outright once the bridge grows an
 * endpoint of its own.
 */
export function defaultSourceUrl(file: string, viteRoot: string): string {
  const root = viteRoot.replace(/\/+$/, '');
  const relative = root !== '' && file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file;
  return `/${relative.replace(/^\/+/, '')}`;
}
