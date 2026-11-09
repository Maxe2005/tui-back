// tui/zones/logs: the LogsZone's pure, non-React logic — pane-focus cycling, grid layout math,
// sub-focus navigation, scroll-offset math, stream-visibility toggles, the two-tier filter and
// filter-history recall. Every keystroke behavior is a pure function, unit-tested directly; the
// generic list navigation and EDT-membership partition are reused from edts-zone.logic.ts.
import type { ServiceBranchDivergence } from '../../../../../core/edt/list.js';
import type { LogLine } from '../../../../../core/ports/docker.js';
import type { ServiceStatusState } from '../../../../../core/service-status/index.js';
import type { RestartMode } from '../../../../../core/service-actions/index.js';
import type { StatusBadgeState } from '../../shared/components/status-badge.js';
import type { Hint } from '../../shared/components/hints.js';
import type { FooterContextId } from '../../keybindings/index.js';
import { stepFocus, type FocusNavDeclaration, type FocusNavDirection } from '../../shared/keys/focus-navigation.js';
import { spacing } from '../../shared/theme/theme.js';
import type { HistoryBrowseState } from '../../shared/input-history/index.js';

// ServiceStatusState → StatusBadgeState — `up` → `●`/success, `down` → `○`/error, `restarting` →
// `⣾`/info (StatusBadge's `in-progress`), `unhealthy` → `◐`/warning, `inconsistent` → `⚠`/warning.
// A service with no Docker runtime is its own dim state, never the down treatment. Glyph+color
// always paired, never color alone; accent is never a health color. Shared by every place a
// health badge renders (list rows, grid panes, fullscreen pane).
export function healthBadgeState(health: ServiceStatusState): StatusBadgeState {
  if (health === 'no-container') {
    return 'no-container';
  }
  if (health === 'restarting') {
    return 'in-progress';
  }
  return health;
}

// The text next to a health badge — the raw state except the container-less service, which
// reads as words rather than a kebab-case code, and a restarting service, which names both
// halves of what is happening (a restart was requested, the container is being re-verified)
// instead of the bare state.
export function formatHealthLabel(health: ServiceStatusState): string {
  if (health === 'no-container') {
    return 'no container';
  }
  if (health === 'restarting') {
    return 'restart requested — re-verifying';
  }
  return health;
}

// True when a row or pane must read as restarting — either the slice's in-flight restart flag
// or docker itself reporting the state. One predicate so list rows and pane headers agree.
// A container-less row never restarts, so it never reads as restarting either.
export function isRestartingDisplay(restarting: boolean, health: ServiceStatusState): boolean {
  if (health === 'no-container') {
    return false;
  }
  return restarting || health === 'restarting';
}

// Splits an already-partitioned selectable list into the rows that stay selectable and the
// container-less rows that move to the info-only third section. Presence unknown (manifest
// still loading or unloadable) stays selectable — only a positively-resolved no-container
// row ever leaves its membership list.
export function splitNoContainerRows(
  services: readonly ServiceBranchDivergence[],
  noContainerByPath: Readonly<Record<string, boolean>>,
): { selectable: ServiceBranchDivergence[]; withoutContainer: ServiceBranchDivergence[] } {
  const selectable: ServiceBranchDivergence[] = [];
  const withoutContainer: ServiceBranchDivergence[] = [];
  for (const service of services) {
    if (noContainerByPath[service.path] === true) {
      withoutContainer.push(service);
    } else {
      selectable.push(service);
    }
  }
  return { selectable, withoutContainer };
}

// Tab cycles EDT list -> other list -> panes. The info-only without-container section is
// never a Tab stop — it has no focus state by design, so this cycle skips it by construction
// and the focus type stays unchanged.
export type LogsPaneFocus = 'edt-list' | 'other-list' | 'panes';

export const LOGS_PANE_FOCUS_NAV: FocusNavDeclaration<LogsPaneFocus> = {
  mode: 'tab',
  stops: ['edt-list', 'other-list', 'panes'],
};

export function cycleLogsPaneFocus(current: LogsPaneFocus, direction: FocusNavDirection = 'next'): LogsPaneFocus {
  return stepFocus(LOGS_PANE_FOCUS_NAV.stops, current, direction);
}

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
  filterEditorView?: 'list' | 'rule';
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
    : input.filterEditorView === 'list'
      ? RULES_LIST_CHROME_ROWS + Math.min(Math.max(input.filterRuleCount ?? 0, 1), rulesListMaxVisibleRows)
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

