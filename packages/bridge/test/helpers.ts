import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseLoc, type EditIntent } from '@sve/protocol';
import type {
  AgentContext,
  AgentProgress,
  AgentToolRequest,
  ToolPermission,
} from '../src/agent/types.js';
import { nodeFs, type BridgeFs } from '../src/fs.js';

/**
 * A source fixture that is hostile to careless IO: CRLF terminators, a trailing
 * newline, and non-ASCII characters. Anything that round-trips this through
 * strings with implicit encoding or line-ending normalisation will corrupt it.
 */
export const HERO_SOURCE_LINES = [
  'export function Hero() {',
  '  return (',
  '    <section className="hero">',
  '      <h1 className="text-5xl font-bold">Swim today</h1>',
  '      <p className="lede">Café-cold water, warm code.</p>',
  '    </section>',
  '  );',
  '}',
];

/** CRLF everywhere, including a terminator on the final line. */
export const HERO_SOURCE = Buffer.from(HERO_SOURCE_LINES.join('\r\n') + '\r\n', 'utf8');

/** The `<h1>` above: line 4, column 7 (1-based, as the Babel stamp emits). */
export const HERO_H1_LINE = 4;
export const HERO_H1_COL = 7;

const created: string[] = [];

/** A temp directory whose own symlinks are already resolved, so guard tests compare like with like. */
export function makeTempDir(prefix = 'sve-'): string {
  const dir = realpathSync(mkdtempSync(path.join(realpathSync(tmpdir()), prefix)));
  created.push(dir);
  return dir;
}

/** A project root containing `src/Hero.tsx` with {@link HERO_SOURCE}. */
export function makeProject(): { root: string; file: string; rel: string } {
  const root = makeTempDir('sve-project-');
  mkdirSync(path.join(root, 'src'));
  const rel = path.join('src', 'Hero.tsx');
  const file = path.join(root, rel);
  writeFileSync(file, HERO_SOURCE);
  return { root, file, rel };
}

export function cleanupTempDirs(): void {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
}

const computed = {
  color: 'rgb(14, 17, 22)',
  fontSize: '48px',
  fontWeight: '700',
};

/** A text-edit intent against the `<h1>` of the Hero fixture. */
export function makeIntent(overrides: Partial<EditIntent> = {}): EditIntent {
  const loc = `src/Hero.tsx:${HERO_H1_LINE}:${HERO_H1_COL}`;
  return {
    eid: 'Hero.tsx#Hero/section:0/h1:0',
    eidIndex: 0,
    loc,
    tag: 'h1',
    kind: 'text',
    before: { text: 'Swim today', classes: ['text-5xl', 'font-bold'], computed },
    after: { text: 'Ship faster', classes: ['text-5xl', 'font-bold'], computed },
    instruction: 'Replace the heading text with "Ship faster".',
    ...overrides,
  };
}

export interface FsSpy {
  fs: BridgeFs;
  calls: string[];
  reset(): void;
}

/** Wraps a {@link BridgeFs} and records every method name it is asked for. */
export function spyFs(inner: BridgeFs): FsSpy {
  const calls: string[] = [];
  const wrapped = {} as Record<string, unknown>;
  for (const key of Object.keys(inner) as (keyof BridgeFs)[]) {
    const method = inner[key] as (...args: never[]) => unknown;
    wrapped[key] = (...args: never[]) => {
      calls.push(key);
      return method.apply(inner, args);
    };
  }
  return { fs: wrapped as unknown as BridgeFs, calls, reset: () => calls.splice(0) };
}

/** Resolves once `predicate` holds, so tests never sleep on a fixed timer. */
export async function waitFor(
  predicate: () => boolean,
  message = 'condition never became true',
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`waitFor: ${message}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

export interface TestAgentContext {
  ctx: AgentContext;
  progress: AgentProgress[];
  requests: AgentToolRequest[];
}

/** A minimal {@link AgentContext}, so a runner can be exercised without the bridge around it. */
export function makeAgentContext(options: {
  root: string;
  file: string;
  intent?: EditIntent;
  editRoots?: readonly string[];
  jobId?: string;
  fs?: BridgeFs;
  canUseTool?: (request: AgentToolRequest) => Promise<ToolPermission>;
}): TestAgentContext {
  const intent = options.intent ?? makeIntent();
  const progress: AgentProgress[] = [];
  const requests: AgentToolRequest[] = [];

  const ctx: AgentContext = {
    jobId: options.jobId ?? 'job_test',
    intent,
    loc: parseLoc(intent.loc)!,
    file: options.file,
    root: options.root,
    editRoots: options.editRoots ?? [options.root],
    prompt: 'prompt withheld: this context exercises runner behaviour, not prompt text',
    fs: options.fs ?? nodeFs,
    signal: new AbortController().signal,
    async canUseTool(request) {
      requests.push(request);
      return options.canUseTool ? options.canUseTool(request) : { behavior: 'allow' };
    },
    report(update) {
      progress.push(update);
    },
  };

  return { ctx, progress, requests };
}

/** A promise plus its resolve, for stubs that must park mid-job. */
export function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
