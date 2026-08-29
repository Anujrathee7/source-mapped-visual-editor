# AC-12 — `@sve/studio`

The workspace: connect a project, see it rendered, edit it by clicking or by talking, and
watch a running account of what changed and whether it actually landed.

```
┌──────────┬────────────────────────┬────────────┐
│ CHANGES  │                        │  AGENT     │
│          │      the project       │  CHAT      │
│ ● h1     │      (iframe)          │            │
│   landed │                        │  > …       │
│ ● card   │                        │            │
│   drifted│                        │  [input]   │
└──────────┴────────────────────────┴────────────┘
```

These criteria are fixed. If an implementation fails one, the implementation changes.

## AC-12.1 — Chat authors intents; it does not bypass verification

**The criterion the whole of v2 rests on.**

A click produces an exact element and a resolved intent, which is what makes a verdict
possible. "Make the hero tighter" produces neither. So a chat message must resolve to a
**target and a concrete change** before anything is written:

1. the agent names the element (`eid` + `loc`) and the change;
2. the overlay applies it as an **override** — visible immediately, nothing written;
3. Apply runs the same verified write as any click, reaching the same
   `landed` / `drifted` / `blocked` / `stalled` verdicts.

Asserted end to end: a chat-driven edit produces an override *before* any write, and its
verdict comes from the same loop. A proposal the user does not accept writes nothing —
asserted on the file, not on the UI.

There is no path from the chat panel to the filesystem that skips the loop. A test asserts
that a chat turn alone, with no Apply, leaves the project byte-for-byte unchanged.

## AC-12.2 — Connecting

- A folder path or a GitHub URL, entered in the UI.
- While connecting, the state is visible: cloning, detecting, installing, starting.
- A refusal from `@sve/host` is rendered with the reason it gave — the message already names
  what was looked for and not found, so it is shown, not replaced with "could not connect".
- **`no-elements-stamped` is rendered as a blocking error**, not a warning to scroll past. An
  editor that loads and does nothing when clicked is the failure most easily mistaken for a
  broken product; `status().diagnostics` already carries it.
- Installing dependencies for a cloned repository is confirmed explicitly, naming the
  repository, per AC-11.5. The UI must not make that a habit-click: it says what will run.

## AC-12.3 — The change log is the recap

One row per intent, newest first: the element, what changed, and the verdict.

- A row's verdict is the live one — `applying` resolves in place to `landed`/`drifted`/etc.
- A `drifted` row shows intent versus rendered, in the same two-sided form the v1 inspector
  used.
- Per-row **Revert**, backed by the existing snapshot store, restores that job's files
  byte-for-byte and marks the row `reverted` — never `landed`.
- Selecting a row selects its element in the preview.
- The log survives a preview reload; it is session state, not page state.

## AC-12.4 — The preview

- The project renders in the iframe, and clicking an element selects it — driven over
  `@sve/rpc`, with the overlay's mechanism still inside the frame.
- The inspector's diagnostic — `file:line:col`, the source excerpt, the caret under the exact
  column — is rendered by the studio from `InspectorState`. **The caret column is exact**;
  off-by-one is a failed criterion, as it was in AC-4.8.
- Disabled controls keep their reasons verbatim from AC-4.7.
- A preview that disconnects (navigated, crashed, host stopped) says so and offers reconnect.
  It never hangs — `@sve/rpc` already rejects rather than waits.

## AC-12.5 — The provider picker is honest

- Claude, any OpenAI-compatible endpoint (base URL + key + model), and the fake are
  selectable **per session**, not per process.
- Cost is stated plainly where it is chosen. A cheap model is a legitimate choice here
  *because* drift is caught — say that, rather than implying every provider is equivalent.
- A missing credential is reported with the setting named, before a job runs, not as a 401
  from three layers down.
- Keys are entered in the UI and held in the host process. They are never written into the
  connected project, never logged, and never sent to the browser once set.

## AC-12.6 — Design

Continues `docs/design.md` §1 — the compiler-diagnostic chrome scaled from a panel to a
workspace. `paper` remains the source excerpt's surface alone; the caret keeps its own colour
and never doubles as a status; `landed`/`drifted` appear nowhere but a verdict.

The preview is the one place the user's own design appears, so the chrome around it stays
quiet and does not compete with it.

## AC-12.7 — Quality floor

Keyboard reachable throughout, with visible focus. The three panels are resizable and the
layout survives to a laptop width. `prefers-reduced-motion` respected. No layout shift when a
verdict resolves — a row changing state must not move the rows below it.
