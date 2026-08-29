/**
 * The preview, and as little else as possible (AC-12.4, AC-12.6).
 *
 * This is the one place the user's own design appears, so the chrome around it is a single
 * thin bar carrying the URL and, when it matters, the way back. No toolbar, no device
 * frame, no zoom control: anything added here competes with the thing it is framing.
 *
 * The frame is on another origin and everything crossing to it goes over `@sve/rpc`, which
 * rejects rather than waits — so a preview that navigated, crashed, or was stopped is a
 * state with a sentence and a button, never a spinner that never ends.
 */
import type { ReactElement, ReactNode } from 'react';
import type { PreviewStatus } from '../client/preview.js';

export interface PreviewPanelProps {
  url: string;
  status: PreviewStatus;
  lastError: string | null;
  frameRef?: (frame: HTMLIFrameElement | null) => void;
  onReconnect(): void;
  /** The diagnostic strip. It belongs to the preview: it is about what is selected there. */
  children?: ReactNode;
}

export function PreviewPanel(props: PreviewPanelProps): ReactElement {
  const lost = props.status === 'disconnected';

  return (
    <section className="sv-panel sv-preview" aria-label="Preview">
      <div className="sv-preview__bar">
        <span className="sv-preview__url">{props.url}</span>
        <span>{props.status === 'connected' ? 'connected' : props.status}</span>
      </div>

      <div className="sv-preview__stage">
        <iframe
          className="sv-preview__frame"
          title="The project under edit"
          src={props.url}
          ref={props.frameRef}
        />
        {lost ? (
          <div className="sv-preview__lost" role="alert">
            <p className="sv-notice__title">The preview is no longer connected.</p>
            <p className="sv-notice__body">
              {props.lastError ??
                'The page navigated, reloaded, or the dev server stopped. Nothing was lost — the change log is session state.'}
            </p>
            <button type="button" className="sv-button" onClick={props.onReconnect}>
              Reconnect
            </button>
          </div>
        ) : null}
      </div>

      {props.children}
    </section>
  );
}
