# AC-2 — `apps/demo` (the page under edit)

The demo is not filler. It is the E2E fixture, and its content is chosen so the editor's
hard cases occur naturally rather than being bolted on. See `docs/design.md` §2.

Subject: **Sounding**, a tide-and-swell forecast service for open-water swimmers. The
page's one job is answering "is today's swim on?".

These criteria are fixed. If an implementation fails one, the implementation changes.

## AC-2.1 — Stack

Vite + React 19 + TypeScript + Tailwind v4 via `@tailwindcss/vite`. Workspace name
`@sve/demo`. `npm run build -w @sve/demo` exits 0.

The app imports nothing from any `@sve/*` package. The page under edit must not know the
editor exists — the editor is injected by the dev server, not wired in by the app.

## AC-2.2 — The four seeded cases exist, expressed in real content

1. **Six beach cards from one `.map()`** over a `BEACHES` array, each rendering a
   `<BeachCard>` component. One JSX site, six DOM subtrees — this is what the
   shared-instance warning is tested against.
2. **A computed dynamic string**: `{nextWindow}` in the hero, holding a "next safe window"
   value derived at render time, not a literal.
3. **A conditional className**: `cn('badge', safe ? ... : ...)` on each card's
   safe/marginal badge.
4. **Static happy paths**: the hero headline, the section headings, and the section copy
   are plain `JSXText` inside elements with literal `className` strings.

`cn` is a local helper in `apps/demo/src/lib/cn.ts`. Do not add `clsx` or `tailwind-merge`
as dependencies for it.

## AC-2.3 — Design compliance

Follows `docs/design.md` §2: a cold coastal palette that cannot be mistaken for the editor
chrome's ink-and-paper scheme in a screenshot.

Real copy throughout — no lorem ipsum, no "Feature One / Feature Two". Tide times, water
temperatures and swell heights are presentational sample data for a fictional service;
label them as sample data rather than presenting them as a live forecast.

## AC-2.4 — Quality floor

Responsive to 375px with no horizontal scroll. Visible keyboard focus on every interactive
element. `prefers-reduced-motion` respected. Semantic landmarks (`<header>`, `<main>`,
`<footer>`) and exactly one `<h1>`.

## AC-2.5 — Smoke test (`e2e/demo.smoke.spec.ts`)

Runs against the dev server with no editor involvement, so it does not depend on M2:

- the `<h1>` is present and non-empty;
- exactly six beach cards render;
- each card carries a badge reading either `Safe` or `Marginal`;
- the hero contains the computed next-window string, and it is not the literal text
  `{nextWindow}`;
- no console errors during load.
