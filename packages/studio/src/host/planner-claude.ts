/**
 * The planner for Claude, over the Messages API.
 *
 * Deliberately not the Agent SDK. The SDK is the *writer's* seam — it spawns a subprocess
 * with file tools and a permission callback, which is exactly what a planner must not have:
 * planning produces an override, and an override is an illusion. One HTTP request with no
 * tools is the whole capability this needs, and keeping it that narrow is the reason the
 * chat panel cannot reach a file even in principle.
 *
 * The model is `@sve/bridge`'s `CLAUDE_MODEL`, not a second opinion about which model this
 * project uses. No assistant prefill: current models reject one.
 */
import { CLAUDE_MODEL, type HttpClient } from '@sve/bridge';
import { PLAN_SYSTEM_PROMPT, parsePlanReply, planPrompt } from './plan-prompt.js';
import type { PlanRequest, PlanResult, Planner } from '../plan.js';
import type { ProviderSettings } from '../providers.js';

export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';
export const PLAN_MAX_TOKENS = 1024;

export function createClaudePlanner(settings: ProviderSettings, http: HttpClient): Planner {
  return {
    name: 'claude',

    async plan(request: PlanRequest): Promise<PlanResult> {
      const key = settings.apiKey?.trim() ?? process.env['ANTHROPIC_API_KEY'] ?? '';
      const response = await http(ANTHROPIC_MESSAGES_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: PLAN_MAX_TOKENS,
          system: PLAN_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: planPrompt(request) }],
        }),
      });

      const body = await response.text();
      if (!response.ok) {
        throw new Error(`${ANTHROPIC_MESSAGES_URL} answered ${response.status}: ${body.slice(0, 200)}`);
      }

      let content = '';
      try {
        const parsed = JSON.parse(body) as { content?: Array<{ type?: string; text?: unknown }> };
        // The first text block. A response carrying only thinking blocks, or none at all,
        // leaves this empty and resolves to nothing — which is a state, not a crash.
        const text = parsed.content?.find((block) => block.type === 'text')?.text;
        if (typeof text === 'string') content = text;
      } catch {
        content = '';
      }

      return parsePlanReply(content, request);
    },
  };
}
