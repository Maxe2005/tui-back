// tui/shared/command-bar: unit coverage for the pure key-handling functions behind the command
// bar's text entry, Tab-autocomplete and double-Tab grid browser (renderToString's fake stdin
// never emits data, so useInput itself is never exercised here). Real-keypress coverage of the
// bar mounted inside AppShell lives in app-shell.interaction.test.tsx.
import { describe, it, expect } from 'vitest';
import { createAppStore } from '../store/app-store.js';
import { footerContextOf, mountForTest } from './test-support/mount-for-test.js';
import type { Command } from '../commands/commands.js';
import {
  CommandBar,
  backspaceCommandQuery,
  commandAtGridCursor,
  groupCommandsByColumn,
  layoutCommandGrid,
  longestCommonPrefix,
  moveGridCursorHorizontal,
  moveGridCursorVertical,
  resolveGridHorizontalDirection,
  resolveGridVerticalDirection,
  resolveTabAutocomplete,
  resolveTabPress,
  runCommand,
  TAB_DOUBLE_PRESS_WINDOW_MS,
  typeCommandQueryChar,
} from './command-bar.js';

describe('typeCommandQueryChar', () => {
  it('appends a printable character', () => {
    expect(typeCommandQueryChar('reg', 'i', { ctrl: false, meta: false })).toBe('regi');
  });

  it('ignores empty-input control keys', () => {
    expect(typeCommandQueryChar('reg', '', { ctrl: false, meta: false })).toBe('reg');
  });

  it('ignores Ctrl/Meta combos', () => {
    expect(typeCommandQueryChar('reg', 'w', { ctrl: true, meta: false })).toBe('reg');
    expect(typeCommandQueryChar('reg', 'w', { ctrl: false, meta: true })).toBe('reg');
  });
});

describe('backspaceCommandQuery', () => {
  it('drops the last character', () => {
    expect(backspaceCommandQuery('reg')).toBe('re');
  });

  it('is a no-op on an empty query', () => {
    expect(backspaceCommandQuery('')).toBe('');
  });
});

const registry: Command = { name: 'registry', run: () => {} };
const reload: Command = { name: 'reload', run: () => {} };
const edtCreate: Command = { name: 'edt-create', run: () => {} };
const edtSwitch: Command = { name: 'edt-switch', run: () => {} };
const edtModify: Command = { name: 'edt-modify', run: () => {} };

describe('resolveTabAutocomplete (single/ambiguous/none)', () => {
  it("completes the query to the single match's full name", () => {
    expect(resolveTabAutocomplete('reg', [registry])).toBe('registry');
  });

  it('leaves the query unchanged on zero matches', () => {
    expect(resolveTabAutocomplete('zzz', [])).toBe('zzz');
  });

  it('leaves the query unchanged on an ambiguous 2+ match — never guesses', () => {
    expect(resolveTabAutocomplete('re', [registry, reload])).toBe('re');
  });
});

describe('longestCommonPrefix', () => {
  it('returns "" for zero matches', () => {
    expect(longestCommonPrefix([])).toBe('');
  });

  it('returns the single match\'s own name', () => {
    expect(longestCommonPrefix([registry])).toBe('registry');
  });

  it('finds the shared prefix across several matches', () => {
    expect(longestCommonPrefix([edtCreate, edtSwitch, edtModify])).toBe('edt-');
  });

  it('returns "" when matches share nothing', () => {
    expect(longestCommonPrefix([registry, reload].concat(edtCreate))).toBe('');
  });
});

