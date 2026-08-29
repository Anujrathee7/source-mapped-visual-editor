/**
 * The browser's side of the studio's own wire.
 *
 * `connect` reads a newline-delimited stream because the phases and the confirmation
 * prompt happen during the call. Everything else is a plain POST.
 */
import type { EditIntent, EditResult } from '@sve/protocol';
import { API } from '../api.js';
import type { PlanRequest, PlanResult } from '../plan.js';
import type { ProviderId, ProviderSettings, ProviderView } from '../providers.js';
import type { ConnectEvent, ConnectOutcome, ConnectRequestBody, SessionSummary } from '../session.js';
import type { ConnectTransport } from './connect.js';

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  return (await response.json()) as T;
}

export interface StudioApi extends ConnectTransport {
  providers(): Promise<ProviderView[]>;
  selectProvider(id: ProviderId): Promise<ProviderView[]>;
  configureProvider(id: ProviderId, settings: ProviderSettings): Promise<ProviderView[]>;
  sessions(): Promise<SessionSummary[]>;
  apply(sessionId: string, intent: EditIntent): Promise<EditResult>;
  revert(sessionId: string, jobId: string): Promise<EditResult>;
  plan(request: PlanRequest): Promise<PlanResult>;
}

type ConnectLine = { type: 'event'; event: ConnectEvent } | { type: 'outcome'; outcome: ConnectOutcome };

export function createStudioApi(): StudioApi {
  return {
    async connect(request: ConnectRequestBody, onEvent) {
      const response = await fetch(API.connect, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      });
      const body = response.body;
      if (!response.ok || !body) {
        return { ok: false, reason: 'server-failed', message: `the studio answered ${response.status}` };
      }

      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffered = '';
      let outcome: ConnectOutcome | null = null;

      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffered += decoder.decode(chunk.value, { stream: true });
        const lines = buffered.split('\n');
        // The last piece may be half a line; it waits for the next chunk.
        buffered = lines.pop() ?? '';
        for (const line of lines) {
          if (line.trim() === '') continue;
          const parsed = JSON.parse(line) as ConnectLine;
          if (parsed.type === 'event') onEvent(parsed.event);
          else outcome = parsed.outcome;
        }
      }

      return (
        outcome ?? {
          ok: false,
          reason: 'server-failed',
          message: 'the studio closed the connection without an answer',
        }
      );
    },

    async answerConfirm(id, allow) {
      await post(API.confirm, { id, allow });
    },

    async providers() {
      const response = await fetch(API.providers);
      return ((await response.json()) as { providers: ProviderView[] }).providers;
    },

    async selectProvider(id) {
      return (await post<{ providers: ProviderView[] }>(API.selectProvider, { id })).providers;
    },

    async configureProvider(id, settings) {
      return (await post<{ providers: ProviderView[] }>(API.configureProvider, { id, settings }))
        .providers;
    },

    async sessions() {
      const response = await fetch(API.sessions);
      return ((await response.json()) as { sessions: SessionSummary[] }).sessions;
    },

    apply: (sessionId, intent) => post<EditResult>(API.apply, { sessionId, intent }),
    revert: (sessionId, jobId) => post<EditResult>(API.revert, { sessionId, jobId }),
    plan: (request) => post<PlanResult>(API.plan, request),
  };
}
