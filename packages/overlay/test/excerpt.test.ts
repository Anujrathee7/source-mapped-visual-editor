import { describe, expect, it } from 'vitest';
import { parseLoc } from '@sve/protocol';
import { buildExcerpt, defaultSourceUrl } from '../src/excerpt.js';

// The shape docs/design.md draws the diagnostic around. Every expected number below is
// derived from these bytes, so a reindent here moves the answers rather than hiding a bug.
const SOURCE = [
  'export const Hero = () => (',
  '  <div className="wrap">',
  '    <h1 className="title">',
  '      Swim today',
  '    </h1>',
  '  </div>',
  ');',
].join('\n');

const H1 = parseLoc('apps/demo/src/Hero.tsx:3:5')!;

// AC-4.8
describe('buildExcerpt', () => {
  it('returns the surrounding lines with their real, 1-based numbers', () => {
    const excerpt = buildExcerpt(SOURCE, H1, 2);
    expect(excerpt.lines.map((line) => line.number)).toEqual([1, 2, 3, 4, 5]);
    expect(excerpt.lines.map((line) => line.text)).toEqual([
      'export const Hero = () => (',
      '  <div className="wrap">',
      '    <h1 className="title">',
      '      Swim today',
      '    </h1>',
    ]);
  });

  it('marks exactly one line as the target', () => {
    const excerpt = buildExcerpt(SOURCE, H1, 2);
    expect(excerpt.lines.filter((line) => line.isTarget).map((line) => line.number)).toEqual([3]);
  });

  it('puts the caret under the exact column', () => {
    const excerpt = buildExcerpt(SOURCE, H1, 2);
    expect(excerpt.caret.line).toBe(3);
    expect(excerpt.caret.column).toBe(5);
    // The criterion, stated the only way that cannot be off by one: the character the
    // caret sits under is the opening angle bracket of the element it points at.
    const target = excerpt.lines.find((line) => line.isTarget)!;
    expect(excerpt.caret.offset).toBe(4);
    expect(target.text[excerpt.caret.offset]).toBe('<');
    expect(target.text.slice(excerpt.caret.offset)).toBe('<h1 className="title">');
  });

  it('renders the caret pad as the leading text blanked out, so a monospace row aligns', () => {
    const excerpt = buildExcerpt(SOURCE, H1, 2);
    expect(excerpt.caret.pad).toBe('    ');
    expect(excerpt.caret.pad).toHaveLength(excerpt.caret.column - 1);
  });

  it('keeps tabs as tabs in the pad, since a tab is one column but many pixels', () => {
    const tabbed = ['const a = 1;', '\t\t<h1>hi</h1>'].join('\n');
    const excerpt = buildExcerpt(tabbed, { file: 'x.tsx', line: 2, col: 3 }, 1);
    expect(excerpt.caret.pad).toBe('\t\t');
    const target = excerpt.lines.find((line) => line.isTarget)!;
    expect(target.text[excerpt.caret.offset]).toBe('<');
  });

  it('clamps the window at the start and end of the file', () => {
    expect(buildExcerpt(SOURCE, { file: 'x', line: 1, col: 1 }, 2).lines.map((l) => l.number)).toEqual([
      1, 2, 3,
    ]);
    expect(buildExcerpt(SOURCE, { file: 'x', line: 7, col: 1 }, 2).lines.map((l) => l.number)).toEqual([
      5, 6, 7,
    ]);
  });

  it('splits CRLF without leaving a carriage return in the excerpt', () => {
    const crlf = SOURCE.split('\n').join('\r\n');
    const excerpt = buildExcerpt(crlf, H1, 1);
    for (const line of excerpt.lines) expect(line.text).not.toContain('\r');
    expect(excerpt.lines.find((line) => line.isTarget)!.text).toBe('    <h1 className="title">');
  });

  it('clamps a column past the end of the line instead of padding past it', () => {
    const excerpt = buildExcerpt(SOURCE, { file: 'x', line: 7, col: 999 }, 0);
    expect(excerpt.caret.offset).toBe(');'.length);
    expect(excerpt.caret.pad).toBe('  ');
  });

  it('clamps a line past the end of the file rather than returning nothing', () => {
    const excerpt = buildExcerpt(SOURCE, { file: 'x', line: 999, col: 1 }, 1);
    expect(excerpt.lines.length).toBeGreaterThan(0);
    expect(excerpt.caret.line).toBe(7);
  });

  it('handles a one-line file', () => {
    const excerpt = buildExcerpt('<h1 />', { file: 'x', line: 1, col: 1 }, 3);
    expect(excerpt.lines).toEqual([{ number: 1, text: '<h1 />', isTarget: true }]);
    expect(excerpt.caret.offset).toBe(0);
  });

  it('returns an empty excerpt for empty source rather than throwing', () => {
    const excerpt = buildExcerpt('', { file: 'x', line: 1, col: 1 }, 2);
    expect(excerpt.lines).toEqual([{ number: 1, text: '', isTarget: true }]);
    expect(excerpt.caret.offset).toBe(0);
  });
});

// AC-4.8 — "fetched from the dev server". A loc is project-relative; Vite serves from its
// own root, so the mapping between the two is a parameter, not a guess.
describe('defaultSourceUrl', () => {
  it('serves a loc under the vite root as a root-relative url', () => {
    expect(defaultSourceUrl('apps/demo/src/Hero.tsx', 'apps/demo')).toBe('/src/Hero.tsx');
    expect(defaultSourceUrl('apps/demo/src/Hero.tsx', 'apps/demo/')).toBe('/src/Hero.tsx');
  });

  it('passes a loc through unchanged when no root is configured', () => {
    expect(defaultSourceUrl('src/Hero.tsx', '')).toBe('/src/Hero.tsx');
  });

  it('leaves a loc outside the root alone rather than mangling it', () => {
    expect(defaultSourceUrl('packages/overlay/src/x.tsx', 'apps/demo')).toBe(
      '/packages/overlay/src/x.tsx',
    );
  });
});
