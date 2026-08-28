import { TRACKED_PROPS, type Computed, type EditIntent, type TrackedProp } from '@sve/protocol';
import { joinLines, splitLines } from '../source.js';
import { blocked, type AgentContext, type AgentOutcome, type AgentRunner } from './types.js';

export const FAKE_MODES = ['correct', 'wrong', 'blocked', 'noop'] as const;
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

export interface FakeAgentOptions {
  mode?: FakeMode;
  /** Consumed one entry per run, in order; falls back to `mode` once exhausted. */
  script?: readonly FakeMode[];
}

const CLASS_ATTR = /className="([^"]*)"/;
const STYLE_ATTR = /\sstyle=\{\{[^}]*\}\}/;
const OPEN_TAG = /<([A-Za-z][\w.:-]*)/;

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

function changedComputed(before: Computed, after: Computed): [TrackedProp, string][] {
  const changed: [TrackedProp, string][] = [];
  for (const prop of TRACKED_PROPS as readonly TrackedProp[]) {
    const next = after[prop];
    if (next !== undefined && next !== before[prop]) changed.push([prop, next]);
  }
  return changed;
}

/**
 * Rewrites the target line, or returns null when the line is not what the
 * intent described. Returning null is what makes the fake honest: it is told a
 * line, and if that line does not hold what it was told, it refuses rather than
 * editing something plausible nearby.
 */
function editLine(line: string, intent: EditIntent, corrupt: boolean): string | null {
  switch (intent.kind) {
    case 'text': {
      const before = intent.before.text;
      if (before.length === 0 || !line.includes(before)) return null;
      const after = corrupt ? mangleText(intent.after.text) : intent.after.text;
      return line.replace(before, after);
    }

    case 'class': {
      const match = CLASS_ATTR.exec(line);
      if (!match) return null;
      const expected = intent.before.classes.join(' ');
      if (expected.length > 0 && match[1] !== expected) return null;
      const next = (corrupt ? mangleClasses(intent.after.classes) : intent.after.classes).join(' ');
      return line.slice(0, match.index) + `className="${next}"` + line.slice(match.index + match[0].length);
    }

    case 'style': {
      const changed = changedComputed(intent.before.computed, intent.after.computed);
      if (changed.length === 0) return null;
      const declarations = changed
        .map(([prop, value], index) => `${prop}: '${corrupt && index === 0 ? mangleStyleValue(value) : value}'`)
        .join(', ');
      const attribute = ` style={{ ${declarations} }}`;

      if (STYLE_ATTR.test(line)) return line.replace(STYLE_ATTR, attribute);

      const tag = OPEN_TAG.exec(line);
      if (!tag) return null;
      const insertAt = tag.index + tag[0].length;
      return line.slice(0, insertAt) + attribute + line.slice(insertAt);
    }
  }
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
    const directive = DIRECTIVE.exec(intent.instruction)?.[1]?.toLowerCase();
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
      const target = lines[ctx.loc.line - 1];
      if (!target) {
        return blocked(`${ctx.intent.loc} is past the end of the file (${lines.length} lines)`);
      }

      const rewritten = editLine(target.text, ctx.intent, mode === 'wrong');
      if (rewritten === null || rewritten === target.text) {
        return blocked(`line ${ctx.loc.line} of ${ctx.intent.loc} is not what the intent described`);
      }

      ctx.report({ phase: 'writing', tool: 'Edit', detail: `${ctx.intent.loc}` });
      lines[ctx.loc.line - 1] = { ...target, text: rewritten };
      await ctx.fs.writeFile(ctx.file, joinLines(lines));

      return { kind: 'edited', files: [ctx.file], message: 'DONE' };
    },
  };
}