// Arrows move pane sub-focus while paneFocus === 'panes' — 2D movement over the same row-major
// index order the grid renders panes in (index = row * cols + col). Clamped at every edge (never
// wraps): moving left from column 0, or past the last real pane on a short trailing grid row, is
// a no-op in that direction.
export type PaneMoveDirection = 'up' | 'down' | 'left' | 'right';

export function movePaneSubFocus(current: number, direction: PaneMoveDirection, cols: number, paneCount: number): number {
  if (paneCount === 0) {
    return 0;
  }
  const safeCols = Math.max(cols, 1);
  const row = Math.floor(current / safeCols);
  const col = current % safeCols;
  let nextRow = row;
  let nextCol = col;
  if (direction === 'left') {
    nextCol -= 1;
  } else if (direction === 'right') {
    nextCol += 1;
  } else if (direction === 'up') {
    nextRow -= 1;
  } else {
    nextRow += 1;
  }
  const clampedCol = Math.min(Math.max(nextCol, 0), safeCols - 1);
  const clampedRow = Math.max(nextRow, 0);
  const next = clampedRow * safeCols + clampedCol;
  return Math.min(Math.max(next, 0), paneCount - 1);
}

// When the selection changes, sub-focus moves to the nearest remaining pane — clamping the old
// index into the new (smaller) pane count lands on the same index when it still exists, or the
// new last pane otherwise.
export function reindexPaneSubFocus(currentIndex: number, newPaneCount: number): number {
  if (newPaneCount === 0) {
    return 0;
  }
  return Math.min(Math.max(currentIndex, 0), newPaneCount - 1);
}

// The scroll-offset math, scroll-key resolution, per-pane wrap flags and the row-cost-aware window
// live in the shared scrollable-output primitive (tui/shared/scrollable-output) so the Terminal
// view reuses them — re-exported under the Logs-facing names so callers read as before. A Logs
// pane's offset counts lines back from the live tail; an empty pane (the live tail starts empty,
// DockerPort's `--since now`) counts as "at the oldest line" so Ctrl+Up can trigger a quiet
// service's first history fetch.
export {
  adjustScrollOffset,
  computeLineRowCount,
  isAtOldestLine,
  resolveFullscreenScrollDirection,
  resolvePaneScrollDirection,
  sliceVisibleWindow,
  DEFAULT_WRAP as DEFAULT_PANE_WRAP,
  isWrapped as isPaneWrapped,
  toggleWrapFlag as togglePaneWrapFlag,
  toggleAllWrapFlags as toggleAllPanesWrapFlag,
} from '../../shared/scrollable-output/index.js';

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

// Ctrl+A toggles select-all/deselect-all for the EDT list. A `Ctrl+letter` combo arrives as a
// single control byte (0x01-0x1A) with no shift information — Ink's parse-keypress.js sets
// `key.ctrl` but never `key.shift` on that branch — so Ctrl+Shift+A is indistinguishable from
// Ctrl+A unless the Kitty keyboard protocol is negotiated, which this app doesn't opt into
// (bin/tui.ts's `render()`). One reliable shortcut flips to deselect-all once all are selected.
type SelectAllKey = { ctrl?: boolean };

export function isSelectAllKey(input: string, key: SelectAllKey): boolean {
  return key.ctrl === true && input.toLowerCase() === 'a';
}

export type SelectAllAction = 'select-all' | 'deselect-all';

// `allPaths` is whichever list is currently visible (e.g. the EDT-members list, filtered by
// the active EDT) — flips to deselect-all only once every one of those paths is already in
// `selected`; an empty `allPaths` (nothing to select) resolves to select-all too, but that's
// harmless since selecting an empty list is itself a no-op.
export function resolveSelectAllToggle(allPaths: readonly string[], selected: readonly string[]): SelectAllAction {
  const isAllSelected = allPaths.length > 0 && allPaths.every((path) => selected.includes(path));
  return isAllSelected ? 'deselect-all' : 'select-all';
}

