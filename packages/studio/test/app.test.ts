// @vitest-environment jsdom
/**
 * The workspace as it is actually rendered (AC-12.4, AC-12.6, AC-12.7).
 *
 * These run against the real components and the real controllers — the same harness the
 * loop and chat suites use — so pressing Apply here goes through `runVerification`, the
 * bridge and the scripted agent, and the assertion at the end is about a file.
 *
 * Written with `createElement` rather than JSX because the runner collects `*.test.ts`;
 * the components under test are `.tsx` and are imported as they ship.
 */
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APPLY_LABELS } from '@sve/overlay';
import { createConnectController, type ConnectState, type ConnectTransport } from '../src/client/connect.js';
import { Studio, type StudioProps } from '../src/app/Studio.js';
import { PROVIDERS } from '../src/providers.js';
import { H1_ANCHOR, H1_EID, SOURCE, settle } from './fixture.js';
import { createHarness, type Harness } from './harness.js';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const IDLE_TRANSPORT: ConnectTransport = {
  connect: async () => ({ ok: false, reason: 'server-failed', message: 'not used' }),
  answerConfirm: async () => undefined,
};

let host: HTMLDivElement | null = null;
let root: Root | null = null;
let h: Harness | null = null;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  h?.dispose();
  h = null;
});

async function render(props: Partial<StudioProps> = {}): Promise<void> {
  const connect = createConnectController({ transport: IDLE_TRANSPORT });
  const full: StudioProps = {
    connect,
    connectState: props.connectState ?? connect.state,
    providers: props.providers ?? PROVIDERS.map((p) => ({ ...p, configured: false, missing: null, selected: p.id === 'fake' })),
    onSelectProvider: () => undefined,
    onConfigureProvider: () => undefined,
    workspace: props.workspace ?? null,
    previewUrl: props.previewUrl ?? null,
    onReconnect: () => undefined,
  };
  await act(async () => {
    root!.render(createElement(Studio, full) as ReactElement);
  });
}

/** Awaits a condition across macrotask turns; a real job is several round trips deep. */
async function until(predicate: () => boolean, turns = 200): Promise<void> {
  for (let i = 0; i < turns; i += 1) {
    if (predicate()) return;
    await settle(1);
  }
  throw new Error('condition never held');
}

const q = (selector: string): HTMLElement | null => host!.querySelector(selector);
const all = (selector: string): HTMLElement[] => [...host!.querySelectorAll<HTMLElement>(selector)];

async function connected(options?: Parameters<typeof createHarness>[0]): Promise<Harness> {
  h = await createHarness(options);
  await h.wire.controller.select(H1_ANCHOR);
  await settle();
  await render({ workspace: h.workspace, previewUrl: 'http://127.0.0.1:5310/' });
  return h;
}

describe('before a project is connected', () => {
  it('asks for a folder or a repository, and offers the picker there', async () => {
    await render();

    expect(q('.sv-connect__title')?.textContent).toContain('Source-mapped visual editor');
    expect(all('.sv-provider').map((el) => el.querySelector('.sv-provider__label')?.textContent)).toEqual(
      ['Claude', 'OpenAI-compatible endpoint', 'Scripted'],
    );
  });

  it('puts a blocking diagnostic in front of the workspace, whole', async () => {
    const state: ConnectState = {
      kind: 'blocked',
      session: {
        id: 'sve_1',
        url: 'http://127.0.0.1:5310/',
        root: '/tmp/p',
        port: 5310,
        agent: 'fake',
        source: { kind: 'folder', path: '/tmp/p' },
        stamping: { probed: true, filesConsidered: 1, filesStamped: 0, elementsStamped: 0, modulesFetched: 1, files: [] },
        diagnostics: [],
      },
      diagnostic: {
        code: 'no-elements-stamped',
        level: 'error',
        message: 'Nothing in /tmp/p was stamped with an origin. The editor will load and select nothing when clicked.',
      },
    };

    await render({ connectState: state });

    const alert = q('[role="alert"]');
    expect(alert?.textContent).toContain('Nothing in /tmp/p was stamped with an origin');
    expect(alert?.textContent).toContain('select nothing when clicked');
    // Not tucked into a list of warnings somewhere below.
    expect(q('.sv-shell')).toBeNull();
  });
});

