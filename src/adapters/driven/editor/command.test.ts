import { describe, expect, it } from 'vitest';
import { resolveEditorCommand, tokenizeCommandLine } from './command.js';

describe('resolveEditorCommand', () => {
  it('replaces every <repo> occurrence, including inside a larger argument', () => {
    expect(resolveEditorCommand('code --new-window <repo>', undefined, '/repo/a')).toEqual({ binary: 'code', args: ['--new-window', '/repo/a'] });
    expect(resolveEditorCommand('ed --folder-uri=file://<repo> <repo>', undefined, '/repo/a')).toEqual({
      binary: 'ed',
      args: ['--folder-uri=file:///repo/a', '/repo/a'],
    });
  });

  it('appends the repo path when the command carries no placeholder', () => {
    expect(resolveEditorCommand('code --wait', undefined, '/repo/a')).toEqual({ binary: 'code', args: ['--wait', '/repo/a'] });
  });

  it('keeps a repo path containing spaces as one argument', () => {
    expect(resolveEditorCommand('code <repo>', undefined, '/my repos/a')).toEqual({ binary: 'code', args: ['/my repos/a'] });
  });

  it('falls back setting -> $EDITOR -> vi, skipping blank values', () => {
    expect(resolveEditorCommand('', 'hx', '/repo/a')).toEqual({ binary: 'hx', args: ['/repo/a'] });
    expect(resolveEditorCommand('  ', '  ', '/repo/a')).toEqual({ binary: 'vi', args: ['/repo/a'] });
    expect(resolveEditorCommand('', undefined, '/repo/a')).toEqual({ binary: 'vi', args: ['/repo/a'] });
  });
});

describe('tokenizeCommandLine', () => {
  it('splits on runs of whitespace', () => {
    expect(tokenizeCommandLine('  code   --wait\t<repo> ')).toEqual(['code', '--wait', '<repo>']);
    expect(tokenizeCommandLine('   ')).toEqual([]);
  });

  it('keeps quoted segments (single or double) as one token, quotes removed', () => {
    expect(tokenizeCommandLine('"/opt/My Editor/bin/ed" --title \'a b\' <repo>')).toEqual(['/opt/My Editor/bin/ed', '--title', 'a b', '<repo>']);
    expect(tokenizeCommandLine('ed --flag=""')).toEqual(['ed', '--flag=']);
  });
});