// Ctrl+C and Shift+W apply clear/wrap to every active pane at once, while the bare `c`/`w` stay
// scoped to the sub-focused (or fullscreen) pane. Ctrl+W belongs to the global resize-mode.
type LogsCtrlKey = { ctrl?: boolean };

export function isClearAllLogsKey(input: string, key: LogsCtrlKey): boolean {
  return key.ctrl === true && input.toLowerCase() === 'c';
}

export function isWrapAllLogsKey(input: string, key: LogsCtrlKey): boolean {
  return key.ctrl !== true && input === 'W';
}

// Toggles timestamp/stdout/stderr visibility independently (t/o/p) without reconnecting the
// stream — a pure display filter over the already-buffered lines. stderr is `p`, not `e`: `e` is
// the EDTs zone's tab mnemonic, and every mounted useInput hook receives the same keypress, so it
// would also switch zones (see logsPaneGridArrowsActive in navigation-slice.ts). Wrap is per pane
// (togglePaneWrapFlag/toggleAllPanesWrapFlag below), not a flag here.
export type VisibilityToggle = 'timestamp' | 'stdout' | 'stderr';

export function resolveVisibilityToggleKey(input: string): VisibilityToggle | null {
  if (input === 't') {
    return 'timestamp';
  }
  if (input === 'o') {
    return 'stdout';
  }
  if (input === 'p') {
    return 'stderr';
  }
  return null;
}

export type VisibilityFlags = { showTimestamps: boolean; showStdout: boolean; showStderr: boolean };

export function toggleVisibilityFlag(flags: VisibilityFlags, toggle: VisibilityToggle): VisibilityFlags {
  if (toggle === 'timestamp') {
    return { ...flags, showTimestamps: !flags.showTimestamps };
  }
  if (toggle === 'stdout') {
    return { ...flags, showStdout: !flags.showStdout };
  }
  return { ...flags, showStderr: !flags.showStderr };
}

export const DEFAULT_VISIBILITY_FLAGS: VisibilityFlags = { showTimestamps: true, showStdout: true, showStderr: true };

// Whether a fullscreen pane's footer advertises `R`: a pane known to be container-less does
// not. Display only — whether `R` actually runs is the service-action registry's decision.
export function isPaneRestartAdvertised(pane: { health?: string; noContainer?: boolean } | undefined): boolean {
  return pane === undefined || (pane.health !== 'no-container' && pane.noContainer !== true);
}

// The footer context while an overlay owns the keyboard: the actions menu and the filter editor
// (its history grid is its own sub-mode) sit above the fullscreen pane they may have been
// opened from. A service without a container has no restart, so its fullscreen pane never
// advertises one.
export function logsFooterContext(
  filterEditorOpen: boolean,
  historyGridOpen: boolean,
  fullscreen: { open: boolean; restartable: boolean },
  restartMode: RestartMode = 'simple',
  actionsMenuOpen = false,
  rules: { listOpen: boolean; confirmingClear: boolean } = { listOpen: false, confirmingClear: false },
): FooterContextId | null {
  if (actionsMenuOpen) {
    return 'logs-actions-menu';
  }
  if (filterEditorOpen && rules.listOpen) {
    return rules.confirmingClear ? 'logs-filter-rules-confirm' : 'logs-filter-rules';
  }
  if (filterEditorOpen) {
    return historyGridOpen ? 'logs-filter-history' : 'logs-filter-edit';
  }
  if (!fullscreen.open) {
    return null;
  }
  if (!fullscreen.restartable) {
    return 'logs-fullscreen-no-container';
  }
  return restartMode === 'clean' ? 'logs-fullscreen-clean' : 'logs-fullscreen';
}

// The restart control's hint verb, naming the active mode so the developer sees what `R` will run.
export function restartHintVerb(mode: RestartMode): string {
  return mode === 'clean' ? 'restart (clean)' : 'restart';
}

