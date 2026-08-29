// @vitest-environment jsdom
/**
 * AC-12.1 — chat authors intents; it does not bypass verification.
 *
 * The criterion the whole of v2 rests on, so the assertions are made where a mistake would
 * actually show: on the project's bytes. A chat turn that produces an override and no
 * write must leave the tree identical, and the only way to find that out is to compare it.
 * Asserting it on the UI would pass while a write happened underneath.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { FILE, H1_ANCHOR, H1_EID, SECTION_EID, settle } from './fixture.js';
import { createHarness, type Harness } from './harness.js';

let h: Harness | null = null;

afterEach(() => {
  h?.dispose();
  h = null;
});

async function selected(options?: Parameters<typeof createHarness>[0]): Promise<Harness> {
  h = await createHarness(options);
  await h.wire.controller.select(H1_ANCHOR);
  await settle();
  return h;
}

describe('a chat turn on its own', () => {
  it('resolves to an element and a concrete change, and applies it as an override', async () => {
    const { workspace, wire } = await selected();

    const turn = await workspace.chat.send('set the text to "Ship faster"');

    expect(turn.state).toBe('proposed');
    expect(turn.proposal?.eid).toBe(H1_EID);
    expect(turn.proposal?.loc).toBe(`${FILE}:3:5`);
    expect(turn.proposal?.override).toEqual({ text: 'Ship faster' });
    // Visible immediately: the illusion is on the page before anything is written.
    expect(wire.overlay.getOverride(H1_EID)).toEqual({ text: 'Ship faster' });
  });

  it('leaves the project byte-for-byte unchanged', async () => {
    const { workspace, project } = await selected();
    const before = project.snapshot();

    await workspace.chat.send('set the text to "Ship faster"');
    await settle();

    expect(project.changedSince(before)).toEqual([]);
    expect(project.read()).toContain('Swim today');
  });

  it('reaches the write path exactly never — there is no second way to the disk', async () => {
    const { workspace, apply } = await selected();

    await workspace.chat.send('set the text to "Ship faster"');

    expect(apply).not.toHaveBeenCalled();
    expect(workspace.log.rows()).toEqual([]);
  });

  it('refuses a request it cannot turn into a target and a change', async () => {
    const { workspace, wire, project } = await selected();
    const before = project.snapshot();

    const turn = await workspace.chat.send('make the hero tighter');

    expect(turn.state).toBe('unresolved');
    expect(turn.proposal).toBeNull();
    expect(turn.reply).toMatch(/one element/i);
    expect(wire.overlay.getOverride(H1_EID)).toBeUndefined();
    expect(project.changedSince(before)).toEqual([]);
  });

  it('will not name an element the page does not offer', async () => {
    const { workspace, apply } = await selected();

    const turn = await workspace.chat.send('set the text of the footer to "Ship faster"');

    expect(turn.state).toBe('unresolved');
    expect(apply).not.toHaveBeenCalled();
  });
});

describe('accepting a proposal', () => {
  it('writes through the same verified loop a click uses, and reaches a verdict', async () => {
    const { workspace, apply, project } = await selected();
    const turn = await workspace.chat.send('set the text to "Ship faster"');

    const outcome = await workspace.chat.accept(turn.id);

    expect(apply).toHaveBeenCalledTimes(1);
    expect(outcome?.verdict.status).toBe('landed');
    expect(project.read()).toContain('Ship faster');
  });

  it('produces one change-log row, marked as having come from the chat', async () => {
    const { workspace } = await selected();
    const turn = await workspace.chat.send('set the text to "Ship faster"');
    await workspace.chat.accept(turn.id);

    const rows = workspace.log.rows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.origin).toBe('chat');
    expect(rows[0]?.status).toBe('landed');
    expect(rows[0]?.eid).toBe(H1_EID);
  });

  it('surfaces drift rather than swallowing it, from the same loop', async () => {
    const { workspace } = await selected({ mode: 'wrong' });
    const turn = await workspace.chat.send('set the text to "Ship faster"');

    const outcome = await workspace.chat.accept(turn.id);

    expect(outcome?.verdict.status).toBe('drifted');
    expect(outcome?.verdict.mismatch?.[0]?.prop).toBe('text');
  });

  it('passes a refusal through with the reason, and writes nothing', async () => {
    const { workspace, project } = await selected({ mode: 'blocked' });
    const before = project.snapshot();
    const turn = await workspace.chat.send('set the text to "Ship faster"');

    const outcome = await workspace.chat.accept(turn.id);

    expect(outcome?.verdict.status).toBe('blocked');
    expect(project.changedSince(before)).toEqual([]);
  });

  it('discarding takes the illusion back off the page and writes nothing', async () => {
    const { workspace, wire, apply, project } = await selected();
    const before = project.snapshot();
    const turn = await workspace.chat.send('set the text to "Ship faster"');

    await workspace.chat.discard(turn.id);
    await settle();

    expect(wire.overlay.getOverride(H1_EID)).toBeUndefined();
    expect(apply).not.toHaveBeenCalled();
    expect(project.changedSince(before)).toEqual([]);
  });
});

describe('the planner', () => {
  it('reads class and style requests, not only text', async () => {
    const { workspace } = await selected();

    const added = await workspace.chat.send('add the class text-flare');
    expect(added.proposal?.override).toEqual({ classes: { add: ['text-flare'], remove: [] } });

    const styled = await workspace.chat.send('set the color to #ff5a1f');
    expect(styled.proposal?.override).toEqual({ style: { color: '#ff5a1f' } });
  });

  it('selects the element it names, so the user can see what it meant', async () => {
    const { workspace, wire } = await selected();
    // Looking somewhere else entirely by the time the sentence names the heading.
    await wire.controller.select({ eid: SECTION_EID, eidIndex: 0 });
    await settle();

    const turn = await workspace.chat.send('set the text of the h1 to "Ship faster"');

    expect(turn.state).toBe('proposed');
    expect(turn.proposal?.eid).toBe(H1_EID);
    await settle();
    expect(wire.overlay.selection?.eid).toBe(H1_EID);
  });

  it('has nothing to name until the user has shown it an element', async () => {
    h = await createHarness();

    const turn = await h.workspace.chat.send('set the text to "Ship faster"');

    expect(turn.state).toBe('unresolved');
    expect(turn.reply).toMatch(/Click the element you mean/);
  });

  it('keeps the turns in order, oldest first, the way a transcript reads', async () => {
    const { workspace } = await selected();

    await workspace.chat.send('make the hero tighter');
    await workspace.chat.send('set the text to "Ship faster"');

    const turns = workspace.chat.turns();
    expect(turns).toHaveLength(2);
    expect(turns[0]?.state).toBe('unresolved');
    expect(turns[1]?.state).toBe('proposed');
  });
});
