/**
 * Selection (AC-4.2).
 *
 * A selection is an `Anchor` — plain data read off the stamps — and never an element.
 * Elements do not survive a React re-render, let alone HMR; `eid` plus `eidIndex` does,
 * which is also exactly what M6 re-anchors through after the agent's write moves every
 * line below it (AC-5.4).
 */
import { eidSelector } from './apply.js';
import {
  ATTR_CLASS,
  ATTR_EID,
  ATTR_LOC,
  ATTR_TEXT,
  readClassKind,
  readTextKind,
  type ClassKind,
  type TextKind,
} from './attrs.js';

export interface Anchor {
  eid: string;
  /** Which of the N nodes sharing this eid this is. A mapped list shares one (AC-4.6). */
  eidIndex: number;
  /** Exactly as stamped, valid only until the next write to this file. */
  loc: string;
  tag: string;
  textKind: TextKind;
  classKind: ClassKind;
  /** How many elements render from this line. The blast radius the inspector states. */
  count: number;
}

/**
 * The stamped element a pointer or focus event should be understood as targeting.
 *
 * Events land on text nodes and on unstamped wrappers, so this walks up. It stops
 * unconditionally inside the overlay's own host: the chrome is never a target (AC-4.2),
 * and an event from inside a shadow root retargets to the host anyway.
 */
export function stampedAncestor(node: Node | null, hostEl: Element | null): HTMLElement | null {
  if (!node) return null;
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (!el) return null;
  if (hostEl && (el === hostEl || hostEl.contains(el))) return null;
  return el.closest<HTMLElement>(`[${ATTR_EID}]`);
}

export function anchorFor(el: Element, doc: Document): Anchor | null {
  const eid = el.getAttribute(ATTR_EID);
  if (eid === null) return null;

  const instances = Array.from(doc.querySelectorAll(eidSelector(eid)));
  const eidIndex = instances.indexOf(el);
  if (eidIndex < 0) return null;

  return {
    eid,
    eidIndex,
    loc: el.getAttribute(ATTR_LOC) ?? '',
    tag: el.tagName.toLowerCase(),
    // A hand-edited or missing stamp reads as the most restrictive kind. The DOM is
    // untrusted input too, and over-trusting it here disables nothing but enables an edit
    // the agent cannot make.
    textKind: readTextKind(el.getAttribute(ATTR_TEXT)),
    classKind: readClassKind(el.getAttribute(ATTR_CLASS)),
    count: instances.length,
  };
}

/** The re-anchor step of the verification loop (AC-5, step 2). */
export function resolveAnchor(eid: string, eidIndex: number, doc: Document): HTMLElement | null {
  return doc.querySelectorAll<HTMLElement>(eidSelector(eid))[eidIndex] ?? null;
}

/* ── keyboard navigation ──────────────────────────────────────────────────── */

/**
 * AC-4.2 asks for selection to be keyboard reachable. Tab only reaches focusable elements,
 * and a heading is not one, so the tree is walked directly: up to the enclosing stamped
 * element, down to the first stamped descendant, sideways through stamped siblings.
 */
export type SelectionMove = 'up' | 'down' | 'previous' | 'next';

function stampedDescendants(el: Element): HTMLElement[] {
  return Array.from(el.querySelectorAll<HTMLElement>(`[${ATTR_EID}]`)).filter(
    (candidate) => candidate.parentElement?.closest(`[${ATTR_EID}]`) === el,
  );
}

export function moveSelection(el: HTMLElement, move: SelectionMove): HTMLElement | null {
  if (move === 'up') return el.parentElement?.closest<HTMLElement>(`[${ATTR_EID}]`) ?? null;
  if (move === 'down') return stampedDescendants(el)[0] ?? null;

  const parent = el.parentElement?.closest<HTMLElement>(`[${ATTR_EID}]`);
  const siblings = parent
    ? stampedDescendants(parent)
    : Array.from(el.ownerDocument.querySelectorAll<HTMLElement>(`[${ATTR_EID}]`)).filter(
        (candidate) => candidate.parentElement?.closest(`[${ATTR_EID}]`) === null,
      );
  const index = siblings.indexOf(el);
  if (index < 0) return null;
  return siblings[index + (move === 'next' ? 1 : -1)] ?? null;
}

/* ── highlight ────────────────────────────────────────────────────────────── */

export interface Highlight {
  readonly element: HTMLElement;
  show(el: Element): void;
  hide(): void;
}

/**
 * A separate positioned element, aligned to the target's border box.
 *
 * AC-4.2: "the target's own styles are never touched to indicate hover". Nothing here
 * writes to the target, and the box lives in the overlay's shadow root rather than inside
 * the element, so a re-render of the page cannot remove it either.
 */
export function createHighlight(
  parent: ParentNode & Node,
  variant: 'hover' | 'selected',
): Highlight {
  const element = (parent.ownerDocument ?? (parent as unknown as Document)).createElement('div');
  element.className = `sve-highlight sve-highlight--${variant}`;
  element.hidden = true;
  parent.append(element);

  return {
    element,
    show: (target) => {
      const rect = target.getBoundingClientRect();
      element.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
      element.style.width = `${rect.width}px`;
      element.style.height = `${rect.height}px`;
      element.hidden = false;
    },
    hide: () => {
      element.hidden = true;
    },
  };
}
