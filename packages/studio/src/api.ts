/**
 * The studio's own wire, and the same discipline as every other one here.
 *
 * The browser is untrusted input to a process that starts dev servers, spawns `git` and
 * holds API keys, so every body crossing into `src/host/` is parsed by a schema before
 * anything else looks at it. `EditIntentSchema` is imported rather than restated — the
 * bridge is going to parse it again on the far side, and two spellings of an intent is one
 * more than this project has room for.
 */
import { EditIntentSchema } from '@sve/protocol';
import { z } from 'zod';
import { PROVIDER_IDS } from './providers.js';

export const API_BASE = '/api/';
export const API = {
  connect: '/api/connect',
  confirm: '/api/confirm',
  providers: '/api/providers',
  selectProvider: '/api/providers/select',
  configureProvider: '/api/providers/configure',
  apply: '/api/apply',
  revert: '/api/revert',
  plan: '/api/plan',
  sessions: '/api/sessions',
} as const;

const MAX_PATH = 4096;
const MAX_MESSAGE = 2000;
const MAX_ELEMENTS = 500;

export const ConnectBodySchema = z.union([
  z
    .object({
      folder: z.string().min(1).max(MAX_PATH),
      editRoots: z.array(z.string().max(MAX_PATH)).max(32).optional(),
    })
    .strict(),
  z
    .object({
      repository: z.string().min(1).max(MAX_PATH),
      editRoots: z.array(z.string().max(MAX_PATH)).max(32).optional(),
      install: z.boolean().optional(),
    })
    .strict(),
]);

export const ConfirmBodySchema = z.object({ id: z.string().min(1).max(64), allow: z.boolean() }).strict();

export const ProviderIdSchema = z.enum(PROVIDER_IDS);

export const SelectProviderBodySchema = z.object({ id: ProviderIdSchema }).strict();

export const ConfigureProviderBodySchema = z
  .object({
    id: ProviderIdSchema,
    settings: z
      .object({
        baseUrl: z.string().max(2048).optional(),
        model: z.string().max(256).optional(),
        apiKey: z.string().max(4096).optional(),
      })
      .strict(),
  })
  .strict();

export const ApplyBodySchema = z
  .object({ sessionId: z.string().min(1).max(64), intent: EditIntentSchema })
  .strict();

export const RevertBodySchema = z
  .object({ sessionId: z.string().min(1).max(64), jobId: z.string().min(1).max(64) })
  .strict();

const PlanTargetSchema = z
  .object({
    eid: z.string().min(1).max(512),
    eidIndex: z.number().int().min(0),
    loc: z.string().min(1).max(1024),
    tag: z.string().min(1).max(64),
    text: z.string().max(10_000),
    classes: z.array(z.string().max(200)).max(200),
    textKind: z.enum(['static', 'dynamic', 'mixed', 'none']),
    classKind: z.enum(['literal', 'dynamic', 'none']),
    selected: z.boolean(),
  })
  .strict();

export const PlanBodySchema = z
  .object({
    message: z.string().min(1).max(MAX_MESSAGE),
    elements: z.array(PlanTargetSchema).max(MAX_ELEMENTS),
  })
  .strict();
