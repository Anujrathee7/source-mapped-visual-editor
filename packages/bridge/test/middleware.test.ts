import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { EditResult, ProgressEvent } from '@sve/protocol';
import { createFakeAgent } from '../src/agent/fake.js';
import type { AgentRunner } from '../src/agent/types.js';
import { nodeFs } from '../src/fs.js';
import {
  createBridgeMiddleware,
  SVE_APPLY_PATH,
  SVE_SOURCE_PATH,
  SVE_EVENTS_PATH,
  SVE_REVERT_PATH,
  type BridgeMiddleware,
} from '../src/middleware.js';
import {
  cleanupTempDirs,
  deferred,
  HERO_SOURCE,
  makeIntent,
  makeProject,
  spyFs,
  waitFor,
  type FsSpy,
} from './helpers.js';

afterAll(cleanupTempDirs);

interface Harness {
  base: string;
  middleware: BridgeMiddleware;
  fsSpy: FsSpy;
  file: string;
  root: string;
  close(): Promise<void>;
}

const open: { server: Server; middleware: BridgeMiddleware }[] = [];

async function harness(agent: AgentRunner = createFakeAgent({ mode: 'correct' })): Promise<Harness> {
  const { root, file } = makeProject();
  const fsSpy = spyFs(nodeFs);
  const middleware = createBridgeMiddleware({ root, agent, fs: fsSpy.fs });

  const server = createServer((req, res) => {
    middleware(req, res, () => {
      res.statusCode = 404;
      res.end('fell through to the next handler');
    });
  });
  open.push({ server, middleware });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    base: `http://127.0.0.1:${port}`,
    middleware,
    fsSpy,
    file,
    root,
    async close() {
      middleware.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

afterAll(async () => {
  for (const { server, middleware } of open.splice(0)) {
    middleware.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

function post(base: string, path: string, body: string): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

/** Reads an SSE stream in the background, collecting decoded ProgressEvents. */
async function openEvents(base: string): Promise<{ events: ProgressEvent[]; close(): Promise<void> }> {
  const controller = new AbortController();
  const response = await fetch(`${base}${SVE_EVENTS_PATH}`, {
    signal: controller.signal,
    headers: { accept: 'text/event-stream' },
  });
  expect(response.headers.get('content-type')).toMatch(/text\/event-stream/);

  const events: ProgressEvent[] = [];
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  const pump = (async () => {
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        for (let split = buffer.indexOf('\n\n'); split !== -1; split = buffer.indexOf('\n\n')) {
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          for (const line of frame.split('\n')) {
            if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6)) as ProgressEvent);
          }
        }
      }
    } catch {
      /* aborted by close() */
    }
  })();

  return {
    events,
    async close() {
      controller.abort();
      await pump;
    },
  };
}

/** An agent that parks mid-job until released, then does a real edit. */
function parkedAgent(): { agent: AgentRunner; started: () => boolean; release: () => void } {
  const gate = deferred();
  const inner = createFakeAgent({ mode: 'correct' });
  let entered = false;
  return {
    agent: {
      name: 'parked',
      requiresNetwork: false,
      async run(ctx) {
        entered = true;
        await gate.promise;
        return inner.run(ctx);
      },
    },
    started: () => entered,
    release: () => gate.resolve(),
  };
}

const validBody = JSON.stringify({ intents: [makeIntent()] });

