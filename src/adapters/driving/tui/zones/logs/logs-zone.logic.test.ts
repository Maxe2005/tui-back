import { describe, expect, it } from 'vitest';
import type { LogLine } from '../../../../../core/ports/docker.js';
import {
  applyLogFilters,
  compileLogFilter,
  cycleFilterLevel,
  DEFAULT_LOG_FILTER,
  DEFAULT_PANE_GLOBAL_FILTER_ENGAGED,
  DEFAULT_PANE_WRAP,
  DEFAULT_VISIBILITY_FLAGS,
  adjustScrollOffset,
  computeGridLayout,
  computeLogsLayout,
  computeLineRowCount,
  cycleLogsPaneFocus,
  detectLogLevel,
  filterVisibleLines,
  formatHealthLabel,
  formatLogFilterSpec,
  formatLogLine,
  healthBadgeState,
  isAtOldestLine,
  isClearAllLogsKey,
  isPaneEngagedInGlobalFilter,
  isPaneWrapped,
  isRestartingDisplay,
  isSelectAllKey,
  isWrapAllLogsKey,
  movePaneSubFocus,
  reindexPaneSubFocus,
  resolveFilterClearTarget,
  resolveFullscreenScrollDirection,
  resolvePaneScrollDirection,
  resolvePostLoadScrollOffset,
  resolveSelectAllToggle,
  resolveVisibilityToggleKey,
  setPaneGlobalFilterEngagement,
  setPaneLogFilter,
  sliceVisibleWindow,
  splitNoContainerRows,
  toggleAllPanesWrapFlag,
  toggleFilterMode,
  toggleGlobalFilterEngagement,
  togglePaneWrapFlag,
  toggleVisibilityFlag,
  filterHistoryKeyString,
  pushFilterHistoryEntry,
  resolveHistoryBrowseDown,
  resolveHistoryBrowseUp,
  type FilterHistoryKey,
  type LogFilterSpec,
} from './logs-zone.logic.js';

describe('healthBadgeState / formatHealthLabel', () => {
  it('passes raw health through and reads the container-less service as its own dim state', () => {
    expect(healthBadgeState('up')).toBe('up');
    expect(healthBadgeState('down')).toBe('down');
    expect(healthBadgeState('restarting')).toBe('in-progress');
    expect(healthBadgeState('no-container')).toBe('no-container');
  });

  it('labels the container-less service in words, never as a kebab-case code', () => {
    expect(formatHealthLabel('up')).toBe('up');
    expect(formatHealthLabel('down')).toBe('down');
    expect(formatHealthLabel('no-container')).toBe('no container');
  });

  it('a restarting service names the request and the re-verification, never the bare state', () => {
    expect(formatHealthLabel('restarting')).toBe('restart requested — re-verifying');
  });
});

describe('isRestartingDisplay', () => {
  it('is true for the in-flight restart flag even while docker still reports the old health', () => {
    expect(isRestartingDisplay(true, 'up')).toBe(true);
    expect(isRestartingDisplay(true, 'down')).toBe(true);
  });

  it('is true for docker-reported restarting without the flag', () => {
    expect(isRestartingDisplay(false, 'restarting')).toBe(true);
  });

  it('is false otherwise, including the container-less state', () => {
    expect(isRestartingDisplay(false, 'up')).toBe(false);
    expect(isRestartingDisplay(false, 'down')).toBe(false);
    expect(isRestartingDisplay(false, 'no-container')).toBe(false);
  });

  it('is false for a container-less row even with a stale restart flag', () => {
    expect(isRestartingDisplay(true, 'no-container')).toBe(false);
  });
});

describe('splitNoContainerRows', () => {
  function row(path: string) {
    return {
      service: path.split('/').pop() ?? path,
      path,
      isMember: false,
      sharedBranch: 'development',
      protectedBranches: [],
      branch: 'main',
      ahead: 0,
      behind: 0,
      status: 'current' as const,
    };
  }

  it('moves only positively-resolved container-less rows out of the selectable list', () => {
    const services = [row('/repos/a'), row('/repos/lib'), row('/repos/c')];
    const { selectable, withoutContainer } = splitNoContainerRows(services, { '/repos/lib': true });

    expect(selectable.map((entry) => entry.path)).toEqual(['/repos/a', '/repos/c']);
    expect(withoutContainer.map((entry) => entry.path)).toEqual(['/repos/lib']);
  });

  it('keeps rows with unknown or failed presence (absent) and known-with-container (false) selectable', () => {
    const services = [row('/repos/a'), row('/repos/b')];
    const { selectable, withoutContainer } = splitNoContainerRows(services, { '/repos/a': false });

    expect(selectable.map((entry) => entry.path)).toEqual(['/repos/a', '/repos/b']);
    expect(withoutContainer).toEqual([]);
  });

  it('returns everything selectable against an empty presence map (first render, loads in flight)', () => {
    const services = [row('/repos/a')];
    const { selectable, withoutContainer } = splitNoContainerRows(services, {});

    expect(selectable).toEqual(services);
    expect(withoutContainer).toEqual([]);
  });
});

