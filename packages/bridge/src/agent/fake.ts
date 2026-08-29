import { TRACKED_PROPS, type Computed, type EditIntent, type TrackedProp } from '@sve/protocol';
import { joinLines, splitLines, type SourceLine } from '../source.js';
import { blocked, type AgentContext, type AgentOutcome, type AgentRunner } from './types.js';

export const FAKE_MODES = [
  'correct',
  'wrong',
  'blocked',
  'noop',
  /** Writes a different *source text* that resolves to the same computed value (AC-5.3). */
  'equivalent',
  /** Writes correctly, and adds a line above the element, moving every line below it (AC-5.4). */
  'verbose',
] as const;
export type FakeMode = (typeof FAKE_MODES)[number];

export function isFakeMode(value: string): value is FakeMode {
  return (FAKE_MODES as readonly string[]).includes(value);
}

/**
 * An instruction may carry `[sve:fake=wrong]`, which wins over every other
 * setting. That is how an end-to-end test drives a specific outcome from the
 * browser without a server restart or a reach into module internals.
 */
const DIRECTIVE = /\[sve:fake=([a-z]+)\]/i;

/**
 * The same directive, when it arrived as a class token rather than inside prose.
 *
 * A class edit's instruction is generated from the class list, so a browser-driven test
 * has no other way to say which outcome it wants. The token is the fake's own control
 * channel and is stripped before anything is written: it must never reach the file.
 */
const DIRECTIVE_CLASS = /^\[sve:[^\]]*\]$/i;

export interface FakeAgentOptions {
  mode?: FakeMode;
  /** Consumed one entry per run, in order; falls back to `mode` once exhausted. */
  script?: readonly FakeMode[];
}

const CLASS_ATTR = /className="([^"]*)"/;
const STYLE_ATTR = /\sstyle=\{\{[^}]*\}\}/;
const OPEN_TAG = /<([A-Za-z][\w.:-]*)/;

/** Far enough to cover any element a person would hand-write, near enough to stay local. */
const MAX_ELEMENT_LINES = 40;

/* ── locating the element's own lines ─────────────────────────────────────── */

/**
 * The lines the stamped element occupies.
 *
 * `data-sve-loc` marks where an element *begins*, and a formatted JSX element puts its
 * attributes and its children on the lines after that — the demo's hero `<h1>` opens on
 * line 17 and its text sits on line 21. "Edit line 17 only" is not a thing that can be
 * done to it.
 *
 * This is not the search step CLAUDE.md forbids. The agent is still told exactly which
 * element and exactly where it begins; the window is that element and stops at its own
 * closing tag. Nothing here looks for an element, and nothing here reads past one.
 */
function elementLines(lines: readonly SourceLine[], start: number, tag: string): number[] {
  const close = `</${tag}>`;
  const indices: number[] = [];
  for (let i = start; i < lines.length && indices.length < MAX_ELEMENT_LINES; i += 1) {
    const text = lines[i]!.text;
    indices.push(i);
    if (text.includes(close) || text.includes('/>')) break;
  }
  return indices;
}

/** The lines of the opening tag alone — where `className` and `style` may be written. */
function openingTagLines(lines: readonly SourceLine[], start: number): number[] {
  const indices: number[] = [];
  for (let i = start; i < lines.length && indices.length < MAX_ELEMENT_LINES; i += 1) {
    indices.push(i);
    if (lines[i]!.text.includes('>')) break;
  }
  return indices;
}

/* ── the near-misses ──────────────────────────────────────────────────────── */

/** A plausible near-miss, not noise: the verifier must have something real to catch. */
function mangleText(value: string): string {
  const titled = value.replace(/\b[a-z]/g, (char) => char.toUpperCase());
  return titled === value ? `${value} ` : titled;
}

function mangleClasses(classes: readonly string[]): string[] {
  if (classes.length === 0) return ['sve-fake-wrong'];
  const last = classes[classes.length - 1]!;
  const bumped = /\d+$/.test(last)
    ? last.replace(/(\d+)$/, (digits) => String(Number(digits) + 100))
    : `${last}-alt`;
  return [...classes.slice(0, -1), bumped];
}

function mangleStyleValue(value: string): string {
  return /\d/.test(value)
    ? value.replace(/\d+/, (digits) => String(Number(digits) + 1))
    : `${value} !important`;
}

