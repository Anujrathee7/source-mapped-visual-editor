import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { SnapshotStore } from '../src/snapshot.js';
import { cleanupTempDirs, HERO_SOURCE, makeProject } from './helpers.js';

afterAll(cleanupTempDirs);

// AC-3.2
describe('SnapshotStore', () => {
  it('restores byte-for-byte, preserving CRLF, the trailing newline, and non-ASCII', async () => {
    const { root, file } = makeProject();
    const original = readFileSync(file);
    expect(Buffer.compare(original, HERO_SOURCE)).toBe(0);
    // Guard the fixture itself: if these stop holding, the test proves nothing.
    expect(original.includes(Buffer.from('\r\n'))).toBe(true);
    expect(original.subarray(-2).toString('binary')).toBe('\r\n');
    expect(original.includes(Buffer.from('Café', 'utf8'))).toBe(true);

    const store = new SnapshotStore({ root });
    await store.snapshot('job_1', [file]);

    // A hostile rewrite: LF only, no trailing newline, ASCII-folded.
    writeFileSync(file, Buffer.from('nope\nno trailing newline', 'utf8'));
    expect(Buffer.compare(readFileSync(file), original)).not.toBe(0);

    const result = await store.revert('job_1');
    expect(result.ok).toBe(true);
    expect(result.restored).toEqual([file]);

    const restored = readFileSync(file);
    expect(Buffer.compare(restored, original)).toBe(0);
    expect(restored.byteLength).toBe(original.byteLength);
  });

  it('writes the copy under .sve/undo/<jobId>/ with identical bytes', async () => {
    const { root, file } = makeProject();
    const store = new SnapshotStore({ root });
    const record = await store.snapshot('job_2', [file]);

    expect(record.dir).toBe(path.join(root, '.sve', 'undo', 'job_2'));
    expect(existsSync(record.dir)).toBe(true);
    expect(record.entries).toHaveLength(1);

    const entry = record.entries[0]!;
    expect(entry.original).toBe(file);
    expect(Buffer.compare(readFileSync(entry.stored), readFileSync(file))).toBe(0);
  });

  it('restores every file in the snapshot', async () => {
    const { root, file } = makeProject();
    const second = path.join(root, 'src', 'Other.tsx');
    const secondBytes = Buffer.from('const x = 1;\r\n', 'utf8');
    writeFileSync(second, secondBytes);

    const store = new SnapshotStore({ root });
    await store.snapshot('job_3', [file, second]);

    writeFileSync(file, Buffer.from('a', 'utf8'));
    writeFileSync(second, Buffer.from('b', 'utf8'));

    const result = await store.revert('job_3');
    expect(result.ok).toBe(true);
    expect(result.restored.sort()).toEqual([file, second].sort());
    expect(Buffer.compare(readFileSync(file), HERO_SOURCE)).toBe(0);
    expect(Buffer.compare(readFileSync(second), secondBytes)).toBe(0);
  });

  it('snapshots the same file twice under different job ids without collision', async () => {
    const { root, file } = makeProject();
    const store = new SnapshotStore({ root });
    await store.snapshot('job_a', [file]);
    writeFileSync(file, Buffer.from('second generation\r\n', 'utf8'));
    await store.snapshot('job_b', [file]);
    writeFileSync(file, Buffer.from('third generation\r\n', 'utf8'));

    await store.revert('job_b');
    expect(readFileSync(file).toString('utf8')).toBe('second generation\r\n');

    await store.revert('job_a');
    expect(Buffer.compare(readFileSync(file), HERO_SOURCE)).toBe(0);
  });

  it('resolves an error result for an unknown jobId rather than throwing', async () => {
    const { root } = makeProject();
    const store = new SnapshotStore({ root });

    const result = await store.revert('job_never_ran');
    expect(result.ok).toBe(false);
    expect(result.jobId).toBe('job_never_ran');
    expect(result.restored).toEqual([]);
    expect(result.message).toMatch(/job_never_ran/);
  });

  it('refuses a jobId that would escape the undo directory', async () => {
    const { root } = makeProject();
    const store = new SnapshotStore({ root });
    await expect(store.revert('../../etc')).resolves.toMatchObject({ ok: false });
  });
});
