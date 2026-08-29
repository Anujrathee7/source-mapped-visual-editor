# Source-Mapped Visual Editor

A dev-time visual editor for React that **writes no source of its own**.

You click an element, change its text or its colour, and see the change immediately — but
that change is an illusion, a DOM override the editor is painting over the page. The only
thing that touches disk is a headless coding agent. When it finishes, hot reload
re-renders from the real file, the editor **lifts the override**, and compares what React
actually rendered against what you asked for.

Matching is the proof the edit landed. Not matching is a caught failure.

```
click ──> DOM override (instant, local)
             │
             ├── capture intent as RESOLVED values — text, computed CSS
             │
             ├── agent is TOLD the element at Hero.tsx:17:11 and edits it
             │
             └── HMR ──> lift the override ──> read the DOM ──> compare
                            │
                   match = landed  ·  mismatch = drifted, shown, never swallowed
```

## Why it is built this way

**The editor writes no source of its own.** Visual editors usually become a second source
of truth that drifts from the codebase. Here every change is first a temporary override
and then a real, reviewable diff written by an agent — there is no third representation
to fall out of sync.

**Every element knows where it came from.** A Babel pass stamps each JSX host element with
its `file:line:col`, so the agent is *told* which element to edit rather than asked to find
it. It is given `Read` and `Edit` and nothing else — deliberately **no `Glob`, no `Grep`**.
Searching is where agent edits usually go wrong, and this removes the step entirely.

**Hot reload is the test.** The comparison happens on *computed* values, not source text,
so `bg-blue-500` and `style={{ background: '#3b82f6' }}` both verify — the agent is free to
express the change however the surrounding code does.

## Two ids, because they answer different questions

Each element carries both:

| | |
|---|---|
| `data-sve-loc` | `apps/demo/src/Hero.tsx:17:11` — exact, and **invalid the moment the agent writes**, because every line below the edit shifts |
| `data-sve-eid` | `…Hero.tsx#section:0/div:0/h1:0` — structural, survives that shift, and is how the overlay finds the element again after HMR |

Elements are indexed nth-of-type, so adding an unrelated sibling does not renumber the
others. Components take a path slot even though they are not stamped — otherwise
`<div><A><span/></A><B><span/></B></div>` would produce two identical ids, and a colliding
id silently re-anchors an edit onto the wrong element.

## Quick start

```bash
npm install
npm run dev          # demo + editor at :5173 — click anything
```

The demo app imports nothing from the editor. `sve()` is registered in
`apps/demo/vite.config.ts` as build configuration; the page itself never learns the editor
exists. `SVE_EDITOR=off` takes it back out.

```ts
// apps/demo/vite.config.ts
import { sve } from '@sve/vite';

export default defineConfig({
  plugins: [sve(), react(), tailwindcss()],
});
```

## Layout

```
packages/protocol/     zod wire contract shared by browser and node
packages/source-loc/   babel plugin + vite plugin — origin stamping
packages/overlay/      selection, override store, inspector, comparators
packages/bridge/       serial queue, byte-exact snapshots, path guard, agent runners
packages/vite-plugin/  joins all four into one dev server
apps/demo/             the React page under edit; also the E2E fixture
docs/acceptance/       acceptance criteria, written BEFORE implementation
```

## Testing

```bash
npm test          # unit
npm run e2e       # end-to-end, SVE_AGENT=fake
npm run typecheck
npm run e2e:live  # opt-in, real agent, costs tokens
```

**The whole suite runs without an API key.** `SVE_AGENT=fake` is a deterministic in-process
editor, and it can be told to write the *wrong* thing on demand — which is the only reason
the green path means anything.

That is what `AC-5.2` is for. Break the lift step so the DOM is read while the override is
still painted, and the suite reports:

```
✗ AC-5.2  a wrong write is caught      Expected: "drifted"  Received: "landed"
✓ AC-5.1  a text edit lands, and the file says so
```

**AC-5.1 passes with the verifier broken.** A verifier that always reports green sails
through the happy path; only the deliberately-wrong write tells the two apart.

## Acceptance criteria come first

`docs/acceptance/*.md` is the contract, written before the code and fixed afterwards. When
a test fails, the code changes — never the criterion, and never the test to match the bug.
The history reads red → green: the criteria commit, then the failing spec, then the
implementation that turns it green.

## Scope

Text content, Tailwind class edits, and inline style props.

Structural edits — adding, deleting, or moving elements — are **out**, and not by accident:
no stable element identity survives them, so re-anchoring after hot reload becomes
ambiguous, and an editor that cannot reliably find the element again cannot verify anything
it did to it.
