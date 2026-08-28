import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

/**
 * AC-2.5 — the demo stands up on its own.
 *
 * No editor, no overlay, no bridge: this suite is the proof that `apps/demo` is a plain
 * React page that happens to be the fixture, and it must keep passing on a checkout where
 * the editor does not exist yet.
 */

/** Console errors and uncaught exceptions, collected from before the first navigation. */
function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') problems.push(`console.error: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

test.describe('demo page', () => {
  test('renders the morning call with no console errors', async ({ page }) => {
    const problems = watchConsole(page);

    await page.goto('/');

    // Exactly one h1, and it says something.
    const h1 = page.locator('h1');
    await expect(h1).toHaveCount(1);
    await expect(h1).toBeVisible();
    expect((await h1.innerText()).trim().length).toBeGreaterThan(0);

    // Six beach cards, off one `.map()`.
    const cards = page.getByRole('article');
    await expect(cards).toHaveCount(6);

    // Every card carries a verdict, and it is one of the two words the page defines.
    for (const card of await cards.all()) {
      await expect(card.getByText(/^(Safe|Marginal)$/)).toHaveCount(1);
    }

    // The hero's next-window string is computed, not markup: it must not be the source
    // expression, and it must carry a real clock time.
    const nextWindow = page.locator('section[aria-labelledby="verdict"] #next-window');
    await expect(nextWindow).toBeVisible();
    const text = (await nextWindow.innerText()).trim();
    expect(text).not.toContain('{nextWindow}');
    expect(text).toMatch(/\d{2}:\d{2}/);

    expect(problems).toEqual([]);
  });

  // AC-2.4's one machine-checkable clause. The cards, the chip row and the tide ribbon
  // are the three things that would push the body wide, so 375 is where it is checked.
  test('fits a 375 px viewport without horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('the tide ribbon follows the selected beach', async ({ page }) => {
    await page.goto('/');

    const chip = page.getByRole('button', { name: 'The Cauldron' });
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');

    await expect(page.getByRole('figure')).toContainText('The Cauldron');
  });
});
