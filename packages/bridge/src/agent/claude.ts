import path from 'node:path';
import { pathOf, refusalIn, systemPromptWith, WRITING_TOOLS } from './shared.js';
import {
  blocked,
  type AgentContext,
  type AgentOutcome,
  type AgentRunner,
  type ToolPermission,
} from './types.js';

/* ── the seam ─────────────────────────────────────────────────────────────── */

/**
 * The slice of the SDK's message stream this runner reads.
 *
 * Deliberately narrow. `SDKMessage` is a union of thirty-odd frame types, and a
 * test that had to construct one faithfully would be asserting the SDK's shape
 * rather than the runner's behaviour. Everything below is structurally
 * satisfied by the real messages — `_QuerySeamHolds` is the compiler proving it.
 */
export interface AgentStreamMessage {
  type: string;
  session_id?: string;
  subtype?: string;
  result?: string;
  is_error?: boolean;
  errors?: string[];
  /**
   * `unknown`, not `{ content }`: some frames of the union carry a bare string
   * here. Narrowed where it is read, so a shape that was never anticipated is a
   * frame this runner ignores rather than a crash mid-job.
   */
  message?: unknown;
}

/**
 * The slice of the SDK's `Options` this runner sets, mirrored locally (AC-10.2).
 *
 * Written out here rather than imported, because a type-only import is still a
 * static import: it is resolved by the compiler, and one of them in `src/` makes
 * the SDK mandatory for everybody — including the person whose project only ever
 * talks to a local model.
 *
 * A hand-written mirror normally rots. This one cannot, quietly: the seam
 * assertion in `test/agent-optional-sdk.test.ts` requires the SDK's real `query`
 * to remain assignable to {@link SdkQuery}, which requires this interface to
 * remain assignable to the SDK's `Options`. A field renamed or retyped upstream
 * fails the build — in the tree where the SDK is installed, which is the only
 * tree where the question can be asked.
 */
export interface ClaudeSdkOptions {
  abortController?: AbortController;
  allowedTools?: string[];
  /**
   * The third parameter is `unknown` on purpose: this runner never reads the
   * SDK's call metadata, and naming it would be a second thing to keep in step.
   */
  canUseTool?: (
    tool: string,
    input: Record<string, unknown>,
    meta: unknown,
  ) => Promise<ToolPermission>;
  cwd?: string;
  maxTurns?: number;
  model?: string;
  permissionMode?: 'default';
  resume?: string;
  settingSources?: ('user' | 'project' | 'local')[];
  systemPrompt?: string;
  tools?: string[];
}

/**
 * `query`, as this runner needs it. Injected so the unit suite can drive a
 * scripted stream and assert the options object without a request leaving the
 * process (AC-6.6). The real function is imported lazily, inside `run`.
 */
export type SdkQuery = (params: {
  prompt: string;
  options?: ClaudeSdkOptions;
}) => AsyncIterable<AgentStreamMessage>;

/* ── the shape of the capability ──────────────────────────────────────────── */

export const CLAUDE_MODEL = 'claude-opus-5';

/**
 * The entire tool surface (AC-6.2).
 *
 * `Glob` and `Grep` are absent on purpose. Every element the editor touches
 * arrives with a `file:line:col` the build stamped into the source, so the
 * search step — where agent edits usually go wrong — does not exist here. An
 * agent that can search is an agent that can decide the coordinate was wrong
 * and go looking for a better one, and adding either tool back is a change to
 * the premise of this project rather than a convenience.
 */
export const CLAUDE_TOOLS = ['Read', 'Edit'] as const;

/** Read the file, write one line, say so. Anything longer is the agent lost. */
export const CLAUDE_MAX_TURNS = 12;

/**
 * A credential the SDK can actually authenticate with. Checked here so that
 * `SVE_AGENT=claude` on a machine with no key fails by naming what is missing,
 * rather than with a stack trace out of the SDK's own transport (AC-6.1).
 */
export const CLAUDE_CREDENTIAL_ENV = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
] as const;

/**
 * {@link SYSTEM_PROMPT} with the one paragraph that is this runner's alone.
 *
 * The shared contract deliberately names no tool, because the tools differ per
 * provider. `Read` and `Edit` are what this runner grants, and they are named
 * here rather than in the shared text so a second runner naming its own tools
 * does not have to disagree with a sentence it inherited.
 */
const CLAUDE_SYSTEM_PROMPT = systemPromptWith(
  'The tools you have are `Read` and `Edit`, and nothing else. Read the named file, ' +
    'apply the one described change with `Edit`, and stop.',
);

