import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { AgentContext, AgentOutcome, AgentRunner } from '../src/agent/types.js';
import { createBridge } from '../src/bridge.js';
import { nodeFs, type BridgeFs } from '../src/fs.js';
import { guardFs, isPathNotPermitted, PathNotPermittedError } from '../src/guarded-fs.js';
import {
  cleanupTempDirs,
  HERO_SOURCE,
  makeIntent,
  makeProject,
  makeTempDir,
  spyFs,
} from './helpers.js';

afterAll(cleanupTempDirs);

function runner(run: (ctx: AgentContext) => Promise<AgentOutcome>, name = 'stub'): AgentRunner {
  return { name, requiresNetwork: false, run };
}

async function thrownBy(call: () => Promise<unknown>): Promise<unknown> {
  try {
    await call();
    return null;
  } catch (error) {
    return error;
  }
}

/** Every member of {@link BridgeFs}, called with one path, so none can be forgotten. */
const CALLS: readonly [keyof BridgeFs, (fs: BridgeFs, target: string) => Promise<unknown>][] = [
  ['readFile', (fs, target) => fs.readFile(target)],
  ['writeFile', (fs, target) => fs.writeFile(target, Buffer.from('pwned', 'utf8'))],
  ['mkdir', (fs, target) => fs.mkdir(target)],
  ['readdir', (fs, target) => fs.readdir(target)],
  ['realpath', (fs, target) => fs.realpath(target)],
  ['lstat', (fs, target) => fs.lstat(target)],
  ['stat', (fs, target) => fs.stat(target)],
];

