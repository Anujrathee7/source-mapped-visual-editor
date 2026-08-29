/**
 * AC-11.5 — cloning a repository never runs its code without saying so.
 *
 * Two separate hazards live here and they are tested separately. A repository *name* is
 * untrusted input that must not escape the workspace directory; a repository's *code* is
 * untrusted code, and `npm install` runs a stranger's lifecycle scripts, so it needs an
 * explicit yes that names the repository being installed.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cloneRepository, parseRepositoryUrl, type GitRunner } from '../src/index.js';
import { cleanupTempDirs, tempDir } from './support.js';

afterAll(cleanupTempDirs);

/** A git that succeeds without a network, leaving a plausible checkout behind. */
function fakeGit(calls: string[][] = []): GitRunner {
  return async (args) => {
    calls.push([...args]);
    const target = args[args.length - 1];
    if (target !== undefined && path.isAbsolute(target)) {
      mkdirSync(path.join(target, 'src'), { recursive: true });
      writeFileSync(path.join(target, 'package.json'), '{"name":"cloned"}', 'utf8');
    }
    return { ok: true, stderr: '' };
  };
}

describe('parseRepositoryUrl — what is a repository and what is merely a string', () => {
  it.each([
    ['https://github.com/acme/widgets', 'acme', 'widgets'],
    ['https://github.com/acme/widgets.git', 'acme', 'widgets'],
    ['https://github.com/acme/widgets/', 'acme', 'widgets'],
    ['https://www.github.com/acme/widgets', 'acme', 'widgets'],
    ['git@github.com:acme/widgets.git', 'acme', 'widgets'],
  ])('accepts %s', (input, owner, name) => {
    const repository = parseRepositoryUrl(input);
    expect(repository).not.toBeNull();
    expect(repository!.owner).toBe(owner);
    expect(repository!.name).toBe(name);
    expect(repository!.slug).toBe(`${owner}/${name}`);
  });

  it.each([
    'https://github.com/acme',
    'https://github.com/acme/widgets/tree/main',
    'https://gitlab.com/acme/widgets',
    'https://github.com/../../etc',
    'https://github.com/acme/..',
    'https://github.com/%2e%2e/%2e%2e',
    'file:///etc/passwd',
    'not a url at all',
    '',
  ])('refuses %s', (input) => {
    expect(parseRepositoryUrl(input)).toBeNull();
  });
});

describe('cloneRepository — into the workspace, and only into the workspace', () => {
  it('shallow-clones into a directory under the workspace', async () => {
    const workspaceDir = tempDir();
    const calls: string[][] = [];
    const result = await cloneRepository('https://github.com/acme/widgets', {
      workspaceDir,
      git: fakeGit(calls),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(path.resolve(result.directory).startsWith(path.resolve(workspaceDir) + path.sep)).toBe(
      true,
    );
    expect(existsSync(result.directory)).toBe(true);
    expect(calls[0]).toEqual(
      expect.arrayContaining(['clone', '--depth', '1', 'https://github.com/acme/widgets']),
    );
  });

  it('reports a url that is not a repository rather than trying it', async () => {
    const calls: string[][] = [];
    const result = await cloneRepository('https://example.com/whatever', {
      workspaceDir: tempDir(),
      git: fakeGit(calls),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not-a-repository');
    expect(calls).toHaveLength(0);
  });

  it('reports a clone that failed, once, with what git said', async () => {
    const calls: string[][] = [];
    const git: GitRunner = async (args) => {
      calls.push([...args]);
      return { ok: false, stderr: 'fatal: repository not found' };
    };
    const result = await cloneRepository('https://github.com/acme/gone', {
      workspaceDir: tempDir(),
      git,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('clone-failed');
    expect(result.message).toContain('fatal: repository not found');
    // Reported rather than retried: a second attempt costs the same failure twice.
    expect(calls).toHaveLength(1);
  });

  it('keeps a hostile repository name inside the workspace directory', async () => {
    // `parseRepositoryUrl` already refuses these, and this is the second line: the target
    // path is re-checked against the workspace after resolution, so a name that survived
    // parsing still cannot escape.
    const workspaceDir = tempDir();
    for (const name of ['..', '../escape', '.', 'a/../../b']) {
      const result = await cloneRepository(`https://github.com/acme/${name}`, {
        workspaceDir,
        git: fakeGit(),
      });
      expect(result.ok, `${name} must not clone`).toBe(false);
    }
  });

  it('refuses to clone over a directory that already has something in it', async () => {
    const workspaceDir = tempDir();
    const first = await cloneRepository('https://github.com/acme/widgets', {
      workspaceDir,
      git: fakeGit(),
    });
    expect(first.ok).toBe(true);

    const second = await cloneRepository('https://github.com/acme/widgets', {
      workspaceDir,
      git: fakeGit(),
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe('already-exists');
  });
});
