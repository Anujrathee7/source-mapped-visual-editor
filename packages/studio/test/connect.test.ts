/**
 * AC-12.2 — connecting.
 *
 * The states are the point. An editor that loads and does nothing when clicked is the
 * failure most easily mistaken for a broken product, so `no-elements-stamped` has to reach
 * the user as a blocking error and not as a warning to scroll past — and a refusal has to
 * arrive in the words the host chose, because those words already name what was looked for
 * and where.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostConfirmRequest, HostDiagnostic } from '@sve/host';
import { createConnectController, type ConnectTransport } from '../src/client/connect.js';
import type { ConnectEvent, ConnectOutcome, SessionSummary } from '../src/session.js';
import { createStudioService, type StudioService } from '../src/host/service.js';

const SESSION: SessionSummary = {
  id: 'sve_1',
  url: 'http://127.0.0.1:5310/',
  root: '/tmp/project',
  port: 5310,
  agent: 'fake',
  source: { kind: 'folder', path: '/tmp/project' },
  stamping: { probed: true, filesConsidered: 2, filesStamped: 1, elementsStamped: 6, modulesFetched: 2, files: [] },
  diagnostics: [],
};

const NO_ELEMENTS: HostDiagnostic = {
  code: 'no-elements-stamped',
  level: 'error',
  message: 'Nothing in /tmp/project was stamped with an origin.',
};

const PAGE_NOT_SERVED: HostDiagnostic = {
  code: 'page-not-served',
  level: 'warning',
  message: '/tmp/project served no module of its own from index.html.',
};

function transportOf(
  outcome: ConnectOutcome,
  events: ConnectEvent[] = [],
): ConnectTransport & { answered: Array<[string, boolean]> } {
  const answered: Array<[string, boolean]> = [];
  return {
    answered,
    async connect(_request, onEvent) {
      for (const event of events) onEvent(event);
      return outcome;
    },
    async answerConfirm(id, allow) {
      answered.push([id, allow]);
    },
  };
}

describe('while connecting', () => {
  it('shows the state it is in, in order', async () => {
    const seen: string[] = [];
    const controller = createConnectController({
      transport: transportOf({ ok: true, session: SESSION }, [
        { kind: 'phase', phase: 'cloning', detail: 'sounding/app' },
        { kind: 'phase', phase: 'installing' },
        { kind: 'phase', phase: 'detecting' },
        { kind: 'phase', phase: 'starting' },
      ]),
    });
    controller.subscribe(() => {
      const state = controller.state;
      // Distinct phases: the question is the order they happen in, not how many renders
      // each one causes.
      if (state.kind === 'connecting' && seen[seen.length - 1] !== state.phase) {
        seen.push(state.phase);
      }
    });

    await controller.connect({ repository: 'sounding/app', install: true });

    expect(seen).toEqual(['cloning', 'installing', 'detecting', 'starting']);
    expect(controller.state.kind).toBe('connected');
  });

  it('starts idle and ends holding the session', async () => {
    const controller = createConnectController({ transport: transportOf({ ok: true, session: SESSION }) });
    expect(controller.state.kind).toBe('idle');

    await controller.connect({ folder: '/tmp/project' });

    expect(controller.state).toMatchObject({ kind: 'connected', session: { id: 'sve_1' } });
  });
});

describe('a refusal', () => {
  it('is rendered with the reason the host gave, not replaced with a summary', async () => {
    const message =
      '/tmp/project has no vite config. Looked for vite.config.js, vite.config.mjs, ' +
      'vite.config.ts in /tmp/project.';
    const controller = createConnectController({
      transport: transportOf({ ok: false, reason: 'no-vite-config', message }),
    });

    await controller.connect({ folder: '/tmp/project' });

    expect(controller.state).toEqual({
      kind: 'refused',
      reason: 'no-vite-config',
      message,
      target: '/tmp/project',
    });
  });
});

describe('diagnostics', () => {
  it('treats no-elements-stamped as blocking, not as a warning to scroll past', async () => {
    const controller = createConnectController({
      transport: transportOf({
        ok: true,
        session: { ...SESSION, diagnostics: [NO_ELEMENTS] },
      }),
    });

    await controller.connect({ folder: '/tmp/project' });

    expect(controller.state.kind).toBe('blocked');
    expect(controller.state).toMatchObject({ diagnostic: { code: 'no-elements-stamped' } });
    // The whole sentence, because it names what to look at.
    expect(controller.state).toMatchObject({ diagnostic: { message: NO_ELEMENTS.message } });
  });

  it('does not block on a warning, but does not hide it either', async () => {
    const controller = createConnectController({
      transport: transportOf({
        ok: true,
        session: { ...SESSION, diagnostics: [PAGE_NOT_SERVED] },
      }),
    });

    await controller.connect({ folder: '/tmp/project' });

    expect(controller.state.kind).toBe('connected');
    expect(controller.state).toMatchObject({ warnings: [PAGE_NOT_SERVED] });
  });
});

describe('confirming what will run', () => {
  it('says what will be executed, and where, rather than asking for a habit-click', async () => {
    const request = {
      kind: 'install' as const,
      repository: 'sounding/app',
      directory: '/ws/sounding-app',
      command: 'npm install',
      message:
        'Install dependencies for sounding/app? This runs `npm install` in /ws/sounding-app, ' +
        'which executes lifecycle scripts from sounding/app on this machine.',
    };
    const transport = transportOf({ ok: true, session: SESSION }, [
      { kind: 'confirm', id: 'c1', request },
    ]);
    const controller = createConnectController({ transport });
    const asked: HostConfirmRequest[] = [];
    controller.subscribe(() => {
      const state = controller.state;
      if (state.kind === 'confirming') asked.push(state.request);
    });

    await controller.connect({ repository: 'sounding/app', install: true });

    expect(asked).toHaveLength(1);
    // The whole sentence: the repository, the command, and where it will run.
    expect(asked[0]?.message).toContain('sounding/app');
    expect(asked[0]?.message).toContain('npm install');
    expect(asked[0]?.message).toContain('/ws/sounding-app');
    expect(asked[0]?.command).toBe('npm install');
  });

  it('answers only when told to, and passes the answer through unchanged', async () => {
    const request = {
      kind: 'run' as const,
      repository: 'sounding/app',
      directory: '/ws/sounding-app',
      command: 'vite dev server',
      message: "Start the dev server for sounding/app? This loads and runs that repository's Vite config from /ws/sounding-app.",
    };
    const transport = transportOf({ ok: true, session: SESSION }, [
      { kind: 'confirm', id: 'c2', request },
    ]);
    const controller = createConnectController({ transport });
    let waiting: Array<{ id: string }> = [];
    controller.subscribe(() => {
      if (controller.state.kind === 'confirming') waiting = controller.confirmations();
    });

    await controller.connect({ repository: 'sounding/app' });
    // Nothing was answered by the studio merely rendering the question.
    expect(transport.answered).toEqual([]);
    expect(waiting.map((entry) => entry.id)).toEqual(['c2']);

    await controller.answer('c2', false);
    expect(transport.answered).toEqual([['c2', false]]);
    expect(controller.confirmations()).toEqual([]);
  });
});

/* ── the service, against the real host ───────────────────────────────────── */