// AC-7.1
describe('guardFs', () => {
  it.each(CALLS)('refuses %s outside editRoots', async (_name, call) => {
    const { root } = makeProject();
    const elsewhere = makeTempDir('sve-elsewhere-');
    writeFileSync(path.join(elsewhere, 'secret.txt'), 'ssh-rsa AAAA');

    const guarded = guardFs(nodeFs, [root]);
    const error = await thrownBy(() => call(guarded, path.join(elsewhere, 'secret.txt')));
    expect(error).toBeInstanceOf(PathNotPermittedError);
  });

  it.each(CALLS)('allows %s inside editRoots', async (name, call) => {
    const { root } = makeProject();
    const guarded = guardFs(nodeFs, [root]);
    // A directory for the members that want one, a file for the rest.
    const target =
      name === 'readdir' || name === 'mkdir'
        ? path.join(root, 'src')
        : path.join(root, 'src', 'Hero.tsx');
    expect(await thrownBy(() => call(guarded, target))).toBeNull();
  });

  it('leaves the file on disk untouched when a write is refused', async () => {
    const { root } = makeProject();
    const elsewhere = makeTempDir('sve-elsewhere-');
    const secret = path.join(elsewhere, 'secret.txt');
    writeFileSync(secret, 'ssh-rsa AAAA');

    const guarded = guardFs(nodeFs, [root]);
    expect(await thrownBy(() => guarded.writeFile(secret, Buffer.from('pwned', 'utf8')))).toBeInstanceOf(
      PathNotPermittedError,
    );
    expect(readFileSync(secret).toString('utf8')).toBe('ssh-rsa AAAA');

    const unborn = path.join(elsewhere, 'created.txt');
    expect(await thrownBy(() => guarded.writeFile(unborn, Buffer.from('pwned', 'utf8')))).toBeInstanceOf(
      PathNotPermittedError,
    );
    expect(existsSync(unborn)).toBe(false);
  });

  it('resolves a traversing path rather than trusting the string it was handed', async () => {
    const { root } = makeProject();
    const guarded = guardFs(nodeFs, [path.join(root, 'src')]);
    const escaping = path.join(root, 'src', '..', '..', 'outside.txt');
    expect(await thrownBy(() => guarded.readFile(escaping))).toBeInstanceOf(PathNotPermittedError);
  });

  // AC-7.2
  it('names the path and the reason, and is distinguishable from a missing file', async () => {
    const { root } = makeProject();
    const elsewhere = makeTempDir('sve-elsewhere-');
    const secret = path.join(elsewhere, 'secret.txt');
    writeFileSync(secret, 'ssh-rsa AAAA');

    const guarded = guardFs(nodeFs, [root]);

    const denial = await thrownBy(() => guarded.readFile(secret));
    expect(denial).toBeInstanceOf(PathNotPermittedError);
    expect(isPathNotPermitted(denial)).toBe(true);
    expect((denial as PathNotPermittedError).path).toBe(secret);
    expect((denial as PathNotPermittedError).message).toContain(secret);
    expect((denial as PathNotPermittedError).message).toMatch(/outside the configured editRoots/);
    expect((denial as PathNotPermittedError).editRoots).toEqual([root]);

    // The ordinary filesystem error a runner must be able to tell it apart from.
    const missing = await thrownBy(() => guarded.readFile(path.join(root, 'src', 'Nope.tsx')));
    expect(missing).toBeInstanceOf(Error);
    expect(missing).not.toBeInstanceOf(PathNotPermittedError);
    expect(isPathNotPermitted(missing)).toBe(false);
  });

  it('rejects rather than resolving as though the call had succeeded', async () => {
    const { root } = makeProject();
    const elsewhere = makeTempDir('sve-elsewhere-');

    const guarded = guardFs(nodeFs, [root]);
    let settled = 'neither';
    await guarded.writeFile(path.join(elsewhere, 'escape.txt'), Buffer.from('pwned', 'utf8')).then(
      () => {
        settled = 'resolved';
      },
      () => {
        settled = 'rejected';
      },
    );
    expect(settled).toBe('rejected');
  });

  // AC-7.4 — the same guard, so the same behaviours hold through the wrapper
  it('inherits the M4 guard: traversal, symlinks, case, and the empty root list', async () => {
    const { root, file } = makeProject();
    const elsewhere = makeTempDir('sve-linked-');
    writeFileSync(path.join(elsewhere, 'secret.txt'), 'ssh-rsa AAAA');

    const editRoot = path.join(root, 'src');
    const guarded = guardFs(nodeFs, [editRoot]);

    // A junction inside the root that points out of it.
    const link = path.join(editRoot, 'escape');
    symlinkSync(elsewhere, link, 'junction');
    expect(await thrownBy(() => guarded.readFile(path.join(link, 'secret.txt')))).toBeInstanceOf(
      PathNotPermittedError,
    );

    // `<root>/src-generated` is a string prefix match but is not inside.
    expect(
      await thrownBy(() => guarded.readFile(path.join(root, 'src-generated', 'Hero.tsx'))),
    ).toBeInstanceOf(PathNotPermittedError);

    // A spelling the filesystem may well open, which the guard refuses anyway.
    expect(await thrownBy(() => guarded.readFile(path.join(root, 'SRC', 'Hero.tsx')))).toBeInstanceOf(
      PathNotPermittedError,
    );

    // No roots grants nothing, not everything.
    expect(await thrownBy(() => guardFs(nodeFs, []).readFile(file))).toBeInstanceOf(
      PathNotPermittedError,
    );
  });

  // AC-7.6
  it('resolves each path once per call and never walks the tree', async () => {
    const { root, file } = makeProject();
    const spy = spyFs(nodeFs);
    const guarded = guardFs(spy.fs, [root]);

    // The first call also resolves the configured roots. Those are configuration
    // and do not move, so that cost is paid once rather than once per call.
    await guarded.readFile(file);
    spy.reset();

    for (let index = 0; index < 5; index += 1) await guarded.readFile(file);
    expect(spy.calls.filter((name) => name === 'realpath')).toHaveLength(5);

    // Depth must cost nothing: a per-segment walk would show up right here.
    const deep = path.join(root, 'a', 'b', 'c', 'd', 'e', 'f');
    mkdirSync(deep, { recursive: true });
    const buried = path.join(deep, 'Deep.tsx');
    writeFileSync(buried, HERO_SOURCE);

    spy.reset();
    await guarded.readFile(buried);
    expect(spy.calls.filter((name) => name === 'realpath')).toHaveLength(1);
  });
});

