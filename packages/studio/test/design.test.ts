/**
 * AC-12.6 and AC-12.7 — the chrome, scaled from a panel to a workspace.
 *
 * `docs/design.md` §1 states three rules and `packages/overlay/test/inspector.test.ts`
 * enforces them against the panel's CSS. The same three are enforced here against the
 * workspace's, because a rule that held at 380px and quietly stopped holding at full width
 * would be a rule nobody was keeping.
 */
import { readFileSync, readdirSync } from 'node:fs';
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

describe('the tokens are the ones docs/design.md fixed', () => {
  it('carries every value unchanged', () => {
    for (const [token, value] of [
      ['--sve-ink', '#0E1116'],
      ['--sve-slab', '#1A1F27'],
      ['--sve-paper', '#F7F4EC'],
      ['--sve-caret', '#3D7BFF'],
      ['--sve-landed', '#35C489'],
      ['--sve-drifted', '#E5484D'],
    ]) {
      expect(STUDIO_CSS).toContain(`${token}: ${value}`);
    }
  });

  it('introduces no second warm surface and no second accent', () => {
    // Any hex outside the token block would be a colour arriving without a name.
    const declared = STUDIO_CSS.slice(0, STUDIO_CSS.indexOf('}'));
    const hexes = [...STUDIO_CSS.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0]);
    for (const hex of hexes) expect(declared).toContain(hex);
  });
});

// "paper is the single warm surface ... Do not reuse it for panels, hovers, or empty states."
describe('paper belongs to the source excerpt alone', () => {
  it('is used exactly once, on the excerpt', () => {
    const users = blocks.filter((block) => block.body.includes('var(--sve-paper)'));
    expect(users).toHaveLength(1);
    expect(users[0]!.selector).toContain('.sv-excerpt');
  });
});

// "The caret is a pointer, so it has its own colour and never doubles as a status."
describe('the caret keeps its own colour', () => {
  it('never carries a verdict colour', () => {
    const caret = blocks.filter((block) => /\.sv-caret\b/.test(block.selector));
    expect(caret.length).toBeGreaterThan(0);
    for (const block of caret) {
      expect(block.body).toContain('var(--sve-caret)');
      expect(block.body).not.toContain('var(--sve-landed)');
      expect(block.body).not.toContain('var(--sve-drifted)');
    }
  });

  it('is also what the chat marks a prompt line with — the same pointer, not a status', () => {
    const marker = blocks.find((block) => block.selector.includes('.sv-turn__marker'));
    expect(marker?.body).toContain('var(--sve-caret)');
  });
});

// "landed / drifted appear nowhere but a verdict."
describe('the verification colours are reserved', () => {
  it('appears only inside something that is a verdict', () => {
    const users = blocks.filter(
      (block) =>
        block.body.includes('var(--sve-landed)') || block.body.includes('var(--sve-drifted)'),
    );
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

describe('type', () => {
  it('keeps Plex Mono in the display role and Plex Sans for prose', () => {
    expect(STUDIO_CSS).toContain('IBM Plex Mono');
    expect(STUDIO_CSS).toContain('IBM Plex Sans');
    for (const selector of ['.sv-coord', '.sv-row__loc', '.sv-connect__title']) {
      expect(rulesFor(selector)[0]?.body).toContain('--sve-mono');
    }
  });
});

describe('motion is spent once, and only on the caret', () => {
  it('animates nothing else', () => {
    const animated = blocks.filter((block) => /(^|\s)animation:/.test(block.body));
    expect(animated.length).toBeGreaterThan(0);
    for (const block of animated) expect(block.selector).toContain('.sv-caret');
  });

  it('collapses to a static state under prefers-reduced-motion', () => {
    expect(STUDIO_CSS).toContain('prefers-reduced-motion');
    const reduced = STUDIO_CSS.slice(STUDIO_CSS.indexOf('prefers-reduced-motion'));
    expect(reduced).toContain('animation: none');
  });
});

/* ── AC-12.7 — the quality floor ──────────────────────────────────────────── */

describe('keyboard reachability', () => {
  it('gives every control a visible focus ring', () => {
    for (const selector of [
      '.sv-button',
      '.sv-field__input',
      '.sv-compose__input',
      '.sv-splitter',
    ]) {
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

describe('nothing moves when a verdict resolves', () => {
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
});
