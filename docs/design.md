# Design direction

Two surfaces, deliberately unalike so a screenshot is never ambiguous about which is which.

## 1. Editor chrome (`packages/overlay`)

The subject's own world is compiler diagnostics — `file:line:col`, a source excerpt, a
caret under the exact column. That vernacular, not generic dev-tool-panel styling, is
where this design comes from.

### Tokens

| Role | Value | Use |
|---|---|---|
| `--sve-ink` | `#0E1116` | chrome ground |
| `--sve-slab` | `#1A1F27` | panel surfaces, controls |
| `--sve-paper` | `#F7F4EC` | **only** the source-excerpt strip |
| `--sve-caret` | `#3D7BFF` | column marker + selection outline |
| `--sve-landed` | `#35C489` | verification passed |
| `--sve-drifted` | `#E5484D` | verification failed |

`paper` is the single warm surface and it is load-bearing: it is the one thing on screen
standing for the real file on disk, inset into the chrome exactly as the override is a
layer over real source. Do not reuse it for panels, hovers, or empty states.

The caret is a **pointer**, so it has its own colour and never doubles as a status. Red and
green are reserved for the verifier's verdict — nothing else may use them, or the outcome
signal stops meaning anything.

### Type

IBM Plex Mono for the coordinate headline, the excerpt, and all values. IBM Plex Sans for
labels and prose. One superfamily. Mono is promoted to the *display* role because
coordinates are the product, not a footnote. (JetBrains Mono is the reflexive pick for dev
tooling; Plex's drafting-table character is closer to compiler output and less ubiquitous.)

### Signature: the caret

The inspector's top third renders the selected element as a real compiler diagnostic:

```
┌────────────────────────────────┐
│ apps/demo/src/Hero.tsx   42:7  │   coordinate headline
├────────────────────────────────┤
│ 41 │   <div className="…">     │   ← paper strip, real excerpt
│ 42 │     <h1 className="…">    │
│    │     ^                     │   ← caret, under the exact column
│ 43 │       Swim today          │
├────────────────────────────────┤
│ TEXT   [ Swim today         ]  │
│ CLASS  [ text-5xl font-… ]     │
│ STYLE  ▸ spacing   colour      │
├────────────────────────────────┤
│ ● 6 elements render from this  │
│   line — the edit hits all 6.  │
└────────────────────────────────┘
```

No other visual editor can draw this, because no other one knows the column.

**Motion is spent once, and only here.** While an edit is in flight the caret travels from
the excerpt line to the selected element on the page and back, tying file position to
pixel. Everything else stays still. `prefers-reduced-motion` collapses it to a static
state change.

### Copy

One action verb carried through the whole flow:

**Apply → Applying… → Landed / Drifted / Blocked / Stalled**, plus **Reverted** when a
snapshot is restored — never "Landed", because nothing landed.

Failure states give the fact and the next move, with no apology and no vagueness:

> **Drifted.** The file changed but the result doesn't match.
> Intent `Ship faster` · Rendered `Ship Faster`
> Retry sends the difference back to the agent.

> **Blocked.** The agent found no plain string literal at Hero.tsx:42:7. Nothing was written.

Disabled controls state their reason rather than failing silently:

> This text comes from an expression — edit the data, not the markup.

## 2. `apps/demo` — the page being edited

Pinned subject: **Sounding**, a tide-and-swell forecast service for open-water swimmers.
Audience: people deciding at 6am whether today's swim is on. The page's one job is
answering that.

Chosen because its real content produces the editor's hard cases instead of having them
bolted on, and because a cold coastal palette reads as unmistakably *not* the editor chrome
in any screenshot:

- six beach cards from a `.map()` → shared-instance warning (AC-7)
- `{nextWindow}` — a computed "next safe window" string → `data-sve-text="dynamic"` (AC-8)
- `cn('badge', safe ? … : …)` on the safe/marginal badge → `data-sve-class="dynamic"` (AC-8)
- hero headline, section copy, literal Tailwind classNames → the happy paths (AC-4, AC-6)

## Quality floor (both surfaces)

Responsive down to mobile. Visible keyboard focus. `prefers-reduced-motion` respected.
No decoration that does not serve the brief.
