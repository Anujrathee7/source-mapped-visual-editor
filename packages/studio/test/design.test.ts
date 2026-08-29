/**
 * AC-16 — the workspace's look, in two modes.
 *
 * This file used to encode `docs/design.md` §1, because the studio used to. §3 supersedes
 * that for this surface and only this surface: `packages/overlay` still follows §1 and
 * `packages/overlay/test/inspector.test.ts` still holds it to it.
 *
 * Two of these criteria are the ones an implementation is most likely to fudge, so neither
 * is left to review:
 *
 *  - **No component hard-codes a hex.** Enforced by scanning the studio's own sources the
 *    way `@sve/rpc` scans for `'*'` — bluntly, comments included. A hex may appear on a
 *    token declaration in `theme.ts` and nowhere else in the package.
 *  - **Both modes meet WCAG AA.** The ratios are computed from the token values here
 *    rather than judged by eye, so a token that drifts out of contrast fails a test rather
 *    than shipping.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { APPLY_LABELS } from '@sve/overlay';
import { STUDIO_CSS } from '../src/app/theme.js';

/** Innermost declaration blocks. `[^{}]` can hold neither brace, so `@media` is skipped. */
function declarationBlocks(css: string): Array<{ selector: string; body: string }> {
  const blocks: Array<{ selector: string; body: string }> = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(css)) !== null) {
    blocks.push({ selector: match[1]!.trim().replace(/\s+/g, ' '), body: match[2]! });
  }
  return blocks;
}

const blocks = declarationBlocks(STUDIO_CSS);

/**
 * Blocks whose selector ends in `selector`.
 *
 * The scan above hands back everything before the brace, which for a top-level rule
 * includes the section comment above it. Matching the tail is what makes `.sv-row` and
 * `.sv-row__main` different questions.
 */
function rulesFor(selector: string): Array<{ selector: string; body: string }> {
  return blocks.filter((block) =>
    block.selector.split(',').some((part) => part.trim().split(/\s+/).pop() === selector),
  );
}

/** The declarations of the block introduced by an exact selector, as a name → value map. */
function tokensAt(selector: string): Map<string, string> {
  const opening = STUDIO_CSS.indexOf(`${selector} {`);
  // Empty rather than thrown: a missing block should fail the tests that wanted it by
  // name, not take the whole file down at collection.
  if (opening < 0) return new Map();
  const start = STUDIO_CSS.indexOf('{', opening) + 1;
  const end = STUDIO_CSS.indexOf('}', start);
  const found = new Map<string, string>();
  for (const line of STUDIO_CSS.slice(start, end).split('\n')) {
    const declaration = /^\s*(--[\w-]+|color-scheme)\s*:\s*(.+?);\s*$/.exec(line);
    if (declaration) found.set(declaration[1]!, declaration[2]!);
  }
  return found;
}

/* ── the palette, as docs/design.md §3 fixed it ───────────────────────────── */

/** §3's table, verbatim. The order is the table's order. */
const PALETTE = {
  '--sv-ground': { light: '#FBFBFA', dark: '#141413' },
  '--sv-panel': { light: '#FFFFFF', dark: '#1B1B19' },
  '--sv-field': { light: '#F6F6F6', dark: '#100F0E' },
  '--sv-line': { light: '#ECEBEB', dark: '#2B2A28' },
  '--sv-text': { light: '#161514', dark: '#F4F3F1' },
  '--sv-muted': { light: '#71706F', dark: '#8B8987' },
  '--sv-accent': { light: '#6A77E5', dark: '#8B95EE' },
  '--sv-landed': { light: '#1A7A4F', dark: '#4ADE9A' },
  '--sv-drifted': { light: '#C4342F', dark: '#F87171' },
} as const;

/** Every surface a foreground can land on. */
const SURFACES = ['--sv-ground', '--sv-panel', '--sv-field'] as const;
const MODES = ['light', 'dark'] as const;

/**
 * The three blocks that may carry a colour.
 *
 * Dark is written twice on purpose: once for the reader who has never touched the toggle,
 * where the only signal is `prefers-color-scheme`, and once for the reader who has, where
 * the attribute must win over the query in both directions.
 */
