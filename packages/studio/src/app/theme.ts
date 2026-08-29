/**
 * The workspace, in the vernacular the panel already spoke (AC-12.6).
 *
 * `docs/design.md` §1 is the whole brief and it scales up rather than being reinterpreted.
 * Three rules from it are load-bearing here and are enforced by `test/design.test.ts`
 * against this string rather than trusted:
 *
 *  - `paper` is the one warm surface and it belongs to the source excerpt alone. In a
 *    workspace the temptation is to reach for it as a "light panel"; it is the one thing on
 *    screen standing for the real file on disk, and a second use would spend that.
 *  - the caret keeps its own colour and never doubles as a status. It also earns one more
 *    job here — the chat's prompt marker — because that is the same job: a pointer.
 *  - `landed` and `drifted` appear nowhere but a verdict. In the log that means the status
 *    dot and the status word, which *are* the verdict, and nothing else.
 *
 * Two decisions this file makes that the panel never had to:
 *
 * **Proportions.** The preview is the one place the user's own design appears, so it takes
 * the room and the chrome around it is quiet: no border of its own, no toolbar competing
 * for attention, one thin coordinate bar. Changes is a column of coordinates and reads as
 * one — narrow, monospace, fixed by default. Chat is prose and gets a comfortable measure.
 * Both flanks are resizable and both are clamped, so no drag can squeeze the preview below
 * a width the project can honestly render in.
 *
 * **Stillness.** AC-12.7 forbids layout shift when a verdict resolves, which is a design
 * constraint before it is a CSS one: the verdict word lives in a slot wide enough for the
 * longest of them, the row has a floor, and Revert occupies its space whether or not it is
 * offered. `Applying…` becoming `Landed` moves nothing.
 */
