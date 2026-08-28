import path from 'node:path';
import { nodeFs, type BridgeFs } from './fs.js';

/**
 * Only a leading drive letter is case-folded. `c:` and `C:` name the same
 * volume and no other spelling of it exists, so equating them opens nothing.
 * Every other segment is compared byte-for-byte on purpose.
 */
const DRIVE_LETTER = /^([a-zA-Z]):/;

function normaliseDrive(target: string): string {
  return target.replace(DRIVE_LETTER, (_match, letter: string) => `${letter.toUpperCase()}:`);
}

/**
 * Case-sensitive containment. Windows would happily open
 * `<root>/SRC/Hero.tsx`, but a guard that folds case is a guard an attacker
 * steers through: the deny list and the filesystem then disagree about which
 * strings name the same file. We refuse the unfamiliar spelling instead.
 *
 * The separator suffix is what keeps `<root>/src-generated` out of
 * `<root>/src` — a bare `startsWith` would let the sibling through.
 */
function contains(root: string, child: string): boolean {
  if (child === root) return true;
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return child.startsWith(prefix);
}

/**
 * The real path of `target`, or — when `target` does not exist yet, as for a
 * file the agent is about to create — the real path of its nearest existing
 * ancestor with the missing segments appended. Resolving only the ancestor is
 * what catches a symlinked *directory* on the way down.
 */
async function realpathOfNearestExisting(target: string, fs: BridgeFs): Promise<string> {
  const missing: string[] = [];
  let current = target;

  for (;;) {
    try {
      const real = await fs.realpath(current);
      return missing.length === 0 ? real : path.join(real, ...[...missing].reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return target;
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * The security boundary (AC-3.3). Answers whether `candidate` may be written.
 *
 * A path must survive two independent checks:
 *
 * 1. lexically — `..` segments resolved, compared case-sensitively against each
 *    root, which is what denies traversal, prefix siblings, and case tricks;
 * 2. really — symlinks and junctions resolved on both sides, which is what
 *    denies a link inside a root that points out of it.
 *
 * Both must pass. Resolving symlinks alone is not enough, because on a
 * case-insensitive filesystem `realpath` *launders* the spelling: it would hand
 * back the canonical casing and the case trick would sail through. Checking
 * lexically alone is not enough either, because a symlink is lexically inside.
 *
 * Returns a decision. It never throws, because a denial is something the agent
 * is told (and the job then resolves `blocked`), not an exception thrown past it.
 */
export async function isInsideEditRoots(
  candidate: string,
  editRoots: readonly string[],
  fs: BridgeFs = nodeFs,
): Promise<boolean> {
  if (editRoots.length === 0) return false;

  const lexicalCandidate = normaliseDrive(path.resolve(candidate));
  const lexicalRoots = editRoots.map((root) => normaliseDrive(path.resolve(root)));
  if (!lexicalRoots.some((root) => contains(root, lexicalCandidate))) return false;

  const realCandidate = normaliseDrive(await realpathOfNearestExisting(lexicalCandidate, fs));

  for (const root of lexicalRoots) {
    let realRoot: string;
    try {
      realRoot = normaliseDrive(await fs.realpath(root));
    } catch {
      continue; // A configured root that does not exist grants nothing.
    }
    if (contains(realRoot, realCandidate)) return true;
  }

  return false;
}

/** The message handed back to the agent when a tool call is refused. */
export function denialMessage(candidate: string, editRoots: readonly string[]): string {
  return (
    `Denied: ${candidate} is outside the configured editRoots ` +
    `(${editRoots.join(', ') || 'none'}). Write nothing and reply ` +
    `BLOCKED: <reason>.`
  );
}
