/**
 * What a chat message has to become before anything can happen to it.
 *
 * AC-12.1: a click produces an exact element and a resolved change, which is what makes a
 * verdict possible; "make the hero tighter" produces neither. So the planner's whole job is
 * to turn a sentence into a `Proposal` — an eid, a loc, and a concrete override — or to say
 * that it could not. There is no third answer, and in particular there is no answer that
 * writes a file: a proposal is an override, and an override is an illusion.
 *
 * Browser-safe by construction. The implementations live on the host side, because that is
 * where credentials are held, but the shapes are shared and nothing here imports Node.
 */
import type { ClassKind, Override, TextKind } from '@sve/overlay';
import type { EditKind } from '@sve/protocol';

/**
 * An element the planner is allowed to name.
 *
 * The list is closed on purpose. A model that may invent an eid is a model that can send
 * the bridge a coordinate nothing on the page corresponds to, and the refusal for that
 * arrives three layers down as "no element at src/Hero.tsx:3:5". Naming from a list turns
 * the same mistake into a sentence, before anything is written.
 */
export interface PlanTarget {
  eid: string;
  eidIndex: number;
  loc: string;
  tag: string;
  /** What the element renders right now. */
  text: string;
  classes: string[];
  textKind: TextKind;
  classKind: ClassKind;
  /** Whether this is the element the user is looking at — what a pronoun refers to. */
  selected: boolean;
}

export interface PlanRequest {
  message: string;
  elements: PlanTarget[];
}

export interface Proposal {
  eid: string;
  eidIndex: number;
  loc: string;
  tag: string;
  kind: EditKind;
  /** The change, as the overlay will paint it. Nothing is written to produce this. */
  override: Override;
}

export type PlanResult =
  | { resolved: true; reply: string; proposal: Proposal }
  | { resolved: false; reply: string };

export interface Planner {
  readonly name: string;
  plan(request: PlanRequest): Promise<PlanResult>;
}

/** Said when a message names no element, or no change, or neither. */
export const UNRESOLVED_REPLY =
  'I could not resolve that to one element and one concrete change. Click the element you ' +
  'mean, then say what to change — its text, a class, or a style value.';

/** Said when a message names an element the page is not offering. */
export function unknownTargetReply(named: string): string {
  return (
    `Nothing on this page is a \`${named}\`, so there is no element to change and no ` +
    'coordinate to send. Click the one element you mean and say it again.'
  );
}

/** Said when a proposal is on the page. The last clause is the whole of AC-12.1. */
export function proposalReply(proposal: Proposal, change: string): string {
  return (
    `\`<${proposal.tag}>\` at ${proposal.loc} — ${change}. It is on the page as an override; ` +
    'nothing is written until you press Apply.'
  );
}
