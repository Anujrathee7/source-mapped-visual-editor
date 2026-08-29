/**
 * The recap (AC-12.3).
 *
 * A row is a compiler summary line: a status mark, the coordinate, the tag, and the
 * verdict word in a fixed slot on the right. Under it, what was asked for, in the intent's
 * own resolved sentence. Under *that*, only when there is drift, the two sides — the same
 * shape v1's inspector used, because a difference is only useful when both halves are
 * legible at once.
 *
 * Nothing here moves when a verdict arrives. The verdict slot is wide enough for the
 * longest word the flow can print, the Revert control occupies its space whether or not it
 * is offered, and rows are keyed by id so React updates the node rather than replacing it.
 */
import type { ReactElement } from 'react';
import type { ChangeRow } from '../client/changes.js';
import { APPLY_LABELS } from '../client/verdicts.js';

export interface ChangesPanelProps {
  rows: ChangeRow[];
  selectedEid: string | null;
  onSelect(id: string): void;
  onRevert(id: string): void;
}

function Row({
  row,
  selected,
  onSelect,
  onRevert,
}: {
  row: ChangeRow;
  selected: boolean;
  onSelect(id: string): void;
  onRevert(id: string): void;
}): ReactElement {
  return (
    <li className="sv-row" data-status={row.status} data-selected={String(selected)}>
      <button type="button" className="sv-row__main" onClick={() => onSelect(row.id)}>
        <span className="sv-row__verdict-dot" aria-hidden="true" />
        <span className="sv-row__loc">{row.loc}</span>
        <span className="sv-row__verdict">{APPLY_LABELS[row.status]}</span>
      </button>

      <p className="sv-row__summary">
        <span className="sv-row__origin">{row.origin === 'chat' ? 'chat' : 'click'}</span>{' '}
        {row.summary}
      </p>

      {row.mismatch && row.mismatch.length > 0 ? (
        <dl className="sv-row__mismatch">
          {row.mismatch.map((entry) => (
            <div key={entry.prop}>
              <dt>{entry.prop}</dt>
              <dd>
                intent {entry.intent} · rendered {entry.rendered}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {row.message !== undefined && (row.mismatch ?? []).length === 0 ? (
        <p className="sv-row__summary">{row.message}</p>
      ) : null}

      <div className="sv-row__actions" data-offered={String(row.revertable)}>
        <button
          type="button"
          className="sv-button"
          disabled={!row.revertable}
          onClick={() => onRevert(row.id)}
        >
          Revert
        </button>
      </div>
    </li>
  );
}

export function ChangesPanel(props: ChangesPanelProps): ReactElement {
  return (
    <section className="sv-panel sv-changes" aria-label="Changes">
      <header className="sv-panel__head">
        <span>Changes</span>
        <span>{props.rows.length}</span>
      </header>
      <div className="sv-panel__body">
        {props.rows.length === 0 ? (
          <p className="sv-empty">
            Nothing applied yet. Every edit that reaches the file appears here with the
            verdict hot reload gave it.
          </p>
        ) : (
          <ul className="sv-log">
            {props.rows.map((row) => (
              <Row
                key={row.id}
                row={row}
                selected={row.eid === props.selectedEid}
                onSelect={props.onSelect}
                onRevert={props.onRevert}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
