// tui/shared/test-support: the terminal sizes the bounded-rendering matrix covers, and a frame
// reader that strips ANSI so a line's length is what the terminal would show.
import { MIN_TERMINAL_COLUMNS, MIN_TERMINAL_ROWS } from '../bounds/bounds.js';

export const MATRIX_SIZES = [
  { columns: 120, rows: 40 },
  { columns: 80, rows: 24 },
  { columns: 60, rows: 15 },
  { columns: MIN_TERMINAL_COLUMNS, rows: MIN_TERMINAL_ROWS },
] as const;

const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;

export function frameLines(output: string): string[] {
  const lines = output.replace(ANSI, '').split('\n');
  return lines.at(-1) === '' ? lines.slice(0, -1) : lines;
}
