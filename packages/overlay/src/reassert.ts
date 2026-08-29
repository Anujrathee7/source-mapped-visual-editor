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
  // The observed document's own constructor (AC-8.1). Observing one realm's nodes with
  // another realm's observer is the kind of mixed-realm call that works in jsdom and fails
  // across an iframe boundary — and a document with no window has no event loop to deliver
  // records on, so there the observer is honestly absent rather than faked.
  const Observer = root.defaultView?.MutationObserver;
  const baselines = new Map<Element, Baseline>();
  let entries: readonly OverrideEntry[] = [];
  let isReasserting = false;
  let active = false;
  let observations = 0;
  let disposed = false;

  /**
   * React wrote something, so whatever is in the DOM right now is React's — and it becomes
   * the baseline even when it happens to *equal* the override.
   *
   * That last case is not a curiosity: it is precisely what a landed edit looks like. The
   * agent writes the text the user asked for, hot reload renders it, and the element now
   * reads exactly as the override does. Without this, the baseline would still hold the
   * pre-edit text, lifting the override would write that back over React's output, and the
   * verifier would read a stale value and report drift on every successful edit (AC-5.1).
   *
   * Records are consulted only to decide *which* baselines are React's to refresh. The
   * re-assertion itself still re-derives everything from the live DOM, so a record whose
   * target is a text node three levels down cannot confuse it.
   */
  const refreshBaselines = (records: readonly MutationRecord[]): void => {
    for (const record of records) {
      const from =
        record.target.nodeType === Node.ELEMENT_NODE
          ? (record.target as Element)
          : record.target.parentElement;
      for (let el: Element | null = from; el; el = el.parentElement) {
        const baseline = baselines.get(el);
        if (!baseline) continue;
        if (baseline.text !== null) baseline.text = el.textContent ?? '';
        break;
      }
    }
  };

  const observer = Observer
    ? new Observer((records) => {
        observations += 1;
        if (isReasserting || disposed) return;
        refreshBaselines(records);
        assert();
      })
    : null;

  const connect = (): void => {
    if (active || disposed || !observer) return;
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
    observer?.disconnect();
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
      observer?.takeRecords();
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
