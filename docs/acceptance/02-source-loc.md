# AC-1 — `@sve/source-loc` (origin stamping)

The Babel pass that makes the whole premise work: every JSX host element carries the
`file:line:col` it came from, so the agent is *told* which line to edit.

These criteria are fixed. If an implementation fails one, the implementation changes.

## The fixture

`packages/source-loc/test/fixtures/Sample.tsx` — created exactly as written below, because
the expected line and column numbers are derived from it. Line 1 is the `import`.

```tsx
import { cn } from './cn';

export function Sample({ tagline, safe }: { tagline: string; safe: boolean }) {
  return (
    <section className="wrap">
      <h1 className="title">Swim today</h1>
      <p>{tagline}</p>
      <span className={cn('badge', safe && 'ok')}>Safe</span>
      <Feature name="Bondi" />
      <img src="/a.png" alt="" />
    </section>
  );
}
```

## AC-1.1 — Host elements are stamped; components are not

`<section>`, `<h1>`, `<p>`, `<span>`, `<img>` each receive all four attributes.
`<Feature>` receives none — a component emits no DOM of its own, so a coordinate on it
would point at markup that does not exist in the document.

Also unstamped: member expressions (`<Foo.Bar>`, `<motion.div>`) and fragments.

## AC-1.2 — `data-sve-loc` is `file:line:col`, 1-based, pointing at the opening angle bracket

Transformed with `filename: 'apps/demo/src/Sample.tsx'`, the emitted values are exactly:

| element | `data-sve-loc` |
|---|---|
| `<section>` | `apps/demo/src/Sample.tsx:5:5` |
| `<h1>` | `apps/demo/src/Sample.tsx:6:7` |
| `<p>` | `apps/demo/src/Sample.tsx:7:7` |
| `<span>` | `apps/demo/src/Sample.tsx:8:7` |
| `<img>` | `apps/demo/src/Sample.tsx:10:7` |

Columns are **1-based** — Babel's `loc.start.column` is 0-based, so add one — to match the
convention every editor and compiler uses when it prints `42:7`.

The path is always project-relative and always uses forward slashes, on every platform. A
Windows backslash would not survive the round-trip through the agent prompt intact.

## AC-1.3 — `data-sve-eid` is structural, and survives line shifts

Format: `<project-relative path>#<segment>/<segment>/...` where each segment is `tagName:n`
and `n` is the 0-based index of that element **among its siblings with the same tag name**
(nth-of-type, not nth-child). Indexing per tag name means adding an unrelated sibling does
not renumber the others.

| element | `data-sve-eid` |
|---|---|
| `<section>` | `apps/demo/src/Sample.tsx#section:0` |
| `<h1>` | `apps/demo/src/Sample.tsx#section:0/h1:0` |
| `<p>` | `apps/demo/src/Sample.tsx#section:0/p:0` |
| `<span>` | `apps/demo/src/Sample.tsx#section:0/span:0` |
| `<img>` | `apps/demo/src/Sample.tsx#section:0/img:0` |

**The stability test, which is the whole reason for carrying two ids:** transform the
fixture a second time with two blank lines inserted at the top. Every `data-sve-eid` is
byte-for-byte identical; every `data-sve-loc` line number has increased by exactly 2.

That is precisely the situation the agent's own write creates, and it is what lets the
overlay re-find an element after every line below the edit has moved.

## AC-1.4 — `data-sve-text` classifies the children

- `static` — children are non-whitespace `JSXText` only. Safe to replace as a literal.
- `dynamic` — any `JSXExpressionContainer` child, excluding comment-only containers.
- `mixed` — both `JSXText` and `JSXElement` children. Not safely replaceable wholesale.
- `none` — no children, or element children only.

| element | value |
|---|---|
| `<section>` | `none` |
| `<h1>` | `static` |
| `<p>` | `dynamic` |
| `<span>` | `static` |
| `<img>` | `none` |

## AC-1.5 — `data-sve-class` classifies the `className`

- `literal` — a plain string literal, e.g. `className="wrap"`.
- `dynamic` — an expression container: a `cn(...)` call, a template literal, a prop, a ternary.
- `none` — no `className` attribute, or it arrives via a spread.

| element | value |
|---|---|
| `<section>` | `literal` |
| `<h1>` | `literal` |
| `<p>` | `none` |
| `<span>` | `dynamic` |
| `<img>` | `none` |

## AC-1.6 — Existing attributes are preserved, and stamping is idempotent

Every attribute already on the element survives with its original value and relative order.
The four `data-sve-*` attributes are appended, never interleaved. Transforming an
already-stamped file produces no duplicate attributes.

## AC-1.7 — The Vite plugin is dev-only and preserves source maps

- `apply: 'serve'` and `enforce: 'pre'`.
- `transform` returns `{ code, map }` with a non-null map, so React stack traces and
  browser devtools keep pointing at real source lines.
- Files under `node_modules` return `null`.
- Files containing no JSX return `null` — no wasted Babel round-trip, no gratuitous map.
- Only `.jsx` and `.tsx` are considered.

## AC-1.8 — The transform never changes what renders

For the fixture, the transformed output parses, and stripping all `data-sve-*` attributes
from it yields an AST equivalent to the original. Stamping adds attributes; it must not
reorder, rewrite, or reformat anything else.
