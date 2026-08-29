import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApplyRequestSchema, RevertRequestSchema } from '@sve/protocol';
import path from 'node:path';
import { createBridge, type Bridge, type BridgeOptions } from './bridge.js';
import { nodeFs } from './fs.js';
import { isInsideEditRoots } from './guard.js';

export const SVE_BASE_PATH = '/__sve/';
export const SVE_APPLY_PATH = '/__sve/apply';
export const SVE_EVENTS_PATH = '/__sve/events';
export const SVE_REVERT_PATH = '/__sve/revert';
export const SVE_SOURCE_PATH = '/__sve/source';

/** 1 MiB. `ApplyRequestSchema` caps at 50 intents; this caps the bytes before parsing. */
export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

export type ConnectNext = (error?: unknown) => void;
export type ConnectHandle = (
  req: IncomingMessage,
  res: ServerResponse,
  next: ConnectNext,
) => void;

export interface BridgeMiddleware extends ConnectHandle {
  readonly bridge: Bridge;
  close(): void;
}

export interface BridgeMiddlewareOptions extends BridgeOptions {
  /** Supply a pre-built bridge to share one queue across mounts. */
  bridge?: Bridge;
  maxBodyBytes?: number;
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

async function readBody(
  req: IncomingMessage,
  limit: number,
): Promise<Buffer | typeof TOO_LARGE> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.byteLength;
    if (size > limit) {
      req.destroy();
      return TOO_LARGE;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

/**
 * The dev-server surface: `POST /__sve/apply`, `GET /__sve/events`,
 * `POST /__sve/revert`, mounted through Vite's `configureServer`.
 *
 * The browser is untrusted input and this process holds write capability, so
 * every request body is parsed with a `@sve/protocol` schema before anything
 * else happens — in particular, before any filesystem call. Nothing in the
 * request path so much as stats a file until a schema has accepted the body
 * (AC-3.4).
 */
export function createBridgeMiddleware(options: BridgeMiddlewareOptions): BridgeMiddleware {
  const bridge = options.bridge ?? createBridge(options);
  const limit = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const fs = options.fs ?? nodeFs;

  function methodNotAllowed(res: ServerResponse, allow: string): void {
    res.setHeader('allow', allow);
    sendJson(res, 405, { error: 'method_not_allowed', message: `expected ${allow}` });
  }

  async function readParsedBody<T>(
    req: IncomingMessage,
    res: ServerResponse,
    schema: { safeParse(input: unknown): { success: true; data: T } | { success: false; error: { issues: unknown[] } } },
  ): Promise<{ ok: true; data: T } | { ok: false }> {
    const raw = await readBody(req, limit);
    if (raw === TOO_LARGE) {
      sendJson(res, 413, { error: 'body_too_large', message: `body exceeds ${limit} bytes` });
      return { ok: false };
    }

    let json: unknown;
    try {
      json = JSON.parse(raw.toString('utf8'));
    } catch (error) {
      sendJson(res, 400, {
        error: 'invalid_json',
        message: error instanceof Error ? error.message : 'body is not JSON',
      });
      return { ok: false };
    }

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      sendJson(res, 400, {
        error: 'invalid_request',
        message: 'body does not match the @sve/protocol schema',
        issues: parsed.error.issues,
      });
      return { ok: false };
    }

    return { ok: true, data: parsed.data };
  }

  async function handleApply(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readParsedBody(req, res, ApplyRequestSchema);
    if (!body.ok) return;
    sendJson(res, 200, { results: await bridge.apply(body.data) });
  }

  async function handleRevert(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readParsedBody(req, res, RevertRequestSchema);
    if (!body.ok) return;
    const result = await bridge.revert(body.data.jobId);
    sendJson(res, result.status === 'error' ? 404 : 200, result);
  }

  function handleEvents(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Dev proxies buffer by default, which turns a live stream into one burst.
      'x-accel-buffering': 'no',
    });

