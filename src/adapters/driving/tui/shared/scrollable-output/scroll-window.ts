// tui/shared/scrollable-output: pure scroll/wrap/window math for any scrollable line-output
// region. Offsets count lines back from the live tail (0 == pinned to the tail); windows are
// sized by terminal-row cost so a region stays filled in both truncate and wrap mode.
import wrapAnsi from 'wrap-ansi';

// Scrolling up moves away from the tail; the offset is clamped to [0, lineCount - 1] so it never
// scrolls past the oldest line.
export function adjustScrollOffset(current: number, direction: 'up' | 'down', lineCount: number): number {
  if (lineCount === 0) {
    return 0;
  }
  const next = direction === 'up' ? current + 1 : current - 1;
  return Math.min(Math.max(next, 0), lineCount - 1);
}

// The trigger for loading older lines. An empty region counts as "at the oldest line": a live
// tail usually starts empty (e.g. Logs' `--since now`), and scrolling up must still be able to
// request its first history.
export function isAtOldestLine(offset: number, lineCount: number): boolean {
  return lineCount === 0 || offset >= lineCount - 1;
}

export type ScrollKey = { ctrl?: boolean; upArrow?: boolean; downArrow?: boolean };

// For a region that shares its view with other focusable regions (e.g. a pane grid), where bare
// Up/Down already move focus: only Ctrl+Up/Down scroll.
export function resolvePaneScrollDirection(key: ScrollKey): 'up' | 'down' | null {
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

// For a region that owns the arrows (fullscreen): plain Up/Down scroll; ctrl is accepted too so
// Ctrl+Up/Down muscle memory still works.
export function resolveFullscreenScrollDirection(key: ScrollKey): 'up' | 'down' | null {
  if (key.upArrow) {
    return 'up';
  }
  if (key.downArrow) {
    return 'down';
  }
  return null;
}

// Per-region wrap state keyed by any string id; an absent key (or a null id) means truncate.
export const DEFAULT_WRAP = false;

export function isWrapped(wrapByKey: Readonly<Record<string, boolean>>, key: string | null): boolean {
  if (key === null) {
    return DEFAULT_WRAP;
  }
  return wrapByKey[key] ?? DEFAULT_WRAP;
}

export function toggleWrapFlag(wrapByKey: Readonly<Record<string, boolean>>, key: string): Record<string, boolean> {
  return { ...wrapByKey, [key]: !isWrapped(wrapByKey, key) };
}

export function toggleAllWrapFlags(wrapByKey: Readonly<Record<string, boolean>>, keys: readonly string[]): Record<string, boolean> {
  return keys.reduce((next, key) => toggleWrapFlag(next, key), wrapByKey as Record<string, boolean>);
}

// The lines that fit in `rowBudget` terminal rows, ending `offset` lines back from the tail.
// Sized by row cost (`getRowCount`, 1 per line by default), not line count: a fixed count would
// overflow under wrap and leave a blank gap after switching back to truncate.
export function sliceVisibleWindow<T>(lines: readonly T[], offset: number, rowBudget: number, getRowCount: (line: T) => number = () => 1): T[] {
  if (lines.length === 0 || rowBudget <= 0) {
    return [];
  }
  const end = Math.min(Math.max(lines.length - offset, 0), lines.length);
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
  // A line costing more than the whole budget still renders (clipped by the region's
  // `overflow="hidden"`) rather than leaving the region blank.
  if (start === end && end > 0) {
    start = end - 1;
  }
  return lines.slice(start, end);
}

// Terminal rows a formatted line occupies. Truncated lines always cost 1. Wrapped lines use
// `wrap-ansi` with the exact options Ink's `wrap="wrap"` uses: ANSI escapes take zero columns and
// word-wrap never splits mid-word, so `ceil(length / width)` would misestimate.
export function computeLineRowCount(text: string, width: number, wrap: boolean): number {
  if (!wrap) {
    return 1;
  }
  const safeWidth = Math.max(width, 1);
  return wrapAnsi(text, safeWidth, { trim: false, hard: true }).split('\n').length;
}
