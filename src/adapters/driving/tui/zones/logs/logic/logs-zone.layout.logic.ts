// tui/zones/logs: grid and zone layout math (chrome rows, pane cells) and scroll-offset math.
import { spacing } from '../../../shared/theme/theme.js';

// Picks the squarest rows x cols grid fitting n panes (ceil(sqrt(n)) columns) within the
// terminal's available area. 0 panes is a degenerate 0x0 grid — the zone renders its own
// empty-state message instead, never calling this with a non-positive width/height either (both
// default to 1 here purely so the arithmetic stays total for a pathological caller).
export type GridLayout = {
  rows: number;
  cols: number;
  cellWidth: number;
  cellHeight: number;
};

// A pane needs its border, a title row and a line of content, and a few columns of text.
const MIN_PANE_CELL_ROWS = 4;

const MIN_PANE_CELL_COLUMNS = 12;

export function maxVisiblePanes(width: number, height: number): number {
  return Math.max(1, Math.floor(height / MIN_PANE_CELL_ROWS)) * Math.max(1, Math.floor(width / MIN_PANE_CELL_COLUMNS));
}

export function computeGridLayout(paneCount: number, width: number, height: number): GridLayout {
  if (paneCount <= 0) {
    return { rows: 0, cols: 0, cellWidth: 0, cellHeight: 0 };
  }
  const cols = Math.ceil(Math.sqrt(paneCount));
  const rows = Math.ceil(paneCount / cols);
  const safeWidth = Math.max(width, 1);
  const safeHeight = Math.max(height, 1);
  return {
    rows,
    cols,
    cellWidth: Math.max(Math.floor(safeWidth / cols), 1),
    cellHeight: Math.max(Math.floor(safeHeight / rows), 1),
  };
}

// The list column takes `listRatio` of the width left after the one-column splitter; the grid's
// auto-resize (computeGridLayout) absorbs whatever width remains.
const SPLITTER_COLUMNS = 1;

// Rough terminal-chrome budget (top bar, zone-tab bar, footer, this zone's own list headers/
// hints) subtracted from the raw window size before computeGridLayout ever sees it — an
// approximation is fine here since the real per-pane sizing still flows through Ink's own
// flexGrow layout; this only decides how many rows/cols to try to fit and how many lines
// worth of content each pane's own scroll window keeps in view.
const CHROME_ROWS = 8;

const PANE_CHROME_ROWS = 3;

// A grid pane's content width is its cell width minus its own border (1 col each side) and
// paddingX={1} (1 col each side) — needed to know how many terminal rows a wrapped line will
// actually take (see computeLineRowCount).
const GRID_PANE_CHROME_COLS = 4;

// CHROME_ROWS/PANE_CHROME_ROWS/GRID_PANE_CHROME_COLS above are rough guesses — real chrome varies
// per pane (an optional streamError or "no more history" line adds a row; Yoga's flex-grow
// rounding hands some grid rows one more terminal row than `floor(height / rows)`). They only
// seed the first paint: `useElementSize` then measures each pane's content box for real, so the
// pane never keeps a gap at the bottom.

// The filter-history grid browser's layout budget — mirrors command-bar.tsx's
// MODAL_CHROME_WIDTH/MIN_GRID_WIDTH (a `ModalDialog`'s chrome plus a safety margin) since this
// grid renders inside the LogFilterEditor `ModalDialog`.
const HISTORY_GRID_CHROME_WIDTH = 6;

const HISTORY_GRID_MIN_WIDTH = 10;

// The history grid browser's available-*height* budget — ModalDialog's chrome (double border
// top/bottom + padding top/bottom + title row + "──" separator = 6 rows) plus the editor's fixed
// rows around the grid (TextInputLine + Level line + the hint line below = 3 rows). An
// approximation, like CHROME_ROWS; the optional inline-error line is deliberately not subtracted,
// so the budget stays slightly generous rather than short while a regex draft is invalid.
const HISTORY_GRID_CHROME_ROWS = 9;