    let closed = false;
    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    };

    const send = (chunk: string): void => {
      try {
        if (!res.writableEnded) res.write(chunk);
      } catch {
        cleanup();
      }
    };

    const unsubscribe = bridge.progress.subscribe((event) => {
      send(`event: progress\ndata: ${JSON.stringify(event)}\n\n`);
    });

    // Unref'd: a heartbeat must not be the reason a dev server refuses to exit.
    const heartbeat = setInterval(() => send(': keep-alive\n\n'), 20_000);
    heartbeat.unref?.();

    // A client that goes away must take its listener with it, and must not take
    // the job with it: the agent keeps writing whether or not anyone is watching.
    req.on('close', cleanup);
    req.on('error', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);

    send('retry: 1000\n\n');
  }


  /**
   * The inspector's source excerpt (AC-4.8).
   *
   * It cannot come from the dev server's own module graph: asking Vite for
   * `/src/components/Hero.tsx` returns the *transformed* module, where the JSX has become
   * a props object carrying the very `data-sve-*` attributes this pass added, and a caret
   * at column 11 of that points at nothing a developer wrote. The bridge already reads
   * these files from disk to build prompts, so it serves the bytes instead.
   *
   * Read-only, and behind the same guard as every write: the excerpt is shown in a browser
   * and must not become a way to read arbitrary files off the machine.
   */
  async function handleSource(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const query = (req.url ?? '').split('?')[1] ?? '';
    const file = new URLSearchParams(query).get('file');
    if (file === null || file === '') {
      return sendJson(res, 400, { error: 'missing_file', message: 'expected ?file=<path>' });
    }

    const absolute = path.resolve(bridge.root, file);
    if (!(await isInsideEditRoots(absolute, bridge.editRoots, fs))) {
      return sendJson(res, 403, {
        error: 'outside_edit_roots',
        message: `${file} is outside the configured editRoots`,
      });
    }

    let contents: Buffer;
    try {
      contents = await fs.readFile(absolute);
    } catch {
      return sendJson(res, 404, { error: 'not_found', message: `${file} does not exist` });
    }

    res.writeHead(200, {
      'content-type': 'text/plain; charset=utf-8',
      'content-length': String(contents.byteLength),
      'cache-control': 'no-store',
    });
    res.end(contents);
  }

  const handle: ConnectHandle = (req, res, next) => {
    const pathname = (req.url ?? '').split('?')[0] ?? '';
    if (!pathname.startsWith(SVE_BASE_PATH)) return next();

    const fail = (error: unknown): void => {
      if (!res.headersSent) {
        sendJson(res, 500, {
          error: 'bridge_failure',
          message: error instanceof Error ? error.message : String(error),
        });
      } else {
        res.end();
      }
    };

    switch (pathname) {
      case SVE_APPLY_PATH:
        if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
        void handleApply(req, res).catch(fail);
        return;

      case SVE_REVERT_PATH:
        if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
        void handleRevert(req, res).catch(fail);
        return;

      case SVE_SOURCE_PATH:
        if (req.method !== 'GET') return methodNotAllowed(res, 'GET');
        void handleSource(req, res).catch(fail);
        return;

      case SVE_EVENTS_PATH:
        if (req.method !== 'GET' && req.method !== 'HEAD') return methodNotAllowed(res, 'GET');
        return handleEvents(req, res);

      default:
        // An unknown /__sve/ path is Vite's to answer, not ours to guess at.
        return next();
    }
  };

  return Object.assign(handle, {
    bridge,
    close: () => bridge.close(),
  }) as BridgeMiddleware;
}

export interface ViteDevServerLike {
  middlewares: { use(handle: ConnectHandle): unknown };
}

export interface VitePluginLike {
  name: string;
  apply: 'serve';
  configureServer(server: ViteDevServerLike): void;
}

/**
 * Vite plugin wrapper. Node-only by construction — nothing here is importable
 * from browser code, and `apply: 'serve'` keeps it out of a production build.
 */
export function sveBridge(options: BridgeMiddlewareOptions): VitePluginLike {
  return {
    name: 'sve:bridge',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(createBridgeMiddleware(options));
    },
  };
}
