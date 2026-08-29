/**
 * The wire contract between the studio (parent window) and the overlay (inside a
 * cross-origin iframe).
 *
 * `@sve/protocol` treats the browser as untrusted input to a process holding file-write
 * capability. This is the same discipline one level down: the parent is untrusted input
 * to the iframe and the iframe is untrusted input to the parent. Any page holding a
 * handle on a window can post to it, and the methods below reach a filesystem two hops
 * away, so every field is bounded and every object is strict.
 *
 * Types that already exist in `@sve/protocol` are imported, never restated. `Override`
 * is the one exception: it lives in `@sve/overlay`, which this package must not depend on
 * (it is browser-DOM code, and the studio side runs against the schema alone), so its
 * shape is mirrored here and pinned by a structural test.
 */
import {
  EDIT_KINDS,
  EDIT_STATUSES,
  EditIntentSchema,
  LocStringSchema,
  MismatchSchema,
  SnapshotSchema,
} from '@sve/protocol';
import { z } from 'zod';
import { RpcErrorPayloadSchema } from './errors.js';

/* ────────────────────────────────────────────────────────────────────────────
 * Identity and version
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Present on every message. A window message channel is shared with the HMR client,
 * devtools bridges and browser extensions; without a marker every one of their messages
 * would arrive as a schema failure and drown the diagnostics channel.
 */
export const RPC_MARKER = 'sve/rpc';

/**
 * Bumped whenever any schema below changes shape. The studio and the overlay are
 * separately deployable, so a stale iframe from a previous session is an ordinary
 * scenario rather than an exotic one (AC-9.6).
 */
export const RPC_VERSION = 1;

/* ────────────────────────────────────────────────────────────────────────────
 * Bounds
 *
 * Every one of these is a ceiling on something an attacker controls. They are generous
 * enough that no honest message hits them.
 * ──────────────────────────────────────────────────────────────────────────── */

export const MAX_ID_LENGTH = 64;
export const MAX_EID_LENGTH = 512;
export const MAX_TAG_LENGTH = 64;
export const MAX_TEXT_LENGTH = 10_000;
export const MAX_CLASS_LIST_LENGTH = 200;
export const MAX_CLASS_NAME_LENGTH = 200;
export const MAX_STYLE_PROP_LENGTH = 64;
export const MAX_STYLE_VALUE_LENGTH = 512;
export const MAX_STYLE_ENTRIES = 64;
export const MAX_EXCERPT_LINES = 200;
export const MAX_LINE_LENGTH = 4_000;
export const MAX_DIFF_LENGTH = 100_000;
export const MAX_MISMATCHES = 64;

const IdSchema = z.string().min(1).max(MAX_ID_LENGTH);
const EidSchema = z.string().min(1).max(MAX_EID_LENGTH);
const EidIndexSchema = z.number().int().min(0);
const ClassNameSchema = z.string().max(MAX_CLASS_NAME_LENGTH);
const DurationSchema = z.number().int().min(0).max(600_000);

/* ────────────────────────────────────────────────────────────────────────────
 * Overrides — mirrored from @sve/overlay, which this package cannot import
 * ──────────────────────────────────────────────────────────────────────────── */

export const ClassOverrideSchema = z
  .object({
    add: z.array(ClassNameSchema).max(MAX_CLASS_LIST_LENGTH),
    remove: z.array(ClassNameSchema).max(MAX_CLASS_LIST_LENGTH),
  })
  .strict();
export type ClassOverride = z.infer<typeof ClassOverrideSchema>;

const StyleMapSchema = z
  .record(z.string().max(MAX_STYLE_PROP_LENGTH), z.string().max(MAX_STYLE_VALUE_LENGTH))
  .refine((map) => Object.keys(map).length <= MAX_STYLE_ENTRIES, {
    message: `at most ${MAX_STYLE_ENTRIES} style properties`,
  });

/**
 * A user's change before any agent has touched disk. The verification loop relies on
 * `JSON.stringify` equality of this value, so it is plain data by contract, not by luck.
 */
export const OverrideSchema = z
  .object({
    text: z.string().max(MAX_TEXT_LENGTH).optional(),
    classes: ClassOverrideSchema.optional(),
    style: StyleMapSchema.optional(),
  })
  .strict();
export type Override = z.infer<typeof OverrideSchema>;

/* ────────────────────────────────────────────────────────────────────────────
 * Anchors, excerpts, inspector state — parent-ward chrome data
 * ──────────────────────────────────────────────────────────────────────────── */

export const TEXT_KINDS = ['static', 'dynamic', 'mixed', 'none'] as const;
export const CLASS_KINDS = ['literal', 'dynamic', 'none'] as const;
export const APPLY_PHASES = ['idle', 'applying'] as const;
export type ApplyPhase = (typeof APPLY_PHASES)[number];

