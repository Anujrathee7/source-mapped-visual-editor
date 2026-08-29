# AC-16 — the studio's look, in two modes

**This supersedes AC-12.6.** The direction changed because the client's did: the workspace
now follows `docs/design.md` §3 rather than §1. §1 stays the brief for the in-page panel,
which is still what a project served without the studio gets.

Criteria are fixed against implementation convenience. They are not fixed against the person
the work is for changing what they want — that is a new brief, and this is it.

These criteria are fixed. If an implementation fails one, the implementation changes.

## AC-16.1 — Both modes exist and neither is an afterthought

- `data-theme="light"` and `data-theme="dark"` on the root, defaulting to
  `prefers-color-scheme` when the user has expressed no preference.
- An explicit toggle, keyboard reachable, and the choice persists across a reload.
- Every colour comes from a token. **No component hard-codes a hex** — asserted by scanning
  the studio's own sources, the way the `'*'`-origin prohibition is asserted in `@sve/rpc`.
- Both modes meet WCAG AA contrast for body and UI text against their own ground. Asserted by
  computing the ratios from the tokens, not by eye.

## AC-16.2 — The tokens are exactly the ones in the brief

Every value in `docs/design.md` §3's table appears, for both modes, under the names given.
A token defined in one mode and not the other is a failure — that is how a dark mode ends up
with one stranded light-mode colour in it.

## AC-16.3 — Warm neutrals, not slate

The neutral ramp is the warm one from the brief (`#161514`, `#FBFBFA` and their dark
counterparts). This is most of what separates the direction from a generic dashboard, so it
is pinned rather than left to drift back toward blue-grey during implementation.

## AC-16.4 — The three rules that survive the change

Carried over from §1 because they are about legibility, not palette, and still asserted:

- **The excerpt is visually inset** — its own recessed surface, distinct from the panel it
  sits in, in both modes.
- **The accent is a pointer, never a status.** The caret and the chat's prompt marker are the
  same job. It is not used to mean success, failure, or progress.
- **`landed` and `drifted` appear nowhere but a verdict** — the status dot and the status
  word, and nothing else. Asserted against the generated CSS, in both modes.

## AC-16.5 — Nothing moves

No animations, no transitions on state change, no hover motion. Asserted against the CSS:
no `@keyframes`, and no `transition` on a property that changes when a verdict resolves.

AC-12.7's no-layout-shift rule still holds and matters more now — without motion, a reflow
has nothing to hide behind. The verdict word keeps its fixed-width slot.

## AC-16.6 — The shape language

Hairline `1px solid var(--sv-line)` separators rather than shadows, with elevation reserved
for the connect card alone. Radius `10px` on panels, `8px` on inputs, and fully rounded pills
on the actions — Apply, Revert, Connect.

Uppercase micro-labels at 10–11px with `0.08em` tracking in the muted token, used for the
section and field labels.

## AC-16.7 — Nothing that worked stops working

The full unit suite and every Playwright spec pass, including M16's six studio specs, which
drive real elements by their real selectors. A restyle that breaks how the studio is driven
is not a restyle.

`packages/overlay`'s own chrome and its tests are untouched: that surface still follows §1.
