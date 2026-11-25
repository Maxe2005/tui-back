// tui/zones/routes: routes-zone.raw-keys — the raw body editor's key table. It maps an Ink key onto
// the pure multi-line buffer model (shared/components/inputs/multiline-edit) and nothing else: the editor owns
// EVERY key while open (Ctrl+←/→ is word movement here, Ctrl+N/P/R are inert), `Esc` leaves through the body
// editor's `leaveRawEditor`. Updates go through a functional `setRawEditor` because several keypresses can
// arrive before a re-render.
import type { Key } from 'ink';
import type { RoutesZoneCtx } from '../routes-zone.ctx.js';
import {
  backspace, deleteForward, formatJson, insertNewline, insertTab, insertText, killToEnd, moveDocEnd, moveDocStart,
  moveEnd, moveHome, moveLeft, movePage, moveRight, moveVertical, moveWordLeft, moveWordRight,
  multilineText, pasteText, redoEdit, selectAll, undoEdit, type MultilineState,
} from '../../../shared/components/inputs/multiline-edit.js';
import { rawEditorLineBudget } from '../../../shared/components/json-tree/json-tree.js';

export type RawEditorState = { editor: MultilineState; error: string | null };

// Control characters other than the keys handled above are never typed into the buffer.
// eslint-disable-next-line no-control-regex
const HAS_CONTROL = /[\u0000-\u001f\u007f]/;

function withEditor(state: RawEditorState, editor: MultilineState): RawEditorState {
  if (editor === state.editor) {
    return state;
  }
  // A text change (compared by value, so undo/redo count) makes a shown parse error stale; plain movement keeps it.
  const changed = editor.lines !== state.editor.lines && multilineText(editor) !== multilineText(state.editor);
  return { editor, error: changed ? null : state.error };
}

function formatKey(state: RawEditorState): RawEditorState {
  const result = formatJson(state.editor);
  if (result.ok) {
    return { editor: result.state, error: null };
  }
  // Refused: the buffer, caret and selection stay exactly as they were.
  return {
    editor: state.editor,
    error: `(line ${result.line}, column ${result.column}) ${result.reason}`,
  };
}

function ctrlKey(state: RawEditorState, input: string, key: Key, pageSize: number): RawEditorState {
  const { editor } = state;
  const extend = key.shift === true;
  if (key.leftArrow === true) {
    return withEditor(state, moveWordLeft(editor, extend));
  }
  if (key.rightArrow === true) {
    return withEditor(state, moveWordRight(editor, extend));
  }
  // Ctrl+↑/↓ is the fallback for terminals that never report Ctrl+Home/End.
  if (key.home === true || key.upArrow === true) {
    return withEditor(state, moveDocStart(editor, extend));
  }
  if (key.end === true || key.downArrow === true) {
    return withEditor(state, moveDocEnd(editor, extend));
  }
  if (key.pageUp === true || key.pageDown === true) {
    return withEditor(state, movePage(editor, key.pageUp === true ? -1 : 1, pageSize, extend));
  }
  switch (input.toLowerCase()) {
    case 'a':
      return withEditor(state, selectAll(editor));
    case 'k':
      return withEditor(state, killToEnd(editor));
    case 'z':
      return withEditor(state, undoEdit(editor));
    case 'y':
      return withEditor(state, redoEdit(editor));
    case 'f':
      return formatKey(state);
    default:
      return state;
  }
}

// One key (Esc excluded: the caller leaves) applied to the editor state. `pageSize` is the visible line count.
export function applyRawKey(state: RawEditorState, input: string, key: Key, pageSize: number): RawEditorState {
  const { editor } = state;
  if (key.meta === true) {
    return state;
  }
  if (key.ctrl === true) {
    return ctrlKey(state, input, key, pageSize);
  }
  const extend = key.shift === true;
  if (key.leftArrow === true) {
    return withEditor(state, moveLeft(editor, extend));
  }
  if (key.rightArrow === true) {
    return withEditor(state, moveRight(editor, extend));
  }
  if (key.upArrow === true) {
    return withEditor(state, moveVertical(editor, -1, extend));
  }
  if (key.downArrow === true) {
    return withEditor(state, moveVertical(editor, 1, extend));
  }
  if (key.home === true) {
    return withEditor(state, moveHome(editor, extend));
  }
  if (key.end === true) {
    return withEditor(state, moveEnd(editor, extend));
  }
  if (key.pageUp === true || key.pageDown === true) {
    return withEditor(state, movePage(editor, key.pageUp === true ? -1 : 1, pageSize, extend));
  }
  if (key.return === true) {
    return withEditor(state, insertNewline(editor));
  }
  if (key.tab === true) {
    return key.shift === true ? state : withEditor(state, insertTab(editor));
  }
  if (key.backspace === true) {
    return withEditor(state, backspace(editor));
  }
  if (key.delete === true) {
    return withEditor(state, deleteForward(editor));
  }
  if (input.length === 0 || key.escape === true) {
    return state;
  }
  // A multi-character `input` is a paste that bracketed-paste mode did not catch: one edit, sanitised.
  if (input.length > 1) {
    return withEditor(state, pasteText(editor, input));
  }
  return HAS_CONTROL.test(input) ? state : withEditor(state, insertText(editor, input));
}

export function rawPageSize(c: Pick<RoutesZoneCtx, 'bodyTotalBudget'>, error: string | null): number {
  return rawEditorLineBudget(c.bodyTotalBudget, error !== null && error !== '');
}

export function handleRawKey(c: RoutesZoneCtx, input: string, key: Key): void {
  if (c.rawEditorRef.current === null) {
    return;
  }
  if (key.escape === true) {
    c.leaveRawEditor();
    return;
  }
  c.setRawEditor((previous) => (previous === null ? previous : applyRawKey(previous, input, key, rawPageSize(c, previous.error))));
}

export function handleRawPaste(c: RoutesZoneCtx, text: string): void {
  c.setRawEditor((previous) => (previous === null ? previous : withEditor(previous, pasteText(previous.editor, text))));
}
