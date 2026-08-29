import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Options as SdkOptions, query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { ClaudeSdkOptions, SdkQuery } from '../src/agent/claude.js';
import { cleanupTempDirs, HERO_H1_COL, HERO_H1_LINE, makeIntent, makeProject } from './helpers.js';

afterAll(cleanupTempDirs);

/**
 * AC-10.2 — the Claude Agent SDK is optional.
 *
 * Someone whose project uses DeepSeek or a local Ollama has no reason to
 * download a hosted agent's SDK, and no way to authenticate with it if they
 * did. So it is an optional peer dependency, and the bridge must typecheck,
 * unit-test and run without it on disk.
 *
 * The thing that made that hard is the compile-time seam assertion: it existed
 * so the compiler would notice if the installed SDK's `query` stopped fitting
 * this runner's narrow view of it, and it did that by importing the SDK's own
 * types into `src/`, which is exactly what forces the dependency into every
 * install. The assertion is not weakened here — it is moved into this file,
 * where the SDK *is* installed, and `src/` keeps a local structural mirror.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(here, '..');
const SDK = '@anthropic-ai/claude-agent-sdk';

/* ── the seam, still asserted — from the test tree ────────────────────────── */

/**
 * Fails to compile if the installed SDK's `query` stops fitting the seam.
 *
 * It proves more than it used to. `SdkQuery`'s parameter now carries the
 * bridge's own {@link ClaudeSdkOptions}, so for the SDK's `query` to remain
 * assignable, that mirror has to stay assignable to the SDK's real `Options` —
 * a field renamed or retyped upstream still fails the build.
 */
type Assert<_T extends SdkQuery> = true;
export type _QuerySeamHolds = Assert<typeof sdkQuery>;

/** And the mirror itself, asserted directly rather than only by implication. */
type AssertOptions<_T extends SdkOptions> = true;
export type _OptionsSeamHolds = AssertOptions<ClaudeSdkOptions>;

/* ── the declaration ──────────────────────────────────────────────────────── */

function json(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}

describe('AC-10.2 the dependency declaration', () => {
  const manifest = json(path.join(pkgRoot, 'package.json'));

  it('lists the SDK as a peer dependency, not a hard one', () => {
    const dependencies = (manifest['dependencies'] ?? {}) as Record<string, string>;
    const peers = (manifest['peerDependencies'] ?? {}) as Record<string, string>;

    expect(dependencies[SDK]).toBeUndefined();
    expect(peers[SDK]).toBeTypeOf('string');
  });

  it('marks that peer optional, so installing the bridge does not install it', () => {
    const meta = (manifest['peerDependenciesMeta'] ?? {}) as Record<string, { optional?: boolean }>;

    expect(meta[SDK]?.optional).toBe(true);
  });

  it('keeps it as a workspace dev dependency, so this repo can still exercise it', () => {
    const root = json(path.join(pkgRoot, '..', '..', 'package.json'));
    const dev = (root['devDependencies'] ?? {}) as Record<string, string>;

    // Optional for a consumer, present here: the Claude runner's own suite and
    // the seam assertion above both need the real types to mean anything.
    expect(dev[SDK]).toBeTypeOf('string');
  });
});

/* ── nothing in src reaches for it ────────────────────────────────────────── */

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
    else if (entry.endsWith('.ts')) found.push(full);
  }
  return found;
}

describe('AC-10.2 the bridge source', () => {
  const files = sourceFiles(path.join(pkgRoot, 'src'));

  it('has sources to scan', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('never names the SDK in a static import, which is what would force it', () => {
    // A static `import` — type-only included — is resolved by the compiler and
    // by the loader whether or not the code path is ever taken. One anywhere in
    // `src/` is the whole of AC-10.2 undone, so the shape of the source is
    // asserted rather than the symptom.
    const offenders = files.filter((file) => {
      const source = readFileSync(file, 'utf8');
      return new RegExp(`(from|import)\\s*\\(?\\s*['"]${SDK}['"]`).test(source);
    });

    expect(offenders.map((file) => path.relative(pkgRoot, file))).toEqual([]);
  });

  it('reaches it only through a specifier the compiler cannot follow', () => {
    const claude = readFileSync(path.join(pkgRoot, 'src', 'agent', 'claude.ts'), 'utf8');

    // It is still loaded — lazily, inside `run`, for a real `SVE_AGENT=claude`
    // job — but through a variable, so a missing package is a runtime error on
    // the one path that needs it rather than a compile error for everyone.
    expect(claude).toContain(SDK);
    expect(claude).toMatch(/await import\((?!\s*['"])/);
  });
});

/* ── and it runs with the package unresolvable ────────────────────────────── */

describe('AC-10.2 with the SDK absent', () => {
  afterEach(() => {
    vi.doUnmock(SDK);
    vi.resetModules();
  });

  it('imports, resolves runners and completes a job', async () => {
    vi.resetModules();
    vi.doMock(SDK, () => {
      throw new Error(`Cannot find package '${SDK}'`);
    });

    // Freshly imported under the mock: anything that reached for the SDK on the
    // way in — a static import, a top-level await — throws here rather than in
    // a bug report from someone who only ever wanted to use a local model.
    const bridge = await import('../src/index.js');

    expect(bridge.resolveAgentRunner({}).name).toBe('fake');
    expect(bridge.agentRunnerNames()).toContain('claude');

    const { root, file, rel } = makeProject();
    const created = bridge.createBridge({
      root,
      agent: bridge.createFakeAgent(),
      undoRoot: path.join(root, '.sve-undo'),
    });
    const intent = makeIntent({
      loc: `${rel.replace(/\\/g, '/')}:${HERO_H1_LINE}:${HERO_H1_COL}`,
    });

    const [result] = await created.apply({ intents: [intent] });
    created.close();

    expect(result?.status).toBe('landed');
    expect(readFileSync(file).toString('utf8')).toContain('Ship faster');
  });

  it('still constructs the Claude runner, and only fails when it is actually run', async () => {
    vi.resetModules();
    vi.doMock(SDK, () => {
      throw new Error(`Cannot find package '${SDK}'`);
    });

    const bridge = await import('../src/index.js');

    // Constructing costs nothing: the credential check and the registry entry
    // are the bridge's own code. The SDK is only wanted once a job runs.
    const runner = bridge.resolveAgentRunner({ SVE_AGENT: 'claude', ANTHROPIC_API_KEY: 'sk-test' });

    expect(runner.name).toBe('claude');
    expect(runner.requiresNetwork).toBe(true);
  });
});
