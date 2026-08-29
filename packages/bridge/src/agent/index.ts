import { claudeCredentials, createClaudeAgent, missingCredentialMessage } from './claude.js';
import { createFakeAgent, FAKE_MODES, isFakeMode } from './fake.js';
import type { AgentEnv, AgentRunner, AgentRunnerFactory } from './types.js';

export * from './types.js';
export {
  pathOf,
  refusalIn,
  systemPromptWith,
  BLOCKED_LINE,
  SYSTEM_PROMPT,
  WRITING_TOOLS,
} from './shared.js';
export { createFakeAgent, FAKE_MODES, isFakeMode, type FakeMode, type FakeAgentOptions } from './fake.js';
export {
  claudeCredentials,
  createClaudeAgent,
  missingCredentialMessage,
  CLAUDE_CREDENTIAL_ENV,
  CLAUDE_MAX_TURNS,
  CLAUDE_MODEL,
  CLAUDE_TOOLS,
  type AgentStreamMessage,
  type ClaudeAgentOptions,
  type SdkQuery,
} from './claude.js';

export const DEFAULT_AGENT = 'fake';

const registry = new Map<string, AgentRunnerFactory>();

/**
 * How the runner is chosen: each one registers itself here and `SVE_AGENT`
 * names it. Nothing else in the bridge changes when a runner is swapped, and no
 * test has to reach into module internals to do it.
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

/**
 * The live runner. Registered unconditionally, selected only by `SVE_AGENT`
 * (AC-6.1) — the default stays the fake, so nothing implicitly reaches the
 * network and no test run costs tokens unless it asked to.
 *
 * The credential is checked here, before anything is constructed, so a missing
 * key is a sentence naming the variable rather than a transport error thrown
 * from inside the SDK three seconds into the first job.
 */
registerAgentRunner('claude', ({ env }) => {
  if (!claudeCredentials(env).ok) throw new Error(missingCredentialMessage());
  return createClaudeAgent();
});

export function resolveAgentRunner(env: AgentEnv = process.env): AgentRunner {
  const name = env.SVE_AGENT?.trim() || DEFAULT_AGENT;
  const factory = registry.get(name);

  if (!factory) {
    throw new Error(
      `unknown SVE_AGENT=${name}; registered runners: ${agentRunnerNames().join(', ')}`,
    );
  }

  return factory({ env });
}
