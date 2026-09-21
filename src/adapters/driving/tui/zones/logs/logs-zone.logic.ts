// tui/zones/logs: the LogsZone's pure, non-React logic (story 5.1) — pane-focus cycling, grid
// layout math, sub-focus navigation, scroll-offset math, and stream-visibility toggles. Mirrors
// edts-zone.logic.ts's own split (that file's header explains why: every keystroke behavior a
// standalone pure function, unit-tested directly, with `useInput` staying a thin dispatcher).
//
// List navigation (resolveSelectionDirection/moveSelection/resolveSelectionJump/jumpSelection,
// toggleMemberSelection) and the EDT-membership partition (partitionServicesByEdtMembership)
// are generic, already-exported pure functions with no EDT-specific coupling — reused as-is
// from edts-zone.logic.ts rather than re-implemented here (Code Map: "reuse
// partitionServicesByEdtMembership shape").
import wrapAnsi from 'wrap-ansi';
import type { ServiceBranchDivergence } from '../../../../../core/edt/list.js';
import type { HealthState, LogLine } from '../../../../../core/ports/docker.js';
import type { StatusBadgeState } from '../../shared/components/status-badge.js';
import { spacing } from '../../shared/theme/theme.js';

// Story 5.3: HealthState → StatusBadgeState — `up` → `●`/success, `down` → `○`/error,
// `restarting` → `⣾`/info (StatusBadge's `in-progress`). Glyph+color always paired, never
// color alone; accent is never a health color (StatusBadge as-is, no change). Shared by every
// place a health badge renders (list rows, grid panes, fullscreen pane).
export function healthBadgeState(health: HealthState): StatusBadgeState {
  if (health === 'restarting') {
    return 'in-progress';
  }
  return health;
}

// Boundaries: "Tab cycles EDT list -> other list -> panes".
export type LogsPaneFocus = 'edt-list' | 'other-list' | 'panes';

export function cycleLogsPaneFocus(current: LogsPaneFocus): LogsPaneFocus {
  if (current === 'edt-list') {
    return 'other-list';
  }
  if (current === 'other-list') {
    return 'panes';
  }
  return 'edt-list';
}

// Design Notes: "picks the squarest rows x cols grid fitting n panes (ceil(sqrt(n)) columns)
// within the terminal's available area". 0 panes is a degenerate 0x0 grid — the zone renders
// its own empty-state message instead of any grid cell in that case, never calling this with
// a non-positive width/height either (both default to 1 here purely so the arithmetic below
// stays total for a pathological caller).
export type GridLayout = {
  rows: number;
  cols: number;
  cellWidth: number;
  cellHeight: number;
};

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

// Reserves a fixed-width left column for the two lists — this zone has no persisted/resizable
// splitter ratio (unlike every ListDetailSplit-based zone): the spec's Code Map/Design Notes
// never mention one, and the grid's own auto-resize (computeGridLayout) already absorbs
// whatever width remains. Also referenced directly by logs-zone.tsx's own JSX (the list
// column's fixed `width`).
export const LIST_COLUMN_WIDTH = 32;
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

// User-reported review fix: CHROME_ROWS/PANE_CHROME_ROWS/GRID_PANE_CHROME_COLS above are only
// ever rough guesses (their own comments say so) — real chrome varies per pane (an optional
// streamError or "no more history" line adds a row; Yoga's flex-grow rounding hands some grid
// rows one more terminal row than a plain `floor(height / rows)` division would). Guessing wrong
// used to leave a permanent gap at the bottom of every pane, worst in wrap mode (its per-line
// row-cost estimate in computeLineRowCount compounds the same guesswork). `useElementSize`
// measures the pane's own content box for real, post-render, via Ink's `measureElement` — the
// estimate above only seeds the very first paint (before Yoga has computed a layout to
// measure), and every commit after that self-corrects to the pane's true row/column budget.

