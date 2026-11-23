// tui/zones/edts: the EdtsZone's pure, non-React logic — formatting, selection/navigation math,
// form-focus derivation, and the dialogs' state shapes + initializers. Kept out of edts-zone.tsx
// so each concern is reachable without scrolling past the Ink component; every export is
// unit-tested directly, with no React import.
export * from './edts-zone.format.logic.js';
export * from './edts-zone.focus.logic.js';
export * from './edts-zone.modify.logic.js';
export * from './edts-zone.wizard.logic.js';
export * from './edts-zone.dialogs.logic.js';
