# AC-4 — `@sve/overlay` (selection, overrides, inspector)

The browser half. It turns a click into a selection, a tweak into a DOM override, and an
override into an `EditIntent`. It does **not** verify — that is M6 (AC-5).

These criteria are fixed. If an implementation fails one, the implementation changes.

## AC-4.1 — Mounting is isolated and dev-only

- Mounts into a `ShadowRoot` on an element appended to `<body>`, outside the app's React
  root. The demo's Tailwind must not style the editor chrome, and the editor's styles must
  not leak into the page under edit — assert both directions.
- No-ops entirely when `import.meta.env.DEV` is false.
- Unmounting removes the host element, the injected override stylesheet, and every
  observer and listener it registered. Mount-unmount-mount leaves no duplicates.

## AC-4.2 — Selection

- Hovering an element with `data-sve-eid` draws a highlight aligned to its border box.
  The highlight is a separate positioned element; the target's own styles are never
  touched to indicate hover.
- Hovering an element **without** `data-sve-eid` selects the nearest ancestor that has one.
- Click selects. `Escape` deselects. Selection survives a React re-render of the target.
- The overlay's own chrome is never selectable as a target.
- Selection is keyboard reachable, and the highlight is visible at the default focus ring
  contrast.

## AC-4.3 — The override store

A plain observable keyed by `eid`. An override is `{ text?, classes?: { add, remove }, style? }`.

- Setting, clearing, and reading an override notifies subscribers exactly once per change.
- Clearing the last override removes the injected stylesheet's rule rather than leaving an
  empty one.
- The store holds no DOM references, so it survives HMR replacing every node on the page.

## AC-4.4 — Style and class removals go through CSS, never DOM mutation

One `<style>` element, regenerated on store change, containing rules keyed
`[data-sve-eid="..."]`. React re-renders cannot undo it, so there is no mutation war.

Assert directly: apply a style override, force a React re-render of the target, and confirm
(a) the override still renders, and (b) `MutationObserver` recorded no mutation on the
target's attributes from the overlay.

## AC-4.5 — Text and class additions are re-asserted

These cannot be expressed in CSS, so they mutate the DOM and must survive React overwriting
them.

- After a React re-render replaces the text, the override text is re-applied.
- The re-assertion is guarded by an `isReasserting` flag so the observer does not observe
  its own writes and loop. Assert the guard by counting observer callbacks: applying one
  override must settle, not oscillate.
- Clearing a text override restores the text React last rendered, not a stale value
  captured at selection time.

## AC-4.6 — Blast radius is surfaced, not hidden

When `document.querySelectorAll('[data-sve-eid="X"]').length > 1`, the inspector states the
count in plain language: *"6 elements render from this line — the edit hits all 6."*

The CSS override necessarily affects all of them, and that is correct: the preview's blast
radius must equal the blast radius of the source edit the agent will make. Assert that all
six visibly change, not just the clicked one.

## AC-4.7 — Disabled controls state their reason

- `data-sve-text="dynamic"` or `"mixed"` → the text field is disabled and reads
  *"This text comes from an expression — edit the data, not the markup."*
- `data-sve-class="dynamic"` or `"none"` → the class editor is disabled; the style panel
  stays live, because a style override does not require a literal `className` to edit.

A disabled control always shows why. Silently ignoring input is a failure of this criterion.

## AC-4.8 — The inspector renders a real diagnostic

Per `docs/design.md` §1:

- The coordinate headline shows the element's `file:line:col`, matching its `data-sve-loc`
  exactly.
- A source excerpt of the surrounding lines is shown on the `paper` surface with real line
  numbers, fetched from the dev server.
- A caret sits under the **exact column** from the loc — off-by-one here is a failed
  criterion, since the 1-based column convention is the point.
- Verification colours (`landed`, `drifted`) appear nowhere except a verification result.
  The caret uses its own colour and never doubles as a status.

## AC-4.9 — Comparators are pure, shared, and total

`src/compare.ts`, unit-tested without a browser:

- `normalizeText` collapses whitespace runs and trims, so JSX indentation does not read as
  a difference.
- `normalizeLength` makes `1rem` and `16px` compare equal at a 16px root.
- `normalizeColor` makes `#3b82f6`, `rgb(59, 130, 246)`, and `rgb(59 130 246)` compare
  equal, and returns a stable canonical form. It falls back to a canvas round-trip only
  when running in a browser, and the pure path must be total without one — the unit tests
  run in Node.
- Every comparator is total: unparseable input returns the normalised original rather than
  throwing, so a comparison never crashes the verifier.

## AC-4.10 — Intent capture records resolved values

`captureSnapshot(el)` returns `{ text, classes, computed }` where `computed` covers exactly
`TRACKED_PROPS` from `@sve/protocol` and nothing else.

The intent recorded for an edit is the snapshot taken **with the override applied** — the
resolved result, not the source syntax. This is what lets a Tailwind class edit and an
inline style edit expressing the same visual change both verify.
