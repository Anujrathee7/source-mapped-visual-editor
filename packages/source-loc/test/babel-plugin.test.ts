import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLoc } from '@sve/protocol';
import {
  FIXTURE,
  FIXTURE_FILENAME,
  attr,
  attrNames,
  collect,
  element,
  reprint,
  reprintWithoutSve,
  stamp,
} from './support.js';

const SVE_ATTRS = ['data-sve-loc', 'data-sve-eid', 'data-sve-text', 'data-sve-class'];

const stamped = stamp(FIXTURE, FIXTURE_FILENAME);
const el = (tag: string) => element(stamped, tag);

// AC-1.1
describe('host elements are stamped; components are not', () => {
  it.each(['section', 'h1', 'p', 'span', 'img'])('stamps <%s> with all four attributes', (tag) => {
    const names = attrNames(el(tag));
    for (const svAttr of SVE_ATTRS) expect(names).toContain(svAttr);
  });

  it('leaves <Feature> unstamped — a component emits no DOM of its own', () => {
    expect(attrNames(el('Feature'))).toEqual(['name']);
  });

  it('leaves member expressions and fragments unstamped', () => {
    const source = [
      'export const X = () => (',
      '  <>',
      '    <motion.div>',
      '      <Foo.Bar />',
      '      <div />',
      '    </motion.div>',
      '  </>',
      ');',
    ].join('\n');
    const out = stamp(source, 'apps/demo/src/X.tsx');

    expect(attrNames(element(out, 'motion.div'))).toEqual([]);
    expect(attrNames(element(out, 'Foo.Bar'))).toEqual([]);
    expect(attrNames(element(out, 'div'))).toEqual(SVE_ATTRS);
  });
});

// AC-1.2
describe('data-sve-loc is file:line:col, 1-based', () => {
  it.each([
    ['section', 'apps/demo/src/Sample.tsx:5:5'],
    ['h1', 'apps/demo/src/Sample.tsx:6:7'],
    ['p', 'apps/demo/src/Sample.tsx:7:7'],
    ['span', 'apps/demo/src/Sample.tsx:8:7'],
    ['img', 'apps/demo/src/Sample.tsx:10:7'],
  ])('<%s> is stamped %s', (tag, expected) => {
    expect(attr(el(tag), 'data-sve-loc')).toBe(expected);
  });

  it('points at the opening angle bracket', () => {
    const lines = FIXTURE.split(/\r?\n/);
    for (const tag of ['section', 'h1', 'p', 'span', 'img']) {
      const loc = parseLoc(attr(el(tag), 'data-sve-loc')!)!;
      expect(lines[loc.line - 1]!.slice(loc.col - 1)).toMatch(new RegExp(`^<${tag}\\b`));
    }
  });

  it('emits a project-relative path with forward slashes on every platform', () => {
    const root = path.resolve('some', 'project', 'root');
    const filename = path.join(root, 'src', 'nested', 'Sample.tsx');
    const out = stamp(FIXTURE, filename, root);

    const loc = parseLoc(attr(element(out, 'section'), 'data-sve-loc')!)!;
    expect(loc.file).toBe('src/nested/Sample.tsx');
    expect(loc.file).not.toContain('\\');
    expect(attr(element(out, 'section'), 'data-sve-eid')).toBe('src/nested/Sample.tsx#section:0');
  });
});

// AC-1.3
describe('data-sve-eid is structural', () => {
  it.each([
    ['section', 'apps/demo/src/Sample.tsx#section:0'],
    ['h1', 'apps/demo/src/Sample.tsx#section:0/h1:0'],
    ['p', 'apps/demo/src/Sample.tsx#section:0/p:0'],
    ['span', 'apps/demo/src/Sample.tsx#section:0/span:0'],
    ['img', 'apps/demo/src/Sample.tsx#section:0/img:0'],
  ])('<%s> is stamped %s', (tag, expected) => {
    expect(attr(el(tag), 'data-sve-eid')).toBe(expected);
  });

  it('indexes nth-of-type, so an unrelated sibling does not renumber the others', () => {
    const source = [
      'export const X = () => (',
      '  <ul>',
      '    <li>a</li>',
      '    <hr />',
      '    <li>b</li>',
      '  </ul>',
      ');',
    ].join('\n');
    const eids = collect(stamp(source, 'X.tsx')).map((e) => attr(e, 'data-sve-eid'));

    expect(eids).toEqual(['X.tsx#ul:0', 'X.tsx#ul:0/li:0', 'X.tsx#ul:0/hr:0', 'X.tsx#ul:0/li:1']);
  });

  it('survives line shifts: eids identical, loc lines all moved by exactly two', () => {
    const shifted = stamp(`\n\n${FIXTURE}`, FIXTURE_FILENAME);

    for (const tag of ['section', 'h1', 'p', 'span', 'img']) {
      expect(attr(element(shifted, tag), 'data-sve-eid')).toBe(attr(el(tag), 'data-sve-eid'));

      const before = parseLoc(attr(el(tag), 'data-sve-loc')!)!;
      const after = parseLoc(attr(element(shifted, tag), 'data-sve-loc')!)!;
      expect(after.line).toBe(before.line + 2);
      expect(after.col).toBe(before.col);
      expect(after.file).toBe(before.file);
    }
  });
});