describe('cycleLogsPaneFocus back', () => {
  it('reverses, wrapping first to last', () => {
    expect(cycleLogsPaneFocus('edt-list', 'back')).toBe('panes');
    expect(cycleLogsPaneFocus('panes', 'back')).toBe('other-list');
  });
});

describe('cycleLogsPaneFocus', () => {
  it('cycles edt-list -> other-list -> panes -> edt-list', () => {
    expect(cycleLogsPaneFocus('edt-list')).toBe('other-list');
    expect(cycleLogsPaneFocus('other-list')).toBe('panes');
    expect(cycleLogsPaneFocus('panes')).toBe('edt-list');
  });

  it('never yields an info-only focus — the without-container section is skipped by construction', () => {
    const foci = new Set([cycleLogsPaneFocus('edt-list'), cycleLogsPaneFocus('other-list'), cycleLogsPaneFocus('panes')]);
    expect(foci).toEqual(new Set(['other-list', 'panes', 'edt-list']));
  });
});

describe('computeGridLayout', () => {
  it('returns a 0x0 layout for zero panes', () => {
    expect(computeGridLayout(0, 100, 40)).toEqual({ rows: 0, cols: 0, cellWidth: 0, cellHeight: 0 });
  });

  it('picks a 1x1 grid for a single pane', () => {
    expect(computeGridLayout(1, 100, 40)).toEqual({ rows: 1, cols: 1, cellWidth: 100, cellHeight: 40 });
  });

  it('picks the squarest grid — ceil(sqrt(n)) columns', () => {
    // 2 panes -> ceil(sqrt(2)) = 2 cols, ceil(2/2) = 1 row
    expect(computeGridLayout(2, 100, 40)).toMatchObject({ cols: 2, rows: 1 });
    // 3 panes -> ceil(sqrt(3)) = 2 cols, ceil(3/2) = 2 rows
    expect(computeGridLayout(3, 100, 40)).toMatchObject({ cols: 2, rows: 2 });
    // 4 panes -> 2x2
    expect(computeGridLayout(4, 100, 40)).toMatchObject({ cols: 2, rows: 2 });
    // 5 panes -> ceil(sqrt(5)) = 3 cols, ceil(5/3) = 2 rows
    expect(computeGridLayout(5, 100, 40)).toMatchObject({ cols: 3, rows: 2 });
  });

  it('divides available width/height evenly across cols/rows, flooring to a whole cell', () => {
    const layout = computeGridLayout(4, 101, 41);
    expect(layout).toEqual({ rows: 2, cols: 2, cellWidth: 50, cellHeight: 20 });
  });

  it('never returns a cell smaller than 1, even for a pathological non-positive width/height', () => {
    expect(computeGridLayout(4, 0, 0)).toEqual({ rows: 2, cols: 2, cellWidth: 1, cellHeight: 1 });
    expect(computeGridLayout(4, -10, -10)).toEqual({ rows: 2, cols: 2, cellWidth: 1, cellHeight: 1 });
  });
});

describe('movePaneSubFocus', () => {
  // A 2x2 grid: [0 1]
  //             [2 3]
  it('moves right/left/up/down within a full grid', () => {
    expect(movePaneSubFocus(0, 'right', 2, 4)).toBe(1);
    expect(movePaneSubFocus(1, 'down', 2, 4)).toBe(3);
    expect(movePaneSubFocus(3, 'left', 2, 4)).toBe(2);
    expect(movePaneSubFocus(2, 'up', 2, 4)).toBe(0);
  });

  it('clamps at every edge — never wraps', () => {
    expect(movePaneSubFocus(0, 'left', 2, 4)).toBe(0);
    expect(movePaneSubFocus(0, 'up', 2, 4)).toBe(0);
    expect(movePaneSubFocus(1, 'right', 2, 4)).toBe(1);
    expect(movePaneSubFocus(3, 'down', 2, 4)).toBe(3);
  });

  it('clamps onto the last real pane on a short trailing grid row (3 panes in a 2-col grid)', () => {
    // Grid: [0 1]
    //       [2  ] (row 1 only has index 2)
    expect(movePaneSubFocus(0, 'down', 2, 3)).toBe(2);
    // Moving right from index 2 (only pane on its row) has nowhere real to land at col 1.
    expect(movePaneSubFocus(2, 'right', 2, 3)).toBe(2);
  });

  it('returns 0 for zero panes', () => {
    expect(movePaneSubFocus(0, 'right', 2, 0)).toBe(0);
  });
});

describe('reindexPaneSubFocus', () => {
  it('keeps the same index when it is still in range', () => {
    expect(reindexPaneSubFocus(1, 3)).toBe(1);
  });

  it('clamps down to the new last pane when the old index is now out of range', () => {
    expect(reindexPaneSubFocus(2, 1)).toBe(0);
    expect(reindexPaneSubFocus(5, 3)).toBe(2);
  });

  it('returns 0 when every pane is gone', () => {
    expect(reindexPaneSubFocus(2, 0)).toBe(0);
  });
});

