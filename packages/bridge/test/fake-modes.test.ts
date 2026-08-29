import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { createFakeAgent } from '../src/agent/fake.js';
import {
  CRLF,
  METHOD_H2_LINE,
  METHOD_SOURCE,
  METHOD_SOURCE_LINES,
  cleanupTempDirs,
  HERO_SOURCE,
  makeAgentContext,
  makeProject,
  makeSpanningIntent,
  makeSpanningProject,
} from './helpers.js';

afterAll(cleanupTempDirs);

const linesOf = (file: string): string[] => readFileSync(file).toString('utf8').split(CRLF);

/**
 * AC-3.5's four modes are covered next door, against a single-line element. These are the
 * cases M6 needed and M4 had no reason to: an element whose edit does not live on the line
 * it was stamped at, and the two modes AC-5.3 and AC-5.4 are proven with.
 */

/* ── the element, not the line ────────────────────────────────────────────── */

describe('the fake agent, on an element that spans lines', () => {
  /**
   * `data-sve-loc` marks where an element *begins*. Every heading in the demo is formatted
   * like this `<h2>` — the className on the next line, the text three lines below — so an
   * agent that could only rewrite the stamped line could not edit any of them.
   *
   * This is not the search step CLAUDE.md forbids: the agent is told the element and where
   * it begins, and the window stops at that element's own closing tag.
   */
  it('edits the text where the text is, not where the tag opens', async () => {
    const { root, file } = makeSpanningProject();
    const { ctx } = makeAgentContext({ root, file, intent: makeSpanningIntent() });

    const outcome = await createFakeAgent({ mode: 'correct' }).run(ctx);

    expect(outcome.kind).toBe('edited');
    const after = linesOf(file);
    expect(after[METHOD_H2_LINE - 1]).toBe('      <h2');
    expect(after[METHOD_H2_LINE + 3]).toBe('        How we decide');
    expect(after).toHaveLength(METHOD_SOURCE_LINES.length + 1);
  });

  it('rewrites a className that sits below the opening line', async () => {
    const { root, file } = makeSpanningProject();
    const intent = makeSpanningIntent({
      kind: 'class',
      after: {
        text: 'How we call it',
        classes: ['text-3xl'],
        computed: { color: 'rgb(228, 235, 232)' },
      },
    });
    const { ctx } = makeAgentContext({ root, file, intent });

    expect((await createFakeAgent({ mode: 'correct' }).run(ctx)).kind).toBe('edited');
    expect(readFileSync(file).toString('utf8')).toContain('className="text-3xl"');
  });

  it('still refuses when the element is not what the intent described', async () => {
    const { root, file } = makeSpanningProject();
    const intent = makeSpanningIntent({
      before: { text: 'Something else entirely', classes: [], computed: {} },
    });
    const { ctx } = makeAgentContext({ root, file, intent });

    expect((await createFakeAgent({ mode: 'correct' }).run(ctx)).kind).toBe('blocked');
    expect(Buffer.compare(readFileSync(file), METHOD_SOURCE)).toBe(0);
  });
});

/* ── the two modes the verifier is proven with ────────────────────────────── */

describe('equivalent mode', () => {
  const colourEdit = () =>
    makeSpanningIntent({
      kind: 'class',
      after: {
        text: 'How we call it',
        classes: ['text-3xl'],
        computed: { color: 'rgb(228, 235, 232)' },
      },
    });

  // AC-5.3: source text the overlay never sent, resolving to the value it asked for.
  it('writes a class the overlay never sent that resolves to the intended colour', async () => {
    const { root, file } = makeSpanningProject();
    const { ctx } = makeAgentContext({ root, file, intent: colourEdit() });

    expect((await createFakeAgent({ mode: 'equivalent' }).run(ctx)).kind).toBe('edited');
    const after = readFileSync(file).toString('utf8');
    expect(after).toContain('text-[#e4ebe8]');
    expect(after).not.toContain('text-kelp');
  });

  it('wrong mode is its mirror: as plausible, and a different colour', async () => {
    const { root, file } = makeSpanningProject();
    const { ctx } = makeAgentContext({ root, file, intent: colourEdit() });

    expect((await createFakeAgent({ mode: 'wrong' }).run(ctx)).kind).toBe('edited');
    const after = readFileSync(file).toString('utf8');
    expect(after).toMatch(/text-\[#[0-9a-f]{6}\]/);
    expect(after).not.toContain('text-[#e4ebe8]');
  });
});

describe('verbose mode', () => {
  // AC-5.4 needs a write that moves the element it edited, not only the lines below it.
  it('applies the intent and adds a line above it, shifting every line below', async () => {
    const { root, file } = makeProject();
    const { ctx } = makeAgentContext({ root, file });

    expect((await createFakeAgent({ mode: 'verbose' }).run(ctx)).kind).toBe('edited');

    const before = HERO_SOURCE.toString('utf8').split(CRLF);
    const after = linesOf(file);
    expect(after).toHaveLength(before.length + 1);
    expect(after[3]).toContain('edited by the visual editor');
    // The heading moved down a line, and still says what was asked for.
    expect(after[4]).toContain('>Ship faster<');
    // CRLF and the trailing newline survive an insertion, not only a replacement.
    expect(readFileSync(file).subarray(-2).toString('binary')).toBe(CRLF);
  });
});

/* ── the control channel ──────────────────────────────────────────────────── */

describe('the fake agent directive', () => {
  const withToken = (token: string) =>
    makeSpanningIntent({
      kind: 'class',
      after: {
        text: 'How we call it',
        classes: ['text-3xl', token],
        computed: { color: 'rgb(228, 235, 232)' },
      },
    });

  /**
   * A class edit's instruction is generated from the class list, so a browser-driven test
   * has no prose to hide a directive in. The token rides as a class and must never reach
   * the file: it is the fake's own control channel, not part of the user's edit.
   */
  it('takes its mode from a class token', async () => {
    const { root, file } = makeSpanningProject();
    const { ctx } = makeAgentContext({ root, file, intent: withToken('[sve:fake=blocked]') });

    expect((await createFakeAgent({ mode: 'correct' }).run(ctx)).kind).toBe('blocked');
    expect(Buffer.compare(readFileSync(file), METHOD_SOURCE)).toBe(0);
  });

  it('strips the token rather than writing it into the file', async () => {
    const { root, file } = makeSpanningProject();
    const { ctx } = makeAgentContext({ root, file, intent: withToken('[sve:fake=correct]') });

    expect((await createFakeAgent().run(ctx)).kind).toBe('edited');
    expect(readFileSync(file).toString('utf8')).not.toContain('sve:fake');
  });
});
