/**
 * The handful of names both halves of this package have to agree on.
 *
 * Kept in a module of its own because `src/plugin.ts` runs in Node and `src/client/**`
 * runs in the browser: neither may import the other, but both need these.
 */

/** What the injected `<script>` asks the dev server for. */
export const VIRTUAL_ENTRY_ID = 'virtual:sve-overlay';

/** Rollup's convention: a leading NUL marks an id no other plugin should touch. */
export const RESOLVED_ENTRY_ID = `\0${VIRTUAL_ENTRY_ID}`;

/**
 * The browser entry, named as a bare workspace import.
 *
 * Deliberately not a filesystem path. `/@fs/` ids carry a drive letter on Windows and do
 * not on Linux, and a virtual module has no directory for a relative import to resolve
 * against. A bare specifier is resolved by the dev server exactly as it resolves any other
 * workspace import, on every platform.
 */
export const CLIENT_ENTRY_SPECIFIER = '@sve/vite/client';

/**
 * How long the overlay waits for hot reload before calling the edit stalled (AC-5.7).
 *
 * The bridge already reports `stalled` when the agent wrote nothing, which covers the
 * common case immediately. This timeout covers the other one: a write that landed on disk
 * but produced no module update, where waiting forever is the failure mode.
 */
export const DEFAULT_VERIFY_TIMEOUT_MS = 10_000;

/**
 * How long hot reload has to stay quiet before the page counts as settled.
 *
 * One edit can produce more than one update — Tailwind regenerates its stylesheet as a
 * second, separate update after the module that changed — and comparing computed values
 * between the two would read the old CSS as drift.
 */
export const DEFAULT_SETTLE_MS = 120;
