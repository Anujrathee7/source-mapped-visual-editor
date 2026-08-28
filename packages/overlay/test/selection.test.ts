// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { anchorFor, resolveAnchor, stampedAncestor } from '../src/selection.js';
import { CARD_EID, H1_EID, H1_LOC, P_EID, SECTION_EID, renderPage } from './fixture.js';
import { resetDocument } from './support.js';

afterEach(resetDocument);

// AC-4.2
describe('stampedAncestor', () => {
  it('returns the element itself when it carries an eid', () => {
    renderPage();
    const h1 = document.querySelector('h1')!;
    expect(stampedAncestor(h1, null)).toBe(h1);
  });

  it('walks up to the nearest stamped ancestor from an unstamped node', () => {
    renderPage();
    expect(stampedAncestor(document.querySelector('#deep'), null)).toBe(
      document.querySelector('section'),
    );
  });

  it('walks up from a text node, which is what a pointer event can land on', () => {
    renderPage();
    const text = document.querySelector('h1')!.firstChild!;
    expect(stampedAncestor(text, null)).toBe(document.querySelector('h1'));
  });

  it('returns null above the outermost stamped element', () => {
    renderPage();
    expect(stampedAncestor(document.querySelector('#app-root'), null)).toBeNull();
  });

  // AC-4.2 — "The overlay's own chrome is never selectable as a target."
  it('refuses anything inside the overlay host', () => {
    renderPage();
    const host = document.createElement('div');
    host.setAttribute('data-sve-eid', 'pretend');
    document.body.append(host);
    expect(stampedAncestor(host, host)).toBeNull();

    const inner = document.createElement('span');
    host.append(inner);
    expect(stampedAncestor(inner, host)).toBeNull();
  });

  it('handles a detached node without throwing', () => {
    expect(stampedAncestor(document.createElement('div'), null)).toBeNull();
    expect(stampedAncestor(null, null)).toBeNull();
  });
});

// AC-4.2 / AC-4.6
describe('anchorFor', () => {
  it('reads the stamps the babel pass wrote, unaltered', () => {
    renderPage();
    const anchor = anchorFor(document.querySelector('h1')!, document)!;
    expect(anchor).toMatchObject({
      eid: H1_EID,
      eidIndex: 0,
      loc: H1_LOC,
      tag: 'h1',
      textKind: 'static',
      classKind: 'literal',
      count: 1,
    });
  });

  it('carries the four-valued text kind through, mixed included', () => {
    renderPage();
    expect(anchorFor(document.querySelector('p')!, document)!.textKind).toBe('dynamic');

    const el = document.querySelector('h1')!;
    el.setAttribute('data-sve-text', 'mixed');
    expect(anchorFor(el, document)!.textKind).toBe('mixed');
  });

  it('reads an unrecognised stamp as the most restrictive kind rather than trusting it', () => {
    renderPage();
    const el = document.querySelector('h1')!;
    el.setAttribute('data-sve-text', 'whatever');
    el.setAttribute('data-sve-class', 'whatever');
    const anchor = anchorFor(el, document)!;
    expect(anchor.textKind).toBe('none');
    expect(anchor.classKind).toBe('none');
  });

  // AC-4.6 — the count is what the inspector states in plain language.
  it('counts every element rendering from the same line, and indexes within them', () => {
    renderPage();
    const cards = document.querySelectorAll('article');
    expect(anchorFor(cards[0]!, document)).toMatchObject({ eid: CARD_EID, eidIndex: 0, count: 6 });
    expect(anchorFor(cards[3]!, document)).toMatchObject({ eid: CARD_EID, eidIndex: 3, count: 6 });
    expect(anchorFor(cards[5]!, document)).toMatchObject({ eid: CARD_EID, eidIndex: 5, count: 6 });
  });

  it('returns null for an unstamped element', () => {
    renderPage();
    expect(anchorFor(document.querySelector('#unstamped')!, document)).toBeNull();
  });
});

// AC-5.4's re-anchoring hook, built here so M6 has it: the eid survives the line shift the
// agent's own write causes, and the index picks out which of the six was selected.
describe('resolveAnchor', () => {
  it('finds the element by eid and index', () => {
    renderPage();
    expect(resolveAnchor(CARD_EID, 3, document)).toBe(document.querySelectorAll('article')[3]);
    expect(resolveAnchor(H1_EID, 0, document)).toBe(document.querySelector('h1'));
  });

  it('finds the replacement after every node on the page is rebuilt', () => {
    renderPage();
    const before = document.querySelector('h1')!;
    renderPage();
    const after = resolveAnchor(H1_EID, 0, document);
    expect(after).not.toBe(before);
    expect(after).toBe(document.querySelector('h1'));
  });

  it('follows the loc to its new line after the agent shifts the file', () => {
    renderPage();
    // What the agent's write looks like from the browser: same structure, new coordinates.
    document.querySelector('h1')!.setAttribute('data-sve-loc', `${H1_LOC.split(':')[0]}:9:5`);
    expect(anchorFor(resolveAnchor(H1_EID, 0, document)!, document)!.loc).toBe(
      `${H1_LOC.split(':')[0]}:9:5`,
    );
  });

  it('returns null rather than throwing when the element is gone or the index is past the end', () => {
    renderPage();
    expect(resolveAnchor(CARD_EID, 6, document)).toBeNull();
    expect(resolveAnchor('no-such-eid', 0, document)).toBeNull();
    document.body.innerHTML = '';
    expect(resolveAnchor(SECTION_EID, 0, document)).toBeNull();
  });
});
