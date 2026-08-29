/**
 * The provider picker (AC-12.5).
 *
 * Three things are on the card and all three are load-bearing: what it is, what it costs,
 * and — if it is not usable yet — the sentence naming the setting that is missing. The
 * paragraph under the list is the one that keeps the picker honest: a price list implies
 * the options are interchangeable, and the reason a cheap one is a reasonable trade is
 * that the verifier catches what it gets wrong.
 *
 * A key field is write-only. It posts and is cleared; nothing ever reads one back, because
 * nothing on this side of the wire has one to read.
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import {
  VERIFIER_NOTE,
  type ProviderId,
  type ProviderSettings,
  type ProviderView,
} from '../providers.js';

export interface ProviderPickerProps {
  providers: ProviderView[];
  onSelect(id: ProviderId): void;
  onConfigure(id: ProviderId, settings: ProviderSettings): void;
}

export function ProviderPicker(props: ProviderPickerProps): ReactElement {
  const [draft, setDraft] = useState<ProviderSettings>({});
  const selected = props.providers.find((provider) => provider.selected);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!selected) return;
    props.onConfigure(selected.id, draft);
    // Cleared immediately: a key that stayed in a controlled input would be a key living
    // in the page for the rest of the session.
    setDraft({});
  };

  return (
    <section className="sv-connect__section" aria-label="Coding agent">
      <p className="sv-label">Coding agent</p>

      <div className="sv-providers">
        {props.providers.map((provider) => (
          <button
            key={provider.id}
            type="button"
            className="sv-provider"
            aria-pressed={provider.selected}
            onClick={() => props.onSelect(provider.id)}
          >
            <span className="sv-provider__label">{provider.label}</span>
            <p className="sv-provider__summary">{provider.summary}</p>
            <p className="sv-provider__cost">{provider.cost}</p>
            {provider.missing === null ? null : (
              <p className="sv-provider__missing">{provider.missing}</p>
            )}
          </button>
        ))}
      </div>

      <p className="sv-providers__note">{VERIFIER_NOTE}</p>

      {selected && selected.fields.length > 0 ? (
        <form className="sv-providers" onSubmit={submit}>
          {selected.fields.map((field) => (
            <div className="sv-field" key={field.key}>
              <label className="sv-field__label" htmlFor={`sv-setting-${field.key}`}>
                {field.label}
              </label>
              <input
                id={`sv-setting-${field.key}`}
                className="sv-field__input"
                type={field.secret ? 'password' : 'text'}
                autoComplete="off"
                placeholder={field.placeholder}
                value={draft[field.key] ?? ''}
                onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
              />
            </div>
          ))}
          <button type="submit" className="sv-button">
            Save to this host
          </button>
        </form>
      ) : null}
    </section>
  );
}