/**
 * What `select` takes: AC-8.3 replaced an `Element` with the two fields that identify it,
 * because an element cannot cross a `postMessage` boundary.
 */
export const AnchorRefSchema = z.object({ eid: EidSchema, eidIndex: EidIndexSchema }).strict();
export type AnchorRef = z.infer<typeof AnchorRefSchema>;

export const AnchorSchema = z
  .object({
    eid: EidSchema,
    eidIndex: EidIndexSchema,
    loc: LocStringSchema,
    tag: z.string().min(1).max(MAX_TAG_LENGTH),
    textKind: z.enum(TEXT_KINDS),
    classKind: z.enum(CLASS_KINDS),
    count: z.number().int().min(0),
  })
  .strict();
export type Anchor = z.infer<typeof AnchorSchema>;

export const ExcerptLineSchema = z
  .object({
    number: z.number().int().min(1),
    text: z.string().max(MAX_LINE_LENGTH),
    isTarget: z.boolean(),
  })
  .strict();

export const CaretSchema = z
  .object({
    line: z.number().int().min(1),
    column: z.number().int().min(0),
    offset: z.number().int().min(0),
    pad: z.string().max(MAX_LINE_LENGTH),
  })
  .strict();

export const ExcerptSchema = z
  .object({
    lines: z.array(ExcerptLineSchema).max(MAX_EXCERPT_LINES),
    caret: CaretSchema,
  })
  .strict();
export type Excerpt = z.infer<typeof ExcerptSchema>;

export const VerdictSchema = z
  .object({
    status: z.enum(EDIT_STATUSES),
    message: z.string().max(MAX_TEXT_LENGTH).optional(),
    mismatch: z.array(MismatchSchema).max(MAX_MISMATCHES).optional(),
    diff: z.string().max(MAX_DIFF_LENGTH).optional(),
  })
  .strict();
export type Verdict = z.infer<typeof VerdictSchema>;

export const InspectorStateSchema = z
  .object({
    anchor: AnchorSchema.nullable(),
    excerpt: ExcerptSchema.nullable(),
    sourceMessage: z.string().max(MAX_TEXT_LENGTH).nullable(),
    textValue: z.string().max(MAX_TEXT_LENGTH),
    classValue: z.string().max(MAX_TEXT_LENGTH),
    styleValues: StyleMapSchema,
    canApply: z.boolean(),
    canRevert: z.boolean(),
    phase: z.enum(APPLY_PHASES),
    verdict: VerdictSchema.nullable(),
  })
  .strict();
export type InspectorState = z.infer<typeof InspectorStateSchema>;

/* ────────────────────────────────────────────────────────────────────────────
 * The method table
 *
 * One entry per member of AC-8's remote surface, and nothing else. Params and results
 * are declared together so the runtime schema and the static type cannot drift: the
 * client's `call` derives both of its type parameters from this object.
 *
 * `void` is spelled `null` throughout. `undefined` does not survive `JSON.stringify`,
 * and AC-8.5 requires every value crossing the seam to round-trip unchanged — so
 * `getOverride`'s `Override | undefined` becomes `Override | null` on the wire and the
 * edge adapter does the one-line translation.
 * ──────────────────────────────────────────────────────────────────────────── */

interface MethodSpec {
  readonly params: z.ZodTypeAny;
  readonly result: z.ZodTypeAny;
}

const NO_PARAMS = z.object({}).strict();
const VOID_RESULT = z.null();

export const RPC_METHODS = {
  /** AC-8.2: the loc as a string, because a DOM node cannot cross the boundary. */
  currentLoc: {
    params: z.object({ eid: EidSchema, eidIndex: EidIndexSchema }).strict(),
    result: LocStringSchema.nullable(),
  },
  /** AC-8.3: programmatic selection — the parent knows the element only by id. */
  select: {
    params: z.object({ anchor: AnchorRefSchema.nullable() }).strict(),
    result: VOID_RESULT,
  },
  /** AC-8.4: a value, not the live store. */
  getOverride: {
    params: z.object({ eid: EidSchema }).strict(),
    result: OverrideSchema.nullable(),
  },
  readSnapshot: {
    params: z.object({ eid: EidSchema, eidIndex: EidIndexSchema }).strict(),
    result: SnapshotSchema.nullable(),
  },
  liftOverride: {
    params: z.object({ eid: EidSchema }).strict(),
    result: OverrideSchema.nullable(),
  },
  restoreOverride: {
    params: z.object({ eid: EidSchema, override: OverrideSchema }).strict(),
    result: VOID_RESULT,
  },
  captureIntent: {
    params: z.object({ kind: z.enum(EDIT_KINDS) }).strict(),
    result: EditIntentSchema.nullable(),
  },
  refresh: { params: NO_PARAMS, result: VOID_RESULT },
  /**
   * The wait for hot reload stays inside the iframe: `import.meta.hot` there is the
   * user's dev-server socket and the two-rAF settle is the iframe's compositor. Only the
   * verdict crosses.
   */
  watchForUpdate: {
    params: z
      .object({ timeoutMs: DurationSchema.optional(), settleMs: DurationSchema.optional() })
      .strict(),
    result: z.object({ settled: z.boolean() }).strict(),
  },
} as const satisfies Record<string, MethodSpec>;

