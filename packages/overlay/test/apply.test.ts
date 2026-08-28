// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  OVERRIDE_STYLE_ATTR,
  buildStylesheet,
  createOverrideStyleSheet,
  declarationsFor,
  eidSelector,
  propertiesDeclaredByClasses,
} from '../src/apply.js';
import { createOverrideStore } from '../src/store.js';
import { addPageStyle, mount, resetDocument, tick } from './support.js';

afterEach(resetDocument);

const EID = 'apps/demo/src/Hero.tsx#App/div:0/h1:0';

// AC-4.4
describe('eidSelector', () => {
  it('matches the element the babel pass stamped, punctuation and all', () => {
    const el = mount(`<h1 data-sve-eid="${EID}">Swim today</h1>`);
    expect(document.querySelector(eidSelector(EID))).toBe(el);
  });

  it('escapes a quote and a backslash rather than breaking out of the selector', () => {
    const hostile = 'a"b\\c';
    const el = mount('<h1>x</h1>');
    el.setAttribute('data-sve-eid', hostile);
    expect(() => document.querySelector(eidSelector(hostile))).not.toThrow();
    expect(document.querySelector(eidSelector(hostile))).toBe(el);
  });
});

// AC-4.4 / AC-4.3
describe('buildStylesheet', () => {
  it('emits one rule per eid, keyed on the attribute selector', () => {
    const css = buildStylesheet([[EID, { color: 'rgb(59, 130, 246)' }]]);
    addPageStyle(css);
    const rules = Array.from(document.styleSheets[0]!.cssRules) as CSSStyleRule[];
    expect(rules).toHaveLength(1);
    expect(rules[0]!.selectorText).toBe(eidSelector(EID));
    expect(rules[0]!.style.getPropertyValue('color')).toBe('rgb(59, 130, 246)');
  });

  it('marks every declaration important, so an app rule cannot outrank the override', () => {
    const css = buildStylesheet([[EID, { color: 'red' }]]);
    addPageStyle(css);
    const rule = document.styleSheets[0]!.cssRules[0] as CSSStyleRule;
    expect(rule.style.getPropertyPriority('color')).toBe('important');
  });

  it('accepts camelCase property names and emits CSS ones', () => {
    const css = buildStylesheet([[EID, { backgroundColor: 'red', borderRadius: '4px' }]]);
    expect(css).toContain('background-color: red');
    expect(css).toContain('border-radius: 4px');
    expect(css).not.toContain('backgroundColor');
  });

  it('emits nothing at all for an entry with no declarations', () => {
    expect(buildStylesheet([[EID, {}]])).toBe('');
    expect(buildStylesheet([])).toBe('');
  });

  it('drops a declaration whose value could close the rule it sits in', () => {
    const css = buildStylesheet([
      [EID, { color: 'red } body { display: none', backgroundColor: 'blue' }],
    ]);
    expect(css).not.toContain('display: none');
    expect(css).toContain('background-color: blue');
  });
});

// AC-4.4 — class *removals* cannot be expressed as "not having a class", so they are
// expressed as the declarations that class contributed, reset.
describe('propertiesDeclaredByClasses', () => {
  it('finds the properties a class rule declares', () => {
    addPageStyle('.text-5xl { font-size: 48px; line-height: 1 } .other { color: red }');
    expect(propertiesDeclaredByClasses(['text-5xl'], document.styleSheets)).toEqual([
      'font-size',
      'line-height',
    ]);
  });

  it('does not match a class whose name is a prefix of the rule it scans', () => {
    addPageStyle('.text-5xl-plus { font-size: 60px }');
    expect(propertiesDeclaredByClasses(['text-5xl'], document.styleSheets)).toEqual([]);
  });

  it('looks inside a media query, where a responsive utility actually lives', () => {
    addPageStyle('@media (min-width: 40rem) { .text-5xl { letter-spacing: 1px } }');
    expect(propertiesDeclaredByClasses(['text-5xl'], document.styleSheets)).toEqual([
      'letter-spacing',
    ]);
  });

  it('reports each property once across several classes', () => {
    addPageStyle('.a { color: red } .b { color: blue; opacity: 0.5 }');
    expect(propertiesDeclaredByClasses(['a', 'b'], document.styleSheets)).toEqual([
      'color',
      'opacity',
    ]);
  });

  it('returns nothing rather than throwing for an unknown class', () => {
    addPageStyle('.a { color: red }');
    expect(propertiesDeclaredByClasses(['nope'], document.styleSheets)).toEqual([]);
    expect(propertiesDeclaredByClasses([], document.styleSheets)).toEqual([]);
  });
});