describe('adjustScrollOffset / isAtOldestLine', () => {
  it('scrolling up increases the offset, capped at lineCount - 1', () => {
    expect(adjustScrollOffset(0, 'up', 5)).toBe(1);
    expect(adjustScrollOffset(4, 'up', 5)).toBe(4);
  });

  it('scrolling down decreases the offset, floored at 0', () => {
    expect(adjustScrollOffset(2, 'down', 5)).toBe(1);
    expect(adjustScrollOffset(0, 'down', 5)).toBe(0);
  });

  it('returns 0 for an empty buffer', () => {
    expect(adjustScrollOffset(3, 'up', 0)).toBe(0);
  });

  it('isAtOldestLine is true once the offset reaches lineCount - 1', () => {
    expect(isAtOldestLine(4, 5)).toBe(true);
    expect(isAtOldestLine(3, 5)).toBe(false);
  });

  it('isAtOldestLine is true for a genuinely empty pane too — its normal starting state, and the case that must still trigger the first scrollback fetch', () => {
    expect(isAtOldestLine(0, 0)).toBe(true);
  });
});

describe('resolvePostLoadScrollOffset', () => {
  it('preserves the visible viewport when the pane already had lines before the fetch', () => {
    // 3 lines were on screen (offset 2 into a 3-line buffer); 4 older lines get prepended —
    // offset must grow by exactly the prepended count so the same lines stay in view.
    expect(resolvePostLoadScrollOffset(2, 3, 4, 7)).toBe(6);
  });

  it('falls back to the buffer-length delta when appended undercounts a live line that arrived mid-fetch', () => {
    expect(resolvePostLoadScrollOffset(1, 2, 1, 5)).toBe(4);
  });

  it('pins to 0 (the newest fetched line) when the pane started genuinely empty, instead of overshooting past every line just loaded', () => {
    expect(resolvePostLoadScrollOffset(0, 0, 4, 4)).toBe(0);
  });
});

describe('resolvePaneScrollDirection', () => {
  it('requires ctrl — plain arrows are not a pane scroll (the grid view: bare arrows already move sub-focus between panes)', () => {
    expect(resolvePaneScrollDirection({ upArrow: true })).toBeNull();
    expect(resolvePaneScrollDirection({ ctrl: true, upArrow: true })).toBe('up');
    expect(resolvePaneScrollDirection({ ctrl: true, downArrow: true })).toBe('down');
  });

  it('returns null for ctrl + a non-arrow key', () => {
    expect(resolvePaneScrollDirection({ ctrl: true })).toBeNull();
  });
});

describe('resolveFullscreenScrollDirection', () => {
  it('accepts a bare arrow — fullscreen has no sub-focus grid to disambiguate from', () => {
    expect(resolveFullscreenScrollDirection({ upArrow: true })).toBe('up');
    expect(resolveFullscreenScrollDirection({ downArrow: true })).toBe('down');
  });

  it('also accepts Ctrl+arrow, so existing muscle memory keeps working', () => {
    expect(resolveFullscreenScrollDirection({ upArrow: true, ctrl: true })).toBe('up');
  });

  it('returns null for a non-arrow key', () => {
    expect(resolveFullscreenScrollDirection({})).toBeNull();
  });
});

describe('isSelectAllKey', () => {
  it('is true for Ctrl+A, case-insensitively', () => {
    expect(isSelectAllKey('a', { ctrl: true })).toBe(true);
    expect(isSelectAllKey('A', { ctrl: true })).toBe(true);
  });

  it('is false without ctrl, or for a different letter', () => {
    expect(isSelectAllKey('a', {})).toBe(false);
    expect(isSelectAllKey('b', { ctrl: true })).toBe(false);
  });
});

describe('resolveSelectAllToggle', () => {
  // Ctrl+letter combos never carry shift information at the byte level, so one shortcut does
  // both select-all and deselect-all, based on the current selection.
  it('resolves to select-all when not everything is currently selected', () => {
    expect(resolveSelectAllToggle(['/a', '/b'], [])).toBe('select-all');
    expect(resolveSelectAllToggle(['/a', '/b'], ['/a'])).toBe('select-all');
  });

  it('resolves to deselect-all once every listed path is already selected', () => {
    expect(resolveSelectAllToggle(['/a', '/b'], ['/a', '/b'])).toBe('deselect-all');
    // Extra, unrelated selections elsewhere don't prevent this — only the listed paths matter.
    expect(resolveSelectAllToggle(['/a', '/b'], ['/a', '/b', '/c'])).toBe('deselect-all');
  });

  it('resolves to select-all (a harmless no-op) for an empty list', () => {
    expect(resolveSelectAllToggle([], [])).toBe('select-all');
  });
});

