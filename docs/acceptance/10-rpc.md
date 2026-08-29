# AC-9 — `@sve/rpc`

The wire between the studio (parent window) and the overlay (inside the iframe).

`@sve/protocol` treats the browser as untrusted input to a process holding file-write
capability. This is the same discipline one level down: **the parent is untrusted input to
the iframe, and the iframe is untrusted input to the parent.** They are different origins,
any page can post to a window it has a handle on, and the overlay's methods reach a
filesystem two hops away.

These criteria are fixed. If an implementation fails one, the implementation changes.

## AC-9.1 — Every message is schema-parsed at the receiving end

Zod schemas in both directions, parsed before dispatch. A message that fails to parse is
ignored and reported on a diagnostics channel — never dispatched partially, never thrown past
the message handler where it would land as an unhandled rejection.

The request set mirrors the remote surface from AC-8: `currentLoc`, `select`, `getOverride`,
`readSnapshot`, `liftOverride`, `restoreOverride`, `captureIntent`, `refresh`, and a
`watchForUpdate` that resolves `{ settled: boolean }`. `InspectorState` travels
parent-ward.

## AC-9.2 — Origins are checked, and never `*`

- Every `postMessage` names an explicit target origin. `'*'` appears nowhere.
- Every inbound message is rejected unless `event.origin` matches the expected peer and
  `event.source` is the expected window.
- The expected origin is configuration, not inferred from the first message that arrives —
  otherwise the first attacker to post wins the handshake.

Asserted directly: a message from an unexpected origin is ignored, and a `postMessage` with a
`'*'` target fails the test suite.

## AC-9.3 — Requests correlate, time out, and cannot leak

- Each request carries an id; responses are matched to it. Two in flight at once resolve to
  their own results, asserted with deliberately out-of-order replies.
- A request with no reply rejects after a timeout rather than hanging forever. **The
  verification loop already depends on `stalled` being reachable** — an RPC that hangs would
  turn a caught failure into a frozen UI.
- A settled request's handler is removed. A late or duplicate reply for an id already settled
  is ignored, and the pending-request map returns to empty — asserted, so a long session
  cannot accumulate handlers.

## AC-9.4 — Disconnection is a state, not a crash

If the iframe navigates, reloads, or is removed, in-flight requests reject with a
distinguishable disconnection error and new requests fail fast. The studio can then say the
preview is gone; it must not hang or throw uncaught.

A full page reload inside the iframe re-runs the overlay's boot, so the transport must
survive re-handshaking without duplicate listeners.

## AC-9.5 — The transport is injectable, so this is testable without a browser

The client and server take a minimal transport interface (`post`, `subscribe`), with the real
`window.postMessage` implementation supplied at the edge.

Every criterion above is asserted in Node against a pair of in-memory transports, including
the origin checks — a security property tested only through a real browser is a security
property tested rarely.

## AC-9.6 — Versioned, and mismatch is loud

Each message carries a protocol version. A peer speaking a different version is refused with
a clear diagnostic rather than being parsed on a best-effort basis.

The studio and the overlay are separately deployable — a user can have a stale iframe from a
previous session — and a silently half-compatible wire would produce failures that look like
verification bugs.
