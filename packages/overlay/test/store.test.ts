import { describe, expect, it, vi } from 'vitest';
import { createOverrideStore, isEmptyOverride } from '../src/store.js';

// AC-4.3 — "The store holds no DOM references, so it survives HMR replacing every node on
// the page." Asserted structurally, in the node environment, where there is no DOM to
// accidentally capture.
describe('the store is plain data', () => {
  it('runs without a DOM at all', () => {
    expect(typeof document).toBe('undefined');
  });

  it('holds nothing structuredClone cannot copy', () => {
    const store = createOverrideStore();
    store.set('a', { text: 'Swim today', classes: { add: ['x'], remove: ['y'] }, style: { color: 'red' } });
    expect(() => structuredClone(store.entries())).not.toThrow();
    expect(structuredClone(store.entries())).toEqual(store.entries());
  });

  it('keys by eid, which is what survives the agent shifting every line', () => {
    const store = createOverrideStore();
    store.set('src/Hero.tsx#App/div:0/h1:0', { text: 'x' });
    expect(store.get('src/Hero.tsx#App/div:0/h1:0')).toEqual({ text: 'x' });
    expect(store.get('src/Hero.tsx#App/div:0/h1:1')).toBeUndefined();
  });
});

// AC-4.3
describe('notification is exactly once per change', () => {
  it('notifies once on set', () => {
    const store = createOverrideStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.set('a', { text: 'x' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('notifies once on clear', () => {
    const store = createOverrideStore();
    store.set('a', { text: 'x' });
    const listener = vi.fn();
    store.subscribe(listener);
    store.clear('a');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not notify on a read', () => {
    const store = createOverrideStore();
    store.set('a', { text: 'x' });
    const listener = vi.fn();
    store.subscribe(listener);
    store.get('a');
    store.has('a');
    store.entries();
    expect(listener).not.toHaveBeenCalled();
  });

  it('does not notify when setting a value equal to the one already stored', () => {
    const store = createOverrideStore();
    store.set('a', { style: { color: 'red' } });
    const listener = vi.fn();
    store.subscribe(listener);
    store.set('a', { style: { color: 'red' } });
    expect(listener).not.toHaveBeenCalled();
  });

  it('does not notify when clearing an eid it never held', () => {
    const store = createOverrideStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.clear('nothing-here');
    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies every subscriber once, and stops after unsubscribe', () => {
    const store = createOverrideStore();
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribe = store.subscribe(first);
    store.subscribe(second);

    store.set('a', { text: 'x' });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.set('a', { text: 'y' });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it('notifies once for clearAll, not once per entry', () => {
    const store = createOverrideStore();
    store.set('a', { text: 'x' });
    store.set('b', { text: 'y' });
    const listener = vi.fn();
    store.subscribe(listener);
    store.clearAll();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.size).toBe(0);
  });

  it('does not notify for a clearAll with nothing to clear', () => {
    const store = createOverrideStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.clearAll();
    expect(listener).not.toHaveBeenCalled();
  });
});

// AC-4.3 — "Clearing the last override removes the injected stylesheet's rule rather than
// leaving an empty one." The store makes an empty rule unrepresentable rather than leaving
// the stylesheet to filter one out later.
describe('an override with nothing in it is not an override', () => {
  it.each([
    ['a bare object', {}],
    ['empty class lists', { classes: { add: [], remove: [] } }],
    ['an empty style map', { style: {} }],
    ['all three empty', { classes: { add: [], remove: [] }, style: {} }],
  ])('%s is empty', (_label, override) => {
    expect(isEmptyOverride(override)).toBe(true);
  });

  it.each([
    ['empty text, which is a real edit', { text: '' }],
    ['one added class', { classes: { add: ['x'], remove: [] } }],
    ['one removed class', { classes: { add: [], remove: ['x'] } }],
    ['one declaration', { style: { color: 'red' } }],
  ])('%s is not empty', (_label, override) => {
    expect(isEmptyOverride(override)).toBe(false);
  });

  it('drops the entry rather than storing an empty one', () => {
    const store = createOverrideStore();
    store.set('a', { text: 'x' });
    store.set('a', { classes: { add: [], remove: [] } });
    expect(store.has('a')).toBe(false);
    expect(store.size).toBe(0);
  });

  it('notifies once when an emptied override drops out', () => {
    const store = createOverrideStore();
    store.set('a', { text: 'x' });
    const listener = vi.fn();
    store.subscribe(listener);
    store.set('a', {});
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

// AC-4.3 — the inspector edits one facet at a time; a text edit must not discard the style
// override sitting beside it.
describe('patch merges one facet without disturbing the others', () => {
  it('keeps the untouched facets', () => {
    const store = createOverrideStore();
    store.set('a', { style: { color: 'red' } });
    store.patch('a', { text: 'Swim today' });
    expect(store.get('a')).toEqual({ text: 'Swim today', style: { color: 'red' } });
  });

  it('merges declarations rather than replacing the map', () => {
    const store = createOverrideStore();
    store.set('a', { style: { color: 'red' } });
    store.patch('a', { style: { fontSize: '2rem' } });
    expect(store.get('a')).toEqual({ style: { color: 'red', fontSize: '2rem' } });
  });

  it('notifies once for a patch that changes something, and not at all otherwise', () => {
    const store = createOverrideStore();
    store.set('a', { text: 'x' });
    const listener = vi.fn();
    store.subscribe(listener);
    store.patch('a', { text: 'x' });
    expect(listener).not.toHaveBeenCalled();
    store.patch('a', { text: 'y' });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

// AC-4.3 — a stored override that a caller can reach into is a store that notifies zero
// times for a change that happened.
describe('reads are defensive copies', () => {
  it('does not let a caller mutate what is stored', () => {
    const store = createOverrideStore();
    const source = { text: 'x', style: { color: 'red' } };
    store.set('a', source);
    source.style.color = 'blue';
    expect(store.get('a')).toEqual({ text: 'x', style: { color: 'red' } });

    const read = store.get('a')!;
    read.style!.color = 'green';
    expect(store.get('a')).toEqual({ text: 'x', style: { color: 'red' } });
  });
});