/* ── colours, as Tailwind arbitrary values ────────────────────────────────── */

/** `rgb(255, 90, 31)` and `#FF5A1F` alike, as `#rrggbb`. Null when it is neither. */
function toHex(value: string | undefined): string | null {
  if (value === undefined) return null;
  const raw = value.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(raw);
  if (hex) return `#${hex[1]!.toLowerCase()}`;
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(raw);
  if (!rgb) return null;
  const channel = (part: string): string =>
    Math.max(0, Math.min(255, Math.round(Number(part))))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(rgb[1]!)}${channel(rgb[2]!)}${channel(rgb[3]!)}`;
}

/** Far enough away that no comparator could call it the same colour. */
function shiftHex(hex: string): string {
  const red = Number.parseInt(hex.slice(1, 3), 16);
  return `#${((red + 128) % 256).toString(16).padStart(2, '0')}${hex.slice(3)}`;
}

function withoutDirectives(classes: readonly string[]): string[] {
  return classes.filter((name) => !DIRECTIVE_CLASS.test(name));
}

function changedComputed(before: Computed, after: Computed): [TrackedProp, string][] {
  const changed: [TrackedProp, string][] = [];
  for (const prop of TRACKED_PROPS as readonly TrackedProp[]) {
    const next = after[prop];
    if (next !== undefined && next !== before[prop]) changed.push([prop, next]);
  }
  return changed;
}

/**
 * The class list to write, per mode.
 *
 * `equivalent` is the one with something to prove. It expresses the *same* resolved colour
 * the intent recorded, as a Tailwind arbitrary value — source text the overlay never sent,
 * resolving to the value the overlay asked for. A verifier comparing class strings calls
 * that drift; one comparing computed values calls it landed, which is AC-5.3.
 *
 * `wrong` is its mirror: an equally plausible arbitrary value, a visibly different colour.
 */
function classListFor(intent: EditIntent, mode: FakeMode): string[] {
  const wanted = withoutDirectives(intent.after.classes);
  const colour = toHex(intent.after.computed.color);
  const colourChanged = intent.after.computed.color !== intent.before.computed.color;

  if (mode === 'equivalent') {
    return colour !== null && colourChanged ? [...wanted, `text-[${colour}]`] : [...wanted].reverse();
  }
  if (mode === 'wrong') {
    return colour !== null && colourChanged
      ? [...wanted, `text-[${shiftHex(colour)}]`]
      : mangleClasses(wanted);
  }
  return wanted;
}

/* ── the edit ─────────────────────────────────────────────────────────────── */

interface Rewrite {
  index: number;
  text: string;
}

/**
 * Rewrites one line of the element, or returns null when the element is not what the
 * intent described. Returning null is what makes the fake honest: it is told an element,
 * and if that element does not hold what it was told, it refuses rather than editing
 * something plausible nearby.
 */
function planEdit(
  lines: readonly SourceLine[],
  intent: EditIntent,
  startIndex: number,
  mode: FakeMode,
): Rewrite | null {
  const corrupt = mode === 'wrong';

  switch (intent.kind) {
    case 'text': {
      const before = intent.before.text;
      if (before.length === 0) return null;
      const after = corrupt ? mangleText(intent.after.text) : intent.after.text;
      for (const index of elementLines(lines, startIndex, intent.tag)) {
        const text = lines[index]!.text;
        if (!text.includes(before)) continue;
        return { index, text: text.replace(before, after) };
      }
      return null;
    }

    case 'class': {
      const expected = intent.before.classes.join(' ');
      const next = classListFor(intent, mode).join(' ');
      for (const index of openingTagLines(lines, startIndex)) {
        const text = lines[index]!.text;
        const match = CLASS_ATTR.exec(text);
        if (!match) continue;
        if (expected.length > 0 && match[1] !== expected) continue;
        return {
          index,
          text:
            text.slice(0, match.index) +
            `className="${next}"` +
            text.slice(match.index + match[0].length),
        };
      }
      return null;
    }

    case 'style': {
      const changed = changedComputed(intent.before.computed, intent.after.computed);
      if (changed.length === 0) return null;
      const declarations = changed
        .map(
          ([prop, value], index) =>
            `${prop}: '${corrupt && index === 0 ? mangleStyleValue(value) : value}'`,
        )
        .join(', ');
      const attribute = ` style={{ ${declarations} }}`;

      for (const index of openingTagLines(lines, startIndex)) {
        const text = lines[index]!.text;
        if (STYLE_ATTR.test(text)) return { index, text: text.replace(STYLE_ATTR, attribute) };
      }

      // No style attribute yet: it goes on the opening tag, which is the stamped line.
      const opening = lines[startIndex]!.text;
      const tag = OPEN_TAG.exec(opening);
      if (!tag) return null;
      const insertAt = tag.index + tag[0].length;
      return {
        index: startIndex,
        text: opening.slice(0, insertAt) + attribute + opening.slice(insertAt),
      };
    }
  }
}

