/**
 * The studio's Node side: everything the browser is not allowed to do itself.
 *
 * Three responsibilities, and they are all about a boundary.
 *
 *  - **Connecting.** `@sve/host` answers with a refusal rather than throwing one, and this
 *    passes that sentence through untouched. What it adds is the *phases*: a host connect
 *    is one call, and a user watching a repository clone needs to know which of the four
 *    slow things is happening. Only what can honestly be observed is reported.
 *  - **Confirming.** AC-11.5's two questions become a queue the studio answers. The
 *    default is no, and a question nobody answers is a no rather than a hang.
 *  - **Proxying.** The bridge's routes live on the session's own dev server, which is a
 *    different origin from the studio. Rather than teaching that server to accept
 *    cross-origin writes, the request is made from here — server to server, in the process
 *    that already holds the capability.
 *
 * Keys never leave: `providers()` returns booleans and sentences, and the values stay in
 * the store this service holds.
 */
import {
  createHost as createRealHost,
  detectProject,
  type ConnectFailure,
  type Host,
  type HostConfirmRequest,
  type HostOptions,
  type CommandRunner,
  type GitRunner,
  type SessionStatus,
} from '@sve/host';
import type { HttpClient } from '@sve/bridge';
import { EditResultSchema, type EditIntent, type EditResult } from '@sve/protocol';
import {
  isRepositoryRequest,
  type ConnectEvent,
  type ConnectOutcome,
  type ConnectRequestBody,
  type SessionSummary,
} from '../session.js';
import type { PlanRequest, PlanResult, Planner } from '../plan.js';
import type { ProviderId, ProviderSettings, ProviderView } from '../providers.js';
import { createFakePlanner } from './planner-fake.js';
import { createClaudePlanner } from './planner-claude.js';
import { createOpenAiPlanner } from './planner-openai.js';
import { createProviderStore, type ProviderStore } from './providers.js';

export const APPLY_PATH = '__sve/apply';
export const REVERT_PATH = '__sve/revert';
export const SOURCE_PATH = '__sve/source';

/** Long enough for a person to read what will run; short enough not to be a hang. */
export const DEFAULT_CONFIRM_TIMEOUT_MS = 300_000;

export interface PendingConfirmation {
  id: string;
  request: HostConfirmRequest;
}

export interface StudioServiceOptions {
  workspaceDir: string;
  /**
   * The studio's own origin, for the preview wire it opens into every project (AC-15.3).
   *
   * A function because the dev server does not know its URL until it listens, and this
   * service is built while the config is still being read. `sveStudio` fills it in from
   * `server.resolvedUrls`; nothing a browser sends may reach it.
   */
  studioOrigin?: () => string | undefined;
  /** Injected so this can be driven without starting a dev server. */
  createHost?: (options: HostOptions) => Host;
  git?: GitRunner;
  runCommand?: CommandRunner;
  portBase?: number;
  probe?: boolean;
  confirmTimeoutMs?: number;
  fetch?: typeof fetch;
  /** The planners' transport. Injected for the same reason the runners' is (AC-10.7). */
  http?: HttpClient;
  /** Overrides the choice below wholesale. Tests only. */
  planner?: (id: ProviderId, settings: ProviderSettings) => Planner;
  newId?: () => string;
}

export interface StudioService {
  connect(
    request: ConnectRequestBody,
    onEvent?: (event: ConnectEvent) => void,
  ): Promise<ConnectOutcome>;
  sessions(): SessionSummary[];
  closeSession(id: string): Promise<void>;

  providers(): ProviderView[];
  selectProvider(id: ProviderId): ProviderView[];
  configureProvider(id: ProviderId, settings: ProviderSettings): ProviderView[];

  /** The host's confirmation hook. Public because the queue is the studio's to drain. */
  confirm(request: HostConfirmRequest): Promise<boolean>;
  confirmations(): PendingConfirmation[];
  answerConfirm(id: string, allow: boolean): boolean;

  apply(sessionUrl: string, intent: EditIntent): Promise<EditResult>;
  revert(sessionUrl: string, jobId: string): Promise<EditResult>;
  source(sessionUrl: string, file: string): Promise<string | null>;

  plan(request: PlanRequest): Promise<PlanResult>;

  close(): Promise<void>;
}

function summarise(status: SessionStatus): SessionSummary {
  return {
    id: status.id,
    url: status.url,
    root: status.root,
    port: status.port,
    agent: status.agent,
    source: status.source,
    stamping: status.stamping,
    diagnostics: status.diagnostics,
  };
}

function refusal(reason: ConnectFailure, message: string): ConnectOutcome {
  return { ok: false, reason, message };
}