export const STUDIO_CSS = `
:root {
  --sve-ink: #0E1116;
  --sve-slab: #1A1F27;
  --sve-paper: #F7F4EC;
  --sve-caret: #3D7BFF;
  --sve-landed: #35C489;
  --sve-drifted: #E5484D;

  --sve-mono: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  --sve-sans: 'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif;
  --sve-edge: rgba(247, 244, 236, 0.12);
  --sv-text: #E7E9EC;
  --sv-dim: rgba(231, 233, 236, 0.62);
  --sv-faint: rgba(231, 233, 236, 0.4);
  /* The ground behind the preview, which belongs to the page rather than to the chrome. */
  --sv-stage: #FFFFFF;

  /* Written by the splitters. Clamped there, not here, so a drag cannot starve the middle. */
  --sv-changes: 300px;
  --sv-chat: 360px;

  color-scheme: dark;
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
  background: var(--sve-ink);
  color: var(--sv-text);
  font-family: var(--sve-sans);
  font-size: 13px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}

[hidden] {
  display: none !important;
}

:focus-visible {
  outline: 2px solid var(--sve-caret);
  outline-offset: 2px;
}

/* ── the workspace ───────────────────────────────────────────────────────── */

.sv-shell {
  display: grid;
  grid-template-columns: var(--sv-changes) 1px minmax(420px, 1fr) 1px var(--sv-chat);
  grid-template-rows: 100%;
  height: 100%;
  overflow: hidden;
}

.sv-splitter {
  appearance: none;
  border: 0;
  padding: 0;
  width: 1px;
  background: var(--sve-edge);
  cursor: col-resize;
  position: relative;
}

.sv-splitter::after {
  content: '';
  position: absolute;
  inset: 0 -4px;
}

.sv-splitter:hover,
.sv-splitter:focus-visible {
  background: var(--sve-caret);
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
}

.sv-panel__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px 10px;
  font-family: var(--sve-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--sv-faint);
  border-bottom: 1px solid var(--sve-edge);
}

.sv-panel__body {
  overflow: auto;
  min-height: 0;
}

.sv-empty {
  margin: 0;
  padding: 18px 14px;
  color: var(--sv-dim);
  font-size: 12px;
}

/* ── changes ─────────────────────────────────────────────────────────────── */

.sv-changes {
  background: var(--sve-ink);
  border-right: 0;
}

.sv-log {
  list-style: none;
  margin: 0;
  padding: 0;
}

.sv-row {
  /*
   * A floor, so a row that gains a mismatch block grows downward and a row that resolves
   * does not resize at all. AC-12.7: a verdict arriving must move nothing above it.
   */
  min-height: 58px;
  padding: 10px 14px 12px;
  border-bottom: 1px solid var(--sve-edge);
  display: grid;
  gap: 4px;
}

.sv-row[data-selected='true'] {
  background: rgba(61, 123, 255, 0.09);
}

.sv-row__main {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr) auto;
  align-items: baseline;
  gap: 8px;
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
  font-family: var(--sve-mono);
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
  border: 1px solid var(--sv-faint);
  align-self: center;
}

.sv-row[data-status='landed'] .sv-row__verdict-dot {
  background: var(--sve-landed);
  border-color: var(--sve-landed);
}

.sv-row[data-status='drifted'] .sv-row__verdict-dot,
.sv-row[data-status='error'] .sv-row__verdict-dot {
  background: var(--sve-drifted);
  border-color: var(--sve-drifted);
}

.sv-row__verdict {
  /*
   * Wide enough for the longest word the flow can print, so Applying… -> Landed changes a
   * label and not a layout.
   */
  min-width: 9ch;
  text-align: right;
  font-family: var(--sve-mono);
  font-size: 11px;
  color: var(--sv-dim);
}

.sv-row[data-status='landed'] .sv-row__verdict {
  color: var(--sve-landed);
}

.sv-row[data-status='drifted'] .sv-row__verdict,
.sv-row[data-status='error'] .sv-row__verdict {
  color: var(--sve-drifted);
}

.sv-row__summary {
  margin: 0;
  padding-left: 18px;
  color: var(--sv-dim);
  font-size: 12px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.sv-row__origin {
  font-family: var(--sve-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--sv-faint);
}

.sv-row__mismatch {
  margin: 2px 0 0;
  padding: 8px 10px;
  margin-left: 18px;
  border-left: 2px solid var(--sve-edge);
  font-family: var(--sve-mono);
  font-size: 11px;
  color: var(--sv-dim);
  display: grid;
  gap: 2px;
  overflow-x: auto;
}

.sv-row__actions {
  padding-left: 18px;
  min-height: 22px;
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
  background: var(--sve-ink);
}

.sv-preview__bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  font-family: var(--sve-mono);
  font-size: 11px;
  color: var(--sv-dim);
  border-bottom: 1px solid var(--sve-edge);
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
  background: var(--sv-stage);
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
  gap: 10px;
  padding: 24px;
  background: var(--sve-ink);
  color: var(--sv-text);
}

/* ── the diagnostic, under the preview it is about ───────────────────────── */

.sv-diagnostic {
  border-top: 1px solid var(--sve-edge);
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(240px, 320px);
  min-height: 168px;
}

.sv-coord {
  display: flex;
  gap: 12px;
  justify-content: space-between;
  align-items: baseline;
  padding: 10px 14px;
  font-family: var(--sve-mono);
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
  color: var(--sv-dim);
}

.sv-excerpt {
  background: var(--sve-paper);
  color: var(--sve-ink);
  font-family: var(--sve-mono);
  font-size: 12px;
  line-height: 1.6;
  padding: 8px 0;
  margin: 0 14px 12px;
  overflow-x: auto;
  border-radius: 2px;
}

.sv-excerpt__code {
  margin: 0;
  white-space: pre;
  min-width: max-content;
}

.sv-excerpt__line,
.sv-excerpt__caret-row {
  display: flex;
  gap: 10px;
  padding: 0 12px;
}

.sv-excerpt__line[data-target='true'] {
  background: rgba(61, 123, 255, 0.09);
}

.sv-excerpt__no {
  flex: none;
  width: 3ch;
  text-align: right;
  opacity: 0.45;
  user-select: none;
}

.sv-excerpt__text {
  white-space: pre;
}

.sv-caret,
.sv-caret-pad {
  color: var(--sve-caret);
  font-family: var(--sve-mono);
  font-weight: 700;
  white-space: pre;
}

.sv-caret--travelling {
  color: var(--sve-caret);
  display: inline-block;
  animation: sv-caret-travel 900ms ease-in-out infinite;
}

@keyframes sv-caret-travel {
  0% { transform: translateY(0); }
  50% { transform: translateY(4px); }
  100% { transform: translateY(0); }
}

.sv-fields {
  border-left: 1px solid var(--sve-edge);
  padding: 10px 14px 14px;
  display: grid;
  gap: 10px;
  align-content: start;
  overflow: auto;
}

.sv-field {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.sv-field__label {
  font-family: var(--sve-mono);
  font-size: 10px;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--sv-faint);
}

.sv-field__input {
  font-family: var(--sve-mono);
  font-size: 12px;
  color: inherit;
  background: var(--sve-slab);
  border: 1px solid var(--sve-edge);
  border-radius: 3px;
  padding: 6px 8px;
  min-width: 0;
}

.sv-field__input:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.sv-field__input:focus-visible {
  outline: 2px solid var(--sve-caret);
  outline-offset: 1px;
}

.sv-field__reason {
  margin: 0;
  font-size: 11px;
  color: var(--sv-dim);
}

.sv-blast {
  margin: 0;
  font-size: 11px;
  color: var(--sv-dim);
}

/* ── chat ────────────────────────────────────────────────────────────────── */

.sv-chat {
  border-left: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
}

.sv-transcript {
  list-style: none;
  margin: 0;
  padding: 12px 14px;
  display: grid;
  gap: 16px;
  align-content: start;
}

/*
 * A transcript, not a conversation: no bubbles, no avatars, no alternating sides. The
 * request is a prompt line and the reply is the answer under it, which is the shape the
 * rest of this product already has.
 */
.sv-turn {
  display: grid;
  gap: 6px;
}

.sv-turn__request {
  display: grid;
  grid-template-columns: 1ch minmax(0, 1fr);
  gap: 8px;
  margin: 0;
  font-family: var(--sve-mono);
  font-size: 12px;
}

.sv-turn__marker {
  color: var(--sve-caret);
  user-select: none;
}

.sv-turn__reply {
  margin: 0;
  color: var(--sv-dim);
  font-size: 12px;
}

.sv-turn__reply code {
  font-family: var(--sve-mono);
  color: var(--sv-text);
}

.sv-turn__actions {
  display: flex;
  gap: 8px;
  padding-top: 2px;
}

.sv-compose {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  padding: 12px 14px;
  border-top: 1px solid var(--sve-edge);
}

.sv-compose__input {
  font-family: var(--sve-sans);
  font-size: 12px;
  color: inherit;
  background: var(--sve-slab);
  border: 1px solid var(--sve-edge);
  border-radius: 3px;
  padding: 8px 10px;
  resize: none;
  min-height: 38px;
}

.sv-compose__input:focus-visible {
  outline: 2px solid var(--sve-caret);
  outline-offset: 1px;
}

/* ── controls ────────────────────────────────────────────────────────────── */

.sv-button {
  font-family: var(--sve-sans);
  font-size: 12px;
  font-weight: 600;
  color: inherit;
  background: transparent;
  border: 1px solid var(--sve-edge);
  border-radius: 3px;
  padding: 7px 12px;
  cursor: pointer;
}

.sv-button--primary {
  color: var(--sve-ink);
  background: var(--sv-text);
  border-color: var(--sv-text);
}

.sv-button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.sv-button:focus-visible {
  outline: 2px solid var(--sve-caret);
  outline-offset: 2px;
}

/* ── connecting ──────────────────────────────────────────────────────────── */

.sv-connect {
  height: 100%;
  display: grid;
  align-content: center;
  justify-items: stretch;
  gap: 18px;
  max-width: 660px;
  margin: 0 auto;
  padding: 32px 24px;
}

.sv-connect__title {
  margin: 0;
  font-family: var(--sve-mono);
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.sv-connect__lede {
  margin: 0;
  color: var(--sv-dim);
}

.sv-connect__form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.sv-phase {
  font-family: var(--sve-mono);
  font-size: 12px;
  color: var(--sv-dim);
  display: flex;
  gap: 10px;
  align-items: center;
}

.sv-phase__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--sv-faint);
}

.sv-notice {
  border: 1px solid var(--sve-edge);
  border-left-width: 2px;
  border-radius: 3px;
  padding: 12px 14px;
  display: grid;
  gap: 6px;
}

.sv-notice__title {
  margin: 0;
  font-family: var(--sve-mono);
  font-size: 12px;
  font-weight: 700;
}

.sv-notice__body {
  margin: 0;
  font-size: 12px;
  color: var(--sv-dim);
}

.sv-notice--error {
  border-left-color: var(--sv-text);
  background: var(--sve-slab);
}

.sv-notice--warning {
  border-left-color: var(--sv-faint);
}

.sv-notice__command {
  font-family: var(--sve-mono);
  font-size: 12px;
  background: var(--sve-slab);
  border: 1px solid var(--sve-edge);
  border-radius: 3px;
  padding: 6px 8px;
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
  gap: 8px;
}

.sv-provider {
  display: grid;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--sve-edge);
  border-radius: 3px;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.sv-provider[aria-pressed='true'] {
  border-color: var(--sve-caret);
}

.sv-provider__label {
  font-family: var(--sve-mono);
  font-size: 12px;
}

.sv-provider__cost,
.sv-provider__summary {
  margin: 0;
  font-size: 11px;
  color: var(--sv-dim);
}

.sv-provider__missing {
  margin: 0;
  font-size: 11px;
  color: var(--sv-text);
}

.sv-providers__note {
  margin: 0;
  font-size: 11px;
  color: var(--sv-dim);
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
    cursor: row-resize;
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
}

@media (prefers-reduced-motion: reduce) {
  .sv-caret--travelling {
    color: var(--sve-caret);
    animation: none;
    opacity: 0.55;
  }
}
`;
