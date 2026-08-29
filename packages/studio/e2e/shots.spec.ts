/**
 * The images of the studio in `docs/images/`, in both modes (AC-16.1).
 *
 * Not part of the suite — see `../playwright.shots.config.ts`. It drives the workspace the
 * way `e2e/studio.spec.ts` drives it, through the same fixture and the same real
 * cross-origin frame, because a screenshot posed by hand is a screenshot that stops being
 * true. Every pixel here is the studio actually running: a real project served by
 * `@sve/host`, a real click in the frame, a real write, and the verdict hot reload gave it.
 *
 * Both modes are photographed from the same page in the same state, one toggle apart, so
 * the pair is a comparison rather than two sessions that happen to look similar.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { REPO_ROOT } from '../../../e2e/fixture.js';
import { SHOTS_FIXTURE_ROOT, prepareShotsFixture } from './shots.fixture.js';

const IMAGES = path.join(REPO_ROOT, 'docs', 'images');
const shot = (name: string): string => path.join(IMAGES, `${name}.png`);

/** The host clones nothing here, but it does install and start a dev server. */
const CONNECT_TIMEOUT_MS = 180_000;

let page: Page;

const frame = (): ReturnType<Page['frameLocator']> => page.frameLocator('iframe.sv-preview__frame');

/** Photograph the page, then the same page one toggle away, then put it back. */
async function bothModes(name: string): Promise<void> {
  await page.screenshot({ path: shot(`${name}-light`) });
  await page.locator('.sv-theme').first().click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: shot(`${name}-dark`) });
  await page.locator('.sv-theme').first().click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
}

test.beforeAll(async ({ browser }) => {
  mkdirSync(IMAGES, { recursive: true });
  prepareShotsFixture();

  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(60_000);
  await page.goto('/');
  // Light first, whatever this machine's preference is, so the pair is always in the same
  // order and the toggle is what changes between the two files.
  await page.evaluate(() => window.localStorage.setItem('sve.studio.theme', 'light'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test.afterAll(async () => {
  // Nothing to restore: the copy is made fresh on every run and belongs to this file.
  await page?.close();
});

test('the connect card', async () => {
  await expect(page.locator('.sv-connect__card')).toBeVisible();
  await bothModes('studio-connect');
});

test('the workspace, with a landed change', async () => {
  test.setTimeout(CONNECT_TIMEOUT_MS + 120_000);

  await page.getByLabel('Folder path or repository URL').fill(SHOTS_FIXTURE_ROOT);
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.locator('iframe.sv-preview__frame')).toBeVisible({
    timeout: CONNECT_TIMEOUT_MS,
  });

  // A real selection: the diagnostic fills in because the frame told it where the h1 is.
  // The overlay inside the frame mounts a moment after the frame is visible, so the click
  // waits for the stamp it is about to be told about, and is worth repeating if it lands
  // in the gap.
  const heading = frame().locator('h1');
  await expect(heading).toHaveAttribute('data-sve-loc', /Hero\.tsx/);
  await expect(async () => {
    await heading.click();
    await expect(page.locator('.sv-excerpt')).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });

  // A real edit, a real write, and the verdict hot reload gave it.
  await page.locator('#sv-field-text').fill('Five of six beaches are swimmable this morning.');
  await page.locator('.sv-diagnostic .sv-button--primary').click();
  await expect(page.locator('.sv-log .sv-row').first()).toHaveAttribute('data-status', 'landed', {
    timeout: 90_000,
  });

  // And something in the transcript, so the third panel is not photographed empty.
  await page.locator('#sv-compose').fill('set the text of the h1 to "Swim today"');
  await page.locator('#sv-compose').press('Enter');
  await page
    .locator('.sv-turn')
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 })
    .catch(() => undefined);

  await bothModes('studio');
  await page.locator('.sv-diagnostic').screenshot({ path: shot('studio-diagnostic-light') });
  await page.locator('.sv-theme').first().click();
  await page.locator('.sv-diagnostic').screenshot({ path: shot('studio-diagnostic-dark') });
});
