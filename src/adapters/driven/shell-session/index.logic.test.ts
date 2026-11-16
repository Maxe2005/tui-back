import { describe, expect, it } from 'vitest';
import { createLineSplitter, createSentinelFilter, MAX_LINE_LENGTH, wrapCommand } from './index.logic.js';

describe('wrapCommand', () => {
  it('installs the sentinel EXIT trap before the command', () => {
    expect(wrapCommand('ls # note', 'S:')).toBe(`trap '__rc=$?; printf "\\n%s%s\\n" "S:" "$PWD"; exit $__rc' EXIT\nls # note`);
  });
});

describe('createLineSplitter', () => {
  it('splits across chunks, strips \\r, keeps empty lines and flushes the tail on end', () => {
    const lines: string[] = [];
    const splitter = createLineSplitter((text) => lines.push(text));
    splitter.push('a\r\nb');
    splitter.push('c\n\nd');
    expect(lines).toEqual(['a', 'bc', '']);
    splitter.end();
    splitter.end();
    expect(lines).toEqual(['a', 'bc', '', 'd']);
  });

  it('cuts a line with no newline every MAX_LINE_LENGTH characters', () => {
    const lines: string[] = [];
    const splitter = createLineSplitter((text) => lines.push(text));
    splitter.push('x'.repeat(MAX_LINE_LENGTH - 1));
    expect(lines).toEqual([]);
    splitter.push('x'.repeat(MAX_LINE_LENGTH + 10));
    expect(lines).toEqual(['x'.repeat(MAX_LINE_LENGTH), 'x'.repeat(MAX_LINE_LENGTH)]);
    splitter.push('y\nz');
    expect(lines[2]).toBe(`${'x'.repeat(9)}y`);
    splitter.end();
    expect(lines).toHaveLength(4);
  });

  it('keeps a line of exactly MAX_LINE_LENGTH characters whole', () => {
    const lines: string[] = [];
    const splitter = createLineSplitter((text) => lines.push(text), 4);
    splitter.push('abcd\nef');
    splitter.end();
    expect(lines).toEqual(['abcd', 'ef']);
  });
});

describe('createSentinelFilter', () => {
  function run(lines: string[]) {
    const out: string[] = [];
    const filter = createSentinelFilter('S:', (text) => out.push(text));
    lines.forEach((line) => filter.line(line));
    return { out, ...filter.end() };
  }

  it('hides the sentinel and the empty line the wrapper adds after newline-terminated output', () => {
    expect(run(['a', '', 'S:/x'])).toEqual({ out: ['a'], cwd: '/x' });
  });

  it('keeps output that had no trailing newline', () => {
    expect(run(['abc', 'S:/x'])).toEqual({ out: ['abc'], cwd: '/x' });
  });

  it('keeps genuine empty lines', () => {
    expect(run(['', 'a', '', '', 'S:/x'])).toEqual({ out: ['', 'a', ''], cwd: '/x' });
  });

  it('flushes a held empty line and reports no cwd when the sentinel never came', () => {
    expect(run(['a', ''])).toEqual({ out: ['a', ''] });
  });

  it('flushHeld emits a held empty line first, so a following stderr line keeps its order', () => {
    const out: string[] = [];
    const filter = createSentinelFilter('S:', (text) => out.push(`out:${text}`));
    filter.line('a');
    filter.line('');
    // The adapter calls flushHeld right before delivering a stderr line.
    filter.flushHeld();
    out.push('err:b');
    filter.line('S:/x');
    expect(out).toEqual(['out:a', 'out:', 'err:b']);
    expect(filter.end()).toEqual({ cwd: '/x' });
  });
});
