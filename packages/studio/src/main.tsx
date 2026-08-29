/**
 * The browser entry: build the controllers, hand them to React, and get out of the way.
 *
 * There is no wiring left in here. The one piece there was — joining a serving session to
 * a preview it cannot reach into — is `openSession`, in a module with no React in it,
 * because the order it has to do things in is behaviour and behaviour has to be assertable
 * in Node. This file decides *when*: the moment the session's URL is known, and never at
 * the frame, which does not exist yet and must not have to.
 */
import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createStudioApi } from './client/api.js';
import { createConnectController, type ConnectState } from './client/connect.js';
import { openSession } from './client/link.js';
import type { Workspace } from './client/workspace.js';
import type { ProviderId, ProviderSettings, ProviderView } from './providers.js';
import type { SessionSummary } from './session.js';
import { Studio } from './app/Studio.js';
import { STUDIO_CSS } from './app/theme.js';
import { useChanges } from './app/store.js';

function App(): React.ReactElement {
  const api = useRef(createStudioApi()).current;
  const connect = useRef(createConnectController({ transport: api })).current;
  useChanges(connect.subscribe);

  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [session, setSession] = useState<SessionSummary | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const frame = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    void api.providers().then(setProviders);
  }, [api]);

  const state: ConnectState = connect.state;
  useEffect(() => {
    if (state.kind === 'connected') setSession(state.session);
  }, [state]);

  /**
   * The session is serving, so the wire opens — before there is a frame, which is the only
   * order that works. `openSession` holds the whole of why.
   */
  useEffect(() => {
    if (!session) return undefined;

    const link = openSession({
      sessionId: session.id,
      sessionUrl: session.url,
      frame: () => frame.current,
      listenOn: window,
      apply: (id, intent) => api.apply(id, intent),
      revert: (id, jobId) => api.revert(id, jobId),
      plan: (request) => api.plan(request),
    });
    setWorkspace(link.workspace);

    return () => {
      setWorkspace(null);
      link.dispose();
    };
  }, [api, session]);

  /** The frame arrived, or left. Nothing else: the wire was opened before it existed. */
  const attach = useCallback((element: HTMLIFrameElement | null) => {
    frame.current = element;
  }, []);

  return (
    <Studio
      connect={connect}
      connectState={state}
      providers={providers}
      onSelectProvider={(id: ProviderId) => void api.selectProvider(id).then(setProviders)}
      onConfigureProvider={(id: ProviderId, settings: ProviderSettings) =>
        void api.configureProvider(id, settings).then(setProviders)
      }
      workspace={workspace}
      previewUrl={session?.url ?? null}
      frameRef={attach}
      // Reassigning `src` rather than reaching for `contentWindow.location`: the frame is
      // on the session's origin, and touching its `location` from here throws.
      onReconnect={() => {
        const element = frame.current;
        if (element) element.src = element.src;
      }}
    />
  );
}

const style = document.createElement('style');
style.textContent = STUDIO_CSS;
document.head.append(style);

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
