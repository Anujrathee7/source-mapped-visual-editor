import { promises as nodeFsPromises } from 'node:fs';

/**
 * The bridge's entire filesystem surface, as one injectable object.
 *
 * Nothing in this package imports `node:fs` at a call site. Two reasons:
 * AC-3.4 requires proving that a malformed request performs *no* filesystem
 * access of any kind, which needs a single seam to spy on; and the path guard
 * (AC-3.3) is only a boundary if every read and write is forced through code
 * that can be observed and replaced.
 *
 * All content crosses this interface as `Buffer`. Never `string` — a snapshot
 * that round-trips through an implicit encoding or a line-ending fixup is not
 * a snapshot (AC-3.2).
 */
export interface FileStats {
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface BridgeFs {
  readFile(path: string): Promise<Buffer>;
  writeFile(path: string, data: Buffer): Promise<void>;
  mkdir(path: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  /** Resolves symlinks and junctions. Rejects if the path does not exist. */
  realpath(path: string): Promise<string>;
  /** Does not follow the final symlink, so a link can be inspected as a link. */
  lstat(path: string): Promise<FileStats>;
  stat(path: string): Promise<FileStats>;
}

export const nodeFs: BridgeFs = {
  async readFile(path) {
    return nodeFsPromises.readFile(path);
  },
  async writeFile(path, data) {
    await nodeFsPromises.writeFile(path, data);
  },
  async mkdir(path) {
    await nodeFsPromises.mkdir(path, { recursive: true });
  },
  async readdir(path) {
    return nodeFsPromises.readdir(path);
  },
  async realpath(path) {
    return nodeFsPromises.realpath(path);
  },
  async lstat(path) {
    return nodeFsPromises.lstat(path);
  },
  async stat(path) {
    return nodeFsPromises.stat(path);
  },
};
