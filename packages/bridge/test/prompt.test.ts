import { describe, expect, it } from 'vitest';
import { buildPrompt } from '../src/prompt.js';
import { HERO_H1_COL, HERO_H1_LINE, HERO_SOURCE, makeIntent } from './helpers.js';

const prompt = buildPrompt({ intent: makeIntent(), source: HERO_SOURCE });

// AC-3.7
describe('buildPrompt', () => {
  it('names the file and the exact line:col', () => {
    expect(prompt).toContain(`src/Hero.tsx:${HERO_H1_LINE}:${HERO_H1_COL}`);
    expect(prompt).toContain(`line ${HERO_H1_LINE}`);
    expect(prompt).toContain(`column ${HERO_H1_COL}`);
  });

  it('includes a numbered excerpt of the surrounding lines', () => {
    // Every neighbour carries its real line number, not an offset from the target.
    expect(prompt).toMatch(/^\s+2 \|.*return \(/m);
    expect(prompt).toMatch(/^\s+3 \|.*<section className="hero">/m);
    expect(prompt).toMatch(/^\s+5 \|.*<p className="lede">/m);
    expect(prompt).toMatch(/^\s+6 \|.*<\/section>/m);
  });

  it('marks the target line and points a caret at the column', () => {
    expect(prompt).toMatch(/^> 4 \|.*<h1 className="text-5xl font-bold">Swim today<\/h1>/m);
    expect(prompt).toMatch(new RegExp(`\\^ column ${HERO_H1_COL}`));
  });

  it('reads the excerpt from the source it is handed, not from a cached copy', () => {
    const moved = Buffer.concat([Buffer.from('// a new banner comment\r\n', 'utf8'), HERO_SOURCE]);
    const shifted = buildPrompt({ intent: makeIntent({ loc: 'src/Hero.tsx:5:7' }), source: moved });
    expect(shifted).toMatch(/^> 5 \|.*<h1 className="text-5xl font-bold">Swim today<\/h1>/m);
    expect(shifted).toContain('src/Hero.tsx:5:7');
  });

  it('states the change in terms of the resolved intent', () => {
    expect(prompt).toContain('Swim today');
    expect(prompt).toContain('Ship faster');
    expect(prompt).toContain('Replace the heading text with "Ship faster".');
    expect(prompt).toMatch(/\bh1\b/);
  });

  it('states a class change as a class list, not as prose', () => {
    const classPrompt = buildPrompt({
      intent: makeIntent({
        kind: 'class',
        after: {
          text: 'Swim today',
          classes: ['text-6xl', 'font-bold', 'tracking-tight'],
          computed: {},
        },
        instruction: 'Make the heading larger and tighter.',
      }),
      source: HERO_SOURCE,
    });
    expect(classPrompt).toContain('text-5xl font-bold');
    expect(classPrompt).toContain('text-6xl font-bold tracking-tight');
  });

  it('forbids reformatting and edits to any other line', () => {
    expect(prompt).toMatch(/do not reformat/i);
    expect(prompt).toMatch(/no other line/i);
    expect(prompt).toMatch(/line 4/);
  });

  it('instructs the agent to reply BLOCKED and write nothing on a mismatch', () => {
    expect(prompt).toContain('BLOCKED: <reason>');
    expect(prompt).toMatch(/write nothing/i);
  });

  it('contains no instruction to search, locate, or find', () => {
    // The premise of the project: the agent is told the line, so the search
    // step — where agent edits usually go wrong — does not exist.
    expect(prompt).not.toMatch(/\b(search|searches|searching|locate|locating|find|finds|finding|grep|glob|scan|look\s+for)\b/i);
  });

  it('does not blow up when the target sits at the top or bottom of the file', () => {
    const first = buildPrompt({ intent: makeIntent({ loc: 'src/Hero.tsx:1:1' }), source: HERO_SOURCE });
    expect(first).toMatch(/^> 1 \|/m);

    const last = buildPrompt({ intent: makeIntent({ loc: 'src/Hero.tsx:8:1' }), source: HERO_SOURCE });
    expect(last).toMatch(/^> 8 \|/m);
  });
});