describe('resolveTabPress (Tab at maximal prefix, 1st/2nd press, elapse/interrupt/change)', () => {
  it('delegates to resolveTabAutocomplete on a single match', () => {
    const result = resolveTabPress('reg', [registry], null, 1000);
    expect(result).toEqual({ kind: 'complete', value: 'registry' });
  });

  it('is a no-op on zero matches', () => {
    const result = resolveTabPress('zzz', [], null, 1000);
    expect(result).toEqual({ kind: 'noop' });
  });

  it('completes to the longer shared prefix when 2+ matches have one', () => {
    const result = resolveTabPress('e', [edtCreate, edtSwitch, edtModify], null, 1000);
    expect(result).toEqual({ kind: 'complete', value: 'edt-' });
  });

  it('arms a pending TabPressState on the first press at the maximal prefix (no visible change)', () => {
    const result = resolveTabPress('edt-', [edtCreate, edtSwitch, edtModify], null, 1000);
    expect(result).toEqual({ kind: 'pending', state: { query: 'edt-', at: 1000 } });
  });

  it('shows the grid on a second press, same query, within the window', () => {
    const pending = { query: 'edt-', at: 1000 };
    const result = resolveTabPress(
      'edt-',
      [edtCreate, edtSwitch, edtModify],
      pending,
      1000 + TAB_DOUBLE_PRESS_WINDOW_MS,
    );
    expect(result).toEqual({ kind: 'show-grid' });
  });

  it('re-arms (does not show the grid) once the window has elapsed', () => {
    const pending = { query: 'edt-', at: 1000 };
    const now = 1000 + TAB_DOUBLE_PRESS_WINDOW_MS + 1;
    const result = resolveTabPress('edt-', [edtCreate, edtSwitch, edtModify], pending, now);
    expect(result).toEqual({ kind: 'pending', state: { query: 'edt-', at: now } });
  });

  it('re-arms instead of showing the grid when the query changed since the pending press', () => {
    const pending = { query: 'edt-c', at: 1000 };
    const result = resolveTabPress('edt-', [edtCreate, edtSwitch, edtModify], pending, 1000);
    expect(result).toEqual({ kind: 'pending', state: { query: 'edt-', at: 1000 } });
  });

  it('re-arms instead of showing the grid once the caller has discarded pending (intervening key)', () => {
    const result = resolveTabPress('edt-', [edtCreate, edtSwitch, edtModify], null, 1000 + 1);
    expect(result).toEqual({ kind: 'pending', state: { query: 'edt-', at: 1001 } });
  });

  it('re-arms instead of showing the grid if the clock appears to have moved backwards since the pending press', () => {
    // now < pending.at (e.g. an NTP/system-clock adjustment) must not be misread as "within
    // the window" by a naive `now - pending.at <= window` check, which a negative delta would
    // satisfy.
    const pending = { query: 'edt-', at: 1000 };
    const result = resolveTabPress('edt-', [edtCreate, edtSwitch, edtModify], pending, 500);
    expect(result).toEqual({ kind: 'pending', state: { query: 'edt-', at: 500 } });
  });
});

describe('resolveGridVerticalDirection', () => {
  it('maps the up arrow to "up"', () => {
    expect(resolveGridVerticalDirection({ upArrow: true, downArrow: false })).toBe('up');
  });

  it('maps everything else (the down arrow) to "down"', () => {
    expect(resolveGridVerticalDirection({ upArrow: false, downArrow: true })).toBe('down');
  });
});

describe('resolveGridHorizontalDirection', () => {
  it('maps the left arrow to "left"', () => {
    expect(resolveGridHorizontalDirection({ leftArrow: true, rightArrow: false })).toBe('left');
  });

  it('maps everything else (the right arrow) to "right"', () => {
    expect(resolveGridHorizontalDirection({ leftArrow: false, rightArrow: true })).toBe('right');
  });
});

describe('groupCommandsByColumn', () => {
  it('fills column 0 first, column-major, up to maxRows', () => {
    const matches = [registry, reload, edtCreate, edtSwitch, edtModify];
    expect(groupCommandsByColumn(matches, 2)).toEqual([
      [registry, reload],
      [edtCreate, edtSwitch],
      [edtModify],
    ]);
  });

  it('returns a single column when everything fits within maxRows', () => {
    const matches = [registry, reload];
    expect(groupCommandsByColumn(matches, 8)).toEqual([[registry, reload]]);
  });

  it('returns no columns for zero matches', () => {
    expect(groupCommandsByColumn([], 8)).toEqual([]);
  });
});

