import path from 'node:path';
import type { BridgeFs, FileStats } from './fs.js';
import { denialMessage, isInsideEditRoots } from './guard.js';

/**
 * A path a runner was not allowed to touch (AC-7.2).
 *
 * Its own type, not a decorated `Error`, because a runner has to be able to
 * tell "I am not allowed there" from "that path does not exist" — the two want
 * opposite reactions, and a runner that treats a denial as a missing file will
 * go looking for somewhere else to write.
 *
 * The message is {@link denialMessage}, the same sentence `canUseTool` hands
 * back, so a refusal reads the same whether the runner asked first or was
 * stopped on its way past.
 */
export class PathNotPermittedError extends Error {
  override readonly name = 'PathNotPermittedError';
  /** The path as the runner spelled it, so the message names what it asked for. */
  readonly path: string;
  readonly editRoots: readonly string[];
  /** Errno-shaped, for the runner that switches on `code` rather than on type. */
  readonly code = 'SVE_EPERM_PATH';

  constructor(target: string, editRoots: readonly string[]) {
    super(denialMessage(target, editRoots));
    this.path = target;
    this.editRoots = [...editRoots];
  }
}

/**
 * True for a denial from {@link guardFs}, across realm boundaries.
 *
 * `instanceof` alone would answer false for an error thrown by a second copy of
 * this module — which is exactly the situation the bridge is in when a runner
 * is loaded from its own dependency tree.
 */
export function isPathNotPermitted(error: unknown): error is PathNotPermittedError {
  return (
    error instanceof PathNotPermittedError ||
    (error instanceof Error && (error as { code?: unknown }).code === 'SVE_EPERM_PATH')
  );
}

/**
 * `realpath` on a configured root, resolved once.
 *
 * The roots are configuration: they are fixed when the bridge is created and
 * they do not move under it. Resolving them on every guarded call would make
 * the guard cost grow with the number of roots rather than staying at one
 * resolution per path (AC-7.6).
 *
 * Only successes are remembered — a root that does not exist yet must be asked
 * about again, since it grants nothing until it does. Every other path goes
 * straight through: caching a candidate's real path would mean answering from a
 * stale filesystem, which is the one thing a guard may never do.
 */
function withResolvedRoots(inner: BridgeFs, editRoots: readonly string[]): BridgeFs {
  const rootKeys = new Set(editRoots.map((root) => path.resolve(root).toLowerCase()));
  const resolved = new Map<string, string>();

  return {
    ...inner,
    async realpath(target: string): Promise<string> {
      if (!rootKeys.has(target.toLowerCase())) return inner.realpath(target);
      const hit = resolved.get(target);
      if (hit !== undefined) return hit;
      const real = await inner.realpath(target);
      resolved.set(target, real);
      return real;
    },
  };
}

/**
 * The `BridgeFs` a runner is given (AC-7.1).
 *
 * Every member is wrapped, reads as much as writes: a runner that can read
 * `~/.ssh/id_rsa` has widened its reach whether or not it writes anything, and
 * `stat`/`readdir` are how a path outside the roots gets found in the first
 * place. Seven members, one wrapper — the guard is not repeated at any call
 * site, so a member added to `BridgeFs` later cannot be added unguarded without
 * this file changing too.
 *
 * The decision is {@link isInsideEditRoots} from M4, unchanged and not copied
 * (AC-7.4). It is asked once per call, against the path as given, and the
 * *inner* fs is what it resolves through — asking through the wrapper would
 * recurse forever on the first `realpath`.
 *
 * This is not a replacement for `canUseTool`. That callback stays: it lets a
 * well-behaved runner learn it may not proceed and report `blocked` cleanly,
 * which is a better outcome than an exception thrown mid-edit. This wrapper is
 * what makes the answer binding on a runner that never asks.
 */
export function guardFs(inner: BridgeFs, editRoots: readonly string[]): BridgeFs {
  const resolving = withResolvedRoots(inner, editRoots);

  async function permit(target: string): Promise<void> {
    if (!(await isInsideEditRoots(target, editRoots, resolving))) {
      throw new PathNotPermittedError(target, editRoots);
    }
  }

  return {
    async readFile(target: string): Promise<Buffer> {
      await permit(target);
      return inner.readFile(target);
    },
    async writeFile(target: string, data: Buffer): Promise<void> {
      await permit(target);
      await inner.writeFile(target, data);
    },
    async mkdir(target: string): Promise<void> {
      await permit(target);
      await inner.mkdir(target);
    },
    async readdir(target: string): Promise<string[]> {
      await permit(target);
      return inner.readdir(target);
    },
    async realpath(target: string): Promise<string> {
      await permit(target);
      return inner.realpath(target);
    },
    async lstat(target: string): Promise<FileStats> {
      await permit(target);
      return inner.lstat(target);
    },
    async stat(target: string): Promise<FileStats> {
      await permit(target);
      return inner.stat(target);
    },
  };
}
