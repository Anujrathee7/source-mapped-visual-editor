/**
 * Shared wire fixtures.
 *
 * Every value here is deliberately plain data: the specs round-trip them through
 * `JSON.parse(JSON.stringify(x))` to hold AC-8.5's property at the wire boundary too.
 */
import type { EditIntent, Snapshot } from '@sve/protocol';
import type { InspectorState, Override } from '../src/index.js';

export const snapshot: Snapshot = {
  text: 'Ship faster',
  classes: ['text-5xl', 'font-bold'],
  computed: { color: 'rgb(14, 17, 22)', fontSize: '48px' },
};

export const intent: EditIntent = {
  eid: 'Hero.tsx#App/div:0/section:1/h1:0',
  eidIndex: 0,
  loc: 'apps/demo/src/Hero.tsx:42:7',
  tag: 'h1',
  kind: 'text',
  before: { ...snapshot, text: 'Swim today' },
  after: snapshot,
  instruction: 'Replace the text content with "Ship faster".',
};

export const override: Override = {
  text: 'Ship faster',
  classes: { add: ['text-6xl'], remove: ['text-5xl'] },
  style: { color: '#0e1116' },
};

export const inspectorState: InspectorState = {
  anchor: {
    eid: 'Hero.tsx#App/div:0/section:1/h1:0',
    eidIndex: 0,
    loc: 'apps/demo/src/Hero.tsx:42:7',
    tag: 'h1',
    textKind: 'static',
    classKind: 'literal',
    count: 1,
  },
  excerpt: {
    lines: [
      { number: 41, text: '  return (', isTarget: false },
      { number: 42, text: '    <h1 className="text-5xl">Swim today</h1>', isTarget: true },
    ],
    caret: { line: 42, column: 7, offset: 6, pad: '      ' },
  },
  sourceMessage: null,
  textValue: 'Ship faster',
  classValue: 'text-5xl font-bold',
  styleValues: { color: '#0e1116' },
  canApply: true,
  canRevert: false,
  phase: 'idle',
  verdict: { status: 'landed' },
};