describe('the three panels', () => {
  it('are all present and named', async () => {
    await connected();

    expect(q('[aria-label="Changes"]')).not.toBeNull();
    expect(q('[aria-label="Preview"]')).not.toBeNull();
    expect(q('[aria-label="Agent chat"]')).not.toBeNull();
  });

  it('are separated by two controls a keyboard can reach', async () => {
    await connected();

    const splitters = all('[role="separator"]');
    expect(splitters).toHaveLength(2);
    for (const splitter of splitters) {
      expect(splitter.tagName).toBe('BUTTON');
      expect(splitter.getAttribute('aria-label')).toMatch(/resize/i);
    }
  });

  it('reaches every control through a real button or field', async () => {
    await connected();
    // Nothing pretending to be interactive: no div with a click handler and no anchor
    // standing in for a button.
    expect(all('div[role="button"]')).toHaveLength(0);
    expect(all('a')).toHaveLength(0);
  });
});

describe('the diagnostic', () => {
  it('draws the caret under the exact column, from the excerpt it was given', async () => {
    await connected();

    const target = q('.sv-excerpt__line[data-target="true"]');
    expect(target?.textContent).toContain(SOURCE.split('\n')[2]!.trim());

    const pad = q('.sv-caret-pad');
    const caret = q('.sv-caret');
    expect(pad?.textContent).toBe('    ');
    expect(caret?.textContent).toBe('^');
    // Four characters of pad, so the marker lands on the `<` at column 5.
    expect(SOURCE.split('\n')[2]![pad!.textContent!.length]).toBe('<');
  });

  it('disables Apply until there is something to apply', async () => {
    const harness = await connected();
    const apply = q('.sv-button--primary') as HTMLButtonElement;
    expect(apply.textContent).toBe(APPLY_LABELS.idle);
    expect(apply.disabled).toBe(true);

    await act(async () => {
      await harness.wire.controller.setOverride(H1_EID, { text: 'Ship faster' });
      await settle();
    });

    expect((q('.sv-button--primary') as HTMLButtonElement).disabled).toBe(false);
  });

  it('writes through the loop when Apply is pressed, and the file changes', async () => {
    const harness = await connected();
    await act(async () => {
      await harness.wire.controller.setOverride(H1_EID, { text: 'Ship faster' });
      await settle();
    });

    await act(async () => {
      (q('.sv-button--primary') as HTMLButtonElement).click();
      await until(() => (harness.workspace.log.rows()[0]?.status ?? 'applying') !== 'applying');
    });

    expect(harness.project.read()).toContain('Ship faster');
    expect(harness.workspace.log.rows()[0]?.status).toBe('landed');
  });
});

describe('a row resolving', () => {
  it('updates the node in place rather than replacing it', async () => {
    const harness = await connected();
    await act(async () => {
      await harness.wire.controller.setOverride(H1_EID, { text: 'Ship faster' });
      await settle();
    });

    const intent = await harness.wire.controller.captureIntent('text');
    let pending: Promise<unknown> | null = null;
    await act(async () => {
      pending = harness.workspace.applyIntent(intent!, 'preview');
      await settle(1);
    });

    const applying = q('.sv-row');
    expect(applying?.getAttribute('data-status')).toBe('applying');
    expect(applying?.querySelector('.sv-row__verdict')?.textContent).toBe(APPLY_LABELS.applying);

    await act(async () => {
      await pending;
      await settle(4);
    });

    const settled = q('.sv-row');
    // The same element: React updated it, so nothing above or below it moved.
    expect(settled).toBe(applying);
    expect(settled?.getAttribute('data-status')).toBe('landed');
    expect(settled?.querySelector('.sv-row__verdict')?.textContent).toBe(APPLY_LABELS.landed);
  });
});

describe('the chat panel', () => {
  it('is a transcript with a prompt marker, not a bubble list', async () => {
    const harness = await connected();

    await act(async () => {
      await harness.workspace.chat.send('set the text to "Ship faster"');
      await settle();
    });

    expect(q('.sv-turn__marker')?.textContent).toBe('›');
    expect(q('.sv-turn__reply')?.textContent).toContain('nothing is written until you press Apply');
    // The proposal offers the same verb the panel does.
    const actions = all('.sv-turn__actions button').map((button) => button.textContent);
    expect(actions).toEqual([APPLY_LABELS.idle, 'Discard']);
  });
});