describe('layoutCommandGrid', () => {
  it('renders every column untruncated when it all fits', () => {
    const matches = [registry, reload, edtCreate];
    const layout = layoutCommandGrid(matches, 8, 200, (c) => c.name, 0);
    expect(layout.truncated).toEqual({ left: false, right: false });
    expect(layout.columns).toEqual(groupCommandsByColumn(matches, 8));
    expect(layout.scrollOffset).toBe(0);
  });

  it('fits exactly at the width boundary — no truncation', () => {
    // Two 1-row columns of "aa"/"bb" (width 2 each) + 1 gap = exactly 5 wide.
    const a: Command = { name: 'aa', run: () => {} };
    const b: Command = { name: 'bb', run: () => {} };
    const layout = layoutCommandGrid([a, b], 1, 5, (c) => c.name, 0);
    expect(layout.truncated).toEqual({ left: false, right: false });
    expect(layout.columns).toEqual([[a], [b]]);
  });

  it('truncates the right edge when the grid is wider than the terminal', () => {
    const columns: Command[] = Array.from({ length: 6 }, (_, i) => ({ name: `cmd-${i}`, run: () => {} }));
    // One column per match (maxRows=1), each column 5 wide ("cmd-0".length === 5).
    const layout = layoutCommandGrid(columns, 1, 15, (c) => c.name, 0);
    expect(layout.truncated.left).toBe(false);
    expect(layout.truncated.right).toBe(true);
    expect(layout.columns.length).toBeGreaterThan(0);
    expect(layout.columns.length).toBeLessThan(6);
    expect(layout.scrollOffset).toBe(0);
  });

  it('truncates the left edge once scrolled away from the start', () => {
    const columns: Command[] = Array.from({ length: 6 }, (_, i) => ({ name: `cmd-${i}`, run: () => {} }));
    const layout = layoutCommandGrid(columns, 1, 15, (c) => c.name, 3);
    expect(layout.truncated.left).toBe(true);
    expect(layout.scrollOffset).toBe(3);
  });

  it('always renders at least one column even when it alone exceeds the budget', () => {
    const columns: Command[] = Array.from({ length: 3 }, (_, i) => ({ name: `command-name-${i}`, run: () => {} }));
    const layout = layoutCommandGrid(columns, 1, 3, (c) => c.name, 0);
    expect(layout.columns.length).toBe(1);
  });

  it('clamps an out-of-range scrollOffset to the last column', () => {
    const columns: Command[] = Array.from({ length: 6 }, (_, i) => ({ name: `cmd-${i}`, run: () => {} }));
    const layout = layoutCommandGrid(columns, 1, 15, (c) => c.name, 999);
    expect(layout.scrollOffset).toBe(5);
    expect(layout.truncated.right).toBe(false);
  });

  // Vertical pagination on top of the horizontal truncation/scroll — used by logs-zone.tsx's
  // filter-history grid browser. A call without `verticalWindow` keeps `rowScrollOffset` at 0
  // and `truncated.top`/`.bottom` undefined, asserted explicitly here for existing callers.
  describe('vertical pagination', () => {
    it('is a no-op (rowScrollOffset: 0, no top/bottom truncation) when no verticalWindow is given', () => {
      const matches = [registry, reload, edtCreate];
      const layout = layoutCommandGrid(matches, 8, 200, (c) => c.name, 0);
      expect(layout.rowScrollOffset).toBe(0);
      expect(layout.truncated.top).toBeUndefined();
      expect(layout.truncated.bottom).toBeUndefined();
    });

    it('is a no-op when every column already fits maxVisibleRows', () => {
      const columns: Command[] = Array.from({ length: 3 }, (_, i) => ({ name: `cmd-${i}`, run: () => {} }));
      const layout = layoutCommandGrid(columns, 3, 200, (c) => c.name, 0, { maxVisibleRows: 10, cursorRow: 0 });
      expect(layout.rowScrollOffset).toBe(0);
      expect(layout.truncated.top).toBe(false);
      expect(layout.truncated.bottom).toBe(false);
      expect(layout.columns[0]).toHaveLength(3);
    });

    it('paginates a single tall column, showing a bottom truncation when the cursor is at the top', () => {
      const single: Command[] = Array.from({ length: 20 }, (_, i) => ({ name: `cmd-${i}`, run: () => {} }));
      const layout = layoutCommandGrid(single, 20, 200, (c) => c.name, 0, { maxVisibleRows: 5, cursorRow: 0 });
      expect(layout.rowScrollOffset).toBe(0);
      expect(layout.truncated.top).toBe(false);
      expect(layout.truncated.bottom).toBe(true);
      // 4 items + the "more below" indicator line LogFilterEditor renders around the grid =
      // exactly 5 — a full 5 rows of *content* would overshoot the budget once that indicator
      // line is counted.
      expect(layout.columns[0]).toHaveLength(4);
      expect(layout.columns[0]?.[0]?.name).toBe('cmd-0');
    });

    it('centers the window on cursorRow once scrolled, keeping the cursor visible with a top truncation', () => {
      const single: Command[] = Array.from({ length: 20 }, (_, i) => ({ name: `cmd-${i}`, run: () => {} }));
      const layout = layoutCommandGrid(single, 20, 200, (c) => c.name, 0, { maxVisibleRows: 5, cursorRow: 19 });
      expect(layout.truncated.top).toBe(true);
      expect(layout.rowScrollOffset).toBeGreaterThan(0);
      expect(layout.columns[0]?.some((c) => c.name === 'cmd-19')).toBe(true);
    });

    // The indicator lines count toward the budget: the grid's footprint, indicators included,
    // must never exceed `maxVisibleRows`. Asserted across a spread of budgets/cursor positions,
    // mirroring bounded-list.test.tsx's "never renders more total rows" guard.
    it('never renders more total rows (column content + top/bottom indicators) than maxVisibleRows', () => {
      const single: Command[] = Array.from({ length: 30 }, (_, i) => ({ name: `cmd-${i}`, run: () => {} }));
      for (const maxVisibleRows of [1, 2, 3, 6]) {
        for (const cursorRow of [0, 5, 15, 29]) {
          const layout = layoutCommandGrid(single, 30, 200, (c) => c.name, 0, { maxVisibleRows, cursorRow });
          const totalRows = (layout.columns[0]?.length ?? 0) + (layout.truncated.top ? 1 : 0) + (layout.truncated.bottom ? 1 : 0);
          expect(totalRows).toBeLessThanOrEqual(maxVisibleRows);
        }
      }
    });

    it('never changes the column-major layout or column widths for the columns that remain visible', () => {
      const columns: Command[] = Array.from({ length: 10 }, (_, i) => ({ name: `command-${i}`, run: () => {} }));
      const unwindowed = layoutCommandGrid(columns, 10, 200, (c) => c.name, 0);
      const windowed = layoutCommandGrid(columns, 10, 200, (c) => c.name, 0, { maxVisibleRows: 4, cursorRow: 0 });
      expect(windowed.columns).toHaveLength(unwindowed.columns.length);
      expect(windowed.truncated.left).toBe(unwindowed.truncated.left);
      expect(windowed.truncated.right).toBe(unwindowed.truncated.right);
    });
  });
});

