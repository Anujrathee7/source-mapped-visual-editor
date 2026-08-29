/**
 * The planner for anything speaking OpenAI's chat-completions API.
 *
 * One request, no tool loop: the answer is a JSON object, and a model that produces a bad
 * one produces no proposal — which is a state the chat panel already renders. There is
 * nothing to retry against and nothing that could reach a file.
 *
 * `HttpClient` is `@sve/bridge`'s, injected for the same reason AC-10.7 injects it there:
 * the unit suite asserts every one of these paths against scripted responses, and a test
 * that reached a real endpoint would be a bug in the test.
 */
import { OPENAI_CHAT_PATH, isLocalEndpoint, type HttpClient } from '@sve/bridge';
import { PLAN_SYSTEM_PROMPT, parsePlanReply, planPrompt } from './plan-prompt.js';
import type { PlanRequest, PlanResult, Planner } from '../plan.js';
import type { ProviderSettings } from '../providers.js';

/** Enough for one JSON object naming one element. A longer reply is a wrong reply. */
export const PLAN_MAX_TOKENS = 1024;

function endpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${OPENAI_CHAT_PATH}`;
}

export function createOpenAiPlanner(settings: ProviderSettings, http: HttpClient): Planner {
  const baseUrl = settings.baseUrl ?? '';
  const model = settings.model ?? '';

  return {
    name: 'openai',

    async plan(request: PlanRequest): Promise<PlanResult> {
      const key = settings.apiKey?.trim();
      const response = await http(endpoint(baseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // A local endpoint has nothing to authenticate against and must not be made to
          // invent a key (AC-10.9), so the header is absent rather than empty.
          ...(key !== undefined && key !== '' && !isLocalEndpoint(baseUrl)
            ? { authorization: `Bearer ${key}` }
            : {}),
        },
        body: JSON.stringify({
          model,
          max_tokens: PLAN_MAX_TOKENS,
          // Planning is not a creative task: the same request should resolve the same way.
          temperature: 0,
          messages: [
            { role: 'system', content: PLAN_SYSTEM_PROMPT },
            { role: 'user', content: planPrompt(request) },
          ],
        }),
      });

      const body = await response.text();
      if (!response.ok) {
        throw new Error(`${endpoint(baseUrl)} answered ${response.status}: ${body.slice(0, 200)}`);
      }

      let content = '';
      try {
        const parsed = JSON.parse(body) as {
          choices?: Array<{ message?: { content?: unknown } }>;
        };
        const first = parsed.choices?.[0]?.message?.content;
        if (typeof first === 'string') content = first;
      } catch {
        content = '';
      }

      return parsePlanReply(content, request);
    },
  };
}
