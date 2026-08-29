/**
 * Driving the editor from a test, and watching what the dev server does about it.
 *
 * The overlay lives in a shadow root; Playwright's CSS engine pierces open shadow roots, so
 * `.sve-panel` and friends address the chrome directly and nothing here reaches into the
 * page's internals.
 */
import { expect, type Locator, type Page } from '@playwright/test';

export interface JobEvent {
  jobId: string;
  phase: string;
  detail?: string;
  tool?: string;
}

/**
 * Two things the page cannot otherwise be asked about, recorded from before the first
 * script runs:
 *
 *  - **hot reload fired.** Vite's HMR client keeps its event bus to itself, so the
 *    observable signal is the `update` message on its own websocket. Counting those is
 *    direct evidence that a module update reached the browser (AC-5.1).
 *  - **which line each job wrote.** The bridge's progress stream carries the loc the job
 *    actually used, which is how AC-5.4 and AC-5.9 can assert that a second edit targeted
 *    the *new* line rather than merely that it succeeded.
 */
export async function watchDevServer(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const scope = window as unknown as { __sveHmr: number; __sveJobs: JobEvent[] };
    scope.__sveHmr = 0;
    scope.__sveJobs = [];

    const Native = window.WebSocket;
    class Recording extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        this.addEventListener('message', (event: MessageEvent<unknown>) => {
          const data = event.data;
          if (typeof data === 'string' && data.includes('"type":"update"')) scope.__sveHmr += 1;
        });
      }
    }
    window.WebSocket = Recording as unknown as typeof WebSocket;

    if (location.protocol.startsWith('http')) {
      const events = new EventSource('/__sve/events');
      events.addEventListener('progress', (event) => {
        scope.__sveJobs.push(JSON.parse((event as MessageEvent<string>).data) as JobEvent);
      });
    }
  });
}

export const hmrUpdates = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { __sveHmr: number }).__sveHmr);

export const jobEvents = (page: Page): Promise<JobEvent[]> =>
  page.evaluate(() => (window as unknown as { __sveJobs: JobEvent[] }).__sveJobs);

/** The loc each job reported while writing, in job order. */
export async function writtenLocs(page: Page): Promise<string[]> {
  const events = await jobEvents(page);
  return events.filter((event) => event.phase === 'writing').map((event) => event.detail ?? '');
}

/* ── the chrome ───────────────────────────────────────────────────────────── */

export const panel = (page: Page): Locator => page.locator('.sve-panel');
export const coordFile = (page: Page): Locator => page.locator('.sve-coord__file');
export const coordPos = (page: Page): Locator => page.locator('.sve-coord__pos');
export const textField = (page: Page): Locator => page.locator('input[data-sve-field="text"]');
export const classField = (page: Page): Locator => page.locator('input[data-sve-field="class"]');
export const styleField = (page: Page, prop: string): Locator =>
  page.locator(`input[data-sve-style="${prop}"]`);
export const applyButton = (page: Page): Locator => page.locator('.sve-apply');
export const revertButton = (page: Page): Locator => page.locator('.sve-revert');
export const verdict = (page: Page): Locator => page.locator('.sve-verdict');
export const blastRadius = (page: Page): Locator => page.locator('.sve-blast');

/**
 * Clicks an element in the page under edit, and waits for the inspector to catch up.
 *
 * `position` matters more than it looks. A click lands on whatever is under the pointer,
 * and the overlay selects the nearest stamped ancestor of that — so clicking the middle of
 * a card selects whichever child happens to sit there, not the card. Aiming at a
 * container's own padding is how you select the container.
 */
export async function select(
  page: Page,
  target: Locator,
  position?: { x: number; y: number },
): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  await target.click(position ? { position } : {});
  await expect(panel(page)).toBeVisible();
}

/**
 * Arms the fake agent for the next job.
 *
 * `fake.ts` reads `[sve:fake=<mode>]` from the instruction, and also from the recorded
 * class list — which is the only channel a class edit has, since its instruction is
 * generated from the classes themselves. Appending the token rather than replacing the
 * field matters: the class editor treats every class the user drops as a removal.
 */
export async function armFake(page: Page, mode: string): Promise<void> {
  const field = classField(page);
  const current = await field.inputValue();
  await field.fill(`${current} [sve:fake=${mode}]`.trim());
}

/** Presses Apply and waits for a verdict, whichever way it went. */
export async function apply(page: Page, status: string, timeout = 30_000): Promise<void> {
  await applyButton(page).click();
  await expect(verdict(page)).toHaveAttribute('data-status', status, { timeout });
}
