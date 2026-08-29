import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createOpenAiAgent, openAiSettings, OPENAI_ENV } from '../src/agent/openai.js';
import { createBridge } from '../src/bridge.js';
import { splitLines } from '../src/source.js';
import {
  cleanupTempDirs,
  HERO_H1_COL,
  HERO_H1_LINE,
  HERO_SOURCE,
  HERO_SOURCE_LINES,
  makeIntent,
  makeProject,
} from './helpers.js';

/**
 * AC-10.10 — the live suite, and it is opt-in.
 *
 * Everything else about this runner is asserted against scripted responses, and
 * has to be: a unit suite that reached a real endpoint would need a key, a
 * network and someone's money, and would fail for reasons that have nothing to
 * do with this code. But scripted responses only ever prove the runner handles
 * the shapes *we thought of*, and the whole premise of the milestone is that
 * cheap models produce shapes nobody thought of. So there is one suite that
 * actually asks a model, and it is skipped unless explicitly asked for.
 *
 * Run it with the endpoint settings plus `SVE_LIVE_OPENAI=1`:
 *
 * ```
 * SVE_LIVE_OPENAI=1 \
 * SVE_OPENAI_BASE_URL=http://localhost:11434/v1 \
 * SVE_OPENAI_MODEL=qwen2.5-coder \
 * npx vitest run packages/bridge/test/openai-live.test.ts
 * ```
 *
 * It asserts **outcomes** and nothing else: the status reached, and the file
 * changed at the element that was named. Never diff text, never the model's
 * phrasing. A real model's wording is not deterministic, and a suite that
 * pinned it would be flaky by construction — and would be testing the model
 * rather than this system's contract with it.
 */

const asked = (process.env['SVE_LIVE_OPENAI'] ?? '').trim() !== '';
const settings = openAiSettings(process.env);

/** A model reads, thinks and writes. Generous, and still a bound. */
const LIVE_TIMEOUT = 180_000;

afterAll(cleanupTempDirs);

describe.runIf(asked)('AC-10.10 against a real endpoint', () => {
  it('has settings to run with', () => {
    // Asked for and not configured is a failure, not a skip: someone set
    // SVE_LIVE_OPENAI expecting this to run, and silence would look like a pass.
    expect(settings.ok, settings.ok ? '' : settings.message).toBe(true);
    expect(process.env[OPENAI_ENV.baseUrl]).toBeTruthy();
  });

  function liveBridge() {
    const project = makeProject();
    if (!settings.ok) throw new Error(settings.message);
    return {
      ...project,
      bridge: createBridge({
        root: project.root,
        agent: createOpenAiAgent(settings.settings),
        undoRoot: path.join(project.root, '.sve-undo'),
      }),
      loc: `${project.rel.replace(/\\/g, '/')}:${HERO_H1_LINE}:${HERO_H1_COL}`,
    };
  }

  it(
    'lands a text edit at the element it was given, and nowhere else',
    async () => {
      const { file, bridge, loc } = liveBridge();

      const [result] = await bridge.apply({ intents: [makeIntent({ loc })] });
      bridge.close();

      expect(result?.status).toBe('landed');

      const after = splitLines(readFileSync(file));
      expect(after[HERO_H1_LINE - 1]?.text).toContain('Ship faster');

      // Only that line moved. The rest of the file, its CRLF terminators and
      // its non-ASCII bytes are all as they were.
      expect(after).toHaveLength(HERO_SOURCE_LINES.length);
      for (const [index, original] of HERO_SOURCE_LINES.entries()) {
        if (index === HERO_H1_LINE - 1) continue;
        expect(after[index]?.text).toBe(original);
      }
    },
    LIVE_TIMEOUT,
  );

  it(
    'refuses rather than improvises when the element is not what it was told',
    async () => {
      const { file, bridge, loc } = liveBridge();
      const intent = makeIntent({
        loc,
        before: {
          text: 'Sink tomorrow',
          classes: ['text-5xl', 'font-bold'],
          computed: makeIntent().before.computed,
        },
        instruction: 'Replace the heading text with "Ship faster".',
      });

      const [result] = await bridge.apply({ intents: [intent] });
      bridge.close();

      // Blocked or stalled — a refusal and a no-op are both honest here, and
      // which one a given model produces is the model's phrasing, not this
      // system's contract. What is not acceptable is a landed edit.
      expect(['blocked', 'stalled']).toContain(result?.status);
      expect(readFileSync(file)).toEqual(HERO_SOURCE);
    },
    LIVE_TIMEOUT,
  );

  it(
    'carries no session, so a retry is a fresh conversation that still works',
    async () => {
      const { file, bridge, loc } = liveBridge();
      const intent = makeIntent({ loc });

      const [first] = await bridge.apply({ intents: [intent] });
      const [second] = await bridge.apply(
        { intents: [makeIntent({ loc, before: { ...intent.after }, after: { ...intent.after, text: 'Ship sooner' } })] },
        {
          retry: {
            mismatch: [{ prop: 'text', intent: 'Ship sooner', rendered: 'Ship faster' }],
          },
        },
      );
      bridge.close();

      expect(first?.sessionId).toBeUndefined();
      expect(second?.sessionId).toBeUndefined();
      expect(second?.status).toBe('landed');
      expect(readFileSync(file).toString('utf8')).toContain('Ship sooner');
    },
    LIVE_TIMEOUT * 2,
  );
});

describe.skipIf(asked)('AC-10.10 when it was not asked for', () => {
  it('is skipped, and says how to run it', () => {
    // The suite above is registered either way, so a default run reports it as
    // skipped rather than as silently not existing.
    expect(asked).toBe(false);
  });
});
