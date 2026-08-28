# AC-5 — The verification loop (end to end)

This is the project's thesis, stated as tests: **hot reload returning the same result is
the proof the edit landed.** Everything before this milestone exists to make this loop
possible; if this loop does not hold, the rest is a preview toy.

Playwright, against the running demo, with `SVE_AGENT=fake` unless stated otherwise.

These criteria are fixed. If an implementation fails one, the implementation changes.

## The loop under test

After the bridge reports a write, the overlay must, in this order:

1. wait for `vite:afterUpdate`, then two `requestAnimationFrame`s so React has committed;
2. **re-anchor** the element by `data-sve-eid` plus the recorded `eidIndex`;
3. **lift the override** — remove the CSS rule and stop re-asserting text;
4. read the live DOM;
5. compare it to the recorded intent;
6. report `landed`, or re-apply the override and report `drifted`.

Step 3 is what makes the check mean anything. A verifier that compares while its own
override is still in place is measuring its own illusion, and AC-5.2 exists to catch
exactly that.

## AC-5.1 — Happy path: a text edit lands

Select the hero `<h1>`. The inspector shows a `file:line:col` matching its `data-sve-loc`.
Type new text; the DOM updates immediately, before any network call.

Press Apply. Then assert **all** of:

- the file on disk changed, at the expected line — the test reads the file itself;
- no other line of that file changed;
- HMR fired;
- the override was lifted (the injected stylesheet has no rule for this `eid`, and no
  re-assertion observer is still active for it);
- the rendered text still matches the intent;
- the status reads `Landed`.

## AC-5.2 — The verifier actually verifies

With the fake agent in `wrong` mode, so it writes `Ship Faster` where the intent was
`Ship faster`:

- the status is `Drifted`, **not** `Landed`;
- the mismatch is shown with both sides: intent and rendered;
- the override is re-applied, so the user still sees what they asked for;
- the file is left as the agent wrote it, and Revert is offered.

**Without this test passing, AC-5.1 proves nothing** — a verifier that always reports green
also passes AC-5.1. This criterion is the reason the fake agent must be able to fail.

## AC-5.3 — A class edit verifies by computed value, not source text

Change a heading's colour by editing its Tailwind class. The agent writes a class whose
computed colour matches the intent but whose source text differs from anything the overlay
sent. The status is `Landed`.

Then the inverse: the agent writes a class that *looks* plausible but computes to a
different colour. The status is `Drifted`.

Together these assert the comparison is on resolved computed values, not on strings.

## AC-5.4 — Re-anchoring survives the line shift the agent itself caused

Apply an edit that changes the number of lines in the file — the agent's write moves every
line below it.

- the element is still found after HMR, by `eid`;
- its `data-sve-loc` now reports the **new** line, and the inspector updates to match;
- a second edit applied to the same element immediately afterwards targets the new line,
  not the stale one.

This is the criterion that justifies carrying two ids (see AC-1.3).

## AC-5.5 — Shared instances

Select one of the six beach cards and apply a style edit.

- before Apply, all six show the override (AC-4.6);
- after the agent writes and HMR fires, all six render the change from source;
- the status is `Landed` once, not six times.

## AC-5.6 — Blocked is a first-class outcome

With the fake agent in `blocked` mode: the status is `Blocked`, the message states the
reason, the file is byte-for-byte unchanged, and the override remains applied so the user's
intent is not silently lost.

## AC-5.7 — Stalled is detected, not hung

With the fake agent in `noop` mode — reports success, writes nothing, so no HMR ever fires:
the status becomes `Stalled` within the timeout, and the UI explains that the file did not
change. The overlay must not wait forever.

## AC-5.8 — Revert

After any applied edit, Revert restores the file byte-for-byte, clears the override, and
returns the element to the state it had before the edit. Verified on a file with CRLF
endings (see AC-3.2).

## AC-5.9 — Serial application under concurrent user input

Queue three edits to the same file in rapid succession. Each lands against the file as it
exists at the moment its job runs, none targets a stale line, and the final file contains
all three changes. No edit is silently dropped.

## AC-5.10 — Live-agent suite (opt-in, not CI)

`SVE_AGENT=claude` runs AC-5.1, AC-5.3 and AC-5.6 against the real Agent SDK. These assert
on **outcome** — the status reached, the file changed at the right line — never on exact
diff text, because the agent's phrasing is not deterministic and asserting on it would make
the suite flaky by construction.

Skipped by default. It costs tokens, so it never runs in CI and never runs implicitly.
