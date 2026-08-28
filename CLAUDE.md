# Source-Mapped Visual Editor

A dev-time visual editor for React. Three principles govern every decision here:

1. **The editor writes no source of its own.** A user's change is first a *DOM override* —
   a temporary in-browser illusion. A headless coding agent is the only thing that touches
   disk. Never add a codemod, AST rewrite, or string patch that edits app source directly.
2. **Every element knows where it came from.** A Babel pass stamps each JSX host element
   with `file:line:col`. The agent is *told* the line; it is never asked to search for it.
   Do not give the agent `Glob`/`Grep`.
3. **Hot reload is the test.** After the agent writes, HMR re-renders, the overlay *lifts
   the override*, and compares the freshly-rendered DOM to the recorded intent. Match =
   landed. Mismatch = drifted, surfaced, never swallowed.

## Layout

```
packages/protocol/    zod wire contract shared by browser + node   (no deps on siblings)
packages/source-loc/  babel plugin + vite plugin — origin stamping
packages/overlay/     browser editor UI, override store, verifier
packages/bridge/      vite dev middleware + agent orchestration    (node only)
apps/demo/            Vite + React 19 + Tailwind v4 page under edit; also the E2E fixture
docs/acceptance/      acceptance criteria, written BEFORE implementation
```

## Non-negotiables

- **Acceptance criteria are fixed.** `docs/acceptance/*.md` is the contract. If a test
  fails, change the code — never the criteria, and never the test to match the bug.
- **Tests run without an API key.** `SVE_AGENT=fake` is the CI path: a deterministic
  scripted editor. It must be able to write the *wrong* thing on demand, because that is
  how the verifier itself is tested. Real-agent runs are opt-in (`SVE_AGENT=claude`).
- **The bridge queue is strictly serial.** Line numbers drift after every write, so two
  concurrent jobs on one file would target stale lines. Always re-read the file per job.
- **The browser is untrusted input.** Everything crossing into the bridge is parsed with a
  `@sve/protocol` schema first. `canUseTool` denies any path outside `editRoots`.
- **Compare computed values, not source text.** `bg-blue-500` and `style={{background:
  '#3b82f6'}}` must both verify. Comparators live in one place; do not inline ad-hoc
  string equality at call sites.
- **Overlay must not fight React.** Styles and class removals go through one injected
  stylesheet keyed on `[data-sve-eid]`. Only text and class *additions* mutate the DOM,
  and those are re-asserted via `MutationObserver` behind an `isReasserting` guard.

## Conventions

- TypeScript everywhere, `strict` + `noUncheckedIndexedAccess`. Workspace packages export
  `./src/index.ts` directly — there is no build step; Vite and Vitest transform TS.
- Vitest for units (`packages/*/test/*.test.ts`), Playwright for E2E (`e2e/`).
- Conventional Commits. Acceptance doc and failing test land *before* the implementation,
  so history reads red → green.
- Design tokens and UI direction: see `docs/design.md`. The editor chrome is styled as a
  compiler diagnostic (`paper` excerpt strip, blue caret under the exact column); the demo
  app is a cold coastal palette. Keep the two visually unmistakable.

## Commands

```bash
npm test          # vitest units
npm run typecheck # tsc --noEmit across the workspace
npm run e2e       # playwright, SVE_AGENT=fake
npm run dev       # demo app + editor overlay
```
