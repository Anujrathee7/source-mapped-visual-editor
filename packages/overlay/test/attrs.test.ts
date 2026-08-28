import { describe, expect, it } from 'vitest';
import {
  ATTR_CLASS as STAMPED_CLASS,
  ATTR_EID as STAMPED_EID,
  ATTR_LOC as STAMPED_LOC,
  ATTR_TEXT as STAMPED_TEXT,
} from '@sve/source-loc';
import { ATTR_CLASS, ATTR_EID, ATTR_LOC, ATTR_TEXT, SVE_ATTRS } from '../src/attrs.js';

// @sve/source-loc opens with `import path from 'node:path'`, so the overlay — which runs
// in the browser — cannot import its constants at runtime and declares its own. This test
// is the seam that keeps the two copies honest: it runs in Node, where importing the babel
// plugin is free, and fails the moment either side renames an attribute.
describe('the attribute names match the ones the babel pass stamps', () => {
  it.each([
    ['loc', ATTR_LOC, STAMPED_LOC],
    ['eid', ATTR_EID, STAMPED_EID],
    ['text', ATTR_TEXT, STAMPED_TEXT],
    ['class', ATTR_CLASS, STAMPED_CLASS],
  ])('data-sve-%s', (_label, overlay, stamped) => {
    expect(overlay).toBe(stamped);
  });

  it('lists all four', () => {
    expect(SVE_ATTRS).toEqual([ATTR_LOC, ATTR_EID, ATTR_TEXT, ATTR_CLASS]);
  });
});
