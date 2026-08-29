import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test, type Frame, type Locator, type Page } from '@playwright/test';
import {
  REPO_ROOT,
  fixturePath,
  readFixtureLines,
  restoreFixture,
  snapshotFixture,
  type FixtureSnapshot,
} from './fixture.js';
import {
  HERO,
  HERO_GAUGE_LOC,
  HERO_GAUGE_TEXT_LINE,
  HERO_H1_LOC,
  HERO_H1_TEXT_LINE,
  HERO_SPAN_LOC,
  HERO_SPAN_TEXT_LINE,
  NO_VITE_ROOT,
  UNSTAMPED_ROOT,
  V2_FIXTURE_ROOT,
  changedSince,
  prepareV2Fixture,
} from './v2.fixture.js';

/**
 * AC-13 — v2, end to end.
 *
 * The claim: **however an edit was authored, it is verified the same way.** v1 proved the
 * loop; v2 wrapped it in a product with a second way in, and a second way in is exactly
 * where a verification step gets forgotten. So this suite drives the studio the way a
 * person does — a folder typed into the connect form, a real cross-origin preview, a click
 * in one panel and a sentence in another — and asks the same question of both paths.
 *
 * The two criteria that carry it are AC-13.5 and AC-13.8, and they are one criterion in two
 * parts. AC-13.5 tells the fake agent to write the wrong thing down *both* authoring paths
 * and demands `drifted` from both. AC-13.8 is the check on AC-13.5 itself: break the lift
 * step in `packages/studio/src/client/loop.ts` so the DOM is read while the override is
 * still painted, and both of AC-13.5's tests must go red while AC-13.3 and AC-13.4 stay
 * green. A verifier that always says `landed` passes every happy path in this file.
 *
 * **Not `mode: 'serial'`, and that is load-bearing.** These tests share a page and run in
 * declaration order (the project sets `fullyParallel: false`), but a failure must not skip
 * the ones after it: under AC-13.8's mutation the clicked half of AC-13.5 fails, and a
 * serial group would then *skip* the chat half — turning "both paths are caught" into a
 * result that never ran.
 *
 * That has a price, and paying it is what makes AC-13.8 meaningful: Playwright discards a
 * worker after a failed test and starts the next one in a fresh one, which re-runs
 * `beforeAll` against a rebuilt fixture and a newly connected session. So **every test here
 * has to be able to run first** — each selects the element it edits, counts change-log rows
 * relative to what it found, and reads the file it will assert on at its own start. A test
 * that quietly depended on its predecessor would report the predecessor's failure a second
 * time instead of its own answer.
 */

/** The host starts a dev server and probes it; a cold Tailwind build is most of this. */
const CONNECT_TIMEOUT_MS = 180_000;
/** A write, a hot reload, and a re-render on a dev server that may still be warming. */
const VERDICT_TIMEOUT_MS = 90_000;

/**
 * The scripted agent's control channel (see `packages/bridge/src/agent/fake.ts`).
 *
 * It is read from the recorded class list as well as from the instruction, which is what
 * lets a *text* edit be armed from the browser without a server restart — a text edit's
 * instruction is generated from the text, and putting the token in there would write the
 * token into the file. This is v1's `armFake`, unchanged; what is new is that the second
 * use of it below arms an edit the chat panel authored.
 */
const WRONG = '[sve:fake=wrong]';

let page: Page;
/** The fixture as it was before the suite touched it, restored unconditionally at the end. */
let pristine: FixtureSnapshot;

/* ── the chrome, on both sides of the frame ───────────────────────────────── */

const frame = (): ReturnType<Page['frameLocator']> => page.frameLocator('iframe.sv-preview__frame');
const coordFile = (): Locator => page.locator('.sv-coord__file');
const coordPos = (): Locator => page.locator('.sv-coord__pos');
const textField = (): Locator => page.locator('#sv-field-text');
const classField = (): Locator => page.locator('#sv-field-class');
const applyButton = (): Locator => page.locator('.sv-diagnostic .sv-button--primary');
const rows = (): Locator => page.locator('.sv-log .sv-row');
const turns = (): Locator => page.locator('.sv-transcript .sv-turn');
const compose = (): Locator => page.locator('#sv-compose');

const heroH1 = (): Locator => frame().locator('h1');
const heroLines = (): string[] => readFixtureLines(HERO, V2_FIXTURE_ROOT);
const heroBytes = (): Buffer => readFileSync(fixturePath(HERO, V2_FIXTURE_ROOT));