const LIGHT = ':root';
const DARK_PREFERRED = ":root:not([data-theme='light'])";
const DARK_CHOSEN = ":root[data-theme='dark']";

// AC-16.2 — "Every value in §3's table appears, for both modes, under the names given."
describe('AC-16.2 the tokens are exactly the ones in the brief', () => {
  const light = tokensAt(LIGHT);
  const chosen = tokensAt(DARK_CHOSEN);
  const preferred = tokensAt(DARK_PREFERRED);

  it.each(Object.entries(PALETTE))('%s carries both of the brief\'s values', (token, value) => {
    expect(light.get(token)).toBe(value.light);
    expect(chosen.get(token)).toBe(value.dark);
  });

  it('strands nothing: the two modes define the same names', () => {
    expect([...chosen.keys()].sort()).toEqual([...light.keys()].sort());
  });

  it('says the same thing whether dark was preferred or chosen', () => {
    expect([...preferred.entries()].sort()).toEqual([...chosen.entries()].sort());
  });

  it('tells the browser which mode it is in, so form controls follow', () => {
    expect(light.get('color-scheme')).toBe('light');
    expect(chosen.get('color-scheme')).toBe('dark');
  });

  it('lets an explicit choice beat the system preference, by coming after it', () => {
    expect(STUDIO_CSS.indexOf(DARK_CHOSEN)).toBeGreaterThan(STUDIO_CSS.indexOf(DARK_PREFERRED));
  });
});

// AC-16.3 — "The neutral ramp is the warm one from the brief ... rather than left to drift."
describe('AC-16.3 the neutrals are warm, not slate', () => {
  const NEUTRALS = ['--sv-ground', '--sv-panel', '--sv-field', '--sv-line', '--sv-text', '--sv-muted'] as const;

  it('pins the two anchors the brief named', () => {
    expect(PALETTE['--sv-text'].light).toBe('#161514');
    expect(PALETTE['--sv-ground'].light).toBe('#FBFBFA');
    expect(tokensAt(LIGHT).get('--sv-text')).toBe('#161514');
    expect(tokensAt(LIGHT).get('--sv-ground')).toBe('#FBFBFA');
  });

  it.each(NEUTRALS.flatMap((token) => [
    [`${token} light`, PALETTE[token].light],
    [`${token} dark`, PALETTE[token].dark],
  ]))('%s never leans blue', (_name, hex) => {
    const [red, green, blue] = channels(hex as string);
    // Warm means red-leading and blue-trailing. A slate grey is the other way round.
    expect(red).toBeGreaterThanOrEqual(green);
    expect(green).toBeGreaterThanOrEqual(blue);
  });

  it.each(MODES.flatMap((mode) => [
    [`--sv-text ${mode}`, PALETTE['--sv-text'][mode]],
    [`--sv-ground ${mode}`, PALETTE['--sv-ground'][mode]],
  ]))('%s leans warm rather than merely being grey', (_name, hex) => {
    const [red, , blue] = channels(hex as string);
    expect(red - blue).toBeGreaterThan(0);
  });

  it('carries the warmth through the whole dark ramp, where a slate would show most', () => {
    // In light the mid greys can sit on the neutral axis without reading cold; against a
    // near-black they cannot, so this is the ramp worth pinning end to end.
    for (const token of NEUTRALS) {
      const [red, , blue] = channels(PALETTE[token].dark);
      expect(red - blue, `${token} dark`).toBeGreaterThan(0);
    }
  });
});

/* ── AC-16.1 — no component hard-codes a hex ──────────────────────────────── */

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return name.endsWith('.ts') || name.endsWith('.tsx') ? [full] : [];
  });
}

/**
 * "No component hard-codes a hex", asserted rather than reviewed.
 *
 * Deliberately blunt, in the shape `@sve/rpc` uses for `'*'`: comments are scanned too. A
 * hex is allowed on a token declaration in `theme.ts`, which is the one place a colour is
 * supposed to arrive with a name, and nowhere else in the package.
 */
