import { describe, expect, it } from 'vitest';
import {
  RPC_EVENTS,
  RPC_MARKER,
  RPC_METHODS,
  RPC_VERSION,
  parseEnvelope,
  type RpcMethod,
} from '../src/index.js';
import { inspectorState, intent, override, snapshot } from './fixture.js';

const head = { sve: RPC_MARKER, v: RPC_VERSION } as const;

const request = (method: string, params: unknown, id = 'r1') => ({
  ...head,
  kind: 'request',
  id,
  method,
  params,
});

/** AC-9.1 — the request set mirrors AC-8's remote surface, exactly. */
describe('RPC_METHODS', () => {
  it('is the AC-8 remote surface and nothing else', () => {
    expect(Object.keys(RPC_METHODS).sort()).toEqual(
      [
        'captureIntent',
        'currentLoc',
        'getOverride',
        'liftOverride',
        'readSnapshot',
        'refresh',
        'restoreOverride',
        'select',
        'watchForUpdate',
      ].sort(),
    );
  });

  it('gives every method a params schema and a result schema', () => {
    for (const [name, spec] of Object.entries(RPC_METHODS)) {
      expect(typeof spec.params.safeParse, `${name}.params`).toBe('function');
      expect(typeof spec.result.safeParse, `${name}.result`).toBe('function');
    }
  });

  it.each([
    ['currentLoc', { eid: 'a', eidIndex: 0 }, 'apps/demo/src/Hero.tsx:42:7'],
    ['currentLoc', { eid: 'a', eidIndex: 0 }, null],
    ['select', { anchor: { eid: 'a', eidIndex: 2 } }, null],
    ['select', { anchor: null }, null],
    ['getOverride', { eid: 'a' }, override],
    ['getOverride', { eid: 'a' }, null],
    ['readSnapshot', { eid: 'a', eidIndex: 0 }, snapshot],
    ['readSnapshot', { eid: 'a', eidIndex: 0 }, null],
    ['liftOverride', { eid: 'a' }, override],
    ['restoreOverride', { eid: 'a', override }, null],
    ['captureIntent', { kind: 'text' }, intent],
    ['captureIntent', { kind: 'style' }, null],
    ['refresh', {}, null],
    ['watchForUpdate', {}, { settled: true }],
    ['watchForUpdate', { timeoutMs: 5000, settleMs: 100 }, { settled: false }],
  ])('accepts %s params and result', (method, params, result) => {
    const spec = RPC_METHODS[method as RpcMethod];
    expect(spec.params.safeParse(params).success).toBe(true);
    expect(spec.result.safeParse(result).success).toBe(true);
  });

  it.each([
    ['currentLoc', { eid: 'a' }],
    ['currentLoc', { eid: '', eidIndex: 0 }],
    ['currentLoc', { eid: 'a', eidIndex: -1 }],
    ['currentLoc', { eid: 'a', eidIndex: 0, extra: 1 }],
    ['select', { anchor: { eid: 'a' } }],
    ['captureIntent', { kind: 'structure' }],
    ['restoreOverride', { eid: 'a', override: { text: 1 } }],
    ['watchForUpdate', { timeoutMs: -1 }],
  ])('rejects malformed %s params', (method, params) => {
    expect(RPC_METHODS[method as RpcMethod].params.safeParse(params).success).toBe(false);
  });

  it('rejects a currentLoc result that is not a parseable loc', () => {
    expect(RPC_METHODS.currentLoc.result.safeParse('Hero.tsx:42').success).toBe(false);
  });

  it('rejects a readSnapshot result carrying an untracked computed property', () => {
    const bad = { ...snapshot, computed: { ...snapshot.computed, mysteryProp: '1px' } };
    expect(RPC_METHODS.readSnapshot.result.safeParse(bad).success).toBe(false);
  });
});

/** AC-9.1 — `InspectorState` travels parent-ward. */
describe('RPC_EVENTS', () => {
  it('carries inspector state', () => {
    expect(Object.keys(RPC_EVENTS)).toEqual(['inspectorState']);
    expect(RPC_EVENTS.inspectorState.safeParse(inspectorState).success).toBe(true);
  });

  it('rejects an inspector state with an unknown phase', () => {
    const bad = { ...inspectorState, phase: 'thinking' };
    expect(RPC_EVENTS.inspectorState.safeParse(bad).success).toBe(false);
  });

  it('rejects an inspector state with an unknown verdict status', () => {
    const bad = { ...inspectorState, verdict: { status: 'probably-fine' } };
    expect(RPC_EVENTS.inspectorState.safeParse(bad).success).toBe(false);
  });
});

