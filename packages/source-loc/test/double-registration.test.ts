/**
 * AC-14 — the editor registered twice.
 *
 * A project that already has `sve()` in its own Vite config, opened by a host that also
 * injects one, ends up with two `sve:source-loc` instances. The first stamps; the second
 * finds the file already stamped and correctly reports zero. Whichever caller's callback
 * happens to sit on the second one then believes nothing was stamped.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Plugin } from 'vite';
import { sourceLoc, type StampReport } from '../src/index.js';
import type { SourceLocViteOptions } from '../src/vite-plugin.js';

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

  /**
   * AC-14.3, as the host actually produces it.
   *
   * `@sve/host` starts the project's server with `configLoader: 'runner'`, which loads the
   * project's `vite.config.ts` in Vite's own module runner. Our packages are TypeScript,
   * so the runner cannot externalise them: the config's `@sve/source-loc` is a *different
   * module instance* from the host's. Two instances mean two module-scope registries, both
   * of which think they are the first — so both stamp, the second finds every file already
   * stamped, and the host's callback is told the project has no JSX in it.
   *
   * Which is AC-14's bug, arriving through a door AC-14's own fix left open: sharing keyed
   * on a module-scope binding is not sharing at all when the module is loaded twice.
   *
   * Found by connecting `apps/demo` through the studio, which was refused with
   * `no-elements-stamped` while the served module carried every attribute.
   */
  it('shares across module instances, which is how a host actually loads it', async () => {
    // The host's copy, evaluated separately from the one imported at the top of this file.
    vi.resetModules();
    const other = (await import('../src/vite-plugin.js')) as {
      sourceLoc(options?: SourceLocViteOptions): Plugin;
    };
    expect(other.sourceLoc).not.toBe(sourceLoc);

    const config: StampReport[] = [];
    const host: StampReport[] = [];

    await pipeline(
      [
        sourceLoc({ root: '/project', onStamp: (r) => config.push(r) }),
        other.sourceLoc({ root: '/project', onStamp: (r) => host.push(r) }),
      ],
      SOURCE,
      ID,
    );

    expect(config).toEqual([{ file: 'src/X.tsx', elements: 2 }]);
    expect(host).toEqual([{ file: 'src/X.tsx', elements: 2 }]);
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
