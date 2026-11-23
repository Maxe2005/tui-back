// tui/zones/logs: logs-zone.rule-draft-keys — the filter editor's rule-draft view: history grid
// browser keys, mode/action/target toggles, caret moves, arrow-recall and text editing.
import { nextTextInputValue } from '../../../shared/components/inputs/text-edit.js';
import { resolveFocusStep } from '../../../shared/keys/focus-navigation.js';
import { resolveHistoryBrowseDown, resolveHistoryBrowseUp } from '../../../shared/input-history/index.js';
import { commandAtGridCursor, groupCommandsByColumn, layoutCommandGrid, moveGridCursorHorizontal, moveGridCursorVertical, resolveGridHorizontalDirection, resolveGridVerticalDirection } from '../../../shared/screens/command-bar/command-bar.js';
import { decodeFilterHistoryEntry, encodeFilterHistoryEntry, historyEntryLabel, toggleFilterAction, toggleFilterMode, toggleFilterTarget, type FilterEditorState } from '../logic/logs-zone.logic.js';
import type { LogsKey, LogsZoneCtx } from '../logs-zone.ctx.js';

export function handleRuleDraftKey(c: LogsZoneCtx, filterEditor: FilterEditorState, input: string, key: LogsKey): void {
  const { applyFilterEditorDraft, backToRuleList, commitRuleDraft, filterHistoryGridMaxRows, historyForEditor, historyGridAvailableWidth, historyGridCursor, historyGridScroll, setFilterEditor, setHistoryGridCursor, setHistoryGridScroll, snapBackDraft, withBrowseResult } = c;
  // Esc leaves the rule editor for the list, even while the history grid is open on top
  // of it — never just the grid.
  if (key.escape) {
    backToRuleList(filterEditor, filterEditor.listCursor);
    return;
  }

  // The history grid browser has its own keys while open — Up/Down/Left/Right navigate it,
  // Enter recalls the highlighted entry into the draft and closes the grid (the editor stays
  // open), and every other key (typing, backspace, Tab) is swallowed rather than leaking
  // into the query underneath.
  if (historyGridCursor !== null) {
    const history = historyForEditor(filterEditor);
    const columns = groupCommandsByColumn(history, filterHistoryGridMaxRows);
    if (key.return) {
      const entry = commandAtGridCursor(columns, historyGridCursor);
      if (entry !== undefined) {
        const recalled = decodeFilterHistoryEntry(entry);
        applyFilterEditorDraft({
          ...filterEditor,
          query: recalled.query,
          cursor: recalled.query.length,
          action: recalled.action,
          target: recalled.target,
          browsing: null,
        });
      }
      setHistoryGridCursor(null);
      return;
    }
    if (key.upArrow || key.downArrow) {
      const columnLength = columns[historyGridCursor.column]?.length ?? 0;
      const next = moveGridCursorVertical(historyGridCursor, resolveGridVerticalDirection(key), columnLength);
      setHistoryGridCursor(next);
      return;
    }
    if (key.leftArrow || key.rightArrow) {
      const columnLengths = columns.map((column) => column.length);
      const layout = layoutCommandGrid(
        history,
        filterHistoryGridMaxRows,
        historyGridAvailableWidth,
        historyEntryLabel,
        historyGridScroll,
      );
      const { cursor, scrollOffset } = moveGridCursorHorizontal(
        historyGridCursor,
        resolveGridHorizontalDirection(key),
        columnLengths,
        layout.scrollOffset,
        layout.columns.length,
      );
      setHistoryGridCursor(cursor);
      setHistoryGridScroll(scrollOffset);
    }
    return;
  }

  if (key.return) {
    commitRuleDraft(filterEditor);
    return;
  }
  // Tab and Shift+Tab both flip: with only two modes, reversing is the same move.
  if (resolveFocusStep(input, key, 'tab') !== null) {
    // Text and regex are distinct (scope, mode) history lists — flipping mode mid-recall
    // drops any browsing state (a stale `index`/`savedDraft` would be reused against the new
    // mode's list on the next ↑/↓). Like a printable char/Backspace while browsing, the
    // recalled entry is discarded and the original draft carries over into the new mode.
    // Snapping back out of a browsed entry changes `query`, so the caret resets to its end
    // (programmatic-overwrite convention); an untouched draft's caret position carries over.
    applyFilterEditorDraft({
      ...filterEditor,
      ...snapBackDraft(filterEditor),
      mode: toggleFilterMode(filterEditor.mode),
      browsing: null,
    });
    setHistoryGridCursor(null);
    return;
  }
  // Ctrl+X flips show/hide, Ctrl+T flips line/match; they leave the query in place; a recalled entry becomes the draft (browsing ends).
  if (key.ctrl && input.toLowerCase() === 'x') {
    setHistoryGridCursor(null);
    applyFilterEditorDraft({ ...filterEditor, action: toggleFilterAction(filterEditor.action), browsing: null });
    return;
  }
  if (key.ctrl && input.toLowerCase() === 't') {
    setHistoryGridCursor(null);
    applyFilterEditorDraft({ ...filterEditor, target: toggleFilterTarget(filterEditor.target), browsing: null });
    return;
  }
  // Cursor navigation: bare Left/Right/Home/End move the caret only and never touch
  // `query`/`browsing`/`error`, so a pure caret move never snaps a browsed history entry
  // back to the saved draft.
  if (key.leftArrow || key.rightArrow || key.home || key.end) {
    const result = nextTextInputValue({ value: filterEditor.query, cursor: filterEditor.cursor }, input, key);
    setFilterEditor({ ...filterEditor, cursor: result.cursor });
    return;
  }
  // Arrow-recall. `↑` always browses (the most-recent entry on an untouched draft, older ones
  // on further presses); `↓` walks back toward the draft while browsing, or — on an untouched
  // draft — opens the grid browser over the full history (a no-op with nothing to browse).
  if (key.upArrow) {
    const history = historyForEditor(filterEditor);
    const result = resolveHistoryBrowseUp(encodeFilterHistoryEntry(filterEditor), filterEditor.browsing, history);
    applyFilterEditorDraft(withBrowseResult(filterEditor, result));
    return;
  }
  if (key.downArrow) {
    if (filterEditor.browsing === null) {
      const history = historyForEditor(filterEditor);
      if (history.length > 0) {
        setHistoryGridCursor({ column: 0, row: 0 });
        setHistoryGridScroll(0);
      }
      return;
    }
    const history = historyForEditor(filterEditor);
    const result = resolveHistoryBrowseDown(filterEditor.browsing, history);
    applyFilterEditorDraft(withBrowseResult(filterEditor, result));
    return;
  }
  if (key.backspace || key.delete) {
    // While browsing, Backspace snaps back to the saved draft with the backspace applied on
    // top, rather than editing the recalled entry in place — caret at the saved draft's end,
    // like the typed-char snap-back below.
    const base = snapBackDraft(filterEditor);
    const result = nextTextInputValue({ value: base.query, cursor: base.cursor }, input, key);
    applyFilterEditorDraft({ ...filterEditor, ...base, query: result.value, cursor: result.cursor, browsing: null });
    return;
  }
  if (!key.ctrl && !key.meta && input.length > 0) {
    // Any printable character while browsing snaps back to the draft with that keystroke
    // applied on top, inserted at the caret.
    const base = snapBackDraft(filterEditor);
    const result = nextTextInputValue({ value: base.query, cursor: base.cursor }, input, key);
    applyFilterEditorDraft({ ...filterEditor, ...base, query: result.value, cursor: result.cursor, browsing: null });
  }
}