describe('resolveVisibilityToggleKey / toggleVisibilityFlag', () => {
  it('maps t/o/p to their own toggle, and anything else (including the old "e" binding and "w", now per-pane) to null', () => {
    expect(resolveVisibilityToggleKey('t')).toBe('timestamp');
    expect(resolveVisibilityToggleKey('o')).toBe('stdout');
    expect(resolveVisibilityToggleKey('p')).toBe('stderr');
    // 'e' is not bound — it would collide with the EDTs zone's tab mnemonic.
    expect(resolveVisibilityToggleKey('e')).toBeNull();
    // 'w' is per-pane wrap state (togglePaneWrapFlag), not a shared flag.
    expect(resolveVisibilityToggleKey('w')).toBeNull();
    expect(resolveVisibilityToggleKey('x')).toBeNull();
  });

  it('toggles only the targeted flag, independently of the others', () => {
    const flipped = toggleVisibilityFlag(DEFAULT_VISIBILITY_FLAGS, 'stdout');
    expect(flipped).toEqual({ showTimestamps: true, showStdout: false, showStderr: true });

    const flippedAgain = toggleVisibilityFlag(flipped, 'stdout');
    expect(flippedAgain).toEqual(DEFAULT_VISIBILITY_FLAGS);
  });
});

describe('filterVisibleLines', () => {
  const lines: LogLine[] = [
    { timestamp: 't1', stream: 'stdout', text: 'out' },
    { timestamp: 't2', stream: 'stderr', text: 'err' },
  ];

  it('drops stdout lines when showStdout is false', () => {
    expect(filterVisibleLines(lines, { showTimestamps: true, showStdout: false, showStderr: true })).toEqual([lines[1]]);
  });

  it('drops stderr lines when showStderr is false', () => {
    expect(filterVisibleLines(lines, { showTimestamps: true, showStdout: true, showStderr: false })).toEqual([lines[0]]);
  });

  it('keeps everything when both are shown', () => {
    expect(filterVisibleLines(lines, DEFAULT_VISIBILITY_FLAGS)).toEqual(lines);
  });
});

describe('isClearAllLogsKey / isWrapAllLogsKey', () => {
  it('is true for Ctrl+C (case-insensitively) and for Shift+W', () => {
    expect(isClearAllLogsKey('c', { ctrl: true })).toBe(true);
    expect(isClearAllLogsKey('C', { ctrl: true })).toBe(true);
    expect(isWrapAllLogsKey('W', {})).toBe(true);
  });

  it('is false for the wrong modifier or a different letter; Ctrl+W is never wrap-all', () => {
    expect(isClearAllLogsKey('c', {})).toBe(false);
    expect(isClearAllLogsKey('w', { ctrl: true })).toBe(false);
    expect(isWrapAllLogsKey('w', {})).toBe(false);
    expect(isWrapAllLogsKey('w', { ctrl: true })).toBe(false);
    expect(isWrapAllLogsKey('W', { ctrl: true })).toBe(false);
    expect(isWrapAllLogsKey('c', { ctrl: true })).toBe(false);
  });
});

describe('isPaneWrapped / togglePaneWrapFlag / toggleAllPanesWrapFlag', () => {
  it('defaults an untouched pane (or a null repoPath) to DEFAULT_PANE_WRAP (truncate)', () => {
    expect(DEFAULT_PANE_WRAP).toBe(false);
    expect(isPaneWrapped({}, '/repo/a')).toBe(false);
    expect(isPaneWrapped({}, null)).toBe(false);
  });

  it('togglePaneWrapFlag flips only the targeted repoPath', () => {
    const flipped = togglePaneWrapFlag({}, '/repo/a');
    expect(flipped).toEqual({ '/repo/a': true });
    expect(isPaneWrapped(flipped, '/repo/b')).toBe(false);

    const flippedBack = togglePaneWrapFlag(flipped, '/repo/a');
    expect(flippedBack).toEqual({ '/repo/a': false });
  });

  it('toggleAllPanesWrapFlag flips every given repoPath independently of its current state', () => {
    const current = { '/repo/a': true, '/repo/b': false };
    const next = toggleAllPanesWrapFlag(current, ['/repo/a', '/repo/b', '/repo/c']);
    expect(next).toEqual({ '/repo/a': false, '/repo/b': true, '/repo/c': true });
  });
});

describe('formatLogLine', () => {
  it('prefixes the timestamp when showTimestamps is true, omits it otherwise', () => {
    const line: LogLine = { timestamp: '2026-01-01T00:00:00.000Z', stream: 'stdout', text: 'hello' };
    expect(formatLogLine(line, true)).toBe('[2026-01-01T00:00:00.000Z] hello');
    expect(formatLogLine(line, false)).toBe('hello');
  });
});

