// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createReasserter } from '../src/reassert.js';
import { mount, rerenderText, resetDocument, tick } from './support.js';

afterEach(resetDocument);

const EID = 'apps/demo/src/Hero.tsx#App/div:0/h1:0';

// AC-4.5 — text and class *additions* cannot be expressed in CSS, so they mutate the DOM
// and have to survive React writing over them.
describe('text is re-asserted after a re-render replaces it', () => {
  it('re-applies the override text', async () => {
    const el = mount(`<h1 data-sve-eid="${EID}">Swim today</h1>`);
    const reasserter = createReasserter(document);
    reasserter.apply([[EID, { text: 'Ship faster' }]]);
    expect(el.textContent).toBe('Ship faster');

    rerenderText(el, 'Swim today');
    await tick();
    expect(el.textContent).toBe('Ship faster');

    reasserter.dispose();
  });

  it('re-applies after the element is rebuilt from scratch, as HMR rebuilds it', async () => {
    mount(`<h1 data-sve-eid="${EID}">Swim today</h1>`);
    const reasserter = createReasserter(document);
    reasserter.apply([[EID, { text: 'Ship faster' }]]);

    document.body.innerHTML = `<h1 data-sve-eid="${EID}">Swim today</h1>`;
    await tick();
    expect(document.querySelector('h1')!.textContent).toBe('Ship faster');

    reasserter.dispose();
  });

  it('re-applies to every element sharing the eid', async () => {
    document.body.innerHTML = Array.from(
      { length: 3 },
      () => `<article data-sve-eid="${EID}">card</article>`,
    ).join('');
    const reasserter = createReasserter(document);
    reasserter.apply([[EID, { text: 'edited' }]]);

    for (const el of document.querySelectorAll('article')) rerenderText(el, 'card');
    await tick();
    for (const el of document.querySelectorAll('article')) expect(el.textContent).toBe('edited');

    reasserter.dispose();
  });
});

// AC-4.5 — "The re-assertion is guarded by an `isReasserting` flag so the observer does not
// observe its own writes and loop. Assert the guard by counting observer callbacks:
// applying one override must settle, not oscillate."
describe('the isReasserting guard', () => {
  it('does not observe its own write', async () => {
    const el = mount(`<h1 data-sve-eid="${EID}">Swim today</h1>`);
    const reasserter = createReasserter(document);

    reasserter.apply([[EID, { text: 'Ship faster' }]]);
    await tick();
    await tick();

    expect(el.textContent).toBe('Ship faster');
    expect(reasserter.observations).toBe(0);
    reasserter.dispose();
  });

  it('settles after one external write instead of oscillating', async () => {
    const el = mount(`<h1 data-sve-eid="${EID}">Swim today</h1>`);
    const reasserter = createReasserter(document);
    reasserter.apply([[EID, { text: 'Ship faster' }]]);
    await tick();

    rerenderText(el, 'Swim today');
    await tick();
    expect(reasserter.observations).toBe(1);
    expect(el.textContent).toBe('Ship faster');

    await tick();
    await tick();
    await tick();
    expect(reasserter.observations).toBe(1);
    expect(el.textContent).toBe('Ship faster');

    reasserter.dispose();
  });

  it('reports the flag as clear outside a re-assertion', () => {
    const reasserter = createReasserter(document);
    expect(reasserter.isReasserting).toBe(false);
    reasserter.dispose();
  });
});

// AC-4.5 — "Clearing a text override restores the text React last rendered, not a stale
// value captured at selection time."
describe('lifting a text override', () => {
  it('restores what React rendered most recently, not what was there at selection', async () => {
    const el = mount(`<h1 data-sve-eid="${EID}">v1</h1>`);
    const reasserter = createReasserter(document);
    reasserter.apply([[EID, { text: 'override' }]]);
    expect(el.textContent).toBe('override');

    rerenderText(el, 'v2');
    await tick();
    expect(el.textContent).toBe('override');

    reasserter.apply([]);
    expect(el.textContent).toBe('v2');
    reasserter.dispose();
  });

  it('restores the original when React never re-rendered', () => {
    const el = mount(`<h1 data-sve-eid="${EID}">v1</h1>`);
    const reasserter = createReasserter(document);
    reasserter.apply([[EID, { text: 'override' }]]);
    reasserter.apply([]);
    expect(el.textContent).toBe('v1');
    reasserter.dispose();
  });

  it('stops re-asserting, so a later re-render is left alone', async () => {
    const el = mount(`<h1 data-sve-eid="${EID}">v1</h1>`);
    const reasserter = createReasserter(document);
    reasserter.apply([[EID, { text: 'override' }]]);
    reasserter.apply([]);

    rerenderText(el, 'v3');
    await tick();
    expect(el.textContent).toBe('v3');
    reasserter.dispose();
  });

  // AC-5.1 asserts "no re-assertion observer is still active for it" once the override is
  // lifted. Making the observer's connection track the override set is what gives M6
  // something it can actually observe.
  it('disconnects the observer entirely once nothing is overridden', () => {
    const reasserter = createReasserter(document);
    expect(reasserter.active).toBe(false);
    reasserter.apply([[EID, { text: 'x' }]]);
    expect(reasserter.active).toBe(true);
    reasserter.apply([]);
    expect(reasserter.active).toBe(false);
    reasserter.dispose();
  });
});

// AC-4.5 — class additions take the same path as text, for the same reason.
describe('class additions are re-asserted', () => {
  it('re-adds a class React stripped', async () => {
    const el = mount(`<h1 class="title" data-sve-eid="${EID}">x</h1>`);
    const reasserter = createReasserter(document);
    reasserter.apply([[EID, { classes: { add: ['text-6xl'], remove: [] } }]]);
    expect(el.className).toBe('title text-6xl');

    el.className = 'title';
    await tick();
    expect(el.classList.contains('text-6xl')).toBe(true);

    reasserter.dispose();
  });

  it('removes only the classes it added when the override is lifted', () => {
    const el = mount(`<h1 class="title text-6xl" data-sve-eid="${EID}">x</h1>`);
    const reasserter = createReasserter(document);
    reasserter.apply([[EID, { classes: { add: ['text-6xl', 'font-bold'], remove: [] } }]]);
    reasserter.apply([]);

    // `text-6xl` was already the app's; only `font-bold` was the overlay's to take back.
    expect(el.className).toBe('title text-6xl');
    reasserter.dispose();
  });
});

// AC-4.1 — "Unmounting removes ... every observer and listener it registered."
describe('dispose', () => {
  it('restores the DOM and stops observing', async () => {
    const el = mount(`<h1 data-sve-eid="${EID}">v1</h1>`);
    const reasserter = createReasserter(document);
    reasserter.apply([[EID, { text: 'override' }]]);
    reasserter.dispose();

    expect(el.textContent).toBe('v1');
    rerenderText(el, 'v4');
    await tick();
    expect(el.textContent).toBe('v4');
    expect(reasserter.active).toBe(false);
  });

  it('is safe to call twice', () => {
    const reasserter = createReasserter(document);
    reasserter.dispose();
    expect(() => reasserter.dispose()).not.toThrow();
  });
});