const HISTORY_GRID_MIN_VISIBLE_ROWS = 3;

// The rule list view's fixed rows: ModalDialog's chrome (6) plus its header line, the
// clear-all confirmation line and the notice line (1 each, counted even when not shown).
const RULES_LIST_CHROME_ROWS = 9;

// The library view renders one more line than the rule list (a confirmation, a notice and an
// error can all show at once).
const LIBRARY_CHROME_ROWS = RULES_LIST_CHROME_ROWS + 1;

// Rough total-rows budget for the Logs zone's list column (top bar, zone-tab bar, footer, and the
// "LOGS" title row) — the list column and the pane grid are row siblings sharing the same
// vertical extent, so this reuses CHROME_ROWS' estimate.
const LOGS_LIST_HEADER_ROWS = 2; // "ACTIVE EDT MEMBERS" + "OTHER SERVICES" header rows, always rendered.

export type LogsLayoutInput = {
  windowColumns: number;
  listRatio: number;
  windowRows: number;
  activePaneCount: number;
  edtServiceCount: number;
  otherServiceCount: number;
  filterEditorOpen: boolean;
  historyGridOpen: boolean;
  filterHistoryGridMaxRows: number;
  // The open editor's view and, for the list view, how many rules it lists.
  filterEditorView?: 'list' | 'rule' | 'library' | 'name';
  filterRuleCount?: number;
  // The rows the `a` actions menu renders (0 or absent while closed) — a sibling below the
  // block like the filter editor (never both open). See logsActionsMenuRows.
  actionsMenuRows?: number;
};

export type LogsLayout = {
  layout: GridLayout;
  visiblePaneCount: number;
  paneVisibleLines: number;
  paneContentWidth: number;
  fullscreenVisibleLines: number;
  fullscreenContentWidth: number;
  historyGridAvailableWidth: number;
  historyGridAvailableHeight: number;
  rulesListMaxVisibleRows: number;
  edtListMaxVisibleRows: number;
  otherListMaxVisibleRows: number;
  hintsMaxVisibleRows: number;
};

