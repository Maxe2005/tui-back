// tui/shared/terminal-view.logic: the Terminal overlay's pure decisions — which action a key
// resolves to for the current focus and run state, which footer context shows, and the layout
// numbers. The status-line wording lives store-side (store/slices/terminal-text.ts).
import type { FooterContextId } from '../keybindings/index.js';
import type { TextEditKey } from './components/text-edit.js';
import { resolveFocusStep } from './keys/focus-navigation.js';

export type TerminalFocus = 'prompt' | 'output';

export type TerminalKey = TextEditKey & { pageUp?: boolean; pageDown?: boolean };

export type TerminalKeyState = {
  focus: TerminalFocus;
  // The Esc-while-running confirmation line is showing.
  confirming: boolean;
  running: boolean;
  // A shell session exists; false while the container's manifest loads, or when the session
  // could not be created (unwired port, bad target) — the prompt is then disabled.
  ready: boolean;
};

export type TerminalKeyAction =
  | { type: 'run' }
  | { type: 'busy' }
  | { type: 'cancel' }
  | { type: 'clear-draft' }
  | { type: 'history'; direction: 'up' | 'down' }
  | { type: 'focus'; focus: TerminalFocus }
  | { type: 'fullscreen' }
  | { type: 'close' }
  | { type: 'confirm-close' }
  | { type: 'keep-running' }
  | { type: 'cancel-and-close' }
  | { type: 'scroll'; direction: 'up' | 'down' }
  | { type: 'page'; direction: 'up' | 'down' }
  | { type: 'help' }
  | { type: 'edit' }
  // A printable key typed while the output is focused: focus returns to the prompt and the
  // character lands in the draft.
  | { type: 'type-into-prompt' }
  | { type: 'ignore' };

export const TERMINAL_CONFIRM_CLOSE_TEXT = 'A command is running — Enter cancels it and closes the terminal, Esc keeps it running.';

function isPrintable(input: string, key: TerminalKey): boolean {
  return (
    input.length > 0 &&
    key.ctrl !== true &&
    key.meta !== true &&
    key.return !== true &&
    key.escape !== true &&
    key.backspace !== true &&
    key.delete !== true
  );
}

// The terminal owns every key while it is open; anything not listed here is inert.
export function resolveTerminalKey(input: string, key: TerminalKey, state: TerminalKeyState): TerminalKeyAction {
  if (state.confirming) {
    if (key.return === true) {
      return { type: 'cancel-and-close' };
    }
    return key.escape === true ? { type: 'keep-running' } : { type: 'ignore' };
  }
  if (key.escape === true) {
    return state.running ? { type: 'confirm-close' } : { type: 'close' };
  }
  if (key.ctrl === true && input === 'f') {
    return { type: 'fullscreen' };
  }
  // Ctrl+C never quits the app: it cancels the running command, or clears the idle draft.
  if (key.ctrl === true && input === 'c') {
    if (state.running) {
      return { type: 'cancel' };
    }
    return state.focus === 'prompt' ? { type: 'clear-draft' } : { type: 'ignore' };
  }
  // Two focus targets: Tab and Shift+Tab both swap them.
  if (resolveFocusStep(input, key, 'tab') !== null) {
    return { type: 'focus', focus: state.focus === 'prompt' ? 'output' : 'prompt' };
  }
  if (state.focus === 'output') {
    if (key.upArrow === true || key.downArrow === true) {
      return { type: 'scroll', direction: key.upArrow === true ? 'up' : 'down' };
    }
    if (key.pageUp === true || key.pageDown === true) {
      return { type: 'page', direction: key.pageUp === true ? 'up' : 'down' };
    }
    if (input === '?' && key.ctrl !== true && key.meta !== true) {
      return { type: 'help' };
    }
    return isPrintable(input, key) && state.ready ? { type: 'type-into-prompt' } : { type: 'ignore' };
  }
  if (!state.ready) {
    return { type: 'ignore' };
  }
  if (key.return === true) {
    return state.running ? { type: 'busy' } : { type: 'run' };
  }
  if (key.upArrow === true || key.downArrow === true) {
    return { type: 'history', direction: key.upArrow === true ? 'up' : 'down' };
  }
  if (key.pageUp === true || key.pageDown === true) {
    return { type: 'ignore' };
  }
  return { type: 'edit' };
}

export function terminalFooterContext(state: Pick<TerminalKeyState, 'focus' | 'confirming' | 'running'>): FooterContextId {
  if (state.confirming) {
    return 'terminal-confirm-close';
  }
  if (state.focus === 'output') {
    return 'terminal-output';
  }
  return state.running ? 'terminal-running' : 'terminal-prompt';
}

// The output box's height while windowed: two thirds of the region, at least 8 rows, never more
// than the region itself.
export function terminalWindowRows(regionRows: number): number {
  return Math.max(0, Math.min(Math.max(8, Math.floor((2 * regionRows) / 3)), regionRows));
}

// One page of output scrolled at once: the visible rows minus one line of overlap.
export function pageScrollOffset(offset: number, direction: 'up' | 'down', lineCount: number, pageRows: number): number {
  const step = Math.max(1, pageRows - 1);
  const next = direction === 'up' ? offset + step : offset - step;
  return Math.min(Math.max(next, 0), Math.max(lineCount - 1, 0));
}

// The prompt is one line: each run of pasted line breaks becomes a single space.
export function toSingleLine(input: string): string {
  return input.replace(/[\r\n]+/g, ' ');
}

// CSI (`ESC [ … final`), OSC (`ESC ] … BEL` or `ESC ] … ESC \\`) and the other two-byte escapes.
const ANSI_ESCAPE = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|\u001b[@-Z\\-_]/g;
// C0 controls (tab excluded, it is expanded first) and DEL.
const CONTROL_CHARS = /[\u0000-\u0008\u000a-\u001f\u007f]/g;
const TAB_WIDTH = 8;

// One line of program output as the terminal can show it: escape sequences stripped (colours,
// cursor moves, titles), only what follows the last carriage return kept (a progress bar's final
// state; a trailing CR from CRLF output is ignored), tabs expanded to the next 8-column stop, and
// any remaining control character dropped — raw bytes must never reach Ink.
export function sanitizeTerminalText(text: string): string {
  let clean = text.replace(ANSI_ESCAPE, '').replace(/\r+$/, '');
  const carriage = clean.lastIndexOf('\r');
  if (carriage !== -1) {
    clean = clean.slice(carriage + 1);
  }
  let expanded = '';
  for (const char of clean) {
    expanded += char === '\t' ? ' '.repeat(TAB_WIDTH - (expanded.length % TAB_WIDTH)) : char;
  }
  return expanded.replace(CONTROL_CHARS, '');
}