describe('sliceVisibleWindow', () => {
  const values = [1, 2, 3, 4, 5];

  it('returns the last visibleCount values when offset is 0 (pinned to the tail)', () => {
    expect(sliceVisibleWindow(values, 0, 2)).toEqual([4, 5]);
  });

  it('shifts the window back by offset lines', () => {
    expect(sliceVisibleWindow(values, 2, 2)).toEqual([2, 3]);
  });

  it('never returns fewer than what is available at the buffer start', () => {
    expect(sliceVisibleWindow(values, 4, 3)).toEqual([1]);
  });

  it('returns an empty array for an empty buffer or a non-positive visibleCount', () => {
    expect(sliceVisibleWindow([], 0, 5)).toEqual([]);
    expect(sliceVisibleWindow(values, 0, 0)).toEqual([]);
  });

  it('packs more short (1-row) lines into the same row budget than long (multi-row) ones — the fix for "w" leaving a blank gap', () => {
    // 5 short lines, each costing 1 row: a 4-row budget fits 4 of them.
    const shortRowCost = () => 1;
    expect(sliceVisibleWindow(values, 0, 4, shortRowCost)).toEqual([2, 3, 4, 5]);

    // Same 5 lines, but each now costs 2 rows (e.g. wrapped): the same 4-row budget only fits 2.
    const longRowCost = () => 2;
    expect(sliceVisibleWindow(values, 0, 4, longRowCost)).toEqual([4, 5]);
  });

  it('still renders the single oldest line even when its own row cost alone exceeds the budget', () => {
    expect(sliceVisibleWindow(values, 0, 1, () => 5)).toEqual([5]);
  });
});

describe('computeLineRowCount', () => {
  it('always costs exactly 1 row when wrap is off, regardless of length', () => {
    expect(computeLineRowCount('a'.repeat(200), 40, false)).toBe(1);
    expect(computeLineRowCount('', 40, false)).toBe(1);
  });

  it('costs ceil(length / width) rows when wrap is on', () => {
    expect(computeLineRowCount('a'.repeat(80), 40, true)).toBe(2);
    expect(computeLineRowCount('a'.repeat(81), 40, true)).toBe(3);
    expect(computeLineRowCount('short', 40, true)).toBe(1);
  });

  it('floors at 1 row even for an empty line under wrap', () => {
    expect(computeLineRowCount('', 40, true)).toBe(1);
  });

  // computeLineRowCount must be ANSI-aware: an escape sequence's bytes are invisible on screen,
  // and counting them would make sliceVisibleWindow stop short of the pane's real budget,
  // leaving a blank gap in wrap mode. It delegates to wrap-ansi (the library and options Ink's
  // own Text uses for wrap="wrap"), so the cost matches what Ink renders.
  it('does not let ANSI colour escapes inflate the row cost beyond the visible text', () => {
    const plain = 'word0 word1 word2 word3 word4 word5 word6 word7';
    const colored = plain
      .split(' ')
      .map((word, index) => `\x1b[3${(index % 7) + 1}m${word}\x1b[0m`)
      .join(' ');
    expect(computeLineRowCount(colored, 40, true)).toBe(computeLineRowCount(plain, 40, true));
  });

  it('costs more rows than a naive length/width division for word-wrapped (space-separated) text', () => {
    // Word-wrap can't split mid-word, so it trades some trailing whitespace per row for never
    // breaking a word — costing a bit more than the naive division a truncated/hard-wrapped
    // single token would (covered by the 'a'.repeat cases above).
    const text = Array.from({ length: 20 }, (_, i) => `word${i}`).join(' ');
    const naiveEstimate = Math.ceil(text.length / 10);
    expect(computeLineRowCount(text, 10, true)).toBeGreaterThan(naiveEstimate);
  });
});

// The two-tier text/regex/level filter over already-buffered lines.
describe('detectLogLevel', () => {
  it('matches ERROR/WARN/INFO/DEBUG case-insensitively', () => {
    expect(detectLogLevel('2026-01-01 ERROR something broke')).toBe('ERROR');
    expect(detectLogLevel('warn: retrying')).toBe('WARN');
    expect(detectLogLevel('[INFO] starting up')).toBe('INFO');
    expect(detectLogLevel('Debug values here')).toBe('DEBUG');
  });

  it('returns null when no level token is present', () => {
    expect(detectLogLevel('plain line with no level tag')).toBeNull();
  });

  it('does not match a level substring embedded inside a larger word', () => {
    expect(detectLogLevel('errorprone module loaded')).toBeNull();
  });
});

describe('compileLogFilter', () => {
  const line = (text: string): LogLine => ({ timestamp: 't', stream: 'stdout', text });

  it('text mode: case-insensitive substring match; an empty query passes everything', () => {
    const compiled = compileLogFilter({ mode: 'text', query: 'boom', level: null });
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      expect(compiled.test(line('a BOOM happened'))).toBe(true);
      expect(compiled.test(line('all quiet'))).toBe(false);
    }
    const emptyQuery = compileLogFilter(DEFAULT_LOG_FILTER);
    expect(emptyQuery.ok).toBe(true);
    if (emptyQuery.ok) {
      expect(emptyQuery.test(line('anything'))).toBe(true);
    }
  });

  it('regex mode: compiles and matches a valid pattern', () => {
    const compiled = compileLogFilter({ mode: 'regex', query: '^\\d+ms$', level: null });
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      expect(compiled.test(line('120ms'))).toBe(true);
      expect(compiled.test(line('120 ms'))).toBe(false);
    }
  });

  it('regex mode: an invalid pattern fails to compile with an inline error, never throws', () => {
    expect(() => compileLogFilter({ mode: 'regex', query: '(unterminated', level: null })).not.toThrow();
    const compiled = compileLogFilter({ mode: 'regex', query: '(unterminated', level: null });
    expect(compiled.ok).toBe(false);
    if (!compiled.ok) {
      expect(compiled.error.length).toBeGreaterThan(0);
    }
  });

  it('level restriction: a line with no detectable level is excluded once any level restriction is active', () => {
    const compiled = compileLogFilter({ mode: 'text', query: '', level: 'ERROR' });
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      expect(compiled.test(line('ERROR disk full'))).toBe(true);
      expect(compiled.test(line('WARN low disk'))).toBe(false);
      expect(compiled.test(line('no level tag at all'))).toBe(false);
    }
  });

  it('combines text and level restrictions with AND', () => {
    const compiled = compileLogFilter({ mode: 'text', query: 'disk', level: 'ERROR' });
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      expect(compiled.test(line('ERROR disk full'))).toBe(true);
      expect(compiled.test(line('ERROR network down'))).toBe(false);
      expect(compiled.test(line('WARN disk almost full'))).toBe(false);
    }
  });
});

