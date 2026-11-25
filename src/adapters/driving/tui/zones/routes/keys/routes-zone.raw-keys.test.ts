import type { Key } from 'ink';
import { describe, expect, it } from 'vitest';
import { createMultiline, multilineText } from '../../../shared/components/inputs/multiline-edit.js';
import { applyRawKey, type RawEditorState } from './routes-zone.raw-keys.js';

const press = (state: RawEditorState, input: string, key: Partial<Key> = {}, page = 5): RawEditorState =>
  applyRawKey(state, input, key as Key, page);
const start = (text: string, caret: 'start' | 'end' = 'end'): RawEditorState => ({ editor: createMultiline(text, caret), error: null });
const text = (state: RawEditorState) => multilineText(state.editor);
const at = (state: RawEditorState) => [state.editor.cursor.line, state.editor.cursor.col];

describe('applyRawKey', () => {
  it('types, backspaces and deletes', () => {
    let s = start('ab', 'start');
    s = press(s, 'x');
    expect(text(s)).toBe('xab');
    s = press(s, '', { delete: true });
    expect(text(s)).toBe('xb');
    s = press(s, '', { backspace: true });
    expect(text(s)).toBe('b');
  });

  it('Enter is indent-aware and Tab inserts two spaces', () => {
    let s = press(start('  {'), '', { return: true });
    expect(s.editor.lines).toEqual(['  {', '    ']);
    s = press(start('a', 'start'), '', { tab: true });
    expect(text(s)).toBe('  a');
    expect(text(press(start('a', 'start'), '', { tab: true, shift: true }))).toBe('a');
  });

  it('moves with arrows keeping the column, and selects with shift', () => {
    let s = start(`${'x'.repeat(20)}\nabc\n${'y'.repeat(20)}`, 'start');
    s = press(s, '', { end: true });
    s = press(s, '', { downArrow: true });
    expect(at(s)).toEqual([1, 3]);
    s = press(s, '', { downArrow: true });
    expect(at(s)).toEqual([2, 20]);
    s = press(s, '', { upArrow: true, shift: true });
    expect(s.editor.anchor).not.toBeNull();
    s = press(s, 'q');
    expect(s.editor.lines).toHaveLength(2);
  });

  it('Shift+Right x3 then a typed char replaces the selection', () => {
    let s = start('abcdef', 'start');
    for (let i = 0; i < 3; i += 1) {
      s = press(s, '', { rightArrow: true, shift: true });
    }
    expect(text(press(s, 'x'))).toBe('xdef');
  });

  it('Ctrl+arrows move by word, Ctrl+Home/End by document, PgUp/PgDn by page', () => {
    let s = start('foo bar\nbaz', 'start');
    s = press(s, '', { ctrl: true, rightArrow: true });
    expect(at(s)).toEqual([0, 3]);
    s = press(s, '', { ctrl: true, leftArrow: true });
    expect(at(s)).toEqual([0, 0]);
    s = press(s, '', { ctrl: true, end: true });
    expect(at(s)).toEqual([1, 3]);
    s = press(s, '', { ctrl: true, home: true });
    expect(at(s)).toEqual([0, 0]);
    const tall = start(Array.from({ length: 30 }, (_, i) => `l${i}`).join('\n'), 'start');
    expect(at(press(tall, '', { pageDown: true }, 7))).toEqual([7, 0]);
  });

  it('Ctrl+A, Ctrl+K, Ctrl+Z and Ctrl+Y', () => {
    let s = start('abcd\nef', 'start');
    s = press(s, 'k', { ctrl: true });
    expect(text(s)).toBe('\nef');
    s = press(s, 'z', { ctrl: true });
    expect(text(s)).toBe('abcd\nef');
    s = press(s, 'y', { ctrl: true });
    expect(text(s)).toBe('\nef');
    s = press(s, 'a', { ctrl: true });
    expect(text(press(s, '', { backspace: true }))).toBe('');
  });

  it('Ctrl+F formats valid JSON and refuses invalid JSON with line/column and the caret at the error', () => {
    const ok = press(start('{"a":1}'), 'f', { ctrl: true });
    expect(text(ok)).toBe('{\n  "a": 1\n}');
    const bad = press(start('{"a":'), 'f', { ctrl: true });
    expect(text(bad)).toBe('{"a":');
    expect(bad.error).toMatch(/^\(line 1, column \d+\)/);
  });

  it('a text change clears a shown error, movement keeps it', () => {
    const withError: RawEditorState = { ...start('ab'), error: '(line 1, column 1) x' };
    expect(press(withError, '', { leftArrow: true }).error).not.toBeNull();
    expect(press(withError, 'c').error).toBeNull();
  });

  it('owns Ctrl+N/P/R (inert) and treats a multi-char input as one sanitised paste', () => {
    const s = start('ab');
    for (const letter of ['n', 'p', 'r']) {
      expect(press(s, letter, { ctrl: true })).toBe(s);
    }
    const pasted = press(start(''), 'l1\r\nl2\x01');
    expect(pasted.editor.lines).toEqual(['l1', 'l2']);
    expect(pasted.editor.undo).toHaveLength(1);
    expect(press(s, '\x01')).toBe(s);
  });
});

describe('applyRawKey fallbacks', () => {
  it('Ctrl+Up/Down jump to the document ends', () => {
    const s = start('a\nb\nc', 'start');
    expect(at(press(s, '', { ctrl: true, downArrow: true }))).toEqual([2, 1]);
    expect(at(press(press(s, '', { ctrl: true, downArrow: true }), '', { ctrl: true, upArrow: true }))).toEqual([0, 0]);
  });
});

describe('applyRawKey format and error handling', () => {
  it('a refused Ctrl+F keeps the caret and the selection', () => {
    let s = start('{"a":', 'start');
    s = press(press(s, '', { rightArrow: true, shift: true }), '', { rightArrow: true, shift: true });
    const refused = press(s, 'f', { ctrl: true });
    expect(refused.error).not.toBeNull();
    expect(refused.editor.anchor).toEqual(s.editor.anchor);
    expect(refused.editor.cursor).toEqual(s.editor.cursor);
  });

  it('a successful Ctrl+F clears a displayed error, even on already-pretty input', () => {
    const pretty: RawEditorState = { ...start('{\n  "a": 1\n}'), error: '(line 1, column 1) stale' };
    expect(press(pretty, 'f', { ctrl: true }).error).toBeNull();
    const compact: RawEditorState = { ...start('{"a":1}'), error: '(line 1, column 1) stale' };
    expect(press(compact, 'f', { ctrl: true }).error).toBeNull();
  });

  it('undo and redo clear the error by text value', () => {
    let s = press(start('ab'), 'c');
    s = { ...s, error: '(line 1, column 1) x' };
    expect(press(s, 'z', { ctrl: true }).error).toBeNull();
  });
});
