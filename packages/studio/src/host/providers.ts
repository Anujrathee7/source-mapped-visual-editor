/**
 * Where a provider becomes a runner, and where a key stops.
 *
 * Every sentence a user reads about a missing setting comes from `@sve/bridge` — this
 * module maps three UI fields onto the environment shape those functions already take, and
 * asks them. Writing a second "you need a key" message here would be a second definition
 * of what configured means, and they would disagree the first time one of them changed.
 *
 * Node-only. It reaches `@sve/bridge`, which holds file-write capability, and it holds the
 * only copy of anything secret in this package.
 */
import {
  CLAUDE_CREDENTIAL_ENV,
  OPENAI_ENV,
  claudeCredentials,
  createClaudeAgent,
  createFakeAgent,
  createOpenAiAgent,
  missingCredentialMessage,
  openAiSettings,
  type AgentEnv,
  type AgentRunner,
} from '@sve/bridge';
import {
  PROVIDERS,
  providerInfo,
  type ProviderId,
  type ProviderSettings,
  type ProviderView,
} from '../providers.js';

/** The three UI fields, as the environment the bridge's own resolvers read. */
export function envFor(id: ProviderId, settings: ProviderSettings): AgentEnv {
  if (id === 'claude') {
    return settings.apiKey ? { [CLAUDE_CREDENTIAL_ENV[0]]: settings.apiKey } : {};
  }
  if (id === 'openai') {
    return {
      ...(settings.baseUrl ? { [OPENAI_ENV.baseUrl]: settings.baseUrl } : {}),
      ...(settings.model ? { [OPENAI_ENV.model]: settings.model } : {}),
      ...(settings.apiKey ? { [OPENAI_ENV.apiKey]: settings.apiKey } : {}),
    };
  }
  return {};
}

/**
 * The sentence naming what is missing, computed before anything is constructed.
 *
 * AC-12.5, and AC-10.9 before it: a 401 arriving from inside an HTTP client three layers
 * down, four seconds into the first edit somebody tried to make, names nothing they can
 * act on.
 *
 * A credential already exported in the environment counts. Somebody who runs the studio
 * with `ANTHROPIC_API_KEY` set has configured it, and asking them to type it into a form
 * as well would be inventing a requirement.
 */
export function missingSettingFor(id: ProviderId, settings: ProviderSettings): string | null {
  const env: AgentEnv = { ...process.env, ...envFor(id, settings) };
  if (id === 'claude') return claudeCredentials(env).ok ? null : missingCredentialMessage();
  if (id === 'openai') {
    const resolved = openAiSettings(env);
    return resolved.ok ? null : resolved.message;
  }
  return null;
}

/**
 * The runner, constructed from what the picker holds — never from `SVE_AGENT`.
 *
 * AC-10.8: one environment variable cannot describe two sessions, and a host serves
 * several projects at once. The registry stays for the CLI; nothing here consults it.
 */
export function runnerFor(id: ProviderId, settings: ProviderSettings): AgentRunner {
  const missing = missingSettingFor(id, settings);
  if (missing !== null) throw new Error(missing);

  if (id === 'fake') return createFakeAgent();
  if (id === 'openai') {
    const resolved = openAiSettings({ ...process.env, ...envFor(id, settings) });
    if (!resolved.ok) throw new Error(resolved.message);
    return createOpenAiAgent(resolved.settings);
  }

  /**
   * The one place a setting has to leave this module.
   *
   * `createClaudeAgent` takes no credential: the Agent SDK reads the process environment
   * and spawns a subprocess that reads it too, so a key typed into the studio can only
   * reach it this way. It is a real limit and worth naming — Claude credentials are
   * therefore process-wide, where an OpenAI-compatible endpoint's are genuinely
   * per-session — and it is still inside the host process, never in the project and never
   * back across the wire.
   */
  if (settings.apiKey) process.env[CLAUDE_CREDENTIAL_ENV[0]] = settings.apiKey;
  return createClaudeAgent();
}

export interface ProviderStore {
  views(): ProviderView[];
  selected(): ProviderId;
  select(id: ProviderId): ProviderView[];
  configure(id: ProviderId, settings: ProviderSettings): ProviderView[];
  /** Node-side only. Never serialised, never returned by a route. */
  settings(id: ProviderId): ProviderSettings;
  /** Throws with the sentence naming what is missing. */
  runner(): AgentRunner;
}

function isConfigured(id: ProviderId, settings: ProviderSettings): boolean {
  return providerInfo(id)
    .fields.filter((field) => field.required)
    .every((field) => (settings[field.key] ?? '').trim() !== '');
}

/**
 * One store per studio session.
 *
 * Defaulting to the fake is the same decision `DEFAULT_AGENT` makes: nothing reaches the
 * network because a page loaded.
 */
export function createProviderStore(initial: ProviderId = 'fake'): ProviderStore {
  const settings = new Map<ProviderId, ProviderSettings>();
  let chosen: ProviderId = initial;

  const views = (): ProviderView[] =>
    PROVIDERS.map((provider) => {
      const held = settings.get(provider.id) ?? {};
      return {
        ...provider,
        // Deliberately a boolean. The value never crosses back.
        configured: isConfigured(provider.id, held) || missingSettingFor(provider.id, held) === null,
        missing: missingSettingFor(provider.id, held),
        selected: provider.id === chosen,
      };
    });

  return {
    views,
    selected: () => chosen,

    select(id) {
      chosen = id;
      return views();
    },

    configure(id, next) {
      const held = settings.get(id) ?? {};
      // Merged, not replaced: a form that re-submits without the key field must not clear
      // a key the user already gave.
      settings.set(id, {
        ...held,
        ...Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined)),
      });
      return views();
    },

    settings: (id) => ({ ...(settings.get(id) ?? {}) }),

    runner: () => runnerFor(chosen, settings.get(chosen) ?? {}),
  };
}