/**
 * The comment `verbose` adds above the element.
 *
 * A JSX comment is only valid where a child is, so it is skipped when the element opens
 * immediately after a `(` — a component's root element has no child position above it.
 * Adding a line there would be a syntax error rather than a line shift, and AC-5.4 wants
 * the shift.
 */
function commentAbove(lines: readonly SourceLine[], index: number): SourceLine | null {
  const target = lines[index];
  if (!target) return null;
  const previous = lines[index - 1]?.text.trimEnd() ?? '';
  if (previous === '' || previous.endsWith('(')) return null;
  const indent = /^\s*/.exec(target.text)?.[0] ?? '';
  return { text: `${indent}{/* edited by the visual editor */}`, terminator: target.terminator };
}

/**
 * The CI agent (AC-3.5): deterministic, in-process, no API key, no network.
 *
 * It writes through `ctx.fs` after asking `ctx.canUseTool`, exactly as the real
 * runner's tools will, so the guard and the blocked path are exercised by the
 * same code in CI as in production.
 */
export function createFakeAgent(options: FakeAgentOptions = {}): AgentRunner {
  const script = [...(options.script ?? [])];
  let cursor = 0;

  function nextMode(intent: EditIntent): FakeMode {
    const directive =
      DIRECTIVE.exec(intent.instruction)?.[1]?.toLowerCase() ??
      intent.after.classes
        .map((name) => DIRECTIVE.exec(name)?.[1]?.toLowerCase())
        .find((mode) => mode !== undefined);
    if (directive && isFakeMode(directive)) return directive;
    if (cursor < script.length) return script[cursor++]!;
    return options.mode ?? 'correct';
  }

  return {
    name: 'fake',
    requiresNetwork: false,

    async run(ctx: AgentContext): Promise<AgentOutcome> {
      const mode = nextMode(ctx.intent);
      ctx.report({ detail: `fake agent: ${mode}` });

      if (mode === 'blocked') {
        return blocked('the fake agent was scripted to refuse this edit');
      }
      if (mode === 'noop') {
        return { kind: 'noop', message: 'the fake agent was scripted to make no change' };
      }

      const permission = await ctx.canUseTool({
        tool: 'Edit',
        path: ctx.file,
        input: { file_path: ctx.file },
      });
      if (permission.behavior === 'deny') return blocked(permission.message);

      // Read fresh: the queue is serial precisely so this read sees the result
      // of every earlier write, and never a copy taken at enqueue time.
      const source = await ctx.fs.readFile(ctx.file);
      const lines = splitLines(source);
      const startIndex = ctx.loc.line - 1;
      if (!lines[startIndex]) {
        return blocked(`${ctx.intent.loc} is past the end of the file (${lines.length} lines)`);
      }

      const rewrite = planEdit(lines, ctx.intent, startIndex, mode);
      if (rewrite === null || rewrite.text === lines[rewrite.index]!.text) {
        return blocked(
          `the element at line ${ctx.loc.line} of ${ctx.intent.loc} is not what the intent described`,
        );
      }

      ctx.report({ phase: 'writing', tool: 'Edit', detail: `${ctx.intent.loc}` });
      lines[rewrite.index] = { ...lines[rewrite.index]!, text: rewrite.text };
      if (mode === 'verbose') {
        const comment = commentAbove(lines, startIndex);
        if (comment) lines.splice(startIndex, 0, comment);
      }
      await ctx.fs.writeFile(ctx.file, joinLines(lines));

      return { kind: 'edited', files: [ctx.file], message: 'DONE' };
    },
  };
}
