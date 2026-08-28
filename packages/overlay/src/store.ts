/**
 * The override store (AC-4.3).
 *
 * A plain observable keyed by `eid`, holding nothing but data. That is not tidiness: HMR
 * replaces every node on the page, and a store that remembered elements would be pointing
 * at detached nodes the instant the agent's write lands. Re-anchoring happens at read time
 * against the live document (see `resolveAnchor`), never from something cached here.
 */

export interface ClassOverride {
  add: string[];
  remove: string[];
}

/** A user's change, before any agent has touched disk: a temporary in-browser illusion. */
export interface Override {
  text?: string;
  classes?: ClassOverride;
  style?: Record<string, string>;
}

export interface OverrideStore {
  get(eid: string): Override | undefined;
  has(eid: string): boolean;
  /** Replaces the override wholesale. */
  set(eid: string, override: Override): void;
  /** Merges one facet in, leaving the others alone. */
  patch(eid: string, patch: Override): void;
  clear(eid: string): void;
  clearAll(): void;
  entries(): Array<[string, Override]>;
  readonly size: number;
  /** Returns an unsubscribe function. Listeners fire synchronously, once per change. */
  subscribe(listener: () => void): () => void;
}

/**
 * An override with nothing in it is not an override.
 *
 * `{ text: '' }` is deliberately *not* empty: deleting an element's text is a change a
 * user can mean, and an edit that silently does nothing is worse than one that empties a
 * heading.
 */
export function isEmptyOverride(override: Override): boolean {
  if (override.text !== undefined) return false;
  if (override.classes && (override.classes.add.length > 0 || override.classes.remove.length > 0)) {
    return false;
  }
  if (override.style && Object.keys(override.style).length > 0) return false;
  return true;
}

/** Strips the facets that carry nothing, so equality is a comparison of meaning. */
function normalize(override: Override): Override {
  const normalized: Override = {};
  if (override.text !== undefined) normalized.text = override.text;
  if (override.classes) {
    const add = [...override.classes.add];
    const remove = [...override.classes.remove];
    if (add.length > 0 || remove.length > 0) normalized.classes = { add, remove };
  }
  if (override.style) {
    const style = { ...override.style };
    if (Object.keys(style).length > 0) normalized.style = style;
  }
  return normalized;
}

/** Overrides are shallow trees of strings, so serialising is a sound equality test. */
function same(a: Override | undefined, b: Override): boolean {
  return a !== undefined && JSON.stringify(a) === JSON.stringify(b);
}

export function createOverrideStore(): OverrideStore {
  const overrides = new Map<string, Override>();
  const listeners = new Set<() => void>();

  const notify = (): void => {
    // Iterating a copy: a listener that unsubscribes itself mid-notification must not
    // cause the set to skip the listener registered after it.
    for (const listener of [...listeners]) listener();
  };

  const write = (eid: string, next: Override): void => {
    const normalized = normalize(next);
    if (isEmptyOverride(normalized)) {
      if (!overrides.delete(eid)) return;
      notify();
      return;
    }
    if (same(overrides.get(eid), normalized)) return;
    overrides.set(eid, normalized);
    notify();
  };

  return {
    get: (eid) => {
      const override = overrides.get(eid);
      // A copy, not the stored value: a caller that reaches in and mutates would be a
      // change no subscriber was told about.
      return override === undefined ? undefined : normalize(override);
    },

    has: (eid) => overrides.has(eid),

    set: write,

    patch: (eid, patch) => {
      const current = overrides.get(eid) ?? {};
      write(eid, {
        text: patch.text ?? current.text,
        classes: patch.classes ?? current.classes,
        style:
          patch.style || current.style ? { ...current.style, ...patch.style } : undefined,
      });
    },

    clear: (eid) => {
      if (!overrides.delete(eid)) return;
      notify();
    },

    clearAll: () => {
      if (overrides.size === 0) return;
      overrides.clear();
      notify();
    },

    entries: () => [...overrides].map(([eid, override]) => [eid, normalize(override)]),

    get size() {
      return overrides.size;
    },

    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