describe('moveGridCursorVertical', () => {
  it('moves down within the column, clamped to its row count', () => {
    expect(moveGridCursorVertical({ column: 0, row: 0 }, 'down', 3)).toEqual({ column: 0, row: 1 });
    expect(moveGridCursorVertical({ column: 0, row: 2 }, 'down', 3)).toEqual({ column: 0, row: 2 });
  });

  it('moves up within the column', () => {
    expect(moveGridCursorVertical({ column: 0, row: 2 }, 'up', 3)).toEqual({ column: 0, row: 1 });
  });

  it('returns null when moving up from row 0 (back to the input)', () => {
    expect(moveGridCursorVertical({ column: 0, row: 0 }, 'up', 3)).toBeNull();
  });
});

describe('moveGridCursorHorizontal', () => {
  it('moves right, clamping the row to the new column length', () => {
    const result = moveGridCursorHorizontal({ column: 0, row: 3 }, 'right', [4, 1], 0, 2);
    expect(result.cursor).toEqual({ column: 1, row: 0 });
  });

  it('is a no-op at the rightmost real column', () => {
    const result = moveGridCursorHorizontal({ column: 1, row: 0 }, 'right', [4, 1], 0, 2);
    expect(result).toEqual({ cursor: { column: 1, row: 0 }, scrollOffset: 0 });
  });

  it('is a no-op at the leftmost column moving left', () => {
    const result = moveGridCursorHorizontal({ column: 0, row: 0 }, 'left', [4, 1], 0, 2);
    expect(result).toEqual({ cursor: { column: 0, row: 0 }, scrollOffset: 0 });
  });

  it('scrolls the window right by one column at the hidden right edge', () => {
    const columnLengths = [1, 1, 1, 1];
    const result = moveGridCursorHorizontal({ column: 1, row: 0 }, 'right', columnLengths, 0, 2);
    expect(result.cursor.column).toBe(2);
    expect(result.scrollOffset).toBe(1);
  });

  it('scrolls the window left by one column at the hidden left edge', () => {
    const columnLengths = [1, 1, 1, 1];
    const result = moveGridCursorHorizontal({ column: 2, row: 0 }, 'left', columnLengths, 2, 2);
    expect(result.cursor.column).toBe(1);
    expect(result.scrollOffset).toBe(1);
  });
});

