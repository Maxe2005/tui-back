// shared/components/text-edit: the hand-rolled controlled text-input pure interpreter
// (topic field, branch-edit field, autocomplete filter) — no new npm dependency, per the
// spec's Boundaries. Defensively filters every non-character key itself (not just the
// arrow/Home/End/Tab/Return/Escape the useInput dispatcher already intercepts first) so
// it's safe to unit-test directly against any Ink `Key`-shaped object.
//
// Leaf-home history: this lived in zones/edts/edts-zone.logic.ts until the shared
// branch-autocomplete input needed it too — importing it from there would have closed an
// import cycle (autocomplete -> edts-zone.logic -> branch-picker -> autocomplete), the exact
// cycle story 2.32 kept branch-picker's local copy out of. Every importer (including
// edts-zone.logic's own former consumers) reads it from here now.
export type TextEditKey = {
  backspace?: boolean;
  delete?: boolean;
  return?: boolean;
  escape?: boolean;
  tab?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  home?: boolean;
  end?: boolean;
  ctrl?: boolean;
  meta?: boolean;
};

// Story 2.32: the controlled value/caret pair every `TextInputLine`-driving field now carries —
// paired sibling of the bare-string field it replaces, exactly like the existing
// `branchNamesTouched` paired-map convention (Code Map).
export type TextInputState = {
  value: string;
  cursor: number;
};

// Story 2.32: retargeted from a bare-string interpreter to `{value, cursor}` in, `{value,
// cursor}` out — Left/Right/Home/End now actually move `cursor` (clamped to [0, value.length])
// instead of being silent no-ops, and Backspace/Delete/typed-char apply at `cursor` rather than
// always at the end. Every other key stays exactly as inert as before.
export function nextTextInputValue(current: TextInputState, input: string, key: TextEditKey): TextInputState {
  const { value, cursor } = current;
  // Code review fix: ctrl/meta must stay fully inert even when combined with an arrow/Home/
  // End/Backspace/Delete flag (Ink reports Ctrl+Left etc. with both set) — checked first, before
  // any of the new navigation/edit branches below, so Ctrl/Meta+<key> never moves or edits the
  // caret, matching every other key's pre-story no-op behavior.
  if (key.ctrl || key.meta) {
    return current;
  }
  if (key.leftArrow) {
    return { value, cursor: Math.max(0, cursor - 1) };
  }
  if (key.rightArrow) {
    return { value, cursor: Math.min(value.length, cursor + 1) };
  }
  if (key.home) {
    return { value, cursor: 0 };
  }
  if (key.end) {
    return { value, cursor: value.length };
  }
  if (key.backspace) {
    if (cursor === 0) {
      return current;
    }
    return { value: value.slice(0, cursor - 1) + value.slice(cursor), cursor: cursor - 1 };
  }
  if (key.delete) {
    if (cursor >= value.length) {
      return current;
    }
    return { value: value.slice(0, cursor) + value.slice(cursor + 1), cursor };
  }
  if (key.return || key.escape || key.tab || key.upArrow || key.downArrow) {
    return current;
  }
  if (input.length === 0) {
    return current;
  }
  return { value: value.slice(0, cursor) + input + value.slice(cursor), cursor: cursor + input.length };
}
