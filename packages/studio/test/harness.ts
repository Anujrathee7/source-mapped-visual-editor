/**
 * The whole product, joined, with two things faked and named.
 *
 * Real: the overlay, the `@sve/rpc` client and server, the studio's loop, the studio's
 * change log, the bridge, its serial queue, its snapshot store, and the scripted agent
 * writing to a real project in a temporary directory.
 *
 * Faked: the two browsing contexts (the in-memory transport pair), and hot reload — which
 * no jsdom has, and which is performed here by putting the file's new text into the DOM
 * the way React would. Everything the criteria are about is on the real side of that line.
 */
import { readFileSync } from 'node:fs';
import { vi, type Mock } from 'vitest';
import { createBridge, createFakeAgent, type Bridge, type FakeMode } from '@sve/bridge';
import type { EditIntent, EditResult } from '@sve/protocol';
import { createWorkspace, type Workspace } from '../src/client/workspace.js';
import { createFakePlanner } from '../src/host/planner-fake.js';
import { FILE, H1_EID } from './fixture.js';
import { createProject, type Project } from './project.js';
import { wirePreview, type Wire } from './support.js';

export interface Harness {
  wire: Wire;
  project: Project;
  bridge: Bridge;
  workspace: Workspace;
  /** Every intent that reached the bridge, in order. */
  apply: Mock<(intent: EditIntent) => Promise<EditResult>>;
  dispose(): void;
}

export interface HarnessOptions {
  mode?: FakeMode;
  /** Skips the DOM re-render, so the page never catches up with the file. */
  reload?: boolean;
}

/**
 * Hot reload, as far as jsdom can stand in for it.
 *
 * Two things happen when the dev server re-renders after a write, and both matter here:
 * the element's text becomes what the file says, and the Babel pass re-stamps
 * `data-sve-loc`, because a write above the element moved it. A stand-in that did only the
 * first would make the re-anchoring spec pass for the wrong reason.
 */
export function rerenderFromFile(file: string): void {
  const el = document.querySelector(`[data-sve-eid="${H1_EID}"]`);
  if (!el) return;
  const lines = readFileSync(file, 'utf8').split(/\r\n|\n/);
  const index = lines.findIndex((line) => line.includes('<h1'));
  if (index < 0) return;
  el.setAttribute('data-sve-loc', `${FILE}:${index + 1}:${(lines[index] ?? '').indexOf('<') + 1}`);
  const text = (lines[index + 1] ?? '').trim();
  if (el.firstChild) el.firstChild.nodeValue = text;
}

export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const project = createProject();
  const bridge = createBridge({
    root: project.root,
    editRoots: project.editRoots,
    agent: createFakeAgent({ mode: options.mode ?? 'correct' }),
    undoRoot: `${project.root}-undo`,
  });
  const wire = await wirePreview({ timeoutMs: 2000 });

  const apply = vi.fn(async (intent: EditIntent): Promise<EditResult> => {
    const [result] = await bridge.apply({ intents: [intent] });
    if (options.reload !== false) rerenderFromFile(project.file);
    if (!result) throw new Error('the bridge returned no result');
    return result;
  });

  const workspace = createWorkspace({
    preview: wire.controller,
    apply,
    revert: (jobId) => bridge.revert(jobId),
    planner: createFakePlanner(),
  });

  return {
    wire,
    project,
    bridge,
    workspace,
    apply,
    dispose: () => {
      workspace.dispose();
      wire.dispose();
      bridge.close();
      project.remove();
    },
  };
}
