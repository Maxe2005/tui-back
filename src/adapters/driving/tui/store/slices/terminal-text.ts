// tui/store/slices/terminal-text: the display text the terminal slice writes — the busy notice,
// the echoed command and the status line a finished run leaves (`exit N`, `cancelled`, errors).
// Store-side so the slice never depends on a view module; the view reads it from here too.
import type { Result } from '../../../../../core/result.js';
import type { ShellRunResult } from '../../../../../core/shell/index.js';

export const TERMINAL_BUSY_NOTICE = 'a command is running';

export function firstLine(message: string): string {
  return message.split('\n')[0] ?? message;
}

// The status line a finished run leaves under its output, or null when it needs none (a clean
// exit, a blank command). A TTY refusal shows the guard's hint as is.
export function terminalStatusText(result: Result<ShellRunResult>): string | null {
  if (!result.ok) {
    if (result.error.code === 'tty-required') {
      return firstLine(result.error.message);
    }
    return `error: ${firstLine(result.error.message)}`;
  }
  const outcome = result.data;
  switch (outcome.status) {
    case 'exited':
      return outcome.exitCode === 0 ? null : `exit ${String(outcome.exitCode)}`;
    case 'cancelled':
      return 'cancelled';
    case 'failed':
      return `error: ${firstLine(outcome.error.message)}`;
    case 'noop':
      return null;
  }
}

export function terminalEchoText(command: string): string {
  return `$ ${command}`;
}