// The key legend under the service list; the stream toggles show their live state.
export function logsLegendHints(visibility: VisibilityFlags): Hint[] {
  const state = (on: boolean) => (on ? 'on' : 'off');
  return [
    ['Space', 'toggle'],
    ['Enter', 'preview'],
    ['Ctrl+A', 'toggle all'],
    ['t', `timestamps ${state(visibility.showTimestamps)}`],
    ['o', `stdout ${state(visibility.showStdout)}`],
    ['p', `stderr ${state(visibility.showStderr)}`],
    ['Ctrl+↑/↓', 'scroll pane'],
    ['c', 'clear focused pane'],
    ['Ctrl+C', 'clear all panes'],
    ['w', 'wrap/truncate this pane'],
    ['W', 'wrap/truncate all'],
    ['R', 'restart focused pane'],
    ['a', 'actions (focused pane)'],
    ['/', 'edit global filter'],
    ['f', "edit this pane's filter"],
    ['i', 'toggle global filter (pane)'],
    ['Esc', 'clear filter (cascade)'],
  ];
}

export function filterVisibleLines(lines: readonly LogLine[], flags: VisibilityFlags): LogLine[] {
  return lines.filter((line) => (line.stream === 'stdout' ? flags.showStdout : flags.showStderr));
}

// The two-tier text/regex/level filter over already-buffered lines — a pure, render-time
// transform layered on top of filterVisibleLines above (never touches the subscription).
export type LogFilterMode = 'text' | 'regex';
export type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

// `action` keeps (`show`) or drops (`hide`) what the query matches; `target` says whether the
// unit is the whole line or only the matched text inside it. show+line is the classic filter.
export type LogFilterAction = 'show' | 'hide';
export type LogFilterTarget = 'line' | 'match';

// One rule of a scope's pipeline: `enabled` rules run top to bottom, each one filtering or
// rewriting the output of the previous one; a disabled rule is skipped as if absent.
export type LogFilterRule = {
  mode: LogFilterMode;
  query: string;
  action: LogFilterAction;
  target: LogFilterTarget;
  enabled: boolean;
};

// A scope (the global one, or one service's pane) holds an ordered rule list plus one level
// restriction that is ANDed with the pipeline and judged on the original, unrewritten text.
export type LogFilterScope = {
  level: LogLevel | null;
  rules: readonly LogFilterRule[];
};

export const DEFAULT_LOG_FILTER: LogFilterScope = { level: null, rules: [] };

export const MAX_LOG_FILTER_RULES = 10;

// Shared by every editor change and every pane's "pane filter: on" annotation — a scope with no
// rule and no level restriction is a no-op filter and must never be stored as an explicit
// paneFilters[repoPath] entry (the annotation/hasOwnFilter check keys off entry presence).
export function isDefaultLogFilterScope(scope: LogFilterScope): boolean {
  return scope.level === null && scope.rules.length === 0;
}

// Level filtering has no source field (LogLine has no level), so it uses a text heuristic
// (ERROR|WARN|INFO|DEBUG, case-insensitive) against line.text. Only the *first* matching token
// counts — real log lines never carry more than one level tag, and picking the first keeps this
// a total, order-independent function of the raw text.
const LOG_LEVEL_PATTERN = /\b(ERROR|WARN|INFO|DEBUG)\b/i;

export function detectLogLevel(text: string): LogLevel | null {
  const match = LOG_LEVEL_PATTERN.exec(text);
  return match === null ? null : (match[1].toUpperCase() as LogLevel);
}

// An invalid regex shows an inline error in the editor and is never applied, never thrown into
// the render tree — `compileLogFilter` is the one place a malformed pattern may throw (RegExp's
// constructor), caught here and turned into a typed failure the editor surfaces as text.
// `apply` returns the line as it should be displayed (a new object when the text was rewritten,
// the stored line untouched otherwise) or `null` when the line must not be displayed.
export type CompiledLogFilter =
  | { ok: true; apply: (line: LogLine) => LogLine | null }
  | { ok: false; error: string };

// Every non-empty match of `query` in `text`, as [start, end) ranges. Empty matches (e.g. `a*`)
// are skipped, and the scan always advances, so a pattern that can match nothing cannot loop.
function findMatchRanges(text: string, matcher: RegExp): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  matcher.lastIndex = 0;
  for (;;) {
    const match = matcher.exec(text);
    if (match === null) {
      return ranges;
    }
    if (match[0].length === 0) {
      matcher.lastIndex += 1;
      if (matcher.lastIndex > text.length) {
        return ranges;
      }
      continue;
    }
    ranges.push([match.index, match.index + match[0].length]);
  }
}

function removeRanges(text: string, ranges: Array<[number, number]>): string {
  let result = '';
  let cursor = 0;
  for (const [start, end] of ranges) {
    result += text.slice(cursor, start);
    cursor = end;
  }
  return result + text.slice(cursor);
}

