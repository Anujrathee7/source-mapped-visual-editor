// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { EDIT_STATUSES, parseLoc } from '@sve/protocol';
import {
  APPLY_LABELS,
  CHROME_CSS,
  TEXT_EXPRESSION_REASON,
  blastRadiusMessage,
  classFieldState,
  styleFieldState,
  textFieldState,
} from '../src/inspector.js';
import { HOST_ATTR, mountOverlay, type OverlayHandle } from '../src/mount.js';
import {
  CARD_EID,
  H1_EID,
  H1_LOC,
  P_EID,
  SECTION_EID,
  fetchFixtureSource,
  renderPage,
} from './fixture.js';
import { resetDocument, tick } from './support.js';

let handle: OverlayHandle | null = null;

afterEach(() => {
  handle?.unmount();
  handle = null;
  resetDocument();
});

/**
 * The fixture's elements as the anchors AC-8.3's `select` takes: an eid and an index, the
 * only two things a caller outside the document could know.
 */
const ANCHORS: Record<string, { eid: string; eidIndex: number }> = {
  h1: { eid: H1_EID, eidIndex: 0 },
  p: { eid: P_EID, eidIndex: 0 },
  article: { eid: CARD_EID, eidIndex: 0 },
  section: { eid: SECTION_EID, eidIndex: 0 },
};

const anchorFor = (selector: string): { eid: string; eidIndex: number } => {
  const anchor = ANCHORS[selector];
  if (!anchor) throw new Error(`no anchor for ${selector}`);
  return anchor;
};

async function selectFixture(selector: string): Promise<ShadowRoot> {
  renderPage();
  handle = mountOverlay({ fetchSource: fetchFixtureSource });
  handle!.select(anchorFor(selector));
  await tick();
  return document.querySelector(`[${HOST_ATTR}]`)!.shadowRoot!;
}

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

// AC-4.6 — the exact sentence the criterion writes.
describe('blastRadiusMessage', () => {
  it('states the count in plain language', () => {
    expect(blastRadiusMessage(6)).toBe('6 elements render from this line — the edit hits all 6.');
    expect(blastRadiusMessage(2)).toBe('2 elements render from this line — the edit hits all 2.');
  });

  it('says nothing when there is nothing to warn about', () => {
    expect(blastRadiusMessage(1)).toBeNull();
    expect(blastRadiusMessage(0)).toBeNull();
  });

  it('is shown for a shared instance and hidden for a lone one', async () => {
    let chrome = await selectFixture('article');
    expect(chrome.querySelector('.sve-blast')!.textContent).toContain(
      '6 elements render from this line — the edit hits all 6.',
    );
    expect((chrome.querySelector('.sve-blast') as HTMLElement).hidden).toBe(false);

    handle!.select(anchorFor('h1'));
    await tick();
    chrome = document.querySelector(`[${HOST_ATTR}]`)!.shadowRoot!;
    expect((chrome.querySelector('.sve-blast') as HTMLElement).hidden).toBe(true);
  });
});

