# AC-11 — `@sve/host`

v1 required you to edit `vite.config.ts`. v2 opens a project instead: point it at a folder or
a GitHub URL and it starts the dev server itself, with the editor already in it.

The user's repository is not ours to modify. Everything here follows from that.

These criteria are fixed. If an implementation fails one, the implementation changes.

## AC-11.1 — Connecting a folder writes nothing to it

Connect a project and the entire working tree is **byte-for-byte unchanged** — no config
edit, no injected import, no generated file, no lockfile churn. Asserted by hashing the tree
before and after a session that opens, serves, and closes.

Anything the host needs to persist lives outside the project or under the existing `.sve/`.

## AC-11.2 — The editor is merged in, not written in

Vite is started programmatically with the user's own config auto-discovered and our plugin
appended. `sourceLoc`'s `enforce: 'pre'` guarantees it runs before their React plugin
regardless of array position, so ordering is not something the host has to solve.

Asserted against a fixture project that has its own `vite.config.ts` with its own plugins:
their plugins still run, and elements come back stamped.

## AC-11.3 — It works on a project outside this monorepo

**This is the criterion that fails today.** The overlay is injected as the bare specifier
`@sve/vite/client`, resolved through *the user's* `node_modules`, which has never heard of it.

The fixture for this criterion is a project in a temp directory with no relationship to this
repo — not `apps/demo`, which can resolve `@sve/*` by accident. It needs a `resolveId` hook
returning our absolute path, `server.fs.allow` widened to our package directory, and
`optimizeDeps.exclude`; the same applies transitively to `@sve/overlay` and `@sve/protocol`.

If the fixture lives inside the workspace, this criterion is not being tested.

## AC-11.4 — Unsupported projects are refused clearly, and silence is impossible

- A project with no Vite config, or no React, is refused with a message naming what was
  looked for and not found.
- `editRoots` is detected rather than assumed `<root>/src` — a project using `app/` must work
  or be told why it does not.
- Stamping covers JSX in `.js` as well as `.jsx`/`.tsx`.
- **A connected project where zero elements were stamped is an error surfaced in the UI**, not
  an editor that loads and quietly does nothing when clicked. This is the failure mode most
  likely to be mistaken for a broken product.

## AC-11.5 — Cloning a repository never runs its code without saying so

A GitHub URL is shallow-cloned into a local workspace directory. Then, before anything is
executed:

- installing dependencies runs **arbitrary lifecycle scripts from a stranger's repository**,
  so it requires explicit confirmation that names the repository — never implicit, never on a
  path the user did not choose;
- the dev command likewise;
- a URL that is not a repository, or a clone that fails, is reported rather than retried.

The clone target is inside the host's workspace directory and the same path-guard reasoning
as `editRoots` applies: a repository name is untrusted input and must not escape it.

## AC-11.6 — A session releases everything it took

Closing a session stops Vite, calls `middleware.close()`, aborts the bridge's lifetime, and
frees the port.

In middleware mode `server.httpServer` is null, so the existing `httpServer?.once('close')`
never fires and the serial queue and lifetime `AbortController` leak. The host closes
explicitly, asserted by opening and closing many sessions and observing no growth in
listeners or open handles.

## AC-11.7 — Two projects can be open at once without touching each other

Sessions get their own port, own bridge, own snapshot store, own provider. An edit in one
never appears in the other, and closing one does not disturb the other.

## AC-11.8 — The host is drivable without a browser

The host exposes a typed API — connect, status, close — that the E2E suite drives directly.
The studio in M14 is a client of it, not a prerequisite for testing it.
