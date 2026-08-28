// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { ComputedSchema, SnapshotSchema, TRACKED_PROPS } from '@sve/protocol';
import { captureSnapshot } from '../src/snapshot.js';

afterEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body.firstElementChild as HTMLElement;
}

// AC-4.10
describe('captureSnapshot', () => {
  it('covers exactly TRACKED_PROPS and nothing else', () => {
    const el = mount('<h1 data-sve-eid="a">Swim today</h1>');
    const { computed } = captureSnapshot(el);
    expect(Object.keys(computed)).toEqual([...TRACKED_PROPS]);
  });

  it('produces a value @sve/protocol accepts, so nothing is renamed on the way to the wire', () => {
    const el = mount('<h1 class="title big" data-sve-eid="a">Swim today</h1>');
    const snapshot = captureSnapshot(el);
    expect(SnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(ComputedSchema.parse(snapshot.computed)).toEqual(snapshot.computed);
  });

  it('normalises the text, so JSX indentation does not read as a difference', () => {
    const el = mount('<h1 data-sve-eid="a">\n      Swim today\n    </h1>');
    expect(captureSnapshot(el).text).toBe('Swim today');
  });

  it('records the classes as a list, in document order', () => {
    const el = mount('<h1 class="text-5xl  font-bold" data-sve-eid="a">x</h1>');
    expect(captureSnapshot(el).classes).toEqual(['text-5xl', 'font-bold']);
    expect(captureSnapshot(mount('<h1 data-sve-eid="a">x</h1>')).classes).toEqual([]);
  });

  it('reads nested text content, not just the first text node', () => {
    const el = mount('<p data-sve-eid="a">Swim <em>today</em></p>');
    expect(captureSnapshot(el).text).toBe('Swim today');
  });

  // AC-4.10 — "resolved values ... not the source syntax". The override is a stylesheet
  // rule keyed on the eid; the snapshot must read what that rule resolves to, which is the
  // whole reason a Tailwind edit and an inline-style edit expressing the same change both
  // verify. jsdom does cascade a document stylesheet for simple properties, so this is a
  // real assertion; the Tailwind-equivalence half of the claim needs real computed styles
  // and is M6's Playwright job (AC-5.3).
  it('reads the value the injected override resolves to, not the element attribute', () => {
    document.head.innerHTML =
      '<style>.title { color: rgb(14, 17, 22) }</style>' +
      '<style>[data-sve-eid="a"] { color: rgb(59, 130, 246) !important }</style>';
    const el = mount('<h1 class="title" data-sve-eid="a">Swim today</h1>');
    expect(captureSnapshot(el).computed.color).toBe('rgb(59, 130, 246)');
  });

  it('returns a string for every tracked property, even ones the engine leaves blank', () => {
    const el = mount('<h1 data-sve-eid="a">x</h1>');
    const { computed } = captureSnapshot(el);
    for (const prop of TRACKED_PROPS) expect(typeof computed[prop]).toBe('string');
  });

  it('is a plain data value with no DOM references, so it can cross the wire', () => {
    const el = mount('<h1 class="title" data-sve-eid="a">Swim today</h1>');
    expect(() => structuredClone(captureSnapshot(el))).not.toThrow();
  });
});
