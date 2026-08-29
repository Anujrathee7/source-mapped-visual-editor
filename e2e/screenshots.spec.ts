/**
 * Regenerates the images in the README.
 *
 * Not part of the suite — it asserts almost nothing and writes into `docs/images/`. It
 * runs under its own config (`playwright.shots.config.ts`) so a documentation refresh can
 * never be mistaken for a passing verification run, and so CI never spends time on it:
 *
 *   npx playwright test --config playwright.shots.config.ts
 *
 * It drives the editor exactly as the AC-5 tests do, through `e2e/editor.ts`, because a
 * screenshot posed by hand is a screenshot that stops being true.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  apply,
  armFake,
  applyButton,
  panel,
  select,
  textField,
  verdict,
  watchDevServer,
} from './editor.js';
import { REPO_ROOT, prepareFixture, restoreFixture, snapshotFixture } from './fixture.js';

const IMAGES = path.join(REPO_ROOT, 'docs', 'images');
const shot = (name: string) => path.join(IMAGES, `${name}.png`);

const heroH1 = (page: Page) => page.locator('h1');

let snapshot: ReturnType<typeof snapshotFixture>;

test.beforeAll(() => {
  mkdirSync(IMAGES, { recursive: true });
  prepareFixture();
});

test.beforeEach(async ({ page }) => {
  snapshot = snapshotFixture();
  await watchDevServer(page);
  await page.goto('/');
});

test.afterEach(() => {
  restoreFixture(snapshot);
});

test('the page under edit', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await expect(heroH1(page)).toBeVisible();
  // Let the tide ribbon finish laying out before it is photographed.
  await page.waitForTimeout(600);
  await page.screenshot({ path: shot('demo'), fullPage: false });
});

test('the inspector, selected', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await select(page, heroH1(page));
  await expect(panel(page)).toBeVisible();

  await page.screenshot({ path: shot('selected') });
  await panel(page).screenshot({ path: shot('inspector') });
});

test('landed', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await select(page, heroH1(page));
  await textField(page).fill('Five of six beaches are swimmable this morning.');
  await expect(heroH1(page)).toHaveText('Five of six beaches are swimmable this morning.');

  await applyButton(page).click();
  await expect(verdict(page)).toHaveAttribute('data-status', 'landed', { timeout: 30_000 });
  await panel(page).screenshot({ path: shot('landed') });
});

test('drifted', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await select(page, heroH1(page));

  // The agent is told to write `Ship Faster` where the intent said `Ship faster`.
  await armFake(page, 'wrong');
  await textField(page).fill('Ship faster');
  await apply(page, 'drifted');

  await panel(page).screenshot({ path: shot('drifted') });
  await page.screenshot({ path: shot('drifted-page') });
});
