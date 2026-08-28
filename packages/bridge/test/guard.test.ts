import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { isInsideEditRoots } from '../src/guard.js';
import { cleanupTempDirs, makeProject, makeTempDir } from './helpers.js';

afterAll(cleanupTempDirs);

// AC-3.3
describe('isInsideEditRoots', () => {
  it('allows a path inside a root', async () => {
    const { root, file } = makeProject();
    await expect(isInsideEditRoots(file, [path.join(root, 'src')])).resolves.toBe(true);
    await expect(isInsideEditRoots(file, [root])).resolves.toBe(true);
  });

  it('allows a root itself', async () => {
    const { root } = makeProject();
    await expect(isInsideEditRoots(root, [root])).resolves.toBe(true);
  });

  it('allows a not-yet-existing file inside a root', async () => {
    const { root } = makeProject();
    const unborn = path.join(root, 'src', 'components', 'New.tsx');
    await expect(isInsideEditRoots(unborn, [root])).resolves.toBe(true);
  });

  it('denies an absolute path outside every configured root', async () => {
    const { root } = makeProject();
    const elsewhere = makeTempDir('sve-elsewhere-');
    const secret = path.join(elsewhere, 'secret.txt');
    writeFileSync(secret, 'ssh-rsa AAAA');

    await expect(isInsideEditRoots(secret, [root])).resolves.toBe(false);
    await expect(
      isInsideEditRoots(secret, [path.join(root, 'src'), path.join(root, 'public')]),
    ).resolves.toBe(false);
  });

  it('denies ../ traversal that escapes a root', async () => {
    const { root } = makeProject();
    const escaping = path.join(root, 'src', '..', '..', 'outside.txt');
    await expect(isInsideEditRoots(escaping, [path.join(root, 'src')])).resolves.toBe(false);
    await expect(isInsideEditRoots(escaping, [root])).resolves.toBe(false);
  });

  it('denies a sibling directory that shares the root as a string prefix', async () => {
    const { root } = makeProject();
    // `<root>/src-generated` starts with `<root>/src` but is not inside it.
    const sibling = path.join(root, 'src-generated', 'Hero.tsx');
    await expect(isInsideEditRoots(sibling, [path.join(root, 'src')])).resolves.toBe(false);
  });

  it('denies a symlink whose real path lands outside a root', async () => {
    const { root } = makeProject();
    const elsewhere = makeTempDir('sve-linked-');
    writeFileSync(path.join(elsewhere, 'secret.txt'), 'ssh-rsa AAAA');

    // A junction, not a plain symlink: Windows allows those without elevation.
    const link = path.join(root, 'src', 'escape');
    symlinkSync(elsewhere, link, 'junction');

    const through = path.join(link, 'secret.txt');
    await expect(isInsideEditRoots(through, [root])).resolves.toBe(false);
    await expect(isInsideEditRoots(link, [root])).resolves.toBe(false);
  });

  it('allows a symlink whose real path stays inside a root', async () => {
    const { root } = makeProject();
    const inner = path.join(root, 'packages');
    mkdirSync(inner);
    writeFileSync(path.join(inner, 'kept.txt'), 'ok');

    const link = path.join(root, 'src', 'linked');
    symlinkSync(inner, link, 'junction');

    await expect(isInsideEditRoots(path.join(link, 'kept.txt'), [root])).resolves.toBe(true);
  });

  it('denies a path that only appears inside a root under case-insensitive comparison', async () => {
    const { root } = makeProject();
    const editRoot = path.join(root, 'src');
    const shouted = path.join(root, 'SRC', 'Hero.tsx');

    // On Windows this path *opens* the real file; the guard must still refuse it,
    // because a case-folded comparison is a hole an attacker steers through.
    expect(shouted).not.toBe(path.join(editRoot, 'Hero.tsx'));
    await expect(isInsideEditRoots(shouted, [editRoot])).resolves.toBe(false);
    await expect(isInsideEditRoots(path.join(root.toUpperCase(), 'src'), [editRoot])).resolves.toBe(
      false,
    );
  });

  it('denies everything when there are no roots', async () => {
    const { file } = makeProject();
    await expect(isInsideEditRoots(file, [])).resolves.toBe(false);
  });
});
