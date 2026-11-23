// tui/shared/components: the one hint format — `[Key] verb`, entries joined by two spaces,
// English, `Esc`/`Enter` capitalised, `↑/↓` for the vertical pair, `Ctrl+W` never `^W`.
export type Hint = readonly [key: string, verb: string];

export const HINT_SEPARATOR = '  ';
export const KEY_UP_DOWN = '↑/↓';

export function formatHint([key, verb]: Hint): string {
  return `[${key}] ${verb}`;
}

export function formatHints(hints: readonly Hint[]): string {
  return hints.map(formatHint).join(HINT_SEPARATOR);
}

export const CONFIRM_CANCEL_HINTS: readonly Hint[] = [
  ['Enter', 'confirm'],
  ['Esc', 'cancel'],
];