export type RpcMethod = keyof typeof RPC_METHODS;
export const RPC_METHOD_NAMES = Object.keys(RPC_METHODS) as RpcMethod[];

export type RpcParams<M extends RpcMethod> = z.infer<(typeof RPC_METHODS)[M]['params']>;
export type RpcResult<M extends RpcMethod> = z.infer<(typeof RPC_METHODS)[M]['result']>;

/* ── events: parent-ward, unsolicited, uncorrelated ────────────────────────── */

export const RPC_EVENTS = {
  inspectorState: InspectorStateSchema,
} as const satisfies Record<string, z.ZodTypeAny>;

export type RpcEventName = keyof typeof RPC_EVENTS;
export const RPC_EVENT_NAMES = Object.keys(RPC_EVENTS) as RpcEventName[];
export type RpcPayload<E extends RpcEventName> = z.infer<(typeof RPC_EVENTS)[E]>;

/* ────────────────────────────────────────────────────────────────────────────
 * The envelope
 * ──────────────────────────────────────────────────────────────────────────── */

export const RPC_KINDS = ['ready', 'request', 'response', 'event'] as const;
export type RpcKind = (typeof RPC_KINDS)[number];

const head = {
  sve: z.literal(RPC_MARKER),
  v: z.literal(RPC_VERSION),
} as const;

/**
 * Read before anything else, and deliberately loose about the body: a peer one version
 * ahead will have a shape today's schemas reject, and reporting that as malformed rather
 * than as a version mismatch is exactly the disguise AC-9.6 forbids.
 */
const HeadSchema = z
  .object({ sve: z.literal(RPC_MARKER), v: z.number().int() })
  .passthrough();

/** Announces a boot. The overlay sends one every time its document loads (AC-9.4). */
const ReadyEnvelopeSchema = z.object({ ...head, kind: z.literal('ready') }).strict();

/**
 * `params` is validated in a second pass against the named method's schema, because a
 * discriminated union over nine methods produces an error the diagnostics channel cannot
 * usefully print. The two-step is not a relaxation: a request is only ever handed on
 * with its params already parsed.
 */
const RequestEnvelopeSchema = z
  .object({
    ...head,
    kind: z.literal('request'),
    id: IdSchema,
    method: z.enum(RPC_METHOD_NAMES as [RpcMethod, ...RpcMethod[]]),
    params: z.unknown(),
  })
  .strict();

/**
 * `result` stays unknown here on purpose. Its schema is chosen by the *method of the
 * pending request*, which only the caller knows; the client narrows it before it
 * resolves anything (AC-9.1 — never dispatched partially).
 */
const ResponseEnvelopeSchema = z.union([
  z
    .object({ ...head, kind: z.literal('response'), id: IdSchema, ok: z.literal(true), result: z.unknown() })
    .strict(),
  z
    .object({ ...head, kind: z.literal('response'), id: IdSchema, ok: z.literal(false), error: RpcErrorPayloadSchema })
    .strict(),
]);

const EventEnvelopeSchema = z
  .object({
    ...head,
    kind: z.literal('event'),
    event: z.enum(RPC_EVENT_NAMES as [RpcEventName, ...RpcEventName[]]),
    payload: z.unknown(),
  })
  .strict();

export interface RpcReady {
  sve: typeof RPC_MARKER;
  v: typeof RPC_VERSION;
  kind: 'ready';
}

export type RpcRequest = {
  [M in RpcMethod]: {
    sve: typeof RPC_MARKER;
    v: typeof RPC_VERSION;
    kind: 'request';
    id: string;
    method: M;
    params: RpcParams<M>;
  };
}[RpcMethod];

export type RpcResponse =
  /**
   * `result` is optional because an `unknown` field is optional on the wire: a peer can
   * omit it entirely. That is not a hole — the client parses it against the pending
   * method's result schema, and a method returning `null` rejects a missing result the
   * same way it rejects a wrong one.
   */
  | { sve: typeof RPC_MARKER; v: typeof RPC_VERSION; kind: 'response'; id: string; ok: true; result?: unknown }
  | {
      sve: typeof RPC_MARKER;
      v: typeof RPC_VERSION;
      kind: 'response';
      id: string;
      ok: false;
      error: z.infer<typeof RpcErrorPayloadSchema>;
    };