/**
 * The preview's own realm.
 *
 * `frameLocator` reaches the DOM but not the window, and hot reload is only observable as a
 * message on the dev server's socket — which belongs to the framed document, not to the
 * studio's. This is the one thing in the suite that has to address the frame as a frame.
 */
function previewFrame(): Frame {
  const [child] = page.mainFrame().childFrames();
  if (!child) throw new Error('the preview frame is not attached');
  return child;
}

const hmrUpdates = (): Promise<number> =>
  previewFrame().evaluate(() => (window as unknown as { __sveHmr?: number }).__sveHmr ?? 0);

/** The one changed line of `Hero.tsx`, and proof that it was the only one. */
function soleChange(before: readonly string[]): { line: number; text: string } {
  const now = heroLines();
  expect(now).toHaveLength(before.length);
  const changed = before.flatMap((line, index) => (now[index] === line ? [] : [index]));
  expect(changed).toHaveLength(1);
  return { line: changed[0]! + 1, text: now[changed[0]!]! };
}

/**
 * Arms the scripted agent to write the wrong thing on the *next* job.
 *
 * Appended to the class field rather than typed over it, exactly as v1 does: the class
 * editor reads every class the user drops as a removal, so replacing the field would ask
 * for an edit nobody made. The token never reaches the file — `fake.ts` strips it from any
 * class list it writes, and a text edit does not write a class list at all.
 */
async function armWrong(): Promise<void> {
  const field = classField();
  const current = (await field.inputValue()).replace(WRONG, '').trim();
  await field.fill(`${current} ${WRONG}`.trim());
  // The field is controlled by state that arrives over the wire, so the value is not
  // settled until the frame has answered with it.
  await expect(field).toHaveValue(/\[sve:fake=wrong\]/);
}

/**
 * Clicks an element inside the preview and waits for the studio's diagnostic to catch up.
 *
 * The coordinate is checked rather than assumed because the click and the diagnostic are in
 * different windows: the overlay re-anchors in the frame, the studio hears about it one
 * `postMessage` later, and a test that carried on immediately would type into a field
 * describing the element it selected before.
 */
async function select(target: Locator, loc: string): Promise<void> {
  const [, line, column] = loc.split(':');
  await target.click();
  await expect(coordFile()).toHaveText(HERO, { timeout: 30_000 });
  await expect(coordPos()).toHaveText(`${line}:${column}`, { timeout: 30_000 });
}

/** Sends a chat message and waits for the planner to resolve it to a proposal. */
async function propose(message: string): Promise<Locator> {
  const before = await turns().count();
  await compose().fill(message);
  await page.locator('.sv-compose button[type="submit"]').click();

  const turn = turns().nth(before);
  await expect(turn).toHaveAttribute('data-state', 'proposed');
  return turn;
}

/* ── connecting ───────────────────────────────────────────────────────────── */

test.beforeAll(async ({ browser }) => {
  test.setTimeout(CONNECT_TIMEOUT_MS);
  prepareV2Fixture();
  pristine = snapshotFixture(V2_FIXTURE_ROOT);

  page = await browser.newPage();
  page.setDefaultTimeout(60_000);

  // Installed before anything loads, and inherited by the preview frame when it is created.
  // Vite's HMR client keeps its event bus to itself; the `update` message on its socket is
  // the only direct evidence a module update reached the browser.
  await page.addInitScript(() => {
    const scope = window as unknown as { __sveHmr: number };
    scope.__sveHmr = 0;
    const Native = window.WebSocket;
    class Recording extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        this.addEventListener('message', (event: MessageEvent<unknown>) => {
          if (typeof event.data === 'string' && event.data.includes('"type":"update"')) {
            scope.__sveHmr += 1;
          }
        });
      }
    }
    window.WebSocket = Recording as unknown as typeof WebSocket;
  });

  await page.goto('/');
  await page.getByLabel('Folder path or repository URL').fill(V2_FIXTURE_ROOT);
  await page.getByRole('button', { name: 'Connect' }).click();

  await expect(page.locator('iframe.sv-preview__frame')).toBeVisible({
    timeout: CONNECT_TIMEOUT_MS,
  });

  // The frame being *there* is not the wire being up. Every test below drives the project
  // through `@sve/rpc`, and a click that arrives before the handshake completes selects
  // nothing the studio ever hears about — which is a hook problem reported as a test
  // failure, in whichever test happens to run first.
  await expect(page.locator('.sv-preview__bar')).toContainText('connected', {
    timeout: CONNECT_TIMEOUT_MS,
  });
  await expect(frame().locator('h1[data-sve-loc]')).toBeVisible({ timeout: CONNECT_TIMEOUT_MS });
});

