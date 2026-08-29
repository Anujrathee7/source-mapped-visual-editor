import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import {
  CRLF_FILE,
  fixturePath,
  readFixture,
  readFixtureLines,
  restoreFixture,
  snapshotFixture,
  type FixtureSnapshot,
} from './fixture.js';
import {
  apply,
  caret,
  excerpt,
  armFake,
  applyButton,
  blastRadius,
  classField,
  coordFile,
  coordPos,
  hmrUpdates,
  jobEvents,
  panel,
  revertButton,
  select,
  styleField,
  textField,
  verdict,
  watchDevServer,
  writtenLocs,
} from './editor.js';

/**
 * AC-5 — the verification loop, end to end.
 *
 * "Hot reload returning the same result is the proof the edit landed." These run against a
 * throwaway copy of `apps/demo` with the editor live (see `e2e/fixture.ts`), and they
 * write real files: a coding agent is the only thing in this system allowed to touch disk,
 * and there is no way to test that without letting it.
 *
 * Every test snapshots the fixture's `src/` before it runs and restores it afterwards,
 * whether it passed or not. `SVE_AGENT=fake` throughout; the mode is chosen per job with
 * an `[sve:fake=…]` token, so nothing here restarts a server to change an outcome.
 */

const HERO = 'src/components/Hero.tsx';
const METHOD = 'src/components/Method.tsx';
const CARD = 'src/components/BeachCard.tsx';

/** Where the hero heading is stamped, and where the text it renders actually lives. */
const HERO_H1_LOC = `${HERO}:17:11`;
const HERO_H1_TEXT_LINE = 21;

let snapshot: FixtureSnapshot;

test.beforeEach(async ({ page }) => {
  snapshot = snapshotFixture();
  await watchDevServer(page);
  await page.goto('/');
  await expect(page.locator('h1')).toBeVisible();
});

test.afterEach(async () => {
  // Unconditional: a test that fails halfway must not leave the fixture edited, or the
  // next one is measuring the last one's agent.
  restoreFixture(snapshot);
});

/** The one changed line, and proof that it was the only one. */
function soleChange(relative: string, before: FixtureSnapshot): { line: number; text: string } {
  const original = before.get(fixturePath(relative));
  const originalText = (original ?? readFileSync(fixturePath(relative))).toString('utf8');
  const was = originalText.split(/\r\n|\n|\r/);
  const now = readFixtureLines(relative);

  expect(now).toHaveLength(was.length);
  const changed = was.flatMap((line, index) => (now[index] === line ? [] : [index]));
  expect(changed).toHaveLength(1);
  return { line: changed[0]! + 1, text: now[changed[0]!]! };
}

const heroH1 = (page: Page) => page.locator('h1');

/* ── AC-5.1 — happy path ──────────────────────────────────────────────────── */

test('AC-5.1 a text edit lands, and the file says so', async ({ page }) => {
  const applyCalls: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/__sve/apply')) applyCalls.push(request.url());
  });

  const h1 = heroH1(page);
  await select(page, h1);

  // The inspector's coordinate is the element's own stamp, not a guess.
  await expect(coordFile(page)).toHaveText(HERO);
  await expect(coordPos(page)).toHaveText('17:11');
  expect(await h1.getAttribute('data-sve-loc')).toBe(HERO_H1_LOC);

  const wanted = 'Five of six beaches are swimmable this morning.';
  await textField(page).fill(wanted);

  // The DOM changes before anything crosses the wire: the override is the preview.
  await expect(h1).toHaveText(wanted);
  expect(applyCalls).toEqual([]);

  const before = await hmrUpdates(page);
  await apply(page, 'landed');

  // The file on disk changed, at the line that carries the text — and nowhere else.
  const change = soleChange(HERO, snapshot);
  expect(change.line).toBe(HERO_H1_TEXT_LINE);
  expect(change.text.trim()).toBe(wanted);

  // Hot reload fired.
  expect(await hmrUpdates(page)).toBeGreaterThan(before);

  // The override was lifted: no rule for this eid is left in the injected stylesheet.
  const eid = await h1.getAttribute('data-sve-eid');
  const sheet = await page.locator('style[data-sve-overrides]').textContent();
  expect(sheet ?? '').not.toContain(eid ?? 'no-eid');

  // …and no re-assertion observer is still watching it: something else can now write to
  // the element and the overlay will leave it alone.
  await h1.evaluate((element) => {
    element.textContent = 'written by the test';
  });
  await page.waitForTimeout(200);
  await expect(h1).toHaveText('written by the test');

  // The page reloads from the file, so what the agent wrote is what renders.
  await page.reload();
  await expect(heroH1(page)).toHaveText(wanted);
  expect(applyCalls).toHaveLength(1);
});

