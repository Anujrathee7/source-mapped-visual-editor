/**
 * The one control that changes the palette (AC-16.1).
 *
 * It says what pressing it does rather than what is currently true: in light it reads
 * `Dark`, and pressing it makes the studio dark. A control named after the state it is in
 * has to be read twice before anyone knows what it will do.
 *
 * A micro-label in a pill, which is the shape §3 gives every other action — this one is
 * quieter than the rest because it is chrome rather than part of the flow.
 */
import { type ReactElement } from 'react';
import type { ThemeController } from '../client/theme.js';
import { useChanges } from './store.js';

export interface ThemeToggleProps {
  theme: ThemeController;
}

export function ThemeToggle({ theme }: ThemeToggleProps): ReactElement {
  useChanges(theme.subscribe);
  const next = theme.mode === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      className="sv-theme"
      aria-label={`Switch to the ${next} theme`}
      onClick={() => theme.set(next)}
    >
      {next === 'dark' ? 'Dark' : 'Light'}
    </button>
  );
}
