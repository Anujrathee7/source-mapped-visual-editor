import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { pathOf, refusalIn, SYSTEM_PROMPT, WRITING_TOOLS } from '../src/agent/shared.js';

/**
 * AC-10.1 — the provider-neutral half of a runner lives in one place.
 *
 * None of what moved here ever mentioned Anthropic: a system prompt that names
 * no vendor, the parser for the `BLOCKED:` reply the prompt asks every provider
 * for, the set of tool names that mean a write happened, and the lookup for
 * whichever key a tool call spelled its path under.
 *
 * The reason to hoist them is not tidiness. A second runner would otherwise
 * copy the refusal parser, and two copies of a refusal parser are two
 * definitions of "refused" — which drift, and then a model that refused on one
 * provider is reported as having silently done nothing on the other.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, '..', 'src', 'agent');

function read(file: string): string {
  return readFileSync(path.join(src, file), 'utf8');
}

describe('AC-10.1 the shared module', () => {
  it('is where the system prompt now lives, and it names no vendor', () => {
    expect(SYSTEM_PROMPT).toContain('source-mapped visual editor');
    // The reply contract every provider is held to.
    expect(SYSTEM_PROMPT).toContain('BLOCKED:');
    expect(SYSTEM_PROMPT).toContain('DONE');
    // Told, not asked: no runner's system prompt may invite a search.
    expect(SYSTEM_PROMPT).toContain('do not search');

    expect(SYSTEM_PROMPT.toLowerCase()).not.toContain('anthropic');
    expect(SYSTEM_PROMPT.toLowerCase()).not.toContain('claude');
    expect(SYSTEM_PROMPT.toLowerCase()).not.toContain('openai');
  });

  it('names no vendor anywhere in the module, not only in the prompt', () => {
    const source = read('shared.ts').toLowerCase();

    for (const vendor of ['anthropic', 'claude', 'openai', 'deepseek', 'ollama']) {
      expect(source).not.toContain(vendor);
    }
  });

  it('is imported by the Claude runner rather than duplicated inside it', () => {
    const claude = read('claude.ts');

    expect(claude).toMatch(/from '\.\/shared\.js'/);
    // The definitions themselves are gone from the runner: a second copy of the
    // refusal parser is what this criterion exists to prevent.
    expect(claude).not.toContain('const SYSTEM_PROMPT');
    expect(claude).not.toContain('const WRITING_TOOLS');
    expect(claude).not.toContain('function pathOf');
    expect(claude).not.toContain('function refusalIn');
  });
});

describe('AC-10.1 the BLOCKED reply parser', () => {
  it('reads the reason out of a refusal', () => {
    expect(refusalIn(['BLOCKED: nothing at that column'])).toBe('nothing at that column');
  });

  it('is anchored to the start of a line, so prose that mentions it is not a refusal', () => {
    expect(refusalIn(['I was nearly blocked, but the edit is done.'])).toBeNull();
    expect(refusalIn(['Almost BLOCKED: but not really'])).toBeNull();
  });

  it('finds a refusal on a later line of a multi-line reply', () => {
    expect(refusalIn(['Here is what I found.\nBLOCKED: the element is an expression'])).toBe(
      'the element is an expression',
    );
  });

  it('takes the last refusal, because a later reply supersedes an earlier one', () => {
    expect(refusalIn(['BLOCKED: first', 'BLOCKED: second'])).toBe('second');
  });

  it('trims the reason and reports nothing when there is none', () => {
    expect(refusalIn(['BLOCKED:   spaced out   '])).toBe('spaced out');
    expect(refusalIn(['DONE'])).toBeNull();
    expect(refusalIn([])).toBeNull();
  });
});

describe('AC-10.1 pathOf', () => {
  it('finds the path under whichever key the tool spelled it', () => {
    expect(pathOf({ file_path: '/a/b.tsx' })).toBe('/a/b.tsx');
    expect(pathOf({ path: '/a/b.tsx' })).toBe('/a/b.tsx');
    expect(pathOf({ notebook_path: '/a/b.ipynb' })).toBe('/a/b.ipynb');
  });

  it('reports nothing for a call that names no path', () => {
    expect(pathOf({})).toBeUndefined();
    expect(pathOf({ file_path: '' })).toBeUndefined();
    expect(pathOf({ file_path: 42 })).toBeUndefined();
  });
});

describe('AC-10.1 WRITING_TOOLS', () => {
  it('holds the tool names whose use means something was written', () => {
    for (const tool of ['Edit', 'MultiEdit', 'NotebookEdit', 'Write']) {
      expect(WRITING_TOOLS.has(tool)).toBe(true);
    }
  });

  it('does not count a read as a write', () => {
    expect(WRITING_TOOLS.has('Read')).toBe(false);
    expect(WRITING_TOOLS.has('read_file')).toBe(false);
  });
});
