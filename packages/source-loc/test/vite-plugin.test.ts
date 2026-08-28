import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLoc } from '@sve/protocol';
import { sourceLoc } from '../src/index.js';
import { FIXTURE, attr, element } from './support.js';

const ROOT = path.resolve('apps', 'demo');
const FIXTURE_ID = `${ROOT.replace(/\\/g, '/')}/src/Sample.tsx`;

interface Transformed {
  code: string;
  map: unknown;
}

const plugin = sourceLoc({ root: ROOT });

function transform(code: string, id: string): Transformed | null {
  const hook = plugin.transform;
  if (typeof hook !== 'function') throw new Error('transform must be a plain function hook');
  return (hook as unknown as (code: string, id: string) => Transformed | null)(code, id);
}

// AC-1.7
describe('the vite plugin', () => {
  it('is dev-only and runs before the react plugin', () => {
    expect(plugin.name).toBe('sve:source-loc');
    expect(plugin.enforce).toBe('pre');
    expect(plugin.apply).toBe('serve');
  });

  it('returns code and a non-null source map', () => {
    const result = transform(FIXTURE, FIXTURE_ID);
    expect(result).not.toBeNull();
    expect(result!.map).not.toBeNull();
    expect(result!.map).toBeTypeOf('object');
    expect((result!.map as { mappings?: string }).mappings).toBeTruthy();
  });

  it('stamps against a project-relative path', () => {
    const result = transform(FIXTURE, FIXTURE_ID)!;
    const loc = parseLoc(attr(element(result.code, 'section'), 'data-sve-loc')!)!;
    expect(loc.file).toBe('src/Sample.tsx');
    expect(loc.line).toBe(5);
    expect(loc.col).toBe(5);
  });

  it('accepts a native path id and still emits forward slashes', () => {
    const nativeId = path.join(ROOT, 'src', 'Sample.tsx');
    const result = transform(FIXTURE, nativeId)!;
    expect(attr(element(result.code, 'section'), 'data-sve-eid')).toBe(
      'src/Sample.tsx#section:0',
    );
  });

  it('ignores the query vite appends to an id', () => {
    const result = transform(FIXTURE, `${FIXTURE_ID}?t=1730000000000`);
    expect(result).not.toBeNull();
    expect(result!.code).toContain('data-sve-loc');
  });

  it('returns null for files under node_modules', () => {
    expect(transform(FIXTURE, `${ROOT.replace(/\\/g, '/')}/node_modules/pkg/Sample.tsx`)).toBeNull();
  });

  it.each(['src/a.ts', 'src/a.js', 'src/a.mjs', 'src/a.css'])(
    'returns null for %s — only .jsx and .tsx are considered',
    (rel) => {
      expect(transform(FIXTURE, `${ROOT.replace(/\\/g, '/')}/${rel}`)).toBeNull();
    },
  );

  it('returns null for a .tsx file containing no JSX', () => {
    const code = 'export const total = (a: number, b: number): number => a + b;\n';
    expect(transform(code, `${ROOT.replace(/\\/g, '/')}/src/math.tsx`)).toBeNull();
  });

  it('transforms .jsx as well as .tsx', () => {
    const result = transform('export const X = () => <div />;\n', `${ROOT.replace(/\\/g, '/')}/src/X.jsx`);
    expect(result).not.toBeNull();
    expect(attr(element(result!.code, 'div'), 'data-sve-eid')).toBe('src/X.jsx#div:0');
  });
});
