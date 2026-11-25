// shared/components/inputs/multiline-edit: the pure multi-line buffer model behind the Routes raw
// body editor. Every operation is `(state, ...) => state`: lines, caret, optional
// selection anchor, the remembered "desired column" for vertical moves, and bounded undo/redo
// snapshots. No Ink and no JSON knowledge beyond `formatJson`; the single-line `TextInputState`
// (text-edit.ts) is deliberately untouched.
import { parseRawJsonBuffer } from '../json-tree/body-edit-path.js';

export type Pos = { line: number; col: number };

type Snapshot = { lines: readonly string[]; cursor: Pos; anchor: Pos | null };

export type MultilineState = {
  lines: readonly string[];
  cursor: Pos;
  // The selection's fixed end; `null` when nothing is selected. The caret is the moving end.
  anchor: Pos | null;
  // Column vertical moves aim for, so a short line in between does not lose it.
  wantCol: number;
  undo: readonly Snapshot[];
  redo: readonly Snapshot[];
  // `'type'` while the last edit was plain typing: consecutive typing coalesces into one undo step.
  lastEdit: 'type' | null;
};

export const UNDO_LIMIT = 100;
export const INDENT = '  ';

export function createMultiline(text: string, caret: 'start' | 'end' = 'end'): MultilineState {
  const lines = normalizeNewlines(text).split('\n');
  const cursor: Pos = caret === 'end' ? { line: lines.length - 1, col: (lines[lines.length - 1] ?? '').length } : { line: 0, col: 0 };
  return { lines, cursor, anchor: null, wantCol: cursor.col, undo: [], redo: [], lastEdit: null };
}

export function multilineText(state: MultilineState): string {
  return state.lines.join('\n');
}

// `\r\n` / `\r` become `\n`; every other control character (tabs included) is stripped.
export function sanitizePaste(text: string): string {
  // eslint-disable-next-line no-control-regex
  return normalizeNewlines(text).replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '');
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

function lineAt(state: MultilineState, line: number): string {
  return state.lines[line] ?? '';
}

function comparePos(a: Pos, b: Pos): number {
  return a.line !== b.line ? a.line - b.line : a.col - b.col;
}

export function hasSelection(state: MultilineState): boolean {
  return state.anchor !== null && comparePos(state.anchor, state.cursor) !== 0;
}

// The selection as an ordered `[start, end)` range, or `null` when empty.
export function selectionRange(state: MultilineState): { start: Pos; end: Pos } | null {
  if (state.anchor === null || comparePos(state.anchor, state.cursor) === 0) {
    return null;
  }
  return comparePos(state.anchor, state.cursor) < 0
    ? { start: state.anchor, end: state.cursor }
    : { start: state.cursor, end: state.anchor };
}

// The selected `[fromCol, toCol)` slice of one line (for rendering), or `null` when the line is
// outside the selection. A selection that spans the line break marks one extra trailing cell.
export function selectionOnLine(state: MultilineState, line: number): { from: number; to: number; newline: boolean } | null {
  const range = selectionRange(state);
  if (range === null || line < range.start.line || line > range.end.line) {
    return null;
  }
  const length = lineAt(state, line).length;
  const from = line === range.start.line ? range.start.col : 0;
  const to = line === range.end.line ? range.end.col : length;
  return { from, to, newline: line < range.end.line };
}

function snapshotOf(state: MultilineState): Snapshot {
  return { lines: state.lines, cursor: state.cursor, anchor: state.anchor };
}

function pushUndo(state: MultilineState, coalesce: boolean): readonly Snapshot[] {
  if (coalesce && state.lastEdit === 'type' && state.undo.length > 0) {
    return state.undo;
  }
  const next = [...state.undo, snapshotOf(state)];
  return next.length > UNDO_LIMIT ? next.slice(next.length - UNDO_LIMIT) : next;
}

function clampPos(lines: readonly string[], pos: Pos): Pos {
  const line = Math.min(Math.max(pos.line, 0), Math.max(lines.length - 1, 0));
  return { line, col: Math.min(Math.max(pos.col, 0), (lines[line] ?? '').length) };
}

// Replaces the range with `text` (may hold `\n`), returning the new lines and the caret after it.
function spliceLines(lines: readonly string[], start: Pos, end: Pos, text: string): { lines: string[]; cursor: Pos } {
  const head = (lines[start.line] ?? '').slice(0, start.col);
  const tail = (lines[end.line] ?? '').slice(end.col);
  const inserted = text.split('\n');
  const first = inserted[0] ?? '';
  const last = inserted[inserted.length - 1] ?? '';
  const middle = inserted.length === 1 ? [head + first + tail] : [head + first, ...inserted.slice(1, -1), last + tail];
  const next = [...lines.slice(0, start.line), ...middle, ...lines.slice(end.line + 1)];
  const cursor: Pos = inserted.length === 1 ? { line: start.line, col: head.length + first.length } : { line: start.line + inserted.length - 1, col: last.length };
  return { lines: next, cursor };
}

