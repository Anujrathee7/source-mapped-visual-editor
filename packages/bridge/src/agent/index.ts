import { claudeCredentials, createClaudeAgent, missingCredentialMessage } from './claude.js';
import { createFakeAgent, FAKE_MODES, isFakeMode } from './fake.js';
import { createOpenAiAgent, openAiSettings } from './openai.js';
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
  type ClaudeSdkOptions,
  type SdkQuery,
} from './claude.js';

export {
  createOpenAiAgent,
  isLocalEndpoint,
  missingOpenAiSettingMessage,
  openAiSettings,
  OPENAI_CHAT_PATH,
  OPENAI_ENV,
  OPENAI_MAX_TURNS,
  OPENAI_TOOLS,
  type HttpClient,
  type HttpRequest,
  type HttpResponse,
  type OpenAiAgentOptions,
  type OpenAiSettings,
  type OpenAiSettingsResult,
} from './openai.js';

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

/**
 * Every OpenAI-compatible endpoint, as one entry (AC-10.3).
 *
 * DeepSeek, Ollama, OpenRouter, LM Studio and Groq are the same three settings
 * with different values, so registering one per vendor would be five copies of
 * the same tool loop diverging at five different rates.
 *
 * The settings are resolved here, before anything is constructed, so a missing
 * endpoint, model or key is a sentence naming the variable rather than a 401
 * out of an HTTP client three layers down (AC-10.9).
 */
registerAgentRunner('openai', ({ env }) => {
  const resolved = openAiSettings(env);
  if (!resolved.ok) throw new Error(resolved.message);
  return createOpenAiAgent(resolved.settings);
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
