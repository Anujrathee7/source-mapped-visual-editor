/**
 * AC-11.4 — what the host will open, and what it says when it will not.
 *
 * A refusal here is the first thing a user ever sees from v2, so every one of them has to
 * name what was looked for. "Unsupported project" is indistinguishable from a bug.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  detectProject,
  EDIT_ROOT_CANDIDATES,
  VITE_CONFIG_FILES,
  type ProjectRefusal,
} from '../src/index.js';
import { cleanupTempDirs, makeProject, tempDir } from './support.js';

afterAll(cleanupTempDirs);

async function refusalFor(root: string): Promise<ProjectRefusal> {
  const detected = await detectProject(root);
  if (detected.ok) throw new Error(`expected ${root} to be refused, but it was accepted`);
  return detected;
}

describe('detectProject — what counts as a project this host can open', () => {
  it('accepts a vite + react project and reports what it found', async () => {
    const root = makeProject();
    const detected = await detectProject(root);

    expect(detected.ok).toBe(true);
    if (!detected.ok) return;
    expect(detected.root).toBe(path.resolve(root));
    expect(detected.viteConfig).toBe(path.join(root, 'vite.config.js'));
    expect(detected.editRoots).toEqual([path.join(root, 'src')]);
    expect(detected.react).toContain('react');
  });

  it('detects app/ rather than assuming src/', async () => {
    // AC-11.4: "a project using `app/` must work or be told why it does not".
    const root = makeProject({ sourceDir: 'app' });
    const detected = await detectProject(root);

    expect(detected.ok).toBe(true);
    if (!detected.ok) return;
    expect(detected.editRoots).toEqual([path.join(root, 'app')]);
  });

  it('takes every source directory it finds, not just the first', async () => {
    const root = makeProject({
      files: [{ path: 'app/routes.jsx', content: 'export const R = () => <div />;\n' }],
    });
    const detected = await detectProject(root);

    expect(detected.ok).toBe(true);
    if (!detected.ok) return;
    expect(detected.editRoots.map((dir) => path.basename(dir)).sort()).toEqual(['app', 'src']);
  });

  it('refuses a directory that does not exist, naming it', async () => {
    const missing = path.join(tempDir(), 'nowhere');
    const refusal = await refusalFor(missing);
    expect(refusal.reason).toBe('not-a-directory');
    expect(refusal.message).toContain(missing);
  });

  it('refuses a project with no vite config, naming every filename it looked for', async () => {
    const root = makeProject({ viteConfig: null });
    const refusal = await refusalFor(root);

    expect(refusal.reason).toBe('no-vite-config');
    for (const filename of VITE_CONFIG_FILES) expect(refusal.message).toContain(filename);
    expect(refusal.lookedFor).toEqual([...VITE_CONFIG_FILES]);
  });

  it('refuses a project with no react, naming where it looked', async () => {
    const root = makeProject({ dependencies: { vue: '^3.0.0' }, withReact: false });
    const refusal = await refusalFor(root);

    expect(refusal.reason).toBe('no-react');
    expect(refusal.message).toContain('react');
    expect(refusal.message).toContain('dependencies');
    expect(refusal.message).toContain('devDependencies');
  });

  it('accepts react declared as a devDependency or a peerDependency', async () => {
    for (const field of ['devDependencies', 'peerDependencies'] as const) {
      const root = tempDir();
      writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({ name: 'x', [field]: { react: '^19.0.0' } }),
        'utf8',
      );
      writeFileSync(path.join(root, 'vite.config.ts'), 'export default {};\n', 'utf8');
      mkdirSync(path.join(root, 'src'));
      writeFileSync(path.join(root, 'src', 'App.jsx'), 'export const A = () => <i />;\n', 'utf8');

      const detected = await detectProject(root);
      expect(detected.ok, `${field} should count as depending on react`).toBe(true);
    }
  });

  it('refuses a project with no package.json, naming it', async () => {
    const root = tempDir();
    writeFileSync(path.join(root, 'vite.config.js'), 'export default {};\n', 'utf8');
    const refusal = await refusalFor(root);

    expect(refusal.reason).toBe('no-package-json');
    expect(refusal.message).toContain('package.json');
  });

  it('refuses a project with nowhere the agent could write, naming the candidates', async () => {
    const root = tempDir();
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'x', dependencies: { react: '^19.0.0' } }),
      'utf8',
    );
    writeFileSync(path.join(root, 'vite.config.js'), 'export default {};\n', 'utf8');

    const refusal = await refusalFor(root);
    expect(refusal.reason).toBe('no-edit-roots');
    for (const candidate of EDIT_ROOT_CANDIDATES) expect(refusal.message).toContain(candidate);
  });

  it('takes editRoots the caller named, so an unusual layout is not a dead end', async () => {
    const root = makeProject();
    mkdirSync(path.join(root, 'ui'), { recursive: true });
    const detected = await detectProject(root, { editRoots: ['ui'] });

    expect(detected.ok).toBe(true);
    if (!detected.ok) return;
    expect(detected.editRoots).toEqual([path.join(root, 'ui')]);
  });

  it('refuses a named editRoot outside the project, because the guard is the point', async () => {
    const root = makeProject();
    const outside = tempDir();
    const detected = await detectProject(root, { editRoots: [outside] });

    expect(detected.ok).toBe(false);
    if (detected.ok) return;
    expect(detected.reason).toBe('edit-root-outside-project');
    expect(detected.message).toContain(outside);
  });

  it('refuses the project root itself as an editRoot', async () => {
    // The config files that decide what the agent may touch live there, and an agent that
    // can rewrite its own guard has no guard.
    const root = makeProject();
    const detected = await detectProject(root, { editRoots: ['.'] });

    expect(detected.ok).toBe(false);
    if (detected.ok) return;
    expect(detected.reason).toBe('edit-root-outside-project');
  });

  it('refuses a named editRoot that does not exist', async () => {
    const root = makeProject();
    const detected = await detectProject(root, { editRoots: ['nope'] });

    expect(detected.ok).toBe(false);
    if (detected.ok) return;
    expect(detected.message).toContain('nope');
  });

  it('does not follow a symlink out of the project', async () => {
    const root = makeProject();
    const outside = tempDir();
    const link = path.join(root, 'linked');
    try {
      const { symlinkSync } = await import('node:fs');
      symlinkSync(outside, link, 'junction');
    } catch {
      return; // No permission to make links on this machine; the lexical check still holds.
    }

    const detected = await detectProject(root, { editRoots: ['linked'] });
    expect(detected.ok).toBe(false);
    rmSync(link, { recursive: true, force: true });
  });
});