describe('applyLogFilters', () => {
  const lines: LogLine[] = [
    { timestamp: 't1', stream: 'stdout', text: 'ERROR disk full' },
    { timestamp: 't2', stream: 'stdout', text: 'INFO all fine' },
    { timestamp: 't3', stream: 'stderr', text: 'WARN disk almost full' },
  ];

  it('passes everything when both global and own are null', () => {
    expect(applyLogFilters(lines, null, null)).toEqual(lines);
  });

  it('a disengaged pane (global passed as null) ignores the global filter entirely', () => {
    const global: LogFilterSpec = { mode: 'text', query: 'disk', level: null };
    // Engaged: only "disk" lines survive.
    expect(applyLogFilters(lines, global, null)).toEqual([lines[0], lines[2]]);
    // Disengaged (caller passes null in global's place): every line survives regardless.
    expect(applyLogFilters(lines, null, null)).toEqual(lines);
  });

  it('a global text filter and an own level filter both apply — a line must satisfy both', () => {
    const global: LogFilterSpec = { mode: 'text', query: 'disk', level: null };
    const own: LogFilterSpec = { mode: 'text', query: '', level: 'ERROR' };
    expect(applyLogFilters(lines, global, own)).toEqual([lines[0]]);
  });

  it('an own filter alone (no global) still applies', () => {
    const own: LogFilterSpec = { mode: 'text', query: '', level: 'WARN' };
    expect(applyLogFilters(lines, null, own)).toEqual([lines[2]]);
  });
});

describe('isPaneEngagedInGlobalFilter / toggleGlobalFilterEngagement / setPaneGlobalFilterEngagement', () => {
  it('defaults an untouched pane (or a null repoPath) to engaged', () => {
    expect(DEFAULT_PANE_GLOBAL_FILTER_ENGAGED).toBe(true);
    expect(isPaneEngagedInGlobalFilter({}, '/repo/a')).toBe(true);
    expect(isPaneEngagedInGlobalFilter({}, null)).toBe(true);
  });

  it('toggleGlobalFilterEngagement flips only the targeted repoPath', () => {
    const disengaged = toggleGlobalFilterEngagement({}, '/repo/a');
    expect(disengaged).toEqual({ '/repo/a': false });
    expect(isPaneEngagedInGlobalFilter(disengaged, '/repo/b')).toBe(true);

    const reengaged = toggleGlobalFilterEngagement(disengaged, '/repo/a');
    expect(reengaged).toEqual({ '/repo/a': true });
  });

  it('setPaneGlobalFilterEngagement sets an explicit value rather than toggling — a repeated disengage stays a no-op', () => {
    const once = setPaneGlobalFilterEngagement({}, '/repo/a', false);
    expect(once).toEqual({ '/repo/a': false });
    const again = setPaneGlobalFilterEngagement(once, '/repo/a', false);
    expect(again).toEqual({ '/repo/a': false });
  });
});

describe('setPaneLogFilter', () => {
  it('sets a spec for the targeted repoPath, independent of others', () => {
    const spec: LogFilterSpec = { mode: 'text', query: 'x', level: null };
    const next = setPaneLogFilter({}, '/repo/a', spec);
    expect(next).toEqual({ '/repo/a': spec });
  });

  it('clears (removes the key) when given null', () => {
    const spec: LogFilterSpec = { mode: 'text', query: 'x', level: null };
    const withFilter = setPaneLogFilter({}, '/repo/a', spec);
    const cleared = setPaneLogFilter(withFilter, '/repo/a', null);
    expect(cleared).toEqual({});
    expect(Object.prototype.hasOwnProperty.call(cleared, '/repo/a')).toBe(false);
  });
});

