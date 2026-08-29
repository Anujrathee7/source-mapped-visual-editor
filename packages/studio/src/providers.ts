/**
 * The provider catalogue (AC-12.5).
 *
 * Browser-safe: labels, fields and the sentences a person reads while choosing. Nothing
 * that validates a credential lives here — that is `src/host/providers.ts`, on the side of
 * the wire where credentials are held — and nothing here ever carries a key's value.
 *
 * The copy is the substance of this file. AC-12.5 asks for the cost to be stated plainly
 * where the choice is made, and for the reason a cheap model is a *legitimate* choice to
 * be given rather than implied. Both are below, written once.
 */
export const PROVIDER_IDS = ['claude', 'openai', 'fake'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export type SettingKey = 'baseUrl' | 'model' | 'apiKey';

export interface ProviderField {
  key: SettingKey;
  label: string;
  placeholder: string;
  /** Entered once, held in the host process, never read back. */
  secret: boolean;
  required: boolean;
}

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** What it is, in one line. */
  summary: string;
  /** What it costs, in the words a person needs before pressing the button. */
  cost: string;
  fields: ProviderField[];
}

export interface ProviderSettings {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}

export interface ProviderView extends ProviderInfo {
  /** Whether every required setting has a value. Never says what the value is. */
  configured: boolean;
  /** The sentence naming what is missing, or null. Computed before any job runs. */
  missing: string | null;
  selected: boolean;
}

/**
 * The one paragraph that keeps the picker honest.
 *
 * A list of providers with prices next to them implies they are interchangeable. They are
 * not, and the interesting part of this project is *why the difference is survivable*: a
 * weak model's miswrite is normally invisible without reading the diff, and here it is
 * caught by the same loop that catches everything else.
 */
export const VERIFIER_NOTE =
  'These are not equivalent — a cheaper model miswrites edits more often. What makes a ' +
  'cheap one a reasonable trade rather than a gamble is that a miswrite is caught: after ' +
  'the write, hot reload re-renders, the override is lifted, and the rendered result is ' +
  'compared to what you asked for. Drift is shown, not shipped.';

export const PROVIDERS: readonly ProviderInfo[] = [
  {
    id: 'claude',
    label: 'Claude',
    summary: 'The Claude Agent SDK, running Read and Edit against the stamped line.',
    cost:
      'Billed per token by Anthropic. The most reliable single-shot edits here, and the ' +
      'most expensive: a one-element edit is a few thousand tokens of prompt plus the file.',
    fields: [
      {
        key: 'apiKey',
        label: 'API key',
        placeholder: 'sk-ant-…',
        secret: true,
        required: true,
      },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI-compatible endpoint',
    summary:
      'One runner for DeepSeek, OpenRouter, Groq, LM Studio and Ollama — base URL, model, key.',
    cost:
      'Whatever your endpoint charges: cents per million tokens on a hosted small model, ' +
      'or nothing at all with Ollama, which runs on your own machine and needs no key.',
    fields: [
      {
        key: 'baseUrl',
        label: 'Base URL',
        placeholder: 'https://api.deepseek.com/v1',
        secret: false,
        required: true,
      },
      { key: 'model', label: 'Model', placeholder: 'deepseek-chat', secret: false, required: true },
      {
        key: 'apiKey',
        label: 'API key',
        placeholder: 'not needed for a local endpoint',
        secret: true,
        required: false,
      },
    ],
  },
  {
    id: 'fake',
    label: 'Scripted',
    summary: 'Not a model. It performs the change it is told to, and can be told to get it wrong.',
    cost:
      'Free and offline — no network, no key. It is how the verifier itself is tested, so ' +
      'it is also the fastest way to see what a drifted verdict looks like.',
    fields: [],
  },
];

export function providerInfo(id: ProviderId): ProviderInfo {
  const found = PROVIDERS.find((provider) => provider.id === id);
  if (!found) throw new Error(`unknown provider: ${id}`);
  return found;
}
