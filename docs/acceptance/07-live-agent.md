# AC-6 — the live agent (`SVE_AGENT=claude`)

The real Claude Agent SDK behind the `AgentRunner` seam M4 left. Everything the editor
does is unchanged; only the thing that writes the file is swapped.

The premise being honoured here is the second principle in `CLAUDE.md`: **the agent is told
where to edit, so the search step — where agent edits usually go wrong — does not exist.**
Most of these criteria exist to keep that true under pressure.

These criteria are fixed. If an implementation fails one, the implementation changes.

## AC-6.1 — It registers, and it is not the default

- `registerAgentRunner('claude', …)` wires the runner; `SVE_AGENT=claude` selects it.
- The default with no environment variable set remains the fake. Nothing implicitly
  reaches the network, and no test run costs tokens unless it asked to.
- Selecting `claude` without credentials fails with a message naming the missing
  credential, not with a stack trace from inside the SDK.

## AC-6.2 — The tool surface is exactly `Read` and `Edit`

Asserted on the options object handed to `query`, without calling the API:

- `allowedTools` is exactly `['Read', 'Edit']`.
- `Glob`, `Grep`, `Bash`, `Write`, `WebFetch` and `WebSearch` are absent. **`Glob` and
  `Grep` are absent on purpose**: an agent that can search is an agent that can decide the
  coordinate was wrong and go looking, which is the failure mode this project exists to
  remove. A future change that adds them is a change to the premise, not a convenience.
- `model` is `claude-opus-5`.
- `cwd` is the project root, and `maxTurns` is bounded.

## AC-6.3 — `canUseTool` is the enforced boundary, not advice

- Every `Read` or `Edit` whose `file_path` resolves outside `editRoots` is denied, reusing
  `isInsideEditRoots` from M4 — there is one guard in this codebase, not two.
- Denial returns a deny decision the SDK can act on; it never throws past the SDK.
- A denied path resolves the job as `blocked`, with the denial reason in the message.
- Unit-tested by invoking the `canUseTool` callback directly. No network.

## AC-6.4 — `BLOCKED` is parsed, not guessed

When the agent replies `BLOCKED: <reason>`, the outcome is `{ kind: 'blocked', reason }`
with the reason preserved. A refusal is a first-class result: the file is left untouched
and the user is told why, rather than the runner improvising an edit or reporting success.

## AC-6.5 — Retry resumes the same session

A retry after `drifted` passes the prior `sessionId` as `resume` and includes the recorded
mismatch — intent versus rendered — in the follow-up prompt. The agent is told what its
own previous edit produced instead of being asked the same question twice with no memory
of having answered it.

## AC-6.6 — The unit suite never touches the network

The SDK's `query` is injected, so every criterion above is asserted against the options
object and a scripted message stream. `npm test` requires no API key, makes no request,
and costs nothing. A test that would call the API is a bug in the test.

## AC-6.7 — The live suite is opt-in and asserts outcomes

`e2e/live.spec.ts`, skipped unless `SVE_AGENT=claude`, covering AC-5.1, AC-5.3 and AC-5.6
against the real SDK.

It asserts **outcomes** — the status reached, the file changed at the expected element,
the file untouched on a refusal. It never asserts exact diff text or agent phrasing, which
are not deterministic and would make the suite flaky by construction.

It never runs in CI.
