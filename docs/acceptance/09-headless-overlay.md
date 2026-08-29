# AC-8 — the headless overlay

v1's overlay assumes it lives in the same document as the page it edits. v2 puts the page in
an **iframe on a different origin**, where the parent cannot touch `contentDocument` at all.

So the split is forced, and it falls in a specific place: the **mechanism** — selection,
overrides, the re-asserter, snapshots, and the wait for hot reload — stays inside the iframe,
because `import.meta.hot` there is the user's dev-server socket and the two-rAF settle is the
iframe's compositor. The **chrome** moves out.

This milestone makes the overlay drivable from outside without moving it. v1's in-page mode
must keep working unchanged throughout — it is the regression test for the mechanism.

These criteria are fixed. If an implementation fails one, the implementation changes.

## AC-8.1 — An injected document is honoured everywhere

`mountOverlay({ document })` already threads `doc` through its collaborators, but four calls
still reach for the ambient realm. Each must use the injected document's realm instead:

| file | today | why it matters |
|---|---|---|
| `overlay/src/snapshot.ts` | bare `getComputedStyle(el)` | **The verification thesis reads through this call.** It is the one that cannot be subtly wrong. |
| `overlay/src/reassert.ts` | `new MutationObserver(...)` from the ambient realm, then `observe()` on the injected doc | mixed realms |
| `overlay/src/compare.ts` | `document.createElement('canvas')` | an ambient reach inside otherwise pure comparison code |
| `overlay/src/mount.ts` | `fetch` for source | already overridable; make the default follow the injected realm too |

Asserted by mounting against a **second document** and confirming the overlay never touches
the ambient one: a spy on the ambient `getComputedStyle` and `MutationObserver` records zero
calls.

## AC-8.2 — `resolveAnchor` becomes `currentLoc`

`OverlayHandle.resolveAnchor(eid, eidIndex): HTMLElement | null` returns a DOM node, which
cannot cross a `postMessage` boundary. Its only two consumers want less than a node: one
reads `data-sve-loc` off it, the other null-checks it.

Replace it with `currentLoc(eid, eidIndex): string | null`.

This is the change that makes `runVerification` realm-free — after it, the loop imports no
DOM constant and touches no node.

## AC-8.3 — `select` takes an anchor, not an element

`select(el: Element | null)` becomes `select(anchor: { eid, eidIndex } | null)`.

Clicks are already handled by a listener inside the iframe, so this exists for *programmatic*
selection — the parent asking for an element it knows only by id.

## AC-8.4 — The live store leaves the handle

`OverlayHandle.store` exposes a live `OverrideStore` object, and the session reads
`handle.store.get(intent.eid)` directly. Replace with `getOverride(eid): Override | undefined`.

`overrideStyleSheet` and `reasserter` are on the handle only for v1's tests. They may stay for
in-page mode, but they are **not** part of the remote surface.

## AC-8.5 — Nothing that crosses the seam is un-serialisable

Every value returned by or passed to the remote surface survives a
`JSON.parse(JSON.stringify(x))` round-trip unchanged. Asserted mechanically over the whole
surface, not argued in a comment.

`Snapshot`, `EditIntent` and `Override` are already plain data — `Override` in particular is
relied on for `JSON.stringify` equality by the existing loop, so this is a property to
preserve rather than to invent.

## AC-8.6 — Highlights stay inside the iframe

Selection highlights position via `getBoundingClientRect()` in the iframe's viewport
coordinates. They remain in the iframe's shadow root, so no scroll or offset compensation is
ever needed.

Asserted: after mounting against an injected document, the highlight element's owner document
is that document, never the ambient one.

## AC-8.7 — v1's in-page mode is unchanged

The 572 unit tests and 15 E2E tests pass untouched. `mountOverlay()` with no `document`
behaves exactly as before, and `apps/demo` still works through `npm run dev`.

Any signature change above is accompanied by its call sites being updated, not by a
compatibility shim that keeps two ways of doing the same thing alive.
