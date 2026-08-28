/**
 * Tide maths for the sample day.
 *
 * Everything in here is arithmetic over the sample constants in `src/data/beaches.ts`.
 * There is no network call and no real observation anywhere in this app: a real Sounding
 * would read a tide gauge, this one reads an array.
 */
import type { Beach } from '../data/beaches';

/** Sample clock. The page is written for the 6am decision, so it is fixed just before it. */
export const SAMPLE_NOW_MIN = 5 * 60 + 40;
export const SAMPLE_DAY = 'Friday 29 August';

/** The window the ribbon draws: first light to last light. */
export const RIBBON_START_MIN = 4 * 60;
export const RIBBON_END_MIN = 22 * 60;

/** Metres of chart datum the ribbon's vertical axis spans. */
const RIBBON_MIN_M = 0;
const RIBBON_MAX_M = 5.6;

export interface TideEvent {
  readonly kind: 'high' | 'low';
  readonly minutes: number;
  readonly metres: number;
}

export interface Station {
  readonly name: string;
  readonly airC: number;
  readonly swellM: number;
  readonly wind: string;
  readonly events: readonly TideEvent[];
}

/** Sample predictions for the fictional Skarra Harbour gauge. */
export const STATION: Station = {
  name: 'Skarra Harbour',
  airC: 12,
  swellM: 0.4,
  wind: 'W 11 kt',
  events: [
    { kind: 'low', minutes: 3 * 60 + 55, metres: 0.6 },
    { kind: 'high', minutes: 10 * 60 + 12, metres: 5.3 },
    { kind: 'low', minutes: 16 * 60 + 28, metres: 0.7 },
    { kind: 'high', minutes: 22 * 60 + 41, metres: 5.1 },
  ],
};

/** `372` → `"06:12"`. */
export function clock(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = Math.round(minutes) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** A gap a half-awake person can act on: "10 minutes", "1 h 25". */
export function gap(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total} minutes`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}

/**
 * Height between two extremes. A real tide is close enough to a cosine between
 * successive high and low water that harbour tables have been drawn this way for a
 * century, so that is what the ribbon plots.
 */
export function heightAt(minutes: number, events: readonly TideEvent[] = STATION.events): number {
  const first = events[0];
  const last = events[events.length - 1];
  if (!first || !last) return 0;
  if (minutes <= first.minutes) return first.metres;
  if (minutes >= last.minutes) return last.metres;

  for (let i = 0; i < events.length - 1; i += 1) {
    const a = events[i];
    const b = events[i + 1];
    if (!a || !b) continue;
    if (minutes >= a.minutes && minutes <= b.minutes) {
      const u = (minutes - a.minutes) / (b.minutes - a.minutes);
      return a.metres + (b.metres - a.metres) * ((1 - Math.cos(Math.PI * u)) / 2);
    }
  }
  return last.metres;
}

/** Horizontal position of a time as a percentage of the ribbon, for HTML annotations. */
export function ribbonPct(minutes: number): number {
  const span = RIBBON_END_MIN - RIBBON_START_MIN;
  return ((minutes - RIBBON_START_MIN) / span) * 100;
}

/** The same mapping in the ribbon SVG's 1000 × 100 user space. */
function ribbonX(minutes: number): number {
  return (ribbonPct(minutes) / 100) * 1000;
}

/** Vertical position of a height, as a percentage down the ribbon. */
export function ribbonY(metres: number): number {
  const t = (metres - RIBBON_MIN_M) / (RIBBON_MAX_M - RIBBON_MIN_M);
  return 96 - t * 88;
}

/** Tide events that fall inside the drawn window, for annotation. */
export function visibleEvents(events: readonly TideEvent[] = STATION.events): TideEvent[] {
  return events.filter(
    (event) => event.minutes >= RIBBON_START_MIN && event.minutes <= RIBBON_END_MIN,
  );
}

/** The tide line as an SVG path, sampled every twelve minutes. */
export function tidePath(): string {
  const points: string[] = [];
  for (let m = RIBBON_START_MIN; m <= RIBBON_END_MIN; m += 12) {
    points.push(`${ribbonX(m).toFixed(2)} ${ribbonY(heightAt(m)).toFixed(2)}`);
  }
  return `M ${points.join(' L ')}`;
}

/** The same line closed to the sea bed, for the fill under it. */
export function tideArea(): string {
  return `${tidePath()} L 1000 100 L 0 100 Z`;
}

export interface SwimWindow {
  readonly openMin: number;
  readonly closeMin: number;
}

export type WindowState =
  | { readonly phase: 'open'; readonly closesIn: number }
  | { readonly phase: 'soon'; readonly opensIn: number }
  | { readonly phase: 'closed' };

export function windowState(w: SwimWindow, nowMin: number): WindowState {
  if (nowMin < w.openMin) return { phase: 'soon', opensIn: w.openMin - nowMin };
  if (nowMin < w.closeMin) return { phase: 'open', closesIn: w.closeMin - nowMin };
  return { phase: 'closed' };
}

/**
 * The hero's one moving part: the soonest window a swimmer can actually use, built from
 * the beach list at render time. Not a literal — change the array and this changes.
 */
export function nextSafeWindow(beaches: readonly Beach[], nowMin: number): string {
  const safe = beaches.filter((beach) => beach.safe);

  const openNow = safe
    .filter((beach) => nowMin >= beach.window.openMin && nowMin < beach.window.closeMin)
    .sort((a, b) => b.window.closeMin - a.window.closeMin)[0];
  if (openNow) {
    return `open now at ${openNow.name}, until ${clock(openNow.window.closeMin)}`;
  }

  const upcoming = safe
    .filter((beach) => beach.window.openMin > nowMin)
    .sort((a, b) => a.window.openMin - b.window.openMin)[0];
  if (!upcoming) {
    return `nothing swimmable left today — first light tomorrow is ${clock(5 * 60 + 12)}`;
  }

  const { openMin, closeMin } = upcoming.window;
  return `${clock(openMin)}–${clock(closeMin)} at ${upcoming.name}, in ${gap(openMin - nowMin)}`;
}

/** Mean water temperature across the beaches on the page, to one decimal. */
export function meanWaterC(beaches: readonly Beach[]): number {
  if (beaches.length === 0) return 0;
  const total = beaches.reduce((sum, beach) => sum + beach.waterC, 0);
  return Math.round((total / beaches.length) * 10) / 10;
}
