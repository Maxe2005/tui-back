import { describe, expect, it } from 'vitest';
import { err, ok } from '../../../../../core/result.js';
import { firstLine, terminalEchoText, terminalStatusText } from './terminal-text.js';

describe('terminalStatusText', () => {
  it('names non-zero exits, cancels and errors; a clean exit and a blank command say nothing', () => {
    expect(terminalStatusText(ok({ status: 'exited', exitCode: 0 }))).toBeNull();
    expect(terminalStatusText(ok({ status: 'noop' }))).toBeNull();
    expect(terminalStatusText(ok({ status: 'exited', exitCode: 127 }))).toBe('exit 127');
    expect(terminalStatusText(ok({ status: 'cancelled' }))).toBe('cancelled');
    expect(terminalStatusText(ok({ status: 'failed', error: { code: 'shell-unavailable', message: 'no sh\nmore' } }))).toBe('error: no sh');
    expect(terminalStatusText(err('container-not-running', 'Container api is not running (down)'))).toBe('error: Container api is not running (down)');
    expect(terminalStatusText(err('tty-required', 'vim needs a terminal'))).toBe('vim needs a terminal');
  });
});

describe('terminal text helpers', () => {
  it('echoes the command and keeps only a message first line', () => {
    expect(terminalEchoText('ls -la')).toBe('$ ls -la');
    expect(firstLine('one\ntwo')).toBe('one');
    expect(firstLine('')).toBe('');
  });
});