/**
 * AC-8.5 held at the wire: nothing in either direction loses information in JSON.
 * Asserted mechanically over every params and result schema, not argued in a comment.
 */
describe('serialisability', () => {
  const samples: Array<[string, unknown]> = [
    ['snapshot', snapshot],
    ['intent', intent],
    ['override', override],
    ['inspectorState', inspectorState],
    ['request', request('restoreOverride', { eid: 'a', override })],
    ['event', { ...head, kind: 'event', event: 'inspectorState', payload: inspectorState }],
  ];

  it.each(samples)('%s survives a JSON round-trip unchanged', (_label, value) => {
    expect(JSON.parse(JSON.stringify(value))).toEqual(value);
  });
});

describe('parseEnvelope', () => {
  // AC-9.1
  it('parses a well-formed request down to its typed params', () => {
    const result = parseEnvelope(request('readSnapshot', { eid: 'a', eidIndex: 1 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message.kind).toBe('request');
    if (result.message.kind !== 'request') return;
    expect(result.message.method).toBe('readSnapshot');
    expect(result.message.params).toEqual({ eid: 'a', eidIndex: 1 });
  });

  it('parses a response, a ready and an event', () => {
    for (const message of [
      { ...head, kind: 'response', id: 'r1', ok: true, result: null },
      { ...head, kind: 'response', id: 'r1', ok: false, error: { code: 'handler', message: 'x' } },
      { ...head, kind: 'ready' },
      { ...head, kind: 'event', event: 'inspectorState', payload: inspectorState },
    ]) {
      expect(parseEnvelope(message).ok, JSON.stringify(message)).toBe(true);
    }
  });

  // AC-9.1 — a message that fails to parse is a reportable rejection, never a throw.
  it.each([
    ['unknown method', request('deleteEverything', {})],
    ['params for the wrong method', request('refresh', { eid: 'a' })],
    ['a missing id', { ...head, kind: 'request', method: 'refresh', params: {} }],
    ['an unknown kind', { ...head, kind: 'shout', id: 'r1' }],
    ['an unknown event', { ...head, kind: 'event', event: 'boom', payload: {} }],
    ['an unknown error code', { ...head, kind: 'response', id: 'r1', ok: false, error: { code: 'nope', message: 'x' } }],
    ['an extra envelope field', { ...request('refresh', {}), stowaway: true }],
  ])('rejects %s as a parse failure', (_label, message) => {
    const result = parseEnvelope(message);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('parse');
  });

  // Foreign traffic is not a diagnostic. A window message channel carries HMR pings,
  // devtools chatter and extension noise; reporting all of it would bury the real faults.
  it.each([
    ['a string', 'hello'],
    ['null', null],
    ['an unmarked object', { kind: 'request', id: 'r1' }],
    ['another product marker', { sve: 'sve/other', v: 1, kind: 'ready' }],
  ])('classifies %s as foreign, not as a parse failure', (_label, message) => {
    const result = parseEnvelope(message);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('foreign');
  });

  // AC-9.6
  it('separates a version mismatch from a parse failure and reports the peer version', () => {
    const result = parseEnvelope({ ...request('refresh', {}), v: RPC_VERSION + 1 });
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== 'version') throw new Error('expected a version rejection');
    expect(result.peerVersion).toBe(RPC_VERSION + 1);
  });

  it('reads the version before the body, so a future shape still reports as a mismatch', () => {
    const future = { sve: RPC_MARKER, v: RPC_VERSION + 1, type: 'call', selector: '#hero' };
    const result = parseEnvelope(future);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('version');
  });

  it('never throws, whatever it is handed', () => {
    const cyclic: Record<string, unknown> = { sve: RPC_MARKER, v: RPC_VERSION, kind: 'request' };
    cyclic.self = cyclic;
    for (const value of [undefined, Symbol('x'), 0, [], new Map(), cyclic]) {
      expect(() => parseEnvelope(value)).not.toThrow();
    }
  });
});