/* ── reading the stream ───────────────────────────────────────────────────── */

interface ToolUse {
  name: string;
  input: Record<string, unknown>;
}

interface Spoken {
  texts: string[];
  toolUses: ToolUse[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Text and tool calls out of one assistant frame, whatever shape its content took. */
function read(message: AgentStreamMessage): Spoken {
  const spoken: Spoken = { texts: [], toolUses: [] };
  const content = isRecord(message.message) ? message.message['content'] : message.message;

  if (typeof content === 'string') {
    spoken.texts.push(content);
    return spoken;
  }
  if (!Array.isArray(content)) return spoken;

  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block['type'] === 'text' && typeof block['text'] === 'string') {
      spoken.texts.push(block['text']);
    } else if (block['type'] === 'tool_use' && typeof block['name'] === 'string') {
      spoken.toolUses.push({
        name: block['name'],
        input: isRecord(block['input']) ? block['input'] : {},
      });
    }
  }
  return spoken;
}

/* ── the runner ───────────────────────────────────────────────────────────── */

export interface ClaudeAgentOptions {
  /** Injected by the unit suite; the real `query` is imported lazily otherwise. */
  query?: SdkQuery;
  model?: string;
  maxTurns?: number;
}

/**
 * Held as a variable so the compiler cannot follow it (AC-10.2).
 *
 * A literal specifier — even inside `await import(...)` — is resolved at compile
 * time, so a missing optional peer would be a type error for every install
 * rather than a runtime error on the one path that actually needs the package.
 */
const SDK_MODULE = '@anthropic-ai/claude-agent-sdk';

/**
 * Loaded lazily, on the first `SVE_AGENT=claude` job and never before.
 *
 * The failure is named here rather than left as a bare resolution error, for
 * the same reason a missing credential is: someone reaching this line asked for
 * this provider, and the answer they need is which package to install.
 */
async function loadQuery(): Promise<SdkQuery> {
  try {
    // `@vite-ignore`: the specifier is a variable precisely so it is not
    // analysed, and the dev server should not warn about the one thing that
    // makes the peer optional.
    const sdk = (await import(/* @vite-ignore */ SDK_MODULE)) as { query: SdkQuery };
    return sdk.query;
  } catch (cause) {
    throw new Error(
      `SVE_AGENT=claude needs ${SDK_MODULE}, which is an optional peer dependency ` +
        `and is not installed. Run \`npm install ${SDK_MODULE}\`, or select a ` +
        'provider that does not need it.',
      { cause },
    );
  }
}

/**
 * The live runner (AC-6): the Claude Agent SDK behind the seam M4 left.
 *
 * It hands over the prompt the bridge already built and the narrowest capability
 * that can carry it out, then maps what comes back onto an `AgentOutcome`. It
 * decides nothing else — not the job's status, not what landed. Whether the edit
 * was *right* is settled after hot reload by comparing the rendered DOM to the
 * recorded intent, and this runner is not consulted about it.
 */
