// shared/components/filterable-pick-list: the single "filter field + navigable list + Enter
// selects + Esc cancels" implementation behind every quick-pick dialog (the EDT pick opened
// by a no-argument `edt-switch`/`edt-modify`/`edt-delete`, the service pick opened by a
// no-argument `update-service`). Stories 2.30 and 3.11 each grew their own copy on diverged
// epics; this component replaces both so filtering, highlight movement and filter-text
// editing can never drift between them again.
//
// Split convention (branch-autocomplete-input.tsx's own precedent): every keystroke behavior
// is a standalone pure function, unit-tested directly — `handleFilterablePickListKey` is this
// component's single reducer, called from the host zone's own `useInput` dispatcher (never a
// component-owned `useInput`). `FilterablePickList` itself only ever renders.
//
// The host stays in charge of everything that isn't the pick interaction itself: where the
// state lives (a zone dialog union, a `useState`), the surrounding `ModalDialog` and its
// title, the candidate pool, and what `select`/`cancel` actually do. Candidates arrive as
// `FilterablePickItem<T>` — a label, an optional secondary text, and the host's own payload
// handed back untouched on `select`.
//
// Text editing reuses shared/components/text-edit.ts's `nextTextInputValue` interpreter (never
// a forked copy): `Left`/`Right`/`Home`/`End`/typing/`Backspace`/`Delete` move or edit the
// caret through it, and the highlight resets to the top only when the filter value actually
// changed. `Up`/`Down` never touch the caret; Ctrl/Meta combos stay inert.
import { Box } from 'ink';
import { BoundedList } from './bounded-list.js';
import { DimAnnotation } from './dim-annotation.js';
import { ListRow } from './list-row.js';
import { nextTextInputValue, type TextEditKey } from './text-edit.js';
import { TextInputLine } from './text-input-line.js';

// The row budget every pick dialog passes to the view — one shared constant so the dialogs
// can never disagree on how tall the list gets. A *total* budget in BoundedList's own sense
// (the "more above"/"more below" indicator lines count against it).
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

// Case-insensitive substring match over the trimmed query, against the label or the
// secondary text — the same convention as the shared branch autocomplete's
// matchBranchesBySubstring. An empty query matches every item (String.includes('') is true
// for all), so a freshly opened pick proposes the whole pool.
export function matchPickItemsBySubstring<T>(
  query: string,
  items: readonly FilterablePickItem<T>[],
): FilterablePickItem<T>[] {
  const needle = query.trim().toLowerCase();
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
  state: FilterablePickListState,
  items: readonly FilterablePickItem<T>[],
  input: string,
  key: FilterablePickListKey,
): FilterablePickListKeyResult<T> {
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
    return { type: 'update', state: { ...state, cursor: clampPickListCursor(state.cursor + direction, matches.length) } };
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
  // A pure caret move leaves the filter value unchanged — the highlight survives it. Only an
  // actual filter-text change re-derives the match list and resets the highlight to the top.
  const nextCursor = edited.value === state.query ? clampPickListCursor(state.cursor, matches.length) : 0;
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
  maxVisibleRows?: number;
};

export function FilterablePickList<T>(props: FilterablePickListProps<T>) {
  const { label, state, items, emptyText, noMatchText, maxVisibleRows = FILTERABLE_PICK_LIST_MAX_ROWS } = props;
  const matches = matchPickItemsBySubstring(state.query, items);
  const highlight = clampPickListCursor(state.cursor, matches.length);
  return (
    <Box flexDirection="column">
      {/* TextInputLine ships its own "[Enter] confirm  [Esc] cancel" hint line while focused —
          the pick's one and only hint, never duplicated below the list. */}
      <TextInputLine label={label} value={state.query} cursor={state.queryCursor} focused />
      {matches.length === 0 ? (
        <DimAnnotation text={items.length === 0 ? emptyText : noMatchText} />
      ) : (
        <BoundedList
          items={matches}
          maxVisibleRows={maxVisibleRows}
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
