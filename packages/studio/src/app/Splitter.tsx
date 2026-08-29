/**
 * A panel edge you can drag, and reach with the keyboard (AC-12.7).
 *
 * It writes a CSS variable rather than React state: the grid is one declaration and the
 * drag is one number, so a resize costs no render at all. The clamp lives here, which is
 * what stops a drag squeezing the preview below a width the project could honestly render
 * in — the middle column's own `minmax(420px, 1fr)` is the second half of that promise.
 *
 * It is a `separator` with arrow keys because a control that only a pointer can reach is
 * one a keyboard user cannot undo.
 */
import { useCallback, type ReactElement } from 'react';

export interface SplitterProps {
  /** The custom property this edge owns, e.g. `--sv-changes`. */
  variable: string;
  label: string;
  min: number;
  max: number;
  /** Whether dragging right makes the panel wider. False for the right-hand flank. */
  grows: boolean;
  step?: number;
}

function read(variable: string): number {
  if (typeof document === 'undefined') return 0;
  return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(variable)) || 0;
}

function write(variable: string, value: number, min: number, max: number): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty(
    variable,
    `${Math.min(max, Math.max(min, Math.round(value)))}px`,
  );
}

export function Splitter(props: SplitterProps): ReactElement {
  const { variable, min, max, grows } = props;
  const step = props.step ?? 16;

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = read(variable);
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);

      const move = (moveEvent: PointerEvent): void => {
        const delta = (moveEvent.clientX - startX) * (grows ? 1 : -1);
        write(variable, startWidth + delta, min, max);
      };
      const up = (): void => {
        target.removeEventListener('pointermove', move);
        target.removeEventListener('pointerup', up);
      };
      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', up);
    },
    [variable, min, max, grows],
  );

  return (
    <button
      type="button"
      className="sv-splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={props.label}
      onPointerDown={onPointerDown}
      onKeyDown={(event) => {
        const direction =
          event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
        if (direction === 0) return;
        event.preventDefault();
        write(variable, read(variable) + direction * step * (grows ? 1 : -1), min, max);
      }}
    />
  );
}
