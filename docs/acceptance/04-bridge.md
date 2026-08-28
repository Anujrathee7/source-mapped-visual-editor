# AC-3 — `@sve/bridge` (queue, snapshots, path guard, fake agent)

The Node side. It holds file-write capability, so its contract is as much about what it
refuses as what it does.

This milestone covers everything except the real Agent SDK call, which is M7. Here the
agent is an injected interface (`AgentRunner`) with a deterministic fake behind it.

These criteria are fixed. If an implementation fails one, the implementation changes.

## AC-3.1 — The queue is strictly serial

Jobs run one at a time in submission order, even when submitted concurrently. Proven with
an agent stub that records `start A, end A, start B, end B` — never interleaved.

This is not a performance preference. `data-sve-loc` line numbers are invalidated by every
write, so a second job reading a file while the first is mid-write would target a stale
line. Each job re-reads its target file at the moment it runs, never from a copy taken at
enqueue time.

A job that throws must not wedge the queue: the next job still runs, and the failed job
resolves as `status: 'error'` carrying a message.

## AC-3.2 — Snapshots restore byte-for-byte

Before a job touches a file, the file is copied to `.sve/undo/<jobId>/`. `revert(jobId)`
restores every file in that snapshot with its original bytes.

Verified against a file containing CRLF line endings, a trailing newline, and a non-ASCII
character — none of which may be normalised. Reading and writing must be byte-oriented,
not line-oriented.

Reverting an unknown `jobId` resolves as an error result, never a throw.

## AC-3.3 — The path guard denies everything outside `editRoots`

`isInsideEditRoots` is the security boundary and is unit-tested directly. It denies:

- an absolute path outside every configured root;
- `../` traversal that escapes a root;
- a symlink whose real path lands outside a root (resolve before comparing);
- a path that only appears inside a root because of case-insensitive comparison.

It allows a path inside a root, and a root itself.

Denial is a **deny decision handed back to the agent**, not a thrown exception: the agent
is told no, and the job resolves as `blocked`.

## AC-3.4 — Untrusted input is parsed at the boundary

`POST /__sve/apply` parses its body with `ApplyRequestSchema` before anything else. A
malformed body yields HTTP 400 with a machine-readable error and **no filesystem access of
any kind** — assert this with a spy on the fs layer, not just on the response code.

An empty intent list is a 400, not an empty success.

## AC-3.5 — The fake agent is scriptable, including to fail

`SVE_AGENT=fake` selects a deterministic in-process editor supporting at least four modes:

- `correct` — applies the intent exactly as asked;
- `wrong` — writes a plausible but different value, e.g. different capitalisation. This is
  how the verifier is later proven to actually verify rather than always report green;
- `blocked` — writes nothing, returns `BLOCKED: <reason>`;
- `noop` — reports success without writing, so the `stalled` path can be exercised.

It requires no API key and no network. This is the CI path, and it is selected by
environment variable so no test has to reach into module internals to swap it.

## AC-3.6 — Progress is streamed

`GET /__sve/events` is an SSE stream emitting `ProgressEvent`s through the phases
`queued -> snapshot -> agent -> writing -> done`, each carrying its `jobId`.

A client that connects mid-job receives the subsequent events for that job. Closing the
connection does not kill the job.

## AC-3.7 — The prompt tells, and does not ask

`buildPrompt` output, asserted against a fixture intent:

- names the file and the exact `line:col`;
- includes a **numbered** source excerpt of the surrounding lines, read fresh from disk at
  job time;
- states the change in terms of the resolved intent;
- forbids reformatting and forbids edits to any other line;
- instructs the agent to reply `BLOCKED: <reason>` and write nothing if the target is not
  what was described.

It contains no instruction to search, locate, or find. That is the premise of the project:
the agent is told the line, so the search step — where agent edits usually go wrong — does
not exist.
