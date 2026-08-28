/**
 * Intent capture (AC-4.10).
 *
 * A snapshot is what the element *resolves to*, never how it was written. That is the
 * whole reason a Tailwind class edit and an inline style edit expressing the same visual
 * change both verify (AC-5.3): both sides of the comparison are computed values.
 */
import { TRACKED_PROPS, type Computed, type Snapshot, type TrackedProp } from '@sve/protocol';
import { normalizeText } from './compare.js';

/** `backgroundColor` -> `background-color`, for `getPropertyValue`. */
function kebab(prop: string): string {
  return prop.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

const KEBAB_PROPS: ReadonlyArray<readonly [TrackedProp, string]> = TRACKED_PROPS.map(
  (prop) => [prop, kebab(prop)] as const,
);

/**
 * Exactly `TRACKED_PROPS`, in its order, and nothing else — `ComputedSchema` is strict, so
 * an extra key is a rejected wire message rather than harmless extra data.
 *
 * A property the engine leaves blank is recorded as `''` rather than dropped, so the key
 * set is a constant. `diffComputed` only compares what the intent actually recorded, so a
 * blank costs nothing and a stable shape is worth more than a sparse one.
 */
export function readComputed(el: Element): Computed {
  const style = getComputedStyle(el);
  const computed: Partial<Record<TrackedProp, string>> = {};
  for (const [prop, property] of KEBAB_PROPS) {
    computed[prop] = style.getPropertyValue(property) ?? '';
  }
  return computed as Computed;
}

/**
 * The three facets an `EditIntent` records. Called twice per edit: once before the
 * override and once with it applied, and it is the *second* one that becomes the intent.
 */
export function captureSnapshot(el: Element): Snapshot {
  return {
    text: normalizeText(el.textContent ?? ''),
    classes: Array.from(el.classList),
    computed: readComputed(el),
  };
}