function edit(state: MultilineState, start: Pos, end: Pos, text: string, kind: 'type' | null): MultilineState {
  const { lines, cursor } = spliceLines(state.lines, start, end, text);
  return {
    lines,
    cursor,
    anchor: null,
    wantCol: cursor.col,
    undo: pushUndo(state, kind === 'type'),
    redo: [],
    lastEdit: kind,
  };
}

// Inserts `text` at the caret (replacing the selection) as ONE undoable edit. `text` may hold
// `\n`; it is not sanitised here (see `pasteText`).
export function insertText(state: MultilineState, text: string): MultilineState {
  if (text === '') {
    return state;
  }
  const range = selectionRange(state) ?? { start: state.cursor, end: state.cursor };
  return edit(state, range.start, range.end, text, text.includes('\n') ? null : 'type');
}

// A paste: sanitised, always its own undo step, never coalesced with typing.
export function pasteText(state: MultilineState, raw: string): MultilineState {
  const text = sanitizePaste(raw);
  if (text === '') {
    return state;
  }
  const range = selectionRange(state) ?? { start: state.cursor, end: state.cursor };
  return edit(state, range.start, range.end, text, null);
}

// Enter: splits the line, keeping its indentation and adding one level after `{` / `[`.
export function insertNewline(state: MultilineState): MultilineState {
  const range = selectionRange(state) ?? { start: state.cursor, end: state.cursor };
  const before = lineAt(state, range.start.line).slice(0, range.start.col);
  const indent = /^[ \t]*/.exec(before)?.[0] ?? '';
  const opener = /[{[]\s*$/.test(before);
  return edit(state, range.start, range.end, `\n${indent}${opener ? INDENT : ''}`, null);
}

export function insertTab(state: MultilineState): MultilineState {
  return insertText(state, INDENT);
}

export function backspace(state: MultilineState): MultilineState {
  const range = selectionRange(state);
  if (range !== null) {
    return edit(state, range.start, range.end, '', null);
  }
  const { line, col } = state.cursor;
  if (col > 0) {
    return edit(state, { line, col: col - 1 }, state.cursor, '', null);
  }
  if (line > 0) {
    return edit(state, { line: line - 1, col: lineAt(state, line - 1).length }, state.cursor, '', null);
  }
  return state;
}

export function deleteForward(state: MultilineState): MultilineState {
  const range = selectionRange(state);
  if (range !== null) {
    return edit(state, range.start, range.end, '', null);
  }
  const { line, col } = state.cursor;
  if (col < lineAt(state, line).length) {
    return edit(state, state.cursor, { line, col: col + 1 }, '', null);
  }
  if (line < state.lines.length - 1) {
    return edit(state, state.cursor, { line: line + 1, col: 0 }, '', null);
  }
  return state;
}

// Ctrl+K: deletes from the caret to the end of the line (or the selection when there is one);
// at the end of a line it joins the next line instead.
export function killToEnd(state: MultilineState): MultilineState {
  const range = selectionRange(state);
  if (range !== null) {
    return edit(state, range.start, range.end, '', null);
  }
  const { line, col } = state.cursor;
  if (col < lineAt(state, line).length) {
    return edit(state, state.cursor, { line, col: lineAt(state, line).length }, '', null);
  }
  return deleteForward(state);
}

function restore(state: MultilineState, snapshot: Snapshot, undo: readonly Snapshot[], redo: readonly Snapshot[]): MultilineState {
  return { lines: snapshot.lines, cursor: snapshot.cursor, anchor: snapshot.anchor, wantCol: snapshot.cursor.col, undo, redo, lastEdit: null };
}

export function undoEdit(state: MultilineState): MultilineState {
  const previous = state.undo[state.undo.length - 1];
  if (previous === undefined) {
    return state;
  }
  return restore(state, previous, state.undo.slice(0, -1), [...state.redo, snapshotOf(state)]);
}

export function redoEdit(state: MultilineState): MultilineState {
  const next = state.redo[state.redo.length - 1];
  if (next === undefined) {
    return state;
  }
  return restore(state, next, [...state.undo, snapshotOf(state)], state.redo.slice(0, -1));
}

// ---- movement ------------------------------------------------------------------------------

function moved(state: MultilineState, cursor: Pos, extend: boolean, keepWantCol = false): MultilineState {
  const target = clampPos(state.lines, cursor);
  return {
    ...state,
    cursor: target,
    anchor: extend ? (state.anchor ?? state.cursor) : null,
    wantCol: keepWantCol ? state.wantCol : target.col,
    lastEdit: null,
  };
}

export function moveLeft(state: MultilineState, extend = false): MultilineState {
  const range = selectionRange(state);
  if (!extend && range !== null) {
    return moved(state, range.start, false);
  }
  const { line, col } = state.cursor;
  if (col > 0) {
    return moved(state, { line, col: col - 1 }, extend);
  }
  return line > 0 ? moved(state, { line: line - 1, col: lineAt(state, line - 1).length }, extend) : moved(state, state.cursor, extend);
}

export function moveRight(state: MultilineState, extend = false): MultilineState {
  const range = selectionRange(state);
  if (!extend && range !== null) {
    return moved(state, range.end, false);
  }
  const { line, col } = state.cursor;
  if (col < lineAt(state, line).length) {
    return moved(state, { line, col: col + 1 }, extend);
  }
  return line < state.lines.length - 1 ? moved(state, { line: line + 1, col: 0 }, extend) : moved(state, state.cursor, extend);
}

// Vertical move by `delta` lines, aiming for the remembered column. Past the first/last line the
// caret goes to the line's start/end (standard editor behaviour).
export function moveVertical(state: MultilineState, delta: number, extend = false): MultilineState {
  const target = state.cursor.line + delta;
  if (target < 0) {
    return moved(state, { line: 0, col: 0 }, extend);
  }
  if (target > state.lines.length - 1) {
    const last = state.lines.length - 1;
    return moved(state, { line: last, col: lineAt(state, last).length }, extend);
  }
  return moved(state, { line: target, col: Math.min(state.wantCol, lineAt(state, target).length) }, extend, true);
}

export function moveHome(state: MultilineState, extend = false): MultilineState {
  return moved(state, { line: state.cursor.line, col: 0 }, extend);
}

export function moveEnd(state: MultilineState, extend = false): MultilineState {
  return moved(state, { line: state.cursor.line, col: lineAt(state, state.cursor.line).length }, extend);
}

export function moveDocStart(state: MultilineState, extend = false): MultilineState {
  return moved(state, { line: 0, col: 0 }, extend);
}

export function moveDocEnd(state: MultilineState, extend = false): MultilineState {
  const last = state.lines.length - 1;
  return moved(state, { line: last, col: lineAt(state, last).length }, extend);
}

const isWordChar = (char: string | undefined): boolean => char !== undefined && /[A-Za-z0-9_]/.test(char);

export function moveWordLeft(state: MultilineState, extend = false): MultilineState {
  const { line } = state.cursor;
  let { col } = state.cursor;
  if (col === 0) {
    return moveLeft({ ...state, anchor: extend ? state.anchor : null }, extend);
  }
  const text = lineAt(state, line);
  while (col > 0 && !isWordChar(text[col - 1])) {
    col -= 1;
  }
  if (col > 0 && isWordChar(text[col - 1])) {
    while (col > 0 && isWordChar(text[col - 1])) {
      col -= 1;
    }
  }
  return moved(state, { line, col }, extend);
}

export function moveWordRight(state: MultilineState, extend = false): MultilineState {
  const { line } = state.cursor;
  let { col } = state.cursor;
  const text = lineAt(state, line);
  if (col >= text.length) {
    return moveRight({ ...state, anchor: extend ? state.anchor : null }, extend);
  }
  while (col < text.length && !isWordChar(text[col])) {
    col += 1;
  }
  while (col < text.length && isWordChar(text[col])) {
    col += 1;
  }
  return moved(state, { line, col }, extend);
}

export function movePage(state: MultilineState, direction: 1 | -1, pageSize: number, extend = false): MultilineState {
  return moveVertical(state, direction * Math.max(1, Math.floor(pageSize)), extend);
}

export function selectAll(state: MultilineState): MultilineState {
  const last = state.lines.length - 1;
  const end: Pos = { line: last, col: lineAt(state, last).length };
  return { ...state, anchor: { line: 0, col: 0 }, cursor: end, wantCol: end.col, lastEdit: null };
}

// Puts the caret at a flat character offset into `multilineText` (e.g. a JSON parse position).
export function moveToOffset(state: MultilineState, offset: number): MultilineState {
  let remaining = Math.max(0, offset);
  for (let line = 0; line < state.lines.length; line += 1) {
    const length = lineAt(state, line).length;
    if (remaining <= length) {
      return moved(state, { line, col: remaining }, false);
    }
    remaining -= length + 1;
  }
  return moveDocEnd(state);
}

// Replaces the whole buffer as one undoable edit (caret at the end).
export function replaceAll(state: MultilineState, text: string): MultilineState {
  const lines = normalizeNewlines(text).split('\n');
  const cursor: Pos = { line: lines.length - 1, col: (lines[lines.length - 1] ?? '').length };
  return { lines, cursor, anchor: null, wantCol: cursor.col, undo: pushUndo(state, false), redo: [], lastEdit: null };
}

export type FormatResult =
  | { ok: true; state: MultilineState }
  | { ok: false; reason: string; line: number; column: number; position: number };

// Ctrl+F: pretty-prints the buffer as JSON (two spaces). Invalid JSON leaves the buffer untouched
// and reports the parse error; an empty buffer is a no-op.
export function formatJson(state: MultilineState): FormatResult {
  const text = multilineText(state);
  if (text.trim() === '') {
    return { ok: true, state };
  }
  const parsed = parseRawJsonBuffer(text);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason, line: parsed.line, column: parsed.column, position: parsed.position };
  }
  const pretty = JSON.stringify(parsed.value, null, 2);
  return { ok: true, state: pretty === text ? state : replaceAll(state, pretty) };
}
