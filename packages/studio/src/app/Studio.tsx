/**
 * The workspace: changes left, preview centre, chat right.
 *
 * Everything is a prop. The controllers this renders are plain objects with `subscribe`
 * and methods, built outside React, which is what lets the loop, the log and the chat be
 * asserted in Node against a real overlay behind a real wire — and lets this file be about
 * arrangement rather than about behaviour.
 *
 * The one piece of logic here is `statusFor`: the phase and verdict of the selected
 * element are read out of the change log rather than stored a second time. The log already
 * knows — it opened the row — and a second copy would be the one that goes stale.
 */
import { useMemo, type ReactElement } from 'react';
import type { EditStatus } from '@sve/protocol';
import type { ProviderId, ProviderSettings, ProviderView } from '../providers.js';
import type { ConnectController, ConnectState } from '../client/connect.js';
import type { Workspace } from '../client/workspace.js';
import { setClasses, setStyle, setText } from '../client/edits.js';
import { ChangesPanel } from './ChangesPanel.js';
import { ChatPanel } from './ChatPanel.js';
import { ConnectView } from './ConnectView.js';
import { Diagnostic } from './Diagnostic.js';
import { PreviewPanel } from './PreviewPanel.js';
import { Splitter } from './Splitter.js';
import { useChanges } from './store.js';

export interface StudioProps {
  connect: ConnectController;
  connectState: ConnectState;
  providers: ProviderView[];
  onSelectProvider(id: ProviderId): void;
  onConfigureProvider(id: ProviderId, settings: ProviderSettings): void;
  /** Present once a session is serving and the preview has something to show. */
  workspace: Workspace | null;
  previewUrl: string | null;
  frameRef?: (frame: HTMLIFrameElement | null) => void;
  onReconnect(): void;
}

export function Studio(props: StudioProps): ReactElement {
  const { workspace } = props;
  // Subscribed unconditionally so the hook order never depends on the branch below.
  const noop = useMemo(() => () => () => undefined, []);
  useChanges(workspace?.subscribe ?? noop);

  if (!workspace || props.previewUrl === null) {
    return (
      <ConnectView
        state={props.connectState}
        controller={props.connect}
        providers={props.providers}
        onSelectProvider={props.onSelectProvider}
        onConfigureProvider={props.onConfigureProvider}
      />
    );
  }

  const state = workspace.preview.state;
  const anchor = state?.anchor ?? null;
  const rows = workspace.log.rows();
  // Newest first, so the first row for this element is the live one.
  const current = anchor ? rows.find((row) => row.eid === anchor.eid) : undefined;
  const status: EditStatus | 'applying' | null = current?.status ?? null;
  const busy = rows.some((row) => row.status === 'applying');

  return (
    <div className="sv-shell">
      <ChangesPanel
        rows={rows}
        selectedEid={anchor?.eid ?? null}
        onSelect={(id) => void workspace.selectRow(id)}
        onRevert={(id) => void workspace.revertRow(id)}
      />

      <Splitter variable="--sv-changes" label="Resize the changes panel" min={220} max={460} grows />

      <PreviewPanel
        url={props.previewUrl}
        status={workspace.preview.status}
        lastError={workspace.preview.lastError}
        {...(props.frameRef === undefined ? {} : { frameRef: props.frameRef })}
        onReconnect={props.onReconnect}
      >
        <Diagnostic
          state={state}
          status={status}
          onText={(value) => {
            if (anchor) void setText(workspace.preview, anchor, value);
          }}
          onClass={(value) => {
            if (anchor) void setClasses(workspace.preview, anchor, value);
          }}
          onStyle={(prop, value) => {
            if (anchor) void setStyle(workspace.preview, anchor, prop, value);
          }}
          onApply={() => void workspace.applySelection()}
        />
      </PreviewPanel>

      <Splitter
        variable="--sv-chat"
        label="Resize the agent panel"
        min={280}
        max={560}
        grows={false}
      />

      <ChatPanel
        turns={workspace.chat.turns()}
        busy={busy}
        onSend={(message) => void workspace.chat.send(message)}
        onAccept={(id) => void workspace.chat.accept(id)}
        onDiscard={(id) => void workspace.chat.discard(id)}
      />
    </div>
  );
}
