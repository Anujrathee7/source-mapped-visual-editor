/**
 * AC-14 — the editor registered twice.
 *
 * A project that already has `sve()` in its own Vite config, opened by a host that also
 * injects one, ends up with two `sve:source-loc` instances. The first stamps; the second
 * finds the file already stamped and correctly reports zero. Whichever caller's callback
 * happens to sit on the second one then believes nothing was stamped.
 */
import { describe, expect, it } from 'vitest';
import type { Plugin } from 'vite';
import { sourceLoc, type StampReport } from '../src/index.js';

const SOURCE = [
  'export const X = () => (',
  '  <section className="wrap">',
  '    <h1>Swim today</h1>',
  '  </section>',
  ');',
].join('\n');

const ID = '/project/src/X.tsx';

/** Runs a chain of plugins the way Vite's `serve` pipeline would: each sees the last output. */
async function pipeline(plugins: Plugin[], code: string, id: string): Promise<string> {
  const config = { root: '/project' } as never;
  let current = code;
  for (const plugin of plugins) {
    (plugin.configResolved as ((c: never) => void) | undefined)?.call(plugin, config);
  }
  for (const plugin of plugins) {
    const transform = plugin.transform;
    const handler = typeof transform === 'function' ? transform : transform?.handler;
    const result = await (handler as (this: unknown, c: string, i: string) => unknown)?.call(
      {} as unknown,
      current,
      id,
    );
    if (result && typeof result === 'object' && 'code' in result) {
      current = (result as { code: string }).code;
    }
  }
  return current;
}

describe('registering the editor twice', () => {
  // AC-14.1
  it('stamps once, with no duplicated attributes', async () => {
    const out = await pipeline(
      [sourceLoc({ root: '/project' }), sourceLoc({ root: '/project' })],
      SOURCE,
      ID,
    );

    expect(out.split('data-sve-loc').length - 1).toBe(2);
    expect(out.split('data-sve-eid').length - 1).toBe(2);
  });

  // AC-14.2
  it('tells both registrations what the single pass produced', async () => {
    const first: StampReport[] = [];
    const second: StampReport[] = [];

    await pipeline(
      [
        sourceLoc({ root: '/project', onStamp: (r) => first.push(r) }),
        sourceLoc({ root: '/project', onStamp: (r) => second.push(r) }),
      ],
      SOURCE,
      ID,
    );

    expect(first).toEqual([{ file: 'src/X.tsx', elements: 2 }]);
    // The bug: this one used to receive `elements: 0` and report the project unstamped.
    expect(second).toEqual([{ file: 'src/X.tsx', elements: 2 }]);
  });

  // AC-14.4
  it('leaves a single registration exactly as it was', async () => {
    const only: StampReport[] = [];
    const out = await pipeline(
      [sourceLoc({ root: '/project', onStamp: (r) => only.push(r) })],
      SOURCE,
      ID,
    );

    expect(only).toEqual([{ file: 'src/X.tsx', elements: 2 }]);
    expect(out.split('data-sve-loc').length - 1).toBe(2);
  });
});
