/**
 * AC-11.5 — nothing from a stranger's repository runs until someone said yes to it.
 *
 * `npm install` executes lifecycle scripts written by whoever owns the repository, and
 * starting the dev server loads that repository's `vite.config` — which is code too. Both
 * are gated, both prompts name the repository, and the default is no.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { AgentRunner } from '@sve/bridge';
import {
  createHost,
  type Host,
  type HostConfirmRequest,
  type GitRunner,
  type CommandRunner,
} from '../src/index.js';
import { cleanupTempDirs, DEFAULT_VITE_CONFIG, tempDir } from './support.js';

const idleAgent: AgentRunner = {
  name: 'idle',
  requiresNetwork: false,
  run: async () => ({ kind: 'noop' as const }),
};

const hosts: Host[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.closeAll();
});
afterAll(cleanupTempDirs);

/** A git that lays down a serveable project instead of talking to the network. */
const fakeGit: GitRunner = async (args) => {
  const target = args[args.length - 1];
  if (target === undefined || !path.isAbsolute(target)) return { ok: false, stderr: 'no target' };
  mkdirSync(path.join(target, 'src'), { recursive: true });
  writeFileSync(
    path.join(target, 'package.json'),
    JSON.stringify({ name: 'cloned', type: 'module', dependencies: { react: '^19.0.0' } }),
    'utf8',
  );
  writeFileSync(path.join(target, 'vite.config.js'), DEFAULT_VITE_CONFIG, 'utf8');
  writeFileSync(path.join(target, 'src', 'App.jsx'), 'export const A = () => <b>hi</b>;\n', 'utf8');
  return { ok: true, stderr: '' };
};

interface Recorded {
  requests: HostConfirmRequest[];
  commands: string[][];
}

function hostWith(answer: (request: HostConfirmRequest) => boolean, recorded: Recorded): Host {
  const install: CommandRunner = async (command, args) => {
    recorded.commands.push([command, ...args]);
    return { ok: true, stderr: '' };
  };
  const host = createHost({
    workspaceDir: tempDir('sve-host-ws-'),
    createAgent: () => idleAgent,
    git: fakeGit,
    runCommand: install,
    confirm: (request) => {
      recorded.requests.push(request);
      return answer(request);
    },
  });
  hosts.push(host);
  return host;
}

const REPO = 'https://github.com/acme/widgets';

describe('AC-11.5 — installing a stranger dependencies needs an explicit yes', () => {
  it('never installs without being asked, and names the repository when it asks', async () => {
    const recorded: Recorded = { requests: [], commands: [] };
    const host = hostWith(() => true, recorded);
    const result = await host.connect({ repository: REPO, install: true });

    expect(result.ok).toBe(true);
    const install = recorded.requests.find((request) => request.kind === 'install');
    expect(install).toBeDefined();
    expect(install!.repository).toBe('acme/widgets');
    expect(install!.message).toContain('acme/widgets');
    expect(install!.message).toContain('lifecycle scripts');
    expect(install!.command).toContain('npm');
    expect(recorded.commands.some(([command]) => command === 'npm')).toBe(true);
  }, 60_000);

  it('runs nothing at all when the confirmation is declined', async () => {
    const recorded: Recorded = { requests: [], commands: [] };
    const host = hostWith(() => false, recorded);
    const result = await host.connect({ repository: REPO, install: true });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not-confirmed');
    expect(result.message).toContain('acme/widgets');
    expect(recorded.commands).toEqual([]);
    expect(host.sessions()).toEqual([]);
  }, 60_000);

  it('refuses implicitly when no confirm callback was supplied at all', async () => {
    // Never implicit: a host built without a way to ask is a host that cannot say yes.
    const host = createHost({
      workspaceDir: tempDir('sve-host-ws-'),
      createAgent: () => idleAgent,
      git: fakeGit,
      runCommand: async () => {
        throw new Error('must not run');
      },
    });
    hosts.push(host);

    const result = await host.connect({ repository: REPO, install: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not-confirmed');
  }, 60_000);

  it('does not install when the caller did not ask for it', async () => {
    const recorded: Recorded = { requests: [], commands: [] };
    const host = hostWith(() => true, recorded);
    await host.connect({ repository: REPO });

    expect(recorded.requests.some((request) => request.kind === 'install')).toBe(false);
    expect(recorded.commands).toEqual([]);
  }, 60_000);
});

describe('AC-11.5 — starting the dev server on a clone needs an explicit yes', () => {
  it('asks before loading a cloned config, naming the repository', async () => {
    const recorded: Recorded = { requests: [], commands: [] };
    const host = hostWith(() => true, recorded);
    const result = await host.connect({ repository: REPO });

    expect(result.ok).toBe(true);
    const run = recorded.requests.find((request) => request.kind === 'run');
    expect(run).toBeDefined();
    expect(run!.repository).toBe('acme/widgets');
    expect(run!.message).toContain('acme/widgets');
  }, 60_000);

  it('starts no server when the run confirmation is declined', async () => {
    const recorded: Recorded = { requests: [], commands: [] };
    const host = hostWith((request) => request.kind !== 'run', recorded);
    const result = await host.connect({ repository: REPO });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not-confirmed');
    expect(host.sessions()).toEqual([]);
  }, 60_000);

  it('asks nothing at all for a folder the user chose themselves', async () => {
    // The gate is about code arriving from elsewhere. A path the user typed is a path the
    // user chose, and a prompt there teaches people to click through prompts.
    const recorded: Recorded = { requests: [], commands: [] };
    const host = hostWith(() => true, recorded);

    const root = tempDir();
    mkdirSync(path.join(root, 'src'), { recursive: true });
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'local', type: 'module', dependencies: { react: '^19.0.0' } }),
      'utf8',
    );
    writeFileSync(path.join(root, 'vite.config.js'), DEFAULT_VITE_CONFIG, 'utf8');
    writeFileSync(path.join(root, 'src', 'App.jsx'), 'export const A = () => <b>x</b>;\n', 'utf8');

    const result = await host.connect({ folder: root });
    expect(result.ok).toBe(true);
    expect(recorded.requests).toEqual([]);
  }, 60_000);

  it('reports a clone that failed instead of starting anything', async () => {
    const recorded: Recorded = { requests: [], commands: [] };
    const host = createHost({
      workspaceDir: tempDir('sve-host-ws-'),
      createAgent: () => idleAgent,
      git: async () => ({ ok: false, stderr: 'fatal: repository not found' }),
      confirm: (request) => {
        recorded.requests.push(request);
        return true;
      },
    });
    hosts.push(host);

    const result = await host.connect({ repository: 'https://github.com/acme/gone' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('clone-failed');
    expect(result.message).toContain('repository not found');
  }, 60_000);
});
