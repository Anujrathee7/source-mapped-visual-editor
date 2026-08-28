# AC-0 — `@sve/protocol`

The shared contract between the browser overlay and the Node bridge. The bridge holds
file-write capability, so **the browser is untrusted input**: every inbound payload is
validated here, not at the call site.

These criteria are fixed. If an implementation fails one, the implementation changes.

## AC-0.1 — `parseLoc` / `formatLoc` round-trip

- `parseLoc("apps/demo/src/Hero.tsx:42:7")` returns `{ file: "apps/demo/src/Hero.tsx", line: 42, col: 7 }`.
- `formatLoc(parseLoc(s)) === s` for any well-formed `s`.
- Windows-style paths survive: `parseLoc("apps\demo\src\Hero.tsx:42:7")` yields the
  path unchanged and `line: 42`, `col: 7` — the last two colon-separated segments are the
  coordinates, never the drive letter or a path separator.
- Malformed input returns `null` rather than throwing: no colons, non-numeric line or col,
  negative or zero line, empty file segment.

## AC-0.2 — `EditIntentSchema` accepts a well-formed intent

A payload carrying `eid`, `eidIndex`, `loc`, `tag`, `kind`, `before`, `after`, and
`instruction` parses, and the parsed value is typed as `EditIntent`.

## AC-0.3 — `EditIntentSchema` rejects hostile and malformed payloads

Each of these fails to parse:

- `loc` that `parseLoc` rejects.
- `kind` outside `'text' | 'class' | 'style'`.
- `eidIndex` negative or non-integer.
- a `computed` map carrying a key that is not in `TRACKED_PROPS` — an open-ended computed
  diff is noise, so the property set is closed.
- `instruction` longer than 2000 characters — it is pasted into an agent prompt, so its
  size is bounded at the boundary.
- missing `before` or `after`.

## AC-0.4 — `TRACKED_PROPS` is closed and stable

- It is a readonly tuple, and `TrackedProp` is derived from it (one source of truth — the
  type cannot drift from the runtime list).
- It contains the properties the verifier compares: colour, background colour, font size,
  font weight, line height, the four margins, the four paddings, border radius, display,
  gap, width, height, text align, opacity.

## AC-0.5 — `EditResultSchema` covers every terminal state

`status` accepts exactly `landed | drifted | blocked | stalled | error` and nothing else.
`drifted` results carry a `mismatch` describing intent vs rendered; `blocked` and `error`
carry a `message`.
