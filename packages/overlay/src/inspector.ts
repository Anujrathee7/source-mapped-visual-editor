/**
 * The inspector: a compiler diagnostic, not a dev-tool panel (AC-4.6, AC-4.7, AC-4.8).
 *
 * docs/design.md §1 states three rules this file has to keep, and `test/inspector.test.ts`
 * enforces all three against the generated CSS rather than trusting them:
 *
 *  - `paper` is the single warm surface and belongs to the source excerpt alone;
 *  - the caret has its own colour and never doubles as a status;
 *  - `landed` and `drifted` appear nowhere but a verification result.
 *
 * It is built with plain DOM rather than React. The overlay lives in the page it is
 * editing, and shipping a second React runtime into that page — one whose renders would
 * interleave with the app's — is the opposite of "the overlay must not fight React"
 * (CLAUDE.md). There is no build step here either, so a `.tsx` file would also mean a JSX
 * runtime dependency for a panel with a dozen nodes in it.
 */
import type { EditStatus, Mismatch } from '@sve/protocol';
import { parseLoc } from '@sve/protocol';
import type { ClassKind, TextKind } from './attrs.js';
import type { Excerpt } from './excerpt.js';
import type { Anchor } from './selection.js';

/* ── copy ─────────────────────────────────────────────────────────────────── */

/** AC-4.7, verbatim. */
export const TEXT_EXPRESSION_REASON =
  'This text comes from an expression — edit the data, not the markup.';
export const TEXT_EMPTY_REASON = 'This element renders no text of its own — there is nothing to replace.';
export const CLASS_DYNAMIC_REASON =
  'This className is computed at runtime — use the style panel instead.';
export const CLASS_ABSENT_REASON =
  'This element has no className to rewrite — use the style panel instead.';

export interface ControlState {
  disabled: boolean;
  reason: string | null;
}

const LIVE: ControlState = { disabled: false, reason: null };

/**
 * A disabled control always says why. Silently ignoring input is a failed criterion, so
 * the reason is part of the state rather than something the renderer might forget.
 */
export function textFieldState(kind: TextKind): ControlState {
  if (kind === 'dynamic' || kind === 'mixed') return { disabled: true, reason: TEXT_EXPRESSION_REASON };
  if (kind === 'none') return { disabled: true, reason: TEXT_EMPTY_REASON };
  return LIVE;
}

export function classFieldState(kind: ClassKind): ControlState {
  if (kind === 'dynamic') return { disabled: true, reason: CLASS_DYNAMIC_REASON };
  if (kind === 'none') return { disabled: true, reason: CLASS_ABSENT_REASON };
  return LIVE;
}

/**
 * Always live. AC-4.7: a style override goes through the injected stylesheet and does not
 * require a literal `className` to edit, so a dynamic className disables the class editor
 * and nothing else.
 */
export function styleFieldState(_kind: ClassKind): ControlState {
  return LIVE;
}

/** AC-4.6, verbatim. */
export function blastRadiusMessage(count: number): string | null {
  if (count < 2) return null;
  return `${count} elements render from this line — the edit hits all ${count}.`;
}

export type ApplyPhase = 'idle' | 'applying';

/** One verb, carried through the flow: Apply -> Applying... -> Landed / Drifted / ... */
export const APPLY_LABELS: Readonly<Record<ApplyPhase | EditStatus, string>> = {
  idle: 'Apply',
  applying: 'Applying…',
  landed: 'Landed',
  drifted: 'Drifted',
  blocked: 'Blocked',
  stalled: 'Stalled',
  error: 'Error',
};

/** The style properties the panel exposes, as `TrackedProp` names. */
export const STYLE_FIELDS: ReadonlyArray<readonly [prop: string, label: string]> = [
  ['color', 'colour'],
  ['backgroundColor', 'background'],
  ['fontSize', 'size'],
];

/* ── chrome ───────────────────────────────────────────────────────────────── */

