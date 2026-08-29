# AC-14 — the editor registered twice

Found while building the studio: connecting a project that **already registers `sve()` in its
own Vite config** double-registers the stamping pass. Two `sve:source-loc` instances run; the
first stamps every element, the second finds the file already stamped and correctly reports
zero — and the host's `onStamp` is attached to the second.

The host then reports `no-elements-stamped` while the served module in fact carries every
attribute. Verified on `apps/demo`: the diagnostic fired, and `GET /src/components/Hero.tsx`
from that same session returned 17 `data-sve-loc` attributes.

Because AC-11.4 makes that diagnostic **blocking**, the most obvious thing anyone tries —
opening the project this repo ships — is refused with a reason that is false.

This is the failure mode AC-11.4 exists to prevent, arriving through the door AC-11.4 built.

These criteria are fixed. If an implementation fails one, the implementation changes.

## AC-14.1 — Registering the editor twice stamps once

A config carrying `sve()` served by a host that also injects `sve()` produces exactly one
stamping pass. Elements are stamped exactly once — asserted on the served module, which must
contain no duplicated `data-sve-*` attribute.

## AC-14.2 — Every registration is told what happened

Both instances' `onStamp` callbacks receive the report from the single pass that ran. A
caller that registered a callback is not silently demoted because another registration
happened to be resolved first.

Asserted with two registrations carrying distinct callbacks: both see the same non-zero
element count for the same file.

## AC-14.3 — The false diagnostic is gone

A host session connected to a project whose config already registers `sve()` reports **no**
`no-elements-stamped` diagnostic, and its `status().diagnostics` is clean.

Asserted against a fixture whose Vite config registers `sve()` itself — the shape that
produced the bug, not a shape that merely resembles it.

## AC-14.4 — The single-registration path is unchanged

A project that does **not** register `sve()` behaves exactly as before: one pass, one
callback, the same reports. The 899 existing tests and 15 E2E tests pass untouched.

Deduplication must not become a second way for stamping to silently not happen — the
diagnostic exists because that failure is invisible from the outside.
