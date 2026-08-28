/**
 * Comparators — pure, shared, total (AC-4.9).
 *
 * CLAUDE.md: "Compare computed values, not source text. Comparators live in one place; do
 * not inline ad-hoc string equality at call sites." This module is that place, and it is
 * the one file in the package that must work with no DOM at all, because M6 compares here
 * and the unit tests run in Node.
 *
 * Every exported function is total. Unparseable input comes back as the normalised
 * original rather than as an exception, so a comparison can report drift but never crash
 * the verifier mid-verdict.
 */
import type { Computed, Mismatch } from '@sve/protocol';
import { NAMED_COLORS } from './named-colors.js';

/** The CSS initial root font size. `1rem` and `16px` compare equal at this value. */
export const DEFAULT_ROOT_FONT_SIZE = 16;

/* ── text ─────────────────────────────────────────────────────────────────── */

/**
 * Collapses whitespace runs and trims, so a JSX-indented child and the single line the
 * agent writes back do not read as a difference.
 */
export function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/* ── tokenising ───────────────────────────────────────────────────────────── */

/**
 * Splits on whitespace that is not inside parentheses, so `rgb(59, 130, 246)` stays one
 * token. Splitting naively would shred a colour function into three unparseable pieces —
 * which happens to round-trip, but only by accident, and stops doing so the moment either
 * side spells its commas differently.
 */
function splitTopLevel(value: string): string[] {
  const tokens: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && /\s/.test(ch)) {
      if (current !== '') tokens.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current !== '') tokens.push(current);
  return tokens;
}

/** Trims, collapses whitespace, lowercases. The "normalised original" every fallback returns. */
function normalizeRaw(value: string): string {
  return normalizeText(value).toLowerCase();
}

/** Trims trailing zeros so `1.50` and `1.5` are one value, and `-0` never appears. */
function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 1e4) / 1e4;
  return String(rounded === 0 ? 0 : rounded);
}

/* ── lengths ──────────────────────────────────────────────────────────────── */

/** Absolute CSS units, in px. `em` is missing on purpose: it needs an element to resolve. */
const ABSOLUTE_UNITS: Readonly<Record<string, number>> = {
  px: 1,
  pt: 96 / 72,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
};

