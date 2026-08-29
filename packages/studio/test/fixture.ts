/**
 * A stamped page and the bytes it was compiled from.
 *
 * The studio never fabricates a coordinate: every caret assertion below is made against
 * `SOURCE`, so an off-by-one in the excerpt arithmetic is a failing byte comparison rather
 * than one number happening to equal another.
 */
export const FILE = 'src/Hero.tsx';

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

export const SECTION_EID = `${FILE}#Hero/section:0`;
export const H1_EID = `${FILE}#Hero/section:0/h1:0`;
export const P_EID = `${FILE}#Hero/section:0/p:0`;

export const SECTION_LOC = `${FILE}:2:3`;
/** Line 3, column 5 — the `<` of `<h1`, four characters in. */
export const H1_LOC = `${FILE}:3:5`;
export const P_LOC = `${FILE}:6:5`;

/** An element whose file the fixture refuses to serve, so the unreadable path is real. */
export const ORPHAN_EID = 'src/Missing.tsx#Missing/div:0';
export const ORPHAN_LOC = 'src/Missing.tsx:2:3';

export const H1_ANCHOR = { eid: H1_EID, eidIndex: 0 };

export const PAGE = `
<main>
  <section data-sve-loc="${SECTION_LOC}" data-sve-eid="${SECTION_EID}" data-sve-text="none" data-sve-class="literal" class="wrap">
    <h1 data-sve-loc="${H1_LOC}" data-sve-eid="${H1_EID}" data-sve-text="static" data-sve-class="literal" class="title">Swim today</h1>
    <p data-sve-loc="${P_LOC}" data-sve-eid="${P_EID}" data-sve-text="dynamic" data-sve-class="dynamic" class="copy">Next safe window 06:40</p>
    <div data-sve-loc="${ORPHAN_LOC}" data-sve-eid="${ORPHAN_EID}" data-sve-text="static" data-sve-class="literal" class="orphan">elsewhere</div>
  </section>
</main>`;

export function renderPage(): void {
  document.body.innerHTML = PAGE;
}

export const fetchFixtureSource = async (file: string): Promise<string | null> =>
  file === FILE ? SOURCE : null;

/** The two origins the wire is configured with. Never inferred, never a wildcard. */
export const STUDIO_ORIGIN = 'http://localhost:5300';
export const PREVIEW_ORIGIN = 'http://127.0.0.1:5310';

/** A macrotask boundary: `postMessage` is a task and the memory transport is a microtask. */
export const settle = async (turns = 3): Promise<void> => {
  for (let i = 0; i < turns; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