// AC-4.7 — "A disabled control always shows why. Silently ignoring input is a failure of
// this criterion."
describe('disabled controls state their reason', () => {
  it.each(['dynamic', 'mixed'] as const)('disables the text field for %s', (kind) => {
    expect(textFieldState(kind)).toEqual({
      disabled: true,
      reason: 'This text comes from an expression — edit the data, not the markup.',
    });
    expect(TEXT_EXPRESSION_REASON).toBe(
      'This text comes from an expression — edit the data, not the markup.',
    );
  });

  it('leaves the text field live for a static literal', () => {
    expect(textFieldState('static')).toEqual({ disabled: false, reason: null });
  });

  it('disables the text field with a reason when there is no text at all', () => {
    const state = textFieldState('none');
    expect(state.disabled).toBe(true);
    expect(state.reason).toBeTruthy();
  });

  it.each(['dynamic', 'none'] as const)('disables the class editor for %s, with a reason', (kind) => {
    const state = classFieldState(kind);
    expect(state.disabled).toBe(true);
    expect(state.reason).toBeTruthy();
  });

  it('leaves the class editor live for a literal className', () => {
    expect(classFieldState('literal')).toEqual({ disabled: false, reason: null });
  });

  // AC-4.7 — "the style panel stays live, because a style override does not require a
  // literal className to edit."
  it.each(['literal', 'dynamic', 'none'] as const)('keeps the style panel live for %s', (kind) => {
    expect(styleFieldState(kind)).toEqual({ disabled: false, reason: null });
  });

  it('renders the disabled state and its reason together, never one without the other', async () => {
    const chrome = await selectFixture('p');
    const text = chrome.querySelector<HTMLInputElement>('[data-sve-field="text"]')!;
    expect(text.disabled).toBe(true);
    expect(chrome.querySelector('[data-sve-reason="text"]')!.textContent).toBe(
      TEXT_EXPRESSION_REASON,
    );

    const className = chrome.querySelector<HTMLInputElement>('[data-sve-field="class"]')!;
    expect(className.disabled).toBe(true);
    expect(chrome.querySelector('[data-sve-reason="class"]')!.textContent).toBeTruthy();

    for (const input of chrome.querySelectorAll<HTMLInputElement>('[data-sve-style]')) {
      expect(input.disabled).toBe(false);
    }
  });

  it('leaves both live on an element with a literal className and literal text', async () => {
    const chrome = await selectFixture('h1');
    expect(chrome.querySelector<HTMLInputElement>('[data-sve-field="text"]')!.disabled).toBe(false);
    expect(chrome.querySelector<HTMLInputElement>('[data-sve-field="class"]')!.disabled).toBe(false);
    expect(chrome.querySelector('[data-sve-reason="text"]')!.textContent).toBe('');
  });

  it('does not write an override from a disabled field', async () => {
    const chrome = await selectFixture('p');
    const text = chrome.querySelector<HTMLInputElement>('[data-sve-field="text"]')!;
    text.value = 'not allowed';
    text.dispatchEvent(new Event('input', { bubbles: true }));
    expect(handle!.getOverride(P_EID)).toBeUndefined();
  });
});

// AC-4.8
describe('the inspector renders a real diagnostic', () => {
  it('shows a coordinate headline matching data-sve-loc exactly', async () => {
    const chrome = await selectFixture('h1');
    const file = chrome.querySelector('.sve-coord__file')!.textContent;
    const position = chrome.querySelector('.sve-coord__pos')!.textContent;
    expect(`${file}:${position}`).toBe(H1_LOC);
    expect(document.querySelector('h1')!.getAttribute('data-sve-loc')).toBe(`${file}:${position}`);
  });

  it('shows the surrounding lines with their real numbers', async () => {
    const chrome = await selectFixture('h1');
    const numbers = Array.from(chrome.querySelectorAll('.sve-excerpt__line')).map((line) =>
      line.querySelector('.sve-excerpt__no')!.textContent,
    );
    expect(numbers).toEqual(['1', '2', '3', '4', '5']);

    const target = chrome.querySelector('.sve-excerpt__line[data-target]')!;
    expect(target.querySelector('.sve-excerpt__no')!.textContent).toBe('3');
    expect(target.querySelector('.sve-excerpt__text')!.textContent).toBe('    <h1 className="title">');
  });

  it('puts the caret under the exact column', async () => {
    const chrome = await selectFixture('h1');
    const loc = parseLoc(H1_LOC)!;
    const pad = chrome.querySelector('.sve-caret-pad')!.textContent!;
    const target = chrome.querySelector('.sve-excerpt__line[data-target] .sve-excerpt__text')!
      .textContent!;

    expect(pad).toHaveLength(loc.col - 1);
    // Off-by-one here is a failed criterion, so the assertion is on the character the
    // caret lands on rather than on a number that could be wrong in both places at once.
    expect(target[pad.length]).toBe('<');
    expect(target.slice(pad.length)).toBe('<h1 className="title">');
    expect(chrome.querySelector('.sve-caret')!.textContent).toBe('^');
  });

  it('moves the caret when a different element is selected', async () => {
    const chrome = await selectFixture('h1');
    handle!.select(anchorFor('p'));
    await tick();

    const target = chrome.querySelector('.sve-excerpt__line[data-target]')!;
    expect(target.querySelector('.sve-excerpt__no')!.textContent).toBe('6');
    const pad = chrome.querySelector('.sve-caret-pad')!.textContent!;
    expect(target.querySelector('.sve-excerpt__text')!.textContent![pad.length]).toBe('<');
  });

  it('says so rather than rendering a wrong excerpt when the source cannot be read', async () => {
    renderPage();
    handle = mountOverlay({ fetchSource: async () => null });
    handle!.select(anchorFor('h1'));
    await tick();

    const chrome = document.querySelector(`[${HOST_ATTR}]`)!.shadowRoot!;
    expect(chrome.querySelector('.sve-excerpt__line')).toBeNull();
    expect(chrome.querySelector('.sve-excerpt')!.textContent).toBeTruthy();
    // The coordinate is known even when the file is not, so it still shows.
    expect(chrome.querySelector('.sve-coord__pos')!.textContent).toBe('3:5');
  });
});