const NUMBER = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)`;
const LENGTH_RE = new RegExp(`^(${NUMBER})([a-z%]*)$`);

function normalizeLengthToken(token: string, rootFontSize: number): string {
  const match = LENGTH_RE.exec(token);
  if (!match) return token;

  const magnitude = Number(match[1]);
  const unit = match[2] ?? '';
  if (!Number.isFinite(magnitude)) return token;

  if (unit === 'rem') return `${formatNumber(magnitude * rootFontSize)}px`;
  const factor = ABSOLUTE_UNITS[unit];
  if (factor !== undefined) return `${formatNumber(magnitude * factor)}px`;
  // A bare zero is a length; a bare non-zero is a ratio, as line-height uses.
  if (unit === '') return magnitude === 0 ? '0px' : formatNumber(magnitude);
  // `em`, `%`, `vh` and friends cannot be resolved without an element or a viewport.
  return token;
}

/**
 * Resolves every length in `value` to px at a 16px root, so `1rem` and `16px` compare
 * equal. Tokens it cannot resolve — `auto`, `50%`, `calc(...)` — come back unchanged.
 */
export function normalizeLength(value: string, rootFontSize = DEFAULT_ROOT_FONT_SIZE): string {
  const raw = normalizeRaw(value);
  if (raw === '') return '';
  return splitTopLevel(raw)
    .map((token) => normalizeLengthToken(token, rootFontSize))
    .join(' ');
}

/* ── colours ──────────────────────────────────────────────────────────────── */

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const channel = (value: number): number => clamp(Math.round(value), 0, 255);

function formatRgba({ r, g, b, a }: Rgba): string {
  const rgb = `${channel(r)}, ${channel(g)}, ${channel(b)}`;
  // Matching what `getComputedStyle` hands back keeps normalisation idempotent: the
  // canonical form of a canonical value has to be itself, or a second pass reads as drift.
  return a >= 1 ? `rgb(${rgb})` : `rgba(${rgb}, ${formatNumber(clamp(a, 0, 1))})`;
}

function parseHex(input: string): Rgba | null {
  const body = input.slice(1);
  if (!/^[0-9a-f]+$/.test(body)) return null;
  const expand = (part: string): number => parseInt(part + part, 16);
  if (body.length === 3 || body.length === 4) {
    return {
      r: expand(body[0]!),
      g: expand(body[1]!),
      b: expand(body[2]!),
      a: body.length === 4 ? expand(body[3]!) / 255 : 1,
    };
  }
  if (body.length === 6 || body.length === 8) {
    const pair = (index: number): number => parseInt(body.slice(index, index + 2), 16);
    return {
      r: pair(0),
      g: pair(2),
      b: pair(4),
      a: body.length === 8 ? pair(6) / 255 : 1,
    };
  }
  return null;
}

/** `a, b, c / d` and `a b c / d` are the same list; the alpha is whatever follows a slash. */
function parseArguments(body: string): { values: string[]; alpha: string | null } | null {
  const [main, ...rest] = body.split('/');
  if (rest.length > 1 || main === undefined) return null;
  const values = main
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
  const alpha = rest[0]?.trim() ?? null;
  if (alpha === '') return null;
  return { values, alpha };
}

function parseComponent(token: string, scale: number): number | null {
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+))(%?)$/.exec(token);
  if (!match) return null;
  const magnitude = Number(match[1]);
  if (!Number.isFinite(magnitude)) return null;
  return match[2] === '%' ? (magnitude / 100) * scale : magnitude;
}

function parseAlpha(token: string | null | undefined): number | null {
  if (token === null || token === undefined) return 1;
  const value = parseComponent(token, 1);
  return value === null ? null : clamp(value, 0, 1);
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hue = ((h % 360) + 360) % 360;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - chroma / 2;
  const sector: [number, number, number] =
    hue < 60
      ? [chroma, x, 0]
      : hue < 120
        ? [x, chroma, 0]
        : hue < 180
          ? [0, chroma, x]
          : hue < 240
            ? [0, x, chroma]
            : hue < 300
              ? [x, 0, chroma]
              : [chroma, 0, x];
  return { r: (sector[0] + m) * 255, g: (sector[1] + m) * 255, b: (sector[2] + m) * 255 };
}

function parseFunctional(input: string): Rgba | null {
  const match = /^(rgba?|hsla?)\((.*)\)$/.exec(input);
  if (!match) return null;
  const name = match[1]!;
  const parsed = parseArguments(match[2]!);
  if (!parsed) return null;

  const { values } = parsed;
  if (values.length < 3 || values.length > 4) return null;
  const alpha = parseAlpha(parsed.alpha ?? values[3]);
  if (alpha === null) return null;
  if (parsed.alpha !== null && values.length === 4) return null;

  if (name === 'rgb' || name === 'rgba') {
    const r = parseComponent(values[0]!, 255);
    const g = parseComponent(values[1]!, 255);
    const b = parseComponent(values[2]!, 255);
    if (r === null || g === null || b === null) return null;
    return { r, g, b, a: alpha };
  }

  const h = parseComponent(values[0]!.replace(/deg$/, ''), 1);
  const s = parseComponent(values[1]!, 1);
  const l = parseComponent(values[2]!, 1);
  if (h === null || s === null || l === null) return null;
  return { ...hslToRgb(h, clamp(s, 0, 1), clamp(l, 0, 1)), a: alpha };
}

/** Only consulted after the pure path gives up, and only where a document exists. */
const browserCache = new Map<string, string>();

function browserFallback(input: string): string | null {
  if (typeof document === 'undefined') return null;
  const cached = browserCache.get(input);
  if (cached !== undefined) return cached;
  try {
    const context = document.createElement('canvas').getContext('2d');
    if (!context) return null;
    // A canvas silently keeps its previous fillStyle for a value it cannot parse, so seed
    // it with a sentinel and treat "unchanged" as "not a colour".
    context.fillStyle = '#000000';
    context.fillStyle = input;
    const first = context.fillStyle;
    context.fillStyle = '#ffffff';
    context.fillStyle = input;
    if (context.fillStyle !== first) return null;
    const resolved = typeof first === 'string' ? parseColor(first) : null;
    if (!resolved) return null;
    const canonical = formatRgba(resolved);
    browserCache.set(input, canonical);
    return canonical;
  } catch {
    // A canvas-less environment (jsdom without the `canvas` package) throws here. The pure
    // path already answered every case AC-4.9 names; this is a bonus, not a dependency.
    return null;
  }
}

function parseColor(raw: string): Rgba | null {
  if (raw === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const named = NAMED_COLORS[raw];
  if (named !== undefined) return parseHex(`#${named}`);
  if (raw.startsWith('#')) return parseHex(raw);
  return parseFunctional(raw.replace(/,\s*/g, ', '));
}

