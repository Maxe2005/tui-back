// tui/shared/scrollable-output: the pure, Ink-free scroll/wrap/window math behind every scrollable
// line-output region (Logs panes, the Logs fullscreen preview, the Update report, the Terminal
// view). Offsets count lines back from the live tail; windows are sized by terminal-row cost so a
// region stays filled edge-to-edge in both truncate and wrap mode (AD-19: bounded in both axes).
import wrapAnsi from 'wrap-ansi';

// Ctrl+Up/Ctrl+Down (or plain Up/Down in fullscreen) scroll a region. `offset` counts lines back
// from the live tail (0 == pinned to the tail); scrolling up increases it, capped at
// `lineCount - 1` (the oldest buffered line) — never negative, never past the top.
export function adjustScrollOffset(current: number, direction: 'up' | 'down', lineCount: number): number {
  if (lineCount === 0) {
    return 0;
  }
  const next = direction === 'up' ? current + 1 : current - 1;
  return Math.min(Math.max(next, 0), lineCount - 1);
}

// The trigger for fetching more history: true once the offset can't go further up without more
// lines to scroll into. A genuinely empty region (lineCount === 0) counts as "at the oldest line"
// too — it is a live tail's *normal* starting state, so otherwise scrolling up could never trigger
// a quiet source's first fetch.
export function isAtOldestLine(offset: number, lineCount: number): boolean {
  return lineCount === 0 || offset >= lineCount - 1;
}

type ScrollKey = { ctrl?: boolean; upArrow?: boolean; downArrow?: boolean };

// Requires ctrl in a grid view — Up/Down there is already claimed by moving focus between panes,
// so a bare arrow has to keep meaning "change focused pane" and Ctrl+Up/Down disambiguates
// "scroll the focused pane instead".
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

// Fullscreen has no sub-focus grid to disambiguate from (only one region), so plain Up/Down
// scroll it; ctrl is accepted too so Ctrl+Up/Down muscle memory still works.
export function resolveFullscreenScrollDirection(key: ScrollKey): 'up' | 'down' | null {
  if (key.upArrow) {
    return 'up';
  }
  if (key.downArrow) {
    return 'down';
  }
  return null;
}

// Per-region wrap/truncate state, keyed by any string id (a repo path, a terminal target, …) — a
// region absent from the map defaults to truncate (`truncate-end`).
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

// The scrolled-into-view window a region actually renders: as many lines as fit within
// `rowBudget` terminal rows, ending `offset` lines back from the tail. `getRowCount` reports how
// many terminal rows a given line actually occupies once rendered — 1 for every line by default
// (a plain count-based window), but the caller passes a wrap-aware one (see computeLineRowCount)
// so a wrapped multi-row line "spends" more of the budget than a truncated single-row one.
//
// Sizing the window by row cost (not line count) keeps the region filled edge-to-edge in both
// truncate and wrap mode, on every toggle: a fixed line count overflows under wrap and leaves a
// blank gap after switching back to truncate.
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
  // A single line whose own row cost alone exceeds the whole budget (e.g. a very long line under
  // wrap in a short region) must still render something rather than leaving the region fully
  // blank — it simply overflows and gets clipped by the region's own `overflow="hidden"`.
  if (start === end && end > 0) {
    start = end - 1;
  }
  return lines.slice(start, end);
}

// How many terminal rows a single formatted line will actually render as. Truncated lines
// (wrap === false) always cost exactly 1 row (Ink's `truncate-end` never wraps).
//
// Wrapped lines delegate to `wrap-ansi` with the exact options Ink's own Text uses for
// `wrap="wrap"` (ink/build/wrap-text.js): ANSI escapes occupy zero columns (docker output is
// colourized by default) and word-wrap can't split mid-word, so `ceil(length / width)` would
// misestimate and leave a blank gap at the bottom of wrapped regions. This matches exactly.
export function computeLineRowCount(text: string, width: number, wrap: boolean): number {
  if (!wrap) {
    return 1;
  }
  const safeWidth = Math.max(width, 1);
  return wrapAnsi(text, safeWidth, { trim: false, hard: true }).split('\n').length;
}