// Story 5.4: the filter-history grid browser's own layout budget — mirrors command-bar.tsx's
// MODAL_CHROME_WIDTH/MIN_GRID_WIDTH (a `ModalDialog`'s own chrome plus a safety margin) since
// this grid renders inside the same LogFilterEditor `ModalDialog`.
const HISTORY_GRID_CHROME_WIDTH = 6;
const HISTORY_GRID_MIN_WIDTH = 10;
// Story 5.5: the history grid browser's own available-*height* budget — ModalDialog's chrome
// (double border top/bottom + padding top/bottom + title row + "──" separator = 6 rows) plus
// this editor's own fixed rows above the grid (TextInputLine + Level line + the hint line
// below the grid = 3 rows); a rough estimate mirrors CHROME_ROWS/PANE_CHROME_ROWS above ("an
// approximation is fine here" — same precedent). The optional inline-error line is
// deliberately not subtracted, so this budget stays slightly generous rather than short
// whenever a regex draft is currently invalid.
const HISTORY_GRID_CHROME_ROWS = 9;
const HISTORY_GRID_MIN_VISIBLE_ROWS = 3;
// Story 5.5: rough total-rows budget for the Logs zone's list column (top bar, zone-tab bar,
// footer, and the "LOGS" title row above it) — the list column and the pane grid are row
// siblings sharing the exact same vertical extent, so this reuses the same estimate as
// PANE_CHROME_ROWS' own sibling, CHROME_ROWS, above.
const LOGS_LIST_HEADER_ROWS = 2; // "ACTIVE EDT MEMBERS" + "OTHER SERVICES" header rows, always rendered.

