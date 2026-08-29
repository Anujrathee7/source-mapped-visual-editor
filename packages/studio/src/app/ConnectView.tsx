/**
 * Connecting (AC-12.2).
 *
 * Every branch here is a state with words in it. While it is working, the phase is named,
 * because "cloning" and "installing" are minutes apart and a spinner says neither. A
 * refusal is printed as the host wrote it — that sentence already names what was looked
 * for and where, and replacing it with "could not connect" throws away the only actionable
 * part. And `no-elements-stamped` stands in front of the workspace rather than beside it:
 * an editor that loads and then does nothing when clicked is the failure most easily
 * mistaken for a broken product.
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import type { ConnectController, ConnectState } from '../client/connect.js';
import type { ProviderId, ProviderSettings, ProviderView } from '../providers.js';
import type { ThemeController } from '../client/theme.js';
import { ProviderPicker } from './ProviderPicker.js';
import { ThemeToggle } from './ThemeToggle.js';

export interface ConnectViewProps {
  state: ConnectState;
  controller: ConnectController;
  providers: ProviderView[];
  onSelectProvider(id: ProviderId): void;
  onConfigureProvider(id: ProviderId, settings: ProviderSettings): void;
  theme: ThemeController;
}

const PHASE_WORDS: Record<string, string> = {
  cloning: 'Cloning the repository…',
  confirming: 'Waiting for you to confirm what will run…',
  installing: 'Installing dependencies…',
  detecting: 'Looking for a Vite + React project…',
  starting: 'Starting the dev server…',
};

export function ConnectView(props: ConnectViewProps): ReactElement {
  const [target, setTarget] = useState('');
  const [install, setInstall] = useState(false);
  const { state } = props;

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const value = target.trim();
    if (value === '') return;
    // A path or a URL, told apart the way a person would: a repository has a host or an
    // `owner/name`, a folder does not.
    const isRepository = /^(?:https?:\/\/|git@)/.test(value) || /^[\w.-]+\/[\w.-]+$/.test(value);
    void props.controller.connect(
      isRepository ? { repository: value, install } : { folder: value },
    );
  };

  return (
    <main className="sv-connect">
      <div className="sv-connect__card">
        <div className="sv-connect__head">
          <h1 className="sv-connect__title">Source-mapped visual editor</h1>
          <ThemeToggle theme={props.theme} />
        </div>
        <p className="sv-connect__lede">
          Open a Vite + React project. Nothing is written to it by connecting, and nothing is
          written by editing until a change has been applied and verified.
        </p>

        <form className="sv-connect__form" onSubmit={submit}>
          <input
            className="sv-field__input"
            aria-label="Folder path or repository URL"
            placeholder="/path/to/project  ·  owner/name  ·  https://github.com/owner/name"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          />
          <button type="submit" className="sv-button sv-button--primary">
            Connect
          </button>
        </form>

        <label className="sv-providers__note">
          <input
            type="checkbox"
            checked={install}
            onChange={(event) => setInstall(event.target.checked)}
          />{' '}
          Install dependencies for a cloned repository. You will be asked again, with the
          command, before anything runs.
        </label>

        {state.kind === 'connecting' ? (
          <p className="sv-phase" role="status">
            <span className="sv-phase__dot" aria-hidden="true" />
            {PHASE_WORDS[state.phase] ?? state.phase}
            {state.detail === undefined ? null : <span> {state.detail}</span>}
          </p>
        ) : null}

        {state.kind === 'confirming' ? (
          <div className="sv-notice sv-notice--error" role="alertdialog" aria-label="Confirm">
            <p className="sv-notice__title">{state.request.message}</p>
            <pre className="sv-notice__command">{state.request.command}</pre>
            <p className="sv-notice__body">in {state.request.directory}</p>
            <div className="sv-notice__actions">
              {props.controller.confirmations().map((pending) => (
                <span key={pending.id} className="sv-notice__actions">
                  {/* Cancel first, and it is the plain button: the default answer is no. */}
                  <button
                    type="button"
                    className="sv-button"
                    onClick={() => void props.controller.answer(pending.id, false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="sv-button sv-button--primary"
                    onClick={() => void props.controller.answer(pending.id, true)}
                  >
                    Run it
                  </button>
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {state.kind === 'refused' ? (
          <div className="sv-notice sv-notice--error" role="alert">
            <p className="sv-notice__title">{state.target} was not opened.</p>
            <p className="sv-notice__body">{state.message}</p>
          </div>
        ) : null}

        {state.kind === 'blocked' ? (
          <div className="sv-notice sv-notice--error" role="alert">
            <p className="sv-notice__title">Nothing in this project can be selected.</p>
            <p className="sv-notice__body">{state.diagnostic.message}</p>
          </div>
        ) : null}

        <ProviderPicker
          providers={props.providers}
          onSelect={props.onSelectProvider}
          onConfigure={props.onConfigureProvider}
        />
      </div>
    </main>
  );
}