// AC-3.4
describe('POST /__sve/apply — untrusted input is parsed at the boundary', () => {
  let app: Harness;

  beforeEach(async () => {
    app = await harness();
    app.fsSpy.reset();
  });

  it.each([
    ['a body that is not JSON at all', 'not json at all'],
    ['a JSON array where an object belongs', '[]'],
    ['an object with no intents', '{}'],
    ['an intent missing required fields', JSON.stringify({ intents: [{ eid: 'x' }] })],
    ['a loc parseLoc rejects', JSON.stringify({ intents: [makeIntent({ loc: 'Hero.tsx:42' })] })],
    ['an unknown edit kind', JSON.stringify({ intents: [makeIntent({ kind: 'structure' as never })] })],
  ])('rejects %s with 400 and touches the filesystem not at all', async (_label, body) => {
    const response = await post(app.base, SVE_APPLY_PATH, body);

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toBeTruthy();
    expect(app.fsSpy.calls).toEqual([]);
  });

  it('rejects an empty intent list as 400, not as an empty success', async () => {
    const response = await post(app.base, SVE_APPLY_PATH, JSON.stringify({ intents: [] }));

    expect(response.status).toBe(400);
    expect((await response.json()) as { error: string }).toHaveProperty('error');
    expect(app.fsSpy.calls).toEqual([]);
  });

  it('rejects a non-POST with 405 and touches the filesystem not at all', async () => {
    const response = await fetch(`${app.base}${SVE_APPLY_PATH}`);
    expect(response.status).toBe(405);
    expect(app.fsSpy.calls).toEqual([]);
  });

  it('accepts a well-formed request and returns one EditResult per intent', async () => {
    const response = await post(app.base, SVE_APPLY_PATH, validBody);

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { results: EditResult[] };
    expect(payload.results).toHaveLength(1);
    expect(payload.results[0]?.status).toBe('landed');
    expect(payload.results[0]?.jobId).toBeTruthy();
    expect(readFileSync(app.file).toString('utf8')).toContain('>Ship faster<');
    expect(app.fsSpy.calls.length).toBeGreaterThan(0);
  });

  it('passes through anything that is not a bridge route', async () => {
    expect((await fetch(`${app.base}/index.html`)).status).toBe(404);
    expect((await fetch(`${app.base}/__sve/nonsense`)).status).toBe(404);
    expect(app.fsSpy.calls).toEqual([]);
  });
});

// AC-3.6
describe('GET /__sve/events — progress is streamed', () => {
  it('streams the phases of a job, each carrying its jobId', async () => {
    const app = await harness();
    const stream = await openEvents(app.base);

    const response = await post(app.base, SVE_APPLY_PATH, validBody);
    const { results } = (await response.json()) as { results: EditResult[] };
    const jobId = results[0]!.jobId;

    await waitFor(() => stream.events.some((event) => event.phase === 'done'));

    const phases = stream.events.map((event) => event.phase);
    expect(phases[0]).toBe('queued');
    expect(phases).toContain('snapshot');
    expect(phases).toContain('agent');
    expect(phases).toContain('writing');
    expect(phases.at(-1)).toBe('done');
    expect(stream.events.every((event) => event.jobId === jobId)).toBe(true);

    await stream.close();
    await app.close();
  });

  it('gives a client that connects mid-job the subsequent events', async () => {
    const parked = parkedAgent();
    const app = await harness(parked.agent);

    const applied = post(app.base, SVE_APPLY_PATH, validBody);
    await waitFor(parked.started, 'the agent never started');

    const stream = await openEvents(app.base);
    parked.release();
    await applied;
    await waitFor(() => stream.events.some((event) => event.phase === 'done'));

    const phases = stream.events.map((event) => event.phase);
    expect(phases).toContain('writing');
    expect(phases).toContain('done');
    expect(phases).not.toContain('queued'); // it had already gone by

    await stream.close();
    await app.close();
  });

  it('does not kill the job when the client disconnects, and leaks no listener', async () => {
    const parked = parkedAgent();
    const app = await harness(parked.agent);

    const stream = await openEvents(app.base);
    await waitFor(() => app.middleware.bridge.progress.listenerCount === 1);

    const applied = post(app.base, SVE_APPLY_PATH, validBody);
    await waitFor(parked.started, 'the agent never started');
    await stream.close();

    parked.release();
    const { results } = (await (await applied).json()) as { results: EditResult[] };

    expect(results[0]?.status).toBe('landed');
    expect(readFileSync(app.file).toString('utf8')).toContain('>Ship faster<');
    await waitFor(
      () => app.middleware.bridge.progress.listenerCount === 0,
      'the disconnected client left a listener behind',
    );

    await app.close();
  });
});

