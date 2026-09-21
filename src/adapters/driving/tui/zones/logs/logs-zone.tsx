// tui/zones/logs: story 5.1 — replaces the placeholder with the real Logs zone. Two
// multi-select service lists (active-EDT members / other manifest services) drive an
// auto-resizing grid of scrollable log panes, with a per-pane fullscreen view. Mirrors
// edts-zone.tsx's own dispatch idiom: a single `useInput` hook, an overlay branch (here,
// fullscreen) checked first, every keystroke decision delegated to a pure function from
// logs-zone.logic.ts (or reused as-is from edts-zone.logic.ts where the logic is generic list
// navigation, not EDT-specific — see that file's own header).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Box, measureElement, Text, useInput, useWindowSize, type DOMElement } from 'ink';
import type { ServiceBranchDivergence } from '../../../../../core/edt/list.js';
import type { HealthState, LogLine } from '../../../../../core/ports/docker.js';
import { BoundedList } from '../../shared/components/bounded-list.js';
import { CheckboxListItem } from '../../shared/components/checkbox-list-item.js';
import { DimAnnotation } from '../../shared/components/dim-annotation.js';
import { ModalDialog } from '../../shared/components/modal-dialog.js';
import { StatusBadge, type StatusBadgeState } from '../../shared/components/status-badge.js';
import { TextInputLine } from '../../shared/components/text-input-line.js';
import { colors, spacing } from '../../shared/theme/theme.js';
import { useAppStore, type AppStore, type LogsPaneData } from '../../store/app-store.js';
import {
  jumpSelection,
  moveSelection,
  partitionServicesByEdtMembership,
  resolveSelectionDirection,
  resolveSelectionJump,
} from '../edts/edts-zone.logic.js';
import {
  columnDisplayWidth,
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
  compileLogFilter,
  computeGridLayout,
  computeLineRowCount,
  cycleFilterLevel,
  cycleLogsPaneFocus,
  DEFAULT_LOG_FILTER,
  DEFAULT_VISIBILITY_FLAGS,
  filterHistoryKeyString,
  filterVisibleLines,
  formatLogFilterSpec,
  formatLogLine,
  isAtOldestLine,
  isClearAllLogsKey,
  isPaneEngagedInGlobalFilter,
  isPaneWrapped,
  isSelectAllKey,
  isWrapAllLogsKey,
  movePaneSubFocus,
  reindexPaneSubFocus,
  resolveFilterClearTarget,
  resolveFullscreenScrollDirection,
  resolveHistoryBrowseDown,
  resolveHistoryBrowseUp,
  resolvePaneScrollDirection,
  resolveSelectAllToggle,
  resolveVisibilityToggleKey,
  setPaneGlobalFilterEngagement,
  setPaneLogFilter,
  sliceVisibleWindow,
  toggleAllPanesWrapFlag,
  toggleFilterMode,
  toggleGlobalFilterEngagement,
  togglePaneWrapFlag,
  toggleVisibilityFlag,
  type FilterHistoryBrowseState,
  type FilterHistoryKey,
  type GridLayout,
  type LogFilterMode,
  type LogFilterSpec,
  type LogLevel,
  type LogsPaneFocus,
  type VisibilityFlags,
} from './logs-zone.logic.js';

// Story 5.4: the filter-history grid browser's own layout budget — mirrors command-bar.tsx's
// MODAL_CHROME_WIDTH/MIN_GRID_WIDTH (a `ModalDialog`'s own chrome plus a safety margin) since
// this grid renders inside the same LogFilterEditor `ModalDialog`.
const HISTORY_GRID_CHROME_WIDTH = 6;
const HISTORY_GRID_MIN_WIDTH = 10;
const HISTORY_GRID_COLUMN_GAP = 1;
// Story 5.5: the history grid browser's own available-*height* budget — ModalDialog's chrome
// (double border top/bottom + padding top/bottom + title row + "──" separator = 6 rows) plus
// this editor's own fixed rows above the grid (TextInputLine + Level line + the hint line
// below the grid = 3 rows); a rough estimate mirrors CHROME_ROWS/PANE_CHROME_ROWS below ("an
// approximation is fine here" — same precedent). The optional inline-error line is
// deliberately not subtracted, so this budget stays slightly generous rather than short
// whenever a regex draft is currently invalid.
const HISTORY_GRID_CHROME_ROWS = 9;
const HISTORY_GRID_MIN_VISIBLE_ROWS = 3;
// Story 5.5: rough total-rows budget for the Logs zone's list column (top bar, zone-tab bar,
// footer, and the "LOGS" title row above it) — the list column and the pane grid are row
// siblings sharing the exact same vertical extent, so this reuses the same estimate as
// PANE_CHROME_ROWS' own sibling, CHROME_ROWS, below.
const LOGS_LIST_HEADER_ROWS = 2; // "ACTIVE EDT MEMBERS" + "OTHER SERVICES" header rows, always rendered.