export type RpcEventMessage = {
  [E in RpcEventName]: {
    sve: typeof RPC_MARKER;
    v: typeof RPC_VERSION;
    kind: 'event';
    event: E;
    payload: RpcPayload<E>;
  };
}[RpcEventName];

export type RpcMessage = RpcReady | RpcRequest | RpcResponse | RpcEventMessage;

/* ── constructors, so no call site hand-writes an envelope ─────────────────── */

export function readyMessage(): RpcReady {
  return { sve: RPC_MARKER, v: RPC_VERSION, kind: 'ready' };
}

export function requestMessage<M extends RpcMethod>(
  id: string,
  method: M,
  params: RpcParams<M>,
): RpcRequest {
  return { sve: RPC_MARKER, v: RPC_VERSION, kind: 'request', id, method, params } as RpcRequest;
}

export function resultMessage(id: string, result: unknown): RpcResponse {
  return { sve: RPC_MARKER, v: RPC_VERSION, kind: 'response', id, ok: true, result };
}

export function errorMessage(id: string, error: z.infer<typeof RpcErrorPayloadSchema>): RpcResponse {
  return { sve: RPC_MARKER, v: RPC_VERSION, kind: 'response', id, ok: false, error };
}

export function eventMessage<E extends RpcEventName>(event: E, payload: RpcPayload<E>): RpcEventMessage {
  return { sve: RPC_MARKER, v: RPC_VERSION, kind: 'event', event, payload } as RpcEventMessage;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Admission
 * ──────────────────────────────────────────────────────────────────────────── */

export type EnvelopeResult =
  | { ok: true; message: RpcMessage }
  /** Not our traffic. Silently dropped: reporting it would bury the real faults. */
  | { ok: false; reason: 'foreign' }
  /** Our marker, someone else's protocol version (AC-9.6). */
  | { ok: false; reason: 'version'; peerVersion: number }
  /** Our marker and version, malformed body (AC-9.1). */
  | { ok: false; reason: 'parse'; detail: string };

function detailOf(error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) return 'invalid message';
  const path = first.path.join('.');
  return path ? `${path}: ${first.message}` : first.message;
}

/**
 * The single admission point for an inbound value. Never throws — a message handler that
 * throws lands as an unhandled rejection with no owner, which is the one place a
 * malformed message must not be able to reach.
 */
export function parseEnvelope(data: unknown): EnvelopeResult {
  const headResult = HeadSchema.safeParse(data);
  if (!headResult.success) return { ok: false, reason: 'foreign' };

  const { v } = headResult.data;
  if (v !== RPC_VERSION) return { ok: false, reason: 'version', peerVersion: v };

  const kind = (data as { kind?: unknown }).kind;
  switch (kind) {
    case 'ready': {
      const parsed = ReadyEnvelopeSchema.safeParse(data);
      return parsed.success
        ? { ok: true, message: parsed.data }
        : { ok: false, reason: 'parse', detail: detailOf(parsed.error) };
    }
    case 'request': {
      const parsed = RequestEnvelopeSchema.safeParse(data);
      if (!parsed.success) return { ok: false, reason: 'parse', detail: detailOf(parsed.error) };
      const spec: MethodSpec = RPC_METHODS[parsed.data.method];
      const params = spec.params.safeParse(parsed.data.params);
      if (!params.success) {
        return { ok: false, reason: 'parse', detail: `${parsed.data.method}: ${detailOf(params.error)}` };
      }
      return { ok: true, message: { ...parsed.data, params: params.data } as RpcRequest };
    }
    case 'response': {
      const parsed = ResponseEnvelopeSchema.safeParse(data);
      return parsed.success
        ? { ok: true, message: parsed.data }
        : { ok: false, reason: 'parse', detail: detailOf(parsed.error) };
    }
    case 'event': {
      const parsed = EventEnvelopeSchema.safeParse(data);
      if (!parsed.success) return { ok: false, reason: 'parse', detail: detailOf(parsed.error) };
      const payload = RPC_EVENTS[parsed.data.event].safeParse(parsed.data.payload);
      if (!payload.success) {
        return { ok: false, reason: 'parse', detail: `${parsed.data.event}: ${detailOf(payload.error)}` };
      }
      return { ok: true, message: { ...parsed.data, payload: payload.data } as RpcEventMessage };
    }
    default:
      return { ok: false, reason: 'parse', detail: `unknown kind: ${String(kind)}` };
  }
}
