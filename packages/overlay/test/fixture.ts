/**
 * A stand-in for the stamped output of `apps/demo`, small enough to reason about and
 * carrying each of the cases AC-4.7 and AC-4.6 name: a literal heading, an expression-fed
 * paragraph with a computed className, and a run of six elements sharing one eid.
 *
 * The locs point into SOURCE below, so the caret assertions are checked against real bytes
 * rather than against a number that happens to match another number.
 */
export const FILE = 'apps/demo/src/Hero.tsx';

export const SOURCE = [
  'export const Hero = () => (',
  '  <section className="wrap">',
  '    <h1 className="title">',
  '      Swim today',
  '    </h1>',
  '    <p className={cn("copy", safe && "safe")}>{nextWindow}</p>',
  '  </section>',
  ');',
].join('\n');

export const SECTION_EID = `${FILE}#section:0`;
export const H1_EID = `${FILE}#section:0/h1:0`;
export const P_EID = `${FILE}#section:0/p:0`;
export const CARD_EID = `${FILE}#section:0/article:0`;

export const H1_LOC = `${FILE}:3:5`;
export const P_LOC = `${FILE}:6:5`;

const card = `<article data-sve-loc="${FILE}:20:9" data-sve-eid="${CARD_EID}" data-sve-text="static" data-sve-class="literal" class="card">card</article>`;

export const PAGE = `
<main id="app-root">
  <section data-sve-loc="${FILE}:2:3" data-sve-eid="${SECTION_EID}" data-sve-text="none" data-sve-class="literal" class="wrap">
    <h1 data-sve-loc="${H1_LOC}" data-sve-eid="${H1_EID}" data-sve-text="static" data-sve-class="literal" class="title">Swim today</h1>
    <p data-sve-loc="${P_LOC}" data-sve-eid="${P_EID}" data-sve-text="dynamic" data-sve-class="dynamic" class="copy">Next safe window 06:40</p>
    <div id="unstamped"><span id="deep">deep</span></div>
    ${card.repeat(6)}
  </section>
</main>`;

export function renderPage(): void {
  document.body.innerHTML = PAGE;
}

export const fetchFixtureSource = async (): Promise<string> => SOURCE;
