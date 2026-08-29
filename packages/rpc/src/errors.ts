import { z } from 'zod';

/**
 * Closed, for the same reason `EDIT_STATUSES` is closed in `@sve/protocol`: callers
 * branch on these. `disconnected` in particular is the one AC-9.4 requires to be
 * distinguishable from every other way a call can fail — the studio says "the preview is
 * gone" for that code and only that code.
 */
export const RPC_ERROR_CODES = [
  /** The payload carried our marker and version but did not match its schema. */
  'parse',
  /** The peer speaks a different protocol version (AC-9.6). */
  'version',
  /** The message arrived from an unexpected origin or window (AC-9.2). */
  'origin',
  /** No reply arrived inside the deadline (AC-9.3). */
  'timeout',
  /** The peer navigated, reloaded, or was removed (AC-9.4). */
  'disconnected',
  /** The peer has no handler for this method. */
  'unknown-method',
  /** The remote handler threw, or returned something its result schema rejects. */
  'handler',
  /** A wildcard or empty target origin was configured (AC-9.2). Thrown, never sent. */
  'insecure-target',
] as const;

export type RpcErrorCode = (typeof RPC_ERROR_CODES)[number];

/** Bounded: an error message crosses the wire and is rendered by the peer. */
export const MAX_ERROR_MESSAGE_LENGTH = 1000;

export const RpcErrorPayloadSchema = z
  .object({
    code: z.enum(RPC_ERROR_CODES),
    message: z.string().max(MAX_ERROR_MESSAGE_LENGTH),
  })
  .strict();

export type RpcErrorPayload = z.infer<typeof RpcErrorPayloadSchema>;

export class RpcError extends Error {
  readonly code: RpcErrorCode;

  constructor(code: RpcErrorCode, message: string) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
  }

  toPayload(): RpcErrorPayload {
    return { code: this.code, message: this.message.slice(0, MAX_ERROR_MESSAGE_LENGTH) };
  }
}

export function isRpcError(value: unknown, code?: RpcErrorCode): value is RpcError {
  return value instanceof RpcError && (code === undefined || value.code === code);
}
