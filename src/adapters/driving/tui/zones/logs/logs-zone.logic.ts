// tui/zones/logs: the LogsZone's pure, non-React logic — pane-focus cycling, grid layout math,
// sub-focus navigation, scroll-offset math, stream-visibility toggles, the two-tier filter and
// filter-history recall. Every keystroke behavior is a pure function, unit-tested directly; the
// generic list navigation and EDT-membership partition are reused from edts-zone.logic.ts.
import wrapAnsi from 'wrap-ansi';
import type { ServiceBranchDivergence } from '../../../../../core/edt/list.js';
import type { HealthState, LogLine } from '../../../../../core/ports/docker.js';
import type { StatusBadgeState } from '../../shared/components/status-badge.js';
import type { Hint } from '../../shared/components/hints.js';
import type { FooterContextId } from '../../keybindings/index.js';
import { stepFocus, type FocusNavDeclaration, type FocusNavDirection } from '../../shared/keys/focus-navigation.js';
import { spacing } from '../../shared/theme/theme.js';
import type { HistoryBrowseState } from '../../shared/input-history/index.js';

// HealthState → StatusBadgeState — `up` → `●`/success, `down` → `○`/error, `restarting` →
// `⣾`/info (StatusBadge's `in-progress`). A service with no Docker runtime is its own dim
// state, never the down treatment. Glyph+color always paired, never color alone; accent is
// never a health color. Shared by every place a health badge renders (list rows, grid panes,
// fullscreen pane).
export function healthBadgeState(health: HealthState | 'no-container'): StatusBadgeState {
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
export function formatHealthLabel(health: HealthState | 'no-container'): string {
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
export function isRestartingDisplay(restarting: boolean, health: HealthState | 'no-container'): boolean {
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
  const filterEditorReservedRows = !input.filterEditorOpen
    ? 0
    : HISTORY_GRID_CHROME_ROWS + (!input.historyGridOpen ? 0 : Math.min(input.filterHistoryGridMaxRows, historyGridAvailableHeight));
  // The list column's own total row budget — a row sibling of the pane grid, so it reuses
  // gridAvailableHeight. Handed out top-down (EDT list, then OTHER list, then the hints panel) so
  // a section shorter than its share leaves more room for the ones after it; each BoundedList
  // only consumes what its content needs.
  const listsContentBudget = Math.max(gridAvailableHeight - LOGS_LIST_HEADER_ROWS - filterEditorReservedRows, 3);
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

// Ctrl+Up/Ctrl+Down scroll the sub-focused pane. `offset` counts lines back from the live tail
// (0 == pinned to the tail); scrolling up increases it, capped at `lineCount - 1` (the oldest
// buffered line) — never negative, never past the top.
export function adjustScrollOffset(current: number, direction: 'up' | 'down', lineCount: number): number {
  if (lineCount === 0) {
    return 0;
  }
  const next = direction === 'up' ? current + 1 : current - 1;
  return Math.min(Math.max(next, 0), lineCount - 1);
}

// The trigger for fetching more history: true once the offset can't go further up without more
// lines to scroll into. A genuinely empty pane (lineCount === 0) counts as "at the oldest line"
// too — it is the pane's *normal* starting state (the live tail starts empty, DockerPort's
// `--since now`), so otherwise Ctrl+Up could never trigger a quiet service's first fetch.
export function isAtOldestLine(offset: number, lineCount: number): boolean {
  return lineCount === 0 || offset >= lineCount - 1;
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

type PaneScrollKey = { ctrl?: boolean; upArrow?: boolean; downArrow?: boolean };

// Requires ctrl in the grid view — Up/Down there is already claimed by movePaneSubFocus (2D
// movement between panes), so a bare arrow has to keep meaning "change focused pane" and
// Ctrl+Up/Down disambiguates "scroll the focused pane instead".
export function resolvePaneScrollDirection(key: PaneScrollKey): 'up' | 'down' | null {
  if (!key.ctrl) {
    return null;
  }
  if (key.upArrow) {
    return 'up';
  }
  if (key.downArrow) {
    return 'down';
  }
  return null;
}

// Fullscreen has no sub-focus grid to disambiguate from (only one pane), so plain Up/Down scroll
// it; ctrl is accepted too so Ctrl+Up/Down muscle memory still works.
export function resolveFullscreenScrollDirection(key: { ctrl?: boolean; upArrow?: boolean; downArrow?: boolean }): 'up' | 'down' | null {
  if (key.upArrow) {
    return 'up';
  }
  if (key.downArrow) {
    return 'down';
  }
  return null;
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

// The footer context while an overlay owns the keyboard: the filter editor (its history grid is
// its own sub-mode) sits above the fullscreen pane it may have been opened from.
// A service without a container has no restart, so its fullscreen pane never advertises one.
export function logsFooterContext(
  filterEditorOpen: boolean,
  historyGridOpen: boolean,
  fullscreen: { open: boolean; restartable: boolean },
): FooterContextId | null {
  if (filterEditorOpen) {
    return historyGridOpen ? 'logs-filter-history' : 'logs-filter-edit';
  }
  if (!fullscreen.open) {
    return null;
  }
  return fullscreen.restartable ? 'logs-fullscreen' : 'logs-fullscreen-no-container';
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
    ['/', 'edit global filter'],
    ['f', "edit this pane's filter"],
    ['i', 'toggle global filter (pane)'],
    ['Esc', 'clear filter (cascade)'],
  ];
}

// Per-pane wrap/truncate state, keyed by repoPath — a pane absent from the map defaults to
// truncate, matching the grid view's deliberate `truncate-end`.
export const DEFAULT_PANE_WRAP = false;

export function isPaneWrapped(wrapByPath: Readonly<Record<string, boolean>>, repoPath: string | null): boolean {
  if (repoPath === null) {
    return DEFAULT_PANE_WRAP;
  }
  return wrapByPath[repoPath] ?? DEFAULT_PANE_WRAP;
}

export function togglePaneWrapFlag(wrapByPath: Readonly<Record<string, boolean>>, repoPath: string): Record<string, boolean> {
  return { ...wrapByPath, [repoPath]: !isPaneWrapped(wrapByPath, repoPath) };
}

export function toggleAllPanesWrapFlag(wrapByPath: Readonly<Record<string, boolean>>, repoPaths: readonly string[]): Record<string, boolean> {
  return repoPaths.reduce((next, repoPath) => togglePaneWrapFlag(next, repoPath), wrapByPath as Record<string, boolean>);
}

export function filterVisibleLines(lines: readonly LogLine[], flags: VisibilityFlags): LogLine[] {
  return lines.filter((line) => (line.stream === 'stdout' ? flags.showStdout : flags.showStderr));
}

// The two-tier text/regex/level filter over already-buffered lines — a pure, render-time
// transform layered on top of filterVisibleLines above (never touches the subscription).
// compileLogFilter runs on every editor keystroke, so the inline regex error appears/clears live.
export type LogFilterMode = 'text' | 'regex';
export type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

export type LogFilterSpec = {
  mode: LogFilterMode;
  query: string;
  level: LogLevel | null;
};

export const DEFAULT_LOG_FILTER: LogFilterSpec = { mode: 'text', query: '', level: null };

// Shared by the filter-editor commit/cancel paths and every pane's "pane filter: on" annotation —
// a spec deep-equal to DEFAULT_LOG_FILTER (empty query, no level restriction, either mode) is a
// no-op filter and must never be stored as an explicit paneFilters[repoPath] entry (the
// annotation/hasOwnFilter check would see a filter that isn't filtering anything).
export function isDefaultLogFilterSpec(spec: LogFilterSpec): boolean {
  return spec.mode === DEFAULT_LOG_FILTER.mode && spec.query === DEFAULT_LOG_FILTER.query && spec.level === DEFAULT_LOG_FILTER.level;
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
export type CompiledLogFilter = { ok: true; test: (line: LogLine) => boolean } | { ok: false; error: string };

export function compileLogFilter(spec: LogFilterSpec): CompiledLogFilter {
  let textTest: (text: string) => boolean;
  if (spec.mode === 'regex') {
    if (spec.query === '') {
      textTest = () => true;
    } else {
      let regex: RegExp;
      try {
        regex = new RegExp(spec.query, 'i');
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Invalid regular expression' };
      }
      textTest = (text) => regex.test(text);
    }
  } else {
    const needle = spec.query.toLowerCase();
    textTest = needle === '' ? () => true : (text) => text.toLowerCase().includes(needle);
  }
  const { level } = spec;
  return {
    ok: true,
    test: (line) => textTest(line.text) && (level === null || detectLogLevel(line.text) === level),
  };
}

// The filter editor's commit decision, shared by every draft-mutating keystroke (Tab, Ctrl+←/→,
// ↑/↓ history browse, Backspace/Delete, typed characters, and the grid recall). The draft always
// advances (typed characters/level cycles are never lost); at most one of
// `globalFilter`/`paneFilterUpdate` is non-null, telling the caller which committed state to
// update — and neither is when the draft fails to compile, so the previously-active filter stays.
export type FilterEditorDraftResult = {
  editor: FilterEditorState;
  globalFilter: LogFilterSpec | null;
  paneFilterUpdate: { repoPath: string; spec: LogFilterSpec | null } | null;
};

export function resolveFilterEditorDraft(next: FilterEditorState): FilterEditorDraftResult {
  const spec: LogFilterSpec = { mode: next.mode, query: next.query, level: next.level };
  const compiled = compileLogFilter(spec);
  if (!compiled.ok) {
    return { editor: { ...next, error: compiled.error }, globalFilter: null, paneFilterUpdate: null };
  }
  if (next.scope === 'global') {
    return { editor: { ...next, error: null }, globalFilter: spec, paneFilterUpdate: null };
  }
  const repoPath = next.repoPath;
  if (repoPath === null) {
    // `scope === 'pane' && repoPath === null` is unreachable today (openPaneFilterEditor always
    // sets repoPath) but the type permits it — surface it as an editor error rather than silently
    // discarding a compiled spec.
    return { editor: { ...next, error: 'no pane targeted' }, globalFilter: null, paneFilterUpdate: null };
  }
  // A vacuous spec (deep-equal to DEFAULT_LOG_FILTER, e.g. after backspacing the query to empty)
  // removes the key, exactly like the explicit-clear path: the "pane filter: on" annotation and
  // resolveFilterClearTarget's `hasOwnFilter` check key off entry *presence*, not content.
  return {
    editor: { ...next, error: null },
    globalFilter: null,
    paneFilterUpdate: { repoPath, spec: isDefaultLogFilterSpec(spec) ? null : spec },
  };
}

// A pane's effective filter is (engaged ? global : pass) AND (own ?? pass) — `global`/`own` are
// already resolved by the caller to `null` for whichever half should pass everything. A spec that
// fails to compile is treated as pass-through rather than thrown or silently hiding every line —
// defensive only, since the zone never commits an uncompilable spec.
export function applyLogFilters(lines: readonly LogLine[], global: LogFilterSpec | null, own: LogFilterSpec | null): LogLine[] {
  const globalFilter = global !== null ? compileLogFilter(global) : null;
  const ownFilter = own !== null ? compileLogFilter(own) : null;
  return lines.filter((line) => {
    if (globalFilter !== null && globalFilter.ok && !globalFilter.test(line)) {
      return false;
    }
    if (ownFilter !== null && ownFilter.ok && !ownFilter.test(line)) {
      return false;
    }
    return true;
  });
}

// Shared by LogsPaneView and FullscreenPane (both call applyLogFilters right after
// filterVisibleLines, the layer the stdout/stderr toggle lives on). A pane's effective filter is
// (engaged ? global : pass) AND (own ?? pass).
export function resolveEffectiveLines(
  pane: { lines: readonly LogLine[] } | undefined,
  visibility: VisibilityFlags,
  globalFilter: LogFilterSpec,
  engaged: boolean,
  ownFilter: LogFilterSpec | null,
): LogLine[] {
  if (!pane) {
    return [];
  }
  return applyLogFilters(filterVisibleLines(pane.lines, visibility), engaged ? globalFilter : null, ownFilter);
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
  paneFilters: Readonly<Record<string, LogFilterSpec>>,
  repoPath: string,
  spec: LogFilterSpec | null,
): Record<string, LogFilterSpec> {
  if (spec === null) {
    const next = { ...paneFilters };
    delete next[repoPath];
    return next;
  }
  return { ...paneFilters, [repoPath]: spec };
}

// The filter editor's Left/Right keys cycle a filter's level restriction through "no
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

// A short human-readable rendering of a filter spec, e.g. `text "boom"`, `regex (any) [ERROR]` —
// used on the pane/fullscreen annotations so a user can tell *what* is filtering a pane without
// reopening its editor.
export function formatLogFilterSpec(spec: LogFilterSpec): string {
  const queryPart = spec.query === '' ? '(any)' : `"${spec.query}"`;
  const levelPart = spec.level !== null ? ` [${spec.level}]` : '';
  return `${spec.mode} ${queryPart}${levelPart}`;
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

// The scrolled-into-view window a pane actually renders: as many lines as fit within
// `rowBudget` terminal rows, ending `offset` lines back from the tail. `getRowCount` reports
// how many terminal rows a given line actually occupies once rendered — 1 for every line by
// default (matching a plain count-based window), but the caller passes a wrap-aware one (see
// computeLineRowCount) so a wrapped multi-row line "spends" more of the budget than a
// truncated single-row one.
//
// Sizing the window by row cost (not line count) keeps the pane filled edge-to-edge in both
// truncate and wrap mode, on every toggle: a fixed line count overflows the pane under wrap and
// leaves a blank gap after switching back to truncate.
export function sliceVisibleWindow<T>(lines: readonly T[], offset: number, rowBudget: number, getRowCount: (line: T) => number = () => 1): T[] {
  if (lines.length === 0 || rowBudget <= 0) {
    return [];
  }
  const end = Math.max(lines.length - offset, 0);
  let start = end;
  let usedRows = 0;
  while (start > 0) {
    const rows = getRowCount(lines[start - 1] as T);
    if (usedRows + rows > rowBudget) {
      break;
    }
    usedRows += rows;
    start -= 1;
  }
  // A single line whose own row cost alone exceeds the whole budget (e.g. a very long line
  // under wrap in a short pane) must still render something rather than leaving the pane
  // fully blank — it simply overflows and gets clipped by the pane's own `overflow="hidden"`.
  if (start === end && end > 0) {
    start = end - 1;
  }
  return lines.slice(start, end);
}

// How many terminal rows a single formatted log line will actually render as. Truncated lines
// (wrap === false) always cost exactly 1 row (Ink's `truncate-end` never wraps).
//
// Wrapped lines delegate to `wrap-ansi` with the exact options Ink's own Text uses for
// `wrap="wrap"` (ink/build/wrap-text.js): ANSI escapes occupy zero columns (docker output is
// colourized by default) and word-wrap can't split mid-word, so `ceil(length / width)` would
// misestimate and leave a blank gap at the bottom of wrapped panes. This matches exactly.
export function computeLineRowCount(text: string, width: number, wrap: boolean): number {
  if (!wrap) {
    return 1;
  }
  const safeWidth = Math.max(width, 1);
  return wrapAnsi(text, safeWidth, { trim: false, hard: true }).split('\n').length;
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

// Push/dedup/trim and the arrow-browse state machine are the shared input-history primitive
// (tui/shared/input-history) — re-exported under the Logs-facing names so callers read as before.
export { pushHistoryEntry as pushFilterHistoryEntry } from '../../shared/input-history/index.js';
export {
  resolveHistoryBrowseDown,
  resolveHistoryBrowseUp,
  type HistoryBrowseResult as FilterHistoryBrowseResult,
  type HistoryBrowseState as FilterHistoryBrowseState,
} from '../../shared/input-history/index.js';

// The filter editor's in-progress draft — `/` opens one with scope 'global', `f` with scope
// 'pane' (repoPath set to the owning pane). `error` mirrors compileLogFilter's last result for
// this exact draft (recomputed on every keystroke) — it never blocks further editing, only
// committing that (mode, query, level) into `globalFilter`/`paneFilters`.
export type FilterEditorState = {
  scope: 'global' | 'pane';
  repoPath: string | null;
  mode: LogFilterMode;
  query: string;
  // The caret position within `query`, threaded to TextInputLine like edts-zone.logic.ts's
  // `nextTextInputValue`/`TextInputState`. Every programmatic overwrite of `query` (open, history
  // recall, arrow-browse) resets this to `query.length`.
  cursor: number;
  level: LogLevel | null;
  error: string | null;
  // The spec in effect for this scope when the editor opened — restored verbatim on Escape, so the
  // "[Enter] confirm  [Esc] cancel" hint behaves as a true cancel.
  preOpen: LogFilterSpec;
  // Non-null while `↑`/`↓` are browsing this scope+mode's history — null on a fresh open and
  // whenever browsing has ended (snapped back to the draft, or walked past the most-recent entry).
  // See resolveHistoryBrowseUp/Down in tui/shared/input-history.
  browsing: HistoryBrowseState | null;
};

// The filter-history grid's `getLabel` for command-bar.tsx's generic grid primitives — history
// entries are plain strings, so this is the identity function. Shared by LogsZone's useInput and
// LogFilterEditor's render.
export function historyEntryLabel(entry: string): string {
  return entry;
}