describe('POST /__sve/revert', () => {
  it('restores the snapshot for a job', async () => {
    const app = await harness();

    const { results } = (await (await post(app.base, SVE_APPLY_PATH, validBody)).json()) as {
      results: EditResult[];
    };
    expect(Buffer.compare(readFileSync(app.file), HERO_SOURCE)).not.toBe(0);

    const response = await post(
      app.base,
      SVE_REVERT_PATH,
      JSON.stringify({ jobId: results[0]!.jobId }),
    );

    expect(response.status).toBe(200);
    expect((await response.json()) as EditResult).toMatchObject({ status: 'reverted' });
    expect(Buffer.compare(readFileSync(app.file), HERO_SOURCE)).toBe(0);

    await app.close();
  });

  it('answers an unknown jobId with an error result, not a crash', async () => {
    const app = await harness();

    const response = await post(app.base, SVE_REVERT_PATH, JSON.stringify({ jobId: 'job_nope' }));

    expect(response.status).toBe(404);
    expect((await response.json()) as EditResult).toMatchObject({
      jobId: 'job_nope',
      status: 'error',
    });

    await app.close();
  });

  it('rejects a malformed revert body with 400', async () => {
    const app = await harness();
    app.fsSpy.reset();

    const response = await post(app.base, SVE_REVERT_PATH, JSON.stringify({ jobId: '' }));

    expect(response.status).toBe(400);
    expect(app.fsSpy.calls).toEqual([]);

    await app.close();
  });
});

/* ── GET /__sve/source ────────────────────────────────────────────────────── */

/**
 * The inspector's excerpt has to be the developer's source, not Vite's transformed
 * module. Asking the dev server for `/src/components/Hero.tsx` returns compiled output —
 * `"data-sve-loc": "..."` inside a props object — and a caret pointing at column 11 of
 * that is pointing at nothing. So the bridge, which already reads these files from disk to
 * build prompts, serves the raw bytes instead.
 */
describe('GET /__sve/source', () => {
  it('returns the file as written on disk', async () => {
    const app = await harness();
    const onDisk = readFileSync(app.file, 'utf8');

    const response = await fetch(
      `${app.base}${SVE_SOURCE_PATH}?file=${encodeURIComponent('src/Hero.tsx')}`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    const body = await response.text();
    expect(body).toBe(onDisk);
    // The giveaway that this is source and not a transformed module.
    expect(body).not.toContain('data-sve-loc');

    await app.close();
  });

  it('refuses a path outside editRoots, and reads nothing', async () => {
    const app = await harness();
    app.fsSpy.reset();

    const response = await fetch(
      `${app.base}${SVE_SOURCE_PATH}?file=${encodeURIComponent('../../../etc/passwd')}`,
    );

    expect(response.status).toBe(403);
    expect(app.fsSpy.calls.filter((call) => call.startsWith('readFile'))).toEqual([]);

    await app.close();
  });

  it('rejects a missing file parameter with 400', async () => {
    const app = await harness();
    const response = await fetch(`${app.base}${SVE_SOURCE_PATH}`);
    expect(response.status).toBe(400);
    await app.close();
  });

  it('reports an absent file as 404 rather than a server error', async () => {
    const app = await harness();
    const response = await fetch(
      `${app.base}${SVE_SOURCE_PATH}?file=${encodeURIComponent('src/Nope.tsx')}`,
    );
    expect(response.status).toBe(404);
    await app.close();
  });

  it('rejects a non-GET with 405', async () => {
    const app = await harness();
    const response = await post(app.base, `${SVE_SOURCE_PATH}?file=src/Hero.tsx`, '{}');
    expect(response.status).toBe(405);
    await app.close();
  });
});