export function createStudioService(options: StudioServiceOptions): StudioService {
  const providers: ProviderStore = createProviderStore();
  const doFetch = options.fetch ?? globalThis.fetch;
  const confirmTimeoutMs = options.confirmTimeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS;
  /**
   * The planner follows the picker.
   *
   * The same three providers, and the same rule: nothing reaches the network because a
   * page loaded. `fake` is the default and needs no credential; the other two are one HTTP
   * request each, with no tools, because a planner produces an override and an override is
   * an illusion — it must not be able to reach a file even in principle.
   */
  const http: HttpClient =
    options.http ??
    (async (url, init) => {
      const response = await doFetch(url, init as RequestInit);
      return { ok: response.ok, status: response.status, text: () => response.text() };
    });

  const buildPlanner =
    options.planner ??
    ((id: ProviderId, settings: ProviderSettings): Planner => {
      if (id === 'openai') return createOpenAiPlanner(settings, http);
      if (id === 'claude') return createClaudePlanner(settings, http);
      return createFakePlanner();
    });

  let counter = 0;
  const nextId = options.newId ?? (() => `c_${(counter += 1).toString(36)}`);

  /** Who is listening to the connect currently in progress. Connects are one at a time. */
  let emit: (event: ConnectEvent) => void = () => undefined;

  const waiting = new Map<
    string,
    { request: HostConfirmRequest; settle: (allow: boolean) => void; timer: ReturnType<typeof setTimeout> }
  >();

  function confirm(request: HostConfirmRequest): Promise<boolean> {
    const id = nextId();
    emit({ kind: 'phase', phase: 'confirming', detail: request.command });
    emit({ kind: 'confirm', id, request });

    return new Promise<boolean>((resolve) => {
      const settle = (allow: boolean): void => {
        const entry = waiting.get(id);
        if (!entry) return;
        clearTimeout(entry.timer);
        waiting.delete(id);
        resolve(allow);
      };
      // Unanswered is denied, not pending forever: `denyByDefault` is the host's own
      // position and a queue that waited would turn a security prompt into a stalled UI.
      const timer = setTimeout(() => settle(false), confirmTimeoutMs);
      timer.unref?.();
      waiting.set(id, { request, settle, timer });
    });
  }

  const host: Host = (options.createHost ?? createRealHost)({
    workspaceDir: options.workspaceDir,
    createAgent: () => providers.runner(),
    confirm,
    ...(options.studioOrigin === undefined ? {} : { studioOrigin: options.studioOrigin }),
    ...(options.git === undefined ? {} : { git: options.git }),
    ...(options.runCommand === undefined
      ? {}
      : {
          runCommand: async (command, args, cwd) => {
            if (command === 'npm' && args[0] === 'install') {
              emit({ kind: 'phase', phase: 'installing', detail: cwd });
            }
            return options.runCommand!(command, args, cwd);
          },
        }),
    ...(options.portBase === undefined ? {} : { portBase: options.portBase }),
    ...(options.probe === undefined ? {} : { probe: options.probe }),
  });

  async function post(url: string, path: string, body: unknown): Promise<unknown> {
    const response = await doFetch(new URL(path, url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const detail =
        payload !== null && typeof payload === 'object' && 'message' in payload
          ? String((payload as { message: unknown }).message)
          : response.statusText;
      throw new Error(`${path} answered ${response.status}: ${detail}`);
    }
    return payload;
  }

  return {
    async connect(request, onEvent) {
      emit = onEvent ?? (() => undefined);
      try {
        if (!isRepositoryRequest(request)) {
          /**
           * Detected here as well as inside the host, and deliberately.
           *
           * It is the only way to report `detecting` and `starting` as separate states for
           * a folder, and it is the same function the host will run a moment later, so the
           * refusal a user reads is the refusal the host would have given.
           */
          emit({ kind: 'phase', phase: 'detecting', detail: request.folder });
          const detected = await detectProject(request.folder, {
            ...(request.editRoots === undefined ? {} : { editRoots: request.editRoots }),
          });
          if (!detected.ok) return refusal(detected.reason, detected.message);
          emit({ kind: 'phase', phase: 'starting', detail: detected.root });
        } else {
          emit({ kind: 'phase', phase: 'cloning', detail: request.repository });
        }

        const result = await host.connect(
          isRepositoryRequest(request)
            ? {
                repository: request.repository,
                ...(request.install === undefined ? {} : { install: request.install }),
                ...(request.editRoots === undefined ? {} : { editRoots: request.editRoots }),
              }
            : {
                folder: request.folder,
                ...(request.editRoots === undefined ? {} : { editRoots: request.editRoots }),
              },
        );

        if (!result.ok) return refusal(result.reason, result.message);
        return { ok: true, session: summarise(result.session.status()) };
      } catch (error) {
        return refusal('server-failed', error instanceof Error ? error.message : String(error));
      } finally {
        emit = () => undefined;
      }
    },

    sessions: () => host.sessions().map(summarise),
    closeSession: (id) => host.close(id),

    providers: () => providers.views(),
    selectProvider: (id) => providers.select(id),
    configureProvider: (id, settings) => providers.configure(id, settings),

    confirm,
    confirmations: () =>
      [...waiting.entries()].map(([id, entry]) => ({ id, request: entry.request })),
    answerConfirm(id, allow) {
      const entry = waiting.get(id);
      if (!entry) return false;
      entry.settle(allow);
      return true;
    },

    async apply(sessionUrl, intent) {
      const payload = await post(sessionUrl, APPLY_PATH, { intents: [intent] });
      const results = (payload as { results?: unknown[] } | null)?.results ?? [];
      const first = results[0];
      if (first === undefined) throw new Error(`${APPLY_PATH} returned no result`);
      // Parsed rather than trusted: a shape mismatch here would surface three steps later
      // as an unexplained verdict.
      return EditResultSchema.parse(first);
    },

    async revert(sessionUrl, jobId) {
      return EditResultSchema.parse(await post(sessionUrl, REVERT_PATH, { jobId }));
    },

    async source(sessionUrl, file) {
      const url = new URL(SOURCE_PATH, sessionUrl);
      url.searchParams.set('file', file);
      const response = await doFetch(url);
      return response.ok ? await response.text() : null;
    },

    plan: (request) => buildPlanner(providers.selected(), providers.settings(providers.selected())).plan(request),

    async close() {
      for (const [, entry] of [...waiting]) entry.settle(false);
      await host.closeAll();
    },
  };
}
