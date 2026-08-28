import { z } from 'zod';

/* ────────────────────────────────────────────────────────────────────────────
 * Source locations
 *
 * A loc is `file:line:col`. The file segment may itself contain colons on
 * Windows (`C:\work\Hero.tsx`), so the coordinates are always the LAST two
 * colon-separated segments — never split from the left.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface Loc {
  file: string;
  line: number;
  col: number;
}

const UINT = /^\d+$/;

/** Parses `file:line:col`. Returns `null` for anything malformed — never throws. */
export function parseLoc(input: string): Loc | null {
  const parts = input.split(':');
  if (parts.length < 3) return null;

  const col = parts[parts.length - 1]!;
  const line = parts[parts.length - 2]!;
  if (!UINT.test(line) || !UINT.test(col)) return null;

  const file = parts.slice(0, -2).join(':');
  if (file.length === 0) return null;

  const lineNo = Number(line);
  if (lineNo < 1) return null;

  return { file, line: lineNo, col: Number(col) };
}

export function formatLoc(loc: Loc): string {
  return `${loc.file}:${loc.line}:${loc.col}`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Tracked computed properties
 *
 * Closed on purpose. The verifier compares computed CSS values, and an
 * open-ended diff never converges — every layout shift would read as drift.
 * `TrackedProp` derives from this tuple so the type cannot drift from the list.
 * ──────────────────────────────────────────────────────────────────────────── */

export const TRACKED_PROPS = [
  'color',
  'backgroundColor',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'textTransform',
  'textDecorationLine',
  'opacity',
  'display',
  'flexDirection',
  'alignItems',
  'justifyContent',
  'gap',
  'width',
  'height',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderRadius',
  'borderWidth',
  'borderColor',
  'boxShadow',
] as const;

export type TrackedProp = (typeof TRACKED_PROPS)[number];

type ComputedShape = { [K in TrackedProp]: z.ZodOptional<z.ZodString> };

const computedShape = Object.fromEntries(
  TRACKED_PROPS.map((prop) => [prop, z.string().optional()]),
) as ComputedShape;

/** Strict: an unrecognised property is a bug in the caller, not extra data to ignore. */
export const ComputedSchema = z.object(computedShape).strict();
export type Computed = z.infer<typeof ComputedSchema>;

/* ────────────────────────────────────────────────────────────────────────────
 * Wire types
 *
 * The bridge holds file-write capability and the browser is untrusted input,
 * so every field crossing the boundary is bounded here.
 * ──────────────────────────────────────────────────────────────────────────── */

export const LocStringSchema = z
  .string()
  .refine((value) => parseLoc(value) !== null, { message: 'expected file:line:col' });

export const SnapshotSchema = z.object({
  text: z.string(),
  classes: z.array(z.string()),
  computed: ComputedSchema,
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

export const EDIT_KINDS = ['text', 'class', 'style'] as const;
export type EditKind = (typeof EDIT_KINDS)[number];

/** Bounded because it is pasted verbatim into an agent prompt. */
export const MAX_INSTRUCTION_LENGTH = 2000;

export const EditIntentSchema = z.object({
  /** Structural id — survives the line shifts the agent's own write causes. */
  eid: z.string().min(1),
  /** Which of the N nodes sharing this eid was selected (mapped lists share one). */
  eidIndex: z.number().int().min(0),
  /** Exact origin, valid only until the next write to this file. */
  loc: LocStringSchema,
  tag: z.string().min(1),
  kind: z.enum(EDIT_KINDS),
  before: SnapshotSchema,
  after: SnapshotSchema,
  instruction: z.string().min(1).max(MAX_INSTRUCTION_LENGTH),
});
export type EditIntent = z.infer<typeof EditIntentSchema>;

export const ApplyRequestSchema = z.object({
  intents: z.array(EditIntentSchema).min(1).max(50),
});
export type ApplyRequest = z.infer<typeof ApplyRequestSchema>;

export const EDIT_STATUSES = ['landed', 'drifted', 'blocked', 'stalled', 'error'] as const;
export type EditStatus = (typeof EDIT_STATUSES)[number];

export const MismatchSchema = z.object({
  prop: z.string(),
  intent: z.string(),
  rendered: z.string(),
});
export type Mismatch = z.infer<typeof MismatchSchema>;

export const EditResultSchema = z.object({
  jobId: z.string().min(1),
  status: z.enum(EDIT_STATUSES),
  diff: z.string().optional(),
  mismatch: z.array(MismatchSchema).optional(),
  message: z.string().optional(),
  sessionId: z.string().optional(),
});
export type EditResult = z.infer<typeof EditResultSchema>;

export const PROGRESS_PHASES = [
  'queued',
  'snapshot',
  'agent',
  'writing',
  'done',
] as const;
export type ProgressPhase = (typeof PROGRESS_PHASES)[number];

export const ProgressEventSchema = z.object({
  jobId: z.string().min(1),
  phase: z.enum(PROGRESS_PHASES),
  detail: z.string().optional(),
  tool: z.string().optional(),
});
export type ProgressEvent = z.infer<typeof ProgressEventSchema>;

export const RevertRequestSchema = z.object({ jobId: z.string().min(1) });
export type RevertRequest = z.infer<typeof RevertRequestSchema>;
