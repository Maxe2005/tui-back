// shared/components/text-edit: the hand-rolled controlled text-input interpreter (topic field,
// branch-edit field, autocomplete filter), no npm dependency. It filters every non-character
// key itself, so it's safe to unit-test against any Ink `Key`-shaped object. It lives here, not
// in edts-zone.logic, because importing it from there would close an import cycle
// (autocomplete -> edts-zone.logic -> branch-picker -> autocomplete).
export type TextEditKey = {
  backspace?: boolean;
  delete?: boolean;
  return?: boolean;
  escape?: boolean;
  tab?: boolean;
  shift?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  home?: boolean;
  end?: boolean;
  ctrl?: boolean;
  meta?: boolean;
};

// The controlled value/caret pair every `TextInputLine`-driving field carries.
export type TextInputState = {
  value: string;
  cursor: number;
};

// `{value, cursor}` in, `{value, cursor}` out — Left/Right/Home/End move `cursor` (clamped to
// [0, value.length]) and Backspace/Delete/typed-char apply at `cursor`. Every other key is
// inert.
export function nextTextInputValue(current: TextInputState, input: string, key: TextEditKey): TextInputState {
  const { value, cursor } = current;
  // Ctrl/meta stay fully inert even combined with an arrow/Home/End/Backspace/Delete flag (Ink
  // reports Ctrl+Left etc. with both set) — checked first, so Ctrl/Meta+<key> never moves or
  // edits the caret.
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
