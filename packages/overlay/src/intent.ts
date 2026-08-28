/**
 * Turning an override into an `EditIntent` (AC-4.10).
 *
 * This is where this milestone ends. The intent is handed to whoever subscribed; sending
 * it, waiting for HMR, lifting the override and comparing the result are M6's (AC-5).
 */
import {
  EditIntentSchema,
  MAX_INSTRUCTION_LENGTH,
  type EditIntent,
  type EditKind,
  type Snapshot,
} from '@sve/protocol';
import type { Anchor } from './selection.js';
import type { Override } from './store.js';

/**
 * Which kind of edit an override represents.
 *
 * Text first: it is the only facet whose change the agent must express as a string literal
 * in the markup, so when an override carries several it is the one that constrains where
 * the write can land.
 */
export function inferKind(override: Override): EditKind | null {
  if (override.text !== undefined) return 'text';
  if (override.classes && (override.classes.add.length > 0 || override.classes.remove.length > 0)) {
    return 'class';
  }
  if (override.style && Object.keys(override.style).length > 0) return 'style';
  return null;
}

function list(values: readonly string[]): string {
  return values.map((value) => `\`${value}\``).join(', ');
}

/**
 * The change, in one sentence, in resolved terms.
 *
 * It is pasted verbatim into an agent prompt, so it names the coordinate rather than
 * describing where to look, and it quotes *computed* values rather than whatever the user
 * typed into the style panel — the agent is free to reach `rgb(59, 130, 246)` with a
 * Tailwind class, and the verifier compares on that value either way.
 */
export function describeEdit(
  anchor: Anchor,
  kind: EditKind,
  override: Override,
  after: Snapshot,
): string {
  const where = `\`<${anchor.tag}>\` at ${anchor.loc}`;
  let sentence: string;

  if (kind === 'text') {
    sentence = `Replace the text content of ${where} with "${after.text}".`;
  } else if (kind === 'class') {
    const parts: string[] = [];
    if (override.classes && override.classes.add.length > 0) {
      parts.push(`add ${list(override.classes.add)}`);
    }
    if (override.classes && override.classes.remove.length > 0) {
      parts.push(`remove ${list(override.classes.remove)}`);
    }
    sentence = `On the className of ${where}, ${parts.join(' and ')}.`;
  } else {
    const declared = Object.keys(override.style ?? {});
    const resolved = declared.map((prop) => {
      const value = (after.computed as Record<string, string | undefined>)[prop];
      return `${prop} renders as \`${value ?? ''}\``;
    });
    sentence = `Change ${where} so that ${resolved.join(', ')}.`;
  }

  if (anchor.count > 1) {
    sentence += ` ${anchor.count} elements render from this line; the change applies to all of them.`;
  }

  // Bounded because @sve/protocol bounds it — an over-long instruction is a rejected
  // message at the bridge, not a truncated prompt, so it is cut here where the reason is
  // visible.
  return sentence.length > MAX_INSTRUCTION_LENGTH
    ? `${sentence.slice(0, MAX_INSTRUCTION_LENGTH - 1)}…`
    : sentence;
}

export interface IntentInput {
  anchor: Anchor;
  kind: EditKind;
  /** The page as it stood with the override lifted. */
  before: Snapshot;
  /** The page with the override applied. This is the intent (AC-4.10). */
  after: Snapshot;
  override: Override;
}

/**
 * Parsed through the protocol schema on the way out. The browser is untrusted input at the
 * bridge; building something the bridge would reject is a bug worth failing here, next to
 * the code that made it, rather than three packages away.
 */
export function buildIntent(input: IntentInput): EditIntent {
  const { anchor, kind, before, after, override } = input;
  return EditIntentSchema.parse({
    eid: anchor.eid,
    eidIndex: anchor.eidIndex,
    loc: anchor.loc,
    tag: anchor.tag,
    kind,
    before,
    after,
    instruction: describeEdit(anchor, kind, override, after),
  });
}
