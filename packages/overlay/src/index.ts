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