export function createClaudeAgent(options: ClaudeAgentOptions = {}): AgentRunner {
  const model = options.model ?? CLAUDE_MODEL;
  const maxTurns = options.maxTurns ?? CLAUDE_MAX_TURNS;
  let query = options.query;

  return {
    name: 'claude',
    requiresNetwork: true,

    async run(ctx: AgentContext): Promise<AgentOutcome> {
      query ??= await loadQuery();

      // Read before and after: whether the file changed is a fact about the
      // file, not a claim in the transcript. An agent that says DONE and wrote
      // nothing must reach the bridge as `noop`, which it turns into `stalled`.
      const before = await ctx.fs.readFile(ctx.file);

      // The SDK wants a controller; the bridge hands out a signal. Closing the
      // bridge mid-run has to reach the subprocess, not be noticed afterwards.
      const controller = new AbortController();
      const relay = (): void => controller.abort();
      if (ctx.signal.aborted) controller.abort();
      else ctx.signal.addEventListener('abort', relay, { once: true });

      let sessionId: string | undefined;
      let denial: string | undefined;
      let failure: string | undefined;
      const replies: string[] = [];
      const written = new Set<string>();

      const sdkOptions: ClaudeSdkOptions = {
        model,
        // Both, and for different reasons: `tools` is what decides which tools
        // exist at all, `allowedTools` is what decides which run without a
        // prompt. Either one alone leaves the surface wider than AC-6.2 allows.
        tools: [...CLAUDE_TOOLS],
        allowedTools: [...CLAUDE_TOOLS],
        permissionMode: 'default',
        // No `~/.claude/settings.json`, no project settings, no CLAUDE.md: a
        // permission rule sitting on a developer's machine must not be able to
        // widen what this runner may do.
        settingSources: [],
        systemPrompt: CLAUDE_SYSTEM_PROMPT,
        cwd: ctx.root,
        maxTurns,
        abortController: controller,
        ...(ctx.retry?.sessionId ? { resume: ctx.retry.sessionId } : {}),

        async canUseTool(tool, input): Promise<ToolPermission> {
          const decision = await ctx.canUseTool({
            tool,
            ...(pathOf(input) !== undefined ? { path: pathOf(input)! } : {}),
            input,
          });
          // Remembered, because a denial is the reason the job ends up blocked:
          // the SDK tells the agent no and carries on, so by the time the stream
          // ends this is the only record of why nothing was written.
          if (decision.behavior === 'deny') denial = decision.message;
          return decision;
        },
      };

      ctx.report({
        phase: 'agent',
        detail: ctx.retry ? `claude — resuming ${ctx.retry.sessionId ?? 'previous session'}` : 'claude',
      });

      try {
        for await (const message of query({ prompt: ctx.prompt, options: sdkOptions })) {
          if (typeof message.session_id === 'string') sessionId = message.session_id;

          if (message.type === 'assistant') {
            const spoken = read(message);
            replies.push(...spoken.texts);
            for (const use of spoken.toolUses) {
              if (!WRITING_TOOLS.has(use.name)) continue;
              const target = pathOf(use.input);
              if (target !== undefined) {
                written.add(path.isAbsolute(target) ? target : path.resolve(ctx.root, target));
              }
              ctx.report({ phase: 'writing', tool: use.name, detail: ctx.intent.loc });
            }
            continue;
          }

          if (message.type === 'result') {
            if (typeof message.result === 'string') replies.push(message.result);
            if (message.subtype !== undefined && message.subtype !== 'success') {
              const detail = message.errors?.join('; ');
              failure = detail ? `${message.subtype}: ${detail}` : message.subtype;
            }
          }
        }
      } finally {
        ctx.signal.removeEventListener('abort', relay);
      }

      const after = await ctx.fs.readFile(ctx.file);
      const changed = Buffer.compare(before, after) !== 0;

      if (changed) {
        // Reported even when the agent then said BLOCKED. The file on disk
        // disagrees with that reply, and telling the user nothing was written
        // while something was is the one answer that is certainly wrong.
        // Whether it was the *right* change is the verifier's question.
        const files = written.size > 0 ? [...written] : [ctx.file];
        return {
          kind: 'edited',
          files,
          ...(replies.length > 0 ? { message: replies[replies.length - 1] } : {}),
          ...(sessionId ? { sessionId } : {}),
        };
      }

      if (denial !== undefined) return blocked(denial, sessionId);

      const refusal = refusalIn(replies);
      if (refusal !== null) return blocked(refusal, sessionId);

      if (failure !== undefined) {
        return blocked(`the agent stopped before writing anything (${failure})`, sessionId);
      }

      return {
        kind: 'noop',
        message: replies[replies.length - 1] ?? 'the agent finished without writing anything',
        ...(sessionId ? { sessionId } : {}),
      };
    },
  };
}

/* ── selection ────────────────────────────────────────────────────────────── */

export interface ClaudeCredentials {
  readonly ok: boolean;
  readonly missing: string;
}

export function claudeCredentials(env: Readonly<Record<string, string | undefined>>): ClaudeCredentials {
  const ok = CLAUDE_CREDENTIAL_ENV.some((name) => (env[name] ?? '').trim().length > 0);
  return { ok, missing: CLAUDE_CREDENTIAL_ENV.join(' or ') };
}

/**
 * The message a developer gets for `SVE_AGENT=claude` with nothing to
 * authenticate with (AC-6.1). It names the credential, because "401" out of the
 * SDK's transport names nothing a person can act on.
 */
export function missingCredentialMessage(): string {
  return (
    'SVE_AGENT=claude needs a credential, and none is set. Export ' +
    `${CLAUDE_CREDENTIAL_ENV[0]} (or ${CLAUDE_CREDENTIAL_ENV.slice(1).join(', ')}), ` +
    'or run with SVE_AGENT=fake, which needs none.'
  );
}
