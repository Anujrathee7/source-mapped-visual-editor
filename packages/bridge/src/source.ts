export interface SourceLine {
  /** The line's content, without its terminator. */
  text: string;
  /** `\r\n`, `\n`, `\r`, or `''` for a final line with no terminator. */
  terminator: string;
}

/**
 * Splits source into lines while keeping each line's own terminator.
 *
 * A plain `split('\n')` loses whether a file used CRLF and whether it ended
 * with a newline, and rejoining then rewrites the whole file to whichever
 * convention the code happened to pick. Keeping the terminator per line means
 * an edit that only rewrites `text` reproduces every other byte exactly —
 * including a file that mixes conventions, which a normalising round-trip
 * would quietly "fix".
 */
export function splitLines(source: Buffer | string): SourceLine[] {
  const text = typeof source === 'string' ? source : source.toString('utf8');
  const lines: SourceLine[] = [];
  const terminators = /\r\n|\n|\r/g;

  let start = 0;
  for (let match = terminators.exec(text); match; match = terminators.exec(text)) {
    lines.push({ text: text.slice(start, match.index), terminator: match[0] });
    start = terminators.lastIndex;
  }
  if (start < text.length) lines.push({ text: text.slice(start), terminator: '' });

  return lines;
}

export function joinLines(lines: readonly SourceLine[]): Buffer {
  return Buffer.from(lines.map((line) => line.text + line.terminator).join(''), 'utf8');
}
