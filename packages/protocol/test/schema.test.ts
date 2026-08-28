import { describe, expect, it } from 'vitest';
import {
  EditIntentSchema,
  EditResultSchema,
  TRACKED_PROPS,
  type EditIntent,
} from '../src/index.js';

const snapshot = {
  text: 'Ship faster',
  classes: ['text-5xl', 'font-bold'],
  computed: { color: 'rgb(14, 17, 22)', fontSize: '48px' },
};

const intent = {
  eid: 'Hero.tsx#App/div:0/section:1/h1:0',
  eidIndex: 0,
  loc: 'apps/demo/src/Hero.tsx:42:7',
  tag: 'h1',
  kind: 'text',
  before: { ...snapshot, text: 'Swim today' },
  after: snapshot,
  instruction: 'Replace the text content with "Ship faster".',
};

describe('EditIntentSchema', () => {
  // AC-0.2
  it('accepts a well-formed intent', () => {
    const parsed = EditIntentSchema.parse(intent);
    const typed: EditIntent = parsed;
    expect(typed.tag).toBe('h1');
    expect(typed.kind).toBe('text');
  });

  // AC-0.3
  it.each([
    ['a loc parseLoc rejects', { loc: 'Hero.tsx:42' }],
    ['an unknown kind', { kind: 'structure' }],
    ['a negative eidIndex', { eidIndex: -1 }],
    ['a non-integer eidIndex', { eidIndex: 1.5 }],
    ['an oversized instruction', { instruction: 'x'.repeat(2001) }],
    ['a missing before', { before: undefined }],
    ['a missing after', { after: undefined }],
  ])('rejects %s', (_label, patch) => {
    expect(EditIntentSchema.safeParse({ ...intent, ...patch }).success).toBe(false);
  });

  it('rejects a computed property outside TRACKED_PROPS', () => {
    const bad = {
      ...intent,
      after: { ...snapshot, computed: { ...snapshot.computed, mysteryProp: '1px' } },
    };
    expect(EditIntentSchema.safeParse(bad).success).toBe(false);
  });
});

// AC-0.4
describe('TRACKED_PROPS', () => {
  it('covers the properties the verifier compares', () => {
    for (const prop of [
      'color',
      'backgroundColor',
      'fontSize',
      'fontWeight',
      'lineHeight',
      'marginTop',
      'marginRight',
      'marginBottom',
      'marginLeft',
      'paddingTop',
      'paddingRight',
      'paddingBottom',
      'paddingLeft',
      'borderRadius',
      'display',
      'gap',
      'width',
      'height',
      'textAlign',
      'opacity',
    ]) {
      expect(TRACKED_PROPS).toContain(prop);
    }
  });

  it('holds no duplicates', () => {
    expect(new Set(TRACKED_PROPS).size).toBe(TRACKED_PROPS.length);
  });
});

// AC-0.5
describe('EditResultSchema', () => {
  it.each(['landed', 'drifted', 'blocked', 'stalled', 'error'])('accepts %s', (status) => {
    expect(
      EditResultSchema.safeParse({ jobId: 'job_1', status, message: 'ok' }).success,
    ).toBe(true);
  });

  it('rejects an unknown status', () => {
    expect(EditResultSchema.safeParse({ jobId: 'job_1', status: 'pending' }).success).toBe(
      false,
    );
  });

  it('carries a mismatch on drifted', () => {
    const parsed = EditResultSchema.parse({
      jobId: 'job_1',
      status: 'drifted',
      mismatch: [{ prop: 'text', intent: 'Ship faster', rendered: 'Ship Faster' }],
    });
    expect(parsed.mismatch?.[0]?.rendered).toBe('Ship Faster');
  });
});
