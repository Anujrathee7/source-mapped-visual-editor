/**
 * AC-12.5 — the provider picker is honest.
 *
 * Three claims, each asserted rather than written on the page and hoped for: the cost is
 * stated where the choice is made, a missing credential names the setting *before* a job
 * runs, and a key entered in the UI never comes back out of the host process.
 */
import { describe, expect, it } from 'vitest';
import { claudeCredentials, missingCredentialMessage, openAiSettings } from '@sve/bridge';
import { PROVIDERS, VERIFIER_NOTE, providerInfo } from '../src/providers.js';
import { createProviderStore, envFor, missingSettingFor, runnerFor } from '../src/host/providers.js';

const SECRET = 'sk-not-a-real-key-0123456789';

describe('what is offered', () => {
  it('offers Claude, any OpenAI-compatible endpoint, and the fake', () => {
    expect(PROVIDERS.map((provider) => provider.id)).toEqual(['claude', 'openai', 'fake']);
  });

  it('states the cost where the choice is made', () => {
    for (const provider of PROVIDERS) {
      expect(provider.cost.length).toBeGreaterThan(20);
    }
    expect(providerInfo('fake').cost).toMatch(/free|no network|offline/i);
    expect(providerInfo('openai').cost).toMatch(/ollama|your own machine|endpoint/i);
  });

  it('says why a cheap model is a legitimate choice, rather than implying they are equal', () => {
    expect(VERIFIER_NOTE).toMatch(/drift/i);
    expect(VERIFIER_NOTE).toMatch(/not (?:equivalent|interchangeable|the same)/i);
  });

  it('asks an OpenAI-compatible endpoint for the three settings that make it one vendor', () => {
    expect(providerInfo('openai').fields.map((field) => field.key)).toEqual([
      'baseUrl',
      'model',
      'apiKey',
    ]);
  });
});

describe('a missing credential', () => {
  it('names the setting, in the words the bridge already uses', () => {
    expect(missingSettingFor('claude', {})).toBe(missingCredentialMessage());

    const openai = openAiSettings({});
    expect(openai.ok).toBe(false);
    expect(missingSettingFor('openai', {})).toBe(openai.ok ? null : openai.message);
  });

  it('is reported before a job runs — the store refuses to build a runner', () => {
    const store = createProviderStore();
    store.select('claude');
    expect(store.views().find((view) => view.id === 'claude')?.missing).toBe(
      missingCredentialMessage(),
    );
    expect(() => store.runner()).toThrow(missingCredentialMessage());
  });

  it('is absent for a local endpoint, which has nothing to authenticate against', () => {
    const settings = { baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5-coder' };
    expect(missingSettingFor('openai', settings)).toBeNull();
    expect(runnerFor('openai', settings).name).toBe('openai');
  });

  it('is absent for the fake, which needs nothing at all', () => {
    expect(missingSettingFor('fake', {})).toBeNull();
    expect(runnerFor('fake', {}).requiresNetwork).toBe(false);
  });
});

describe('keys', () => {
  it('are held in the host process and never sent to the browser', () => {
    const store = createProviderStore();
    store.configure('openai', {
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey: SECRET,
    });

    const views = store.views();
    expect(JSON.stringify(views)).not.toContain(SECRET);
    expect(views.find((view) => view.id === 'openai')?.configured).toBe(true);
    expect(views.find((view) => view.id === 'openai')?.missing).toBeNull();
    // It is still there, on this side of the wire, where the runner is built.
    expect(envFor('openai', store.settings('openai'))['SVE_OPENAI_API_KEY']).toBe(SECRET);
  });

  it('do not leak through the environment a runner is resolved from', () => {
    const store = createProviderStore();
    store.configure('openai', { baseUrl: 'https://api.deepseek.com/v1', model: 'x', apiKey: SECRET });
    const runner = store.runner();
    expect(JSON.stringify(Object.keys(runner))).not.toContain(SECRET);
  });
});

describe('per session, not per process', () => {
  it('builds a runner from what the picker holds, never from SVE_AGENT', () => {
    const one = createProviderStore();
    one.configure('openai', { baseUrl: 'http://localhost:11434/v1', model: 'a' });
    one.select('openai');
    const two = createProviderStore();
    two.select('fake');

    expect(one.runner().name).toBe('openai');
    expect(two.runner().name).toBe('fake');
  });

  it('defaults to the fake, so nothing reaches the network unasked', () => {
    expect(createProviderStore().selected()).toBe('fake');
    expect(createProviderStore().runner().requiresNetwork).toBe(false);
  });

  it('reads a credential already in the environment, so an exported key still works', () => {
    expect(claudeCredentials({ ANTHROPIC_API_KEY: SECRET }).ok).toBe(true);
    expect(missingSettingFor('claude', { apiKey: SECRET })).toBeNull();
  });
});