function historyEntryLabel(entry: string): string {
  return entry;
}

// Story 5.3: HealthState → StatusBadgeState — `up` → `●`/success, `down` → `○`/error,
// `restarting` → `⣾`/info (StatusBadge's `in-progress`). Glyph+color always paired, never
// color alone; accent is never a health color (StatusBadge as-is, no change).
function healthBadgeState(health: HealthState): StatusBadgeState {
  if (health === 'restarting') {
    return 'in-progress';
  }
  return health;
}

// Reserves a fixed-width left column for the two lists — this zone has no persisted/resizable
// splitter ratio (unlike every ListDetailSplit-based zone): the spec's Code Map/Design Notes
// never mention one, and the grid's own auto-resize (computeGridLayout) already absorbs
// whatever width remains.
const LIST_COLUMN_WIDTH = 32;
// Rough terminal-chrome budget (top bar, zone-tab bar, footer, this zone's own list headers/
// hints) subtracted from the raw window size before computeGridLayout ever sees it — an
// approximation is fine here since the real per-pane sizing still flows through Ink's own
// flexGrow layout; this only decides how many rows/cols to try to fit and how many lines
// worth of content each pane's own scroll window keeps in view.
const CHROME_ROWS = 8;
const PANE_CHROME_ROWS = 3;
// A grid pane's content width is its cell width minus its own border (1 col each side) and
// paddingX={1} (1 col each side) — needed to know how many terminal rows a wrapped line will
// actually take (see computeLineRowCount).
const GRID_PANE_CHROME_COLS = 4;

// User-reported review fix: CHROME_ROWS/PANE_CHROME_ROWS/GRID_PANE_CHROME_COLS above are only
// ever rough guesses (their own comments say so) — real chrome varies per pane (an optional
// streamError or "no more history" line adds a row; Yoga's flex-grow rounding hands some grid
// rows one more terminal row than a plain `floor(height / rows)` division would). Guessing wrong
// used to leave a permanent gap at the bottom of every pane, worst in wrap mode (its per-line
// row-cost estimate in computeLineRowCount compounds the same guesswork). `useElementSize`
// measures the pane's own content box for real, post-render, via Ink's `measureElement` — the
// estimate above now only seeds the very first paint (before Yoga has computed a layout to
// measure), and every commit after that self-corrects to the pane's true row/column budget.

// Story 5.2: the filter editor's in-progress draft — `/` opens one with scope 'global',
// `f` with scope 'pane' (repoPath set to whichever pane owns it). `error` mirrors whatever
// compileLogFilter last returned for this exact draft (Design Notes: recomputed live on every
// keystroke, never just on submit) — it never blocks the draft from being edited further, it
// only blocks that particular (mode, query, level) combination from being committed into
// `globalFilter`/`paneFilters` (see applyFilterEditorDraft below).
type FilterEditorState = {
  scope: 'global' | 'pane';
  repoPath: string | null;
  mode: LogFilterMode;
  query: string;
  level: LogLevel | null;
  error: string | null;
  // Review fix: the spec that was in effect for this scope at the moment the editor opened —
  // restored verbatim on Escape (a true cancel) so a reused widget whose own hint text reads
  // "[Enter] confirm  [Esc] cancel" actually behaves that way, instead of Escape and Enter both
  // just closing the editor and leaving whatever last compiled cleanly while typing applied.
  preOpen: LogFilterSpec;
  // Story 5.4: non-null while `↑`/`↓` are browsing this scope+mode's history — null on a fresh
  // open and whenever the draft is untouched/browsing has ended (snapped back to the draft, or
  // walked past the most-recent entry). See resolveHistoryBrowseUp/Down (logs-zone.logic.ts).
  browsing: FilterHistoryBrowseState | null;
};

