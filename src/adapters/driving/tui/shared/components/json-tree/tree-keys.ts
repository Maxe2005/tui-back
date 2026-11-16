// tui/shared/components/json-tree/tree-keys: tree-local key dispatch (raw Ink key flags to tree
// actions) for the tree and its rules panel. Pure, no Ink/React import.

// Tree-local key dispatch (the shared `NavigationKey` contract is deliberately not extended —
// arrows/Home/End/PgUp/PgDn are interpreted here from the raw Ink key flags), plus the edit
// keys (`Enter` edit, `a`/`d`/`t`/`r`), which only the body editor applies. Returns null for
// keys the tree does not own (Esc, digits, Ctrl combos): the zone swallows those while focused
// without acting.
export type TreeKeyFlags = {
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  pageUp?: boolean;
  pageDown?: boolean;
  home?: boolean;
  end?: boolean;
  ctrl?: boolean;
};

export type TreeKeyAction =
  | 'up'
  | 'down'
  | 'home'
  | 'end'
  | 'page-up'
  | 'page-down'
  | 'fold'
  | 'unfold'
  | 'fold-level'
  | 'unfold-level'
  | 'hide-key'
  | 'only-key'
  | 'toggle-panel'
  | 'edit-value'
  | 'add-entry'
  | 'delete-entry'
  | 'change-type'
  | 'open-raw';

export function resolveTreeKeyAction(input: string, key: TreeKeyFlags): TreeKeyAction | null {
  if (key.ctrl === true) {
    return null;
  }
  if (key.upArrow === true) {
    return 'up';
  }
  if (key.downArrow === true) {
    return 'down';
  }
  if (key.home === true) {
    return 'home';
  }
  if (key.end === true) {
    return 'end';
  }
  if (key.pageUp === true) {
    return 'page-up';
  }
  if (key.pageDown === true) {
    return 'page-down';
  }
  if (key.leftArrow === true) {
    return 'fold';
  }
  if (key.rightArrow === true) {
    return 'unfold';
  }
  switch (input) {
    case ' ':
      return 'unfold';
    case '+':
      return 'unfold-level';
    case '-':
      return 'fold-level';
    case 'h':
      return 'hide-key';
    case 'H':
      return 'only-key';
    case 'a':
    case 'A':
      return 'add-entry';
    case 'd':
    case 'D':
      return 'delete-entry';
    case 't':
    case 'T':
      return 'change-type';
    case 'r':
    case 'R':
      return 'open-raw';
    case '\r':
      return 'edit-value';
    case 'f':
    case 'F':
      return 'toggle-panel';
    default:
      return null;
  }
}

export type TreePanelAction =
  | { type: 'remove-rule'; index: number }
  | { type: 'toggle-nulls' }
  | { type: 'clear-all' }
  | { type: 'close-panel' };

// Filter-panel dispatch: digits remove the nth listed rule, `n` flips hide-nulls, `c`
// clears everything, `f` closes (Esc closes too, handled by the zone so focus unwinds).
export function resolveTreePanelKeyAction(input: string, ruleCount: number): TreePanelAction | null {
  if (input >= '1' && input <= '9') {
    const index = Number(input) - 1;
    return index < ruleCount ? { type: 'remove-rule', index } : null;
  }
  switch (input) {
    case 'n':
    case 'N':
      return { type: 'toggle-nulls' };
    case 'c':
    case 'C':
      return { type: 'clear-all' };
    case 'f':
    case 'F':
      return { type: 'close-panel' };
    default:
      return null;
  }
}