/**
 * Canonicalises a colour to `rgb(r, g, b)` / `rgba(r, g, b, a)` — the form
 * `getComputedStyle` reports — so `#3b82f6`, `rgb(59, 130, 246)` and `rgb(59 130 246)` are
 * one value.
 */
export function normalizeColor(value: string): string {
  const raw = normalizeRaw(value);
  if (raw === '') return '';
  const parsed = parseColor(raw);
  if (parsed) return formatRgba(parsed);
  return browserFallback(raw) ?? raw;
}

/* ── dispatch ─────────────────────────────────────────────────────────────── */

const COLOR_PROPS = new Set(['color', 'backgroundColor', 'borderColor']);

const LENGTH_PROPS = new Set([
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'gap',
  'width',
  'height',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderRadius',
  'borderWidth',
]);

const NUMERIC_PROPS = new Set(['opacity', 'fontWeight']);

const FONT_WEIGHT_KEYWORDS: Readonly<Record<string, string>> = { normal: '400', bold: '700' };

function normalizeNumeric(value: string): string {
  const raw = normalizeRaw(value);
  const keyword = FONT_WEIGHT_KEYWORDS[raw];
  if (keyword !== undefined) return keyword;
  const parsed = Number(raw);
  return raw !== '' && Number.isFinite(parsed) ? formatNumber(parsed) : raw;
}

/** `"IBM Plex Mono", monospace` and `'IBM Plex Mono',monospace` name the same stack. */
function normalizeFontFamily(value: string): string {
  return normalizeRaw(value)
    .split(',')
    .map((family) => family.trim().replace(/^["']|["']$/g, '').replace(/\s+/g, ' '))
    .filter((family) => family !== '')
    .join(', ');
}

/** Colours and lengths interleaved, as `box-shadow` and `border` shorthands are. */
function normalizeCompound(value: string, rootFontSize: number): string {
  const raw = normalizeRaw(value);
  if (raw === '') return '';
  return splitTopLevel(raw)
    .map((token) => {
      const asColor = parseColor(token);
      if (asColor) return formatRgba(asColor);
      return normalizeLengthToken(token, rootFontSize);
    })
    .join(' ');
}

/**
 * The single entry point every call site uses. Adding a tracked property means teaching
 * this function about it, not writing another string comparison somewhere else.
 */
export function normalizeValue(
  prop: string,
  value: string,
  rootFontSize = DEFAULT_ROOT_FONT_SIZE,
): string {
  if (COLOR_PROPS.has(prop)) return normalizeColor(value);
  if (LENGTH_PROPS.has(prop)) return normalizeLength(value, rootFontSize);
  if (NUMERIC_PROPS.has(prop)) return normalizeNumeric(value);
  if (prop === 'fontFamily') return normalizeFontFamily(value);
  if (prop === 'boxShadow') return normalizeCompound(value, rootFontSize);
  return normalizeRaw(value);
}

export function valuesEqual(
  prop: string,
  a: string,
  b: string,
  rootFontSize = DEFAULT_ROOT_FONT_SIZE,
): boolean {
  return normalizeValue(prop, a, rootFontSize) === normalizeValue(prop, b, rootFontSize);
}

/**
 * The comparison M6 (AC-5.2) turns into a verdict: every tracked property the intent
 * recorded, checked against what the page rendered once the override was lifted.
 *
 * Only properties present in `intent` are compared. The intent is the closed question
 * being asked; a property the user never expressed an opinion about drifting is layout,
 * not drift.
 *
 * Both sides are reported unnormalised, so the message reads in the units the user and the
 * browser actually used rather than in the comparator's internal canonical form.
 */
export function diffComputed(
  intent: Computed,
  rendered: Computed,
  rootFontSize = DEFAULT_ROOT_FONT_SIZE,
): Mismatch[] {
  const mismatches: Mismatch[] = [];
  for (const [prop, intended] of Object.entries(intent)) {
    if (intended === undefined) continue;
    const actual = (rendered as Record<string, string | undefined>)[prop] ?? '';
    if (!valuesEqual(prop, intended, actual, rootFontSize)) {
      mismatches.push({ prop, intent: intended, rendered: actual });
    }
  }
  return mismatches;
}
