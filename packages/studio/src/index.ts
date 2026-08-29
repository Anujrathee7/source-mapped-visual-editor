/**
 * `@sve/studio` — the workspace.
 *
 * This entry is the *Node* half: it reaches `@sve/host` and `@sve/bridge`, both of which
 * hold file-write capability. The browser half is reached through `./src/main.tsx`, which
 * Vite serves, and `./preview`, which is served into the page being edited. Neither is
 * re-exported from here — importing this module from page code would pull the filesystem
 * into the browser bundle.
 */
export {
  API,
  API_BASE,
  ApplyBodySchema,
  ConfigureProviderBodySchema,
  ConfirmBodySchema,
  ConnectBodySchema,
  PlanBodySchema,
  RevertBodySchema,
  SelectProviderBodySchema,
} from './api.js';

export {
  PROVIDERS,
  PROVIDER_IDS,
  VERIFIER_NOTE,
  providerInfo,
  type ProviderField,
  type ProviderId,
  type ProviderInfo,
  type ProviderSettings,
  type ProviderView,
  type SettingKey,
} from './providers.js';

export {
  CONNECT_PHASES,
  isRepositoryRequest,
  targetOf,
  type ConnectEvent,
  type ConnectOutcome,
  type ConnectPhase,
  type ConnectRequestBody,
  type SessionSummary,
} from './session.js';

export {
  UNRESOLVED_REPLY,
  proposalReply,
  unknownTargetReply,
  type PlanRequest,
  type PlanResult,
  type PlanTarget,
  type Planner,
  type Proposal,
} from './plan.js';

export { createFakePlanner } from './host/planner-fake.js';
export {
  PLAN_SYSTEM_PROMPT,
  parsePlanReply,
  planPrompt,
} from './host/plan-prompt.js';
export { createOpenAiPlanner } from './host/planner-openai.js';
export {
  ANTHROPIC_MESSAGES_URL,
  ANTHROPIC_VERSION,
  createClaudePlanner,
} from './host/planner-claude.js';
export {
  createProviderStore,
  envFor,
  missingSettingFor,
  runnerFor,
  type ProviderStore,
} from './host/providers.js';
export {
  APPLY_PATH,
  DEFAULT_CONFIRM_TIMEOUT_MS,
  REVERT_PATH,
  SOURCE_PATH,
  createStudioService,
  type PendingConfirmation,
  type StudioService,
  type StudioServiceOptions,
} from './host/service.js';
export {
  MAX_BODY_BYTES,
  createStudioMiddleware,
  sveStudio,
  type StudioMiddleware,
  type StudioPluginLike,
} from './host/middleware.js';