describe('the bridge behind the guard', () => {
  // AC-7.1 / AC-7.3 — the runner that never asks
  it('refuses a runner that skips canUseTool and writes straight to ctx.fs', async () => {
    const { root } = makeProject();
    const elsewhere = makeTempDir('sve-elsewhere-');
    const escape = path.join(elsewhere, 'escape.txt');

    const bridge = createBridge({
      root,
      // Deliberately misbehaving: it never consults ctx.canUseTool at all.
      agent: runner(async (ctx) => {
        await ctx.fs.writeFile(escape, Buffer.from('pwned', 'utf8'));
        return { kind: 'edited', files: [escape] };
      }),
    });

    const [result] = await bridge.apply({ intents: [makeIntent()] });

    expect(existsSync(escape)).toBe(false);
    expect(result?.status).toBe('blocked');
    expect(result?.message).toContain(escape);
    bridge.close();
  });

  it('refuses a runner that reads outside editRoots without asking', async () => {
    const { root } = makeProject();
    const elsewhere = makeTempDir('sve-elsewhere-');
    const secret = path.join(elsewhere, 'secret.txt');
    writeFileSync(secret, 'ssh-rsa AAAA');

    let leaked: string | undefined;
    const bridge = createBridge({
      root,
      agent: runner(async (ctx) => {
        leaked = (await ctx.fs.readFile(secret)).toString('utf8');
        return { kind: 'edited', files: [ctx.file] };
      }),
    });

    const [result] = await bridge.apply({ intents: [makeIntent()] });

    expect(leaked).toBeUndefined();
    expect(result?.status).toBe('blocked');
    expect(result?.message).toContain(secret);
    bridge.close();
  });

  // AC-7.3 — both routes to a denial end in the same status
  it('reports blocked whether the runner asked first or was refused by the guard', async () => {
    const { root } = makeProject();
    const elsewhere = makeTempDir('sve-elsewhere-');
    const escape = path.join(elsewhere, 'escape.txt');

    const polite = createBridge({
      root,
      agent: runner(async (ctx) => {
        const permission = await ctx.canUseTool({ tool: 'Write', path: escape });
        if (permission.behavior === 'deny') {
          return { kind: 'blocked', reason: permission.message, message: permission.message };
        }
        return { kind: 'noop' };
      }),
    });
    const [asked] = await polite.apply({ intents: [makeIntent()] });
    polite.close();

    const rude = createBridge({
      root,
      agent: runner(async (ctx) => {
        await ctx.fs.writeFile(escape, Buffer.from('pwned', 'utf8'));
        return { kind: 'edited', files: [escape] };
      }),
    });
    const [unasked] = await rude.apply({ intents: [makeIntent()] });
    rude.close();

    expect(asked?.status).toBe('blocked');
    expect(unasked?.status).toBe('blocked');
    expect(asked?.message).toContain(escape);
    expect(unasked?.message).toContain(escape);
  });

  it('still lets a runner read and write the file it was pointed at', async () => {
    const { root, file } = makeProject();
    const bridge = createBridge({
      root,
      editRoots: [path.join(root, 'src')],
      agent: runner(async (ctx) => {
        const source = await ctx.fs.readFile(ctx.file);
        const next = source.toString('utf8').replace('Swim today', 'Ship faster');
        await ctx.fs.writeFile(ctx.file, Buffer.from(next, 'utf8'));
        return { kind: 'edited', files: [ctx.file] };
      }),
    });

    const [result] = await bridge.apply({ intents: [makeIntent()] });

    expect(result?.status).toBe('landed');
    expect(readFileSync(file).toString('utf8')).toContain('Ship faster');
    bridge.close();
  });

  // AC-7.5 — the trap: `.sve/undo` is deliberately outside editRoots
  it('keeps snapshotting and reverting with editRoots narrower than the undo directory', async () => {
    const { root, file } = makeProject();
    const editRoots = [path.join(root, 'src')];
    const undoRoot = path.join(root, '.sve', 'undo');

    const bridge = createBridge({
      root,
      editRoots,
      agent: runner(async (ctx) => {
        await ctx.fs.writeFile(ctx.file, Buffer.from('rewritten', 'utf8'));
        return { kind: 'edited', files: [ctx.file] };
      }),
    });
    // The premise of this test: the bridge's own writes land outside the roots.
    expect(bridge.snapshots.undoRoot.startsWith(editRoots[0]!)).toBe(false);

    const [result] = await bridge.apply({ intents: [makeIntent()] });
    expect(result?.status).toBe('landed');

    expect(existsSync(path.join(undoRoot, result!.jobId, 'manifest.json'))).toBe(true);
    expect(readFileSync(file).toString('utf8')).toBe('rewritten');

    const reverted = await bridge.revert(result!.jobId);
    expect(reverted.status).toBe('reverted');
    expect(Buffer.compare(readFileSync(file), HERO_SOURCE)).toBe(0);
    bridge.close();
  });

  // AC-7.6 — the cost of the guard across one real job
  it('adds one realpath per guarded operation to a read-then-write job', async () => {
    const { root } = makeProject();
    const spy = spyFs(nodeFs);
    const bridge = createBridge({
      root,
      fs: spy.fs,
      agent: runner(async (ctx) => {
        const source = await ctx.fs.readFile(ctx.file);
        await ctx.fs.writeFile(ctx.file, source);
        return { kind: 'edited', files: [ctx.file] };
      }),
    });

    await bridge.apply({ intents: [makeIntent()] });
    bridge.close();

    // Two for the bridge's own pre-check (the file, then the root), one for the
    // roots the wrapper resolves once, then exactly one per guarded call.
    expect(spy.calls.filter((name) => name === 'realpath')).toHaveLength(5);
  });
});
