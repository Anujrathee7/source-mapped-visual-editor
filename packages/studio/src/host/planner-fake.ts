/**
 * The scripted planner — the CI path, and the one a reviewer can read the whole of.
 *
 * `SVE_AGENT=fake` exists because the verifier has to be testable without a key, and the
 * same argument applies one level up: AC-12.1 is asserted on a project's bytes, and a test
 * that needed a model to decide what to propose would be a test of the model. This is
 * deterministic, refuses more than it accepts, and — like the scripted agent — is able to
 * be wrong on demand, because a proposal naming an element the page does not offer is a
 * case the studio has to survive.
 *
 * No credential, no network, no Node imports: it runs on either side of the wire.
 */
import type { Override } from '@sve/overlay';
import type { EditKind } from '@sve/protocol';
import {
  UNRESOLVED_REPLY,
  proposalReply,
  unknownTargetReply,
  type PlanRequest,
  type PlanResult,
  type PlanTarget,
  type Planner,
  type Proposal,
} from '../plan.js';

/** `of the h1`, `on the section` — an explicit target, which is never second-guessed. */
const NAMED_TARGET = /\b(?:of|on|in)\s+the\s+([a-z][\w-]*)/i;
const QUOTED = /["“']([^"”']+)["”']/;
const ADD_CLASS = /\badd(?:\s+the)?\s+class(?:es)?\s+([^\s,.]+)/i;
const REMOVE_CLASS = /\bremove(?:\s+the)?\s+class(?:es)?\s+([^\s,.]+)/i;
const TEXT_WORD = /\b(text|copy|heading|headline|label|wording)\b/i;

/** The style words a person actually types, mapped onto `TrackedProp` names. */
const STYLE_WORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bbackground(?:[ -]colou?r)?\b/i, 'backgroundColor'],
  [/\bcolou?r\b/i, 'color'],
  [/\b(?:font[ -])?size\b/i, 'fontSize'],
];

function valueAfter(message: string, word: RegExp): string | null {
  const match = word.exec(message);
  if (!match) return null;
  const rest = message.slice(match.index + match[0].length);
  const value = /^\s*(?:to|:|=)?\s*([^\s,.;]+)/.exec(rest);
  return value?.[1] ?? null;
}

function resolveTarget(
  message: string,
  elements: readonly PlanTarget[],
): { target: PlanTarget } | { named: string } | null {
  const named = NAMED_TARGET.exec(message)?.[1];
  if (named !== undefined) {
    const wanted = named.toLowerCase();
    const match = elements.find((element) => element.tag.toLowerCase() === wanted);
    // An explicit target that is not on the page is refused, never quietly replaced with
    // the selection: the user named something, and being edited elsewhere is worse than
    // being told no.
    return match ? { target: match } : { named };
  }
  const selected = elements.find((element) => element.selected);
  return selected ? { target: selected } : null;
}

function changeFor(
  message: string,
  target: PlanTarget,
): { kind: EditKind; override: Override; change: string } | null {
  const quoted = QUOTED.exec(message)?.[1];
  if (quoted !== undefined && (TEXT_WORD.test(message) || /\bsay|reads?\b/i.test(message))) {
    return {
      kind: 'text',
      override: { text: quoted },
      change: `replace the text with “${quoted}”`,
    };
  }

  const added = ADD_CLASS.exec(message)?.[1];
  const removed = REMOVE_CLASS.exec(message)?.[1];
  if (added !== undefined || removed !== undefined) {
    const add = added === undefined ? [] : [added];
    const remove = removed === undefined ? [] : [removed];
    const parts = [
      ...(add.length > 0 ? [`add \`${add.join(' ')}\``] : []),
      ...(remove.length > 0 ? [`remove \`${remove.join(' ')}\``] : []),
    ];
    return { kind: 'class', override: { classes: { add, remove } }, change: `on its className, ${parts.join(' and ')}` };
  }

  for (const [word, prop] of STYLE_WORDS) {
    const value = valueAfter(message, word);
    if (value === null) continue;
    return {
      kind: 'style',
      override: { style: { [prop]: value } },
      change: `set \`${prop}\` to \`${value}\``,
    };
  }

  // A quoted string with no verb is still a text edit if the element renders text: a
  // person who typed `"Ship faster"` at a selected heading meant one thing.
  if (quoted !== undefined && target.textKind === 'static') {
    return { kind: 'text', override: { text: quoted }, change: `replace the text with “${quoted}”` };
  }

  return null;
}

export function createFakePlanner(): Planner {
  return {
    name: 'fake',

    async plan(request: PlanRequest): Promise<PlanResult> {
      const resolved = resolveTarget(request.message, request.elements);
      if (resolved === null) return { resolved: false, reply: UNRESOLVED_REPLY };
      if ('named' in resolved) {
        return { resolved: false, reply: unknownTargetReply(resolved.named) };
      }

      const { target } = resolved;
      const change = changeFor(request.message, target);
      if (change === null) return { resolved: false, reply: UNRESOLVED_REPLY };

      const proposal: Proposal = {
        eid: target.eid,
        eidIndex: target.eidIndex,
        loc: target.loc,
        tag: target.tag,
        kind: change.kind,
        override: change.override,
      };
      return { resolved: true, reply: proposalReply(proposal, change.change), proposal };
    },
  };
}
