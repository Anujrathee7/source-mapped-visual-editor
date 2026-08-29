/**
 * What the host will open, and what it says when it will not (AC-11.4).
 *
 * Every refusal here names what was looked for and where. A user connecting a project for
 * the first time has no model of this tool yet, so "unsupported project" is a sentence
 * they cannot act on and cannot tell apart from a bug in ours.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { isInsideEditRoots } from '@sve/bridge';

/** vite's own list, in the order vite tries them, so the message matches what it does. */
export const VITE_CONFIG_FILES = [
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.ts',
  'vite.config.cjs',
  'vite.config.mts',
  'vite.config.cts',
] as const;

/**
 * Where source tends to live.
 *
 * Detected rather than assumed: `<root>/src` is a convention, not a rule, and a project
 * laid out under `app/` is not an unsupported project — it is the same project spelled
 * differently. What stays out of this list is the project root itself, because the config
 * that decides what the agent may write lives there.
 */
export const EDIT_ROOT_CANDIDATES = [
  'src',
  'app',
  'pages',
  'routes',
  'components',
  'islands',
  'lib',
] as const;

/** Where a dependency on React can honestly be declared. */
export const REACT_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies'] as const;

export type RefusalReason =
  | 'not-a-directory'
  | 'no-package-json'
  | 'no-vite-config'
  | 'no-react'
  | 'no-edit-roots'
  | 'edit-root-outside-project';

export interface DetectedProject {
  ok: true;
  root: string;
  /** Absolute path of the config vite will auto-discover. */
  viteConfig: string;
  /** Where React was found, spelled the way the project spells it. */
  react: string;
  /** Absolute, inside the project, never the project root itself. */
  editRoots: string[];
}

export interface ProjectRefusal {
  ok: false;
  root: string;
  reason: RefusalReason;
  /** Names what was looked for and not found. Shown to a person, verbatim. */
  message: string;
  lookedFor: string[];
}

export type ProjectDetection = DetectedProject | ProjectRefusal;

export interface DetectOptions {
  /**
   * Overrides detection. Relative entries resolve against the project root.
   *
   * An escape hatch for layouts nobody anticipated — and still guarded: a named root that
   * is outside the project, or is the project itself, is refused rather than trusted.
   */
  editRoots?: readonly string[];
}

function refuse(
  root: string,
  reason: RefusalReason,
  message: string,
  lookedFor: string[],
): ProjectRefusal {
  return { ok: false, root, reason, message, lookedFor };
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
}

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/**
 * Accepts a project, or explains itself.
 *
 * Order matters: each check is the precondition of the next, so a project missing two
 * things is told about the first one rather than about whichever check happened to be
 * cheapest.
 */
export async function detectProject(
  folder: string,
  options: DetectOptions = {},
): Promise<ProjectDetection> {
  const root = path.resolve(folder);

  if (!(await isDirectory(root))) {
    return refuse(root, 'not-a-directory', `${root} is not a directory.`, [root]);
  }

  const manifestPath = path.join(root, 'package.json');
  if (!(await isFile(manifestPath))) {
    return refuse(
      root,
      'no-package-json',
      `${root} has no package.json, so there is nothing to read a React dependency from.`,
      ['package.json'],
    );
  }

  let manifest: Manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
  } catch (error) {
    return refuse(
      root,
      'no-package-json',
      `${manifestPath} is not readable as JSON: ${error instanceof Error ? error.message : String(error)}`,
      ['package.json'],
    );
  }

  const viteConfig = await firstExisting(root, VITE_CONFIG_FILES);
  if (viteConfig === null) {
    return refuse(
      root,
      'no-vite-config',
      `${root} has no Vite config. Looked for ${VITE_CONFIG_FILES.join(', ')}. ` +
        `The host starts Vite itself and merges the editor into the project's own config, ` +
        `so a project without one is not something it can serve.`,
      [...VITE_CONFIG_FILES],
    );
  }

  const react = reactDependency(manifest);
  if (react === null) {
    const inNodeModules = await isFile(path.join(root, 'node_modules', 'react', 'package.json'));
    if (!inNodeModules) {
      return refuse(
        root,
        'no-react',
        `${root} does not depend on React. Looked for "react" in ${REACT_FIELDS.join(', ')} ` +
          `of package.json, and for node_modules/react. The editor stamps JSX host elements, ` +
          `so a project that renders none of them has nothing to edit.`,
        [...REACT_FIELDS.map((field) => `${field}.react`), 'node_modules/react'],
      );
    }
  }

  const named = options.editRoots;
  const editRoots =
    named === undefined
      ? await detectEditRoots(root)
      : named.map((entry) => path.resolve(root, entry));

  if (named === undefined && editRoots.length === 0) {
    return refuse(
      root,
      'no-edit-roots',
      `${root} has no directory the agent could be allowed to write to. ` +
        `Looked for ${EDIT_ROOT_CANDIDATES.join(', ')}. Name one explicitly with editRoots ` +
        `if the project keeps its source somewhere else. The project root itself is not an ` +
        `option: the config deciding what the agent may touch lives there.`,
      [...EDIT_ROOT_CANDIDATES],
    );
  }

  for (const editRoot of editRoots) {
    // The same two-part check the bridge's guard makes — lexical and then real — because a
    // root that is inside only until a symlink is followed is not inside.
    const inside = editRoot !== root && (await isInsideEditRoots(editRoot, [root]));
    if (!inside || !(await isDirectory(editRoot))) {
      return refuse(
        root,
        'edit-root-outside-project',
        `${editRoot} is not a writable source directory inside ${root}. An editRoot must ` +
          `exist, must resolve inside the project, and must not be the project root itself.`,
        [editRoot],
      );
    }
  }

  return {
    ok: true,
    root,
    viteConfig,
    react: react ?? 'node_modules/react',
    editRoots,
  };
}

async function firstExisting(root: string, names: readonly string[]): Promise<string | null> {
  for (const name of names) {
    const candidate = path.join(root, name);
    if (await isFile(candidate)) return candidate;
  }
  return null;
}

function reactDependency(manifest: Manifest): string | null {
  for (const field of REACT_FIELDS) {
    const range = manifest[field]?.['react'];
    if (typeof range === 'string' && range !== '') return `${field}.react@${range}`;
  }
  return null;
}

async function detectEditRoots(root: string): Promise<string[]> {
  const found: string[] = [];
  for (const candidate of EDIT_ROOT_CANDIDATES) {
    const dir = path.join(root, candidate);
    if (await isDirectory(dir)) found.push(dir);
  }
  return found;
}
