/**
 * Which of the two palettes is in force (AC-16.1).
 *
 * `theme.ts` holds both modes; this decides between them. The rule the brief sets is
 * "defaulting to `prefers-color-scheme` when the user has expressed no preference", and
 * the operative half of that sentence is *when* — following the system is the right
 * default and the wrong behaviour the instant somebody disagrees with it. So a controller
 * follows the preference, including while the studio is open and the reader changes it at
 * the OS level, and stops following the moment `set` or `toggle` is called. `following`
 * is part of the contract rather than an implementation detail, because it is the only
 * thing separating "dark because your machine is" from "dark because you said so".
 *
 * The environment is an argument for the reason every controller in this package takes
 * one: none of the interesting states — a system that says dark, a stored choice that
 * disagrees with it, a browser whose storage throws — can be arranged by asking the real
 * `window` nicely.
 */
export type ThemeMode = 'light' | 'dark';

/** One key. A second would be a second answer to the same question. */
export const THEME_KEY = 'sve.studio.theme';

export interface ThemeEnvironment {
  /** Where `data-theme` is stamped. The document element, in a browser. */
  root: Pick<HTMLElement, 'setAttribute'>;
  /**
   * Where the choice is kept, or `null` where there is nowhere to keep it. Both methods
   * may throw — a browser told to block site data throws on access rather than returning
   * nothing — and a studio that cannot remember a preference must still honour one.
   */
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  prefersDark(): boolean;
  /** Notifies when the system preference changes. Returns the unsubscribe. */
  watchPreference?(listener: () => void): () => void;
}

export interface ThemeController {
  readonly mode: ThemeMode;
  /** True while the mode is the system's rather than one the reader picked. */
  readonly following: boolean;
  subscribe(listener: () => void): () => void;
  set(mode: ThemeMode): void;
  toggle(): void;
  /** Stops watching the system preference. */
  dispose(): void;
}

function isMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark';
}

/** The stored choice, or null — including when reading one throws. */
function storedMode(env: ThemeEnvironment): ThemeMode | null {
  try {
    const value = env.storage?.getItem(THEME_KEY);
    return isMode(value) ? value : null;
  } catch {
    return null;
  }
}

export function createThemeController(env: ThemeEnvironment): ThemeController {
  let chosen = storedMode(env);
  let mode: ThemeMode = chosen ?? (env.prefersDark() ? 'dark' : 'light');
  const listeners = new Set<() => void>();

  const stamp = (): void => {
    env.root.setAttribute('data-theme', mode);
  };

  // Immediately, so the attribute is on the root before the first render reads a colour.
  stamp();

  const stopWatching = env.watchPreference?.(() => {
    if (chosen !== null) return;
    const next: ThemeMode = env.prefersDark() ? 'dark' : 'light';
    if (next === mode) return;
    mode = next;
    stamp();
    for (const listener of listeners) listener();
  });

  const controller: ThemeController = {
    get mode() {
      return mode;
    },
    get following() {
      return chosen === null;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      chosen = next;
      mode = next;
      // The stamp is what the interface reads, so it happens whether or not the write
      // below succeeds: a browser that cannot remember the choice still has to honour it.
      stamp();
      try {
        env.storage?.setItem(THEME_KEY, next);
      } catch {
        /* No storage, or storage that refuses. The session keeps the choice regardless. */
      }
      for (const listener of listeners) listener();
    },
    toggle() {
      controller.set(mode === 'dark' ? 'light' : 'dark');
    },
    dispose() {
      listeners.clear();
      stopWatching?.();
    },
  };

  return controller;
}

/** The real one: this document, this browser's storage, this machine's preference. */
export function browserThemeEnvironment(): ThemeEnvironment {
  const query =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;

  return {
    root: document.documentElement,
    // Read through a getter rather than captured: `localStorage` itself throws on access
    // in a browser configured to block site data, and that must not throw here.
    storage: {
      getItem: (key) => window.localStorage.getItem(key),
      setItem: (key, value) => window.localStorage.setItem(key, value),
    },
    prefersDark: () => query?.matches ?? false,
    watchPreference: (listener) => {
      query?.addEventListener('change', listener);
      return () => query?.removeEventListener('change', listener);
    },
  };
}
