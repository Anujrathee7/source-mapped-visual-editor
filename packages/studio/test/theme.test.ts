// @vitest-environment jsdom
/**
 * AC-16.1 — both modes exist, and neither is an afterthought.
 *
 * The palette is CSS and `design.test.ts` holds it to the brief. This is the other half:
 * which of the two blocks is in force, who decided, and whether that decision survives a
 * reload. Three things have to be true at once and they are easy to get two out of three
 * of — a toggle that does not persist, a stored choice the system preference overrides on
 * the next load, or a default that ignores the preference entirely.
 *
 * The controller takes its environment as an argument for the same reason every other
 * controller in this package does: the interesting cases are a reader whose system says
 * dark, a reader who chose otherwise, and a browser whose storage throws — none of which a
 * test can arrange by asking the real `window` nicely.
 */
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  THEME_KEY,
  createThemeController,
  type ThemeEnvironment,
  type ThemeMode,
} from '../src/client/theme.js';
import { ThemeToggle } from '../src/app/ThemeToggle.js';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** A root, a store and a system preference, all of them stated rather than discovered. */
function environment(options: {
  prefersDark?: boolean;
  stored?: string | null;
  throws?: boolean;
} = {}): ThemeEnvironment & { root: HTMLElement; written: Array<[string, string]>; prefer(dark: boolean): void } {
  const root = document.createElement('html');
  const written: Array<[string, string]> = [];
  let dark = options.prefersDark ?? false;
  let listener: (() => void) | null = null;

  return {
    root,
    written,
    prefer(next: boolean) {
      dark = next;
      listener?.();
    },
    prefersDark: () => dark,
    storage: {
      getItem: (key) => {
        if (options.throws) throw new Error('storage is not available');
        return key === THEME_KEY ? (options.stored ?? null) : null;
      },
      setItem: (key, value) => {
        if (options.throws) throw new Error('storage is not available');
        written.push([key, value]);
      },
    },
    watchPreference: (notify) => {
      listener = notify;
      return () => {
        listener = null;
      };
    },
  };
}

const stamped = (env: { root: HTMLElement }): string | null => env.root.getAttribute('data-theme');

describe('AC-16.1 the mode defaults to the system preference', () => {
  it('takes dark from prefers-color-scheme when nothing has been chosen', () => {
    const env = environment({ prefersDark: true });
    expect(createThemeController(env).mode).toBe<ThemeMode>('dark');
    expect(stamped(env)).toBe('dark');
  });

  it('takes light the same way', () => {
    const env = environment({ prefersDark: false });
    expect(createThemeController(env).mode).toBe<ThemeMode>('light');
    expect(stamped(env)).toBe('light');
  });

  it('stamps the root either way, so the CSS never has to guess', () => {
    for (const dark of [true, false]) {
      const env = environment({ prefersDark: dark });
      createThemeController(env);
      expect(stamped(env)).toBe(dark ? 'dark' : 'light');
    }
  });

  it('keeps following the system until a choice is made, and stops the moment one is', () => {
    const env = environment({ prefersDark: false });
    const theme = createThemeController(env);
    expect(theme.following).toBe(true);

    env.prefer(true);
    expect(theme.mode).toBe<ThemeMode>('dark');
    expect(stamped(env)).toBe('dark');

    theme.set('light');
    expect(theme.following).toBe(false);
    env.prefer(true);
    // The reader said light while the system said dark. The reader wins, and keeps winning.
    expect(theme.mode).toBe<ThemeMode>('light');
    expect(stamped(env)).toBe('light');
  });
});

describe('AC-16.1 the choice persists across a reload', () => {
  it('beats a system preference that says the opposite', () => {
    const dark = createThemeController(environment({ prefersDark: false, stored: 'dark' }));
    expect(dark.mode).toBe<ThemeMode>('dark');
    const light = createThemeController(environment({ prefersDark: true, stored: 'light' }));
    expect(light.mode).toBe<ThemeMode>('light');
  });

  it('writes the choice under one key, and only on an explicit choice', () => {
    const env = environment({ prefersDark: true });
    const theme = createThemeController(env);
    expect(env.written).toEqual([]);

    theme.toggle();
    expect(theme.mode).toBe<ThemeMode>('light');
    expect(env.written).toEqual([[THEME_KEY, 'light']]);
  });

  it('ignores a stored value that is not one of the two modes', () => {
    const env = environment({ prefersDark: true, stored: 'solarized' });
    expect(createThemeController(env).mode).toBe<ThemeMode>('dark');
    expect(createThemeController(env).following).toBe(true);
  });

  it('survives a browser whose storage throws rather than taking the studio down', () => {
    const env = environment({ prefersDark: true, throws: true });
    const theme = createThemeController(env);
    expect(theme.mode).toBe<ThemeMode>('dark');
    expect(() => theme.toggle()).not.toThrow();
    expect(theme.mode).toBe<ThemeMode>('light');
    expect(stamped(env)).toBe('light');
  });

  it('tells its subscribers, so the interface re-reads it', () => {
    const env = environment();
    const theme = createThemeController(env);
    let heard = 0;
    const stop = theme.subscribe(() => (heard += 1));
    theme.toggle();
    expect(heard).toBe(1);
    stop();
    theme.toggle();
    expect(heard).toBe(1);
  });
});

/* ── the control itself ───────────────────────────────────────────────────── */

let host: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function mount(theme: ReturnType<typeof createThemeController>): Promise<void> {
  await act(async () => {
    root!.render(createElement(ThemeToggle, { theme }) as ReactElement);
  });
}

describe('AC-16.1 the toggle is explicit, and a keyboard can reach it', () => {
  it('is a real button, not something pretending to be one', async () => {
    const env = environment();
    await mount(createThemeController(env));
    const button = host!.querySelector('.sv-theme');
    expect(button?.tagName).toBe('BUTTON');
    expect(button?.getAttribute('type')).toBe('button');
  });

  it('names the mode it will switch to, in the word it shows', async () => {
    const env = environment({ prefersDark: false });
    await mount(createThemeController(env));
    const button = host!.querySelector('.sv-theme') as HTMLButtonElement;
    expect(button.textContent).toBe('Dark');
    // Label-in-name: the accessible name contains the visible word.
    expect(button.getAttribute('aria-label')?.toLowerCase()).toContain('dark');
  });

  it('flips the root, the word and the stored choice together', async () => {
    const env = environment({ prefersDark: false });
    const theme = createThemeController(env);
    await mount(theme);

    await act(async () => {
      (host!.querySelector('.sv-theme') as HTMLButtonElement).click();
    });

    expect(stamped(env)).toBe('dark');
    expect(env.written).toEqual([[THEME_KEY, 'dark']]);
    expect((host!.querySelector('.sv-theme') as HTMLButtonElement).textContent).toBe('Light');
  });
});
