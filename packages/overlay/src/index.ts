export {
  ATTR_CLASS,
  ATTR_EID,
  ATTR_LOC,
  ATTR_TEXT,
  SVE_ATTRS,
  readClassKind,
  readTextKind,
  type ClassKind,
  type TextKind,
} from './attrs.js';

export {
  DEFAULT_ROOT_FONT_SIZE,
  diffComputed,
  normalizeColor,
  normalizeLength,
  normalizeText,
  normalizeValue,
  setColorRealm,
  valuesEqual,
} from './compare.js';

export {
  buildExcerpt,
  defaultSourceUrl,
  type Caret,
  type Excerpt,
  type ExcerptLine,
} from './excerpt.js';

export { captureSnapshot, readComputed } from './snapshot.js';

export {
  OVERRIDE_STYLE_ATTR,
  buildStylesheet,
  createOverrideStyleSheet,
  declarationsFor,
  declarationsForStore,
  eidSelector,
  propertiesDeclaredByClasses,
  type DeclarationEntry,
  type Declarations,
  type OverrideStyleSheet,
} from './apply.js';

export {
  createOverrideStore,
  isEmptyOverride,
  type ClassOverride,
  type Override,
  type OverrideStore,
} from './store.js';

export { createReasserter, type OverrideEntry, type Reasserter } from './reassert.js';

export {
  anchorFor,
  createHighlight,
  moveSelection,
  resolveAnchor,
  stampedAncestor,
  type Anchor,
  type AnchorRef,
  type Highlight,
  type SelectionMove,
} from './selection.js';

export {
  APPLY_LABELS,
  CHROME_CSS,
  CLASS_ABSENT_REASON,
  CLASS_DYNAMIC_REASON,
  STYLE_FIELDS,
  TEXT_EMPTY_REASON,
  TEXT_EXPRESSION_REASON,
  blastRadiusMessage,
  classFieldState,
  createInspector,
  styleFieldState,
  textFieldState,
  type ApplyPhase,
  type ControlState,
  type Inspector,
  type InspectorState,
  type Verdict,
} from './inspector.js';

export { buildIntent, describeEdit, inferKind, type IntentInput } from './intent.js';

export {
  HOST_ATTR,
  REMOTE_SURFACE,
  mountOverlay,
  type MountOptions,
  type OverlayHandle,
  type RemoteOverlay,
} from './mount.js';
