# AC-15 — booting the preview

The studio has a foot inside the frame — `@sve/studio/preview` — and `@sve/rpc` to talk over.
Nothing calls it. `@sve/vite`'s client entry mounts the overlay and keeps the handle in
module scope, so `RemoteOverlay` is unreachable from a parent window and the preview is a
picture rather than something the studio drives.

This closes that gap. It is the last thing standing between v2 and a working product.

These criteria are fixed. If an implementation fails one, the implementation changes.

## AC-15.1 — Framed, it serves; unframed, it does not

When the page is in a frame **and** a studio origin is configured, the client entry starts a
preview RPC server over `postMessage` to the parent, exposing the overlay handle.

When it is not framed, or no origin is configured, nothing changes: v1's in-page editor
behaves exactly as it does today. `window.parent !== window` alone is not the trigger — a
project that happens to be iframed by something else must not start answering it.

## AC-15.2 — One inspector, not two

Framed, the in-page chrome does not render. The studio draws the diagnostic; a panel inside
the iframe would duplicate it and cover the design it is meant to be showing.

The mechanism stays regardless — selection, overrides, the re-asserter and the hot-reload
wait are all still inside the frame. Only the chrome is suppressed, and the suppression is an
explicit option on `mountOverlay`, not a CSS rule hiding a panel that still exists.

## AC-15.3 — The studio origin is configuration

`sve({ studioOrigin })`, threaded to the boot options. Never inferred from
`document.referrer`, `window.location.ancestorOrigins`, or the first message to arrive —
inference here means the first page to frame the project gets to drive its filesystem.

A wildcard is refused, as it is in `@sve/rpc`.

## AC-15.4 — Nothing that worked stops working

The 1014 unit tests and 15 E2E tests pass. `apps/demo` under `npm run dev` is unchanged: no
frame, no studio origin, the in-page editor exactly as before.

## AC-15.5 — The dev server may serve the studio's preview module

`@sve/studio` joins `CLIENT_PACKAGES`, so `resolveId`, `server.fs.allow` and
`optimizeDeps.exclude` cover it the same way they cover `@sve/overlay` — including for a
project outside this workspace, which is what AC-11.3 was about.

`@sve/bridge` remains excluded. It holds write capability and the page has no business
reaching it.

## AC-15.6 — Proven in a browser, not only in Node

A Playwright test loads the studio, connects a fixture project, and drives the real thing
through a real iframe:

- clicking an element in the preview updates the studio's diagnostic, with the correct
  `file:line:col`;
- the source excerpt renders with the caret under the exact column;
- editing text applies an override **visible inside the frame**;
- Apply reaches a verdict.

The Node tests prove the wire; only this proves the wire is connected.