test.afterAll(async () => {
  // Unconditional: this suite drives a real agent over a real bridge and writes real files.
  // A run that fails halfway must not leave the fixture edited for the next one.
  restoreFixture(pristine, V2_FIXTURE_ROOT);
  await page?.close();
});

/* ── AC-13.2 — connect ────────────────────────────────────────────────────── */

test('AC-13.2 the fixture is connected, rendered, and stamped', async () => {
  const h1 = heroH1();
  await expect(h1).toBeVisible();
  // Not "the page looks right": the attribute the whole editor is built on is present, and
  // it is the coordinate the source actually has.
  await expect(h1).toHaveAttribute('data-sve-loc', HERO_H1_LOC);
  await expect(frame().locator('[data-sve-loc]').first()).toBeVisible();

  // The project is genuinely on the other side of an origin — the studio's own document
  // contains none of it — and the studio says it is connected.
  await expect(page.locator('h1')).toHaveCount(0);
  await expect(page.locator('.sv-preview__bar')).toContainText('connected');

  // Nothing has been written by connecting.
  expect(changedSince(pristine)).toEqual([]);
});

/* ── AC-13.3 — a clicked edit lands ───────────────────────────────────────── */

const CLICKED = 'Five of six beaches are swimmable this morning.';

test('AC-13.3 a clicked edit lands, and the file says so', async () => {
  test.setTimeout(VERDICT_TIMEOUT_MS + 60_000);
  const before = heroLines();
  const logged = await rows().count();

  await select(heroH1(), HERO_H1_LOC);
  await textField().fill(CLICKED);

  // The override is the preview, and it is painted before anything crosses the wire.
  await expect(heroH1()).toHaveText(CLICKED);
  expect(changedSince(pristine)).toEqual([]);
  await expect(rows()).toHaveCount(logged);

  const hmrBefore = await hmrUpdates();
  await applyButton().click();

  const row = rows().first();
  await expect(row).toHaveAttribute('data-status', 'landed', { timeout: VERDICT_TIMEOUT_MS });
  await expect(rows()).toHaveCount(logged + 1);
  await expect(row.locator('.sv-row__loc')).toHaveText(HERO_H1_LOC);
  await expect(row.locator('.sv-row__origin')).toHaveText('click');

  // The write landed on the line that carries the text, and on no other line.
  const change = soleChange(before);
  expect(change.line).toBe(HERO_H1_TEXT_LINE);
  expect(change.text.trim()).toBe(CLICKED);

  // Hot reload fired, and what the frame shows now is React's own render of the file.
  await expect.poll(hmrUpdates).toBeGreaterThan(hmrBefore);
  await expect(heroH1()).toHaveText(CLICKED);
});

/* ── AC-13.4 — a chat edit lands, through the same loop ───────────────────── */

const CHATTED = 'Six of six beaches are swimmable this morning.';

test('AC-13.4 a chat edit lands through the same loop, and writes nothing before Apply', async () => {
  test.setTimeout(VERDICT_TIMEOUT_MS + 60_000);
  const before = heroLines();
  const beforeApply = snapshotFixture(V2_FIXTURE_ROOT);
  const logged = await rows().count();

  // Selected first, because the planner may name only what the studio has been shown — the
  // catalogue is closed on purpose, so that a model cannot invent a coordinate.
  await select(heroH1(), HERO_H1_LOC);
  const turn = await propose(`set the text of the h1 to "${CHATTED}"`);

  // The reply names the element and the change, so the user can judge it.
  await expect(turn.locator('.sv-turn__reply')).toContainText(HERO_H1_LOC);

  // **The criterion.** A proposal is an override and an override is an illusion: the
  // project is byte-for-byte what it was, asserted on the files rather than on the panel.
  // A UI that showed a preview while a write happened underneath it would pass a UI test.
  expect(changedSince(beforeApply)).toEqual([]);
  await expect(heroH1()).toHaveText(CHATTED);
  await expect(rows()).toHaveCount(logged);

  const hmrBefore = await hmrUpdates();
  await turn.locator('.sv-turn__actions .sv-button--primary').click();

  const row = rows().first();
  await expect(row).toHaveAttribute('data-status', 'landed', { timeout: VERDICT_TIMEOUT_MS });
  await expect(rows()).toHaveCount(logged + 1);

  // Indistinguishable in kind from AC-13.3's row: same coordinate, same verdict, Revert
  // offered on the same terms. Only the origin label differs, because only the origin did.
  await expect(row.locator('.sv-row__loc')).toHaveText(HERO_H1_LOC);
  await expect(row.locator('.sv-row__origin')).toHaveText('chat');
  await expect(row.locator('.sv-row__actions')).toHaveAttribute('data-offered', 'true');

  const change = soleChange(before);
  expect(change.line).toBe(HERO_H1_TEXT_LINE);
  expect(change.text.trim()).toBe(CHATTED);

  await expect.poll(hmrUpdates).toBeGreaterThan(hmrBefore);
  await expect(heroH1()).toHaveText(CHATTED);
});

