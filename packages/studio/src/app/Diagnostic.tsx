/**
 * The signature, moved out of the page it describes.
 *
 * `docs/design.md` §1 draws this: a coordinate headline, a paper strip carrying the real
 * bytes, and a caret under the exact column. It is the same picture as v1's inspector and
 * deliberately so — what changed is that the excerpt now arrives over `@sve/rpc` from the
 * frame, and the caret's `pad` is rendered verbatim rather than recomputed. AC-12.4 makes
 * the column exact, and the only way to keep it exact is not to do the arithmetic twice.
 *
 * It sits under the preview rather than beside it, because it is a statement about what is
 * selected *there*. The chat panel stays a transcript.
 */
import type { ReactElement } from 'react';
import { parseLoc, type EditStatus } from '@sve/protocol';
import type { InspectorState } from '@sve/rpc';
import { blastRadiusMessage, STYLE_FIELDS } from '@sve/overlay';
import { fieldStates } from '../client/fields.js';
import { APPLY_LABELS } from '../client/verdicts.js';

export interface DiagnosticProps {
  state: InspectorState | null;
  /** The live status of this element's newest change-log row, if it has one. */
  status: EditStatus | 'applying' | null;
  onText(value: string): void;
  onClass(value: string): void;
  onStyle(prop: string, value: string): void;
  onApply(): void;
}

function Excerpt({ state }: { state: InspectorState }): ReactElement {
  if (!state.excerpt) {
    return <p className="sv-empty">{state.sourceMessage}</p>;
  }

  return (
    <div className="sv-excerpt">
      <pre className="sv-excerpt__code">
        {state.excerpt.lines.map((line) => (
          <span key={line.number}>
            <span className="sv-excerpt__line" data-target={String(line.isTarget)}>
              <span className="sv-excerpt__no">{line.number}</span>
              <span className="sv-excerpt__text">{line.text}</span>
            </span>
            {line.isTarget ? (
              <span className="sv-excerpt__caret-row">
                <span className="sv-excerpt__no" />
                <span className="sv-excerpt__text">
                  {/* The pad is the target line's own leading text with everything but its
                      tabs blanked, so the marker sits under the column whatever the
                      indentation is made of. Rendered as given. */}
                  <span className="sv-caret-pad">{state.excerpt!.caret.pad}</span>
                  <span className="sv-caret">^</span>
                </span>
              </span>
            ) : null}
          </span>
        ))}
      </pre>
    </div>
  );
}

export function Diagnostic(props: DiagnosticProps): ReactElement {
  const { state } = props;

  if (!state || !state.anchor) {
    return (
      <section className="sv-diagnostic" aria-label="Selected element">
        <p className="sv-empty">
          Nothing selected. Click an element in the preview, or use the arrow keys once one
          is focused.
        </p>
      </section>
    );
  }

  const { anchor } = state;
  const fields = fieldStates(anchor);
  const blast = blastRadiusMessage(anchor.count);
  const applying = props.status === 'applying';
  // Parsed by the one function that knows a Windows drive letter is not a coordinate.
  const loc = parseLoc(anchor.loc);

  return (
    <section className="sv-diagnostic" aria-label="Selected element">
      <div className="sv-diagnostic__source">
        <p className="sv-label">Source</p>
        <header className="sv-coord">
          <span className="sv-coord__file">{loc?.file ?? anchor.loc}</span>
          <span className="sv-coord__pos">{loc ? `${loc.line}:${loc.col}` : ''}</span>
        </header>
        <Excerpt state={state} />
      </div>

      <div className="sv-fields">
        <p className="sv-label">Element</p>
        <div className="sv-field">
          <label className="sv-field__label" htmlFor="sv-field-text">
            text
          </label>
          <input
            id="sv-field-text"
            className="sv-field__input"
            type="text"
            spellCheck={false}
            value={state.textValue}
            disabled={fields.text.disabled}
            onChange={(event) => props.onText(event.target.value)}
          />
          {fields.text.reason === null ? null : (
            <p className="sv-field__reason">{fields.text.reason}</p>
          )}
        </div>

        <div className="sv-field">
          <label className="sv-field__label" htmlFor="sv-field-class">
            class
          </label>
          <input
            id="sv-field-class"
            className="sv-field__input"
            type="text"
            spellCheck={false}
            value={state.classValue}
            disabled={fields.class.disabled}
            onChange={(event) => props.onClass(event.target.value)}
          />
          {fields.class.reason === null ? null : (
            <p className="sv-field__reason">{fields.class.reason}</p>
          )}
        </div>

        {STYLE_FIELDS.map(([prop, label]) => (
          <div className="sv-field" key={prop}>
            <label className="sv-field__label" htmlFor={`sv-style-${prop}`}>
              {label}
            </label>
            <input
              id={`sv-style-${prop}`}
              className="sv-field__input"
              type="text"
              spellCheck={false}
              value={state.styleValues[prop] ?? ''}
              disabled={fields.style.disabled}
              onChange={(event) => props.onStyle(prop, event.target.value)}
            />
          </div>
        ))}

        {blast === null ? null : <p className="sv-blast">{blast}</p>}

        <button
          type="button"
          className="sv-button sv-button--primary"
          disabled={!state.canApply || applying}
          onClick={props.onApply}
        >
          {applying ? APPLY_LABELS.applying : APPLY_LABELS.idle}
        </button>
      </div>
    </section>
  );
}
