/**
 * Which of the inspector's controls are live, and what a dead one says.
 *
 * Nothing here is new. `textFieldState`, `classFieldState` and `styleFieldState` are
 * AC-4.7's, and the sentences they carry are the ones a user already reads in v1's panel.
 * This module exists only to take an `Anchor` — which is what crosses the wire — and hand
 * back the three answers together, so no call site in the studio re-derives one of them.
 */
import {
  classFieldState,
  styleFieldState,
  textFieldState,
  type ControlState,
} from '@sve/overlay';
import type { Anchor } from '@sve/rpc';

export interface FieldStates {
  text: ControlState;
  class: ControlState;
  style: ControlState;
}

export function fieldStates(anchor: Anchor): FieldStates {
  return {
    text: textFieldState(anchor.textKind),
    class: classFieldState(anchor.classKind),
    style: styleFieldState(anchor.classKind),
  };
}