// AC-4.4
describe('declarationsFor', () => {
  it('turns a removed class into its properties, reset', () => {
    expect(declarationsFor({ classes: { add: [], remove: ['big'] } }, ['font-size'])).toEqual({
      'font-size': 'unset',
    });
  });

  it('lets an explicit style win over a reset from the same edit', () => {
    expect(
      declarationsFor({ classes: { add: [], remove: ['big'] }, style: { fontSize: '2rem' } }, [
        'font-size',
      ]),
    ).toEqual({ 'font-size': '2rem' });
  });

  it('contributes nothing for a text-only override', () => {
    expect(declarationsFor({ text: 'Swim today' }, [])).toEqual({});
  });

  it('contributes nothing for an added class — that is a DOM write, not a CSS one', () => {
    expect(declarationsFor({ classes: { add: ['text-6xl'], remove: [] } }, [])).toEqual({});
  });
});

// AC-4.1 / AC-4.3 / AC-4.4
describe('the injected stylesheet', () => {
  it('is a single style element in the document head', () => {
    const sheet = createOverrideStyleSheet(document);
    expect(sheet.element.parentElement).toBe(document.head);
    expect(document.querySelectorAll(`style[${OVERRIDE_STYLE_ATTR}]`)).toHaveLength(1);
    sheet.dispose();
  });

  it('adopts an element left behind by a previous mount instead of adding a second', () => {
    const first = createOverrideStyleSheet(document);
    const second = createOverrideStyleSheet(document);
    expect(document.querySelectorAll(`style[${OVERRIDE_STYLE_ATTR}]`)).toHaveLength(1);
    expect(second.element).toBe(first.element);
    second.dispose();
  });

  it('leaves no rule behind when the last override is cleared', () => {
    const sheet = createOverrideStyleSheet(document);
    sheet.update([[EID, { color: 'red' }]]);
    expect(sheet.element.sheet!.cssRules).toHaveLength(1);

    sheet.update([]);
    expect(sheet.element.sheet!.cssRules).toHaveLength(0);
    expect(sheet.element.textContent).toBe('');
    sheet.dispose();
  });

  it('is removed from the document on dispose', () => {
    const sheet = createOverrideStyleSheet(document);
    sheet.dispose();
    expect(document.querySelectorAll(`style[${OVERRIDE_STYLE_ATTR}]`)).toHaveLength(0);
  });

  it('only ever targets stamped elements, so it cannot style the page at large', () => {
    const sheet = createOverrideStyleSheet(document);
    sheet.update([
      [EID, { color: 'red' }],
      ['other', { opacity: '0.5' }],
    ]);
    for (const rule of Array.from(sheet.element.sheet!.cssRules) as CSSStyleRule[]) {
      expect(rule.selectorText.startsWith('[data-sve-eid=')).toBe(true);
    }
    sheet.dispose();
  });
});

// AC-4.4 — the criterion, asserted directly: "apply a style override, force a React
// re-render of the target, and confirm (a) the override still renders, and (b)
// MutationObserver recorded no mutation on the target's attributes from the overlay."
//
// jsdom cascades a document stylesheet for simple properties, which is what makes (a) a
// real assertion here. What jsdom cannot do is compute a Tailwind class, so the
// class-removal half of the same mechanism is asserted through the generated CSS above and
// through real computed styles in M6's Playwright suite (AC-5.3).
describe('a style override survives a re-render without touching the element', () => {
  it('still renders, and records no attribute mutation from the overlay', async () => {
    addPageStyle('.title { color: rgb(14, 17, 22) }');
    const el = mount(`<h1 class="title" data-sve-eid="${EID}">Swim today</h1>`);

    const records: MutationRecord[] = [];
    const observer = new MutationObserver((entries) => records.push(...entries));
    observer.observe(el, { attributes: true, attributeOldValue: true });

    const store = createOverrideStore();
    const sheet = createOverrideStyleSheet(document);
    store.subscribe(() => {
      sheet.update(store.entries().map(([eid, o]) => [eid, declarationsFor(o, [])] as const));
    });
    store.set(EID, { style: { color: 'rgb(59, 130, 246)' } });
    await tick();

    expect(getComputedStyle(el).color).toBe('rgb(59, 130, 246)');
    expect(records).toEqual([]);
    expect(el.getAttribute('style')).toBeNull();
    expect(el.className).toBe('title');

    // What a React re-render does to this element: same className written back, children
    // replaced. Neither can undo a rule the element does not carry.
    el.className = 'title';
    el.replaceChildren(document.createTextNode('Swim today'));
    await tick();

    expect(getComputedStyle(el).color).toBe('rgb(59, 130, 246)');
    expect(records.filter((record) => record.attributeName === 'style')).toEqual([]);

    observer.disconnect();
    sheet.dispose();
  });

  it('applies to every element sharing the eid, which is the blast radius of the source edit', async () => {
    document.body.innerHTML = Array.from(
      { length: 6 },
      (_, index) => `<article data-sve-eid="${EID}">card ${index}</article>`,
    ).join('');

    const sheet = createOverrideStyleSheet(document);
    sheet.update([[EID, { color: 'rgb(59, 130, 246)' }]]);
    await tick();

    const cards = document.querySelectorAll('article');
    expect(cards).toHaveLength(6);
    for (const card of cards) expect(getComputedStyle(card).color).toBe('rgb(59, 130, 246)');
    sheet.dispose();
  });
});
