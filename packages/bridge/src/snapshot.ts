import path from 'node:path';
import { nodeFs, type BridgeFs } from './fs.js';

export interface SnapshotEntry {
  /** Absolute path of the file as it was on disk. */
  original: string;
  /** Absolute path of the byte-identical copy under the undo directory. */
  stored: string;
}

export interface SnapshotRecord {
  jobId: string;
  dir: string;
  entries: SnapshotEntry[];
}

export interface RevertResult {
  jobId: string;
  ok: boolean;
  restored: string[];
  message?: string;
}

interface Manifest {
  version: 1;
  jobId: string;
  createdAt: string;
  files: SnapshotEntry[];
}

const MANIFEST = 'manifest.json';

/** A jobId becomes a directory name, so it may not steer out of the undo tree. */
const SAFE_JOB_ID = /^[A-Za-z0-9._-]+$/;

function isSafeJobId(jobId: string): boolean {
  return SAFE_JOB_ID.test(jobId) && jobId !== '.' && jobId !== '..';
}

/**
 * Byte-exact undo (AC-3.2).
 *
 * Every file a job is about to touch is copied to `.sve/undo/<jobId>/` before
 * the agent runs, and `revert(jobId)` puts those exact bytes back. Copies are
 * numbered rather than mirroring the source tree: a job may touch two files
 * with the same basename, and reproducing absolute paths inside the undo
 * directory would reintroduce the traversal problem the guard exists to solve.
 * The manifest carries the mapping back.
 *
 * All content moves as `Buffer`. A string round-trip would silently normalise
 * line endings on Windows and re-encode anything non-ASCII, which is precisely
 * what an undo must not do.
 */
export class SnapshotStore {
  readonly #fs: BridgeFs;
  readonly #undoRoot: string;

  constructor(options: { root: string; fs?: BridgeFs; undoRoot?: string }) {
    this.#fs = options.fs ?? nodeFs;
    this.#undoRoot = options.undoRoot ?? path.join(path.resolve(options.root), '.sve', 'undo');
  }

  get undoRoot(): string {
    return this.#undoRoot;
  }

  dirFor(jobId: string): string {
    return path.join(this.#undoRoot, jobId);
  }

  async snapshot(jobId: string, files: readonly string[]): Promise<SnapshotRecord> {
    if (!isSafeJobId(jobId)) throw new Error(`unsafe jobId for a snapshot directory: ${jobId}`);

    const dir = this.dirFor(jobId);
    await this.#fs.mkdir(dir);

    const entries: SnapshotEntry[] = [];
    for (const [index, file] of files.entries()) {
      const original = path.resolve(file);
      // The index keeps two same-named files apart; the basename keeps the
      // undo directory readable when someone opens it to see what is in there.
      const stored = path.join(dir, `${String(index).padStart(4, '0')}-${path.basename(original)}`);
      await this.#fs.writeFile(stored, await this.#fs.readFile(original));
      entries.push({ original, stored });
    }

    const manifest: Manifest = {
      version: 1,
      jobId,
      createdAt: new Date().toISOString(),
      files: entries,
    };
    await this.#fs.writeFile(
      path.join(dir, MANIFEST),
      Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
    );

    return { jobId, dir, entries };
  }

  /**
   * Restores every file in the snapshot. An unknown (or unsafe) jobId resolves
   * as `ok: false` — reverting something that was never snapshotted is a normal
   * answer to give a user, not an exception to throw at them.
   */
  async revert(jobId: string): Promise<RevertResult> {
    if (!isSafeJobId(jobId)) {
      return { jobId, ok: false, restored: [], message: `unknown jobId: ${jobId}` };
    }

    let manifest: Manifest;
    try {
      const raw = await this.#fs.readFile(path.join(this.dirFor(jobId), MANIFEST));
      manifest = JSON.parse(raw.toString('utf8')) as Manifest;
    } catch {
      return {
        jobId,
        ok: false,
        restored: [],
        message: `unknown jobId: ${jobId} — no snapshot under ${this.dirFor(jobId)}`,
      };
    }

    const restored: string[] = [];
    const failures: string[] = [];
    for (const entry of manifest.files ?? []) {
      try {
        await this.#fs.writeFile(entry.original, await this.#fs.readFile(entry.stored));
        restored.push(entry.original);
      } catch (error) {
        failures.push(`${entry.original}: ${(error as Error).message}`);
      }
    }

    return failures.length === 0
      ? { jobId, ok: true, restored }
      : { jobId, ok: false, restored, message: `could not restore ${failures.join('; ')}` };
  }
}
