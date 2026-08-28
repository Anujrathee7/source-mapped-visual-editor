/**
 * `@sve/bridge` — the Node side of the editor.
 *
 * It receives edit intents from an untrusted browser, snapshots what it is
 * about to touch, runs a coding agent against the exact stamped line, and
 * streams progress back. It holds file-write capability, so it must never be
 * imported by browser code: mount it through Vite's `configureServer`.
 */
export { createBridge, type Bridge, type BridgeOptions } from './bridge.js';
export { lineDiff } from './diff.js';
export { nodeFs, type BridgeFs, type FileStats } from './fs.js';
export { denialMessage, isInsideEditRoots } from './guard.js';
export {
  createBridgeMiddleware,
  sveBridge,
  DEFAULT_MAX_BODY_BYTES,
  SVE_APPLY_PATH,
  SVE_BASE_PATH,
  SVE_EVENTS_PATH,
  SVE_REVERT_PATH,
  type BridgeMiddleware,
  type BridgeMiddlewareOptions,
  type ConnectHandle,
  type ConnectNext,
  type VitePluginLike,
  type ViteDevServerLike,
} from './middleware.js';
export { ProgressHub, type ProgressListener } from './progress.js';
export { buildPrompt, PROMPT_CONTEXT_LINES, type BuildPromptArgs } from './prompt.js';
export { SerialQueue } from './queue.js';
export {
  SnapshotStore,
  type RevertResult,
  type SnapshotEntry,
  type SnapshotRecord,
} from './snapshot.js';
export { joinLines, splitLines, type SourceLine } from './source.js';

export {
  agentRunnerNames,
  createFakeAgent,
  DEFAULT_AGENT,
  FAKE_MODES,
  isFakeMode,
  registerAgentRunner,
  resolveAgentRunner,
  type AgentBlocked,
  type AgentContext,
  type AgentEdited,
  type AgentEnv,
  type AgentNoop,
  type AgentOutcome,
  type AgentProgress,
  type AgentRunner,
  type AgentRunnerFactory,
  type AgentRunnerOptions,
  type AgentToolRequest,
  type FakeAgentOptions,
  type FakeMode,
  type ToolPermission,
} from './agent/index.js';
export { blocked, BLOCKED_PREFIX } from './agent/types.js';
