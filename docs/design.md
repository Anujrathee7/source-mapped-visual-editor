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

## 3. `@sve/studio` — the workspace

**Superseding the studio's use of §1.** §1 remains the direction for the in-page panel
(`packages/overlay`), which is still what a project served without the studio gets. The
workspace is its own surface and follows this section instead.

The brief: a calm, warm-neutral product surface in the vernacular of a modern developer
tool — near-white or near-black ground, one accent, hairline rules, generous whitespace,
pill actions, and wide-tracked uppercase micro-labels doing the labelling work. **Both a
light and a dark mode, and no animation anywhere.**

What carries over from §1 is not the palette but the *discipline*: the excerpt is a distinct
surface because it stands for the file, the accent is a pointer and never a status, and
verdict colours appear nowhere but a verdict. Those three rules are what keep the interface
legible; the colours around them are free to change.

### Tokens

| role | light | dark |
|---|---|---|
| `--sv-ground` | `#FBFBFA` | `#141413` |
| `--sv-panel` | `#FFFFFF` | `#1B1B19` |
| `--sv-field` — inputs, and the excerpt | `#F6F6F6` | `#100F0E` |
| `--sv-line` — every hairline | `#ECEBEB` | `#2B2A28` |
| `--sv-text` | `#161514` | `#F4F3F1` |
| `--sv-muted` — labels, secondary | `#71706F` | `#8B8987` |
| `--sv-accent` — the pointer | `#6A77E5` | `#8B95EE` |
| `--sv-landed` | `#1F8A5B` | `#4ADE9A` |
| `--sv-drifted` | `#C4342F` | `#F87171` |

The neutrals are **warm** — a near-black of `#161514` rather than `#0E1116`, a near-white of
`#FBFBFA` rather than pure white. That warmth is most of the difference between this and a
generic slate-grey dashboard, and it is worth protecting.

`--sv-field` is the excerpt's surface *and* the inputs', which is a deliberate change from
§1's rule that `paper` belongs to the excerpt alone: in a light mode the excerpt no longer
needs a warm surface to read as "the file", because the recess and the mono do that. The rule
that survives is that the excerpt is visually inset, not that its colour is unique.

### Type

- **UI and display:** Inter, tight tracking at display sizes (`-0.02em` and up). Weights 400,
  500 and 600 only — the reference gets its authority from size and tracking rather than from
  heavy weights.
- **Code:** a monospace keeps every job it had. The excerpt has to align under a caret and the
  coordinates must not jitter between values; this is a code tool and the mono is load-bearing,
  not decorative. It is simply no longer the display face.
- **Micro-labels:** uppercase, 10–11px, `letter-spacing: 0.08em`, `--sv-muted`. This is the
  reference's most characteristic device and it maps directly onto what the studio already
  needs to label — `CHANGES`, `TEXT`, `CLASS`, `STYLE`, `PRE-CALL`-style section heads.

### Shape

Hairlines, not shadows: `1px solid var(--sv-line)` separates everything, and elevation is
reserved for the one card that floats (connect). Radius `10px` on panels and cards, `8px` on
inputs, and **fully rounded pills on actions** — Apply, Revert, Connect. Space generously; the
reference's confidence comes mostly from what it leaves empty.

### Motion

**None.** No caret travel, no transitions on verdict changes, no hover animations. State
changes are instant. AC-12.7's no-layout-shift rule still holds and matters more without
motion to cover a reflow.

### Theme

`data-theme="light" | "dark"` on the root, defaulting to `prefers-color-scheme`, with an
explicit toggle and the choice persisted. Every colour is a token; no component hard-codes a
hex. Both modes meet WCAG AA for body text and UI text against their own ground.

## Quality floor (both surfaces)

Responsive down to mobile. Visible keyboard focus. `prefers-reduced-motion` respected.
No decoration that does not serve the brief.
