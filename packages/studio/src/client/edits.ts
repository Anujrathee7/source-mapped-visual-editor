/**
 * Turning a field edit into an override.
 *
 * Three functions, and the interesting one is `setClasses`. A class *removal* is a CSS
 * reset rather than a DOM write, so the element still carries the class the user took off;
 * diffing the field against the raw class list would read the overlay's own additions as
 * the app's. The reconstruction below is `mountOverlay`'s, performed on this side of the
 * wire because this is where the field now lives.
 */
import type { Override } from '@sve/overlay';
import type { AnchorRef } from '@sve/rpc';
import type { PreviewController } from './preview.js';

export async function setText(
  preview: PreviewController,
  anchor: AnchorRef,
  value: string,
): Promise<void> {
  const current = (await preview.getOverride(anchor.eid)) ?? {};
  await preview.setOverride(anchor.eid, { ...current, text: value });
}

export async function setClasses(
  preview: PreviewController,
  anchor: AnchorRef,
  value: string,
): Promise<void> {
  const current = (await preview.getOverride(anchor.eid)) ?? {};
  const snapshot = await preview.readSnapshot(anchor.eid, anchor.eidIndex);

  const added = new Set(current.classes?.add ?? []);
  const base = (snapshot?.classes ?? []).filter((name) => !added.has(name));
  const next = value.split(/\s+/).filter((name) => name !== '');

  const classes: Override['classes'] = {
    add: next.filter((name) => !base.includes(name)),
    remove: base.filter((name) => !next.includes(name)),
  };
  await preview.setOverride(anchor.eid, { ...current, classes });
}

export async function setStyle(
  preview: PreviewController,
  anchor: AnchorRef,
  prop: string,
  value: string,
): Promise<void> {
  const current = (await preview.getOverride(anchor.eid)) ?? {};
  const style = { ...current.style };
  if (value.trim() === '') delete style[prop];
  else style[prop] = value;
  await preview.setOverride(anchor.eid, { ...current, style });
}
