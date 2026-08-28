import { createFakeAgent, FAKE_MODES, isFakeMode } from './fake.js';
import type { AgentEnv, AgentRunner, AgentRunnerFactory } from './types.js';

export * from './types.js';
export { createFakeAgent, FAKE_MODES, isFakeMode, type FakeMode, type FakeAgentOptions } from './fake.js';

export const DEFAULT_AGENT = 'fake';

const registry = new Map<string, AgentRunnerFactory>();

/**
 * How M7 arrives: the real Claude Agent SDK runner registers itself here and
 * `SVE_AGENT=claude` starts selecting it. Nothing else in the bridge changes,
 * and no test has to reach into module internals to swap runners.
 */
export function registerAgentRunner(name: string, factory: AgentRunnerFactory): void {
  registry.set(name, factory);
}

export function agentRunnerNames(): string[] {
  return [...registry.keys()];
}

registerAgentRunner('fake', ({ env }) => {
  const mode = env.SVE_AGENT_MODE;
  if (mode !== undefined && mode !== '' && !isFakeMode(mode)) {
    throw new Error(`unknown SVE_AGENT_MODE=${mode}; expected one of ${FAKE_MODES.join(', ')}`);
  }
  return createFakeAgent(mode ? { mode } : {});
});

export function resolveAgentRunner(env: AgentEnv = process.env): AgentRunner {
  const name = env.SVE_AGENT?.trim() || DEFAULT_AGENT;
  const factory = registry.get(name);

  if (!factory) {
    if (name === 'claude') {
      throw new Error(
        'SVE_AGENT=claude: the Claude Agent SDK runner lands in M7. Until then, register ' +
          "one with registerAgentRunner('claude', …) or run with SVE_AGENT=fake.",
      );
    }
    throw new Error(
      `unknown SVE_AGENT=${name}; registered runners: ${agentRunnerNames().join(', ')}`,
    );
  }

  return factory({ env });
}