export function compileLogFilter(spec: Pick<LogFilterRule, 'mode' | 'query' | 'action' | 'target'>): CompiledLogFilter {
  let matcher: RegExp | null = null;
  if (spec.query !== '') {
    if (spec.mode === 'regex') {
      try {
        matcher = new RegExp(spec.query, 'gi');
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Invalid regular expression' };
      }
    } else {
      // Matching on the original text (never a lowercased copy) keeps ranges aligned for
      // characters whose lowercase form has a different length.
      matcher = new RegExp(spec.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    }
  }
  const { action, target } = spec;
  return {
    ok: true,
    apply: (line) => {
      if (matcher === null) {
        return line;
      }
      const ranges = findMatchRanges(line.text, matcher);
      if (target === 'line') {
        return (ranges.length > 0) === (action === 'show') ? line : null;
      }
      if (ranges.length === 0) {
        return action === 'show' ? null : line;
      }
      const text =
        action === 'hide'
          ? removeRanges(line.text, ranges)
          : ranges.map(([start, end]) => line.text.slice(start, end)).join(' ');
      return text.trim() === '' ? null : { ...line, text };
    },
  };
}

// The inline error for a rule draft that does not compile, or null. Whether the query is
// non-empty is checked separately, on commit.
export function validateRuleDraft(draft: Pick<LogFilterRule, 'mode' | 'query' | 'action' | 'target'>): string | null {
  const compiled = compileLogFilter(draft);
  return compiled.ok ? null : compiled.error;
}

// The rule pipeline over already-visible lines. Each scope's level restriction is judged on the
// original text; then the global scope's enabled rules run (when given), then the pane's own, each
// rule seeing the previous rule's output. A rule that fails to compile is treated as pass-through
// rather than thrown or silently hiding every line — defensive only, since the editor never
// commits an uncompilable rule.
export function applyLogRules(lines: readonly LogLine[], global: LogFilterScope | null, own: LogFilterScope | null): LogLine[] {
  const levels = [global?.level ?? null, own?.level ?? null].filter((level): level is LogLevel => level !== null);
  const pipeline = [...(global?.rules ?? []), ...(own?.rules ?? [])]
    .filter((rule) => rule.enabled)
    .map((rule) => compileLogFilter(rule));
  const result: LogLine[] = [];
  for (const original of lines) {
    if (levels.length > 0) {
      const detected = detectLogLevel(original.text);
      if (levels.some((level) => level !== detected)) {
        continue;
      }
    }
    let line: LogLine | null = original;
    for (const compiled of pipeline) {
      if (line === null) {
        break;
      }
      if (compiled.ok) {
        line = compiled.apply(line);
      }
    }
    if (line !== null) {
      result.push(line);
    }
  }
  return result;
}

// Shared by LogsPaneView and FullscreenPane (both call applyLogRules right after
// filterVisibleLines, the layer the stdout/stderr toggle lives on). A pane's effective pipeline is
// (engaged ? global : nothing) followed by (own ?? nothing).
export function resolveEffectiveLines(
  pane: { lines: readonly LogLine[] } | undefined,
  visibility: VisibilityFlags,
  globalFilter: LogFilterScope,
  engaged: boolean,
  ownFilter: LogFilterScope | null,
): LogLine[] {
  if (!pane) {
    return [];
  }
  return applyLogRules(filterVisibleLines(pane.lines, visibility), engaged ? globalFilter : null, ownFilter);
}

// Per-pane engagement with the global filter, keyed by repoPath — mirrors isPaneWrapped/
// togglePaneWrapFlag's shape, but defaults to `true` (every pane is engaged by default).
export const DEFAULT_PANE_GLOBAL_FILTER_ENGAGED = true;

export function isPaneEngagedInGlobalFilter(engagedByPath: Readonly<Record<string, boolean>>, repoPath: string | null): boolean {
  if (repoPath === null) {
    return DEFAULT_PANE_GLOBAL_FILTER_ENGAGED;
  }
  return engagedByPath[repoPath] ?? DEFAULT_PANE_GLOBAL_FILTER_ENGAGED;
}

// The `i` key's toggle (an explicit flip, either direction).
export function toggleGlobalFilterEngagement(engagedByPath: Readonly<Record<string, boolean>>, repoPath: string): Record<string, boolean> {
  return { ...engagedByPath, [repoPath]: !isPaneEngagedInGlobalFilter(engagedByPath, repoPath) };
}

// Escape's own disengage step (resolveFilterClearTarget's 'pane-disengage' target) is a
// one-way "set to disengaged", never a toggle — pressing Escape again on an already-disengaged
// pane must stay a no-op, not re-engage it.
export function setPaneGlobalFilterEngagement(
  engagedByPath: Readonly<Record<string, boolean>>,
  repoPath: string,
  engaged: boolean,
): Record<string, boolean> {
  return { ...engagedByPath, [repoPath]: engaged };
}

export function setPaneLogFilter(
  paneFilters: Readonly<Record<string, LogFilterScope>>,
  repoPath: string,
  scope: LogFilterScope | null,
): Record<string, LogFilterScope> {
  if (scope === null || isDefaultLogFilterScope(scope)) {
    const next = { ...paneFilters };
    delete next[repoPath];
    return next;
  }
  return { ...paneFilters, [repoPath]: scope };
}

// Pure rule-list operations. Each returns the new scope (the input is never mutated); the ones
// that can be refused or are out of range return it unchanged / null as documented.
export function addLogRule(scope: LogFilterScope, rule: LogFilterRule): LogFilterScope | null {
  return scope.rules.length >= MAX_LOG_FILTER_RULES ? null : { ...scope, rules: [...scope.rules, rule] };
}

export function replaceLogRule(scope: LogFilterScope, index: number, rule: LogFilterRule): LogFilterScope {
  return index < 0 || index >= scope.rules.length ? scope : { ...scope, rules: scope.rules.map((current, i) => (i === index ? rule : current)) };
}

export function toggleLogRule(scope: LogFilterScope, index: number): LogFilterScope {
  const rule = scope.rules[index];
  return rule === undefined ? scope : replaceLogRule(scope, index, { ...rule, enabled: !rule.enabled });
}

export function deleteLogRule(scope: LogFilterScope, index: number): LogFilterScope {
  return index < 0 || index >= scope.rules.length ? scope : { ...scope, rules: scope.rules.filter((_, i) => i !== index) };
}

// Swaps a rule with its neighbour; at either end it is a no-op.
export function moveLogRule(scope: LogFilterScope, index: number, direction: 'up' | 'down'): LogFilterScope {
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || index >= scope.rules.length || target < 0 || target >= scope.rules.length) {
    return scope;
  }
  const rules = [...scope.rules];
  [rules[index], rules[target]] = [rules[target], rules[index]];
  return { ...scope, rules };
}

