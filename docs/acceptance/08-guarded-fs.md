# AC-7 — the guarded filesystem

`AgentContext` promises, in `packages/bridge/src/agent/types.ts`, that *"the security
boundary [is] out of the runner's hands — a runner cannot widen its own reach."*

Today that is aspirational rather than true. `packages/bridge/src/bridge.ts` hands the
runner `fs` — the raw `nodeFs` — and wires `canUseTool` to `permitPath`, but **nothing calls
`canUseTool` on the runner's behalf**. A runner that skips asking and calls
`ctx.fs.writeFile` directly is stopped by nothing at all.

That was tolerable in v1, which shipped exactly one first-party runner. v2 ships several,
and a provider runner is closer to a plugin than to library code — so the comment has to
become an enforced fact before the second one exists.

These criteria are fixed. If an implementation fails one, the implementation changes.

## AC-7.1 — Every path a runner touches is checked, whether or not it asks

`AgentContext.fs` is a **guarded** `BridgeFs` that runs `isInsideEditRoots` on every path
before delegating. This holds for `readFile`, `writeFile`, `mkdir`, `readdir`, `stat`,
`lstat` and `realpath` — every member of the interface, not only the writing ones.

Asserted with a runner that never calls `canUseTool` and writes straight to
`ctx.fs.writeFile`: the write is refused and the file on disk is unchanged.

`BridgeFs` already exists as a single injectable interface precisely so this interposition
is possible; the guard belongs in the wrapper, not duplicated at each call site.

## AC-7.2 — A refusal is an error the runner can catch, not a silent no-op

A denied call rejects with an error naming the path and the reason. It must never resolve as
though it had succeeded — a runner that believes it wrote a file it did not write reports
`edited`, and the bridge would then report a stall it cannot explain.

The rejection is distinguishable from an ordinary filesystem error (a missing file, a
permissions problem) by its type, so a runner can tell "I am not allowed there" from "that
path does not exist".

## AC-7.3 — Denials are recorded and surface as `blocked`

A job whose runner was denied a path resolves as `blocked`, with a message naming the
refused path. The user is told the edit did not happen and why, rather than being shown a
bare `stalled`.

This holds whether the runner asked `canUseTool` first and respected the answer, or ignored
it and was refused by the guard.

## AC-7.4 — The guard is the one from M4, not a second copy

The wrapper calls `isInsideEditRoots` from `packages/bridge/src/guard.ts`. There is one
guard in this codebase.

Its existing behaviour is unchanged and its tests still pass: `../` traversal, symlinks
resolved before comparison, case-sensitive comparison on a case-insensitive filesystem, and
the drive-letter fold.

## AC-7.5 — The bridge's own filesystem access is not guarded by this wrapper

Snapshots write into `.sve/undo/<jobId>/`, which is deliberately **outside** `editRoots`.
The bridge keeps its own unguarded handle for that; only the handle handed to a *runner* is
wrapped.

Asserted directly, because getting this wrong makes every snapshot fail and the failure
would look like a broken undo rather than an over-tight guard.

## AC-7.6 — The cost is bounded

The wrapper resolves each path once per call. A job that reads one file and writes it back
performs no more `realpath` calls than the unguarded path did, plus one per guarded
operation — verified by a spy, so a future refactor cannot quietly turn the guard into a
per-call directory walk.