export const CHROME_CSS = `
:host {
  all: initial;
  display: block;

  --sve-ink: #0E1116;
  --sve-slab: #1A1F27;
  --sve-paper: #F7F4EC;
  --sve-caret: #3D7BFF;
  --sve-landed: #35C489;
  --sve-drifted: #E5484D;

  --sve-mono: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  --sve-sans: 'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif;
  --sve-edge: rgba(247, 244, 236, 0.12);
}

[hidden] {
  display: none !important;
}

.sve-layer {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  pointer-events: none;
  font-family: var(--sve-sans);
  color: #E7E9EC;
}

.sve-panel {
  position: absolute;
  right: 16px;
  bottom: 16px;
  width: min(380px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  overflow: auto;
  pointer-events: auto;
  background: var(--sve-ink);
  border: 1px solid var(--sve-edge);
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.5;
}

.sve-coord {
  font-family: var(--sve-mono);
  font-size: 13px;
  display: flex;
  gap: 12px;
  justify-content: space-between;
  align-items: baseline;
  padding: 12px 14px;
  border-bottom: 1px solid var(--sve-edge);
}

.sve-coord__file {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
}

.sve-coord__pos {
  flex: none;
  opacity: 0.72;
}

.sve-excerpt {
  background: var(--sve-paper);
  color: var(--sve-ink);
  font-family: var(--sve-mono);
  font-size: 12px;
  line-height: 1.6;
  padding: 10px 0;
  overflow-x: auto;
}

.sve-excerpt__code {
  margin: 0;
  white-space: pre;
  min-width: max-content;
}

.sve-excerpt__line,
.sve-excerpt__caret-row {
  display: flex;
  gap: 10px;
  padding: 0 14px;
}

.sve-excerpt__line[data-target] {
  background: rgba(61, 123, 255, 0.09);
}

.sve-excerpt__no {
  flex: none;
  width: 3ch;
  text-align: right;
  opacity: 0.45;
  user-select: none;
}

.sve-excerpt__text {
  white-space: pre;
}

.sve-caret,
.sve-caret-pad {
  color: var(--sve-caret);
  font-family: var(--sve-mono);
  font-weight: 700;
  white-space: pre;
}

.sve-caret--travelling {
  color: var(--sve-caret);
  display: inline-block;
  animation: sve-caret-travel 900ms ease-in-out infinite;
}

@keyframes sve-caret-travel {
  0% { transform: translateY(0); }
  50% { transform: translateY(4px); }
  100% { transform: translateY(0); }
}

.sve-fields {
  display: grid;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--sve-edge);
}

.sve-field {
  display: grid;
  gap: 4px;
  border: 0;
  margin: 0;
  padding: 0;
  min-width: 0;
}

.sve-field__label {
  font-size: 10px;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  opacity: 0.6;
  padding: 0;
}

.sve-field__input {
  font-family: var(--sve-mono);
  font-size: 12px;
  color: inherit;
  background: var(--sve-slab);
  border: 1px solid var(--sve-edge);
  border-radius: 3px;
  padding: 6px 8px;
  min-width: 0;
}

.sve-field__input:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.sve-field__input:focus-visible {
  outline: 2px solid var(--sve-caret);
  outline-offset: 1px;
}

.sve-field__reason:empty {
  display: none;
}

.sve-field__reason {
  margin: 0;
  font-size: 11px;
  opacity: 0.66;
}

.sve-style {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.sve-style__cell {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.sve-blast {
  margin: 0;
  padding: 10px 14px;
  border-bottom: 1px solid var(--sve-edge);
  font-size: 11px;
  opacity: 0.85;
}

.sve-actions {
  display: grid;
  gap: 10px;
  padding: 12px 14px;
}

.sve-apply {
  font-family: var(--sve-sans);
  font-size: 12px;
  font-weight: 600;
  color: var(--sve-ink);
  background: #E7E9EC;
  border: 0;
  border-radius: 3px;
  padding: 8px 12px;
  cursor: pointer;
}

.sve-apply:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.sve-apply:focus-visible {
  outline: 2px solid var(--sve-caret);
  outline-offset: 2px;
}

.sve-verdict {
  font-size: 11px;
  border-left: 2px solid currentColor;
  padding-left: 10px;
}

.sve-verdict[data-status='landed'] {
  color: var(--sve-landed);
}

.sve-verdict[data-status='drifted'],
.sve-verdict[data-status='error'] {
  color: var(--sve-drifted);
}

.sve-verdict__headline {
  font-weight: 700;
}

.sve-verdict__detail {
  color: #E7E9EC;
  font-family: var(--sve-mono);
  display: block;
  opacity: 0.8;
}

.sve-highlight {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  box-sizing: border-box;
}

.sve-highlight--hover {
  outline: 1px dashed var(--sve-caret);
}

.sve-highlight--selected {
  outline: 2px solid var(--sve-caret);
  outline-offset: 1px;
  box-shadow: 0 0 0 1px rgba(247, 244, 236, 0.9);
}

@media (prefers-reduced-motion: reduce) {
  .sve-caret--travelling {
    color: var(--sve-caret);
    animation: none;
    opacity: 0.55;
  }
}
`;

