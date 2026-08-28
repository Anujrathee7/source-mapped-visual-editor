/**
 * The CSS half of applying an override (AC-4.4).
 *
 * CLAUDE.md: "Styles and class removals go through one injected stylesheet keyed on
 * `[data-sve-eid]`." Nothing in this module writes to an element. That is the whole point:
 * a rule the element does not carry is a rule React cannot undo, so there is no mutation
 * war to lose and no attribute for a re-render to clobber.
 *
 * The DOM-mutating half — text and class additions, which CSS cannot express — lives in
 * `reassert.ts`, deliberately separate so this file's guarantee stays checkable by reading
 * it.
 */
import { ATTR_EID } from './attrs.js';
import type { Override, OverrideStore } from './store.js';

/** Marks the one `<style>` element the overlay injects into the page's document. */
export const OVERRIDE_STYLE_ATTR = 'data-sve-overrides';

/** A declaration map, already in CSS (kebab) property names. */
export type Declarations = Record<string, string>;

export type DeclarationEntry = readonly [eid: string, declarations: Declarations];

function kebab(prop: string): string {
  return prop.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/**
 * An attribute selector for one eid.
 *
 * An eid is `file#tag:n/tag:n/...`, so it is full of characters a class or id selector
 * would choke on. Inside a quoted attribute value only the quote and the backslash need
 * escaping, which is fortunate: `CSS.escape` is not available in every environment this
 * has to run in, jsdom included.
 */
export function eidSelector(eid: string): string {
  return `[${ATTR_EID}="${eid.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
}

const SAFE_PROPERTY = /^-{0,2}[a-z][a-z0-9-]*$/;

/** A value that could terminate its own declaration or rule is dropped, not escaped. */
function isSafeValue(value: string): boolean {
  return value !== '' && !/[{};<>]/.test(value) && !value.includes('\n');
}

/**
 * Turns one override into the declarations the stylesheet should carry for it.
 *
 * A removed class becomes the properties that class declared, set to `unset` — CSS has no
 * way to express "does not have this class", and resetting what it contributed is the
 * closest faithful equivalent. It is exact whenever no other author rule sets the same
 * property, which is precisely the utility-class case this exists for; where it is not,
 * the verifier catches the difference rather than the preview hiding it.
 *
 * An *added* class contributes nothing here. That is a DOM write, and it goes through
 * `reassert.ts`.
 */
export function declarationsFor(override: Override, removedProperties: readonly string[]): Declarations {
  const declarations: Declarations = {};
  for (const property of removedProperties) declarations[property] = 'unset';
  for (const [property, value] of Object.entries(override.style ?? {})) {
    declarations[kebab(property)] = value;
  }
  return declarations;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectRules(rules: CSSRuleList, into: CSSStyleRule[]): void {
  for (const rule of Array.from(rules)) {
    // A responsive utility lives inside a @media block, so grouping rules are descended
    // into rather than skipped.
    const grouping = rule as CSSRule & { cssRules?: CSSRuleList };
    if (grouping.cssRules) collectRules(grouping.cssRules, into);
    const style = rule as CSSStyleRule;
    if (typeof style.selectorText === 'string') into.push(style);
  }
}

/**
 * Every CSS property the given classes declare, across the page's stylesheets.
 *
 * Matching is on the class selector followed by something that is not a name character,
 * so removing `text-5xl` does not also reset whatever `.text-5xl-plus` declares.
 */
export function propertiesDeclaredByClasses(
  classes: readonly string[],
  sheets: Iterable<CSSStyleSheet>,
): string[] {
  if (classes.length === 0) return [];

  const rules: CSSStyleRule[] = [];
  for (const sheet of sheets) {
    try {
      collectRules(sheet.cssRules, rules);
    } catch {
      // A cross-origin stylesheet throws on cssRules access. Its utilities are invisible
      // to us, which shows up as an override that under-applies rather than as a crash.
    }
  }

  const properties: string[] = [];
  for (const className of classes) {
    const pattern = new RegExp(`\\.${escapeRegExp(className)}(?![\\w-])`);
    for (const rule of rules) {
      if (!pattern.test(rule.selectorText)) continue;
      for (const property of Array.from(rule.style)) {
        if (!properties.includes(property)) properties.push(property);
      }
    }
  }
  return properties;
}

/**
 * The whole stylesheet, regenerated from scratch on every store change.
 *
 * An entry with no declarations emits no rule at all, which is AC-4.3's "clearing the last
 * override removes the rule rather than leaving an empty one" — enforced here as well as
 * in the store, because an empty rule is not something this function should be able to
 * produce even if it is handed one.
 */
export function buildStylesheet(entries: Iterable<DeclarationEntry>): string {
  const rules: string[] = [];
  for (const [eid, declarations] of entries) {
    const body: string[] = [];
    for (const [property, value] of Object.entries(declarations)) {
      const name = kebab(property);
      if (!SAFE_PROPERTY.test(name) || !isSafeValue(value)) continue;
      // `!important` because the app's own rule is the thing being overridden, and the
      // override has to win without the overlay editing the element to raise specificity.
      body.push(`  ${name}: ${value} !important;`);
    }
    if (body.length === 0) continue;
    rules.push(`${eidSelector(eid)} {\n${body.join('\n')}\n}`);
  }
  return rules.join('\n\n');
}

export interface OverrideStyleSheet {
  readonly element: HTMLStyleElement;
  update(entries: Iterable<DeclarationEntry>): void;
  dispose(): void;
}

/**
 * The single `<style>` element, in the *page's* head rather than the overlay's shadow
 * root: it has to reach the elements under edit, which the shadow root by design cannot.
 * It is the only thing the overlay puts in the page's document, and every selector in it
 * is an eid attribute selector, so it cannot style anything the babel pass did not stamp.
 */
export function createOverrideStyleSheet(doc: Document): OverrideStyleSheet {
  // Adopting an element left behind by a crashed previous mount, rather than adding a
  // second one, is what makes mount-unmount-mount leave no duplicates (AC-4.1).
  const existing = doc.querySelector<HTMLStyleElement>(`style[${OVERRIDE_STYLE_ATTR}]`);
  const element = existing ?? doc.createElement('style');
  element.setAttribute(OVERRIDE_STYLE_ATTR, '');
  if (!element.isConnected) doc.head.append(element);

  return {
    element,
    update: (entries) => {
      element.textContent = buildStylesheet(entries);
    },
    dispose: () => {
      element.remove();
    },
  };
}

/**
 * Composes the store's entries into declarations, resolving each removed class against
 * the page's live stylesheets.
 */
export function declarationsForStore(store: OverrideStore, doc: Document): DeclarationEntry[] {
  return store.entries().map(([eid, override]) => {
    const removed = propertiesDeclaredByClasses(override.classes?.remove ?? [], doc.styleSheets);
    return [eid, declarationsFor(override, removed)] as const;
  });
}
