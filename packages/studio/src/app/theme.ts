/**
 * The workspace (AC-16), in the direction `docs/design.md` §3 sets.
 *
 * §3 supersedes §1 for this surface and only this surface. `packages/overlay` is still the
 * compiler-diagnostic chrome a project served without the studio gets, and it still keeps
 * `paper`, the travelling caret and the rest of it. Nothing here is shared with it.
 *
 * Three rules survive the change of palette, because they are about legibility rather than
 * colour, and `test/design.test.ts` holds this string to all three:
 *
 *  - **The excerpt is inset.** It is the one thing on screen standing for the real file, so
 *    it sits on the recessed `--sv-field` rather than on the panel. §1 made that point with
 *    a unique warm surface; here the recess and the mono make it, and `--sv-field` is
 *    shared with the inputs. What survives is the inset, not the exclusivity.
 *  - **The accent is a pointer.** The caret, the chat's prompt marker, the selected row's
 *    edge, the focus ring, the drag edge — all the same job. It never means success,
 *    failure or progress.
 *  - **`landed` and `drifted` appear nowhere but a verdict**: the status dot and the status
 *    word. A verdict colour spent on a notice or a border would stop the verdict meaning
 *    anything.
 *
 * Four decisions this file makes that the brief left open:
 *
 * **Panels are cards on the ground.** §3 asks for 10px radius on panels and for generous
 * space; those two together only make sense if a panel has an edge to round, so the three
 * are laid on `--sv-ground` with a gutter between them rather than butted edge to edge.
 * The whitespace is the separation, the hairline border is the edge, and the drag handle
 * lives in the gutter — invisible until it is wanted, because a rail drawn in the gap
 * between two already-bordered cards is a third line saying what two lines said.
 *
 * **Two dark blocks, not one.** A reader who has never touched the toggle gets dark from
 * `prefers-color-scheme`; a reader who has gets it from `data-theme`, and that has to win
 * in *both* directions — the attribute is why `:root:not([data-theme='light'])` guards the
 * query rather than the query standing alone.
 *
 * **Stillness.** AC-16.5 removes the one animation §1 spent, so there is no motion at all
 * here: no keyframes, no transitions, not even on hover. That makes AC-12.7's no-layout-
 * shift rule matter more rather than less, so the verdict word still lives in a slot wide
 * enough for the longest of them, a row still has a floor, Revert still occupies its space
 * whether or not it is offered, and the selected row's edge is a border that was always
 * there and only changes colour.
 *
 * **Every colour is a token, and that is scanned for.** A hex may appear on a declaration
 * in this file and nowhere else in the package.
 */
