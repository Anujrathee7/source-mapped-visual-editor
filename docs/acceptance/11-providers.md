# AC-10 — provider-neutral agents

v1 shipped one runner. v2 ships several, and the cheap ones are the point: **the verifier is
what makes a weak model usable.** A model that miswrites an edit is normally unusable because
you cannot tell a good edit from a bad one without reading every diff — but drift is caught,
shown, and retried, so a cheap model becomes a reasonable trade rather than a gamble.

This milestone lifts the provider-neutral logic out of `agent/claude.ts` and adds a runner
for any OpenAI-compatible chat-completions endpoint: DeepSeek, Ollama, OpenRouter, LM Studio,
Groq.

These criteria are fixed. If an implementation fails one, the implementation changes.

## AC-10.1 — The shared logic leaves `claude.ts`, and nothing changes behaviourally

`SYSTEM_PROMPT`, the `BLOCKED:` reply parser, `pathOf` and `WRITING_TOOLS` move to a
provider-neutral module. None of them mention Anthropic today; a second provider would
otherwise copy them, and two copies of a refusal parser is two definitions of "refused".

The existing Claude runner imports them and its tests pass **unchanged** — this is a move,
not a rewrite.

## AC-10.2 — The Claude SDK is optional

`@anthropic-ai/claude-agent-sdk` becomes a `peerDependency` marked optional. The bridge
typechecks, unit-tests and runs with it **absent**, which someone using only DeepSeek or
Ollama will have.

Asserted rather than assumed: the compile-time seam assertion in `claude.ts` must not force
the SDK into every install.

## AC-10.3 — The OpenAI-compatible runner

Registered as `openai`. Configured by **base URL, API key and model name** — those three make
it DeepSeek, Ollama, OpenRouter or anything else speaking that API, so there is one runner
rather than one per vendor.

It drives a tool loop with two tools of its own design (`read_file`, `apply_edit`) against
`ctx.prompt`, which is already provider-neutral: it names the file, the exact `line:col`, a
caret-annotated excerpt read fresh at job time, and the reply contract.

## AC-10.4 — It asks first, and is bound regardless

Before every write it calls `ctx.canUseTool`, and honours a denial by reporting `blocked`
rather than trying elsewhere.

Independently, a test drives it against a path outside `editRoots` and asserts the guarded
`fs` from AC-7 refuses it even if the courtesy call were removed. **Asking is the polite
path; the guard is the binding one**, and a provider runner must not be the only thing
standing between a model and the filesystem.

## AC-10.5 — Stateless retry works

The runner returns no `sessionId`, and a retry after `drifted` still succeeds: the retry
prompt re-reads the file at job time and states that the excerpt is the file as the previous
attempt left it.

Asserted, because "sessions are optional" is a claim the bridge makes that only a
session-less provider can actually test.

## AC-10.6 — Malformed model output is a `blocked`, not a crash

Small and cheap models emit malformed tool calls, invent tool names, wrap JSON in prose, and
run on past their turn. Each of these resolves as `blocked` or `noop` with a message — never
an unhandled rejection, never a partial write.

There is a bounded number of tool-loop turns, and exhausting it is a reported outcome rather
than a hang.

## AC-10.7 — The unit suite makes no network call

The HTTP client is injected, so every criterion above is asserted against scripted responses.
`npm test` needs no key, no local model, and no network.

A test that would reach a real endpoint is a bug in the test.

## AC-10.8 — Provider choice is per-session, not process-global

`SVE_AGENT` is a process-wide environment variable, which cannot express "this project uses
DeepSeek and that one uses Claude". v2 passes a constructed runner through `BridgeOptions.agent`.

The registry stays for the CLI's convenience; the host does not use it.

## AC-10.9 — A missing credential is named

Selecting a provider with no key fails immediately with a message naming the missing
setting — not a 401 surfacing from inside an HTTP client three layers down.

Ollama and other local endpoints need no key, and must not be made to invent one.

## AC-10.10 — The live suite is opt-in

A suite exercising a real endpoint is skipped by default and never runs in CI. It asserts
outcomes — the status reached, the file changed at the expected element — never diff text or
model phrasing.
