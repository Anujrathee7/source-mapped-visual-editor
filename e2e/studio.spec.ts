import { expect, test, type Page } from '@playwright/test';
import { fixturePath, readFixture, readFixtureLines, restoreFixture, snapshotFixture, type FixtureSnapshot } from './fixture.js';
import {
  HERO,
  HERO_H1_LOC,
  HERO_H1_TEXT_LINE,
  STUDIO_FIXTURE_ROOT,
  prepareStudioFixture,
} from './studio.fixture.js';

/**
 * AC-15.6 — the wire, proven connected.
 *
 * Everything on both sides of this seam had passing tests before this file existed.
 * `@sve/studio/preview` answered a `RemoteOverlay` over `@sve/rpc`; the client entry
 * mounted an overlay; the studio's controllers drove a loop against a memory transport.
 * None of it was joined, and a green suite said so anyway — which is exactly the failure
 * this project exists to catch, arriving in the project's own tests.
 *
 * So this suite is not allowed to stub anything. It loads the studio in a browser, types a
 * folder into the form a person types into, waits for `@sve/host` to start that project's
 * own dev server, and drives what comes back through a real cross-origin iframe. The
 * studio is on one origin, the project on another, and every call between them is a
 * `postMessage` the browser actually delivered.
 *
 * Serial, and on one page: connecting starts a Vite server and probes it, and paying for
 * that per assertion would make the suite slower than the thing it tests.
 */
test.describe.configure({ mode: 'serial' });

/** The host starts a dev server and probes it; a cold Tailwind build is most of this. */
const CONNECT_TIMEOUT_MS = 180_000;

let page: Page;
let snapshot: FixtureSnapshot;

const frame = (): ReturnType<Page['frameLocator']> => page.frameLocator('iframe.sv-preview__frame');
const coordFile = (): ReturnType<Page['locator']> => page.locator('.sv-coord__file');
const coordPos = (): ReturnType<Page['locator']> => page.locator('.sv-coord__pos');
const textField = (): ReturnType<Page['locator']> => page.locator('#sv-field-text');
const applyButton = (): ReturnType<Page['locator']> =>
  page.locator('.sv-diagnostic .sv-button--primary');
const rows = (): ReturnType<Page['locator']> => page.locator('.sv-log .sv-row');

test.beforeAll(async ({ browser }) => {
  test.setTimeout(CONNECT_TIMEOUT_MS);
  prepareStudioFixture();
  snapshot = snapshotFixture(STUDIO_FIXTURE_ROOT);

  page = await browser.newPage();
  page.setDefaultTimeout(60_000);
  await page.goto('/');

  await page.getByLabel('Folder path or repository URL').fill(STUDIO_FIXTURE_ROOT);
  await page.getByRole('button', { name: 'Connect' }).click();

  // The workspace replaces the connect view only once the session is serving *and* the
  // preview has a URL — so this waiting for the frame is waiting for the host, too.
  await expect(page.locator('iframe.sv-preview__frame')).toBeVisible({
    timeout: CONNECT_TIMEOUT_MS,
  });
});

test.afterAll(async () => {
  // Unconditional: this suite drives a real agent over a real bridge and writes real
  // files. A test that fails halfway must not leave the fixture edited.
  restoreFixture(snapshot, STUDIO_FIXTURE_ROOT);
  await page?.close();
});

/* ── the frame is the project, and it is stamped ──────────────────────────── */

test('AC-15.6 the preview is the project itself, stamped, on its own origin', async () => {
  const h1 = frame().locator('h1');
  await expect(h1).toBeVisible();
  // Not "the page looks right": the attribute the whole editor is built on is present.
  await expect(h1).toHaveAttribute('data-sve-loc', HERO_H1_LOC);

  // And it is genuinely another origin — the studio's own document does not contain it.
  await expect(page.locator('h1')).toHaveCount(0);
  await expect(page.locator('.sv-preview__bar')).toContainText('connected');
});

