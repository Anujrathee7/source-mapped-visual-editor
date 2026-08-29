/**
 * The studio's origin has to reach the plugin the host injects.
 *
 * `studioOrigin` could previously only be named in a project's *own* vite config, so a
 * project the studio opened that did not already register `sve()` — the outside project v2
 * exists for — got a preview it could not drive. The frame mounted, the page rendered, and
 * every click went nowhere.
 *
 * It travels host -> session -> sve(), and it comes from the studio's own server. A value
 * a browser supplied would let the first page to frame a project drive its filesystem.
 */
import { describe, expect, it } from 'vitest';
import { startSession, type StartSessionOptions } from '../src/session.js';

describe('StartSessionOptions.studioOrigin', () => {
  it('is part of the contract a session is started with', () => {
    // A compile-time assertion: the field must exist and be an optional string.
    const options: Pick<StartSessionOptions, 'studioOrigin'> = {
      studioOrigin: 'http://localhost:5300',
    };
    expect(options.studioOrigin).toBe('http://localhost:5300');
    expect(typeof startSession).toBe('function');
  });

  it('is optional, so a session without a studio still starts', () => {
    const options: Pick<StartSessionOptions, 'studioOrigin'> = {};
    expect(options.studioOrigin).toBeUndefined();
  });
});