describe('cycleFilterLevel / toggleFilterMode', () => {
  it('cycles null -> ERROR -> WARN -> INFO -> DEBUG -> null going forward', () => {
    let level: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | null = null;
    const seen: ('ERROR' | 'WARN' | 'INFO' | 'DEBUG' | null)[] = [level];
    for (let i = 0; i < 4; i += 1) {
      level = cycleFilterLevel(level, 'next');
      seen.push(level);
    }
    expect(seen).toEqual([null, 'ERROR', 'WARN', 'INFO', 'DEBUG']);
    expect(cycleFilterLevel(level, 'next')).toBeNull();
  });

  it('cycles backward with "previous"', () => {
    expect(cycleFilterLevel(null, 'previous')).toBe('DEBUG');
    expect(cycleFilterLevel('ERROR', 'previous')).toBeNull();
  });

  it('toggleFilterMode flips text <-> regex', () => {
    expect(toggleFilterMode('text')).toBe('regex');
    expect(toggleFilterMode('regex')).toBe('text');
  });
});

describe('formatLogFilterSpec', () => {
  it('renders mode, a quoted query, and no level suffix by default', () => {
    expect(formatLogFilterSpec({ mode: 'text', query: 'boom', level: null })).toBe('text "boom"');
    expect(formatLogFilterSpec({ mode: 'regex', query: '^ERR', level: null })).toBe('regex "^ERR"');
  });

  it('renders an empty query as "(any)"', () => {
    expect(formatLogFilterSpec({ mode: 'text', query: '', level: null })).toBe('text (any)');
  });

  it('appends the level restriction, when set, as a trailing bracketed suffix', () => {
    expect(formatLogFilterSpec({ mode: 'text', query: 'boom', level: 'ERROR' })).toBe('text "boom" [ERROR]');
    expect(formatLogFilterSpec({ mode: 'text', query: '', level: 'WARN' })).toBe('text (any) [WARN]');
  });
});

describe('resolveFilterClearTarget', () => {
  // Esc, pane sub-focused, own filter set -> that pane's own filter clears; engagement/global
  // unaffected.
  it('targets the pane\'s own filter when sub-focused with an own filter set', () => {
    expect(resolveFilterClearTarget(true, '/repo/a', true)).toEqual({ scope: 'pane-own', repoPath: '/repo/a' });
  });

  it('targets pane-disengage when sub-focused with no own filter set', () => {
    expect(resolveFilterClearTarget(true, '/repo/a', false)).toEqual({ scope: 'pane-disengage', repoPath: '/repo/a' });
  });

  // Esc, list-focused, global filter active -> the global filter clears; disengaged panes stay
  // disengaged.
  it('targets global when not sub-focused (list-focus), regardless of any own filter', () => {
    expect(resolveFilterClearTarget(false, '/repo/a', true)).toEqual({ scope: 'global' });
    expect(resolveFilterClearTarget(false, null, false)).toEqual({ scope: 'global' });
  });

  it('targets global when sub-focused but no real pane is under it (repoPath null)', () => {
    expect(resolveFilterClearTarget(true, null, false)).toEqual({ scope: 'global' });
  });
});

// Filter history recall.
describe('filterHistoryKeyString', () => {
  it('encodes a global scope as "global:<mode>", ignoring repoPath', () => {
    expect(filterHistoryKeyString({ scope: 'global', repoPath: null, mode: 'text' })).toBe('global:text');
    expect(filterHistoryKeyString({ scope: 'global', repoPath: '/repos/a', mode: 'regex' })).toBe('global:regex');
  });

  it('encodes a pane scope as "service:<repoPath>:<mode>"', () => {
    const key: FilterHistoryKey = { scope: 'pane', repoPath: '/repos/api-gateway', mode: 'text' };
    expect(filterHistoryKeyString(key)).toBe('service:/repos/api-gateway:text');
  });

  it('gives global-text/global-regex and per-service-text/per-service-regex four distinct keys', () => {
    const keys = [
      filterHistoryKeyString({ scope: 'global', repoPath: null, mode: 'text' }),
      filterHistoryKeyString({ scope: 'global', repoPath: null, mode: 'regex' }),
      filterHistoryKeyString({ scope: 'pane', repoPath: '/repos/a', mode: 'text' }),
      filterHistoryKeyString({ scope: 'pane', repoPath: '/repos/a', mode: 'regex' }),
    ];
    expect(new Set(keys).size).toBe(4);
  });
});

