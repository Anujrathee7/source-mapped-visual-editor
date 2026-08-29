/**
 * Getting a repository onto this machine, without letting its name decide where (AC-11.5).
 *
 * A repository name is untrusted input in exactly the way a browser-supplied path is, so
 * it gets the same treatment: parsed against a shape we accept rather than sanitised, and
 * then the resolved target is re-checked against the workspace directory. Parsing alone is
 * not enough — the containment check is what makes a mistake in the parser survivable.
 */
import { spawn } from 'node:child_process';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { isInsideEditRoots } from '@sve/bridge';

/** GitHub owner and repository names: no separators, no dots on their own, no `..`. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const GITHUB_HOSTS = new Set(['github.com', 'www.github.com']);
const SSH_FORM = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/;

export interface Repository {
  host: 'github.com';
  owner: string;
  name: string;
  /** `owner/name` — what a confirmation prompt names. */
  slug: string;
  /** The https url git is given, normalised. */
  url: string;
}

/** Returns null for anything that is not plainly one repository. */
export function parseRepositoryUrl(input: string): Repository | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;

  const ssh = SSH_FORM.exec(trimmed);
  if (ssh !== null) return build(ssh[1], ssh[2]);

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!GITHUB_HOSTS.has(url.hostname)) return null;

  // `new URL` has already collapsed `..`, so a traversal attempt arrives here as a path
  // with the wrong number of segments rather than as a segment we would have to recognise.
  const segments = url.pathname.split('/').filter((segment) => segment !== '');
  if (segments.length !== 2) return null;

  return build(segments[0], segments[1]);
}

function build(owner: string | undefined, rawName: string | undefined): Repository | null {
  if (owner === undefined || rawName === undefined) return null;
  const name = rawName.endsWith('.git') ? rawName.slice(0, -4) : rawName;
  if (!NAME.test(owner) || !NAME.test(name)) return null;
  if (owner === '.' || owner === '..' || name === '.' || name === '..') return null;
  return { host: 'github.com', owner, name, slug: `${owner}/${name}`, url: `https://github.com/${owner}/${name}` };
}

export interface CommandResult {
  ok: boolean;
  stderr: string;
}

export type GitRunner = (args: readonly string[], cwd: string) => Promise<CommandResult>;
export type CommandRunner = (
  command: string,
  args: readonly string[],
  cwd: string,
) => Promise<CommandResult>;

export type CloneFailure =
  | 'not-a-repository'
  | 'unsafe-target'
  | 'already-exists'
  | 'clone-failed';

export type CloneOutcome =
  | { ok: true; repository: Repository; directory: string }
  | { ok: false; reason: CloneFailure; message: string };

export interface CloneOptions {
  /** Every clone lands under here, and nothing lands outside it. */
  workspaceDir: string;
  git?: GitRunner;
  depth?: number;
}

/** The default: real git, no shell, arguments passed as an array. */
export const spawnCommand: CommandRunner = (command, args, cwd) =>
  new Promise((resolve) => {
    const child = spawn(command, [...args], { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => resolve({ ok: false, stderr: error.message }));
    child.on('close', (code) => resolve({ ok: code === 0, stderr }));
  });

export const spawnGit: GitRunner = (args, cwd) => spawnCommand('git', args, cwd);

/** `<owner>__<name>`, so two repositories with the same name do not collide. */
export function workspaceDirectoryFor(workspaceDir: string, repository: Repository): string {
  return path.join(path.resolve(workspaceDir), `${repository.owner}__${repository.name}`);
}

export async function cloneRepository(
  input: string,
  options: CloneOptions,
): Promise<CloneOutcome> {
  const repository = parseRepositoryUrl(input);
  if (repository === null) {
    return {
      ok: false,
      reason: 'not-a-repository',
      message:
        `${input} is not a GitHub repository url. Expected ` +
        `https://github.com/<owner>/<repo> or git@github.com:<owner>/<repo>.git.`,
    };
  }

  const workspaceDir = path.resolve(options.workspaceDir);
  await mkdir(workspaceDir, { recursive: true });
  const directory = workspaceDirectoryFor(workspaceDir, repository);

  // The second line. `isInsideEditRoots` resolves symlinks on both sides, so a workspace
  // directory that is itself a link, or a target that would land through one, is refused
  // here even though the name passed the parser.
  if (!(await isInsideEditRoots(directory, [workspaceDir]))) {
    return {
      ok: false,
      reason: 'unsafe-target',
      message: `${repository.slug} would clone to ${directory}, which is outside ${workspaceDir}.`,
    };
  }

  if (await hasEntries(directory)) {
    return {
      ok: false,
      reason: 'already-exists',
      message:
        `${directory} already exists and is not empty. Remove it, or connect it as a ` +
        `folder — cloning over a checkout would discard whatever is in it.`,
    };
  }

  const git = options.git ?? spawnGit;
  const result = await git(
    ['clone', '--depth', String(options.depth ?? 1), repository.url, directory],
    workspaceDir,
  );

  if (!result.ok) {
    // Reported, not retried: a clone fails because the url is wrong, the repository is
    // private, or the network is down, and none of those get better by asking twice.
    return {
      ok: false,
      reason: 'clone-failed',
      message: `git clone of ${repository.slug} failed: ${result.stderr.trim() || 'no output'}`,
    };
  }

  return { ok: true, repository, directory };
}

async function hasEntries(directory: string): Promise<boolean> {
  try {
    return (await readdir(directory)).length > 0;
  } catch {
    return false;
  }
}