// AC-1.4
describe('data-sve-text classifies the children', () => {
  it.each([
    ['section', 'none'],
    ['h1', 'static'],
    ['p', 'dynamic'],
    ['span', 'static'],
    ['img', 'none'],
  ])('<%s> is %s', (tag, expected) => {
    expect(attr(el(tag), 'data-sve-text')).toBe(expected);
  });

  it.each([
    ['no children', '<i />', 'none'],
    ['whitespace-only text', '<i>   </i>', 'none'],
    ['element children only', '<i><b /></i>', 'none'],
    ['plain text', '<i>hello</i>', 'static'],
    ['an expression container', '<i>{x}</i>', 'dynamic'],
    ['text beside an expression', '<i>hi {x}</i>', 'dynamic'],
    ['a comment-only container', '<i>{/* note */}</i>', 'none'],
    ['text beside an element', '<i>hi <b /></i>', 'mixed'],
  ])('classifies %s as %s', (_label, jsx, expected) => {
    const out = stamp(`export const X = () => (${jsx});`, 'X.tsx');
    expect(attr(element(out, 'i'), 'data-sve-text')).toBe(expected);
  });
});

// AC-1.5
describe('data-sve-class classifies the className', () => {
  it.each([
    ['section', 'literal'],
    ['h1', 'literal'],
    ['p', 'none'],
    ['span', 'dynamic'],
    ['img', 'none'],
  ])('<%s> is %s', (tag, expected) => {
    expect(attr(el(tag), 'data-sve-class')).toBe(expected);
  });

  it.each([
    ['a string literal', '<i className="a" />', 'literal'],
    ['a template literal', '<i className={`a ${b}`} />', 'dynamic'],
    ['a ternary', '<i className={on ? "a" : "b"} />', 'dynamic'],
    ['a prop', '<i className={klass} />', 'dynamic'],
    ['no className', '<i />', 'none'],
    ['a spread', '<i {...rest} />', 'none'],
  ])('classifies %s as %s', (_label, jsx, expected) => {
    const out = stamp(`export const X = () => (${jsx});`, 'X.tsx');
    expect(attr(element(out, 'i'), 'data-sve-class')).toBe(expected);
  });
});

// AC-1.6
describe('existing attributes are preserved and stamping is idempotent', () => {
  it('appends the four attributes after the originals, in order', () => {
    expect(attrNames(el('section'))).toEqual(['className', ...SVE_ATTRS]);
    expect(attrNames(el('img'))).toEqual(['src', 'alt', ...SVE_ATTRS]);
    expect(attrNames(el('span'))).toEqual(['className', ...SVE_ATTRS]);
  });

  it('keeps original attribute values intact', () => {
    expect(attr(el('section'), 'className')).toBe('wrap');
    expect(attr(el('h1'), 'className')).toBe('title');
    expect(attr(el('img'), 'src')).toBe('/a.png');
    expect(attr(el('img'), 'alt')).toBe('');
    expect(stamped).toContain("className={cn('badge', safe && 'ok')}");
  });

  it('produces no duplicates when an already-stamped file is transformed again', () => {
    const twice = stamp(stamped, FIXTURE_FILENAME);
    expect(collect(twice)).toEqual(collect(stamped));

    for (const svAttr of SVE_ATTRS) {
      const occurrences = twice.split(svAttr).length - 1;
      expect(occurrences).toBe(5);
    }
  });
});

// AC-1.8
describe('the transform never changes what renders', () => {
  it('stripping data-sve-* from the output yields the original AST', () => {
    expect(reprintWithoutSve(stamped)).toBe(reprint(FIXTURE));
  });
});
