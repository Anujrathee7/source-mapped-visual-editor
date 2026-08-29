import {
  parseLoc,
  TRACKED_PROPS,
  type EditIntent,
  type Mismatch,
  type TrackedProp,
} from '@sve/protocol';
import { splitLines } from './source.js';

export const PROMPT_CONTEXT_LINES = 4;

export interface BuildPromptArgs {
  intent: EditIntent;
  /** The file's bytes, read fresh at job time — never a copy taken at enqueue time. */
  source: Buffer | string;
  contextLines?: number;
  /** Path as it should appear in the prompt. Defaults to the path inside the loc. */
  displayPath?: string;
}

function excerpt(source: Buffer | string, line: number, col: number, radius: number): string {
  const lines = splitLines(source);
  const first = Math.max(1, line - radius);
  const last = Math.min(lines.length, line + radius);
  const width = String(last).length;
  const rows: string[] = [];

  for (let n = first; n <= last; n += 1) {
    const marker = n === line ? '>' : ' ';
    rows.push(`${marker} ${String(n).padStart(width)} | ${lines[n - 1]?.text ?? ''}`);
    if (n === line) {
      // The caret sits under the stamped column, so the agent is not left to
      // count characters. Columns are 1-based, as the Babel pass emits them.
      rows.push(`  ${' '.repeat(width)} | ${' '.repeat(Math.max(0, col - 1))}^ column ${col}`);
    }
  }

  return rows.join('\n');
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function describeChange(intent: EditIntent): string {
  switch (intent.kind) {
    case 'text':
      return [
        `  Current text:  ${quote(intent.before.text)}`,
        `  Required text: ${quote(intent.after.text)}`,
      ].join('\n');

    case 'class':
      return [
        `  Current classes:  ${intent.before.classes.join(' ')}`,
        `  Required classes: ${intent.after.classes.join(' ')}`,
      ].join('\n');

    case 'style': {
      const rows: string[] = [];
      for (const prop of TRACKED_PROPS as readonly TrackedProp[]) {
        const before = intent.before.computed[prop];
        const after = intent.after.computed[prop];
        if (after !== undefined && after !== before) {
          rows.push(`  ${prop}: ${before ?? '(unset)'} -> ${after}`);
        }
      }
      return rows.length > 0 ? rows.join('\n') : '  (no computed property differs)';
    }
  }
}

/**
 * The prompt that tells, and does not ask (AC-3.7).
 *
 * The element's origin is already stamped in the source, so the agent is handed
 * `file:line:col` and a numbered excerpt around it. There is deliberately no
 * instruction to search, locate, or find anything: that step is where agent
 * edits usually go wrong, and here it does not exist. Keep it that way when
 * tuning this text — a test asserts the absence.
 */
export function buildPrompt(args: BuildPromptArgs): string {
  const loc = parseLoc(args.intent.loc);
  if (loc === null) throw new Error(`unparseable loc: ${args.intent.loc}`);

  const file = args.displayPath ?? loc.file;
  const radius = args.contextLines ?? PROMPT_CONTEXT_LINES;

  return [
    'Apply one small edit to one line of one file.',
    '',
    `File:     ${file}`,
    `Element:  <${args.intent.tag}>`,
    `Target:   ${file}:${loc.line}:${loc.col}   (line ${loc.line}, column ${loc.col})`,
    '',
    'The exact origin above was stamped into the source by the build, and the',
    'excerpt below was read from disk at the start of this job, so both are current.',
    '',
    excerpt(args.source, loc.line, loc.col, radius),
    '',
    `Change requested (${args.intent.kind}):`,
    describeChange(args.intent),
    '',
    `What the user did: ${args.intent.instruction}`,
    '',
    'Rules:',
    `  1. The <${args.intent.tag}> above begins at line ${loc.line} and ends at its own`,
    '     closing tag. Change only what is between those two points: no other line of',
    '     this file, and no other file, may change.',
    '  2. Do not reformat, re-indent, re-wrap, or re-order anything — not the rest of',
    `     the file, and not the element at line ${loc.line} beyond the change described`,
    '     above.',
    "  3. Preserve the file's existing indentation, quote style, and line endings.",
    `  4. If the element at line ${loc.line} is not what is described above, write nothing`,
    '     at all and reply exactly `BLOCKED: <reason>`.',
    '  5. When the edit is written, reply `DONE` and nothing else.',
  ].join('\n');
}

export interface BuildRetryPromptArgs {
  /** The prompt {@link buildPrompt} produced for this attempt, from source read now. */
  prompt: string;
  /** What the overlay recorded after hot reload: intent on one side, rendered on the other. */
  mismatch: readonly Mismatch[];
}

/**
 * The follow-up prompt for a retry (AC-6.5).
 *
 * A retry is not the same question asked twice. The agent already answered it,
 * its answer reached the file, the page re-rendered from that file, and the
 * result was compared to what the user asked for — so the one thing worth
 * saying is what its own edit actually produced. Sending the original prompt
 * again would ask an agent that has no memory of having answered, and would
 * invite it to write the same thing a second time.
 *
 * The excerpt inside `prompt` is re-read at job time, so it already shows the
 * file as the previous attempt left it, at whatever line the element now sits on.
 */
export function buildRetryPrompt(args: BuildRetryPromptArgs): string {
  const rows =
    args.mismatch.length > 0
      ? args.mismatch.map(
          (entry) =>
            `  ${entry.prop}: asked for ${quote(entry.intent)}, ` +
            `the page rendered ${quote(entry.rendered)}`,
        )
      : ['  (the difference was not recorded)'];

  return [
    args.prompt,
    '',
    'This is a retry of your previous edit.',
    '',
    'That edit was written to this file, the page was re-rendered from it, and the',
    'result did not match what was asked:',
    '',
    ...rows,
    '',
    'The excerpt above is the file as your previous edit left it. Correct it, under',
    'the same rules — one element, no other line, no other file.',
  ].join('\n');
}
