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

  it.each(['src/a.ts', 'src/a.mjs', 'src/a.css'])(
    'returns null for %s — only .js, .jsx and .tsx are considered',
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

const ID = (rel: string): string => `${ROOT.replace(/\\/g, '/')}/${rel}`;

// AC-11.4 — a connected project is not required to have adopted the `.jsx` extension.
// React apps that predate the convention keep JSX in plain `.js`, and an editor that
// stamps nothing in them looks exactly like an editor that is broken.
describe('the vite plugin — JSX in plain .js (AC-11.4)', () => {
  it('stamps JSX in a .js file', () => {
    const result = transform('export const X = () => <div>hi</div>;\n', ID('src/X.js'));
    expect(result).not.toBeNull();
    expect(attr(element(result!.code, 'div'), 'data-sve-eid')).toBe('src/X.js#div:0');
  });

  it('leaves a .js file with no JSX in it untouched', () => {
    expect(transform('export const total = (a, b) => a + b;\n', ID('src/math.js'))).toBeNull();
  });

  it('does not mistake a comparison for a tag', () => {
    expect(transform('export const min = (a, b) => (a <b ? a : b);\n', ID('src/cmp.js'))).toBeNull();
  });

  it('hands unparseable source back untouched rather than throwing', () => {
    // Widening the gate means the pass now sees files nobody wrote for it. A parse error
    // is the app's own, and the app's own plugin reports it far better than we can; what
    // must not happen is the dev server dying inside a `pre` transform that had no
    // business reading the file in the first place.
    const code = 'export const broken = () => <div>{;\n';
    expect(() => transform(code, ID('src/broken.js'))).not.toThrow();
    expect(transform(code, ID('src/broken.js'))).toBeNull();
  });
});

// AC-11.4 — "zero elements stamped is an error surfaced in the UI" needs something
// counting. The pass is the only thing that knows, so it reports; deciding what silence
// *means* belongs to the host, which is the only layer that knows a page was served.
describe('the vite plugin — reporting what it stamped (AC-11.4)', () => {
  function reportsFor(files: ReadonlyArray<readonly [code: string, rel: string]>): unknown[] {
    const seen: unknown[] = [];
    const reporting = sourceLoc({ root: ROOT, onStamp: (report) => seen.push(report) });
    const hook = reporting.transform;
    if (typeof hook !== 'function') throw new Error('transform must be a plain function hook');
    for (const [code, rel] of files) {
      (hook as unknown as (code: string, id: string) => unknown)(code, ID(rel));
    }
    return seen;
  }

  it('reports the element count for every file it stamped', () => {
    expect(reportsFor([['export const X = () => <div><span /></div>;\n', 'src/X.jsx']])).toEqual([
      { file: 'src/X.jsx', elements: 2 },
    ]);
  });

  it('reports zero for a candidate it found nothing in, so silence is visible', () => {
    expect(reportsFor([['export const n = 1;\n', 'src/n.js']])).toEqual([
      { file: 'src/n.js', elements: 0 },
    ]);
  });

  it('says nothing about files it was never asked to consider', () => {
    expect(
      reportsFor([
        ['body { color: red }\n', 'src/a.css'],
        ['export const X = () => <div />;\n', 'node_modules/pkg/X.jsx'],
      ]),
    ).toEqual([]);
  });
});