let service: StudioService | null = null;
const temporary: string[] = [];

afterEach(async () => {
  await service?.close();
  service = null;
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'sve-studio-connect-'));
  temporary.push(dir);
  return dir;
}

describe('the service', () => {
  it('hands back the host’s own refusal, naming what it looked for', async () => {
    const folder = tempDir();
    service = createStudioService({ workspaceDir: tempDir() });

    const phases: string[] = [];
    const outcome = await service.connect({ folder }, (event) => {
      if (event.kind === 'phase') phases.push(event.phase);
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('no-package-json');
    expect(outcome.message).toContain('package.json');
    expect(outcome.message).toContain(folder);
    expect(phases).toEqual(['detecting']);
  });

  it('refuses a project with no React, before anything is started', async () => {
    const folder = tempDir();
    writeFileSync(path.join(folder, 'package.json'), '{"name":"x"}\n', 'utf8');
    writeFileSync(path.join(folder, 'vite.config.ts'), 'export default {};\n', 'utf8');
    service = createStudioService({ workspaceDir: tempDir() });

    const outcome = await service.connect({ folder });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('no-react');
  });

  it('denies a confirmation nobody answers, rather than waiting forever', async () => {
    service = createStudioService({ workspaceDir: tempDir(), confirmTimeoutMs: 20 });
    const pending = service.confirm({
      kind: 'install',
      repository: 'sounding/app',
      directory: '/ws/x',
      command: 'npm install',
      message: 'Install dependencies for sounding/app?',
    });

    await expect(pending).resolves.toBe(false);
    expect(service.confirmations()).toEqual([]);
  });

  it('runs a confirmation the studio answered', async () => {
    service = createStudioService({ workspaceDir: tempDir(), confirmTimeoutMs: 2000 });
    const pending = service.confirm({
      kind: 'run',
      repository: 'sounding/app',
      directory: '/ws/x',
      command: 'vite dev server',
      message: 'Start the dev server for sounding/app?',
    });

    const waiting = service.confirmations();
    expect(waiting).toHaveLength(1);
    expect(service.answerConfirm(waiting[0]!.id, true)).toBe(true);

    await expect(pending).resolves.toBe(true);
  });

  it('proxies apply and revert to the session rather than letting the browser reach it', async () => {
    const fetchStub = vi.fn(async (_url: unknown, _init?: unknown) =>
      new Response(JSON.stringify({ results: [{ jobId: 'job_1', status: 'landed' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    service = createStudioService({ workspaceDir: tempDir(), fetch: fetchStub as unknown as typeof fetch });

    const result = await service.apply('http://127.0.0.1:5310/', {
      eid: 'a',
      eidIndex: 0,
      loc: 'src/Hero.tsx:3:5',
      tag: 'h1',
      kind: 'text',
      before: { text: 'a', classes: [], computed: {} },
      after: { text: 'b', classes: [], computed: {} },
      instruction: 'change it',
    });

    expect(result.status).toBe('landed');
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(String(fetchStub.mock.calls[0]?.[0])).toBe('http://127.0.0.1:5310/__sve/apply');
  });
});