/* ── AC-5.2 — the verifier actually verifies ──────────────────────────────── */

/**
 * The criterion the milestone turns on. Without it, AC-5.1 proves nothing: a verifier that
 * always reports green passes it too.
 *
 * The agent is told to write `Ship Faster` where the intent said `Ship faster`. A loop that
 * read the DOM without lifting its own override first would read `Ship faster` — its own
 * paint — and call this landed.
 */
test('AC-5.2 a wrong write is caught, shown, and left in place', async ({ page }) => {
  const h1 = heroH1(page);
  await select(page, h1);

  await textField(page).fill('Ship faster');
  await armFake(page, 'wrong');
  await apply(page, 'drifted');

  // Both sides, on the panel.
  const shown = (await verdict(page).textContent()) ?? '';
  expect(shown).toContain('Drifted');
  expect(shown).toContain('Ship faster');
  expect(shown).toContain('Ship Faster');

  // The override is back, so the user still sees what they asked for.
  await expect(h1).toHaveText('Ship faster');

  // The file is left exactly as the agent wrote it.
  const change = soleChange(HERO, snapshot);
  expect(change.line).toBe(HERO_H1_TEXT_LINE);
  expect(change.text).toContain('Ship Faster');

  // And Revert is offered.
  await expect(revertButton(page)).toBeVisible();
});

/* ── AC-5.3 — computed values, not source text ────────────────────────────── */