// Review fix: shared by applyFilterEditorDraft's commit path and the Escape-cancel path below
// — a spec deep-equal to DEFAULT_LOG_FILTER (empty query, no level restriction, either mode)
// is a no-op filter and must never be stored as an explicit paneFilters[repoPath] entry (that
// would leave the "pane filter: on" annotation/hasOwnFilter check seeing a filter that isn't
// actually filtering anything).
function isDefaultLogFilterSpec(spec: LogFilterSpec): boolean {
  return spec.mode === DEFAULT_LOG_FILTER.mode && spec.query === DEFAULT_LOG_FILTER.query && spec.level === DEFAULT_LOG_FILTER.level;
}

function useElementSize(): readonly [{ current: DOMElement | null }, { width: number; height: number } | null] {
  const ref = useRef<DOMElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    if (!ref.current) {
      return;
    }
    const { width, height } = measureElement(ref.current);
    setSize((current) => (current !== null && current.width === width && current.height === height ? current : { width, height }));
  });
  return [ref, size] as const;
}

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

  // Reconciles docker subscriptions with whichever repoPaths are currently "active" (selected
  // in either list, or the ad hoc fullscreen preview target) — I/O matrix SELECTION_CHANGE:
  // "that stream stops"; FULLSCREEN_PREVIEW: "stream started ad hoc" / "Escape stops that ad
  // hoc stream". A key both selected and previewed (Enter on an already-selected row) is only
  // ever subscribed once (subscribeLogsPane/LogsManager.subscribe are both idempotent).
  const previousActiveKeysRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const nextKeys = new Set(activeRepoPaths);
    if (logsFullscreenTarget !== null) {
      nextKeys.add(logsFullscreenTarget);
    }
    const previousKeys = previousActiveKeysRef.current;
    for (const path of nextKeys) {
      if (!previousKeys.has(path)) {
        const service = rows.find((row) => row.path === path)?.service ?? path;
        void subscribeLogsPane(path, service);
      }
    }
    for (const path of previousKeys) {
      if (!nextKeys.has(path)) {
        unsubscribeLogsPane(path);
      }
    }
    previousActiveKeysRef.current = nextKeys;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRepoPaths, logsFullscreenTarget, rows]);

  // Leaving the Logs zone (unmount) must never leave a docker child process running
  // unattended — tears down every still-active subscription.
  useEffect(
    () => () => {
      for (const path of previousActiveKeysRef.current) {
        unsubscribeLogsPane(path);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

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
  const gridAvailableWidth = Math.max(windowSize.columns - LIST_COLUMN_WIDTH - spacing['pane-padding-x'], 20);
  const gridAvailableHeight = Math.max(windowSize.rows - CHROME_ROWS, 5);
  const layout = computeGridLayout(activePanes.length, gridAvailableWidth, gridAvailableHeight);
  const paneVisibleLines = Math.max(layout.cellHeight - PANE_CHROME_ROWS, 1);
  const paneContentWidth = Math.max(layout.cellWidth - GRID_PANE_CHROME_COLS, 1);
  const fullscreenVisibleLines = Math.max(windowSize.rows - CHROME_ROWS, 3);
  const fullscreenContentWidth = Math.max(windowSize.columns - spacing['pane-padding-x'] * 2, 1);
  // Story 5.4: the history grid browser's own available width, mirroring command-bar.tsx's
  // own `availableWidth` computation (this grid renders inside the same ModalDialog chrome).
  const historyGridAvailableWidth = Math.max(windowSize.columns - HISTORY_GRID_CHROME_WIDTH, HISTORY_GRID_MIN_WIDTH);
  // Story 5.5: same idea, vertically — the grid's own visible-rows budget (I/O matrix
  // OVERFLOW_HISTORY_GRID), recalculated live off useWindowSize() on every resize.
  const historyGridAvailableHeight = Math.max(windowSize.rows - HISTORY_GRID_CHROME_ROWS, HISTORY_GRID_MIN_VISIBLE_ROWS);

  // Story 5.5 (EDITOR_OPEN_BEHIND_CONTENT): LogFilterEditor renders as a sibling *below* the
  // "LOGS" + list/grid block, not a true overlay (Ink has no absolute positioning) — while it's
  // open, its own rendered rows compete for the same terminal-row budget the list column's
  // BoundedLists were computed against. The hints panel already goes away entirely while the
  // editor is open (the pre-existing 5.4 focus-hidden fix below), but the two *service* lists
  // don't — so this estimates the editor's own footprint (its fixed chrome/rows, plus the
  // history-grid browser's own rows when that's open too, mirroring
  // `historyGridAvailableHeight`'s own budget) and reserves that much off the list column's
  // budget in addition to the header rows, so the two together still never exceed the terminal.
  const filterEditorReservedRows =
    filterEditor === null
      ? 0
      : HISTORY_GRID_CHROME_ROWS + (historyGridCursor === null ? 0 : Math.min(filterHistoryGridMaxRows, historyGridAvailableHeight));
  // Story 5.5 (OVERFLOW_LOGS_LISTS): the list column's own total row budget — a row sibling of
  // the pane grid, so it reuses gridAvailableHeight. Handed out top-down (EDT list, then OTHER
  // list, then the hints panel) so a section shorter than its share leaves more room for the
  // ones rendered after it; each BoundedList below only ever consumes what its own content
  // actually needs (NO_OVERFLOW: nothing changes when everything already fits).
  const listsContentBudget = Math.max(gridAvailableHeight - LOGS_LIST_HEADER_ROWS - filterEditorReservedRows, 3);
  const edtListMaxVisibleRows = listsContentBudget;
  // Review fix: an empty list still renders a 1-row placeholder ("No active EDT."/"No services
  // in the active EDT."/"No other managed services.") instead of the BoundedList's own 0 rows —
  // `Math.min(list.length, …)` was 0 for an empty list, under-counting what that section
  // actually consumes and leaving whatever renders after it 1 row over budget.
  const edtListConsumedRows = edtServices.length === 0 ? 1 : Math.min(edtServices.length, edtListMaxVisibleRows);
  const otherListMaxVisibleRows = Math.max(1, listsContentBudget - edtListConsumedRows);
  const otherListConsumedRows = otherServices.length === 0 ? 1 : Math.min(otherServices.length, otherListMaxVisibleRows);
  const hintsMaxVisibleRows = Math.max(1, otherListMaxVisibleRows - otherListConsumedRows);

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

  // Story 5.2 (Design Notes): "compileLogFilter recomputes on every editor keystroke (not
  // just submit) so the inline regex error appears/clears live". The draft itself always
  // updates (so typed characters/level cycles are never lost); the actual applied
  // globalFilter/paneFilters state only ever advances to a draft that compiles cleanly
  // (Boundaries: "the previously-active filter ... stays in effect" on an invalid regex).
  function applyFilterEditorDraft(next: FilterEditorState): void {
    const spec: LogFilterSpec = { mode: next.mode, query: next.query, level: next.level };
    const compiled = compileLogFilter(spec);
    if (!compiled.ok) {
      setFilterEditor({ ...next, error: compiled.error });
      return;
    }
    if (next.scope === 'global') {
      setGlobalFilter(spec);
      setFilterEditor({ ...next, error: null });
      return;
    }
    const repoPath = next.repoPath;
    if (repoPath === null) {
      // Review fix: `scope === 'pane' && repoPath === null` is currently unreachable
      // (openPaneFilterEditor always sets repoPath) but the type still permits it — rather than
      // silently discarding a compiled spec with no feedback, surface it as an editor error.
      setFilterEditor({ ...next, error: 'no pane targeted' });
      return;
    }
    // Review fix: committing a vacuous spec (deep-equal to DEFAULT_LOG_FILTER, e.g. after
    // backspacing the query back to empty) as an explicit paneFilters[repoPath] entry left a
    // no-op-but-present key — both the "pane filter: on" annotation and
    // resolveFilterClearTarget's `hasOwnFilter` check key off entry *presence*, not content, so
    // the pane kept reading as filtered even though its effective filter was a no-op. Passing
    // `null` instead removes the key exactly like the explicit-clear path (Escape /
    // resolveFilterClearTarget) already does.
    setPaneFilters((current) => setPaneLogFilter(current, repoPath, isDefaultLogFilterSpec(spec) ? null : spec));
    setFilterEditor({ ...next, error: null });
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
              applyFilterEditorDraft({ ...filterEditor, query: entry, browsing: null });
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
          applyFilterEditorDraft({ ...filterEditor, query: baseQuery, mode: toggleFilterMode(filterEditor.mode), browsing: null });
          setHistoryGridCursor(null);
          return;
        }
        if (key.ctrl && (key.leftArrow || key.rightArrow)) {
          applyFilterEditorDraft({ ...filterEditor, level: cycleFilterLevel(filterEditor.level, key.rightArrow ? 'next' : 'previous') });
          return;
        }
        // Story 5.4: arrow-recall. `↑` always browses (recalling the most-recent entry on an
        // untouched draft, older ones on further presses); `↓` either walks back toward the
        // draft while already browsing, or — on an untouched draft — opens the grid browser
        // over the full history (a no-op when there's nothing to browse).
        if (key.upArrow) {
          const history = historyForEditor(filterEditor);
          const result = resolveHistoryBrowseUp(filterEditor.query, filterEditor.browsing, history);
          applyFilterEditorDraft({ ...filterEditor, query: result.query, browsing: result.browsing });
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
          applyFilterEditorDraft({ ...filterEditor, query: result.query, browsing: result.browsing });
          return;
        }
        if (key.backspace || key.delete) {
          // Story 5.4 (I/O matrix SNAP_BACK_TYPE): while browsing, Backspace snaps back to the
          // saved draft with the backspace applied on top, rather than editing the recalled
          // history entry in place.
          const base = filterEditor.browsing !== null ? filterEditor.browsing.savedDraft : filterEditor.query;
          applyFilterEditorDraft({ ...filterEditor, query: base.slice(0, -1), browsing: null });
          return;
        }
        if (!key.ctrl && !key.meta && input.length > 0) {
          // Story 5.4 (I/O matrix SNAP_BACK_TYPE): any printable character while browsing
          // snaps back to the draft with that keystroke applied on top — same one-key-resume
          // idiom already used elsewhere in this editor.
          const base = filterEditor.browsing !== null ? filterEditor.browsing.savedDraft : filterEditor.query;
          applyFilterEditorDraft({ ...filterEditor, query: base + input, browsing: null });
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

function LogsGrid({
  panes,
  logsPanes,
  layout,
  visibleLines,
  contentWidth,
  visibility,
  paneWrap,
  subFocused,
  globalFilter,
  paneFilterEngaged,
  paneFilters,
}: {
  panes: ServiceBranchDivergence[];
  logsPanes: Record<string, LogsPaneData>;
  layout: GridLayout;
  visibleLines: number;
  contentWidth: number;
  visibility: VisibilityFlags;
  paneWrap: Record<string, boolean>;
  subFocused: number;
  globalFilter: LogFilterSpec;
  paneFilterEngaged: Record<string, boolean>;
  paneFilters: Record<string, LogFilterSpec>;
}) {
  const cols = Math.max(layout.cols, 1);
  const rowsOfPanes: ServiceBranchDivergence[][] = [];
  for (let i = 0; i < panes.length; i += cols) {
    rowsOfPanes.push(panes.slice(i, i + cols));
  }
  return (
    <Box flexDirection="column" flexGrow={1} minHeight={0}>
      {rowsOfPanes.map((rowPanes, rowIndex) => (
        <Box key={rowIndex} flexDirection="row" flexGrow={1} flexBasis={0} minHeight={0}>
          {rowPanes.map((service, colIndex) => {
            const index = rowIndex * cols + colIndex;
            return (
              <LogsPaneView
                key={service.path}
                service={service}
                pane={logsPanes[service.path]}
                visibility={visibility}
                wrapLines={isPaneWrapped(paneWrap, service.path)}
                visibleLines={visibleLines}
                contentWidth={contentWidth}
                focused={index === subFocused}
                globalFilter={globalFilter}
                engaged={isPaneEngagedInGlobalFilter(paneFilterEngaged, service.path)}
                ownFilter={paneFilters[service.path] ?? null}
              />
            );
          })}
        </Box>
      ))}
    </Box>
  );
}

// Boundaries: "A pane's effective filter is (engaged ? global : pass) AND (own ?? pass)" —
// shared by LogsPaneView and FullscreenPane (both call applyLogFilters the same way, right
// after filterVisibleLines, same layer 5.1's stdout/stderr toggle already lives on).
function resolveEffectiveLines(pane: LogsPaneData | undefined, visibility: VisibilityFlags, globalFilter: LogFilterSpec, engaged: boolean, ownFilter: LogFilterSpec | null): LogLine[] {
  if (!pane) {
    return [];
  }
  return applyLogFilters(filterVisibleLines(pane.lines, visibility), engaged ? globalFilter : null, ownFilter);
}

function LogsPaneView({
  service,
  pane,
  visibility,
  wrapLines,
  visibleLines,
  contentWidth,
  focused,
  globalFilter,
  engaged,
  ownFilter,
}: {
  service: ServiceBranchDivergence;
  pane: LogsPaneData | undefined;
  visibility: VisibilityFlags;
  wrapLines: boolean;
  visibleLines: number;
  contentWidth: number;
  focused: boolean;
  globalFilter: LogFilterSpec;
  engaged: boolean;
  ownFilter: LogFilterSpec | null;
}) {
  const [contentRef, measuredSize] = useElementSize();
  const rowBudget = measuredSize !== null ? measuredSize.height : visibleLines;
  const resolvedContentWidth = measuredSize !== null ? Math.max(measuredSize.width, 1) : contentWidth;
  const lines = resolveEffectiveLines(pane, visibility, globalFilter, engaged, ownFilter);
  const windowLines = sliceVisibleWindow(lines, pane?.scrollOffset ?? 0, rowBudget, (line) =>
    computeLineRowCount(formatLogLine(line, visibility.showTimestamps), resolvedContentWidth, wrapLines),
  );
  // A pane with buffered lines that the current stdout/stderr/story-5.2 filters happen to
  // hide entirely must read differently from "no lines have arrived yet" — otherwise a user
  // who toggled off both stdout and stderr, or set an aggressive filter, is misleadingly told
  // the stream itself is empty (review fix, story 5.1; extended to the new filter layer).
  const allLinesHiddenByFilters = (pane?.lines.length ?? 0) > 0 && lines.length === 0;
  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      flexBasis={0}
      minHeight={0}
      minWidth={0}
      overflow="hidden"
      borderStyle="single"
      borderColor={focused ? colors.accent : colors.border}
      paddingX={1}
    >
      {/* User-reported: always bold (not just when sub-focused) so a service name stands out
          from its own log text at a glance, in a grid where several panes are visible at once. */}
      <Box flexDirection="row">
        <Box flexGrow={1} minWidth={0}>
          <Text bold color={focused ? colors.accent : colors.text} wrap="truncate-end">
            {service.service}
          </Text>
        </Box>
        {/* Story 5.3: inline health badge next to the service's logs (glyph+color paired) +
            the developer-triggered restart control's disabled state while restarting. */}
        <Box marginLeft={1}>
          <StatusBadge state={healthBadgeState(pane?.health ?? 'down')} />
          <Text color={colors['text-dim']}> {pane?.health ?? 'down'}</Text>
        </Box>
        {pane?.restarting || (pane?.health ?? 'down') === 'restarting' ? (
          <Text color={colors['text-dim']}> [R] restarting…</Text>
        ) : (
          <Text color={colors['text-dim']}> [R]</Text>
        )}
      </Box>
      {pane?.streamError ? <DimAnnotation text={pane.streamError.message} /> : null}
      {pane?.noMoreHistory && (pane?.scrollOffset ?? 0) > 0 ? <DimAnnotation text="no more history" /> : null}
      {!engaged ? (
        <DimAnnotation text="global filter: off" />
      ) : !isDefaultLogFilterSpec(globalFilter) ? (
        <DimAnnotation text={`global filter: ${formatLogFilterSpec(globalFilter)}`} />
      ) : null}
      {ownFilter !== null ? <DimAnnotation text={`pane filter: ${formatLogFilterSpec(ownFilter)}`} /> : null}
      <Box ref={contentRef} flexDirection="column" flexGrow={1} minHeight={0} minWidth={0}>
        {windowLines.length === 0 && !pane?.streamError ? (
          <Text color={colors['text-dim']}>{allLinesHiddenByFilters ? 'All lines hidden by filters' : 'Waiting for logs…'}</Text>
        ) : null}
        {windowLines.map((line, index) => (
          <Text key={index} color={line.stream === 'stderr' ? colors.error : colors.text} wrap={wrapLines ? 'wrap' : 'truncate-end'}>
            {formatLogLine(line, visibility.showTimestamps)}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

function FullscreenPane({
  repoPath,
  serviceName,
  pane,
  visibility,
  wrapLines,
  visibleLines,
  contentWidth,
  globalFilter,
  engaged,
  ownFilter,
}: {
  repoPath: string;
  // Captured directly at the point fullscreen was opened (store's logsFullscreenServiceName)
  // rather than re-derived via a live `rows.find(...)` lookup, which can miss (e.g. a
  // transient services-list load error while the preview is open) and silently fall back to a
  // bare "Logs" label right when the user needs the service name most (review fix).
  serviceName: string | null;
  pane: LogsPaneData | undefined;
  visibility: VisibilityFlags;
  wrapLines: boolean;
  visibleLines: number;
  contentWidth: number;
  globalFilter: LogFilterSpec;
  engaged: boolean;
  ownFilter: LogFilterSpec | null;
}) {
  const [contentRef, measuredSize] = useElementSize();
  const rowBudget = measuredSize !== null ? measuredSize.height : visibleLines;
  const resolvedContentWidth = measuredSize !== null ? Math.max(measuredSize.width, 1) : contentWidth;
  const lines = resolveEffectiveLines(pane, visibility, globalFilter, engaged, ownFilter);
  const windowLines = sliceVisibleWindow(lines, pane?.scrollOffset ?? 0, rowBudget, (line) =>
    computeLineRowCount(formatLogLine(line, visibility.showTimestamps), resolvedContentWidth, wrapLines),
  );
  // A pane with buffered lines that the current stdout/stderr/story-5.2 filters happen to
  // hide entirely must read differently from "no lines have arrived yet" — otherwise a user
  // who toggled off both stdout and stderr, or set an aggressive filter, is misleadingly told
  // the stream itself is empty (review fix, story 5.1; extended to the new filter layer).
  const allLinesHiddenByFilters = (pane?.lines.length ?? 0) > 0 && lines.length === 0;
  return (
    <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden" paddingX={spacing['pane-padding-x']}>
      <Box flexDirection="row">
        <Box flexGrow={1} minWidth={0}>
          <Text color={colors.accent} bold>
            {serviceName ?? 'Logs'}
          </Text>
        </Box>
        {/* Story 5.3: inline health badge + restart disabled state, mirroring the grid pane
            header above. */}
        <Box marginLeft={1}>
          <StatusBadge state={healthBadgeState(pane?.health ?? 'down')} />
          <Text color={colors['text-dim']}> {pane?.health ?? 'down'}</Text>
        </Box>
        {pane?.restarting || (pane?.health ?? 'down') === 'restarting' ? (
          <Text color={colors['text-dim']}> [R] restarting…</Text>
        ) : (
          <Text color={colors['text-dim']}> [R] restart</Text>
        )}
      </Box>
      {pane?.streamError ? <DimAnnotation text={pane.streamError.message} /> : null}
      {pane?.noMoreHistory && (pane?.scrollOffset ?? 0) > 0 ? <DimAnnotation text="no more history" /> : null}
      {!engaged ? (
        <DimAnnotation text="global filter: off" />
      ) : !isDefaultLogFilterSpec(globalFilter) ? (
        <DimAnnotation text={`global filter: ${formatLogFilterSpec(globalFilter)}`} />
      ) : null}
      {ownFilter !== null ? <DimAnnotation text={`pane filter: ${formatLogFilterSpec(ownFilter)}`} /> : null}
      <Box ref={contentRef} flexDirection="column" flexGrow={1} minHeight={0}>
        {windowLines.length === 0 && !pane?.streamError ? (
          <Text color={colors['text-dim']}>{allLinesHiddenByFilters ? 'All lines hidden by filters' : 'Waiting for logs…'}</Text>
        ) : null}
        {windowLines.map((line, index) => (
          <Text key={index} color={line.stream === 'stderr' ? colors.error : colors.text} wrap={wrapLines ? 'wrap' : 'truncate-end'}>
            {formatLogLine(line, visibility.showTimestamps)}
          </Text>
        ))}
      </Box>
      <DimAnnotation text="[Esc] back  [↑/↓] scroll  [c] clear  [t/o/p] toggle timestamps/stdout/stderr  [w] wrap/truncate  [R] restart" />
      <DimAnnotation text="[/] global filter  [f] pane filter  [g] toggle global engagement" />
    </Box>
  );
}

// Story 5.2: renders whichever scope's editor is open — one shared component/validation for
// both `/` (global) and `f` (pane), per Boundaries ("Both editors share one component and
// validation"). Purely presentational, mirroring ModalDialog's other call sites — all the
// actual keystroke handling lives in LogsZone's own useInput (Code Map: never a
// component-owned useInput here, same convention as BranchPicker/TextInputLine).
function LogFilterEditor({
  editor,
  serviceName,
  history,
  gridMaxRows,
  gridCursor,
  gridScrollOffset,
  gridAvailableWidth,
  gridAvailableHeight,
}: {
  editor: FilterEditorState;
  serviceName: string | null;
  history: string[];
  gridMaxRows: number;
  gridCursor: GridCursor | null;
  gridScrollOffset: number;
  gridAvailableWidth: number;
  gridAvailableHeight: number;
}) {
  const title = editor.scope === 'global' ? 'GLOBAL LOG FILTER' : `PANE LOG FILTER — ${serviceName ?? 'unknown'}`;
  // Story 5.4: the history grid browser — reuses command-bar.tsx's generalized grid primitives
  // over plain query strings (`getLabel = historyEntryLabel`, i.e. the identity function)
  // rather than a shared visual component (Code Map: "with its own small JSX loop").
  // Story 5.5 (OVERFLOW_HISTORY_GRID): a `verticalWindow` is now also passed — the grid gains
  // vertical pagination the same way it already had horizontal truncation/scroll, centered on
  // the highlighted cell's own row so it never scrolls out of view.
  const gridLayout =
    gridCursor !== null
      ? layoutCommandGrid(history, gridMaxRows, gridAvailableWidth, historyEntryLabel, gridScrollOffset, {
          maxVisibleRows: gridAvailableHeight,
          cursorRow: gridCursor.row,
        })
      : null;
  // Review fix: each column's width used to be computed from `gridLayout.columns` — already
  // vertically sliced — so the widest entry could scroll out of the visible window and shrink
  // the column, misaligning padding against the pre-5.5 stable width as the user scrolls
  // vertically. Widths are the full, unsliced column's own (mirrors `groupCommandsByColumn`'s
  // own column-major grouping, same source `useInput`'s row/cursor math already reads).
  const fullHistoryColumns = gridCursor !== null ? groupCommandsByColumn(history, gridMaxRows) : [];
  return (
    <ModalDialog title={title} onConfirm={() => {}} onCancel={() => {}} open>
      <TextInputLine label={editor.mode === 'regex' ? 'Regex' : 'Text'} value={editor.query} focused={gridCursor === null} />
      <Text color={colors.text}>Level: {editor.level ?? 'ALL'}</Text>
      {editor.error !== null ? <DimAnnotation text={editor.error} /> : null}
      {gridCursor !== null && gridLayout !== null ? (
        history.length === 0 ? (
          <DimAnnotation text="No history for this filter yet." />
        ) : (
          <>
            {gridLayout.truncated.top ? <Text color={colors['text-dim']}>▲ more above</Text> : null}
            <Box flexDirection="row">
              {gridLayout.truncated.left ? <Text color={colors['text-dim']}>… </Text> : null}
              {gridLayout.columns.map((column, columnIndex) => {
                const absoluteColumn = gridLayout.scrollOffset + columnIndex;
                const width = columnDisplayWidth(fullHistoryColumns[absoluteColumn] ?? column, historyEntryLabel);
                return (
                  <Box key={absoluteColumn} flexDirection="column" marginRight={HISTORY_GRID_COLUMN_GAP}>
                    {column.map((entry, rowIndex) => {
                      const absoluteRow = gridLayout.rowScrollOffset + rowIndex;
                      const isCursor = gridCursor.column === absoluteColumn && gridCursor.row === absoluteRow;
                      return (
                        <Text key={`${absoluteColumn}-${absoluteRow}`} color={isCursor ? colors.accent : colors['text-dim']}>
                          {isCursor ? '› ' : '  '}
                          {entry.padEnd(width)}
                        </Text>
                      );
                    })}
                  </Box>
                );
              })}
              {gridLayout.truncated.right ? <Text color={colors['text-dim']}> …</Text> : null}
            </Box>
            {gridLayout.truncated.bottom ? <Text color={colors['text-dim']}>▼ more below</Text> : null}
          </>
        )
      ) : null}
      <DimAnnotation
        text={
          gridCursor !== null
            ? '[↑/↓/←/→] browse history  [Enter] recall  [Esc] close'
            : '[Tab] text/regex  [Ctrl+←/→] level  [↑/↓] history  [Enter/Esc] done'
        }
      />
    </ModalDialog>
  );
}
