/**
 * The planners that reach a model (AC-12.1, AC-12.5).
 *
 * Same discipline as AC-10.7: the HTTP client is injected, every response below is
 * scripted, and a test that would reach a real endpoint is a bug in the test. What is
 * asserted is the part that keeps AC-12.1 true when a model is involved — a reply naming
 * an element the page never offered resolves to nothing, and nothing is written.
 */
import { describe, expect, it, vi } from 'vitest';
import { CLAUDE_MODEL, type HttpClient, type HttpResponse } from '@sve/bridge';
import { parsePlanReply, planPrompt } from '../src/host/plan-prompt.js';
import { createClaudePlanner } from '../src/host/planner-claude.js';
import { createOpenAiPlanner } from '../src/host/planner-openai.js';
import type { PlanRequest, PlanTarget } from '../src/plan.js';

const H1: PlanTarget = {
  eid: 'src/Hero.tsx#Hero/section:0/h1:0',
  eidIndex: 0,
  loc: 'src/Hero.tsx:3:5',
  tag: 'h1',
  text: 'Swim today',
  classes: ['title'],
  textKind: 'static',
  classKind: 'literal',
  selected: true,
};

const REQUEST: PlanRequest = { message: 'make the heading say Ship faster', elements: [H1] };

function respond(body: string, ok = true, status = 200): HttpResponse {
  return { ok, status, text: async () => body };
}

function openAiReply(content: string): string {
  return JSON.stringify({ choices: [{ message: { content } }] });
}

function claudeReply(text: string): string {
  return JSON.stringify({ content: [{ type: 'text', text }] });
}

const SETTINGS = { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: 'k' };

describe('the prompt', () => {
  it('names every element the model is allowed to choose, and nothing else', () => {
    const prompt = planPrompt(REQUEST);
    expect(prompt).toContain(H1.eid);
    expect(prompt).toContain(H1.loc);
    expect(prompt).toContain('make the heading say Ship faster');
    // The contract, stated: one JSON object, an eid from the list, one concrete change.
    expect(prompt).toMatch(/exactly one JSON object/i);
  });
});

describe('reading a reply', () => {
  it('accepts a text change on an element the page offered', () => {
    const result = parsePlanReply(
      JSON.stringify({ eid: H1.eid, kind: 'text', text: 'Ship faster' }),
      REQUEST,
    );
    expect(result.resolved).toBe(true);
    if (!result.resolved) return;
    expect(result.proposal).toMatchObject({ eid: H1.eid, loc: H1.loc, kind: 'text' });
    expect(result.proposal.override).toEqual({ text: 'Ship faster' });
    expect(result.reply).toContain('nothing is written until you press Apply');
  });

  it('accepts class and style changes', () => {
    const added = parsePlanReply(
      JSON.stringify({ eid: H1.eid, kind: 'class', add: ['text-flare'], remove: ['title'] }),
      REQUEST,
    );
    expect(added.resolved && added.proposal.override).toEqual({
      classes: { add: ['text-flare'], remove: ['title'] },
    });

    const styled = parsePlanReply(
      JSON.stringify({ eid: H1.eid, kind: 'style', style: { color: '#ff5a1f' } }),
      REQUEST,
    );
    expect(styled.resolved && styled.proposal.override).toEqual({ style: { color: '#ff5a1f' } });
  });

  it('finds the object inside the prose a small model wraps it in', () => {
    const result = parsePlanReply(
      'Sure! Here is the change:\n```json\n' +
        JSON.stringify({ eid: H1.eid, kind: 'text', text: 'Ship faster' }) +
        '\n```\nLet me know.',
      REQUEST,
    );
    expect(result.resolved).toBe(true);
  });

  it('refuses an element the page never offered', () => {
    const result = parsePlanReply(
      JSON.stringify({ eid: 'src/Footer.tsx#Footer/p:0', kind: 'text', text: 'Ship faster' }),
      REQUEST,
    );
    expect(result.resolved).toBe(false);
    expect(result.reply).toMatch(/Footer/);
  });

  it('refuses a reply that is not JSON at all', () => {
    const result = parsePlanReply('I think you should make the hero tighter.', REQUEST);
    expect(result.resolved).toBe(false);
  });

  it('refuses a change that resolves to nothing', () => {
    const empty = parsePlanReply(JSON.stringify({ eid: H1.eid, kind: 'class' }), REQUEST);
    expect(empty.resolved).toBe(false);
  });

  it('passes a model’s own refusal through in its own words', () => {
    const result = parsePlanReply(
      JSON.stringify({ resolved: false, say: 'Which of the six cards did you mean?' }),
      REQUEST,
    );
    expect(result.resolved).toBe(false);
    expect(result.reply).toBe('Which of the six cards did you mean?');
  });
});

describe('the OpenAI-compatible planner', () => {
  it('asks the configured endpoint and model, and never a hard-coded one', async () => {
    const http = vi.fn<HttpClient>(async () =>
      respond(openAiReply(JSON.stringify({ eid: H1.eid, kind: 'text', text: 'Ship faster' }))),
    );

    const result = await createOpenAiPlanner(SETTINGS, http).plan(REQUEST);

    expect(result.resolved).toBe(true);
    const [url, init] = http.mock.calls[0]!;
    expect(url).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(init.headers['authorization']).toBe('Bearer k');
    expect(JSON.parse(init.body).model).toBe('deepseek-chat');
  });

  it('sends no authorization at all to an endpoint that needs none', async () => {
    const http = vi.fn<HttpClient>(async () => respond(openAiReply('{}')));
    await createOpenAiPlanner({ baseUrl: 'http://localhost:11434/v1', model: 'q' }, http).plan(
      REQUEST,
    );
    expect(http.mock.calls[0]![1].headers['authorization']).toBeUndefined();
  });

  it('reports a refusal from the endpoint rather than pretending it planned nothing', async () => {
    const http: HttpClient = async () => respond('nope', false, 401);
    await expect(createOpenAiPlanner(SETTINGS, http).plan(REQUEST)).rejects.toThrow(/401/);
  });
});

describe('the Claude planner', () => {
  it('calls the Messages API with the model the bridge already names', async () => {
    const http = vi.fn<HttpClient>(async () =>
      respond(claudeReply(JSON.stringify({ eid: H1.eid, kind: 'text', text: 'Ship faster' }))),
    );

    const result = await createClaudePlanner({ apiKey: 'sk-ant-x' }, http).plan(REQUEST);

    expect(result.resolved).toBe(true);
    const [url, init] = http.mock.calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe('sk-ant-x');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(init.body);
    expect(body.model).toBe(CLAUDE_MODEL);
    expect(body.max_tokens).toBeGreaterThan(0);
    // No assistant prefill: current models reject one.
    expect(body.messages.every((message: { role: string }) => message.role === 'user')).toBe(true);
  });

  it('reads the first text block, and survives one that has none', async () => {
    const http: HttpClient = async () => respond(JSON.stringify({ content: [] }));
    const result = await createClaudePlanner({ apiKey: 'k' }, http).plan(REQUEST);
    expect(result.resolved).toBe(false);
  });
});
