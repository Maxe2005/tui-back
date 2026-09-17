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
import type { ServiceBranchDivergence } from '../../../../../core/edt/list.js';
import type { LogLine } from '../../../../../core/ports/docker.js';

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

// Boundaries: "the zone can toggle timestamp/stdout/stderr visibility, and log-line
// wrap/truncate, independently (t/o/p/w) without reconnecting the stream" — a pure display
// filter over the already-buffered lines, never touching the subscription itself.
// `stderr` was originally bound to 'e' — changed to 'p' (review fix) since 'e' collides with
// the Edts zone's own tab mnemonic (zones.ts): pressing it while in the Logs zone toggled
// stderr here *and* switched AppShell's active zone to Edts on the same keypress, for the
// same "every mounted useInput hook gets the same event" reason documented on
// logsPaneGridArrowsActive in navigation-slice.ts.
export type VisibilityToggle = 'timestamp' | 'stdout' | 'stderr' | 'wrap';

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
  if (input === 'w') {
    return 'wrap';
  }
  return null;
}

export type VisibilityFlags = { showTimestamps: boolean; showStdout: boolean; showStderr: boolean; wrapLines: boolean };

export function toggleVisibilityFlag(flags: VisibilityFlags, toggle: VisibilityToggle): VisibilityFlags {
  if (toggle === 'timestamp') {
    return { ...flags, showTimestamps: !flags.showTimestamps };
  }
  if (toggle === 'stdout') {
    return { ...flags, showStdout: !flags.showStdout };
  }
  if (toggle === 'stderr') {
    return { ...flags, showStderr: !flags.showStderr };
  }
  return { ...flags, wrapLines: !flags.wrapLines };
}

// wrapLines defaults false — every pane (grid and fullscreen alike) truncates long lines
// with an ellipsis until the user opts into wrapping, matching the grid view's existing,
// deliberate `truncate-end` choice (fullscreen previously wrapped by default only because no
// `wrap` prop was ever passed there, not because of any documented Design Notes decision).
export const DEFAULT_VISIBILITY_FLAGS: VisibilityFlags = { showTimestamps: true, showStdout: true, showStderr: true, wrapLines: false };

export function filterVisibleLines(lines: readonly LogLine[], flags: VisibilityFlags): LogLine[] {
  return lines.filter((line) => (line.stream === 'stdout' ? flags.showStdout : flags.showStderr));
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
// (wrap === false) always cost exactly 1 row (Ink's `truncate-end` never wraps). Wrapped lines
// cost `ceil(text.length / width)`, floored at 1 so even an empty line still takes a row.
export function computeLineRowCount(text: string, width: number, wrap: boolean): number {
  if (!wrap) {
    return 1;
  }
  const safeWidth = Math.max(width, 1);
  return Math.max(Math.ceil(text.length / safeWidth), 1);
}

// Boundaries: "Any manifest service can be streamed, not only active-EDT members" — a service
// row identity, kept minimal (only what a pane/subscription needs) rather than reusing the
// full ServiceBranchDivergence shape everywhere.
export type LogsServiceRow = Pick<ServiceBranchDivergence, 'service' | 'path'>;