/* ── AC-13.5 — both are caught when wrong ─────────────────────────────────── */

/**
 * AC-5.2, extended to v2, and the reason the rest of the file means anything.
 *
 * The agent is told to write `Ship Faster` where the intent said `Ship faster`. A loop that
 * read the DOM without lifting its own override first would read `Ship faster` — its own
 * paint — and call this landed.
 */
test('AC-13.5 a clicked edit that is written wrong is caught, shown, and left in place', async () => {
  test.setTimeout(VERDICT_TIMEOUT_MS + 60_000);
  const before = heroLines();

  await select(heroH1(), HERO_H1_LOC);
  await textField().fill('Ship faster');
  await armWrong();
  await applyButton().click();

  const row = rows().first();
  await expect(row).toHaveAttribute('data-status', 'drifted', { timeout: VERDICT_TIMEOUT_MS });
  await expect(row.locator('.sv-row__origin')).toHaveText('click');

  // Intent versus rendered, both sides, in the same two-sided form v1's inspector used.
  const mismatch = row.locator('.sv-row__mismatch');
  await expect(mismatch.locator('dt')).toHaveText('text');
  await expect(mismatch.locator('dd')).toContainText('intent Ship faster');
  await expect(mismatch.locator('dd')).toContainText('rendered Ship Faster');

  // The override is back, so the user still sees what they asked for…
  await expect(heroH1()).toHaveText('Ship faster');
  // …and the file is left exactly as the agent wrote it (AC-5.2), with Revert offered.
  const change = soleChange(before);
  expect(change.line).toBe(HERO_H1_TEXT_LINE);
  expect(change.text).toContain('Ship Faster');
  await expect(row.locator('.sv-row__actions')).toHaveAttribute('data-offered', 'true');
});

/**
 * The same wrong write, authored in the chat panel.
 *
 * A different element from the clicked half on purpose: under AC-13.8's mutation the half
 * above fails, and this one has to be able to run on a page it left mid-edit.
 */
test('AC-13.5 a chat edit that is written wrong is caught the same way', async () => {
  test.setTimeout(VERDICT_TIMEOUT_MS + 60_000);
  const before = heroLines();

  // Clicked once so the planner has an element to name — it may name only what the studio
  // has been shown, never an eid it invented.
  await select(frame().getByText('Next safe window', { exact: true }), HERO_SPAN_LOC);

  const turn = await propose('set the text of the span to "Next good window"');
  await expect(frame().getByText('Next good window', { exact: true })).toBeVisible();
  await armWrong();

  await turn.locator('.sv-turn__actions .sv-button--primary').click();

  const row = rows().first();
  await expect(row).toHaveAttribute('data-status', 'drifted', { timeout: VERDICT_TIMEOUT_MS });
  await expect(row.locator('.sv-row__loc')).toHaveText(HERO_SPAN_LOC);
  await expect(row.locator('.sv-row__origin')).toHaveText('chat');

  const mismatch = row.locator('.sv-row__mismatch');
  await expect(mismatch.locator('dt')).toHaveText('text');
  await expect(mismatch.locator('dd')).toContainText('intent Next good window');
  await expect(mismatch.locator('dd')).toContainText('rendered Next Good Window');

  // The override is kept here too: a chat-authored ask is not lost because the agent
  // missed it.
  await expect(frame().getByText('Next good window', { exact: true })).toBeVisible();

  const change = soleChange(before);
  expect(change.line).toBe(HERO_SPAN_TEXT_LINE);
  expect(change.text).toContain('Next Good Window');
});

/* ── AC-13.6 — revert from the change log ─────────────────────────────────── */