describe('commandAtGridCursor', () => {
  it('resolves the command at an absolute cursor position', () => {
    const columns = [[registry, reload], [edtCreate]];
    expect(commandAtGridCursor(columns, { column: 0, row: 1 })).toBe(reload);
    expect(commandAtGridCursor(columns, { column: 1, row: 0 })).toBe(edtCreate);
  });

  it('returns undefined for an out-of-range cursor', () => {
    const columns = [[registry]];
    expect(commandAtGridCursor(columns, { column: 0, row: 5 })).toBeUndefined();
    expect(commandAtGridCursor(columns, { column: 5, row: 0 })).toBeUndefined();
  });
});

describe('runCommand', () => {
  function fakeStore(calls: string[]) {
    return {
      getState: () => ({
        setActiveZone: (zone: string) => calls.push(`setActiveZone:${zone}`),
        openRegistryScreen: () => calls.push('openRegistryScreen'),
        openUpdateConfig: (target: string) => calls.push(`openUpdateConfig:${target}`),
        openUpdateServiceDialog: (query: string) => calls.push(`openUpdateServiceDialog:${query}`),
      }),
    } as unknown as Parameters<Command['run']>[0];
  }

  it('runs an exact single-token match and closes through a true return', () => {
    const calls: string[] = [];

    expect(runCommand(fakeStore(calls), 'registry')).toBe(true);
    expect(calls).toEqual(['openRegistryScreen']);
  });

  it('dispatches on the first token so commands with args still run, forwarding the full query', () => {
    const calls: string[] = [];

    expect(runCommand(fakeStore(calls), 'update-service svc-a')).toBe(true);
    expect(calls).toEqual(['setActiveZone:update', 'openUpdateServiceDialog:update-service svc-a']);
  });

  it('activates the command zone before running a zone-carrying command', () => {
    const calls: string[] = [];

    expect(runCommand(fakeStore(calls), 'update-edt')).toBe(true);
    expect(calls).toEqual(['setActiveZone:update', 'openUpdateConfig:edt']);
  });

  it('matches the command name case-insensitively', () => {
    const calls: string[] = [];

    expect(runCommand(fakeStore(calls), 'REGISTRY')).toBe(true);
    expect(calls).toEqual(['openRegistryScreen']);
  });

  it('returns false on a partial, unknown, or empty query — never executes', () => {
    const calls: string[] = [];

    expect(runCommand(fakeStore(calls), 'reg')).toBe(false);
    expect(runCommand(fakeStore(calls), 'zzz')).toBe(false);
    expect(runCommand(fakeStore(calls), '')).toBe(false);
    expect(runCommand(fakeStore(calls), '   ')).toBe(false);
    expect(calls).toEqual([]);
  });

  it('returns false when the first token is unknown even with trailing args', () => {
    const calls: string[] = [];

    expect(runCommand(fakeStore(calls), 'zzz foo')).toBe(false);
    expect(calls).toEqual([]);
  });

  it('a synchronously throwing command returns true without propagating', () => {
    const throwing: Command = {
      name: 'boom',
      run: () => {
        throw new Error('sync failure');
      },
    };
    const calls: string[] = [];

    expect(runCommand(fakeStore(calls), 'boom', [throwing])).toBe(true);
    expect(calls).toEqual([]);
  });
});

describe('CommandBar footer context', () => {
  it('registers the command context while mounted and clears it on unmount', async () => {
    const store = createAppStore();
    expect(await footerContextOf(store, <CommandBar useStore={store} onClose={() => {}} />)).toBe('command');
    expect(store.getState().footerContexts).toEqual([]);
    const mounted = await mountForTest(<CommandBar useStore={store} onClose={() => {}} />);
    expect(store.getState().footerContexts).toEqual([{ owner: 'command-bar', id: 'command' }]);
    mounted.unmount();
    expect(store.getState().footerContexts).toEqual([]);
  });
});