// The draft the rule editor opens on: an existing rule, or a fresh show+line text rule.
export function ruleDraftOf(rule: LogFilterRule | null): Pick<LogFilterRule, 'mode' | 'query' | 'action' | 'target'> {
  return rule === null
    ? { mode: 'text', query: '', action: 'show', target: 'line' }
    : { mode: rule.mode, query: rule.query, action: rule.action, target: rule.target };
}

// The rule list's Ctrl+Left/Right keys cycle a scope's level restriction through "no
// restriction" and each of the four detectable levels.
export const LOG_FILTER_LEVEL_CYCLE: readonly (LogLevel | null)[] = [null, 'ERROR', 'WARN', 'INFO', 'DEBUG'];

export function cycleFilterLevel(current: LogLevel | null, direction: 'next' | 'previous'): LogLevel | null {
  const idx = LOG_FILTER_LEVEL_CYCLE.indexOf(current);
  const safeIdx = idx === -1 ? 0 : idx;
  const delta = direction === 'next' ? 1 : -1;
  const nextIdx = (safeIdx + delta + LOG_FILTER_LEVEL_CYCLE.length) % LOG_FILTER_LEVEL_CYCLE.length;
  return LOG_FILTER_LEVEL_CYCLE[nextIdx];
}

export function toggleFilterMode(mode: LogFilterMode): LogFilterMode {
  return mode === 'text' ? 'regex' : 'text';
}

function isDefaultActionTarget(action: LogFilterAction, target: LogFilterTarget): boolean {
  return action === 'show' && target === 'line';
}