describe('pushFilterHistoryEntry', () => {
  it('front-pushes a new query onto an empty list', () => {
    expect(pushFilterHistoryEntry([], 'boom', 20)).toEqual(['boom']);
  });

  it('front-pushes a new query ahead of existing entries', () => {
    expect(pushFilterHistoryEntry(['old'], 'new', 20)).toEqual(['new', 'old']);
  });

  it('moves an identical-to-top entry to the front without duplicating it', () => {
    expect(pushFilterHistoryEntry(['boom', 'other'], 'boom', 20)).toEqual(['boom', 'other']);
  });

  it('does not dedup an entry that matches a non-top entry (only the current top is special-cased)', () => {
    expect(pushFilterHistoryEntry(['other', 'boom'], 'boom', 20)).toEqual(['boom', 'other', 'boom']);
  });

  it('with dedupEverywhere, moves a non-top repeat to the front keeping a single instance', () => {
    expect(pushFilterHistoryEntry(['other', 'boom'], 'boom', 20, true)).toEqual(['boom', 'other']);
  });

  it('with dedupEverywhere, a top repeat stays a single instance', () => {
    expect(pushFilterHistoryEntry(['boom', 'other'], 'boom', 20, true)).toEqual(['boom', 'other']);
  });

  it('with dedupEverywhere, removes every duplicate before front-pushing and trims', () => {
    expect(pushFilterHistoryEntry(['a', 'b', 'a', 'c'], 'a', 3, true)).toEqual(['a', 'b', 'c']);
  });

  it('trims to maxSize, dropping the oldest entries', () => {
    expect(pushFilterHistoryEntry(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b']);
  });

  it('never produces a negative-length slice for a degenerate maxSize', () => {
    expect(pushFilterHistoryEntry(['a'], 'b', 0)).toEqual([]);
  });
});

describe('resolveHistoryBrowseUp', () => {
  it('recalls the most-recent entry on an untouched draft, preserving the draft', () => {
    const result = resolveHistoryBrowseUp('my-draft', null, ['newest', 'older', 'oldest']);
    expect(result).toEqual({ query: 'newest', browsing: { index: 0, savedDraft: 'my-draft' } });
  });

  it('walks to older entries on further ↑ presses', () => {
    const first = resolveHistoryBrowseUp('draft', null, ['newest', 'older', 'oldest']);
    const second = resolveHistoryBrowseUp(first.query, first.browsing, ['newest', 'older', 'oldest']);
    expect(second).toEqual({ query: 'older', browsing: { index: 1, savedDraft: 'draft' } });
  });

  it('is a no-op once already at the oldest entry', () => {
    const browsing = { index: 2, savedDraft: 'draft' };
    const result = resolveHistoryBrowseUp('oldest', browsing, ['newest', 'older', 'oldest']);
    expect(result).toEqual({ query: 'oldest', browsing });
  });

  it('is a no-op against an empty history', () => {
    expect(resolveHistoryBrowseUp('draft', null, [])).toEqual({ query: 'draft', browsing: null });
  });

  it('skips the most-recent entry when it equals the pre-filled draft (active filter), showing older values first', () => {
    const result = resolveHistoryBrowseUp('active', null, ['active', 'older', 'oldest']);
    expect(result).toEqual({ query: 'older', browsing: { index: 1, savedDraft: 'active' } });
  });

  it('is a no-op when the whole history equals the draft', () => {
    expect(resolveHistoryBrowseUp('only', null, ['only'])).toEqual({ query: 'only', browsing: null });
  });

  it('skips entries equal to the saved draft while walking older', () => {
    const first = resolveHistoryBrowseUp('draft', null, ['newest', 'draft', 'oldest']);
    expect(first).toEqual({ query: 'newest', browsing: { index: 0, savedDraft: 'draft' } });
    const second = resolveHistoryBrowseUp(first.query, first.browsing, ['newest', 'draft', 'oldest']);
    expect(second).toEqual({ query: 'oldest', browsing: { index: 2, savedDraft: 'draft' } });
  });
});

describe('resolveHistoryBrowseDown', () => {
  it('walks back toward the draft one entry at a time', () => {
    const browsing = { index: 1, savedDraft: 'draft' };
    const result = resolveHistoryBrowseDown(browsing, ['newest', 'older', 'oldest']);
    expect(result).toEqual({ query: 'newest', browsing: { index: 0, savedDraft: 'draft' } });
  });

  it('restores the original draft exactly one ↓ past the most-recent entry, ending browsing', () => {
    const browsing = { index: 0, savedDraft: 'my-original-draft' };
    const result = resolveHistoryBrowseDown(browsing, ['newest', 'older']);
    expect(result).toEqual({ query: 'my-original-draft', browsing: null });
  });

  it('skips the most-recent entry on the way down when it equals the saved draft', () => {
    const browsing = { index: 1, savedDraft: 'active' };
    const result = resolveHistoryBrowseDown(browsing, ['active', 'older']);
    expect(result).toEqual({ query: 'active', browsing: null });
  });
});

describe('computeLogsLayout list ratio', () => {
  const base = {
    windowColumns: 120,
    windowRows: 40,
    activePaneCount: 1,
    edtServiceCount: 0,
    otherServiceCount: 0,
    filterEditorOpen: false,
    historyGridOpen: false,
    filterHistoryGridMaxRows: 8,
  };

  it('gives the grid less width as the list ratio grows, and the columns always fit the window', () => {
    const narrowList = computeLogsLayout({ ...base, listRatio: 0.15 });
    const wideList = computeLogsLayout({ ...base, listRatio: 0.5 });
    expect(wideList.layout.cellWidth).toBeLessThan(narrowList.layout.cellWidth);
    for (const [ratio, result] of [[0.15, narrowList], [0.5, wideList]] as const) {
      const listColumns = Math.floor((base.windowColumns - 1) * ratio);
      expect(listColumns + 1 + result.layout.cellWidth * result.layout.cols).toBeLessThanOrEqual(base.windowColumns);
    }
  });
});
