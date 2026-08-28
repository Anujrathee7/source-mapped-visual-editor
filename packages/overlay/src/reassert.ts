/**
 * The DOM half of applying an override (AC-4.5).
 *
 * Text and class additions cannot be expressed in CSS, so they are the only things the
 * overlay writes to an element — and because React will write over them on its next
 * render, they are re-asserted from a `MutationObserver`.
 *
 * Two things keep that from becoming a loop:
 *
 *  - `isReasserting`, checked on entry to the callback;
 *  - `takeRecords()` immediately after every write, which discards the records those
 *    writes just queued.
 *
 * The flag alone is not enough: records queued while it was set would be delivered on the
 * next microtask, when it is clear again, and the observer would react to itself forever.
 * The drain alone is not enough either, since a write can be triggered from inside the
 * callback. AC-4.5 asks for the count to settle, and it settles because of both.
 */
import { eidSelector } from './apply.js';
import type { Override } from './store.js';

export type OverrideEntry = readonly [eid: string, override: Override];

interface Baseline {
  /** The text React last rendered. Not the text captured at selection time (AC-4.5). */
  text: string | null;
  /** Only the classes this overlay actually added, so lifting takes back nothing else. */
  added: Set<string>;
}

export interface Reasserter {
  /** Replaces the asserted set. Elements that drop out are restored to React's DOM. */
  apply(entries: readonly OverrideEntry[]): void;
  /** True while the overlay is mid-write; the observer refuses to act on its own edits. */
  readonly isReasserting: boolean;
  /** Whether an observer is currently connected — nothing overridden means nothing observed. */
  readonly active: boolean;
  /** Observer callbacks seen. The counter AC-4.5 asks the guard to be proved with. */
  readonly observations: number;
  dispose(): void;
}

export function createReasserter(root: Document): Reasserter {
  const baselines = new Map<Element, Baseline>();
  let entries: readonly OverrideEntry[] = [];
  let isReasserting = false;
  let active = false;
  let observations = 0;
  let disposed = false;

  const observer = new MutationObserver(() => {
    observations += 1;
    if (isReasserting || disposed) return;
    // Rather than mapping each record back to a stamped ancestor, re-derive the whole
    // asserted set from the live DOM. It is the same work the first apply does, it cannot
    // be confused by a record whose target is a text node three levels down, and after
    // HMR the elements are new objects anyway.
    assert();
  });

  const connect = (): void => {
    if (active || disposed) return;
    observer.observe(root.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    active = true;
  };

  const disconnect = (): void => {
    if (!active) return;
    observer.disconnect();
    active = false;
  };

  const restore = (el: Element, baseline: Baseline): void => {
    if (baseline.text !== null) el.textContent = baseline.text;
    for (const className of baseline.added) el.classList.remove(className);
  };

  /** Every write the overlay makes to the page goes through here, guarded and drained. */
  const write = (mutate: () => void): void => {
    isReasserting = true;
    try {
      mutate();
    } finally {
      observer.takeRecords();
      isReasserting = false;
    }
  };

  const assert = (): void => {
    const current = new Set<Element>();

    write(() => {
      for (const [eid, override] of entries) {
        const wantsText = override.text !== undefined;
        const additions = override.classes?.add ?? [];
        if (!wantsText && additions.length === 0) continue;

        for (const el of root.querySelectorAll(eidSelector(eid))) {
          current.add(el);
          const baseline = baselines.get(el) ?? { text: null, added: new Set<string>() };
          baselines.set(el, baseline);

          if (wantsText && el.textContent !== override.text) {
            // Whatever is in the DOM right now is what React last rendered: the observer
            // only ran because something outside the overlay put it there.
            baseline.text = el.textContent ?? '';
            el.textContent = override.text ?? '';
          }
          for (const className of additions) {
            if (el.classList.contains(className)) continue;
            el.classList.add(className);
            baseline.added.add(className);
          }
        }
      }

      // Anything no longer asserted goes back to React's DOM and stops being tracked, so
      // the map does not accumulate detached nodes across HMR reloads.
      for (const [el, baseline] of baselines) {
        if (current.has(el)) continue;
        if (el.isConnected) restore(el, baseline);
        baselines.delete(el);
      }
    });
  };

  return {
    apply: (next) => {
      if (disposed) return;
      entries = next;
      assert();
      // Keyed on what is *overridden*, not on what is currently tracked: after HMR tears
      // the page down the element is briefly gone, and an observer that disconnected on
      // that would never see it come back. A style-only override asserts nothing into the
      // DOM and so needs no observer at all.
      if (next.some(([, o]) => o.text !== undefined || (o.classes?.add.length ?? 0) > 0)) connect();
      else disconnect();
    },

    get isReasserting() {
      return isReasserting;
    },

    get active() {
      return active;
    },

    get observations() {
      return observations;
    },

    dispose: () => {
      if (disposed) return;
      entries = [];
      assert();
      disconnect();
      disposed = true;
    },
  };
}
