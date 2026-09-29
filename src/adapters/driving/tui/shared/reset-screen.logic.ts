// tui/shared/reset-screen.logic: the `:reset` overlay's pure key-handling state machine —
// every decision lives here so it's directly unit-testable (render-to-string.ts's fake stdin
// never drives a useInput callback; see settings-screen.tsx's own testability note). The
// component only interprets the raw Ink key and applies the returned state/action.
//
// Three steps (spec-reset-command.md, Boundaries):
//   1. select  — checkboxes, all unchecked on open; Up/Down moves, Space toggles, Enter
//                advances only when at least one box is checked. Checking Services
//                force-checks EDTs, and EDTs stays locked checked while Services is checked.
//   2. summary — read-only review of exactly what goes; Enter advances.
//   3. confirm — a text input; Enter executes only when the value is exactly `reset`
//                (case-sensitive, no trim). Any other Enter is a no-op.
// Esc cancels from any step (the caller closes the overlay; nothing was written yet).
import type { ResetCategory } from '../../../../core/scripts/reset-tool.js';
import { nextTextInputValue, type TextEditKey, type TextInputState } from './components/text-edit.js';

export type ResetScreenStep = 'select' | 'summary' | 'confirm';

export const RESET_CONFIRM_WORD = 'reset';

export const RESET_SCREEN_ROWS: readonly ResetCategory[] = ['edts', 'histories', 'services'];

export const RESET_CATEGORY_LABELS: Record<ResetCategory, string> = {
  edts: 'EDTs',
  histories: 'Histories',
  services: 'Registered services',
};

export type ResetScreenState = {
  step: ResetScreenStep;
  cursor: number;
  checked: Record<ResetCategory, boolean>;
  confirm: TextInputState;
};

export type ResetScreenKey = TextEditKey & { return?: boolean; escape?: boolean };

export type ResetScreenAction =
  | { kind: 'none' }
  | { kind: 'close' }
  | { kind: 'execute'; categories: ResetCategory[] };

export type ResetScreenKeyResult = { state: ResetScreenState; action: ResetScreenAction };

export function createResetScreenState(): ResetScreenState {
  return {
    step: 'select',
    cursor: 0,
    checked: { edts: false, histories: false, services: false },
    confirm: { value: '', cursor: 0 },
  };
}

export function isEdtsLocked(state: ResetScreenState): boolean {
  return state.checked.services;
}

export function selectedCategories(state: ResetScreenState): ResetCategory[] {
  return RESET_SCREEN_ROWS.filter((category) => state.checked[category]);
}

// Exact comparison on purpose: `Reset`, `reset ` and `rese` must all be refused.
export function isConfirmWordValid(value: string): boolean {
  return value === RESET_CONFIRM_WORD;
}

export function toggleResetCategory(state: ResetScreenState, category: ResetCategory): ResetScreenState {
  if (category === 'edts' && isEdtsLocked(state)) {
    return state;
  }
  const nextValue = !state.checked[category];
  const checked = { ...state.checked, [category]: nextValue };
  if (category === 'services' && nextValue) {
    checked.edts = true;
  }
  return { ...state, checked };
}

const NONE: ResetScreenAction = { kind: 'none' };

export function handleResetScreenKey(state: ResetScreenState, input: string, key: ResetScreenKey): ResetScreenKeyResult {
  if (key.escape) {
    return { state, action: { kind: 'close' } };
  }

  if (state.step === 'select') {
    if (key.upArrow) {
      return { state: { ...state, cursor: Math.max(0, state.cursor - 1) }, action: NONE };
    }
    if (key.downArrow) {
      return { state: { ...state, cursor: Math.min(RESET_SCREEN_ROWS.length - 1, state.cursor + 1) }, action: NONE };
    }
    if (input === ' ') {
      const category = RESET_SCREEN_ROWS[state.cursor];
      return { state: category ? toggleResetCategory(state, category) : state, action: NONE };
    }
    if (key.return && selectedCategories(state).length > 0) {
      return { state: { ...state, step: 'summary' }, action: NONE };
    }
    return { state, action: NONE };
  }

  if (state.step === 'summary') {
    if (key.return) {
      return { state: { ...state, step: 'confirm', confirm: { value: '', cursor: 0 } }, action: NONE };
    }
    return { state, action: NONE };
  }

  // confirm
  if (key.return) {
    if (isConfirmWordValid(state.confirm.value)) {
      return { state, action: { kind: 'execute', categories: selectedCategories(state) } };
    }
    return { state, action: NONE };
  }
  return { state: { ...state, confirm: nextTextInputValue(state.confirm, input, key) }, action: NONE };
}
