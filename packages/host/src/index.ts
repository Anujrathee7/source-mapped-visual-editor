/**
 * `@sve/host` — the Node side of v2.
 *
 * Node-only, like `@sve/bridge`: it starts dev servers, spawns `git`, and hands the bridge
 * file-write capability. Nothing here may be imported from browser code.
 *
 * The surface is deliberately small and deliberately typed — connect, status, close — so
 * that the E2E suite drives it directly and the studio in M14 is a client of this rather
 * than a prerequisite for testing it (AC-11.8).
 */
export {
  createHost,
  DEFAULT_PORT_BASE,
  type AgentContextForSession,
  type ConnectFailure,
  type ConnectFolderRequest,
  type ConnectRepositoryRequest,
  type ConnectRequest,
  type ConnectResult,
  type Host,
  type HostOptions,
} from './host.js';

export {
  detectProject,
  EDIT_ROOT_CANDIDATES,
  REACT_FIELDS,
  VITE_CONFIG_FILES,
  type DetectedProject,
  type DetectOptions,
  type ProjectDetection,
  type ProjectRefusal,
  type RefusalReason,
} from './detect.js';

export {
  cloneRepository,
  parseRepositoryUrl,
  spawnCommand,
  spawnGit,
  workspaceDirectoryFor,
  type CloneFailure,
  type CloneOptions,
  type CloneOutcome,
  type CommandResult,
  type CommandRunner,
  type GitRunner,
  type Repository,
} from './clone.js';

export {
  confirmRequest,
  denyByDefault,
  type HostConfirm,
  type HostConfirmKind,
  type HostConfirmRequest,
} from './confirm.js';

export {
  startSession,
  type HostDiagnostic,
  type HostSession,
  type SessionSource,
  type SessionStatus,
  type StampingReport,
  type StartSessionOptions,
} from './session.js';

export { probeProject, type ProbeResult } from './probe.js';
