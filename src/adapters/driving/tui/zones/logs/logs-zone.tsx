// tui/zones/logs: story 5.1 — replaces the placeholder with the real Logs zone. Two
// multi-select service lists (active-EDT members / other manifest services) drive an
// auto-resizing grid of scrollable log panes, with a per-pane fullscreen view. Mirrors
// edts-zone.tsx's own dispatch idiom: a single `useInput` hook, an overlay branch (here,
// fullscreen) checked first, every keystroke decision delegated to a pure function from
// logs-zone.logic.ts (or reused as-is from edts-zone.logic.ts where the logic is generic list
// navigation, not EDT-specific — see that file's own header).
import { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';
import type { ServiceBranchDivergence } from '../../../../../core/edt/list.js';
import type { LogLine } from '../../../../../core/ports/docker.js';
import { BoundedList } from '../../shared/components/bounded-list.js';
import { CheckboxListItem } from '../../shared/components/checkbox-list-item.js';
import { DimAnnotation } from '../../shared/components/dim-annotation.js';
import { StatusBadge } from '../../shared/components/status-badge.js';
import { colors, spacing } from '../../shared/theme/theme.js';
import { useAppStore, type AppStore, type LogsPaneData } from '../../store/app-store.js';
import { FullscreenPane } from './fullscreen-pane.js';
import { LogFilterEditor } from './log-filter-editor.js';
import { LogsGrid } from './logs-grid.js';
import { useLogsSubscriptions } from './use-logs-subscriptions.js';
import {
  jumpSelection,
  moveSelection,
  nextTextInputValue,
  partitionServicesByEdtMembership,
  resolveSelectionDirection,
  resolveSelectionJump,
} from '../edts/edts-zone.logic.js';
import {
  commandAtGridCursor,
  groupCommandsByColumn,
  layoutCommandGrid,
  moveGridCursorHorizontal,
  moveGridCursorVertical,
  resolveGridHorizontalDirection,
  resolveGridVerticalDirection,
  type GridCursor,
} from '../../shared/command-bar.js';
import {
  adjustScrollOffset,
  applyLogFilters,
  computeLogsLayout,
  cycleFilterLevel,
  cycleLogsPaneFocus,
  DEFAULT_LOG_FILTER,
  DEFAULT_VISIBILITY_FLAGS,
  filterHistoryKeyString,
  filterVisibleLines,
  healthBadgeState,
  historyEntryLabel,
  isAtOldestLine,
  isClearAllLogsKey,
  isDefaultLogFilterSpec,
  isPaneEngagedInGlobalFilter,
  isPaneWrapped,
  isSelectAllKey,
  isWrapAllLogsKey,
  LIST_COLUMN_WIDTH,
  movePaneSubFocus,
  reindexPaneSubFocus,
  resolveFilterClearTarget,
  resolveFilterEditorDraft,
  resolveFullscreenScrollDirection,
  resolveHistoryBrowseDown,
  resolveHistoryBrowseUp,
  resolvePaneScrollDirection,
  resolveSelectAllToggle,
  resolveVisibilityToggleKey,
  setPaneGlobalFilterEngagement,
  setPaneLogFilter,
  toggleAllPanesWrapFlag,
  toggleFilterMode,
  toggleGlobalFilterEngagement,
  togglePaneWrapFlag,
  toggleVisibilityFlag,
  type FilterEditorState,
  type FilterHistoryBrowseState,
  type FilterHistoryKey,
  type LogFilterMode,
  type LogFilterSpec,
  type LogLevel,
  type LogsPaneFocus,
  type VisibilityFlags,
} from './logs-zone.logic.js';


export function LogsZone({ useStore = useAppStore }: { useStore?: AppStore }) {
  const services = useStore((state) => state.edtsBranches);
  const servicesStatus = useStore((state) => state.edtsBranchesStatus);
  const loadEdtsBranches = useStore((state) => state.loadEdtsBranches);
  const edts = useStore((state) => state.edts);
  const loadEdts = useStore((state) => state.loadEdts);
  const activeEdtUlid = useStore((state) => state.activeEdt);

  const logsEdtSelected = useStore((state) => state.logsEdtSelected);
  const logsOtherSelected = useStore((state) => state.logsOtherSelected);
  const toggleLogsEdtSelection = useStore((state) => state.toggleLogsEdtSelection);
  const toggleLogsOtherSelection = useStore((state) => state.toggleLogsOtherSelection);
  const selectAllLogsEdtServices = useStore((state) => state.selectAllLogsEdtServices);
  const deselectAllLogsEdtServices = useStore((state) => state.deselectAllLogsEdtServices);
  const logsFullscreenTarget = useStore((state) => state.logsFullscreenTarget);
  const logsFullscreenServiceName = useStore((state) => state.logsFullscreenServiceName);
  const openLogsFullscreen = useStore((state) => state.openLogsFullscreen);
  const closeLogsFullscreen = useStore((state) => state.closeLogsFullscreen);
  const logsPanes = useStore((state) => state.logsPanes);
  const subscribeLogsPane = useStore((state) => state.subscribeLogsPane);
  const unsubscribeLogsPane = useStore((state) => state.unsubscribeLogsPane);
  const loadOlderLogsPane = useStore((state) => state.loadOlderLogsPane);
  const clearLogsPane = useStore((state) => state.clearLogsPane);
  const restartLogsPane = useStore((state) => state.restartLogsPane);
  const setLogsPaneScrollOffset = useStore((state) => state.setLogsPaneScrollOffset);
  const commandBarOpen = useStore((state) => state.commandBarOpen);
  const registryScreenOpen = useStore((state) => state.registryScreenOpen);
  const settingsScreenOpen = useStore((state) => state.settingsScreenOpen);
  const resizeMode = useStore((state) => state.resizeMode);
  const setZoneInputCaptured = useStore((state) => state.setZoneInputCaptured);
  const setLogsPaneGridArrowsActive = useStore((state) => state.setLogsPaneGridArrowsActive);
  // Story 5.4: the persisted filter-history lists, plus the setting driving the history grid
  // browser's own max-rows-per-column (independent of commandPalette.gridMaxRows).
  const filterHistory = useStore((state) => state.filterHistory);
  const commitFilterHistoryEntry = useStore((state) => state.commitFilterHistoryEntry);
  const filterHistoryGridMaxRows = useStore((state) => state.settings.logs.filterHistoryGridMaxRows);

  useEffect(() => {
    void loadEdtsBranches();
    void loadEdts();
    // Fires once on mount only, mirrors edts-zone.tsx's own mount effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = servicesStatus === 'error' ? [] : (services ?? []);
  const focusedEdt = (edts ?? []).find((entry) => entry.ulid === activeEdtUlid);
  // Boundaries: "Any manifest service can be streamed, not only active-EDT members" — the
  // partition is against the tool-wide *active* EDT (not a selected row, unlike edts-zone's
  // own use of this same function), since the Logs zone has no EDT selector of its own.
  const { edtServices, otherServices } = partitionServicesByEdtMembership(rows, focusedEdt);

  const [paneFocus, setPaneFocus] = useState<LogsPaneFocus>('edt-list');
  const [edtCursor, setEdtCursor] = useState(0);
  const [otherCursor, setOtherCursor] = useState(0);
  const [subFocus, setSubFocus] = useState(0);
  const [visibility, setVisibility] = useState<VisibilityFlags>(DEFAULT_VISIBILITY_FLAGS);
  // User-reported: wrap/truncate ('w') used to be one flag shared by every pane. Per-pane now
  // (keyed by repoPath) so 'w' can target just the sub-focused/fullscreen pane, with Ctrl+W as
  // the explicit "apply to every open pane" escape hatch (see isWrapAllLogsKey).
  const [paneWrap, setPaneWrap] = useState<Record<string, boolean>>({});
  // Story 5.2: the global filter every pane is engaged with by default (Boundaries: "one
  // global LogFilterSpec every pane is engaged with by default, and an optional per-pane
  // LogFilterSpec"), the per-pane engagement flags ('g' opts a single pane out), and each
  // pane's own filter ('f'). None of these are persisted (Never: "Persist any filter to
  // settings.ts or disk — ephemeral UI state only").
  const [globalFilter, setGlobalFilter] = useState<LogFilterSpec>(DEFAULT_LOG_FILTER);
  const [paneFilterEngaged, setPaneFilterEngaged] = useState<Record<string, boolean>>({});
  const [paneFilters, setPaneFilters] = useState<Record<string, LogFilterSpec>>({});
  const [filterEditor, setFilterEditor] = useState<FilterEditorState | null>(null);
  // Story 5.4: the history grid browser's own cursor/scroll — non-null exactly while the grid
  // is open (`↓` on an untouched draft). Kept separate from FilterEditorState (Code Map) since
  // it's a distinct, editor-local concern that only ever exists while filterEditor itself does.
  const [historyGridCursor, setHistoryGridCursor] = useState<GridCursor | null>(null);
  const [historyGridScroll, setHistoryGridScroll] = useState(0);

  const clampedEdtCursor = edtServices.length === 0 ? 0 : Math.min(edtCursor, edtServices.length - 1);
  const clampedOtherCursor = otherServices.length === 0 ? 0 : Math.min(otherCursor, otherServices.length - 1);

  // Active panes render in a stable order (EDT-list selections first, then other-list ones) so
  // `subFocus`'s index keeps a consistent meaning as selections change.
  const activeRepoPaths = useMemo(() => [...logsEdtSelected, ...logsOtherSelected], [logsEdtSelected, logsOtherSelected]);
  const activePanes = useMemo(
    () => activeRepoPaths.map((path) => rows.find((row) => row.path === path)).filter((row): row is ServiceBranchDivergence => row !== undefined),
    [activeRepoPaths, rows],
  );

  useLogsSubscriptions({ activeRepoPaths, logsFullscreenTarget, rows, subscribeLogsPane, unsubscribeLogsPane });

  // Boundaries: "grid reflows and sub-focus moves to the nearest remaining pane".
  useEffect(() => {
    setSubFocus((current) => reindexPaneSubFocus(current, activePanes.length));
  }, [activePanes.length]);

  // Story 5.2: the filter editor is a modal too — every existing dialogOpen consumer
  // (zoneInputCaptured, logsPaneGridArrowsActive) must treat it the same as fullscreen, since
  // both capture the entire keystroke stream while open.
  const dialogOpen = logsFullscreenTarget !== null || filterEditor !== null;
  useEffect(() => {
    setZoneInputCaptured(dialogOpen);
  }, [dialogOpen, setZoneInputCaptured]);
  useEffect(() => () => setZoneInputCaptured(false), [setZoneInputCaptured]);

  // Review fix (story 5.1): AppShell's own Left/Right global zone-switch (story 2.12) fires
  // on the very same keypress as this zone's own `useInput` below — Ink dispatches to every
  // mounted hook, not just this one — so without this flag, moving pane sub-focus with
  // Left/Right always switched the active zone out from under the grid instead. Only set
  // while pane focus actually owns the arrows (fullscreen already captures everything via
  // zoneInputCaptured above, so this stays false there).
  useEffect(() => {
    setLogsPaneGridArrowsActive(paneFocus === 'panes' && !dialogOpen);
  }, [paneFocus, dialogOpen, setLogsPaneGridArrowsActive]);
  useEffect(() => () => setLogsPaneGridArrowsActive(false), [setLogsPaneGridArrowsActive]);

  const windowSize = useWindowSize();
  // Story 5.5: every terminal-row/column budget the render below derives from the live window
  // size (pane grid, fullscreen preview, filter-history grid browser, the two service lists'
  // own BoundedList windows) — computed by one pure function (logs-zone.logic.ts) so it stays
  // unit-testable against a given terminal size without mounting Ink.
  const {
    layout,
    paneVisibleLines,
    paneContentWidth,
    fullscreenVisibleLines,
    fullscreenContentWidth,
    historyGridAvailableWidth,
    historyGridAvailableHeight,
    edtListMaxVisibleRows,
    otherListMaxVisibleRows,
    hintsMaxVisibleRows,
  } = computeLogsLayout({
    windowColumns: windowSize.columns,
    windowRows: windowSize.rows,
    activePaneCount: activePanes.length,
    edtServiceCount: edtServices.length,
    otherServiceCount: otherServices.length,
    filterEditorOpen: filterEditor !== null,
    historyGridOpen: historyGridCursor !== null,
    filterHistoryGridMaxRows,
  });

  function handlePaneScroll(repoPath: string, direction: 'up' | 'down'): void {
    const pane = logsPanes[repoPath];
    // Scroll math (and the "at oldest line" history-fetch trigger below) must be computed
    // against the *visible* (stdout/stderr- and story-5.2-filtered) line count, not the
    // pane's raw buffered `lines.length` — otherwise, with a stream toggled off or a filter
    // narrowing what's shown, scroll position and the oldest-line trigger diverge from what's
    // actually rendered (review fix, extended by story 5.2 to the new filter layer).
    const engagedGlobal = isPaneEngagedInGlobalFilter(paneFilterEngaged, repoPath) ? globalFilter : null;
    const ownFilter = paneFilters[repoPath] ?? null;
    const visibleLineCount = pane ? applyLogFilters(filterVisibleLines(pane.lines, visibility), engagedGlobal, ownFilter).length : 0;
    const nextOffset = adjustScrollOffset(pane?.scrollOffset ?? 0, direction, visibleLineCount);
    setLogsPaneScrollOffset(repoPath, nextOffset);
    if (direction === 'up' && isAtOldestLine(nextOffset, visibleLineCount) && pane && !pane.noMoreHistory) {
      void loadOlderLogsPane(repoPath);
    }
  }

  // Story 5.2: opens the filter-editor modal — `/` (global, any Logs-zone focus) or `f`
  // (pane, sub-focused grid pane / fullscreen only). Pre-fills the draft from whichever spec
  // is already active for that scope, so re-opening an already-filtered pane/global scope
  // shows what's currently applied rather than resetting it.
  function openGlobalFilterEditor(): void {
    setFilterEditor({
      scope: 'global',
      repoPath: null,
      mode: globalFilter.mode,
      query: globalFilter.query,
      cursor: globalFilter.query.length,
      level: globalFilter.level,
      error: null,
      preOpen: globalFilter,
      browsing: null,
    });
    setHistoryGridCursor(null);
  }
  function openPaneFilterEditor(repoPath: string): void {
    const existing = paneFilters[repoPath] ?? DEFAULT_LOG_FILTER;
    setFilterEditor({
      scope: 'pane',
      repoPath,
      mode: existing.mode,
      query: existing.query,
      cursor: existing.query.length,
      level: existing.level,
      error: null,
      preOpen: existing,
      browsing: null,
    });
    setHistoryGridCursor(null);
  }

  // Story 5.4: the exact (scope, mode) history list backing whichever editor is currently
  // open — recomputed live off the store's `filterHistory` map, never cached in local state
  // (so a commit from this same editor is immediately visible to the next arrow-recall/grid
  // open in the same session).
  function historyForEditor(editor: FilterEditorState): string[] {
    const key: FilterHistoryKey = { scope: editor.scope, repoPath: editor.repoPath, mode: editor.mode };
    return filterHistory[filterHistoryKeyString(key)] ?? [];
  }

  // The actual commit decision (compile the draft, decide which of globalFilter/paneFilters —
  // if either — advances) is a pure function (resolveFilterEditorDraft, logs-zone.logic.ts);
  // this wrapper just applies whichever state updates it reports.
  function applyFilterEditorDraft(next: FilterEditorState): void {
    const result = resolveFilterEditorDraft(next);
    setFilterEditor(result.editor);
    if (result.globalFilter !== null) {
      setGlobalFilter(result.globalFilter);
    }
    if (result.paneFilterUpdate !== null) {
      const { repoPath, spec } = result.paneFilterUpdate;
      setPaneFilters((current) => setPaneLogFilter(current, repoPath, spec));
    }
  }

  useInput(
    (input, key) => {
      // Story 5.2: the filter editor captures every keystroke while open, regardless of
      // whether it was opened from the grid or fullscreen (Code Map: "extend useInput in
      // both the grid ... and fullscreen ... branches for /`/`f`/`g`/Escape-clear + editor
      // text capture") — checked first so it works from either view. Tab toggles text/regex
      // mode; Ctrl+Left/Right cycle the level restriction (user-reported: bare Left/Right used
      // to do this, but that's the same key a text cursor would use — Ctrl disambiguates it as
      // a level change rather than caret movement).
      //
      // Review fix: TextInputLine (reused by LogFilterEditor) always renders "[Enter] confirm
      // [Esc] cancel" while focused, but Escape and Enter used to be treated identically here
      // — neither one actually reverted anything. Escape now restores the scope's pre-open
      // spec (captured in filterEditor.preOpen) — a true cancel; Enter just closes the editor,
      // keeping whatever is currently committed — a true confirm.
      if (filterEditor !== null) {
        // Story 5.4 (I/O matrix GRID_OPEN_ESC): Esc always closes the *whole* filter-editor
        // bar, even while the history grid is open on top of it — never just the grid.
        if (key.escape) {
          if (filterEditor.scope === 'global') {
            setGlobalFilter(filterEditor.preOpen);
          } else if (filterEditor.repoPath !== null) {
            const repoPath = filterEditor.repoPath;
            const preOpen = filterEditor.preOpen;
            setPaneFilters((current) => setPaneLogFilter(current, repoPath, isDefaultLogFilterSpec(preOpen) ? null : preOpen));
          }
          setFilterEditor(null);
          setHistoryGridCursor(null);
          return;
        }

        // Story 5.4: the history grid browser has its own key handling while open — Up/Down/
        // Left/Right navigate it, Enter recalls the highlighted entry back into the draft and
        // closes the grid (the editor itself stays open), and every other key (typing,
        // backspace, Tab) is swallowed rather than leaking into the query underneath
        // (Boundaries only defines Up/Down/Left/Right/Enter/Esc for the grid).
        if (historyGridCursor !== null) {
          const history = historyForEditor(filterEditor);
          const columns = groupCommandsByColumn(history, filterHistoryGridMaxRows);
          if (key.return) {
            const entry = commandAtGridCursor(columns, historyGridCursor);
            if (entry !== undefined) {
              applyFilterEditorDraft({ ...filterEditor, query: entry, cursor: entry.length, browsing: null });
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
          // Story 5.4 (I/O matrix HISTORY_PUSH): commit — a compiled, non-empty draft is
          // pushed onto its exact (scope, mode) history list before the editor closes.
          if (filterEditor.error === null && filterEditor.query !== '') {
            commitFilterHistoryEntry(
              { scope: filterEditor.scope, repoPath: filterEditor.repoPath, mode: filterEditor.mode },
              filterEditor.query,
            );
          }
          setFilterEditor(null);
          setHistoryGridCursor(null);
          return;
        }
        if (key.tab) {
          // Review fix: text/regex are two distinct (scope, mode) history lists — flipping
          // mode mid-recall must drop any in-progress browsing state (a stale `index`/
          // `savedDraft` from the old mode's list would otherwise be reused against the new
          // mode's different list on the next ↑/↓). Mirrors the same snap-back-to-draft idiom
          // already applied to a printable char/Backspace while browsing: the recalled entry
          // is discarded and the original (pre-browse) draft carries over into the new mode.
          const baseQuery = filterEditor.browsing !== null ? filterEditor.browsing.savedDraft : filterEditor.query;
          // Snapping back out of a browsed entry changes `query`, so the caret resets to its end
          // (programmatic-overwrite convention); an untouched draft's caret position carries over.
          const baseCursor = filterEditor.browsing !== null ? baseQuery.length : filterEditor.cursor;
          applyFilterEditorDraft({
            ...filterEditor,
            query: baseQuery,
            cursor: baseCursor,
            mode: toggleFilterMode(filterEditor.mode),
            browsing: null,
          });
          setHistoryGridCursor(null);
          return;
        }
        if (key.ctrl && (key.leftArrow || key.rightArrow)) {
          applyFilterEditorDraft({ ...filterEditor, level: cycleFilterLevel(filterEditor.level, key.rightArrow ? 'next' : 'previous') });
          return;
        }
        // Cursor navigation (new, mirrors edts-zone.logic.ts's nextTextInputValue/TextInputLine
        // adoption): bare Left/Right/Home/End move the caret only — Ctrl+Left/Right above already
        // claims the level-cycle binding, and this never touches `query`/`browsing`/`error`, so a
        // pure caret move never snaps a browsed history entry back to the saved draft.
        if (key.leftArrow || key.rightArrow || key.home || key.end) {
          const result = nextTextInputValue({ value: filterEditor.query, cursor: filterEditor.cursor }, input, key);
          setFilterEditor({ ...filterEditor, cursor: result.cursor });
          return;
        }
        // Story 5.4: arrow-recall. `↑` always browses (recalling the most-recent entry on an
        // untouched draft, older ones on further presses); `↓` either walks back toward the
        // draft while already browsing, or — on an untouched draft — opens the grid browser
        // over the full history (a no-op when there's nothing to browse).
        if (key.upArrow) {
          const history = historyForEditor(filterEditor);
          const result = resolveHistoryBrowseUp(filterEditor.query, filterEditor.browsing, history);
          applyFilterEditorDraft({
            ...filterEditor,
            query: result.query,
            cursor: result.query.length,
            browsing: result.browsing,
          });
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
          applyFilterEditorDraft({
            ...filterEditor,
            query: result.query,
            cursor: result.query.length,
            browsing: result.browsing,
          });
          return;
        }
        if (key.backspace || key.delete) {
          // Story 5.4 (I/O matrix SNAP_BACK_TYPE): while browsing, Backspace snaps back to the
          // saved draft with the backspace applied on top, rather than editing the recalled
          // history entry in place — same "caret at the saved draft's end" convention as the
          // typed-char snap-back just below.
          const browsing = filterEditor.browsing;
          const base = browsing !== null ? browsing.savedDraft : filterEditor.query;
          const cursor = browsing !== null ? base.length : filterEditor.cursor;
          const result = nextTextInputValue({ value: base, cursor }, input, key);
          applyFilterEditorDraft({ ...filterEditor, query: result.value, cursor: result.cursor, browsing: null });
          return;
        }
        if (!key.ctrl && !key.meta && input.length > 0) {
          // Story 5.4 (I/O matrix SNAP_BACK_TYPE): any printable character while browsing
          // snaps back to the draft with that keystroke applied on top — same one-key-resume
          // idiom already used elsewhere in this editor, and inserts at the caret rather than
          // always appending, now that the field is cursor-aware.
          const browsing = filterEditor.browsing;
          const base = browsing !== null ? browsing.savedDraft : filterEditor.query;
          const cursor = browsing !== null ? base.length : filterEditor.cursor;
          const result = nextTextInputValue({ value: base, cursor }, input, key);
          applyFilterEditorDraft({ ...filterEditor, query: result.value, cursor: result.cursor, browsing: null });
        }
        return;
      }

      if (logsFullscreenTarget !== null) {
        if (key.escape) {
          closeLogsFullscreen();
          return;
        }
        // Story 5.2: `/`/`f`/`g` — same bare-key-scopes-to-one-pane idiom as `c`/`w` below,
        // fullscreen's one pane standing in for "the sub-focused grid pane".
        if (input === '/') {
          openGlobalFilterEditor();
          return;
        }
        if (input === 'f') {
          openPaneFilterEditor(logsFullscreenTarget);
          return;
        }
        if (input === 'g') {
          setPaneFilterEngaged((current) => toggleGlobalFilterEngagement(current, logsFullscreenTarget));
          return;
        }
        const scrollDirection = resolveFullscreenScrollDirection(key);
        if (scrollDirection !== null) {
          handlePaneScroll(logsFullscreenTarget, scrollDirection);
          return;
        }
        // Ctrl+C/Ctrl+W ("apply to all open logs") are deliberately no-ops here — fullscreen
        // has only the one pane, and the bare key below already covers it (user-reported).
        if (key.ctrl && (input === 'c' || input === 'w')) {
          return;
        }
        if (input === 'c') {
          clearLogsPane(logsFullscreenTarget);
          return;
        }
        if (input === 'w') {
          setPaneWrap((current) => togglePaneWrapFlag(current, logsFullscreenTarget));
          return;
        }
        // Story 5.3: developer-triggered restart for this fullscreen pane's service — while
        // restarting (in-flight `docker restart` or docker reporting `restarting`), the
        // control is disabled (no-op here; the slice guards too). Uppercase `R` only:
        // lowercase `r` is the global Routes-zone mnemonic (app-shell exact-matches it
        // whenever zoneInputCaptured is false, and Ink forwards every keypress to all
        // mounted useInput hooks), so accepting `r` here would both restart a container
        // and switch zones on one keypress.
        if (input === 'R') {
          const pane = logsPanes[logsFullscreenTarget];
          if (pane && !pane.restarting && (pane.health ?? 'down') !== 'restarting') {
            void restartLogsPane(logsFullscreenTarget);
          }
          return;
        }
        const toggle = resolveVisibilityToggleKey(input);
        if (toggle !== null) {
          setVisibility((current) => toggleVisibilityFlag(current, toggle));
        }
        return;
      }

      if (key.tab) {
        setPaneFocus((current) => cycleLogsPaneFocus(current));
        return;
      }

      // Story 5.2 (Boundaries): "`/` (any Logs-zone focus) opens the editor for the global
      // filter" — focus-independent, so it's checked ahead of the per-list dispatch below,
      // mirroring how Tab is handled just above.
      if (input === '/') {
        openGlobalFilterEditor();
        return;
      }

      // "Apply to all open logs" — every currently-active pane (any list focus), never
      // reachable in fullscreen (that branch already returned above).
      if (isClearAllLogsKey(input, key)) {
        for (const pane of activePanes) {
          clearLogsPane(pane.path);
        }
        return;
      }
      if (isWrapAllLogsKey(input, key)) {
        const paths = activePanes.map((pane) => pane.path);
        setPaneWrap((current) => toggleAllPanesWrapFlag(current, paths));
        return;
      }

      const toggle = resolveVisibilityToggleKey(input);
      if (toggle !== null) {
        setVisibility((current) => toggleVisibilityFlag(current, toggle));
        return;
      }

      // Story 5.2 (Boundaries): "Escape, when no editor is open: if a pane is sub-focused in
      // the grid ... clears that pane's own filter if set, else disengages it from the
      // global filter; if no pane is sub-focused (list-focus), clears the global filter
      // entirely." resolveFilterClearTarget is the pure resolver; this just dispatches its
      // result. No prior Escape binding exists outside fullscreen (handled above), so this is
      // the first and only Escape handling reached here.
      if (key.escape) {
        const focused = paneFocus === 'panes' ? activePanes[subFocus] : undefined;
        const repoPath = focused?.path ?? null;
        const hasOwnFilter = repoPath !== null && paneFilters[repoPath] !== undefined;
        const target = resolveFilterClearTarget(paneFocus === 'panes', repoPath, hasOwnFilter);
        if (target.scope === 'global') {
          setGlobalFilter(DEFAULT_LOG_FILTER);
        } else if (target.scope === 'pane-own') {
          setPaneFilters((current) => setPaneLogFilter(current, target.repoPath, null));
        } else {
          setPaneFilterEngaged((current) => setPaneGlobalFilterEngagement(current, target.repoPath, false));
        }
        return;
      }

      if (paneFocus === 'edt-list') {
        if (isSelectAllKey(input, key)) {
          const edtPaths = edtServices.map((service) => service.path);
          if (resolveSelectAllToggle(edtPaths, logsEdtSelected) === 'select-all') {
            selectAllLogsEdtServices(edtPaths);
          } else {
            deselectAllLogsEdtServices();
          }
          return;
        }
        const jump = resolveSelectionJump(key);
        if (jump !== null) {
          setEdtCursor(jumpSelection(jump, edtServices.length));
          return;
        }
        const direction = resolveSelectionDirection(key);
        if (direction !== null) {
          setEdtCursor((current) => moveSelection(current, direction, edtServices.length));
          return;
        }
        if (input === ' ') {
          const service = edtServices[clampedEdtCursor];
          if (service !== undefined) {
            toggleLogsEdtSelection(service.path);
          }
          return;
        }
        if (key.return) {
          const service = edtServices[clampedEdtCursor];
          if (service !== undefined) {
            openLogsFullscreen(service.path, service.service);
          }
        }
        return;
      }

      if (paneFocus === 'other-list') {
        const jump = resolveSelectionJump(key);
        if (jump !== null) {
          setOtherCursor(jumpSelection(jump, otherServices.length));
          return;
        }
        const direction = resolveSelectionDirection(key);
        if (direction !== null) {
          setOtherCursor((current) => moveSelection(current, direction, otherServices.length));
          return;
        }
        if (input === ' ') {
          const service = otherServices[clampedOtherCursor];
          if (service !== undefined) {
            toggleLogsOtherSelection(service.path);
          }
          return;
        }
        if (key.return) {
          const service = otherServices[clampedOtherCursor];
          if (service !== undefined) {
            openLogsFullscreen(service.path, service.service);
          }
        }
        return;
      }

      // paneFocus === 'panes'
      const scrollDirection = resolvePaneScrollDirection(key);
      if (scrollDirection !== null) {
        const focused = activePanes[subFocus];
        if (focused !== undefined) {
          handlePaneScroll(focused.path, scrollDirection);
        }
        return;
      }
      if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) {
        const direction = key.upArrow ? 'up' : key.downArrow ? 'down' : key.leftArrow ? 'left' : 'right';
        setSubFocus((current) => movePaneSubFocus(current, direction, layout.cols, activePanes.length));
        return;
      }
      if (input === 'c') {
        const focused = activePanes[subFocus];
        if (focused !== undefined) {
          clearLogsPane(focused.path);
        }
        return;
      }
      if (input === 'w') {
        const focused = activePanes[subFocus];
        if (focused !== undefined) {
          setPaneWrap((current) => togglePaneWrapFlag(current, focused.path));
        }
        return;
      }
      // Story 5.2 (Boundaries): "`f` (bare, same scope as `g`) opens a filter-editor modal
      // for that pane's own filter" / "`g` (bare, sub-focused grid pane or fullscreen pane)
      // toggles that one pane's engagement with the global filter" — same bare-key-scopes-
      // to-one-pane idiom as `c`/`w` above.
      if (input === 'f') {
        const focused = activePanes[subFocus];
        if (focused !== undefined) {
          openPaneFilterEditor(focused.path);
        }
        return;
      }
      if (input === 'g') {
        const focused = activePanes[subFocus];
        if (focused !== undefined) {
          setPaneFilterEngaged((current) => toggleGlobalFilterEngagement(current, focused.path));
        }
        return;
      }
      // Story 5.3: developer-triggered restart for the sub-focused grid pane's service —
      // while restarting, the control is disabled (no-op; the slice's no-op guard is the
      // second line of defense against a second concurrent `docker restart`). Uppercase
      // `R` only — lowercase `r` is the global Routes-zone mnemonic (see the fullscreen
      // branch above for why accepting it would double-dispatch).
      if (input === 'R') {
        const focused = activePanes[subFocus];
        if (focused !== undefined) {
          const pane = logsPanes[focused.path];
          if (pane && !pane.restarting && (pane.health ?? 'down') !== 'restarting') {
            void restartLogsPane(focused.path);
          }
        }
        return;
      }
      if (key.return) {
        const focused = activePanes[subFocus];
        if (focused !== undefined) {
          openLogsFullscreen(focused.path, focused.service);
        }
      }
    },
    { isActive: !commandBarOpen && !registryScreenOpen && !settingsScreenOpen && !resizeMode },
  );

  return (
    <Box flexDirection="column" flexGrow={1} backgroundColor={colors.surface}>
      {logsFullscreenTarget !== null ? (
        <FullscreenPane
          repoPath={logsFullscreenTarget}
          serviceName={logsFullscreenServiceName}
          pane={logsPanes[logsFullscreenTarget]}
          visibility={visibility}
          wrapLines={isPaneWrapped(paneWrap, logsFullscreenTarget)}
          visibleLines={fullscreenVisibleLines}
          contentWidth={fullscreenContentWidth}
          globalFilter={globalFilter}
          engaged={isPaneEngagedInGlobalFilter(paneFilterEngaged, logsFullscreenTarget)}
          ownFilter={paneFilters[logsFullscreenTarget] ?? null}
        />
      ) : (
        <Box flexDirection="column" flexGrow={1} minHeight={0}>
          <Text color={colors['text-dim']}>LOGS</Text>
          <Box flexDirection="row" flexGrow={1} minHeight={0}>
            <Box flexDirection="column" width={LIST_COLUMN_WIDTH} paddingX={spacing['pane-padding-x']} minHeight={0} overflow="hidden">
              <Text color={paneFocus === 'edt-list' ? colors.accent : colors['text-dim']}>ACTIVE EDT MEMBERS</Text>
              {servicesStatus === 'loading' && rows.length === 0 ? <Text color={colors['text-dim']}>Loading services…</Text> : null}
              {servicesStatus === 'error' ? <Text color={colors.error}>Failed to load services</Text> : null}
              {focusedEdt === undefined ? <DimAnnotation text="No active EDT." /> : null}
              {focusedEdt !== undefined && edtServices.length === 0 && servicesStatus !== 'error' ? (
                <DimAnnotation text="No services in the active EDT." />
              ) : null}
              {/* Story 5.5 (OVERFLOW_LOGS_LISTS): bounded to edtListMaxVisibleRows, following
                  the cursor only while this list actually owns focus — otherwise the window
                  anchors to the top, same as before this story. */}
              <BoundedList
                items={edtServices}
                maxVisibleRows={edtListMaxVisibleRows}
                cursorIndex={paneFocus === 'edt-list' ? clampedEdtCursor : undefined}
                renderItem={(service, index) => {
                  const paneHealth = logsPanes[service.path]?.health ?? null;
                  return (
                    <Box key={service.path} flexDirection="row">
                      <Text color={colors.accent}>{paneFocus === 'edt-list' && index === clampedEdtCursor ? '›' : ' '}</Text>
                      <CheckboxListItem label={service.service} state={logsEdtSelected.includes(service.path) ? 'checked' : 'unchecked'} />
                      {paneHealth !== null ? (
                        <Box marginLeft={1}>
                          <StatusBadge state={healthBadgeState(paneHealth)} />
                          <Text color={colors['text-dim']}> {paneHealth}</Text>
                        </Box>
                      ) : null}
                    </Box>
                  );
                }}
              />

              <Text color={paneFocus === 'other-list' ? colors.accent : colors['text-dim']}>OTHER SERVICES</Text>
              {otherServices.length === 0 && servicesStatus !== 'loading' && servicesStatus !== 'error' ? (
                <DimAnnotation text="No other managed services." />
              ) : null}
              <BoundedList
                items={otherServices}
                maxVisibleRows={otherListMaxVisibleRows}
                cursorIndex={paneFocus === 'other-list' ? clampedOtherCursor : undefined}
                renderItem={(service, index) => {
                  const paneHealth = logsPanes[service.path]?.health ?? null;
                  return (
                    <Box key={service.path} flexDirection="row">
                      <Text color={colors.accent}>{paneFocus === 'other-list' && index === clampedOtherCursor ? '›' : ' '}</Text>
                      <CheckboxListItem label={service.service} state={logsOtherSelected.includes(service.path) ? 'checked' : 'unchecked'} />
                      {paneHealth !== null ? (
                        <Box marginLeft={1}>
                          <StatusBadge state={healthBadgeState(paneHealth)} />
                          <Text color={colors['text-dim']}> {paneHealth}</Text>
                        </Box>
                      ) : null}
                    </Box>
                  );
                }}
              />

              {/* Amended 2026-09-20 (crash/corruption fix): every one of these hints is a
                  services-list keybinding (Space/Enter/Ctrl+A/t/o/p/Ctrl+↑↓/c/Ctrl+C/w/Ctrl+W)
                  or opens the filter editor (`/`, `f`, `g`, Esc) — none of them are live once
                  the editor itself has taken over input capture (see the `useInput` guard:
                  "the filter editor captures every keystroke while open"). Rendering this
                  15-line block unconditionally, stacked above LogFilterEditor's own modal
                  (appended as a sibling below, not a true overlay — Ink has no absolute
                  positioning), pushed total content past the terminal's row count on anything
                  but a very tall window: Ink's diff-render then desyncs from the real
                  terminal's cursor and corrupts already-painted lines (the exact "SETTINGS" ->
                  "--ttings" family of bug from the Settings-tab fix, reproduced here against
                  live services with a 100x30 terminal and zero panes open — Design Notes). Since
                  these keybindings are genuinely inert while the editor is open, hiding this
                  block then costs nothing functionally and reliably recovers the ~15 rows the
                  editor needs.
                  Story 5.5: now additionally bounded (hintsMaxVisibleRows) rather than relying
                  on this being "the last thing rendered" — the two lists above it can push it
                  past the terminal's own row count on a small enough window even with the
                  filter editor closed. */}
              {filterEditor === null ? (
                <Box flexDirection="column" marginTop={spacing['section-gap']}>
                  <BoundedList
                    items={[
                      '[Space] toggle',
                      '[Enter] preview',
                      '[Ctrl+A] toggle all',
                      `[t] timestamps ${visibility.showTimestamps ? 'on' : 'off'}`,
                      `[o] stdout ${visibility.showStdout ? 'on' : 'off'}`,
                      `[p] stderr ${visibility.showStderr ? 'on' : 'off'}`,
                      '[Ctrl+↑/↓] scroll pane',
                      '[c] clear focused pane',
                      '[Ctrl+C] clear all panes',
                      '[w] wrap/truncate this pane',
                      '[Ctrl+W] wrap/truncate all',
                      '[R] restart focused pane',
                      '[/] edit global filter',
                      "[f] edit this pane's filter",
                      '[g] toggle global (pane)',
                      '[Esc] clear filter (cascade)',
                    ]}
                    maxVisibleRows={hintsMaxVisibleRows}
                    renderItem={(text, index) => <DimAnnotation key={index} text={text} />}
                  />
                </Box>
              ) : null}
            </Box>

            <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden">
              {activePanes.length === 0 ? (
                <DimAnnotation text="No service selected — select one or more services on the left to stream their logs." />
              ) : (
                <LogsGrid
                  panes={activePanes}
                  logsPanes={logsPanes}
                  layout={layout}
                  visibleLines={paneVisibleLines}
                  contentWidth={paneContentWidth}
                  visibility={visibility}
                  paneWrap={paneWrap}
                  subFocused={paneFocus === 'panes' ? subFocus : -1}
                  globalFilter={globalFilter}
                  paneFilterEngaged={paneFilterEngaged}
                  paneFilters={paneFilters}
                />
              )}
            </Box>
          </Box>
        </Box>
      )}
      {filterEditor !== null ? (
        <LogFilterEditor
          editor={filterEditor}
          serviceName={filterEditor.repoPath !== null ? (rows.find((row) => row.path === filterEditor.repoPath)?.service ?? null) : null}
          history={historyForEditor(filterEditor)}
          gridMaxRows={filterHistoryGridMaxRows}
          gridCursor={historyGridCursor}
          gridScrollOffset={historyGridScroll}
          gridAvailableWidth={historyGridAvailableWidth}
          gridAvailableHeight={historyGridAvailableHeight}
        />
      ) : null}
    </Box>
  );
}