export function toggleFilterAction(action: LogFilterAction): LogFilterAction {
  return action === 'show' ? 'hide' : 'show';
}

export function toggleFilterTarget(target: LogFilterTarget): LogFilterTarget {
  return target === 'line' ? 'match' : 'line';
}

// The compact action/target indicator shown beside the query, e.g. `show line`, `hide match`.
export function formatFilterActionTarget(action: LogFilterAction, target: LogFilterTarget): string {
  return `${action} ${target}`;
}

// One rule as a list row, e.g. `[x] hide match text "Aucun service"` (`[ ]` when disabled).
export function formatLogRule(rule: LogFilterRule): string {
  // Whitespace and control characters (newlines included) collapse so a row stays on one line.
  const query = rule.query.replace(/[\s\u0000-\u001f\u007f]+/g, ' ');
  return `${rule.enabled ? '[x]' : '[ ]'} ${formatFilterActionTarget(rule.action, rule.target)} ${rule.mode} "${query}"`;
}

// A short human-readable rendering of a scope, e.g. `3 rules (1 off) [ERROR]` — used on the
// pane/fullscreen annotations so a user can tell *what* is filtering a pane without reopening its
// editor.
export function formatLogFilterScope(scope: LogFilterScope): string {
  const levelPart = scope.level !== null ? ` [${scope.level}]` : '';
  const total = scope.rules.length;
  if (total === 0) {
    return `(any)${levelPart}`;
  }
  const off = scope.rules.filter((rule) => !rule.enabled).length;
  const rulesPart = `${total} ${total === 1 ? 'rule' : 'rules'}${off > 0 ? ` (${off} off)` : ''}`;
  return `${rulesPart}${levelPart}`;
}

// Escape, when no editor is open: on a sub-focused grid pane (not fullscreen), clears that pane's
// own filter if set, else disengages it from the global filter; with no pane sub-focused
// (list-focus), clears the global filter entirely. A pure resolver — logs-zone.tsx's useInput
// dispatches the returned target.
export type FilterClearTarget =
  | { scope: 'pane-own'; repoPath: string }
  | { scope: 'pane-disengage'; repoPath: string }
  | { scope: 'global' };

export function resolveFilterClearTarget(paneSubFocused: boolean, repoPath: string | null, hasOwnFilter: boolean): FilterClearTarget {
  if (paneSubFocused && repoPath !== null) {
    return hasOwnFilter ? { scope: 'pane-own', repoPath } : { scope: 'pane-disengage', repoPath };
  }
  return { scope: 'global' };
}

export function formatLogLine(line: LogLine, showTimestamps: boolean): string {
  return showTimestamps ? `[${line.timestamp}] ${line.text}` : line.text;
}

// Any manifest service can be streamed, not only active-EDT members — a service row identity,
// kept minimal (only what a pane/subscription needs) rather than reusing ServiceBranchDivergence.
export type LogsServiceRow = Pick<ServiceBranchDivergence, 'service' | 'path'>;

// Filter history recall. Each exact (scope, mode) combination — global-text, global-regex, and
// per-service-text/per-service-regex for every manifest service path — owns its own independent,
// persisted list of committed query strings. `repoPath` is only meaningful for `scope: 'pane'`.
export type FilterHistoryKey = { scope: 'global' | 'pane'; repoPath: string | null; mode: LogFilterMode };

// The flat string key StatePort.readFilterHistory/writeFilterHistory persists each list under
// (mirrors splitterRatios' own "keyed by a plain string, the driving layer resolves the
// encoding" convention — core/ports/state.ts has no notion of "scope"/"mode"/repoPath). Global
// scope ignores repoPath entirely; pane scope always carries one (openPaneFilterEditor in
// logs-zone.tsx never opens a pane editor without one).
export function filterHistoryKeyString(key: FilterHistoryKey): string {
  return key.scope === 'global' ? `global:${key.mode}` : `service:${key.repoPath}:${key.mode}`;
}

// History entries stay plain strings so older state files load unchanged and the shared
// input-history primitive keeps working as is. A show+line entry is the bare query (exactly what
// earlier versions wrote); any other action/target is the query behind a control-character
// header, so equality of two entries means equality of query, action and target.
const HISTORY_HEADER = '\u001f';
const HISTORY_HEADER_PATTERN = /^\u001f(show|hide):(line|match)\u001f/;

