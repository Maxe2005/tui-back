// shared/components/filterable-pick-list: the single "filter field + navigable list + Enter
// selects + Esc cancels" implementation behind every quick-pick dialog, so filtering and
// highlight movement never drift between them. `handleFilterablePickListKey` is the pure
// reducer the host zone's useInput calls; the host owns where the state lives, the dialog
// chrome, the candidates and what `select`/`cancel` do.
import { Box } from 'ink';
import { BoundedList } from './bounded-list.js';
import { DimAnnotation } from './dim-annotation.js';
import { ListRow } from './list-row.js';
import { nextTextInputValue, type TextEditKey } from './text-edit.js';
import { TextInputLine } from './text-input-line.js';

// The row budget of every pick dialog — one shared constant, deliberately not a prop, so the
// dialogs can never disagree on how tall the list gets. A *total* budget in BoundedList's
// own sense (the "more above"/"more below" indicator lines count against it).
export const FILTERABLE_PICK_LIST_MAX_ROWS = 8;

export type FilterablePickItem<T> = {
  // Stable React key for the row (an EDT's ulid, a service's repo path) — never the label,
  // which hosts don't guarantee unique.
  key: string;
  label: string;
  // Secondary text rendered dim after the label and searched alongside it, so candidates
  // sharing a label stay narrowable (a service's repo path).
  meta?: string;
  value: T;
};

export type FilterablePickListState = {
  // The filter field's own value/caret — the same TextInputState-shaped pair every
  // TextInputLine-driving field carries.
  query: string;
  queryCursor: number;
  // The highlighted row within the *current* filtered match list.
  cursor: number;
};

export function createFilterablePickListState(): FilterablePickListState {
  return { query: '', queryCursor: 0, cursor: 0 };
}

// What the filter actually matches on: the trimmed, lower-cased query. Two queries with the
// same needle produce the same match list.
function resolvePickNeedle(query: string): string {
  return query.trim().toLowerCase();
}

// Case-insensitive substring match over the trimmed query, against the label or the
// secondary text — the same convention as the shared branch autocomplete's
// matchBranchesBySubstring. An empty query matches every item (String.includes('') is true
// for all), so a freshly opened pick proposes the whole pool.
export function matchPickItemsBySubstring<T>(
  query: string,
  items: readonly FilterablePickItem<T>[],
): FilterablePickItem<T>[] {
  const needle = resolvePickNeedle(query);
  return items.filter(
    (item) => item.label.toLowerCase().includes(needle) || (item.meta ?? '').toLowerCase().includes(needle),
  );
}

export function clampPickListCursor(cursor: number, length: number): number {
  if (length === 0) {
    return 0;
  }
  return Math.min(Math.max(cursor, 0), length - 1);
}

export type FilterablePickListKey = TextEditKey;

export type FilterablePickListKeyResult<T> =
  | { type: 'update'; state: FilterablePickListState }
  | { type: 'select'; item: FilterablePickItem<T> }
  | { type: 'cancel' };

export function handleFilterablePickListKey<T>(
  current: FilterablePickListState,
  items: readonly FilterablePickItem<T>[],
  input: string,
  key: FilterablePickListKey,
): FilterablePickListKeyResult<T> {
  // Hosts may hand in a wider object embedding this state (the EDT zone's dialog union
  // member) — every returned state is rebuilt from these three fields only, so no host
  // field ever leaks through an `update`.
  const state: FilterablePickListState = { query: current.query, queryCursor: current.queryCursor, cursor: current.cursor };
  // Esc always closes — checked before the Ctrl/Meta guard so no modifier can trap the
  // developer inside the dialog.
  if (key.escape) {
    return { type: 'cancel' };
  }
  // Ctrl/Meta combos stay inert — checked before any navigation/edit branch, so
  // Ctrl/Meta+<key> never moves or edits anything (mirrors nextTextInputValue's own guard).
  if (key.ctrl || key.meta) {
    return { type: 'update', state };
  }
  const matches = matchPickItemsBySubstring(state.query, items);
  if (key.downArrow || key.upArrow) {
    const direction = key.downArrow ? 1 : -1;
    // Clamp before moving: a highlight left beyond the list by a pool that shrank underneath
    // must step from the last row, not swallow several presses getting back in range.
    const from = clampPickListCursor(state.cursor, matches.length);
    return { type: 'update', state: { ...state, cursor: clampPickListCursor(from + direction, matches.length) } };
  }
  if (key.return) {
    // Zero matches (a filter matching nothing, or a genuinely empty pool): Enter is a safe
    // no-op — the dialog stays open on its own "nothing to select" line.
    const chosen = matches[clampPickListCursor(state.cursor, matches.length)];
    if (chosen === undefined) {
      return { type: 'update', state };
    }
    return { type: 'select', item: chosen };
  }
  const edited = nextTextInputValue({ value: state.query, cursor: state.queryCursor }, input, key);
  // A pure caret move leaves the filter value unchanged — the highlight survives it, and so
  // does it through an edit that doesn't change what is matched (a stray leading/trailing
  // space). Only a change of the needle re-derives the match list and resets the highlight
  // to the top.
  const sameNeedle = resolvePickNeedle(edited.value) === resolvePickNeedle(state.query);
  const nextCursor = sameNeedle ? clampPickListCursor(state.cursor, matches.length) : 0;
  return { type: 'update', state: { query: edited.value, queryCursor: edited.cursor, cursor: nextCursor } };
}

export type FilterablePickListProps<T> = {
  // The filter field's label (e.g. "Filter").
  label: string;
  state: FilterablePickListState;
  items: readonly FilterablePickItem<T>[];
  // Shown when the pool itself is empty, before any filtering — nothing to select, ever.
  emptyText: string;
  // Shown when the pool has items but the current filter text matches none of them.
  noMatchText: string;
};

export function FilterablePickList<T>(props: FilterablePickListProps<T>) {
  const { label, state, items, emptyText, noMatchText } = props;
  const matches = matchPickItemsBySubstring(state.query, items);
  const highlight = clampPickListCursor(state.cursor, matches.length);
  return (
    <Box flexDirection="column">
      <TextInputLine label={label} value={state.query} cursor={state.queryCursor} focused />
      {matches.length === 0 ? (
        <DimAnnotation text={items.length === 0 ? emptyText : noMatchText} />
      ) : (
        <BoundedList
          items={matches}
          maxVisibleRows={FILTERABLE_PICK_LIST_MAX_ROWS}
          cursorIndex={highlight}
          renderItem={(item, index) => (
            <Box key={item.key} flexDirection="row">
              <ListRow label={item.label} meta={item.meta} selected={index === highlight} />
            </Box>
          )}
        />
      )}
    </Box>
  );
}