// Every terminal-row/column budget the zone's render derives from the live window size — the
// pane grid, the fullscreen preview, the filter-history grid browser, and the two service lists'
// BoundedList windows. One pure function so the whole budget is unit-testable against a given
// terminal size without mounting Ink.
export function computeLogsLayout(input: LogsLayoutInput): LogsLayout {
  const listColumnWidth = Math.floor((input.windowColumns - SPLITTER_COLUMNS) * input.listRatio);
  const gridAvailableWidth = Math.max(input.windowColumns - SPLITTER_COLUMNS - listColumnWidth - spacing['pane-padding-x'], 20);
  const gridAvailableHeight = Math.max(input.windowRows - CHROME_ROWS, 5);
  // More panes than the grid can show at a readable minimum cell are not laid out at all.
  const visiblePaneCount = Math.min(input.activePaneCount, maxVisiblePanes(gridAvailableWidth, gridAvailableHeight));
  const layout = computeGridLayout(visiblePaneCount, gridAvailableWidth, gridAvailableHeight);
  const paneVisibleLines = Math.max(layout.cellHeight - PANE_CHROME_ROWS, 1);
  const paneContentWidth = Math.max(layout.cellWidth - GRID_PANE_CHROME_COLS, 1);
  const fullscreenVisibleLines = Math.max(input.windowRows - CHROME_ROWS, 3);
  const fullscreenContentWidth = Math.max(input.windowColumns - spacing['pane-padding-x'] * 2, 1);
  // The history grid browser's available width, mirroring command-bar.tsx's `availableWidth`
  // computation (this grid renders inside the same ModalDialog chrome).
  const historyGridAvailableWidth = Math.max(input.windowColumns - HISTORY_GRID_CHROME_WIDTH, HISTORY_GRID_MIN_WIDTH);
  // Same idea, vertically — the grid's visible-rows budget, recalculated live off
  // useWindowSize() on every resize.
  const historyGridAvailableHeight = Math.max(input.windowRows - HISTORY_GRID_CHROME_ROWS, HISTORY_GRID_MIN_VISIBLE_ROWS);

  // LogFilterEditor renders as a sibling *below* the "LOGS" + list/grid block, not a true overlay
  // (Ink has no absolute positioning) — while open, its rows compete for the row budget the list
  // column's BoundedLists use. The hints panel hides while the editor is open, but the two service
  // lists don't, so this reserves the editor's own footprint (its fixed rows, plus the history
  // grid's rows when open) off the list column's budget so the two never exceed the terminal.
  // The rule list view is bounded to the same height budget as the history grid; an empty list
  // still renders one placeholder row.
  const rulesListMaxVisibleRows = Math.max(1, historyGridAvailableHeight);
  const filterEditorReservedRows = !input.filterEditorOpen
    ? 0
    : input.filterEditorView === 'list' || input.filterEditorView === 'library'
      ? (input.filterEditorView === 'library' ? LIBRARY_CHROME_ROWS : RULES_LIST_CHROME_ROWS) + Math.min(Math.max(input.filterRuleCount ?? 0, 1), rulesListMaxVisibleRows)
      : HISTORY_GRID_CHROME_ROWS + (!input.historyGridOpen ? 0 : Math.min(input.filterHistoryGridMaxRows, historyGridAvailableHeight));
  // The list column's own total row budget — a row sibling of the pane grid, so it reuses
  // gridAvailableHeight. Handed out top-down (EDT list, then OTHER list, then the hints panel) so
  // a section shorter than its share leaves more room for the ones after it; each BoundedList
  // only consumes what its content needs.
  const actionsMenuReservedRows = Math.max(0, input.actionsMenuRows ?? 0);
  const listsContentBudget = Math.max(gridAvailableHeight - LOGS_LIST_HEADER_ROWS - Math.max(filterEditorReservedRows, actionsMenuReservedRows), 3);
  const edtListMaxVisibleRows = listsContentBudget;
  // An empty list still renders a 1-row placeholder ("No active EDT."/"No services in the active
  // EDT."/"No other managed services."), so it counts as 1 row, not the BoundedList's 0 —
  // otherwise whatever renders after it would be 1 row over budget.
  const edtListConsumedRows = input.edtServiceCount === 0 ? 1 : Math.min(input.edtServiceCount, edtListMaxVisibleRows);
  const otherListMaxVisibleRows = Math.max(1, listsContentBudget - edtListConsumedRows);
  const otherListConsumedRows = input.otherServiceCount === 0 ? 1 : Math.min(input.otherServiceCount, otherListMaxVisibleRows);
  const hintsMaxVisibleRows = Math.max(1, otherListMaxVisibleRows - otherListConsumedRows);

  return {
    layout,
    visiblePaneCount,
    paneVisibleLines,
    paneContentWidth,
    fullscreenVisibleLines,
    fullscreenContentWidth,
    historyGridAvailableWidth,
    historyGridAvailableHeight,
    rulesListMaxVisibleRows,
    edtListMaxVisibleRows,
    otherListMaxVisibleRows,
    hintsMaxVisibleRows,
  };
}

// The scroll position is preserved after a scrollback reload only when visible content already
// anchored the viewport. A pane that started genuinely empty pins to offset 0 instead, showing
// the newest of the just-fetched history rather than overshooting past every line just loaded.
// `newLineCount` (the manager's post-fetch `entry.lines.length`) bounds the result too, in case a
// live line arrived from the tail while the older-lines fetch was in flight.
export function resolvePostLoadScrollOffset(currentOffset: number, beforeCount: number, appended: number, newLineCount: number): number {
  if (beforeCount === 0) {
    return 0;
  }
  return currentOffset + Math.max(appended, newLineCount - beforeCount, 0);
}