export type FilterHistoryEntry = { query: string; action: LogFilterAction; target: LogFilterTarget };

export function encodeFilterHistoryEntry(entry: FilterHistoryEntry): string {
  return isDefaultActionTarget(entry.action, entry.target) && !HISTORY_HEADER_PATTERN.test(entry.query)
    ? entry.query
    : `${HISTORY_HEADER}${entry.action}:${entry.target}${HISTORY_HEADER}${entry.query}`;
}

export function decodeFilterHistoryEntry(encoded: string): FilterHistoryEntry {
  const header = HISTORY_HEADER_PATTERN.exec(encoded);
  if (header === null) {
    return { query: encoded, action: 'show', target: 'line' };
  }
  return { query: encoded.slice(header[0].length), action: header[1] as LogFilterAction, target: header[2] as LogFilterTarget };
}

// Push/dedup/trim and the arrow-browse state machine are the shared input-history primitive
// (tui/shared/input-history) — re-exported under the Logs-facing names so callers read as before.
export { pushHistoryEntry as pushFilterHistoryEntry } from '../../shared/input-history/index.js';
export {
  resolveHistoryBrowseDown,
  resolveHistoryBrowseUp,
  type HistoryBrowseResult as FilterHistoryBrowseResult,
  type HistoryBrowseState as FilterHistoryBrowseState,
} from '../../shared/input-history/index.js';

// The filter editor — `/` opens one with scope 'global', `f` with scope 'pane' (repoPath set to
// the owning pane). It has two views: the scope's rule `list` (every change there is applied to
// the scope immediately) and the `rule` editor, whose draft only enters the list on Enter.
// `error` mirrors compileLogFilter's last result for the draft (recomputed on every keystroke).
export type FilterEditorState = {
  scope: 'global' | 'pane';
  repoPath: string | null;
  view: 'list' | 'rule';
  // The highlighted row of the rule list.
  listCursor: number;
  // The rule the draft replaces on commit; null while adding a new one.
  ruleIndex: number | null;
  mode: LogFilterMode;
  query: string;
  // The caret position within `query`, threaded to TextInputLine like edts-zone.logic.ts's
  // `nextTextInputValue`/`TextInputState`. Every programmatic overwrite of `query` (open, history
  // recall, arrow-browse) resets this to `query.length`.
  cursor: number;
  action: LogFilterAction;
  target: LogFilterTarget;
  error: string | null;
  // A refusal shown in the list view (rule cap reached); cleared by the next key.
  notice: string | null;
  // True while the list view waits for the "clear all rules" confirmation.
  confirmClear: boolean;
  // Non-null while `↑`/`↓` are browsing this scope+mode's history — null on a fresh open and
  // whenever browsing has ended (snapped back to the draft, or walked past the most-recent entry).
  // See resolveHistoryBrowseUp/Down in tui/shared/input-history.
  browsing: HistoryBrowseState | null;
};

export function openFilterEditorState(scope: 'global' | 'pane', repoPath: string | null): FilterEditorState {
  return {
    scope,
    repoPath,
    view: 'list',
    listCursor: 0,
    ruleIndex: null,
    ...ruleDraftOf(null),
    cursor: 0,
    error: null,
    notice: null,
    confirmClear: false,
    browsing: null,
  };
}

// Moves the editor to the rule view on `rule` (null = a new rule at the end of the list).
export function openRuleEditorState(editor: FilterEditorState, index: number | null, rule: LogFilterRule | null): FilterEditorState {
  const draft = ruleDraftOf(rule);
  return { ...editor, ...draft, view: 'rule', ruleIndex: index, cursor: draft.query.length, error: null, notice: null, confirmClear: false, browsing: null };
}

// The filter-history grid's `getLabel` for command-bar.tsx's generic grid primitives — the bare
// query for a show+line entry, prefixed with its action/target otherwise. Shared by LogsZone's
// useInput and LogFilterEditor's render.
export function historyEntryLabel(entry: string): string {
  const decoded = decodeFilterHistoryEntry(entry);
  return isDefaultActionTarget(decoded.action, decoded.target)
    ? decoded.query
    : `[${formatFilterActionTarget(decoded.action, decoded.target)}] ${decoded.query}`;
}
