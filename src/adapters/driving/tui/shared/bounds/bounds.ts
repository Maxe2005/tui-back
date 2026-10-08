// tui/shared/bounds: the bounded-rendering contract's pure numbers — the named minimum terminal
// and pane sizes, and the pane split that honors them. Everything that renders dynamic content
// gets its box from here (top-down), clipping is only the safety net.

// Chrome is top bar 1 + tab bar 1 + footer 1 + the command/cursor row 1, which leaves 8 content
// rows at the minimum; 40 columns keeps a "▲ more above" line, the "[:] cmd" hint and a 12-char
// service name with its status glyph on one line (the tab bar collapses to mnemonics below 80).
export const MIN_TERMINAL_COLUMNS = 40;
export const MIN_TERMINAL_ROWS = 12;

// A pane must fit its header, one row and an indicator / twelve columns of label.
export const MIN_PANE_ROWS = 3;
export const MIN_PANE_COLUMNS = 12;

// Rows the shell itself uses outside the zone region: top bar, tab bar, footer.
export const SHELL_CHROME_ROWS = 3;

export type Bounds = { columns: number; rows: number };

export function isTerminalTooSmall(columns: number, rows: number): boolean {
  return columns < MIN_TERMINAL_COLUMNS || rows < MIN_TERMINAL_ROWS;
}

export function formatTooSmallMessage(columns: number, rows: number): string {
  return `Terminal too small — need at least ${MIN_TERMINAL_COLUMNS}×${MIN_TERMINAL_ROWS} (now ${columns}×${rows})`;
}

// Splits `total` cells (splitter included) between two panes by `ratio`, then enforces `minPane`
// on both. Returns the effective first-pane share when a minimum overrides the ratio, or null
// when the ratio already satisfies both minimums (so the layout stays untouched).
export function resolvePaneSplit(
  total: number,
  ratio: number,
  minPane: number,
  splitter = 1,
): { first: number; second: number; adjustedRatio: number | null } {
  const safeTotal = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  const safeRatio = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0.5;
  const usable = Math.max(0, safeTotal - splitter);
  const first = Math.round(usable * safeRatio);
  const second = usable - first;
  if (usable < minPane * 2) {
    const half = Math.floor(usable / 2);
    return { first: half, second: usable - half, adjustedRatio: usable > 0 ? half / usable : 0.5 };
  }
  if (first < minPane) {
    return { first: minPane, second: usable - minPane, adjustedRatio: minPane / usable };
  }
  if (second < minPane) {
    return { first: usable - minPane, second: minPane, adjustedRatio: (usable - minPane) / usable };
  }
  return { first, second, adjustedRatio: null };
}
