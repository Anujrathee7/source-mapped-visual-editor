/**
 * What a model is asked, and what is done with what comes back.
 *
 * Both live here rather than in either transport, because the part that matters is the
 * same for every provider: a reply is only a proposal if it names an element the page
 * actually offered and a change that resolves to something. A model that invents an eid
 * has produced a coordinate nothing corresponds to, and the refusal for that would
 * otherwise arrive from the bridge, three layers down, as "no element at Hero.tsx:3:5".
 *
 * The parser is deliberately tolerant about *shape* and strict about *content*. Small
 * models wrap JSON in prose and in fences; that is a formatting habit, not a wrong answer,
 * and refusing it would make the cheap providers unusable for no safety gain. Naming an
 * element that does not exist is a wrong answer, and is refused.
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
  type Proposal,
} from '../plan.js';

export const PLAN_SYSTEM_PROMPT = [
  'You turn one sentence from a designer into one concrete change to one element of a',
  'React page. You never write code and you never touch a file: what you produce is applied',
  'as a temporary DOM override, and a separate verified pipeline is what puts it in the',
  'source afterwards.',
  '',
  'Reply with exactly one JSON object and no other text. Its `eid` must be copied verbatim',
  'from the element list you are given — you may not invent one, and if none of them is what',
  'the request means, say so rather than choosing the nearest.',
  '',
  'One of these shapes:',
  '  {"eid": "<from the list>", "kind": "text", "text": "<the new text>"}',
  '  {"eid": "<from the list>", "kind": "class", "add": ["<class>"], "remove": ["<class>"]}',
  '  {"eid": "<from the list>", "kind": "style", "style": {"<property>": "<value>"}}',
  '  {"resolved": false, "say": "<what you need in order to answer>"}',
  '',
  'Style properties are camelCase DOM names — `color`, `backgroundColor`, `fontSize`.',
  'An element whose textKind is not "static" renders text from an expression: its words',
  'cannot be replaced, so answer with `resolved: false` and say that.',
].join('\n');

function describe(target: PlanTarget): string {
  return [
    `- eid: ${target.eid}`,
    `  at: ${target.loc}   <${target.tag}>${target.selected ? '   (selected)' : ''}`,
    `  text: ${JSON.stringify(target.text)}   textKind: ${target.textKind}`,
    `  class: ${JSON.stringify(target.classes.join(' '))}   classKind: ${target.classKind}`,
  ].join('\n');
}

export function planPrompt(request: PlanRequest): string {
  const elements =
    request.elements.length === 0
      ? '(none — the user has not selected anything yet)'
      : request.elements.map(describe).join('\n');
  return [
    'Elements you may name:',
    elements,
    '',
    `Request: ${request.message}`,
    '',
    'Answer with exactly one JSON object.',
  ].join('\n');
}

/** The first balanced `{…}` run in a reply. Fences and prose around it are ignored. */
function firstObject(reply: string): unknown {
  const start = reply.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < reply.length; i += 1) {
    const char = reply[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(reply.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function styleMap(value: unknown): Record<string, string> {
  if (value === null || typeof value !== 'object') return {};
  const style: Record<string, string> = {};
  for (const [prop, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string' && raw.trim() !== '') style[prop] = raw;
  }
  return style;
}

function overrideFor(
  kind: EditKind,
  answer: Record<string, unknown>,
): { override: Override; change: string } | null {
  if (kind === 'text') {
    const text = answer['text'];
    if (typeof text !== 'string') return null;
    return { override: { text }, change: `replace the text with “${text}”` };
  }

  if (kind === 'class') {
    const add = stringList(answer['add']);
    const remove = stringList(answer['remove']);
    if (add.length === 0 && remove.length === 0) return null;
    const parts = [
      ...(add.length > 0 ? [`add \`${add.join(' ')}\``] : []),
      ...(remove.length > 0 ? [`remove \`${remove.join(' ')}\``] : []),
    ];
    return { override: { classes: { add, remove } }, change: `on its className, ${parts.join(' and ')}` };
  }

  const style = styleMap(answer['style']);
  const entries = Object.entries(style);
  if (entries.length === 0) return null;
  return {
    override: { style },
    change: entries.map(([prop, value]) => `set \`${prop}\` to \`${value}\``).join(', '),
  };
}

const KINDS = new Set<EditKind>(['text', 'class', 'style']);

export function parsePlanReply(reply: string, request: PlanRequest): PlanResult {
  const parsed = firstObject(reply);
  if (parsed === null || typeof parsed !== 'object') {
    return { resolved: false, reply: UNRESOLVED_REPLY };
  }

  const answer = parsed as Record<string, unknown>;
  // The model's own refusal, in its own words: it usually knows what it needs.
  if (answer['resolved'] === false) {
    const say = answer['say'];
    return { resolved: false, reply: typeof say === 'string' && say !== '' ? say : UNRESOLVED_REPLY };
  }

  const eid = answer['eid'];
  if (typeof eid !== 'string' || eid === '') return { resolved: false, reply: UNRESOLVED_REPLY };

  const target = request.elements.find((element) => element.eid === eid);
  if (!target) return { resolved: false, reply: unknownTargetReply(eid) };

  const kind = answer['kind'];
  if (typeof kind !== 'string' || !KINDS.has(kind as EditKind)) {
    return { resolved: false, reply: UNRESOLVED_REPLY };
  }

  const change = overrideFor(kind as EditKind, answer);
  if (change === null) return { resolved: false, reply: UNRESOLVED_REPLY };

  const proposal: Proposal = {
    eid: target.eid,
    eidIndex: target.eidIndex,
    // The page's coordinate, not the model's: a loc it echoed could be stale or invented.
    loc: target.loc,
    tag: target.tag,
    kind: kind as EditKind,
    override: change.override,
  };
  return { resolved: true, reply: proposalReply(proposal, change.change), proposal };
}
