// tui/shared/reset-screen.logic: the pure state machine — Services forcing EDTs, nothing
// checked, a wrong confirmation word, and Esc.
import { describe, expect, it } from 'vitest';
import {
  createResetScreenState,
  handleResetScreenKey,
  isEdtsLocked,
  type ResetScreenKey,
  type ResetScreenState,
} from './reset-screen.logic.js';

function press(state: ResetScreenState, input: string, key: ResetScreenKey = {}) {
  return handleResetScreenKey(state, input, key);
}

function typeText(state: ResetScreenState, text: string): ResetScreenState {
  let next = state;
  for (const char of text) {
    next = press(next, char).state;
  }
  return next;
}

// Cursor row indexes: 0 = EDTs, 1 = Histories, 2 = Services.
function toggleRow(state: ResetScreenState, row: number): ResetScreenState {
  let next = { ...state, cursor: 0 };
  for (let i = 0; i < row; i += 1) {
    next = press(next, '', { downArrow: true }).state;
  }
  return press(next, ' ').state;
}

function atConfirm(): ResetScreenState {
  let state = toggleRow(createResetScreenState(), 1);
  state = press(state, '', { return: true }).state;
  return press(state, '', { return: true }).state;
}

describe('reset screen state machine', () => {
  it('opens on step 1 with every box unchecked', () => {
    const state = createResetScreenState();
    expect(state.step).toBe('select');
    expect(state.checked).toEqual({ edts: false, histories: false, services: false });
  });

  it('NOTHING_CHECKED: Enter on step 1 stays on step 1', () => {
    const { state, action } = press(createResetScreenState(), '', { return: true });
    expect(state.step).toBe('select');
    expect(action).toEqual({ kind: 'none' });
  });

  it('SERVICES_FORCES_EDTS: checking Services force-checks and locks EDTs', () => {
    let state = toggleRow(createResetScreenState(), 2);
    expect(state.checked).toEqual({ edts: true, histories: false, services: true });
    expect(isEdtsLocked(state)).toBe(true);

    // Unchecking EDTs is refused while Services is checked.
    state = toggleRow(state, 0);
    expect(state.checked.edts).toBe(true);

    // Unchecking Services unlocks EDTs, which stays checked.
    state = toggleRow(state, 2);
    expect(state.checked).toEqual({ edts: true, histories: false, services: false });
    expect(isEdtsLocked(state)).toBe(false);
    state = toggleRow(state, 0);
    expect(state.checked.edts).toBe(false);
  });

  it('clamps the cursor to the row list', () => {
    let state = press(createResetScreenState(), '', { upArrow: true }).state;
    expect(state.cursor).toBe(0);
    for (let i = 0; i < 5; i += 1) {
      state = press(state, '', { downArrow: true }).state;
    }
    expect(state.cursor).toBe(2);
  });

  it('advances select -> summary -> confirm on Enter', () => {
    let state = toggleRow(createResetScreenState(), 0);
    state = press(state, '', { return: true }).state;
    expect(state.step).toBe('summary');
    state = press(state, '', { return: true }).state;
    expect(state.step).toBe('confirm');
    expect(state.confirm).toEqual({ value: '', cursor: 0 });
  });

  it('Enter on the summary advances only once the preview is ready', () => {
    const summary = press(toggleRow(createResetScreenState(), 0), '', { return: true }).state;
    expect(summary.step).toBe('summary');

    const notReady = handleResetScreenKey(summary, '', { return: true }, false);
    expect(notReady.state.step).toBe('summary');
    expect(notReady.action).toEqual({ kind: 'none' });
    expect(handleResetScreenKey(summary, '', { escape: true }, false).action).toEqual({ kind: 'close' });

    expect(handleResetScreenKey(summary, '', { return: true }, true).state.step).toBe('confirm');
  });

  it('executes on the exact word with the selected categories', () => {
    let state = toggleRow(createResetScreenState(), 2);
    state = toggleRow(state, 1);
    state = press(state, '', { return: true }).state;
    state = press(state, '', { return: true }).state;
    state = typeText(state, 'reset');
    const { action } = press(state, '', { return: true });
    expect(action).toEqual({ kind: 'execute', categories: ['edts', 'histories', 'services'] });
  });

  it.each(['Reset', 'reset ', 'rese', ' reset', 'RESET', ''])('WRONG_WORD: %j + Enter does nothing', (word) => {
    const state = typeText(atConfirm(), word);
    const result = press(state, '', { return: true });
    expect(result.action).toEqual({ kind: 'none' });
    expect(result.state.step).toBe('confirm');
  });

  it('supports backspace in the confirm input', () => {
    let state = typeText(atConfirm(), 'resett');
    state = press(state, '', { backspace: true }).state;
    expect(state.confirm.value).toBe('reset');
    expect(press(state, '', { return: true }).action.kind).toBe('execute');
  });

  it('ESC: closes from every step', () => {
    const select = createResetScreenState();
    const summary = press(toggleRow(select, 0), '', { return: true }).state;
    const confirm = typeText(atConfirm(), 'reset');
    for (const state of [select, summary, confirm]) {
      expect(press(state, '', { escape: true }).action).toEqual({ kind: 'close' });
    }
  });
});