// docs/design.md §1 and AC-4.8's last bullet.
describe('the chrome follows the design direction', () => {
  it('defines every token the design names', () => {
    for (const [token, value] of [
      ['--sve-ink', '#0E1116'],
      ['--sve-slab', '#1A1F27'],
      ['--sve-paper', '#F7F4EC'],
      ['--sve-caret', '#3D7BFF'],
      ['--sve-landed', '#35C489'],
      ['--sve-drifted', '#E5484D'],
    ]) {
      expect(CHROME_CSS).toContain(`${token}: ${value}`);
    }
  });

  // "Verification colours (landed, drifted) appear nowhere except a verification result."
  it('uses the verification colours only inside a verification result', () => {
    const users = declarationBlocks(CHROME_CSS).filter(
      (block) => block.body.includes('var(--sve-landed)') || block.body.includes('var(--sve-drifted)'),
    );
    expect(users.length).toBeGreaterThan(0);
    for (const block of users) expect(block.selector).toContain('.sve-verdict');
  });

  // "The caret is a pointer, so it has its own colour and never doubles as a status."
  it('gives the caret its own colour', () => {
    const caret = declarationBlocks(CHROME_CSS).filter((block) => /\.sve-caret\b/.test(block.selector));
    expect(caret.length).toBeGreaterThan(0);
    for (const block of caret) {
      expect(block.body).toContain('var(--sve-caret)');
      expect(block.body).not.toContain('var(--sve-landed)');
      expect(block.body).not.toContain('var(--sve-drifted)');
    }
  });

  // "paper is the single warm surface ... Do not reuse it for panels, hovers, or empty
  // states."
  it('uses the paper surface for the source excerpt and nothing else', () => {
    const users = declarationBlocks(CHROME_CSS).filter((block) =>
      block.body.includes('var(--sve-paper)'),
    );
    expect(users).toHaveLength(1);
    expect(users[0]!.selector).toContain('.sve-excerpt');
  });

  it('promotes IBM Plex Mono to the display role and keeps Plex Sans for prose', () => {
    expect(CHROME_CSS).toContain('IBM Plex Mono');
    expect(CHROME_CSS).toContain('IBM Plex Sans');
    const coordinate = declarationBlocks(CHROME_CSS).find((block) =>
      /\.sve-coord\b/.test(block.selector),
    )!;
    expect(coordinate.body).toContain('--sve-mono');
  });

  it('respects prefers-reduced-motion', () => {
    expect(CHROME_CSS).toContain('prefers-reduced-motion');
  });

  it('spends its one animation on the caret and nowhere else', () => {
    const animated = declarationBlocks(CHROME_CSS).filter((block) =>
      /(^|\s)animation:/.test(block.body),
    );
    for (const block of animated) expect(block.selector).toContain('.sve-caret');
  });
});

