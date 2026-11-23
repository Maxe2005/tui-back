// tui/zones/logs: pane-focus cycling and grid sub-focus navigation for the LogsZone.
import { stepFocus, type FocusNavDeclaration, type FocusNavDirection } from '../../../shared/keys/focus-navigation.js';

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
} from '../../../shared/scrollable-output/index.js';