test.describe('AC-5.3 a class edit verifies by computed value', () => {
  /** `<h3 className="text-lg text-kelp-lift">Safe</h3>` — Method.tsx:24:13. */
  const safeHeading = (page: Page) => page.getByRole('heading', { name: 'Safe', exact: true });

  test('lands when the agent writes different source that resolves the same', async ({
    page,
  }) => {
    const heading = safeHeading(page);
    await select(page, heading);

    const was = await heading.evaluate((el) => getComputedStyle(el).color);
    // Drop the colour class. The override resets what it declared, so the heading falls
    // back to the colour it inherits — which is the colour the intent now records.
    await classField(page).fill('text-lg');
    await armFake(page, 'equivalent');
    await expect
      .poll(async () => heading.evaluate((el) => getComputedStyle(el).color))
      .not.toBe(was);
    const intended = await heading.evaluate((el) => getComputedStyle(el).color);

    await apply(page, 'landed');

    // Source text the overlay never sent; the same resolved colour.
    const source = readFixture(METHOD);
    expect(source).toMatch(/text-\[#[0-9a-f]{6}\]/);
    expect(source).not.toContain('text-kelp-lift');
    await expect
      .poll(async () => safeHeading(page).evaluate((el) => getComputedStyle(el).color))
      .toBe(intended);
  });

  test('drifts when the agent writes a plausible class of a different colour', async ({
    page,
  }) => {
    const heading = safeHeading(page);
    await select(page, heading);

    await classField(page).fill('text-lg');
    await armFake(page, 'wrong');
    await apply(page, 'drifted');

    const shown = (await verdict(page).textContent()) ?? '';
    expect(shown).toContain('Drifted');
    expect(shown).toContain('color');
    // The class it wrote is as plausible as the right one; only the colour differs.
    expect(readFixture(METHOD)).toMatch(/text-\[#[0-9a-f]{6}\]/);
  });
});

/* ── AC-5.4 — re-anchoring across the agent's own line shift ──────────────── */

test('AC-5.4 the element is found again after its own line moved', async ({ page }) => {
  const h1 = heroH1(page);
  await select(page, h1);

  const before = readFixtureLines(HERO).length;
  await textField(page).fill('Five of six beaches are swimmable this morning.');
  // This mode writes correctly and adds a line above the element, moving it down one.
  await armFake(page, 'verbose');
  await apply(page, 'landed');

  expect(readFixtureLines(HERO)).toHaveLength(before + 1);

  // The element is still found by eid, and now reports the new line.
  const moved = heroH1(page);
  await expect(moved).toHaveAttribute('data-sve-loc', `${HERO}:18:11`);
  // …and the inspector says the same thing.
  await expect(coordPos(page)).toHaveText('18:11');

  // A second edit, immediately, targets the new line and not the stale one.
  await textField(page).fill('Six of six beaches are swimmable this morning.');
  await apply(page, 'landed');

  const locs = await writtenLocs(page);
  expect(locs).toEqual([`${HERO}:17:11`, `${HERO}:18:11`]);
  expect(readFixtureLines(HERO)[HERO_H1_TEXT_LINE]!.trim()).toBe(
    'Six of six beaches are swimmable this morning.',
  );
});

/* ── AC-5.5 — shared instances ────────────────────────────────────────────── */

test('AC-5.5 six cards from one line change together, and land once', async ({ page }) => {
  const cards = page.getByRole('article');
  await expect(cards).toHaveCount(6);
  // The card's own top padding: the middle of a card belongs to one of its children.
  await select(page, cards.first(), { x: 24, y: 4 });

  await expect(coordFile(page)).toHaveText(CARD);
  await expect(coordPos(page)).toHaveText('25:5');
  await expect(blastRadius(page)).toHaveText(
    '6 elements render from this line — the edit hits all 6.',
  );

  const wanted = 'rgb(255, 90, 31)';
  await styleField(page, 'backgroundColor').fill(wanted);

  // Before Apply: all six show the override (AC-4.6).
  const colours = async (): Promise<string[]> =>
    page.getByRole('article').evaluateAll((all) => all.map((el) => getComputedStyle(el).backgroundColor));
  await expect.poll(colours).toEqual(Array<string>(6).fill(wanted));

  await apply(page, 'landed');

  // After the write: all six render it from source, with no override left anywhere.
  const sheet = await page.locator('style[data-sve-overrides]').textContent();
  expect((sheet ?? '').trim()).toBe('');
  expect(readFixture(CARD)).toContain(`backgroundColor: '${wanted}'`);
  await expect.poll(colours).toEqual(Array<string>(6).fill(wanted));

  // One line edited, one job, one verdict — not six.
  soleChange(CARD, snapshot);
  const jobs = new Set((await jobEvents(page)).map((event) => event.jobId));
  expect(jobs.size).toBe(1);
  await expect(verdict(page)).toHaveCount(1);
});

/* ── AC-5.6 — blocked is a first-class outcome ────────────────────────────── */

test('AC-5.6 a refusal keeps the file and the intent', async ({ page }) => {
  const h1 = heroH1(page);
  await select(page, h1);

  await textField(page).fill('Ship faster');
  await armFake(page, 'blocked');
  await apply(page, 'blocked');

  // The message states the reason.
  expect((await verdict(page).textContent()) ?? '').toMatch(/BLOCKED: .+/);
  await expect(applyButton(page)).toHaveText('Blocked');

  // The file is byte-for-byte unchanged.
  expect(restoreFixture(snapshot)).toEqual([]);

  // The override stays, so the user's intent is not silently lost.
  await expect(h1).toHaveText('Ship faster');
});

/* ── AC-5.7 — stalled is detected, not hung ───────────────────────────────── */

test('AC-5.7 a write that never happened is reported, not waited on', async ({ page }) => {
  const h1 = heroH1(page);
  await select(page, h1);

  await textField(page).fill('Ship faster');
  // Reports success, writes nothing, so no hot reload will ever fire.
  await armFake(page, 'noop');

  const started = Date.now();
  await apply(page, 'stalled');
  // The overlay must not wait forever — and it must not wait out its own timeout either
  // when the bridge already knows nothing was written.
  expect(Date.now() - started).toBeLessThan(10_000);

  expect((await verdict(page).textContent()) ?? '').toContain('The file did not change');
  expect(restoreFixture(snapshot)).toEqual([]);
  await expect(h1).toHaveText('Ship faster');
});

/* ── AC-5.8 — revert ──────────────────────────────────────────────────────── */

test('AC-5.8 revert restores a CRLF file byte for byte', async ({ page }) => {
  const original = readFileSync(fixturePath(CRLF_FILE));
  // The fixture builds this file with CRLF terminators on purpose (AC-3.2).
  expect(original.includes(Buffer.from('\r\n'))).toBe(true);

  const heading = page.getByRole('heading', { name: 'Safe', exact: true });
  await select(page, heading);
  await textField(page).fill('Calm');
  await apply(page, 'landed');

  await expect(page.getByRole('heading', { name: 'Calm', exact: true })).toBeVisible();
  expect(Buffer.compare(readFileSync(fixturePath(CRLF_FILE)), original)).not.toBe(0);

  await revertButton(page).click();
  await expect(verdict(page)).toHaveAttribute('data-status', 'reverted');

  // Byte for byte, CRLF and all.
  expect(Buffer.compare(readFileSync(fixturePath(CRLF_FILE)), original)).toBe(0);
  // The override is cleared and the element is what it was before the edit.
  const sheet = await page.locator('style[data-sve-overrides]').textContent();
  expect((sheet ?? '').trim()).toBe('');
  await expect(page.getByRole('heading', { name: 'Safe', exact: true })).toBeVisible();
});

/* ── AC-5.9 — serial application under concurrent user input ──────────────── */

test('AC-5.9 three edits to one file all land, none on a stale line', async ({ page }) => {
  const targets = [
    { locator: page.locator('h1'), loc: `${HERO}:17:11`, text: 'Five of six are swimmable.' },
    {
      locator: page.getByText('Next safe window', { exact: true }),
      loc: `${HERO}:30:13`,
      text: 'Next good window',
    },
    {
      locator: page.getByText('At the harbour gauge', { exact: true }),
      loc: `${HERO}:41:11`,
      text: 'At the harbour buoy',
    },
  ];

  // Pressed in rapid succession, without waiting for any of them to finish.
  for (const target of targets) {
    await select(page, target.locator);
    await textField(page).fill(target.text);
    await applyButton(page).click();
  }

  await expect.poll(async () => (await writtenLocs(page)).length, { timeout: 60_000 }).toBe(3);

  // Each ran against the file as it stood, at the line it was stamped at.
  expect(await writtenLocs(page)).toEqual(targets.map((target) => target.loc));

  // None was silently dropped: all three changes are in the final file.
  const lines = readFixtureLines(HERO);
  expect(lines[HERO_H1_TEXT_LINE - 1]!.trim()).toBe(targets[0]!.text);
  expect(lines[29]).toContain(targets[1]!.text);
  expect(lines[40]).toContain(targets[2]!.text);

  const jobs = new Set((await jobEvents(page)).map((event) => event.jobId));
  expect(jobs.size).toBe(3);
});

/* ── the panel itself ─────────────────────────────────────────────────────── */

test('the editor is injected by the dev server, not wired in by the app', async ({ page }) => {
  // Nothing in the page imports it; the overlay is simply there.
  await expect(page.locator('[data-sve-overlay]')).toHaveCount(1);
  await expect(panel(page)).toBeHidden();
  await select(page, page.locator('h1'));
  await expect(panel(page)).toBeVisible();
});

/* ── the excerpt is source, not the transformed module ────────────────────── */

/**
 * AC-4.8 asks for "a source excerpt". The dev server's own module graph cannot supply one:
 * requesting the module returns JSX already lowered to a props object, carrying the very
 * data-sve-* attributes the editor added, and a caret under column 11 of *that* points at
 * nothing a developer ever wrote. Regressing to the module URL would still render a
 * plausible-looking strip of code, which is exactly why this is asserted.
 */
test('the excerpt shows the file as written, not the transformed module', async ({
  page,
}) => {
  await select(page, heroH1(page));

  const shown = (await excerpt(page).textContent()) ?? '';

  // What the source says at the target.
  expect(shown).toContain('<h1');
  // What the transformed module would have said instead.
  expect(shown).not.toContain('data-sve-loc');
  expect(shown).not.toContain('jsxDEV');
  expect(shown).not.toContain('createElement');

  // The caret is present and sits under a real column.
  await expect(caret(page).first()).toBeVisible();
});