describe('AC-16.1 every colour comes from a token', () => {
  const src = fileURLToPath(new URL('../src/', import.meta.url));
  const themeFile = path.join(src, 'app', 'theme.ts');
  const files = walk(src);

  const hexLines = (): Array<{ file: string; line: number; text: string }> =>
    files.flatMap((file) =>
      readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .flatMap((text, index) =>
          /#[0-9a-fA-F]{3,8}\b/.test(text)
            ? [{ file: path.relative(src, file), line: index + 1, text: text.trim() }]
            : [],
        ),
    );

  it('has sources to scan', () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files).toContain(themeFile);
  });

  it('puts every hex in the package on a token declaration in theme.ts', () => {
    const stray = hexLines().filter(
      ({ file, text }) =>
        file !== path.join('app', 'theme.ts') ||
        !/^--sv-[a-z-]+:\s*#[0-9A-F]{6};$/.test(text),
    );
    expect(stray.map(({ file, line, text }) => `${file}:${line} ${text}`)).toEqual([]);
  });

  it('and there are as many of them as there are token declarations — no more', () => {
    // Three colour blocks (light, dark-preferred, dark-chosen) of the brief's nine values.
    expect(hexLines()).toHaveLength(Object.keys(PALETTE).length * 3);
  });
});

/* ── AC-16.1 — both modes meet WCAG AA, computed ──────────────────────────── */