export type LogsLayoutInput = {
  windowColumns: number;
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

// Extracted from logs-zone.tsx (refactor): every terminal-row/column budget the zone's own
// render derives from the live window size — the pane grid, the fullscreen preview, the
// filter-history grid browser, and the two service lists' own BoundedList windows (Story 5.5,
// OVERFLOW_LOGS_LISTS/OVERFLOW_HISTORY_GRID). Kept as one pure function (rather than several
// loose `const`s in the component body) so the whole budget stays unit-testable against a given
// terminal size without mounting Ink.
export function computeLogsLayout(input: LogsLayoutInput): LogsLayout {
  const gridAvailableWidth = Math.max(input.windowColumns - LIST_COLUMN_WIDTH - spacing['pane-padding-x'], 20);
  const gridAvailableHeight = Math.max(input.windowRows - CHROME_ROWS, 5);
  const layout = computeGridLayout(input.activePaneCount, gridAvailableWidth, gridAvailableHeight);
  const paneVisibleLines = Math.max(layout.cellHeight - PANE_CHROME_ROWS, 1);
  const paneContentWidth = Math.max(layout.cellWidth - GRID_PANE_CHROME_COLS, 1);
  const fullscreenVisibleLines = Math.max(input.windowRows - CHROME_ROWS, 3);
  const fullscreenContentWidth = Math.max(input.windowColumns - spacing['pane-padding-x'] * 2, 1);
  // Story 5.4: the history grid browser's own available width, mirroring command-bar.tsx's
  // own `availableWidth` computation (this grid renders inside the same ModalDialog chrome).
  const historyGridAvailableWidth = Math.max(input.windowColumns - HISTORY_GRID_CHROME_WIDTH, HISTORY_GRID_MIN_WIDTH);
  // Story 5.5: same idea, vertically — the grid's own visible-rows budget (I/O matrix
  // OVERFLOW_HISTORY_GRID), recalculated live off useWindowSize() on every resize.
  const historyGridAvailableHeight = Math.max(input.windowRows - HISTORY_GRID_CHROME_ROWS, HISTORY_GRID_MIN_VISIBLE_ROWS);

  // Story 5.5 (EDITOR_OPEN_BEHIND_CONTENT): LogFilterEditor renders as a sibling *below* the
  // "LOGS" + list/grid block, not a true overlay (Ink has no absolute positioning) — while it's
  // open, its own rendered rows compete for the same terminal-row budget the list column's
  // BoundedLists were computed against. The hints panel already goes away entirely while the
  // editor is open (the pre-existing 5.4 focus-hidden fix), but the two *service* lists don't —
  // so this estimates the editor's own footprint (its fixed chrome/rows, plus the history-grid
  // browser's own rows when that's open too, mirroring `historyGridAvailableHeight`'s own
  // budget) and reserves that much off the list column's budget in addition to the header rows,
  // so the two together still never exceed the terminal.
  const filterEditorReservedRows = !input.filterEditorOpen
    ? 0
    : HISTORY_GRID_CHROME_ROWS + (!input.historyGridOpen ? 0 : Math.min(input.filterHistoryGridMaxRows, historyGridAvailableHeight));
  // Story 5.5 (OVERFLOW_LOGS_LISTS): the list column's own total row budget — a row sibling of
  // the pane grid, so it reuses gridAvailableHeight. Handed out top-down (EDT list, then OTHER
  // list, then the hints panel) so a section shorter than its share leaves more room for the
  // ones rendered after it; each BoundedList below only ever consumes what its own content
  // actually needs (NO_OVERFLOW: nothing changes when everything already fits).
  const listsContentBudget = Math.max(gridAvailableHeight - LOGS_LIST_HEADER_ROWS - filterEditorReservedRows, 3);
  const edtListMaxVisibleRows = listsContentBudget;
  // Review fix: an empty list still renders a 1-row placeholder ("No active EDT."/"No services
  // in the active EDT."/"No other managed services.") instead of the BoundedList's own 0 rows —
  // `Math.min(list.length, …)` was 0 for an empty list, under-counting what that section
  // actually consumes and leaving whatever renders after it 1 row over budget.
  const edtListConsumedRows = input.edtServiceCount === 0 ? 1 : Math.min(input.edtServiceCount, edtListMaxVisibleRows);
  const otherListMaxVisibleRows = Math.max(1, listsContentBudget - edtListConsumedRows);
  const otherListConsumedRows = input.otherServiceCount === 0 ? 1 : Math.min(input.otherServiceCount, otherListMaxVisibleRows);
  const hintsMaxVisibleRows = Math.max(1, otherListMaxVisibleRows - otherListConsumedRows);

  return {
    layout,
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

// Boundaries: "arrows ... move ... pane sub-focus" while paneFocus === 'panes' — 2D movement
// over the same row-major index order the grid renders panes in (index = row * cols + col).
// Clamped at every edge (never wraps): moving left from column 0, or past the last real pane
// on a short trailing grid row, is a no-op in that direction.
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

// Boundaries: "Selection change ... sub-focus moves to the nearest remaining pane" — clamping
// the old index into the new (smaller) pane count lands on the same index when it still
// exists, or the new last pane otherwise; both read as "the nearest remaining one" for a
// stably-ordered pane list.
export function reindexPaneSubFocus(currentIndex: number, newPaneCount: number): number {
  if (newPaneCount === 0) {
    return 0;
  }
  return Math.min(Math.max(currentIndex, 0), newPaneCount - 1);
}

// Boundaries: "Ctrl+Up/Ctrl+Down scroll the sub-focused pane". `offset` counts lines back from
// the live tail (0 == pinned to the tail); scrolling up increases it, capped at
// `lineCount - 1` (the oldest currently-buffered line) — never negative, never past the top.
export function adjustScrollOffset(current: number, direction: 'up' | 'down', lineCount: number): number {
  if (lineCount === 0) {
    return 0;
  }
  const next = direction === 'up' ? current + 1 : current - 1;
  return Math.min(Math.max(next, 0), lineCount - 1);
}

// I/O matrix SCROLLBACK_RELOAD: "User scrolls a pane to its oldest buffered line" — the
// trigger for fetching more history. True once the offset can't go any further up without
// more lines existing to scroll into. A genuinely empty pane (lineCount === 0) counts as
// vacuously "at the oldest line" too — this is the pane's *normal* starting state (the live
// tail deliberately starts empty, per DockerPort's `--since now`), so without this branch
// Ctrl+Up could never trigger the very first scrollback fetch a freshly opened, currently
// quiet service needs (review fix: previously always false for an empty pane, silently
// eating the keypress).
export function isAtOldestLine(offset: number, lineCount: number): boolean {
  return lineCount === 0 || offset >= lineCount - 1;
}

// Boundaries: "scroll position preserved" after a scrollback reload — but that only makes
// sense when there was already visible content anchoring the viewport. A pane that started
// genuinely empty has no prior viewport to preserve; pinning it back to offset 0 instead
// shows the newest lines of whatever history was just fetched, rather than the previous
// formula's `currentOffset + appended` overshooting straight past every line just loaded
// (review fix — see isAtOldestLine's own header for why an empty pane reaches this at all).
// `newLineCount` (the manager's own post-fetch `entry.lines.length`) is taken alongside
// `appended` — not `appended` alone — as a defensive upper bound against a live line arriving
// from the tail while the older-lines fetch was still in flight.
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

// Review fix: fullscreen has no sub-focus grid to disambiguate from (there's only ever the
// one pane), so the Ctrl requirement above was never actually load-bearing there — it was
// just inherited by reusing resolvePaneScrollDirection for both views. Plain Up/Down is
// simpler and reads fine with nothing else in fullscreen contending for those keys; ctrl is
// accepted too (never rejected) so existing Ctrl+Up/Down muscle memory still works.
export function resolveFullscreenScrollDirection(key: { ctrl?: boolean; upArrow?: boolean; downArrow?: boolean }): 'up' | 'down' | null {
  if (key.upArrow) {
    return 'up';
  }
  if (key.downArrow) {
    return 'down';
  }
  return null;
}

// Boundaries (amended, user-reported review fix): originally "Ctrl+A / Ctrl+Shift+A
// select/deselect all EDT-list services" — Ctrl+Shift+A turned out unreachable on virtually
// every real terminal. A `Ctrl+letter` combo is delivered over the wire as a single control
// byte (0x01-0x1A) that carries no shift information at all — confirmed against Ink's own
// parser (parse-keypress.js's ctrl+letter branch sets `key.ctrl` but never `key.shift`), so
// Ctrl+A and Ctrl+Shift+A are indistinguishable there; only a terminal that both supports and
// negotiates the newer Kitty keyboard protocol could tell them apart, and this app doesn't
// even opt into that protocol (bin/tui.ts's `render()` call). Ctrl+A now toggles instead: one
// reliable shortcut that flips to deselect-all once everything is already selected, rather
// than needing a second, unreachable one.
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

// User-reported: 'c'/'w' (clear/wrap) previously applied globally — clearing or re-wrapping
// every open pane at once, even ones the user wasn't looking at. Ctrl+C/Ctrl+W mirror
// isSelectAllKey's own Ctrl+letter shape to apply the same action to every active pane at
// once, on demand, while the bare key stays scoped to whichever single pane is sub-focused
// (or fullscreen). Requires ctrl for the same reason isSelectAllKey does: unambiguous,
// intentional "do this everywhere" gesture distinct from the single-pane key.
type LogsCtrlKey = { ctrl?: boolean };

export function isClearAllLogsKey(input: string, key: LogsCtrlKey): boolean {
  return key.ctrl === true && input.toLowerCase() === 'c';
}

export function isWrapAllLogsKey(input: string, key: LogsCtrlKey): boolean {
  return key.ctrl === true && input.toLowerCase() === 'w';
}

// Boundaries: "the zone can toggle timestamp/stdout/stderr visibility ... independently (t/o/p)
// without reconnecting the stream" — a pure display filter over the already-buffered lines,
// never touching the subscription itself.
// `stderr` was originally bound to 'e' — changed to 'p' (review fix) since 'e' collides with
// the Edts zone's own tab mnemonic (zones.ts): pressing it while in the Logs zone toggled
// stderr here *and* switched AppShell's active zone to Edts on the same keypress, for the
// same "every mounted useInput hook gets the same event" reason documented on
// logsPaneGridArrowsActive in navigation-slice.ts.
//
// `wrap` (the 'w' key) used to live here too, toggling a single shared flag applied to every
// pane. User-reported: wrap is now per-pane (see togglePaneWrapFlag/toggleAllPanesWrapFlag
// below) since a single shared flag couldn't express "wrap just the pane I'm looking at".
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

// Per-pane wrap/truncate state, keyed by repoPath — a pane absent from the map defaults to
// truncate (matching the grid view's existing, deliberate `truncate-end` choice; fullscreen
// previously wrapped by default only because no `wrap` prop was ever passed there, not
// because of any documented Design Notes decision).
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

// Story 5.2: two-tier text/regex/level filter over already-buffered lines — a pure,
// render-time transform layered on top of filterVisibleLines above (never touches the
// subscription). See logs-zone.tsx's own `filterEditor` state for how these compose with the
// UI (Design Notes: "compileLogFilter recomputes on every editor keystroke ... so the inline
// regex error appears/clears live").
export type LogFilterMode = 'text' | 'regex';
export type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

export type LogFilterSpec = {
  mode: LogFilterMode;
  query: string;
  level: LogLevel | null;
};

export const DEFAULT_LOG_FILTER: LogFilterSpec = { mode: 'text', query: '', level: null };

// Extracted from logs-zone.tsx (refactor): shared by the filter-editor commit/cancel paths and
// every pane's "pane filter: on" annotation — a spec deep-equal to DEFAULT_LOG_FILTER (empty
// query, no level restriction, either mode) is a no-op filter and must never be stored as an
// explicit paneFilters[repoPath] entry (that would leave the annotation/hasOwnFilter check
// seeing a filter that isn't actually filtering anything).
export function isDefaultLogFilterSpec(spec: LogFilterSpec): boolean {
  return spec.mode === DEFAULT_LOG_FILTER.mode && spec.query === DEFAULT_LOG_FILTER.query && spec.level === DEFAULT_LOG_FILTER.level;
}

// Boundaries: "Level filtering has no source field (LogLine has no level) — matched via a
// text heuristic (ERROR|WARN|INFO|DEBUG, case-insensitive) against line.text". Only the
// *first* matching token counts — real log lines never carry more than one level tag, and
// picking the first keeps this a total, order-independent function of the raw text.
const LOG_LEVEL_PATTERN = /\b(ERROR|WARN|INFO|DEBUG)\b/i;

export function detectLogLevel(text: string): LogLevel | null {
  const match = LOG_LEVEL_PATTERN.exec(text);
  return match === null ? null : (match[1].toUpperCase() as LogLevel);
}

// Boundaries: "An invalid regex ... shows an inline error in the editor and is never applied
// ... never throws into the render tree" — `compileLogFilter` is the one place a malformed
// pattern is ever allowed to throw (RegExp's own constructor), caught here and turned into a
// typed failure the caller (the editor) surfaces as text, rather than letting it escape into
// the render tree.
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

// Boundaries: "A pane's effective filter is (engaged ? global : pass) AND (own ?? pass)" —
// `global`/`own` are already resolved by the caller to `null` for whichever half of that
// formula should pass everything (a disengaged pane passes `null` for `global`; a pane with
// no own filter passes `null` for `own`). A spec that fails to compile is treated as
// pass-through rather than thrown or silently hiding every line — defensive only, since the
// zone (logs-zone.tsx) never commits an uncompilable spec into either `global`/`own` state in
// the first place (compileLogFilter's own error path stops that at the editor).
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

// Extracted from logs-zone.tsx (refactor): shared by LogsPaneView and FullscreenPane (both
// call applyLogFilters the same way, right after filterVisibleLines, same layer 5.1's
// stdout/stderr toggle already lives on). Boundaries: "A pane's effective filter is
// (engaged ? global : pass) AND (own ?? pass)".
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
// togglePaneWrapFlag's own shape, but defaults to `true` (Boundaries: "one global ... every
// pane is engaged with by default"), the inverse of wrap's own untouched-pane default.
export const DEFAULT_PANE_GLOBAL_FILTER_ENGAGED = true;

export function isPaneEngagedInGlobalFilter(engagedByPath: Readonly<Record<string, boolean>>, repoPath: string | null): boolean {
  if (repoPath === null) {
    return DEFAULT_PANE_GLOBAL_FILTER_ENGAGED;
  }
  return engagedByPath[repoPath] ?? DEFAULT_PANE_GLOBAL_FILTER_ENGAGED;
}

// The `g` key's toggle (an explicit flip, either direction).
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

// A short human-readable rendering of a filter spec, e.g. `text "boom"`, `regex (any) [ERROR]`
// — used on the pane/fullscreen annotations so a user can tell *what* is filtering a pane
// without reopening its editor (user-reported: the boolean "pane filter: on" annotation alone
// didn't say what the filter actually was).
export function formatLogFilterSpec(spec: LogFilterSpec): string {
  const queryPart = spec.query === '' ? '(any)' : `"${spec.query}"`;
  const levelPart = spec.level !== null ? ` [${spec.level}]` : '';
  return `${spec.mode} ${queryPart}${levelPart}`;
}

// Boundaries: "Escape, when no editor is open: if a pane is sub-focused in the grid (not
// fullscreen), clears that pane's own filter if set, else disengages it from the global
// filter; if no pane is sub-focused (list-focus), clears the global filter entirely." Pure
// resolver — logs-zone.tsx's useInput dispatches the returned target to the right setter.
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
// User-reported review fix: this used to just slice the last N *lines* regardless of how many
// terminal *rows* they'd render as. That was fine in truncate mode (1 line == 1 row) but wrong
// under wrap: switching truncate -> wrap could render more rows than the pane had (silently
// clipped by the pane's own `overflow="hidden"`), and wrap -> truncate collapsed the same N
// lines into far fewer rows than the pane's height, leaving a blank gap at the bottom until a
// scroll happened to pick a different (but still fixed-count) window. Sizing the window by
// actual row cost keeps the pane always filled edge-to-edge, in both modes, on every toggle —
// no scroll needed to "recalculate".
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
// User-reported review fix: wrapped lines used to cost `ceil(text.length / width)` — a naive
// character count that assumes every character occupies one visible column. Real log lines
// routinely carry ANSI colour escapes (docker/compose output is colourized by default), whose
// bytes count toward `.length` but occupy zero terminal columns; a heavily-coloured line could
// read as needing 2-3x the rows it actually renders as. That inflated cost made
// sliceVisibleWindow stop selecting lines far short of the pane's real budget, leaving a large
// blank gap at the bottom in wrap mode specifically (truncate mode's fixed 1-row cost was never
// affected) that persisted no matter how far back the user scrolled. Word-wrapping itself also
// isn't just `ceil(length / width)` — it can't split mid-word, so it costs a few rows more than
// that division implies even for plain ASCII text.
//
// Delegating to `wrap-ansi` with the exact same options Ink's own Text component uses for
// `wrap="wrap"` (see ink/build/wrap-text.js) makes this an exact match rather than another
// approximation: same ANSI-aware width accounting, same word-break rules, same hard-wrap
// fallback for a single token wider than the pane.
export function computeLineRowCount(text: string, width: number, wrap: boolean): number {
  if (!wrap) {
    return 1;
  }
  const safeWidth = Math.max(width, 1);
  return wrapAnsi(text, safeWidth, { trim: false, hard: true }).split('\n').length;
}

// Boundaries: "Any manifest service can be streamed, not only active-EDT members" — a service
// row identity, kept minimal (only what a pane/subscription needs) rather than reusing the
// full ServiceBranchDivergence shape everywhere.
export type LogsServiceRow = Pick<ServiceBranchDivergence, 'service' | 'path'>;

// Story 5.4: filter history recall. Each exact (scope, mode) combination — global-text,
// global-regex, and per-service-text/per-service-regex for every manifest service path — owns
// its own independent, persisted list of committed query strings (Boundaries: "one independent
// list per exact (scope, mode) key"). `repoPath` is only meaningful for `scope: 'pane'`.
export type FilterHistoryKey = { scope: 'global' | 'pane'; repoPath: string | null; mode: LogFilterMode };

// The flat string key StatePort.readFilterHistory/writeFilterHistory persists each list under
// (mirrors splitterRatios' own "keyed by a plain string, the driving layer resolves the
// encoding" convention — core/ports/state.ts has no notion of "scope"/"mode"/repoPath). Global
// scope ignores repoPath entirely; pane scope always carries one (openPaneFilterEditor in
// logs-zone.tsx never opens a pane editor without one).
export function filterHistoryKeyString(key: FilterHistoryKey): string {
  return key.scope === 'global' ? `global:${key.mode}` : `service:${key.repoPath}:${key.mode}`;
}

// I/O matrix HISTORY_PUSH/DEDUP_TOP: front-pushes `query` onto `history`, moving it to the
// front instead of duplicating it when it's already the current top entry, then trims to
// `maxSize`. Pure — the caller (the logs store slice) is responsible for only calling this on
// an actual commit (Enter, compiles, non-empty) and for persisting the result.
//
// User-reported: when `dedupEverywhere` is true (settings.logs.filterHistoryDedup), any
// previous occurrence of `query` — not just the top entry — is removed first and the query
// moves to the front, so each filter exists at most once per list. When false/omitted, the
// legacy DEDUP_TOP-only behavior applies (a non-top duplicate is front-pushed as a second
// instance).
export function pushFilterHistoryEntry(
  history: readonly string[],
  query: string,
  maxSize: number,
  dedupEverywhere = false,
): string[] {
  const rest = dedupEverywhere ? history.filter((entry) => entry !== query) : history.length > 0 && history[0] === query ? history.slice(1) : history;
  return [query, ...rest].slice(0, Math.max(maxSize, 0));
}

// The filter editor's arrow-recall browsing state: `index` is the position in `history`
// currently shown (0 == most recent), `savedDraft` is the draft exactly as it stood before
// browsing began, restored verbatim once `↓` walks back past the most-recent entry.
export type FilterHistoryBrowseState = { index: number; savedDraft: string };

export type FilterHistoryBrowseResult = { query: string; browsing: FilterHistoryBrowseState | null };

// Extracted from logs-zone.tsx (refactor): the filter editor's in-progress draft — `/` opens
// one with scope 'global', `f` with scope 'pane' (repoPath set to whichever pane owns it).
// `error` mirrors whatever compileLogFilter last returned for this exact draft (Design Notes:
// recomputed live on every keystroke, never just on submit) — it never blocks the draft from
// being edited further, it only blocks that particular (mode, query, level) combination from
// being committed into `globalFilter`/`paneFilters` (see logs-zone.tsx's applyFilterEditorDraft).
export type FilterEditorState = {
  scope: 'global' | 'pane';
  repoPath: string | null;
  mode: LogFilterMode;
  query: string;
  // Story 2.32-style cursor adoption: the caret position within `query`, threaded through to
  // TextInputLine exactly like edts-zone.logic.ts's `nextTextInputValue`/`TextInputState`
  // convention (reused directly below). Every programmatic overwrite of `query` (open, history
  // recall, arrow-browse) resets this to `query.length`, matching that convention's Boundary.
  cursor: number;
  level: LogLevel | null;
  error: string | null;
  // Review fix: the spec that was in effect for this scope at the moment the editor opened —
  // restored verbatim on Escape (a true cancel) so a reused widget whose own hint text reads
  // "[Enter] confirm  [Esc] cancel" actually behaves that way, instead of Escape and Enter both
  // just closing the editor and leaving whatever last compiled cleanly while typing applied.
  preOpen: LogFilterSpec;
  // Story 5.4: non-null while `↑`/`↓` are browsing this scope+mode's history — null on a fresh
  // open and whenever the draft is untouched/browsing has ended (snapped back to the draft, or
  // walked past the most-recent entry). See resolveHistoryBrowseUp/Down just above.
  browsing: FilterHistoryBrowseState | null;
};

// I/O matrix ARROW_UP_OLDEST: `↑` on an untouched draft recalls the most-recent entry
// (preserving the draft as `savedDraft`); further `↑` walks older entries; `↑` already at the
// oldest entry is a no-op (Boundaries). An empty history is a no-op too — nothing to recall.
//
// User-reported: the editor opens pre-filled with the currently-active filter, which is
// usually also the history's most-recent entry — recalling it first forces two `↑` presses
// before any different value appears. Any history entry equal to the draft being browsed
// from is therefore skipped: on a fresh `↑` the most-recent entry is skipped when it equals
// the current query, and while already browsing, entries equal to `savedDraft` are skipped
// when walking older. Skipping past the end is a no-op.
export function resolveHistoryBrowseUp(
  currentQuery: string,
  browsing: FilterHistoryBrowseState | null,
  history: readonly string[],
): FilterHistoryBrowseResult {
  if (history.length === 0) {
    return { query: currentQuery, browsing };
  }
  if (browsing === null) {
    let index = 0;
    while (index < history.length && history[index] === currentQuery) {
      index += 1;
    }
    if (index >= history.length) {
      return { query: currentQuery, browsing };
    }
    return { query: history[index]!, browsing: { index, savedDraft: currentQuery } };
  }
  let nextIndex = browsing.index + 1;
  while (nextIndex < history.length && history[nextIndex] === browsing.savedDraft) {
    nextIndex += 1;
  }
  if (nextIndex >= history.length) {
    return { query: currentQuery, browsing };
  }
  return { query: history[nextIndex]!, browsing: { index: nextIndex, savedDraft: browsing.savedDraft } };
}

// I/O matrix ARROW_DOWN_PAST_RECENT: `↓` while browsing walks back toward the draft; one more
// `↓` past the most-recent entry (index 0) restores the original draft exactly and ends
// browsing. Only ever called while already browsing (Boundaries: "↓ on an untouched draft ...
// opens a ... grid browser" instead — see logs-zone.tsx's own dispatch).
//
// Mirrors the `↑` skip above: entries equal to `savedDraft` are never shown on the way back
// down either — walking onto one restores the draft directly (ending browsing) instead of
// displaying the same text twice.
export function resolveHistoryBrowseDown(
  browsing: FilterHistoryBrowseState,
  history: readonly string[],
): FilterHistoryBrowseResult {
  let prevIndex = browsing.index - 1;
  while (prevIndex >= 0 && history[prevIndex] === browsing.savedDraft) {
    prevIndex -= 1;
  }
  if (prevIndex < 0) {
    return { query: browsing.savedDraft, browsing: null };
  }
  return { query: history[prevIndex]!, browsing: { index: prevIndex, savedDraft: browsing.savedDraft } };
}

// Extracted from logs-zone.tsx (refactor): the filter-history grid browser's own `getLabel`
// callback for command-bar.ts's generalized grid primitives (which operate over arbitrary
// entries, not just plain strings) — history entries are plain strings already, so this is the
// identity function. Shared by LogsZone's own useInput dispatch and LogFilterEditor's render.
export function historyEntryLabel(entry: string): string {
  return entry;
}
