/**
 * The chat, as a transcript rather than a conversation (AC-12.1, AC-12.6).
 *
 * No bubbles, no avatars, no alternating sides, no accent gradient. The request is a
 * prompt line marked with a caret-blue `›` — the same pointer role the caret has — and the
 * reply is the answer written under it. That is the shape the rest of this product already
 * has, and a chat product's furniture here would be furniture from somewhere else.
 *
 * A proposal carries its own two controls. Apply is the same word and the same button the
 * panel under the preview uses, because it is the same act: a proposal that reaches the
 * file does so through the loop, and there is nothing in this panel that could avoid it.
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import type { ChatTurn } from '../client/chat.js';
import { APPLY_LABELS } from '../client/verdicts.js';

export interface ChatPanelProps {
  turns: ChatTurn[];
  busy: boolean;
  onSend(message: string): void;
  onAccept(turnId: string): void;
  onDiscard(turnId: string): void;
}

function Turn({
  turn,
  onAccept,
  onDiscard,
}: {
  turn: ChatTurn;
  onAccept(id: string): void;
  onDiscard(id: string): void;
}): ReactElement {
  return (
    <li className="sv-turn" data-state={turn.state}>
      <p className="sv-turn__request">
        <span className="sv-turn__marker" aria-hidden="true">
          ›
        </span>
        <span>{turn.request}</span>
      </p>

      <p className="sv-turn__reply">
        {turn.state === 'thinking' ? 'Resolving that to an element and a change…' : turn.reply}
      </p>

      {turn.state === 'proposed' ? (
        <div className="sv-turn__actions">
          <button
            type="button"
            className="sv-button sv-button--primary"
            onClick={() => onAccept(turn.id)}
          >
            {APPLY_LABELS.idle}
          </button>
          <button type="button" className="sv-button" onClick={() => onDiscard(turn.id)}>
            Discard
          </button>
        </div>
      ) : null}

      {turn.state === 'applying' ? <p className="sv-turn__reply">{APPLY_LABELS.applying}</p> : null}
      {turn.error === undefined ? null : <p className="sv-turn__reply">{turn.error}</p>}
    </li>
  );
}

export function ChatPanel(props: ChatPanelProps): ReactElement {
  const [draft, setDraft] = useState('');

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const message = draft.trim();
    if (message === '') return;
    setDraft('');
    props.onSend(message);
  };

  return (
    <section className="sv-panel sv-chat" aria-label="Agent chat">
      <header className="sv-panel__head">
        <span>Agent</span>
      </header>

      <div className="sv-panel__body">
        {props.turns.length === 0 ? (
          <p className="sv-empty">
            Ask for a change to the element you have selected. Whatever comes back is an
            override on the page first — nothing is written until you press Apply.
          </p>
        ) : (
          <ul className="sv-transcript">
            {props.turns.map((turn) => (
              <Turn key={turn.id} turn={turn} onAccept={props.onAccept} onDiscard={props.onDiscard} />
            ))}
          </ul>
        )}
      </div>

      <form className="sv-compose" onSubmit={submit}>
        <label className="sv-field__label" htmlFor="sv-compose" hidden>
          Ask for a change
        </label>
        <textarea
          id="sv-compose"
          className="sv-compose__input"
          value={draft}
          rows={2}
          placeholder="set the text to “Ship faster”"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter is a newline. A textarea rather than an input
            // because a request can be a sentence and a scrolling one-line field is worse.
            if (event.key === 'Enter' && !event.shiftKey) submit(event);
          }}
        />
        <button type="submit" className="sv-button" disabled={props.busy || draft.trim() === ''}>
          Send
        </button>
      </form>
    </section>
  );
}