export const STUDIO_CSS = `
/* ── the palette, light ──────────────────────────────────────────────────── */

:root {
  --sv-ground: #FBFBFA;
  --sv-panel: #FFFFFF;
  --sv-field: #F6F6F6;
  --sv-line: #ECEBEB;
  --sv-text: #161514;
  --sv-muted: #71706F;
  --sv-accent: #6A77E5;
  --sv-landed: #1F8A5B;
  --sv-drifted: #C4342F;
  color-scheme: light;
}

/* ── the palette, dark — for the reader who has expressed no preference ──── */

@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    --sv-ground: #141413;
    --sv-panel: #1B1B19;
    --sv-field: #100F0E;
    --sv-line: #2B2A28;
    --sv-text: #F4F3F1;
    --sv-muted: #8B8987;
    --sv-accent: #8B95EE;
    --sv-landed: #4ADE9A;
    --sv-drifted: #F87171;
    color-scheme: dark;
  }
}

/*
 * ...and for the reader who has. Last, so it beats the query in both directions: chosen
 * dark under a light system, and chosen light under a dark one via the guard above.
 */
:root[data-theme='dark'] {
  --sv-ground: #141413;
  --sv-panel: #1B1B19;
  --sv-field: #100F0E;
  --sv-line: #2B2A28;
  --sv-text: #F4F3F1;
  --sv-muted: #8B8987;
  --sv-accent: #8B95EE;
  --sv-landed: #4ADE9A;
  --sv-drifted: #F87171;
  color-scheme: dark;
}

/* ── type, elevation and layout — the same in both modes ─────────────────── */

:root {
  --sv-sans: 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
  --sv-mono: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;

  /*
   * Mixed from the ink rather than from black, so the one shadow in the interface is as
   * warm as the neutrals it falls on, and follows the mode without a second declaration.
   */
  --sv-shadow: color-mix(in srgb, var(--sv-text) 10%, transparent);

  /* Written by the splitters. Clamped there, not here, so a drag cannot starve the middle. */
  --sv-changes: 300px;
  --sv-chat: 360px;
}

* {
  box-sizing: border-box;
}

html,
body,
#root {
  height: 100%;
}

body {
  margin: 0;
  background: var(--sv-ground);
  color: var(--sv-text);
  font-family: var(--sv-sans);
  font-size: 13px;
  font-weight: 400;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

[hidden] {
  display: none !important;
}

:focus-visible {
  outline: 2px solid var(--sv-accent);
  outline-offset: 2px;
}

/* The one label device the whole interface labels with. */
.sv-label {
  margin: 0;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--sv-muted);
}

/* ── the workspace: three cards on the ground ────────────────────────────── */

.sv-shell {
  display: grid;
  grid-template-columns: var(--sv-changes) 1px minmax(420px, 1fr) 1px var(--sv-chat);
  grid-template-rows: minmax(0, 1fr);
  gap: 10px;
  height: 100%;
  padding: 10px;
  overflow: hidden;
}

/*
 * The drag edge lives in the gutter and is drawn only when it is wanted: two bordered
 * cards with air between them have already said where one ends.
 */
.sv-splitter {
  appearance: none;
  border: 0;
  padding: 0;
  width: 1px;
  justify-self: center;
  background: transparent;
  cursor: col-resize;
  position: relative;
}

.sv-splitter::after {
  content: '';
  position: absolute;
  inset: 0 -8px;
}

.sv-splitter:hover,
.sv-splitter:focus-visible {
  background: var(--sv-accent);
}

.sv-splitter:focus-visible {
  outline: none;
}

.sv-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--sv-panel);
  border: 1px solid var(--sv-line);
  border-radius: 10px;
}

.sv-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 44px;
  padding: 0 16px;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--sv-muted);
  border-bottom: 1px solid var(--sv-line);
}

.sv-panel__body {
  overflow: auto;
  min-height: 0;
}

.sv-empty {
  margin: 0;
  padding: 20px 16px;
  color: var(--sv-muted);
  font-size: 12px;
  max-width: 46ch;
}

/* ── changes ─────────────────────────────────────────────────────────────── */

.sv-log {
  list-style: none;
  margin: 0;
  padding: 0;
}

.sv-row {
  /*
   * A floor, so a row that gains a mismatch block grows downward and a row that resolves
   * does not resize at all. AC-12.7: a verdict arriving must move nothing above it.
   *
   * The selection edge is a border that is always there, because a 2px border appearing on
   * click would shift every word in the row sideways.
   */
  min-height: 72px;
  padding: 14px 16px 16px;
  border-bottom: 1px solid var(--sv-line);
  border-left: 2px solid transparent;
  display: grid;
  gap: 6px;
  align-content: start;
}

.sv-row[data-selected='true'] {
  background: var(--sv-field);
  border-left-color: var(--sv-accent);
}

.sv-row__main {
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.sv-row__loc {
  font-family: var(--sv-mono);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
}

.sv-row__verdict-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  border: 1px solid var(--sv-line);
  align-self: center;
}

.sv-row[data-status='landed'] .sv-row__verdict-dot {
  background: var(--sv-landed);
  border-color: var(--sv-landed);
}

.sv-row[data-status='drifted'] .sv-row__verdict-dot,
.sv-row[data-status='error'] .sv-row__verdict-dot {
  background: var(--sv-drifted);
  border-color: var(--sv-drifted);
}

.sv-row__verdict {
  /*
   * Wide enough for the longest word the flow can print, so Applying… -> Landed changes a
   * label and not a layout.
   */
  min-width: 9ch;
  text-align: right;
  font-family: var(--sv-mono);
  font-size: 11px;
  color: var(--sv-muted);
}

.sv-row[data-status='landed'] .sv-row__verdict {
  color: var(--sv-landed);
}

.sv-row[data-status='drifted'] .sv-row__verdict,
.sv-row[data-status='error'] .sv-row__verdict {
  color: var(--sv-drifted);
}

.sv-row__summary {
  margin: 0;
  padding-left: 18px;
  color: var(--sv-muted);
  font-size: 12px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.sv-row__origin {
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--sv-muted);
}

.sv-row__mismatch {
  margin: 4px 0 0 18px;
  padding: 10px 12px;
  background: var(--sv-field);
  border-radius: 8px;
  font-family: var(--sv-mono);
  font-size: 11px;
  color: var(--sv-muted);
  display: grid;
  gap: 3px;
  overflow-x: auto;
}

.sv-row__actions {
  padding-left: 18px;
  min-height: 30px;
}

/*
 * Present whether or not it is offered: hiding it with "display" would make every row
 * change height the moment a job touched disk.
 */
.sv-row__actions[data-offered='false'] > * {
  visibility: hidden;
}

/* ── preview ─────────────────────────────────────────────────────────────── */

.sv-preview {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  min-width: 0;
}

.sv-preview__bar {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  padding: 0 16px;
  font-family: var(--sv-mono);
  font-size: 11px;
  color: var(--sv-muted);
  border-bottom: 1px solid var(--sv-line);
}

.sv-preview__url {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.sv-preview__stage {
  position: relative;
  min-height: 0;
  background: var(--sv-panel);
}

.sv-preview__frame {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
}

.sv-preview__lost {
  position: absolute;
  inset: 0;
  display: grid;
  align-content: center;
  justify-items: start;
  gap: 12px;
  padding: 28px;
  background: var(--sv-panel);
  color: var(--sv-text);
}

/* ── the diagnostic, under the preview it is about ───────────────────────── */

.sv-diagnostic {
  border-top: 1px solid var(--sv-line);
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(240px, 320px);
  min-height: 188px;
}

.sv-diagnostic__source {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  align-content: start;
  padding: 14px 16px 16px;
  gap: 8px;
  min-width: 0;
}

.sv-coord {
  display: flex;
  gap: 12px;
  justify-content: space-between;
  align-items: baseline;
  font-family: var(--sv-mono);
  font-size: 12px;
}

.sv-coord__file {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
}

.sv-coord__pos {
  flex: none;
  color: var(--sv-muted);
}

/*
 * Inset, because it stands for the file. The recess and the mono are what say so now that
 * the surface is no longer unique to it.
 */
.sv-excerpt {
  background: var(--sv-field);
  font-family: var(--sv-mono);
  font-size: 12px;
  line-height: 1.7;
  padding: 10px 0;
  overflow: auto;
  border-radius: 10px;
}

.sv-excerpt__code {
  margin: 0;
  white-space: pre;
  min-width: max-content;
}

.sv-excerpt__line,
.sv-excerpt__caret-row {
  display: flex;
  gap: 12px;
  padding: 0 14px;
}

/* The target line lifts to the panel surface — the one thing raised out of the recess. */
.sv-excerpt__line[data-target='true'] {
  background: var(--sv-panel);
}

.sv-excerpt__no {
  flex: none;
  width: 3ch;
  text-align: right;
  color: var(--sv-muted);
  user-select: none;
}

.sv-excerpt__text {
  white-space: pre;
}

.sv-caret,
.sv-caret-pad {
  color: var(--sv-accent);
  font-family: var(--sv-mono);
  font-weight: 600;
  white-space: pre;
}

.sv-fields {
  border-left: 1px solid var(--sv-line);
  padding: 14px 16px 18px;
  display: grid;
  gap: 14px;
  align-content: start;
  overflow: auto;
}

.sv-field {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.sv-field__label {
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--sv-muted);
}

.sv-field__input {
  font-family: var(--sv-mono);
  font-size: 12px;
  color: var(--sv-text);
  background: var(--sv-field);
  border: 1px solid var(--sv-line);
  border-radius: 8px;
  padding: 8px 10px;
  min-width: 0;
}

.sv-field__input:disabled {
  color: var(--sv-muted);
  cursor: not-allowed;
}

.sv-field__input:focus-visible {
  outline: 2px solid var(--sv-accent);
  outline-offset: 1px;
}

.sv-field__reason,
.sv-blast {
  margin: 0;
  font-size: 11px;
  color: var(--sv-muted);
}

/* ── chat ────────────────────────────────────────────────────────────────── */

.sv-chat {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
}

.sv-transcript {
  list-style: none;
  margin: 0;
  padding: 16px;
  display: grid;
  gap: 22px;
  align-content: start;
}

/*
 * A transcript, not a conversation: no bubbles, no avatars, no alternating sides. The
 * request is a prompt line and the reply is the answer under it, which is the shape the
 * rest of this product already has.
 */
.sv-turn {
  display: grid;
  gap: 8px;
}

.sv-turn__request {
  display: grid;
  grid-template-columns: 1ch minmax(0, 1fr);
  gap: 10px;
  margin: 0;
  font-size: 13px;
  font-weight: 500;
}

.sv-turn__marker {
  color: var(--sv-accent);
  user-select: none;
}

.sv-turn__reply {
  margin: 0;
  padding-left: calc(1ch + 10px);
  color: var(--sv-muted);
  font-size: 12px;
}

.sv-turn__reply code {
  font-family: var(--sv-mono);
  color: var(--sv-text);
}

.sv-turn__actions {
  display: flex;
  gap: 8px;
  padding-left: calc(1ch + 10px);
}

.sv-compose {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 10px;
  padding: 14px 16px;
  border-top: 1px solid var(--sv-line);
}

.sv-compose__input {
  font-family: var(--sv-sans);
  font-size: 12px;
  color: var(--sv-text);
  background: var(--sv-field);
  border: 1px solid var(--sv-line);
  border-radius: 8px;
  padding: 10px 12px;
  resize: none;
  min-height: 42px;
}

.sv-compose__input:focus-visible {
  outline: 2px solid var(--sv-accent);
  outline-offset: 1px;
}

/* ── controls: every action is a pill ────────────────────────────────────── */

.sv-button {
  font-family: var(--sv-sans);
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  color: var(--sv-text);
  background: var(--sv-panel);
  border: 1px solid var(--sv-line);
  border-radius: 999px;
  padding: 9px 16px;
  cursor: pointer;
}

.sv-button:not(.sv-button--primary):hover:not(:disabled) {
  background: var(--sv-field);
}

.sv-button--primary {
  color: var(--sv-ground);
  background: var(--sv-text);
  border: 1px solid var(--sv-text);
}

.sv-button:disabled {
  color: var(--sv-muted);
  cursor: not-allowed;
}

.sv-button--primary:disabled {
  color: var(--sv-panel);
  background: var(--sv-muted);
  border-color: var(--sv-muted);
}

.sv-button:focus-visible {
  outline: 2px solid var(--sv-accent);
  outline-offset: 2px;
}

.sv-theme {
  font-family: var(--sv-sans);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--sv-muted);
  background: none;
  border: 1px solid var(--sv-line);
  border-radius: 999px;
  padding: 5px 12px;
  cursor: pointer;
}

.sv-theme:hover {
  color: var(--sv-text);
}

/* ── connecting: the one card that floats ────────────────────────────────── */

.sv-connect {
  height: 100%;
  overflow: auto;
  display: grid;
  align-content: center;
  justify-items: center;
  padding: 40px 24px;
}

.sv-connect__card {
  width: 100%;
  max-width: 620px;
  display: grid;
  gap: 20px;
  padding: 32px;
  background: var(--sv-panel);
  border: 1px solid var(--sv-line);
  border-radius: 10px;
  box-shadow: 0 1px 2px var(--sv-shadow), 0 12px 32px var(--sv-shadow);
}

.sv-connect__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.sv-connect__title {
  margin: 0;
  font-family: var(--sv-sans);
  font-size: 28px;
  font-weight: 600;
  line-height: 1.15;
  letter-spacing: -0.025em;
}

.sv-connect__lede {
  margin: 0;
  max-width: 54ch;
  color: var(--sv-muted);
  font-size: 13px;
}

.sv-connect__form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
}

.sv-connect__section {
  display: grid;
  gap: 12px;
  padding-top: 20px;
  border-top: 1px solid var(--sv-line);
}

.sv-phase {
  margin: 0;
  font-family: var(--sv-mono);
  font-size: 12px;
  color: var(--sv-muted);
  display: flex;
  gap: 10px;
  align-items: center;
}

.sv-phase__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--sv-muted);
}

/*
 * A notice is never a verdict, so it is never coloured like one: the error variant is
 * distinguished by dropping to the recessed surface, and the sentence does the rest.
 */
.sv-notice {
  border: 1px solid var(--sv-line);
  border-radius: 10px;
  padding: 16px;
  display: grid;
  gap: 8px;
}

.sv-notice__title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.sv-notice__body {
  margin: 0;
  font-size: 12px;
  color: var(--sv-muted);
}

.sv-notice--error {
  background: var(--sv-field);
}

.sv-notice__command {
  margin: 0;
  font-family: var(--sv-mono);
  font-size: 12px;
  background: var(--sv-field);
  border: 1px solid var(--sv-line);
  border-radius: 8px;
  padding: 8px 10px;
  overflow-x: auto;
}

.sv-notice__actions {
  display: flex;
  gap: 8px;
  padding-top: 4px;
}

/* ── the provider picker ─────────────────────────────────────────────────── */

.sv-providers {
  display: grid;
  gap: 10px;
}

.sv-provider {
  display: grid;
  gap: 5px;
  padding: 14px 16px;
  border: 1px solid var(--sv-line);
  border-radius: 10px;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.sv-provider:hover {
  background: var(--sv-field);
}

.sv-provider[aria-pressed='true'] {
  border-color: var(--sv-accent);
}

.sv-provider__label {
  font-size: 13px;
  font-weight: 500;
}

.sv-provider__cost,
.sv-provider__summary,
.sv-provider__missing,
.sv-providers__note {
  margin: 0;
  font-size: 11px;
  color: var(--sv-muted);
}

.sv-provider__missing {
  color: var(--sv-text);
}

/* ── to a laptop, and no further down than it has to go ──────────────────── */

@media (max-width: 1180px) {
  .sv-shell {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 3fr) 1px minmax(0, 2fr);
  }

  .sv-splitter {
    width: auto;
    height: 1px;
    justify-self: stretch;
    cursor: row-resize;
  }

  .sv-splitter::after {
    inset: -8px 0;
  }

  .sv-shell > .sv-changes {
    order: 2;
  }

  .sv-shell > .sv-preview {
    order: 1;
  }

  .sv-shell > .sv-chat {
    order: 3;
  }

  .sv-diagnostic {
    grid-template-columns: minmax(0, 1fr);
  }

  .sv-fields {
    border-left: 0;
    border-top: 1px solid var(--sv-line);
  }
}

@media (max-width: 640px) {
  .sv-shell {
    gap: 8px;
    padding: 8px;
  }

  .sv-connect {
    padding: 20px 12px;
  }

  .sv-connect__card {
    padding: 24px 20px;
  }

  .sv-connect__form {
    grid-template-columns: minmax(0, 1fr);
  }
}
`;