/* ── rendering ────────────────────────────────────────────────────────────── */

export interface Verdict {
  status: EditStatus;
  message?: string;
  mismatch?: Mismatch[];
  diff?: string;
}

export interface InspectorState {
  anchor: Anchor | null;
  excerpt: Excerpt | null;
  /** Shown on the paper strip when the source could not be read. */
  sourceMessage: string | null;
  textValue: string;
  classValue: string;
  styleValues: Record<string, string>;
  canApply: boolean;
  phase: ApplyPhase;
  verdict: Verdict | null;
}

export interface InspectorCallbacks {
  onText(value: string): void;
  onClass(value: string): void;
  onStyle(prop: string, value: string): void;
  onApply(): void;
}

export interface Inspector {
  readonly element: HTMLElement;
  render(state: InspectorState): void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className !== undefined) node.className = className;
  return node;
}

/** Never overwrite a field the user is typing into. */
function setValue(input: HTMLInputElement, value: string): void {
  if (input.value === value) return;
  const root = input.getRootNode();
  if (root instanceof ShadowRoot && root.activeElement === input) return;
  input.value = value;
}

export function createInspector(
  doc: Document,
  callbacks: InspectorCallbacks,
): Inspector {
  const panel = el(doc, 'aside', 'sve-panel');
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Source-mapped visual editor');
  panel.hidden = true;

  const coord = el(doc, 'header', 'sve-coord');
  const coordFile = el(doc, 'span', 'sve-coord__file');
  const coordPos = el(doc, 'span', 'sve-coord__pos');
  coord.append(coordFile, coordPos);

  const excerpt = el(doc, 'div', 'sve-excerpt');
  const excerptCode = el(doc, 'pre', 'sve-excerpt__code');
  excerpt.append(excerptCode);

  const fields = el(doc, 'div', 'sve-fields');

  const makeField = (
    name: 'text' | 'class',
    label: string,
  ): { wrap: HTMLElement; input: HTMLInputElement; reason: HTMLElement } => {
    const wrap = el(doc, 'div', 'sve-field');
    const labelEl = el(doc, 'label', 'sve-field__label');
    labelEl.htmlFor = `sve-field-${name}`;
    labelEl.textContent = label;
    const input = el(doc, 'input', 'sve-field__input');
    input.type = 'text';
    input.id = `sve-field-${name}`;
    input.dataset.sveField = name;
    input.spellcheck = false;
    const reason = el(doc, 'p', 'sve-field__reason');
    reason.dataset.sveReason = name;
    wrap.append(labelEl, input, reason);
    return { wrap, input, reason };
  };

  const text = makeField('text', 'text');
  const className = makeField('class', 'class');

  const styleWrap = el(doc, 'div', 'sve-field');
  const styleLabel = el(doc, 'span', 'sve-field__label');
  styleLabel.textContent = 'style';
  const styleGrid = el(doc, 'div', 'sve-style');
  const styleInputs = new Map<string, HTMLInputElement>();
  for (const [prop, label] of STYLE_FIELDS) {
    const cell = el(doc, 'div', 'sve-style__cell');
    const cellLabel = el(doc, 'label', 'sve-field__label');
    cellLabel.htmlFor = `sve-style-${prop}`;
    cellLabel.textContent = label;
    const input = el(doc, 'input', 'sve-field__input');
    input.type = 'text';
    input.id = `sve-style-${prop}`;
    input.dataset.sveStyle = prop;
    input.spellcheck = false;
    cell.append(cellLabel, input);
    styleGrid.append(cell);
    styleInputs.set(prop, input);
  }
  styleWrap.append(styleLabel, styleGrid);

  fields.append(text.wrap, className.wrap, styleWrap);

  const blast = el(doc, 'p', 'sve-blast');
  blast.hidden = true;

  const actions = el(doc, 'footer', 'sve-actions');
  const apply = el(doc, 'button', 'sve-apply');
  apply.type = 'button';
  apply.textContent = APPLY_LABELS.idle;
  const verdict = el(doc, 'div', 'sve-verdict');
  verdict.hidden = true;
  actions.append(apply, verdict);

  panel.append(coord, excerpt, fields, blast, actions);

  text.input.addEventListener('input', () => {
    if (text.input.disabled) return;
    callbacks.onText(text.input.value);
  });
  className.input.addEventListener('input', () => {
    if (className.input.disabled) return;
    callbacks.onClass(className.input.value);
  });
  for (const [prop, input] of styleInputs) {
    input.addEventListener('input', () => {
      if (input.disabled) return;
      callbacks.onStyle(prop, input.value);
    });
  }
  apply.addEventListener('click', () => callbacks.onApply());

  const renderExcerpt = (state: InspectorState): void => {
    excerptCode.textContent = '';
    if (!state.excerpt) {
      excerptCode.textContent = state.sourceMessage ?? '';
      return;
    }

    for (const line of state.excerpt.lines) {
      const row = el(doc, 'div', 'sve-excerpt__line');
      if (line.isTarget) row.dataset.target = '';
      const number = el(doc, 'span', 'sve-excerpt__no');
      number.textContent = String(line.number);
      const body = el(doc, 'span', 'sve-excerpt__text');
      body.textContent = line.text;
      row.append(number, body);
      excerptCode.append(row);

      if (!line.isTarget) continue;

      // The signature. The pad is the target line's own leading text with everything but
      // its tabs blanked, so the marker sits under the column in a monospace row whatever
      // the indentation is made of.
      // Its own class, not `sve-excerpt__line`: the caret row carries no line number, and
      // counting it among the numbered lines would misreport the excerpt's extent.
      const caretRow = el(doc, 'div', 'sve-excerpt__caret-row');
      const caretGutter = el(doc, 'span', 'sve-excerpt__no');
      caretGutter.textContent = '';
      const caretBody = el(doc, 'span', 'sve-excerpt__text');
      const pad = el(doc, 'span', 'sve-caret-pad');
      pad.textContent = state.excerpt.caret.pad;
      const marker = el(doc, 'span', 'sve-caret');
      marker.textContent = '^';
      // Motion is spent once, and only here (docs/design.md §1).
      marker.classList.toggle('sve-caret--travelling', state.phase === 'applying');
      caretBody.append(pad, marker);
      caretRow.append(caretGutter, caretBody);
      excerptCode.append(caretRow);
    }
  };

  const renderVerdict = (state: InspectorState): void => {
    verdict.textContent = '';
    if (!state.verdict) {
      verdict.hidden = true;
      verdict.removeAttribute('data-status');
      return;
    }

    verdict.hidden = false;
    verdict.dataset.status = state.verdict.status;
    const headline = el(doc, 'span', 'sve-verdict__headline');
    headline.textContent = `${APPLY_LABELS[state.verdict.status]}.`;
    verdict.append(headline);

    if (state.verdict.message !== undefined) {
      const message = el(doc, 'span', 'sve-verdict__detail');
      message.textContent = state.verdict.message;
      verdict.append(message);
    }
    // Both sides, always: AC-5.2 turns on the difference being visible, not merely known.
    for (const mismatch of state.verdict.mismatch ?? []) {
      const line = el(doc, 'span', 'sve-verdict__detail');
      line.textContent = `${mismatch.prop} · intent ${mismatch.intent} · rendered ${mismatch.rendered}`;
      verdict.append(line);
    }
  };

  return {
    element: panel,

    render(state) {
      panel.hidden = state.anchor === null;
      if (!state.anchor) return;

      const loc = parseLoc(state.anchor.loc);
      coordFile.textContent = loc?.file ?? state.anchor.loc;
      coordPos.textContent = loc ? `${loc.line}:${loc.col}` : '';

      renderExcerpt(state);

      const textState = textFieldState(state.anchor.textKind);
      text.input.disabled = textState.disabled;
      text.reason.textContent = textState.reason ?? '';
      setValue(text.input, state.textValue);

      const classState = classFieldState(state.anchor.classKind);
      className.input.disabled = classState.disabled;
      className.reason.textContent = classState.reason ?? '';
      setValue(className.input, state.classValue);

      const styleState = styleFieldState(state.anchor.classKind);
      for (const [prop, input] of styleInputs) {
        input.disabled = styleState.disabled;
        setValue(input, state.styleValues[prop] ?? '');
      }

      const message = blastRadiusMessage(state.anchor.count);
      blast.hidden = message === null;
      blast.textContent = message ?? '';

      apply.disabled = !state.canApply;
      apply.textContent =
        state.phase === 'applying'
          ? APPLY_LABELS.applying
          : state.verdict
            ? APPLY_LABELS[state.verdict.status]
            : APPLY_LABELS.idle;

      renderVerdict(state);
    },
  };
}
