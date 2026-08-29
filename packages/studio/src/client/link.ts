/**
 * A serving session, joined to the studio.
 *
 * One function, and its whole reason for existing is the *order*. The framed document
 * announces its boot the instant it evaluates, so the client has to be subscribed before
 * the iframe is given a window to post into — `connectPreview` says exactly that — and the
 * workspace is what makes `Studio` render the panel that mounts the iframe in the first
 * place. Building the link from the frame's ref callback therefore both missed the
 * handshake and deadlocked: no workspace until the frame mounts, no frame until there is a
 * workspace.
 *
 * So the frame is *looked up* per post rather than captured. It appears after this,
 * disappears whenever React unmounts the panel, and neither event is one the wire should
 * have to care about.
 *
 * Out of `main.tsx` and into a module with no React in it, for the reason every other
 * controller here is: this is behaviour, and behaviour has to be assertable in Node.
 */
import type { EditIntent, EditResult } from '@sve/protocol';
import {
  createWindowTransport,
  type MessageSource,
  type PostTarget,
  type RpcDiagnostic,
} from '@sve/rpc';
import type { PlanRequest, PlanResult } from '../plan.js';
import { connectPreview, type PreviewController } from './preview.js';
import { createWorkspace, type Workspace } from './workspace.js';

/** The iframe, as much of it as this needs: a window to post into, once there is one. */
export interface FrameHost {
  readonly contentWindow: PostTarget | null;
}

export interface SessionLinkOptions {
  sessionId: string;
  /** The session's URL. Its origin is the peer's — named, and never inferred. */
  sessionUrl: string;
  /** The preview frame right now, or null. Called on every post, never held. */
  frame(): FrameHost | null;
  /** The window whose `message` events are the studio's. Injected, not reached for. */
  listenOn: MessageSource;
  apply(sessionId: string, intent: EditIntent): Promise<EditResult>;
  revert(sessionId: string, jobId: string): Promise<EditResult>;
  plan(request: PlanRequest): Promise<PlanResult>;
  onDiagnostic?(diagnostic: RpcDiagnostic): void;
}

export interface SessionLink {
  readonly workspace: Workspace;
  readonly preview: PreviewController;
  dispose(): void;
}

export function openSession(options: SessionLinkOptions): SessionLink {
  const origin = new URL(options.sessionUrl).origin;

  const link = connectPreview({
    transport: createWindowTransport({
      // A post into a frame that is not there yet, or not there any more, is dropped. The
      // studio's own deadline is what turns a preview that never arrives into a state with
      // words in it; silently queueing would only make that deadline lie.
      target: {
        postMessage: (data, targetOrigin) =>
          options.frame()?.contentWindow?.postMessage(data, targetOrigin),
      },
      targetOrigin: origin,
      listenOn: options.listenOn,
    }),
    peerOrigin: origin,
    // `peerSource` is deliberately absent: the studio does not hold the frame's
    // `contentWindow` until it has loaded, and `@sve/rpc` is explicit that while the window
    // is unknown the origin check stands alone. Adopting a window later would mean
    // adopting whichever one had posted, which is the inference this project refuses.
    ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
  });

  const workspace = createWorkspace({
    preview: link.controller,
    apply: (intent) => options.apply(options.sessionId, intent),
    revert: (jobId) => options.revert(options.sessionId, jobId),
    planner: { name: 'host', plan: (request) => options.plan(request) },
  });

  return {
    workspace,
    preview: link.controller,
    dispose() {
      workspace.dispose();
      link.dispose();
    },
  };
}