// docs/design.md §1: "Apply -> Applying... -> Landed / Drifted / Blocked / Stalled".
describe('the copy carries one verb through the flow', () => {
  it('labels every phase', () => {
    expect(APPLY_LABELS.idle).toBe('Apply');
    expect(APPLY_LABELS.applying).toBe('Applying…');
    expect(APPLY_LABELS.landed).toBe('Landed');
    expect(APPLY_LABELS.drifted).toBe('Drifted');
    expect(APPLY_LABELS.blocked).toBe('Blocked');
    expect(APPLY_LABELS.stalled).toBe('Stalled');
  });

  it('has a label for every status the protocol can report', () => {
    for (const status of EDIT_STATUSES) expect(APPLY_LABELS[status]).toBeTruthy();
  });

  it('shows no verdict until M6 sets one', async () => {
    const chrome = await selectFixture('h1');
    expect((chrome.querySelector('.sve-verdict') as HTMLElement).hidden).toBe(true);
    expect(chrome.querySelector('.sve-apply')!.textContent).toBe('Apply');

    handle!.setPhase('applying');
    await tick();
    expect(chrome.querySelector('.sve-apply')!.textContent).toBe('Applying…');

    handle!.setVerdict(H1_EID, { status: 'drifted', message: 'The file changed but the result does not match.' });
    await tick();
    const verdict = chrome.querySelector('.sve-verdict') as HTMLElement;
    expect(verdict.hidden).toBe(false);
    expect(verdict.dataset.status).toBe('drifted');
    expect(verdict.textContent).toContain('Drifted');
  });

  it('shows both sides of a mismatch, as AC-5.2 requires', async () => {
    const chrome = await selectFixture('h1');
    handle!.setVerdict(H1_EID, {
      status: 'drifted',
      mismatch: [{ prop: 'color', intent: '#3b82f6', rendered: 'rgb(14, 17, 22)' }],
    });
    await tick();
    const verdict = chrome.querySelector('.sve-verdict')!.textContent!;
    expect(verdict).toContain('#3b82f6');
    expect(verdict).toContain('rgb(14, 17, 22)');
  });

  it('keeps a verdict with the element it belongs to', async () => {
    const chrome = await selectFixture('h1');
    handle!.setVerdict(H1_EID, { status: 'landed' });
    await tick();
    expect((chrome.querySelector('.sve-verdict') as HTMLElement).hidden).toBe(false);

    handle!.select(anchorFor('article'));
    await tick();
    expect((chrome.querySelector('.sve-verdict') as HTMLElement).hidden).toBe(true);

    handle!.select(anchorFor('h1'));
    await tick();
    expect((chrome.querySelector('.sve-verdict') as HTMLElement).hidden).toBe(false);
    expect(CARD_EID).not.toBe(H1_EID);
  });
});

// AC-4.3 / AC-4.7 — typing is the path from a live control to an override.
describe('editing writes overrides', () => {
  it('writes a text override as the user types, before any network call', async () => {
    const chrome = await selectFixture('h1');
    const input = chrome.querySelector<HTMLInputElement>('[data-sve-field="text"]')!;
    input.value = 'Ship faster';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(handle!.getOverride(H1_EID)).toEqual({ text: 'Ship faster' });
    expect(document.querySelector('h1')!.textContent).toBe('Ship faster');
  });

  it('writes a style override from the style panel even where the className is dynamic', async () => {
    const chrome = await selectFixture('p');
    const color = chrome.querySelector<HTMLInputElement>('[data-sve-style="color"]')!;
    color.value = '#3b82f6';
    color.dispatchEvent(new Event('input', { bubbles: true }));

    expect(handle!.getOverride(P_EID)?.style).toEqual({ color: '#3b82f6' });
  });

  it('splits a class edit into what was added and what was removed', async () => {
    const chrome = await selectFixture('h1');
    const input = chrome.querySelector<HTMLInputElement>('[data-sve-field="class"]')!;
    expect(input.value).toBe('title');

    input.value = 'title text-6xl';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(handle!.getOverride(H1_EID)).toEqual({ classes: { add: ['text-6xl'], remove: [] } });

    input.value = 'text-6xl';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(handle!.getOverride(H1_EID)).toEqual({ classes: { add: ['text-6xl'], remove: ['title'] } });
  });
});