test('AC-13.6 a row reverts, byte for byte, and reads reverted', async () => {
  test.setTimeout(VERDICT_TIMEOUT_MS + 60_000);

  await select(frame().getByText('At the harbour gauge', { exact: true }), HERO_GAUGE_LOC);
  await textField().fill('At the harbour buoy');

  // Read at the last possible moment: revert restores the snapshot this job took, which is
  // the file as it stood after everything above, not the file as it was checked in.
  const beforeWrite = heroBytes();
  await applyButton().click();

  const row = rows().first();
  await expect(row).toHaveAttribute('data-status', 'landed', { timeout: VERDICT_TIMEOUT_MS });
  await expect(row.locator('.sv-row__loc')).toHaveText(HERO_GAUGE_LOC);
  expect(heroLines()[HERO_GAUGE_TEXT_LINE - 1]).toContain('At the harbour buoy');
  expect(Buffer.compare(heroBytes(), beforeWrite)).not.toBe(0);

  await row.locator('.sv-row__actions .sv-button').click();

  // `reverted`, and never `landed` — nothing landed, it was undone.
  await expect(row).toHaveAttribute('data-status', 'reverted', { timeout: VERDICT_TIMEOUT_MS });
  await expect(row.locator('.sv-row__verdict')).toHaveText('Reverted');
  expect(Buffer.compare(heroBytes(), beforeWrite)).toBe(0);

  // And the preview is back to what it showed before the edit: the override went with it.
  await expect(frame().getByText('At the harbour gauge', { exact: true })).toBeVisible();
  await expect(row.locator('.sv-row__actions')).toHaveAttribute('data-offered', 'false');
});

/* ── AC-13.7 — refusal to connect is legible ──────────────────────────────── */

test('AC-13.7 a project with no Vite config is refused in the host\'s own words', async ({
  browser,
}) => {
  test.setTimeout(CONNECT_TIMEOUT_MS);
  const other = await browser.newPage();
  try {
    await other.goto('/');
    await other.getByLabel('Folder path or repository URL').fill(NO_VITE_ROOT);
    await other.getByRole('button', { name: 'Connect' }).click();

    const notice = other.locator('.sv-notice--error');
    await expect(notice).toBeVisible({ timeout: CONNECT_TIMEOUT_MS });
    await expect(notice.locator('.sv-notice__title')).toContainText('was not opened');

    // The host's sentence, not a replacement for it: it names what was looked for, which is
    // the only part a user can act on.
    const body = notice.locator('.sv-notice__body');
    await expect(body).toContainText('has no Vite config');
    await expect(body).toContainText('vite.config.ts');
    await expect(body).toContainText(NO_VITE_ROOT);

    // Refused means refused: no workspace opened behind the message.
    await expect(other.locator('iframe.sv-preview__frame')).toHaveCount(0);
  } finally {
    await other.close();
  }
});

test('AC-13.7 a project where nothing was stamped is a blocking error, not a warning', async ({
  browser,
}) => {
  test.setTimeout(CONNECT_TIMEOUT_MS);
  const other = await browser.newPage();
  try {
    await other.goto('/');
    await other.getByLabel('Folder path or repository URL').fill(UNSTAMPED_ROOT);
    await other.getByRole('button', { name: 'Connect' }).click();

    const notice = other.locator('.sv-notice--error');
    await expect(notice).toBeVisible({ timeout: CONNECT_TIMEOUT_MS });
    await expect(notice.locator('.sv-notice__title')).toHaveText(
      'Nothing in this project can be selected.',
    );

    const body = notice.locator('.sv-notice__body');
    await expect(body).toContainText('was stamped with an origin');
    await expect(body).toContainText('select nothing when clicked');

    // The whole of the criterion: the session is *serving* — this project started fine —
    // and the studio still refuses to put a workspace in front of it. An editor that loads
    // and does nothing when clicked is the failure most easily mistaken for a broken
    // product, so it stands in front of the workspace rather than beside it.
    await expect(other.locator('iframe.sv-preview__frame')).toHaveCount(0);
    await expect(other.locator('.sv-shell')).toHaveCount(0);
  } finally {
    await other.close();
  }
});

/* ── the fixture was a copy ───────────────────────────────────────────────── */

test('AC-13.2 nothing under apps/demo was touched', () => {
  // Everything above wrote real files through a real agent. `git status` has to be clean
  // afterwards, and the reason it is clean is that none of it happened to the checked-in
  // tree — asserted rather than assumed, because a fixture root that silently resolved to
  // `apps/demo` would pass every other test in this file.
  const status = execFileSync('git', ['status', '--porcelain', '--', 'apps/demo'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  expect(status.trim()).toBe('');
});
