import { describe, expect, it } from 'vitest';
import {
  pageScrollOffset,
  resolveTerminalKey,
  terminalFooterContext,
  terminalWindowRows,
  toSingleLine,
  sanitizeTerminalText,
  type TerminalKeyState,
} from './terminal-view.logic.js';

const prompt: TerminalKeyState = { focus: 'prompt', confirming: false, running: false, ready: true };
const output: TerminalKeyState = { ...prompt, focus: 'output' };

describe('resolveTerminalKey', () => {
  it('runs on Enter, refuses it while running, and ignores the prompt when not ready', () => {
    expect(resolveTerminalKey('', { return: true }, prompt)).toEqual({ type: 'run' });
    expect(resolveTerminalKey('', { return: true }, { ...prompt, running: true })).toEqual({ type: 'busy' });
    expect(resolveTerminalKey('', { return: true }, { ...prompt, ready: false })).toEqual({ type: 'ignore' });
    expect(resolveTerminalKey('a', {}, { ...prompt, ready: false })).toEqual({ type: 'ignore' });
  });

  it('types q, :, ? and zone mnemonics into the prompt', () => {
    for (const input of ['q', ':', '?', 'd', 'l', 'F']) {
      expect(resolveTerminalKey(input, {}, prompt)).toEqual({ type: 'edit' });
    }
  });

  it('browses history with Up/Down at the prompt', () => {
    expect(resolveTerminalKey('', { upArrow: true }, prompt)).toEqual({ type: 'history', direction: 'up' });
    expect(resolveTerminalKey('', { downArrow: true }, prompt)).toEqual({ type: 'history', direction: 'down' });
  });

  it('cancels with Ctrl+C while running, else clears the draft (never quits)', () => {
    expect(resolveTerminalKey('c', { ctrl: true }, { ...prompt, running: true })).toEqual({ type: 'cancel' });
    expect(resolveTerminalKey('c', { ctrl: true }, { ...output, running: true })).toEqual({ type: 'cancel' });
    expect(resolveTerminalKey('c', { ctrl: true }, prompt)).toEqual({ type: 'clear-draft' });
    expect(resolveTerminalKey('c', { ctrl: true }, output)).toEqual({ type: 'ignore' });
  });

  it('moves focus with Tab and toggles fullscreen with Ctrl+F from either focus', () => {
    expect(resolveTerminalKey('', { tab: true }, prompt)).toEqual({ type: 'focus', focus: 'output' });
    expect(resolveTerminalKey('', { tab: true }, output)).toEqual({ type: 'focus', focus: 'prompt' });
    expect(resolveTerminalKey('f', { ctrl: true }, prompt)).toEqual({ type: 'fullscreen' });
    expect(resolveTerminalKey('f', { ctrl: true }, output)).toEqual({ type: 'fullscreen' });
  });

  it('closes on Esc when idle, asks first while running, and resolves the confirmation', () => {
    expect(resolveTerminalKey('', { escape: true }, prompt)).toEqual({ type: 'close' });
    expect(resolveTerminalKey('', { escape: true }, { ...output, running: true })).toEqual({ type: 'confirm-close' });
    const confirming = { ...prompt, running: true, confirming: true };
    expect(resolveTerminalKey('', { return: true }, confirming)).toEqual({ type: 'cancel-and-close' });
    expect(resolveTerminalKey('', { escape: true }, confirming)).toEqual({ type: 'keep-running' });
    expect(resolveTerminalKey('x', {}, confirming)).toEqual({ type: 'ignore' });
    expect(resolveTerminalKey('c', { ctrl: true }, confirming)).toEqual({ type: 'ignore' });
  });

  it('scrolls, pages and opens help from the output; a printable key returns to the prompt', () => {
    expect(resolveTerminalKey('', { upArrow: true }, output)).toEqual({ type: 'scroll', direction: 'up' });
    expect(resolveTerminalKey('', { downArrow: true }, output)).toEqual({ type: 'scroll', direction: 'down' });
    expect(resolveTerminalKey('', { pageUp: true }, output)).toEqual({ type: 'page', direction: 'up' });
    expect(resolveTerminalKey('', { pageDown: true }, output)).toEqual({ type: 'page', direction: 'down' });
    expect(resolveTerminalKey('?', {}, output)).toEqual({ type: 'help' });
    expect(resolveTerminalKey('l', {}, output)).toEqual({ type: 'type-into-prompt' });
    expect(resolveTerminalKey('', { return: true }, output)).toEqual({ type: 'ignore' });
    expect(resolveTerminalKey('', { backspace: true }, output)).toEqual({ type: 'ignore' });
  });
});

describe('terminalFooterContext', () => {
  it('follows the confirmation, the focus and the run state', () => {
    expect(terminalFooterContext({ focus: 'prompt', confirming: false, running: false })).toBe('terminal-prompt');
    expect(terminalFooterContext({ focus: 'prompt', confirming: false, running: true })).toBe('terminal-running');
    expect(terminalFooterContext({ focus: 'output', confirming: false, running: true })).toBe('terminal-output');
    expect(terminalFooterContext({ focus: 'output', confirming: true, running: true })).toBe('terminal-confirm-close');
  });
});

describe('layout helpers', () => {
  it('sizes the window at two thirds of the region, at least 8 rows, capped by the region', () => {
    expect(terminalWindowRows(36)).toBe(24);
    expect(terminalWindowRows(9)).toBe(8);
    expect(terminalWindowRows(6)).toBe(6);
  });

  it('pages by the visible rows minus one, clamped to the output', () => {
    expect(pageScrollOffset(0, 'up', 100, 10)).toBe(9);
    expect(pageScrollOffset(95, 'up', 100, 10)).toBe(99);
    expect(pageScrollOffset(5, 'down', 100, 10)).toBe(0);
    expect(pageScrollOffset(0, 'up', 0, 10)).toBe(0);
  });
});

describe('toSingleLine', () => {
  it('turns each run of pasted line breaks into one space', () => {
    expect(toSingleLine('ls\r\n\npwd\n')).toBe('ls pwd ');
    expect(toSingleLine('plain')).toBe('plain');
  });
});

describe('sanitizeTerminalText', () => {
  it('strips CSI and OSC escape sequences', () => {
    expect(sanitizeTerminalText('\u001b[1;31mred\u001b[0m text')).toBe('red text');
    expect(sanitizeTerminalText('\u001b]0;title\u0007after')).toBe('after');
    expect(sanitizeTerminalText('\u001b]8;;http://x\u001b\\link\u001b]8;;\u001b\\')).toBe('link');
    expect(sanitizeTerminalText('\u001b[2K\u001b[1Gclear')).toBe('clear');
  });

  it('keeps only the text after the last carriage return, ignoring a trailing CRLF one', () => {
    expect(sanitizeTerminalText('10%\r50%\r100%')).toBe('100%');
    expect(sanitizeTerminalText('windows line\r')).toBe('windows line');
  });

  it('expands tabs to the next 8-column stop', () => {
    expect(sanitizeTerminalText('a\tb')).toBe('a       b');
    expect(sanitizeTerminalText('\tx')).toBe('        x');
    expect(sanitizeTerminalText('12345678\ty')).toBe('12345678        y');
  });

  it('drops the remaining control characters and DEL', () => {
    expect(sanitizeTerminalText('bell\u0007 back\u0008 nul\u0000 del\u007f end\u001b')).toBe('bell back nul del end');
    expect(sanitizeTerminalText('plain text')).toBe('plain text');
  });
});