test('AC-15.6 there is one inspector, and it is the studio\'s', async () => {
  // AC-15.2 in a browser. Playwright's CSS engine pierces open shadow roots, so this
  // reaches inside the overlay's own chrome — and finds no panel there, because the
  // framed mount never created one.
  await expect(frame().locator('.sve-panel')).toHaveCount(0);
  await expect(page.locator('.sv-diagnostic')).toBeVisible();
});

/* ── a click in the frame is a diagnostic in the studio ───────────────────── */

test('AC-15.6 clicking an element in the frame moves the studio\'s diagnostic', async () => {
  await expect(page.locator('.sv-diagnostic')).toContainText('Nothing selected');

  await frame().locator('h1').click();

  const [file, line, column] = HERO_H1_LOC.split(':');
  await expect(coordFile()).toHaveText(file!);
  await expect(coordPos()).toHaveText(`${line}:${column}`);
});

test('AC-15.6 the excerpt is the bytes on disk, with the caret under the exact column', async () => {
  const [line, column] = HERO_H1_LOC.split(':').slice(1).map(Number) as [number, number];

  // The excerpt strip carries the target line verbatim...
  const target = page.locator('.sv-excerpt__line[data-target="true"]');
  await expect(target.locator('.sv-excerpt__no')).toHaveText(String(line));
  const rendered = await target.locator('.sv-excerpt__text').textContent();
  const onDisk = readFixtureLines(HERO, STUDIO_FIXTURE_ROOT)[line - 1];
  expect(rendered).toBe(onDisk);

  // ...and the caret's pad is exactly the columns before the stamp, so the marker lands
  // on the `<` of the element the user clicked and not near it.
  const pad = (await page.locator('.sv-caret-pad').textContent()) ?? '';
  expect(pad).toHaveLength(column - 1);
  expect(onDisk!.slice(column - 1)).toMatch(/^<h1\b/);
  await expect(page.locator('.sv-caret')).toHaveText('^');
});

/* ── the edit, the write, and the verdict ─────────────────────────────────── */

const WANTED = 'Five of six beaches are swimmable this morning.';

test('AC-15.6 an edit typed in the studio is an override inside the frame', async () => {
  await textField().fill(WANTED);

  // The illusion is painted in the *other* document, by the overlay that never left it —
  // and it is painted before anything has been written.
  await expect(frame().locator('h1')).toHaveText(WANTED);
  expect(readFixture(HERO, STUDIO_FIXTURE_ROOT)).toBe(
    snapshot.get(fixturePath(HERO, STUDIO_FIXTURE_ROOT))!.toString('utf8'),
  );
  await expect(rows()).toHaveCount(0);
});

test('AC-15.6 Apply reaches a verdict, and the file agrees with it', async () => {
  test.setTimeout(120_000);
  await applyButton().click();

  // A verdict, whichever way it went — and it is `landed`, because the file changed and
  // hot reload rendered what the intent asked for.
  const row = rows().first();
  await expect(row).toHaveAttribute('data-status', 'landed', { timeout: 90_000 });
  await expect(row.locator('.sv-row__loc')).toHaveText(HERO_H1_LOC);
  await expect(row.locator('.sv-row__origin')).toHaveText('click');

  // The write landed on the line that carries the text, and on no other line.
  const before = snapshot
    .get(fixturePath(HERO, STUDIO_FIXTURE_ROOT))!
    .toString('utf8')
    .split(/\r\n|\n|\r/);
  const after = readFixtureLines(HERO, STUDIO_FIXTURE_ROOT);
  expect(after).toHaveLength(before.length);
  const changed = before.flatMap((text, index) => (after[index] === text ? [] : [index]));
  expect(changed).toEqual([HERO_H1_TEXT_LINE - 1]);
  expect(after[HERO_H1_TEXT_LINE - 1]!.trim()).toBe(WANTED);

  // And the override was lifted: what the frame shows now is React's own render.
  await expect(frame().locator('h1')).toHaveText(WANTED);
});
