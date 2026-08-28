import { splitLines } from './source.js';

/**
 * A one-hunk line diff of what a job changed, for the result the overlay shows.
 *
 * Deliberately not a general diff: an edit here rewrites one stamped line, so
 * trimming the common prefix and suffix names the change exactly. A scattered
 * edit collapses into a single wide hunk — imprecise, but never wrong, and a
 * job that touched lines it should not have is something the reader should see
 * as one glaring block anyway.
 */
export function lineDiff(before: Buffer, after: Buffer, file: string): string | undefined {
  if (Buffer.compare(before, after) === 0) return undefined;

  const oldLines = splitLines(before).map((line) => line.text);
  const newLines = splitLines(after).map((line) => line.text);

  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
    start += 1;
  }

  let fromEnd = 0;
  while (
    fromEnd < oldLines.length - start &&
    fromEnd < newLines.length - start &&
    oldLines[oldLines.length - 1 - fromEnd] === newLines[newLines.length - 1 - fromEnd]
  ) {
    fromEnd += 1;
  }

  const removed = oldLines.slice(start, oldLines.length - fromEnd);
  const added = newLines.slice(start, newLines.length - fromEnd);

  return [
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -${start + 1},${removed.length} +${start + 1},${added.length} @@`,
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
  ].join('\n');
}