function channels(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** WCAG 2.x relative luminance. */
function luminance(hex: string): number {
  const [red, green, blue] = channels(hex).map((channel) => {
    const unit = channel / 255;
    return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

describe('AC-16.1 both modes meet WCAG AA, computed from the tokens', () => {
  /** 4.5:1 — WCAG 1.4.3 for text below 18.66px bold / 24px regular, which is all of it. */
  const AA_TEXT = 4.5;
  /** 3:1 — WCAG 1.4.11, the floor for a mark that is not read as prose. */
  const AA_NON_TEXT = 3;

  const pairs = MODES.flatMap((mode) =>
    SURFACES.flatMap((surface) =>
      (['--sv-text', '--sv-muted'] as const).map((foreground) => ({
        mode,
        name: `${foreground} on ${surface} (${mode})`,
        ratio: contrast(PALETTE[foreground][mode], PALETTE[surface][mode]),
      })),
    ),
  );

  it.each(pairs.map((pair) => [pair.name, pair.ratio]))(
    '%s clears 4.5:1 for body and UI text',
    (_name, ratio) => {
      expect(ratio as number).toBeGreaterThanOrEqual(AA_TEXT);
    },
  );

  /**
   * The accent is a mark and only ever a mark: the caret, the prompt marker, the selection
   * edge. It is held to 1.4.11's non-text floor, and the rule below keeps prose out of it.
   */
  const marks = MODES.flatMap((mode) =>
    SURFACES.flatMap((surface) =>
      (['--sv-accent'] as const).map((foreground) => ({
        name: `${foreground} on ${surface} (${mode})`,
        ratio: contrast(PALETTE[foreground][mode], PALETTE[surface][mode]),
      })),
    ),
  );

  /**
   * The verdict colours are *read*, not merely seen. The status dot is a mark, but the word
   * beside it — Landed, Drifted — is a word, and a word held to the non-text floor is a word
   * somebody has to squint at. They clear the text floor in both modes, so they are asserted
   * against it rather than against the weaker one their dot would have allowed.
   */
  const verdicts = MODES.flatMap((mode) =>
    SURFACES.flatMap((surface) =>
      (['--sv-landed', '--sv-drifted'] as const).map((foreground) => ({
        name: `${foreground} on ${surface} (${mode})`,
        ratio: contrast(PALETTE[foreground][mode], PALETTE[surface][mode]),
      })),
    ),
  );

  it.each(verdicts.map((v) => [v.name, v.ratio]))(
    '%s clears 4.5:1 — the verdict is a word, not just a dot',
    (_name, ratio) => {
      expect(ratio as number).toBeGreaterThanOrEqual(AA_TEXT);
    },
  );

  it.each(marks.map((mark) => [mark.name, mark.ratio]))(
    '%s clears 3:1 as a non-text mark',
    (_name, ratio) => {
      expect(ratio as number).toBeGreaterThanOrEqual(AA_NON_TEXT);
    },
  );

  it('sets no prose in a mark colour: body copy is --sv-text and labels are --sv-muted', () => {
    for (const selector of ['.sv-empty', '.sv-turn__reply', '.sv-notice__body', '.sv-connect__lede']) {
      const rule = rulesFor(selector)[0];
      expect(rule?.body, `${selector} has no colour of its own`).toMatch(
        /color:\s*var\(--sv-(text|muted)\)/,
      );
    }
  });
});

/* ── AC-16.4 — the three rules that survive the change ────────────────────── */

describe('AC-16.4 the excerpt is visually inset', () => {
  it('sits on the recessed surface, not the panel it is in', () => {
    const excerpt = rulesFor('.sv-excerpt')[0];
    expect(excerpt?.body).toContain('background: var(--sv-field)');
  });

  it('and the panel around it is not that surface, in either mode', () => {
    const diagnostic = rulesFor('.sv-diagnostic')[0];
    expect(diagnostic?.body ?? '').not.toContain('var(--sv-field)');
    // Recessed means different, and it is different by construction: the two tokens
    // never hold the same value in either mode.
    for (const mode of MODES) expect(PALETTE['--sv-field'][mode]).not.toBe(PALETTE['--sv-panel'][mode]);
  });
});

describe('AC-16.4 the accent is a pointer, never a status', () => {
  const users = blocks.filter((block) => block.body.includes('var(--sv-accent)'));

  it('is used, and only ever to point at something', () => {
    expect(users.length).toBeGreaterThan(3);
    for (const block of users) {
      expect(
        block.selector,
        `${block.selector} uses the accent for something that is not a pointer`,
      ).toMatch(/caret|marker|focus-visible|splitter|selected|aria-pressed/);
    }
  });

  it('never appears on a verdict', () => {
    for (const block of users) expect(block.selector).not.toMatch(/verdict|data-status/);
  });

  it('marks the chat prompt with the same pointer the caret is', () => {
    expect(rulesFor('.sv-turn__marker')[0]?.body).toContain('var(--sv-accent)');
    expect(rulesFor('.sv-caret')[0]?.body).toContain('var(--sv-accent)');
  });
});

describe('AC-16.4 landed and drifted appear nowhere but a verdict', () => {
  const users = blocks.filter(
    (block) => block.body.includes('var(--sv-landed)') || block.body.includes('var(--sv-drifted)'),
  );

  it('is used, and only inside something that is a verdict', () => {
    expect(users.length).toBeGreaterThan(0);
    for (const block of users) expect(block.selector).toContain('verdict');
  });

  it('and the words appear nowhere but a verdict either', () => {
    const app = fileURLToPath(new URL('../src/app/', import.meta.url));
    const sources = readdirSync(app)
      .filter((name) => name.endsWith('.tsx'))
      .map((name) => readFileSync(path.join(app, name), 'utf8'));
    for (const source of sources) {
      // The words come from `APPLY_LABELS`, and only from there.
      expect(source).not.toContain(`'${APPLY_LABELS.landed}'`);
      expect(source).not.toContain(`>${APPLY_LABELS.landed}<`);
      expect(source).not.toContain(`'${APPLY_LABELS.drifted}'`);
      expect(source).not.toContain(`>${APPLY_LABELS.drifted}<`);
    }
  });
});

/* ── AC-16.5 — nothing moves ──────────────────────────────────────────────── */

describe('AC-16.5 nothing moves', () => {
  it('declares no keyframes', () => {
    expect(STUDIO_CSS).not.toContain('@keyframes');
  });

  it('animates nothing', () => {
    const animated = blocks.filter((block) => /(^|[\s;])animation\s*:/.test(block.body));
    expect(animated.map((block) => block.selector)).toEqual([]);
  });

  it('transitions nothing — a verdict resolving changes a colour instantly or not at all', () => {
    const eased = blocks.filter((block) => /(^|[\s;])transition[\w-]*\s*:/.test(block.body));
    expect(eased.map((block) => block.selector)).toEqual([]);
  });

  it('leaves the caret standing still while a change is in flight', () => {
    expect(STUDIO_CSS).not.toContain('travelling');
    const app = fileURLToPath(new URL('../src/app/', import.meta.url));
    for (const name of readdirSync(app).filter((file) => file.endsWith('.tsx'))) {
      expect(readFileSync(path.join(app, name), 'utf8')).not.toContain('travelling');
    }
  });
});

/* ── AC-16.6 — the shape language ─────────────────────────────────────────── */

describe('AC-16.6 hairlines, not shadows', () => {
  it('draws every border as a 1px hairline in the line token', () => {
    const borders = blocks.flatMap((block) =>
      [...block.body.matchAll(/border(?:-(?:top|right|bottom|left))?:\s*([^;]+);/g)].map(
        (match) => ({ selector: block.selector, value: match[1]!.trim() }),
      ),
    );
    expect(borders.length).toBeGreaterThan(6);
    for (const border of borders) {
      if (border.value === '0' || border.value.endsWith('transparent')) continue;
      expect(border.value, `${border.selector}: ${border.value}`).toMatch(
        /^1px solid var\(--sv-(line|text|accent)\)$/,
      );
    }
  });

  it('reserves elevation for the one card that floats', () => {
    const elevated = blocks.filter((block) => /box-shadow:\s*(?!none)/.test(block.body));
    expect(elevated.map((block) => block.selector.split(' ').pop())).toEqual(['.sv-connect__card']);
  });

  it('spends no shadow on a colour of its own', () => {
    // The shadow is mixed from the ink token, so it is warm in light and warm in dark.
    expect(shadowToken()).toContain('var(--sv-text)');
  });
});

/** `--sv-shadow` lives with type and layout, not with the palette. */
function shadowToken(): string {
  return /--sv-shadow:\s*([^;]+);/.exec(STUDIO_CSS)?.[1] ?? '';
}

describe('AC-16.6 radius', () => {
  it('gives panels and cards 10px', () => {
    for (const selector of ['.sv-panel', '.sv-excerpt', '.sv-connect__card', '.sv-notice', '.sv-provider']) {
      expect(rulesFor(selector)[0]?.body, selector).toContain('border-radius: 10px');
    }
  });

  it('gives inputs 8px', () => {
    for (const selector of ['.sv-field__input', '.sv-compose__input', '.sv-notice__command']) {
      expect(rulesFor(selector)[0]?.body, selector).toContain('border-radius: 8px');
    }
  });

  it('makes every action a fully rounded pill — Apply, Revert, Connect and the rest', () => {
    expect(rulesFor('.sv-button')[0]?.body).toContain('border-radius: 999px');
    expect(rulesFor('.sv-theme')[0]?.body).toContain('border-radius: 999px');
  });
});

describe('AC-16.6 uppercase micro-labels do the labelling', () => {
  const LABELS = ['.sv-panel__head', '.sv-field__label', '.sv-row__origin', '.sv-label'];

  it.each(LABELS)('%s is uppercase, 10–11px, 0.08em, muted', (selector) => {
    const rule = rulesFor(selector)[0];
    expect(rule, `${selector} has no rule`).toBeDefined();
    expect(rule!.body).toContain('text-transform: uppercase');
    expect(rule!.body).toContain('letter-spacing: 0.08em');
    expect(rule!.body).toContain('color: var(--sv-muted)');
    const size = Number(/font-size:\s*(\d+)px/.exec(rule!.body)?.[1] ?? 0);
    expect(size, `${selector} font-size`).toBeGreaterThanOrEqual(10);
    expect(size, `${selector} font-size`).toBeLessThanOrEqual(11);
  });

  it('sets them in the UI face, because the mono is now only for code', () => {
    for (const selector of LABELS) {
      expect(rulesFor(selector)[0]?.body ?? '').not.toContain('var(--sv-mono)');
    }
  });
});

/* ── type ─────────────────────────────────────────────────────────────────── */

describe('the type roles §3 assigns', () => {
  it('sets the interface in Inter and the code in a monospace', () => {
    expect(STUDIO_CSS).toContain("--sv-sans: 'Inter'");
    expect(rulesFor('body').some((rule) => rule.body.includes('font-family: var(--sv-sans)'))).toBe(true);
    expect(shadowToken()).not.toBe('');
  });

  it('keeps the mono where alignment and jitter matter, and only there', () => {
    for (const selector of ['.sv-coord', '.sv-excerpt', '.sv-row__loc', '.sv-row__verdict']) {
      expect(rulesFor(selector)[0]?.body, selector).toContain('var(--sv-mono)');
    }
  });

  it('no longer promotes the mono to the display role', () => {
    expect(rulesFor('.sv-connect__title')[0]?.body).toContain('var(--sv-sans)');
  });

  it('tightens tracking at display sizes rather than reaching for a heavier weight', () => {
    const title = rulesFor('.sv-connect__title')[0]?.body ?? '';
    const tracking = Number(/letter-spacing:\s*(-?[\d.]+)em/.exec(title)?.[1] ?? 0);
    expect(tracking).toBeLessThanOrEqual(-0.02);
    const weights = [...STUDIO_CSS.matchAll(/font-weight:\s*(\d+)/g)].map((match) => Number(match[1]));
    expect(weights.length).toBeGreaterThan(0);
    for (const weight of weights) expect([400, 500, 600]).toContain(weight);
  });
});

/* ── AC-12.7, carried forward — the quality floor ─────────────────────────── */

describe('keyboard reachability', () => {
  it('gives every control a visible focus ring', () => {
    for (const selector of ['.sv-button', '.sv-field__input', '.sv-compose__input', '.sv-splitter']) {
      const focus = blocks.find(
        (block) =>
          block.selector.includes(`${selector}:focus-visible`) ||
          (block.selector.includes(selector) && block.selector.includes(':focus-visible')),
      );
      expect(focus, `${selector} has no :focus-visible rule`).toBeDefined();
    }
  });

  it('has a fallback ring for anything that grows a control later', () => {
    expect(rulesFor(':focus-visible').length).toBeGreaterThan(0);
  });
});

describe('the three panels', () => {
  it('are laid out from two variables the splitters write', () => {
    const shell = rulesFor('.sv-shell').find((block) => block.body.includes('var(--sv-changes)'));
    expect(shell).toBeDefined();
    expect(shell?.body).toContain('var(--sv-chat)');
    // The middle column has a floor of its own, so no drag can starve the preview.
    expect(shell?.body).toMatch(/minmax\(\d+px, 1fr\)/);
  });

  it('survives to a laptop width by stacking rather than shrinking', () => {
    expect(STUDIO_CSS).toContain('@media (max-width: 1180px)');
  });
});

describe('AC-16.5 nothing moves when a verdict resolves, either', () => {
  it('reserves the verdict word a slot wide enough for the longest of them', () => {
    const verdict = rulesFor('.sv-row__verdict')[0];
    expect(verdict?.body).toMatch(/min-width:\s*\d+ch/);
    const longest = Math.max(...Object.values(APPLY_LABELS).map((label) => label.length));
    const reserved = Number(/min-width:\s*(\d+)ch/.exec(verdict?.body ?? '')?.[1] ?? 0);
    expect(reserved).toBeGreaterThanOrEqual(longest);
  });

  it('gives a row a floor', () => {
    const row = rulesFor('.sv-row')[0];
    expect(row?.body).toMatch(/min-height:\s*\d+px/);
  });

  it('keeps Revert occupying its space whether or not it is offered', () => {
    const hidden = blocks.find((block) => block.selector.includes("data-offered='false'"));
    expect(hidden?.body).toContain('visibility: hidden');
    expect(hidden?.body).not.toContain('display: none');
  });

  it('marks the selected row with an edge that was always there', () => {
    // A border that appears on selection would move every row's content sideways.
    expect(rulesFor('.sv-row')[0]?.body).toMatch(/border-left:\s*2px solid transparent/);
    const selected = blocks.find((block) => block.selector.includes("data-selected='true'"));
    expect(selected?.body).toContain('border-left-color: var(--sv-accent)');
  });
});
