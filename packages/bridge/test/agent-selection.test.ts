import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { agentRunnerNames, createFakeAgent, resolveAgentRunner } from '../src/agent/index.js';
import { createOpenAiAgent, type HttpClient } from '../src/agent/openai.js';
import { createBridge } from '../src/bridge.js';
import {
  cleanupTempDirs,
  HERO_H1_COL,
  HERO_H1_LINE,
  makeIntent,
  makeProject,
} from './helpers.js';

afterAll(cleanupTempDirs);

/**
 * AC-10.8 — the provider is a property of a session, not of the process.
 *
 * `SVE_AGENT` is one environment variable for a whole Node process. It cannot
 * say "this project uses DeepSeek and that one uses Claude", and a host serving
 * two projects at once has no way to set it twice. So the runner is constructed
 * by whoever is embedding the bridge and passed in through `BridgeOptions.agent`.
 *
 * The registry stays. It is what makes `SVE_AGENT=openai` work from the CLI and
 * from an E2E fixture, which is a real convenience — it is just not the seam a
 * host builds on.
 */

/** A client that answers "DONE" and never touches the network. */
const answersDone: HttpClient = async () => ({
  ok: true,
  status: 200,
  async text() {
    return JSON.stringify({
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'DONE' } }],
    });
  },
});

function openai() {
  return createOpenAiAgent({
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    apiKey: 'sk-test',
    http: answersDone,
  });
}

describe('AC-10.8 a runner passed per bridge', () => {
  it('lets two bridges in one process use two different providers', () => {
    const first = makeProject();
    const second = makeProject();

    const one = createBridge({
      root: first.root,
      agent: createFakeAgent(),
      undoRoot: path.join(first.root, '.sve-undo'),
    });
    const two = createBridge({
      root: second.root,
      agent: openai(),
      undoRoot: path.join(second.root, '.sve-undo'),
    });

    expect(one.agent.name).toBe('fake');
    expect(two.agent.name).toBe('openai');

    one.close();
    two.close();
  });

  it('does not consult SVE_AGENT at all when a runner was passed', async () => {
    const { root, file, rel } = makeProject();

    // An unknown name in the environment would throw out of the registry. A
    // bridge given its runner never asks, so a host is never at the mercy of a
    // variable set for some other project in the same process.
    const bridge = createBridge({
      root,
      agent: createFakeAgent(),
      env: { SVE_AGENT: 'not-a-registered-runner' },
      undoRoot: path.join(root, '.sve-undo'),
    });
    const intent = makeIntent({ loc: `${rel.replace(/\\/g, '/')}:${HERO_H1_LINE}:${HERO_H1_COL}` });

    const [result] = await bridge.apply({ intents: [intent] });
    bridge.close();

    expect(bridge.agent.name).toBe('fake');
    expect(result?.status).toBe('landed');
    expect(readFileSync(file).toString('utf8')).toContain('Ship faster');
  });

  it('still throws for an unknown SVE_AGENT when no runner was passed', () => {
    const { root } = makeProject();

    expect(() =>
      createBridge({
        root,
        env: { SVE_AGENT: 'not-a-registered-runner' },
        undoRoot: path.join(root, '.sve-undo'),
      }),
    ).toThrow(/not-a-registered-runner/);
  });
});

describe('AC-10.8 the registry stays, for the CLI', () => {
  it('lists every runner, with the fake still the default', () => {
    expect(agentRunnerNames()).toEqual(expect.arrayContaining(['fake', 'claude', 'openai']));
    expect(resolveAgentRunner({}).name).toBe('fake');
  });

  it('names the unknown runner and what is on offer', () => {
    let thrown: unknown;
    try {
      resolveAgentRunner({ SVE_AGENT: 'gemini' });
    } catch (error) {
      thrown = error;
    }

    const message = (thrown as Error).message;
    expect(message).toContain('gemini');
    expect(message).toContain('openai');
  });
});
