import { describe, expect, it } from 'vitest';
import { formatLoc, parseLoc } from '../src/index.js';

// AC-0.1
describe('parseLoc / formatLoc', () => {
  it('parses a posix loc', () => {
    expect(parseLoc('apps/demo/src/Hero.tsx:42:7')).toEqual({
      file: 'apps/demo/src/Hero.tsx',
      line: 42,
      col: 7,
    });
  });

  it('round-trips', () => {
    const s = 'apps/demo/src/components/Hero.tsx:1:1';
    expect(formatLoc(parseLoc(s)!)).toBe(s);
  });

  it('keeps windows separators and drive letters out of the coordinates', () => {
    expect(parseLoc('apps\demo\src\Hero.tsx:42:7')).toEqual({
      file: 'apps\demo\src\Hero.tsx',
      line: 42,
      col: 7,
    });
    expect(parseLoc('C:\work\demo\Hero.tsx:42:7')).toEqual({
      file: 'C:\work\demo\Hero.tsx',
      line: 42,
      col: 7,
    });
  });

  it.each([
    ['no colons', 'Hero.tsx'],
    ['one colon', 'Hero.tsx:42'],
    ['non-numeric line', 'Hero.tsx:x:7'],
    ['non-numeric col', 'Hero.tsx:42:y'],
    ['zero line', 'Hero.tsx:0:7'],
    ['negative col', 'Hero.tsx:42:-1'],
    ['empty file', ':42:7'],
    ['empty string', ''],
  ])('returns null for %s', (_label, input) => {
    expect(parseLoc(input)).toBeNull();
  });
});
