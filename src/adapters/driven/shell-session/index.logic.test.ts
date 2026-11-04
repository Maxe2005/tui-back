import { describe, expect, it } from 'vitest';
import { createLineSplitter, createSentinelFilter, wrapCommand } from './index.logic.js';

describe('wrapCommand', () => {
  it('appends the sentinel printf on its own line and preserves the exit status', () => {
    expect(wrapCommand('ls # note', 'S:')).toBe(`ls # note\n__rc=$?; printf '\\n%s%s\\n' 'S:' "$PWD"; exit $__rc`);
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
});
