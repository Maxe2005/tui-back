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
// more lines existing to scroll into.
export function isAtOldestLine(offset: number, lineCount: number): boolean {
  return lineCount > 0 && offset >= lineCount - 1;
}

type PaneScrollKey = { ctrl?: boolean; upArrow?: boolean; downArrow?: boolean };

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

// Boundaries: "Ctrl+A / Ctrl+Shift+A select/deselect all EDT-list services (EDT list only)".
// Ink delivers a ctrl+letter combo as `input === '<letter>'` with `key.ctrl: true` (confirmed
// against ink's own parser — see app-shell.tsx's shouldEnterResizeMode for the same
// convention); `key.shift` distinguishes the plain and shift-modified combos.
type SelectAllKey = { ctrl?: boolean; shift?: boolean };

export type SelectAllAction = 'select-all' | 'deselect-all' | null;

export function resolveSelectAllAction(input: string, key: SelectAllKey): SelectAllAction {
  if (!key.ctrl || input.toLowerCase() !== 'a') {
    return null;
  }
  return key.shift ? 'deselect-all' : 'select-all';
}

// Boundaries: "the zone can toggle timestamp/stdout/stderr visibility independently (t/o/e)
// without reconnecting the stream" — a pure display filter over the already-buffered lines,
// never touching the subscription itself.
export type VisibilityToggle = 'timestamp' | 'stdout' | 'stderr';

export function resolveVisibilityToggleKey(input: string): VisibilityToggle | null {
  if (input === 't') {
    return 'timestamp';
  }
  if (input === 'o') {
    return 'stdout';
  }
  if (input === 'e') {
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

export function filterVisibleLines(lines: readonly LogLine[], flags: VisibilityFlags): LogLine[] {
  return lines.filter((line) => (line.stream === 'stdout' ? flags.showStdout : flags.showStderr));
}

export function formatLogLine(line: LogLine, showTimestamps: boolean): string {
  return showTimestamps ? `[${line.timestamp}] ${line.text}` : line.text;
}

// The scrolled-into-view window a pane actually renders: `visibleCount` lines ending
// `offset` lines back from the tail. Used by both the grid pane and the fullscreen view (the
// latter simply gets a larger `visibleCount`).
export function sliceVisibleWindow<T>(lines: readonly T[], offset: number, visibleCount: number): T[] {
  if (lines.length === 0 || visibleCount <= 0) {
    return [];
  }
  const end = Math.max(lines.length - offset, 0);
  const start = Math.max(end - visibleCount, 0);
  return lines.slice(start, end);
}

// Boundaries: "Any manifest service can be streamed, not only active-EDT members" — a service
// row identity, kept minimal (only what a pane/subscription needs) rather than reusing the
// full ServiceBranchDivergence shape everywhere.
export type LogsServiceRow = Pick<ServiceBranchDivergence, 'service' | 'path'>;
