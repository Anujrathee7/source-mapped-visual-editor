/**
 * The browser entry: build the controllers, hand them to React, and get out of the way.
 *
 * The one piece of real wiring is the preview link. `connectPreview` has to exist before
 * the iframe's document announces itself — a `ready` posted at a window nobody is
 * listening on is a handshake nobody completes — so the client is built the moment the
 * session's URL is known and the frame is given a `src` afterwards.
 */
import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createWindowTransport } from '@sve/rpc';
import { createStudioApi } from './client/api.js';
import { createConnectController, type ConnectState } from './client/connect.js';
import { connectPreview } from './client/preview.js';
import { createWorkspace, type Workspace } from './client/workspace.js';
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
   * The frame arrived. Its origin is the session's, named rather than inferred, and the
   * transport listens on this window for messages carrying that origin and that source.
   */
  const attach = useCallback(
    (element: HTMLIFrameElement | null) => {
      frame.current = element;
      if (!element || !session) return;
      const peer = element.contentWindow;
      if (!peer) return;

      const link = connectPreview({
        transport: createWindowTransport({
          target: peer,
          targetOrigin: new URL(session.url).origin,
          listenOn: window,
        }),
        peerOrigin: new URL(session.url).origin,
        peerSource: peer,
      });

      setWorkspace(
        createWorkspace({
          preview: link.controller,
          apply: (intent) => api.apply(session.id, intent),
          revert: (jobId) => api.revert(session.id, jobId),
          planner: { name: 'host', plan: (request) => api.plan(request) },
        }),
      );
    },
    [api, session],
  );

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
      onReconnect={() => frame.current?.contentWindow?.location.reload()}
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
