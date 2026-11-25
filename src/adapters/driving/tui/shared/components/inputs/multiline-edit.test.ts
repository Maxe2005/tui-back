import { describe, expect, it } from 'vitest';
import {
  backspace, createMultiline, deleteForward, formatJson, insertNewline, insertTab, insertText, killToEnd, moveDocEnd,
  moveDocStart, moveEnd, moveHome, moveLeft, movePage, moveRight, moveToOffset, moveVertical, moveWordLeft, moveWordRight,
  multilineText, pasteText, redoEdit, sanitizePaste, selectAll, selectionOnLine, undoEdit, UNDO_LIMIT,
} from './multiline-edit.js';

const at = (s: ReturnType<typeof createMultiline>) => [s.cursor.line, s.cursor.col];

describe('multiline-edit', () => {
  it('creates a buffer with the caret at the end', () => {
    const s = createMultiline('ab\ncde');
    expect(s.lines).toEqual(['ab', 'cde']);
    expect(at(s)).toEqual([1, 3]);
    expect(at(createMultiline('ab\ncd', 'start'))).toEqual([0, 0]);
    expect(multilineText(s)).toBe('ab\ncde');
  });

  it('moves across line boundaries with left/right', () => {
    let s = createMultiline('ab\ncd', 'start');
    s = moveLeft(s);
    expect(at(s)).toEqual([0, 0]);
    s = moveRight(moveRight(moveRight(s)));
    expect(at(s)).toEqual([1, 0]);
    s = moveLeft(s);
    expect(at(s)).toEqual([0, 2]);
    expect(at(moveEnd(moveHome(s)))).toEqual([0, 2]);
    expect(at(moveDocEnd(s))).toEqual([1, 2]);
    expect(at(moveDocStart(s))).toEqual([0, 0]);
  });

  it('keeps the desired column across shorter lines', () => {
    let s = createMultiline(`${'x'.repeat(20)}\nabcde\n${'y'.repeat(30)}`, 'start');
    s = moveEnd(moveRight(s));
    s = { ...s, cursor: { line: 0, col: 20 }, wantCol: 20 };
    s = moveVertical(s, 1);
    expect(at(s)).toEqual([1, 5]);
    s = moveVertical(s, 1);
    expect(at(s)).toEqual([2, 20]);
    expect(at(moveVertical(s, -5))).toEqual([0, 0]);
    expect(at(moveVertical(s, 5))).toEqual([2, 30]);
  });

  it('moves by word and by page', () => {
    let s = createMultiline('foo.bar baz', 'start');
    s = moveWordRight(s);
    expect(at(s)).toEqual([0, 3]);
    s = moveWordRight(s);
    expect(at(s)).toEqual([0, 7]);
    s = moveWordLeft(s);
    expect(at(s)).toEqual([0, 4]);
    s = moveWordLeft(moveWordLeft(s));
    expect(at(s)).toEqual([0, 0]);
    const tall = createMultiline(Array.from({ length: 30 }, (_, i) => `l${i}`).join('\n'), 'start');
    expect(at(movePage(tall, 1, 10))).toEqual([10, 0]);
    expect(at(movePage(movePage(tall, 1, 10), -1, 10))).toEqual([0, 0]);
  });

  it('crosses lines on word moves at line edges', () => {
    const s = createMultiline('ab\ncd', 'start');
    expect(at(moveWordLeft(moveHome(moveVertical(s, 1))))).toEqual([0, 2]);
    expect(at(moveWordRight(moveEnd(s)))).toEqual([1, 0]);
  });

  it('selects with shift-moves, replaces on type, and selects all', () => {
    let s = createMultiline('abcdef', 'start');
    s = moveRight(moveRight(moveRight(s, true), true), true);
    expect(selectionOnLine(s, 0)).toEqual({ from: 0, to: 3, newline: false });
    s = insertText(s, 'x');
    expect(multilineText(s)).toBe('xdef');
    expect(s.anchor).toBeNull();
    const all = selectAll(createMultiline('a\nbc'));
    expect(selectionOnLine(all, 0)).toEqual({ from: 0, to: 1, newline: true });
    expect(selectionOnLine(all, 1)).toEqual({ from: 0, to: 2, newline: false });
    expect(multilineText(backspace(all))).toBe('');
  });

  it('collapses a selection to its edge on plain left/right', () => {
    let s = moveRight(moveRight(createMultiline('abcd', 'start'), true), true);
    expect(at(moveLeft(s))).toEqual([0, 0]);
    s = moveRight(moveRight(createMultiline('abcd', 'start'), true), true);
    expect(at(moveRight(s))).toEqual([0, 2]);
  });

  it('indents Enter like the previous line, plus one level after an opener', () => {
    let s = createMultiline('  {', 'end');
    s = insertNewline(s);
    expect(s.lines).toEqual(['  {', '    ']);
    expect(at(s)).toEqual([1, 4]);
    s = insertNewline(insertText(createMultiline('  "a": 1'), ','));
    expect(s.lines[1]).toBe('  ');
    expect(multilineText(insertNewline(createMultiline('[')))).toBe('[\n  ');
  });

  it('inserts two spaces on Tab, backspaces and deletes across lines', () => {
    expect(multilineText(insertTab(createMultiline('a', 'start')))).toBe('  a');
    expect(multilineText(backspace(createMultiline('ab\ncd', 'start')))).toBe('ab\ncd');
    expect(multilineText(backspace(moveDocStart(createMultiline('ab\ncd'))))).toBe('ab\ncd');
    expect(multilineText(backspace(moveVertical(moveHome(createMultiline('ab\ncd')), 0)))).toBe('abcd');
    expect(multilineText(deleteForward(moveEnd(createMultiline('ab\ncd', 'start'))))).toBe('abcd');
    expect(multilineText(deleteForward(createMultiline('ab')))).toBe('ab');
  });

  it('kills to end of line, joining at the line end', () => {
    let s = moveRight(createMultiline('abcd\nef', 'start'));
    s = killToEnd(s);
    expect(s.lines).toEqual(['a', 'ef']);
    s = killToEnd(s);
    expect(s.lines).toEqual(['aef']);
  });

  it('pastes sanitised text as one undoable edit', () => {
    expect(sanitizePaste('a\r\nb\rc\x01\x1bd\te')).toBe('a\nb\ncde');
    const payload = Array.from({ length: 200 }, (_, i) => `{"n":${i}}`).join('\r\n');
    const base = createMultiline('xy', 'start');
    const s = pasteText(moveRight(base), payload);
    expect(s.lines).toHaveLength(200);
    expect(s.lines[0]).toBe('x{"n":0}');
    expect(s.lines[199]).toBe('{"n":199}y');
    expect(s.undo).toHaveLength(1);
    expect(multilineText(undoEdit(s))).toBe('xy');
    expect(pasteText(base, '\x01')).toBe(base);
  });

  it('undoes and redoes, coalescing typing, no-op on empty history', () => {
    const base = createMultiline('');
    expect(undoEdit(base)).toBe(base);
    expect(redoEdit(base)).toBe(base);
    let s = insertText(insertText(insertText(base, 'a'), 'b'), 'c');
    expect(s.undo).toHaveLength(1);
    s = insertNewline(s);
    s = insertText(s, 'd');
    expect(s.undo).toHaveLength(3);
    s = undoEdit(s);
    expect(multilineText(s)).toBe('abc\n');
    s = undoEdit(undoEdit(s));
    expect(multilineText(s)).toBe('');
    s = redoEdit(s);
    expect(multilineText(s)).toBe('abc');
    s = insertText(s, 'z');
    expect(s.redo).toEqual([]);
  });

  it('bounds the undo history', () => {
    let s = createMultiline('');
    for (let i = 0; i < UNDO_LIMIT + 20; i += 1) {
      s = insertNewline(s);
    }
    expect(s.undo).toHaveLength(UNDO_LIMIT);
  });

  it('moves to a flat offset', () => {
    const s = createMultiline('ab\ncde\nf', 'start');
    expect(at(moveToOffset(s, 4))).toEqual([1, 1]);
    expect(at(moveToOffset(s, 2))).toEqual([0, 2]);
    expect(at(moveToOffset(s, 999))).toEqual([2, 1]);
  });

  it('formats valid JSON in one undo step and refuses invalid JSON untouched', () => {
    const base = createMultiline('{"a":1}');
    const ok = formatJson(base);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(multilineText(ok.state)).toBe('{\n  "a": 1\n}');
      expect(multilineText(undoEdit(ok.state))).toBe('{"a":1}');
    }
    const bad = formatJson(createMultiline('{"a":'));
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.line).toBe(1);
    }
    expect(formatJson(createMultiline('  ')).ok).toBe(true);
  });
});
