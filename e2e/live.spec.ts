import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import {
  fixturePath,
  readFixture,
  readFixtureLines,
  restoreFixture,
  snapshotFixture,
  type FixtureSnapshot,
} from './fixture.js';
import {
  apply,
  classField,
  coordPos,
  select,
  textField,
  verdict,
  watchDevServer,
} from './editor.js';

/**
 * AC-6.7 / AC-5.10 — the live-agent suite.
 *
 * The same loop as `verification.spec.ts`, driven by the real Claude Agent SDK
 * instead of the scripted fake: AC-5.1 (a text edit lands), AC-5.3 (a class edit
 * verifies by computed value) and AC-5.6 (a refusal is a first-class outcome).
 *
 * **It costs tokens, so it never runs in CI and never runs implicitly.** It is
 * skipped unless `SVE_AGENT=claude`, which is also what the fixture server needs
 * to be running with for these to mean anything — see `playwright.config.ts`,
 * which swaps the whole editor project over rather than pointing two suites with
 * different agents at one server. `npm run e2e:live` sets it.
 *
 * Everything here asserts on **outcome**: the status reached, the file changed at
 * the expected element, the file untouched on a refusal. Nothing asserts on diff
 * text or on the agent's phrasing. A real model's wording is not deterministic,
 * and a suite that pinned it would be flaky by construction — it would also be
 * testing the model rather than this system's contract with it.
 */

test.skip(
  process.env['SVE_AGENT'] !== 'claude',
  'the live-agent suite spends tokens: run it with SVE_AGENT=claude (npm run e2e:live).',
);

const HERO = 'src/components/Hero.tsx';
const METHOD = 'src/components/Method.tsx';

/** Where the hero heading is stamped, and where the text it renders actually lives. */
const HERO_H1_TEXT_LINE = 21;

/** A real model thinks, reads and writes. Generous, and still a bound. */
const AGENT_TIMEOUT = 240_000;

let snapshot: FixtureSnapshot;

test.beforeEach(async ({ page }) => {
  test.setTimeout(AGENT_TIMEOUT + 60_000);
  snapshot = snapshotFixture();
  await watchDevServer(page);
  await page.goto('/');
  await expect(page.locator('h1')).toBeVisible();
});

test.afterEach(async () => {
  // Unconditional, exactly as in the fake suite: a test that fails halfway must
  // not leave the fixture edited for the next one.
  restoreFixture(snapshot);
});

const heroH1 = (page: Page) => page.locator('h1');

/* ── AC-5.1 — a text edit lands ───────────────────────────────────────────── */

test('AC-5.1 live: a text edit lands at the stamped element', async ({ page }) => {
  const h1 = heroH1(page);
  await select(page, h1);
  await expect(coordPos(page)).toHaveText('17:11');

  const wanted = 'Five of six beaches are swimmable this morning.';
  await textField(page).fill(wanted);
  await expect(h1).toHaveText(wanted);

  await apply(page, 'landed', AGENT_TIMEOUT);

  // The file changed, at the line that carries this element's text.
  expect(readFixtureLines(HERO)[HERO_H1_TEXT_LINE - 1]).toContain(wanted);
  // …and the page, re-rendered from that file with the override lifted, agrees.
  await expect(heroH1(page)).toHaveText(wanted);
});

/* ── AC-5.3 — a class edit verifies by computed value ─────────────────────── */

test('AC-5.3 live: a class edit lands on the computed value', async ({ page }) => {
  const heading = page.getByRole('heading', { name: 'Safe', exact: true });
  await select(page, heading);

  const was = await heading.evaluate((el) => getComputedStyle(el).color);
  // Dropping the colour class lets the heading fall back to what it inherits,
  // which is the colour the intent then records.
  await classField(page).fill('text-lg');
  await expect.poll(async () => heading.evaluate((el) => getComputedStyle(el).color)).not.toBe(was);
  const intended = await heading.evaluate((el) => getComputedStyle(el).color);

  await apply(page, 'landed', AGENT_TIMEOUT);

  // The colour class is gone from the source — whatever the agent wrote in its
  // place is its business, and asserting the exact text would be asserting
  // phrasing. What must hold is the resolved value.
  expect(readFixture(METHOD)).not.toContain('text-kelp-lift');
  await expect
    .poll(async () =>
      page
        .getByRole('heading', { name: 'Safe', exact: true })
        .evaluate((el) => getComputedStyle(el).color),
    )
    .toBe(intended);
});

/* ── AC-5.6 — blocked is a first-class outcome ────────────────────────────── */

/**
 * A refusal, driven the only way a live agent can honestly be made to refuse.
 *
 * The overlay always describes the element it just read, so through the UI the
 * description always matches. The browser is untrusted input, though, and the
 * bridge accepts any schema-valid intent — so this posts one whose `before`
 * describes text the element does not contain. Rule 4 of the prompt covers
 * exactly that case: write nothing, reply `BLOCKED: <reason>`.
 *
 * The assertion is on the outcome, not on the reason's wording.
 */
test('AC-5.6 live: an element that is not what was described is refused', async ({ page }) => {
  const h1 = heroH1(page);
  const loc = await h1.getAttribute('data-sve-loc');
  const eid = await h1.getAttribute('data-sve-eid');
  expect(loc).toBeTruthy();
  expect(eid).toBeTruthy();

  const before = readFileSync(fixturePath(HERO));

  const result = await page.evaluate(
    async ([locValue, eidValue]) => {
      const response = await fetch('/__sve/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          intents: [
            {
              eid: eidValue,
              eidIndex: 0,
              loc: locValue,
              tag: 'h1',
              kind: 'text',
              before: {
                text: 'This heading says something it has never said.',
                classes: [],
                computed: {},
              },
              after: { text: 'Nor this.', classes: [], computed: {} },
              instruction: 'Replace the heading text with "Nor this.".',
            },
          ],
        }),
      });
      return (await response.json()) as { results: { status: string; message?: string }[] };
    },
    [loc!, eid!] as const,
  );

  expect(result.results[0]!.status).toBe('blocked');
  expect(result.results[0]!.message ?? '').toMatch(/BLOCKED: .+/);

  // Nothing was written.
  expect(readFileSync(fixturePath(HERO))).toEqual(before);
  // And the page is untouched, so no verdict was ever painted onto it.
  await expect(verdict(page)).toHaveCount(0);
});
