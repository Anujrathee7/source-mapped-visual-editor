/**
 * The studio's routes, mounted on its own dev server.
 *
 * Two shapes of response. Everything except `connect` is request/response JSON; `connect`
 * streams newline-delimited JSON, because the phases and the confirmation prompt happen
 * *during* the call and a user watching a repository clone needs them as they happen
 * rather than as a summary afterwards.
 *
 * Every body is parsed by a `src/api.ts` schema before it reaches the service. The service
 * starts dev servers, spawns `git` and holds API keys; the page asking is untrusted input.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  API,
  ApplyBodySchema,
  ConfigureProviderBodySchema,
  ConfirmBodySchema,
  ConnectBodySchema,
  PlanBodySchema,
  RevertBodySchema,
  SelectProviderBodySchema,
} from '../api.js';
import type { ConnectEvent } from '../session.js';
import type { StudioService } from './service.js';

export const MAX_BODY_BYTES = 512 * 1024;

export type Next = (error?: unknown) => void;
export type Handle = (req: IncomingMessage, res: ServerResponse, next: Next) => void;

export interface StudioMiddleware extends Handle {
  readonly service: StudioService;
  close(): Promise<void>;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(payload.byteLength),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

const TOO_LARGE = Symbol('too-large');

async function readBody(req: IncomingMessage): Promise<Buffer | typeof TOO_LARGE> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) {
      req.destroy();
      return TOO_LARGE;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

interface Schema<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: unknown };
}

async function parsed<T>(
  req: IncomingMessage,
  res: ServerResponse,
  schema: Schema<T>,
): Promise<{ ok: true; data: T } | { ok: false }> {
  const raw = await readBody(req);
  if (raw === TOO_LARGE) {
    sendJson(res, 413, { error: 'body_too_large' });
    return { ok: false };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw.toString('utf8'));
  } catch {
    sendJson(res, 400, { error: 'invalid_json' });
    return { ok: false };
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    sendJson(res, 400, { error: 'invalid_request' });
    return { ok: false };
  }
  return { ok: true, data: result.data };
}

export function createStudioMiddleware(service: StudioService): StudioMiddleware {
  function sessionUrl(id: string): string | null {
    return service.sessions().find((session) => session.id === id)?.url ?? null;
  }

  async function handleConnect(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await parsed(req, res, ConnectBodySchema);
    if (!body.ok) return;

    res.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    });

    const write = (line: unknown): void => {
      if (!res.writableEnded) res.write(`${JSON.stringify(line)}\n`);
    };

    const outcome = await service.connect(body.data, (event: ConnectEvent) => {
      write({ type: 'event', event });
    });
    write({ type: 'outcome', outcome });
    res.end();
  }

  const handle: Handle = (req, res, next) => {
    const pathname = (req.url ?? '').split('?')[0] ?? '';
    if (!pathname.startsWith('/api/')) return next();

    const fail = (error: unknown): void => {
      if (res.headersSent) {
        res.end();
        return;
      }
      sendJson(res, 500, {
        error: 'studio_failure',
        message: error instanceof Error ? error.message : String(error),
      });
    };

    const post = (work: () => Promise<void>): void => void work().catch(fail);

    switch (pathname) {
      case API.connect:
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' });
        return post(() => handleConnect(req, res));

      case API.confirm:
        return post(async () => {
          const body = await parsed(req, res, ConfirmBodySchema);
          if (!body.ok) return;
          sendJson(res, 200, { answered: service.answerConfirm(body.data.id, body.data.allow) });
        });

      case API.providers:
        return sendJson(res, 200, { providers: service.providers() });

      case API.sessions:
        return sendJson(res, 200, { sessions: service.sessions() });

      case API.selectProvider:
        return post(async () => {
          const body = await parsed(req, res, SelectProviderBodySchema);
          if (!body.ok) return;
          sendJson(res, 200, { providers: service.selectProvider(body.data.id) });
        });

      case API.configureProvider:
        return post(async () => {
          const body = await parsed(req, res, ConfigureProviderBodySchema);
          if (!body.ok) return;
          // The reply is views, which carry booleans and sentences. A key entered here
          // never appears in a response body.
          sendJson(res, 200, {
            providers: service.configureProvider(body.data.id, body.data.settings),
          });
        });

      case API.apply:
        return post(async () => {
          const body = await parsed(req, res, ApplyBodySchema);
          if (!body.ok) return;
          const url = sessionUrl(body.data.sessionId);
          if (url === null) return sendJson(res, 404, { error: 'unknown_session' });
          sendJson(res, 200, await service.apply(url, body.data.intent));
        });

      case API.revert:
        return post(async () => {
          const body = await parsed(req, res, RevertBodySchema);
          if (!body.ok) return;
          const url = sessionUrl(body.data.sessionId);
          if (url === null) return sendJson(res, 404, { error: 'unknown_session' });
          sendJson(res, 200, await service.revert(url, body.data.jobId));
        });

      case API.plan:
        return post(async () => {
          const body = await parsed(req, res, PlanBodySchema);
          if (!body.ok) return;
          sendJson(res, 200, await service.plan(body.data));
        });

      default:
        return next();
    }
  };

  return Object.assign(handle, {
    service,
    close: () => service.close(),
  }) as StudioMiddleware;
}

export interface ViteServerLike {
  middlewares: { use(handle: Handle): unknown };
}

export interface StudioPluginLike {
  name: string;
  apply: 'serve';
  configureServer(server: ViteServerLike): void;
}

/**
 * The studio's own Vite plugin: the React app is served by Vite, and the host runs in the
 * same process behind `/api/`. One process, two servers' worth of responsibility, and the
 * connected projects get servers of their own from `@sve/host`.
 */
export function sveStudio(service: StudioService): StudioPluginLike {
  return {
    name: 'sve:studio',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(createStudioMiddleware(service));
    },
  };
}
