// tui/zones/logs: the Logs zone — two multi-select service lists (active-EDT members / other
// manifest services) drive an auto-resizing grid of scrollable log panes, with a per-pane
// fullscreen view and a two-tier text/regex/level filter. A single `useInput` dispatches every
// keystroke to pure functions in logs-zone.logic.ts; overlays (filter editor, fullscreen) first.
import { basename } from 'node:path';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useWindowSize } from 'ink';
import { useInput } from '../../shared/hooks/use-input.js';
import { useZoneInputActive } from '../../shared/hooks/use-zone-input-active.js';
import type { ServiceBranchDivergence } from '../../../../../core/edt/list.js';
import type { ServiceStatusState } from '../../../../../core/service-status/index.js';
import { BoundedList } from '../../shared/components/bounded-list.js';
import { CheckboxListItem } from '../../shared/components/checkbox-list-item.js';
import { DimAnnotation } from '../../shared/components/dim-annotation.js';
import { formatHint } from '../../shared/components/hints.js';
import { useFooterContext } from '../../shared/hooks/use-footer-context.js';
import { STATUS_BADGES, StatusBadge } from '../../shared/components/status-badge.js';
import { ZoneLayout } from '../../shared/components/zone-layout.js';
import { colors, spacing } from '../../shared/theme/theme.js';
import { useAppStore, type AppStore, type LogsPaneData } from '../../store/app-store.js';
import { nextTextInputValue } from '../../shared/components/text-edit.js';
import { FullscreenPane } from './fullscreen-pane.js';
import { LogFilterEditor } from './log-filter-editor.js';
import {
  LOGS_ACTIONS_MENU_CLOSE,
  LOGS_ACTIONS_MENU_LIST_ERROR,
  LogsActionsMenu,
  logsActionsMenuRows,
  toMenuItems,
  type LogsActionsMenuState,
} from './logs-actions-menu.js';
import { resolveMenuKey } from '../../shared/components/menu-list.js';
import { LogsGrid } from './logs-grid.js';
import { useLogsSubscriptions } from './use-logs-subscriptions.js';
import {
  partitionServicesByEdtMembership,
} from '../edts/edts-zone.logic.js';
import { resolveFocusStep } from '../../shared/keys/focus-navigation.js';
import { resolveHistoryBrowseDown, resolveHistoryBrowseUp, resolveSnapBackBase } from '../../shared/input-history/index.js';
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
  LOGS_PANE_FOCUS_NAV,
  DEFAULT_LOG_FILTER,
  logsFooterContext,
  logsLegendHints,
  filterHistoryKeyString,
  filterVisibleLines,
  formatHealthLabel,
  healthBadgeState,
  historyEntryLabel,
  isAtOldestLine,
  isClearAllLogsKey,
  isDefaultLogFilterSpec,
  isPaneEngagedInGlobalFilter,
  isPaneRestartAdvertised,
  isPaneWrapped,
  isRestartingDisplay,
  isSelectAllKey,
  isWrapAllLogsKey,
  movePaneSubFocus,
  reindexPaneSubFocus,
  resolveFilterClearTarget,
  resolveFilterEditorDraft,
  resolveFullscreenScrollDirection,
  resolvePaneScrollDirection,
  resolveSelectAllToggle,
  resolveVisibilityToggleKey,
  setPaneGlobalFilterEngagement,
  setPaneLogFilter,
  splitNoContainerRows,
  toggleAllPanesWrapFlag,
  toggleFilterMode,
  toggleGlobalFilterEngagement,
  togglePaneWrapFlag,
  toggleVisibilityFlag,
  type FilterEditorState,
  type FilterHistoryKey,
  type LogFilterSpec,
  type LogsPaneFocus,
} from './logs-zone.logic.js';
import { StateLine } from '../../shared/components/state-line.js';
import { jumpSelection, moveSelection, resolveSelectionDirection, resolveSelectionJump } from '../../shared/keys/list-cursor.js';


// The info-only list of services without a container never takes more than this.
const WITHOUT_CONTAINER_MAX_ROWS = 5;

export function LogsZone({ useStore = useAppStore }: { useStore?: AppStore }) {
  // Dragging the splitter (Ctrl+W) re-renders only ZoneLayout; subscribing here re-renders the
  // grid panes too, so their useElementSize re-measures instead of keeping a stale row budget.
  useStore((state) => state.splitterRatios.logs);
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
  const selectAllLogsOtherServices = useStore((state) => state.selectAllLogsOtherServices);
  const deselectAllLogsOtherServices = useStore((state) => state.deselectAllLogsOtherServices);
  const logsNoContainer = useStore((state) => state.logsNoContainer);
  const logsListedHealth = useStore((state) => state.logsListedHealth);
  const resolveLogsContainerPresence = useStore((state) => state.resolveLogsContainerPresence);
  const startLogsListedHealthPolling = useStore((state) => state.startLogsListedHealthPolling);
  const stopLogsListedHealthPolling = useStore((state) => state.stopLogsListedHealthPolling);
  const logsFullscreenTarget = useStore((state) => state.logsFullscreenTarget);
  const logsFullscreenServiceName = useStore((state) => state.logsFullscreenServiceName);
  const openLogsFullscreen = useStore((state) => state.openLogsFullscreen);
  const closeLogsFullscreen = useStore((state) => state.closeLogsFullscreen);
  const logsPanes = useStore((state) => state.logsPanes);
  const listRatio = useStore((state) => state.splitterRatios.logs[0]);
  const subscribeLogsPane = useStore((state) => state.subscribeLogsPane);
  const unsubscribeLogsPane = useStore((state) => state.unsubscribeLogsPane);
  const loadOlderLogsPane = useStore((state) => state.loadOlderLogsPane);
  const clearLogsPane = useStore((state) => state.clearLogsPane);
  const listLogsPaneActions = useStore((state) => state.listLogsPaneActions);
  const runLogsPaneAction = useStore((state) => state.runLogsPaneAction);
  const runLogsPaneShortcut = useStore((state) => state.runLogsPaneShortcut);
  const restartMode = useStore((state) => state.settings.logs.restartMode);
  const setLogsPaneScrollOffset = useStore((state) => state.setLogsPaneScrollOffset);
  const setZoneInputCaptured = useStore((state) => state.setZoneInputCaptured);
  const setLogsPaneGridArrowsActive = useStore((state) => state.setLogsPaneGridArrowsActive);
  // The persisted filter-history lists, plus the setting driving the history grid browser's
  // max rows per column (independent of commandPalette.gridMaxRows).
  const filterHistory = useStore((state) => state.filterHistory);
  const commitFilterHistoryEntry = useStore((state) => state.commitFilterHistoryEntry);
  const filterHistoryGridMaxRows = useStore((state) => state.settings.logs.filterHistoryGridMaxRows);

  useEffect(() => {
    void loadEdtsBranches();
    void loadEdts();
    // Fires once on mount only, mirrors edts-zone.tsx's own mount effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Container presence and listed-row health follow the listed rows — one manifest.load per
  // uncached row, badges for rows that were never subscribed. `services`/`servicesStatus`
  // are stable store references, so this refires only on a real reload, never per render.
  useEffect(() => {
    const listed = servicesStatus === 'error' ? [] : (services ?? []);
    const paths = listed.map((row) => row.path);
    resolveLogsContainerPresence(paths);
    startLogsListedHealthPolling(paths);
  }, [services, servicesStatus, resolveLogsContainerPresence, startLogsListedHealthPolling]);
  useEffect(() => () => stopLogsListedHealthPolling(), [stopLogsListedHealthPolling]);

  const rows = servicesStatus === 'error' ? [] : (services ?? []);
  const focusedEdt = (edts ?? []).find((entry) => entry.ulid === activeEdtUlid);
  // Any manifest service can be streamed, not only active-EDT members — the partition is against
  // the tool-wide *active* EDT (not a selected row, unlike edts-zone's use of this function),
  // since the Logs zone has no EDT selector of its own. Container-less rows leave both
  // selectable lists for the info-only section below (presence resolves async in the store,
  // so they render in their membership list until then — never blocked on the load).
  const { edtServices, otherServices, withoutContainerServices } = useMemo(() => {
    const partitioned = partitionServicesByEdtMembership(rows, focusedEdt);
    const edt = splitNoContainerRows(partitioned.edtServices, logsNoContainer);
    const other = splitNoContainerRows(partitioned.otherServices, logsNoContainer);
    return {
      edtServices: edt.selectable,
      otherServices: other.selectable,
      withoutContainerServices: [...edt.withoutContainer, ...other.withoutContainer],
    };
  }, [rows, focusedEdt, logsNoContainer]);

  const [paneFocus, setPaneFocus] = useState<LogsPaneFocus>('edt-list');
  const [edtCursor, setEdtCursor] = useState(0);
  const [otherCursor, setOtherCursor] = useState(0);
  const [subFocus, setSubFocus] = useState(0);
  // Display settings live in the store (session-only) so they survive a tab switch: the t/o/p
  // visibility flags and the global filter are global, wrap / 'i' engagement / own filter are
  // per pane (keyed by repoPath) and dropped by the store when the service is deselected.
  // Wrap/truncate is per pane, so 'w' targets just the sub-focused/fullscreen pane, with
  // Shift+W as the explicit "apply to every open pane" (see isWrapAllLogsKey).
  const visibility = useStore((state) => state.logsVisibility);
  const setVisibility = useStore((state) => state.setLogsVisibility);
  const paneWrap = useStore((state) => state.logsPaneWrap);
  const setPaneWrap = useStore((state) => state.setLogsPaneWrap);
  const globalFilter = useStore((state) => state.logsGlobalFilter);
  const setGlobalFilter = useStore((state) => state.setLogsGlobalFilter);
  const paneFilterEngaged = useStore((state) => state.logsPaneFilterEngaged);
  const setPaneFilterEngaged = useStore((state) => state.setLogsPaneFilterEngaged);
  const paneFilters = useStore((state) => state.logsPaneFilters);
  const setPaneFilters = useStore((state) => state.setLogsPaneFilters);
  const [filterEditor, setFilterEditor] = useState<FilterEditorState | null>(null);
  // The history grid browser's cursor/scroll — non-null exactly while the grid is open (`↓` on an
  // untouched draft). Separate from FilterEditorState since it only exists while the editor does.
  const [historyGridCursor, setHistoryGridCursor] = useState<GridCursor | null>(null);
  const [historyGridScroll, setHistoryGridScroll] = useState(0);
  // The `a` actions menu of one pane — rows from the service-action registry, loaded on open.
  const [actionsMenu, setActionsMenu] = useState<LogsActionsMenuState | null>(null);
  // Bumped on every open so a late listing for an earlier menu is dropped.
  const actionsMenuSeq = useRef(0);
  // A listing still in flight when the zone unmounts must not touch its state.
  useEffect(
    () => () => {
      actionsMenuSeq.current += 1;
    },
    [],
  );

  // `Enter` on a Dashboard row lands here: select that service's pane (when it has a container)
  // and put the list cursor on it. Dropped once the listing is loaded without it.
  const pendingServiceFocus = useStore((state) => state.pendingServiceFocus);
  const clearPendingServiceFocus = useStore((state) => state.clearPendingServiceFocus);
  useEffect(() => {
    if (pendingServiceFocus === null) {
      return;
    }
    const inEdt = edtServices.findIndex((row) => row.path === pendingServiceFocus);
    const inOther = otherServices.findIndex((row) => row.path === pendingServiceFocus);
    if (inEdt >= 0) {
      if (!logsEdtSelected.includes(pendingServiceFocus)) {
        toggleLogsEdtSelection(pendingServiceFocus);
      }
      setEdtCursor(inEdt);
      setPaneFocus('edt-list');
    } else if (inOther >= 0) {
      if (!logsOtherSelected.includes(pendingServiceFocus)) {
        toggleLogsOtherSelection(pendingServiceFocus);
      }
      setOtherCursor(inOther);
      setPaneFocus('other-list');
    } else if (servicesStatus === 'error' || (servicesStatus === 'idle' && services !== null)) {
      // Not listed (container-less rows only appear in the info section): nothing to select.
    } else {
      return;
    }
    clearPendingServiceFocus();
  }, [
    pendingServiceFocus,
    edtServices,
    otherServices,
    servicesStatus,
    services,
    logsEdtSelected,
    logsOtherSelected,
    toggleLogsEdtSelection,
    toggleLogsOtherSelection,
    clearPendingServiceFocus,
  ]);

  // A request nobody consumed must not fire on a later visit.
  useEffect(() => () => clearPendingServiceFocus(), [clearPendingServiceFocus]);

  const clampedEdtCursor = edtServices.length === 0 ? 0 : Math.min(edtCursor, edtServices.length - 1);
  const clampedOtherCursor = otherServices.length === 0 ? 0 : Math.min(otherCursor, otherServices.length - 1);

  // Every listed row carries a badge — its subscribed pane's health, else the listed-row
  // poll's value, else `down` (the Update zone's missing-reads-as-down precedent). A
  // requested restart reads explicitly, never as the bare state.
  function displayHealthFor(repoPath: string): ServiceStatusState {
    const pane = logsPanes[repoPath];
    const rowHealth = pane?.health ?? logsListedHealth[repoPath] ?? 'down';
    return isRestartingDisplay(pane?.restarting ?? false, rowHealth) ? 'restarting' : rowHealth;
  }

  // Active panes render in a stable order (EDT-list selections first, then other-list ones) so
  // `subFocus`'s index keeps a consistent meaning as selections change.
  const activeRepoPaths = useMemo(() => [...logsEdtSelected, ...logsOtherSelected], [logsEdtSelected, logsOtherSelected]);
  const activePanes = useMemo(
    () => activeRepoPaths.map((path) => rows.find((row) => row.path === path)).filter((row): row is ServiceBranchDivergence => row !== undefined),
    [activeRepoPaths, rows],
  );

  useLogsSubscriptions({ activeRepoPaths, logsFullscreenTarget, rows, subscribeLogsPane, unsubscribeLogsPane });

  // The grid reflows and sub-focus moves to the nearest remaining pane.
  useEffect(() => {
    setSubFocus((current) => reindexPaneSubFocus(current, activePanes.length));
  }, [activePanes.length]);

  // The filter editor and the actions menu are modals too — every dialogOpen consumer
  // (zoneInputCaptured, logsPaneGridArrowsActive) treats them like fullscreen, since all of them
  // capture every keystroke.
  const dialogOpen = logsFullscreenTarget !== null || filterEditor !== null || actionsMenu !== null;
  useEffect(() => {
    setZoneInputCaptured(dialogOpen);
  }, [dialogOpen, setZoneInputCaptured]);
  useEffect(() => () => setZoneInputCaptured(false), [setZoneInputCaptured]);
  useFooterContext(
    'logs',
    logsFooterContext(
      filterEditor !== null,
      historyGridCursor !== null,
      {
        open: logsFullscreenTarget !== null,
        restartable: logsFullscreenTarget === null || isPaneRestartAdvertised(logsPanes[logsFullscreenTarget]),
      },
      restartMode,
      actionsMenu !== null,
    ),
    useStore,
  );

  // AppShell's global Left/Right zone-switch fires on the same keypress as this zone's useInput
  // (Ink dispatches to every mounted hook), so moving pane sub-focus with Left/Right would switch
  // zones without this flag. Only set while pane focus owns the arrows (fullscreen already
  // captures everything via zoneInputCaptured, so this stays false there).
  useEffect(() => {
    setLogsPaneGridArrowsActive(paneFocus === 'panes' && !dialogOpen);
  }, [paneFocus, dialogOpen, setLogsPaneGridArrowsActive]);
  useEffect(() => () => setLogsPaneGridArrowsActive(false), [setLogsPaneGridArrowsActive]);

  const windowSize = useWindowSize();
  // Every terminal-row/column budget the render derives from the live window size (pane grid,
  // fullscreen preview, filter-history grid browser, the two service lists' BoundedList windows)
  // — computed by one pure function (logs-zone.logic.ts), unit-testable without Ink.
  const {
    layout,
    visiblePaneCount,
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
    listRatio,
    windowRows: windowSize.rows,
    activePaneCount: activePanes.length,
    edtServiceCount: edtServices.length,
    otherServiceCount: otherServices.length,
    filterEditorOpen: filterEditor !== null,
    historyGridOpen: historyGridCursor !== null,
    filterHistoryGridMaxRows,
    actionsMenuRows: actionsMenu === null ? 0 : logsActionsMenuRows(actionsMenu),
  });

  function handlePaneScroll(repoPath: string, direction: 'up' | 'down'): void {
    const pane = logsPanes[repoPath];
    // Scroll math (and the "at oldest line" history-fetch trigger below) uses the *visible*
    // (toggled and filtered) line count, not the raw buffered `lines.length` — otherwise scroll
    // position and the oldest-line trigger diverge from what's actually rendered.
    const engagedGlobal = isPaneEngagedInGlobalFilter(paneFilterEngaged, repoPath) ? globalFilter : null;
    const ownFilter = paneFilters[repoPath] ?? null;
    const visibleLineCount = pane ? applyLogFilters(filterVisibleLines(pane.lines, visibility), engagedGlobal, ownFilter).length : 0;
    const nextOffset = adjustScrollOffset(pane?.scrollOffset ?? 0, direction, visibleLineCount);
    setLogsPaneScrollOffset(repoPath, nextOffset);
    if (direction === 'up' && isAtOldestLine(nextOffset, visibleLineCount) && pane && !pane.noMoreHistory) {
      void loadOlderLogsPane(repoPath);
    }
  }

  // Opens the filter-editor modal — `/` (global, any Logs-zone focus) or `f` (pane, sub-focused
  // grid pane / fullscreen only). Pre-fills the draft from the spec already active for that scope,
  // so re-opening shows what's currently applied rather than resetting it.
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

  // Opens the `a` actions menu on one pane and lists the registry's actions for its service.
  // A failed listing (or unwired restart ports) leaves one error line; Esc still closes.
  function openActionsMenu(repoPath: string, service: string): void {
    actionsMenuSeq.current += 1;
    const seq = actionsMenuSeq.current;
    setActionsMenu({ repoPath, service, cursor: 0, actions: null, error: null });
    void listLogsPaneActions(repoPath)
      .catch(() => null)
      .then((actions) => {
        if (actionsMenuSeq.current !== seq) {
          return;
        }
        setActionsMenu((current) =>
          current === null ? null : { ...current, actions, error: actions === null ? LOGS_ACTIONS_MENU_LIST_ERROR : null },
        );
      });
  }
  function closeActionsMenu(): void {
    actionsMenuSeq.current += 1;
    setActionsMenu(null);
  }
  // The slice's actions never reject by contract; the catch keeps a broken one from surfacing as
  // an unhandled rejection.
  function runPaneAction(repoPath: string, actionId: string, service: string): void {
    void runLogsPaneAction(repoPath, actionId, service).catch(() => {});
  }
  function runPaneShortcut(repoPath: string, shortcut: 'restart' | 'ide', service: string): void {
    void runLogsPaneShortcut(repoPath, shortcut, service).catch(() => {});
  }
  // The fullscreen pane's service name — captured when it opened, else the listed row, else the
  // repo directory's name (never the full path).
  function serviceNameFor(repoPath: string): string {
    return (
      (logsFullscreenTarget === repoPath ? logsFullscreenServiceName : null) ??
      rows.find((row) => row.path === repoPath)?.service ??
      (basename(repoPath) || repoPath)
    );
  }

  // The exact (scope, mode) history list backing the open editor — recomputed live off the
  // store's `filterHistory`, never cached locally, so a commit is immediately visible to the next
  // arrow-recall/grid open.
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

  const zoneInputActive = useZoneInputActive(useStore);
  useInput(
    (input, key) => {
      // The actions menu captures every keystroke while open: ↑/↓/Home/End move, Enter runs an
      // enabled row (the slice re-reads its availability first), Esc closes.
      if (actionsMenu !== null) {
        const items = toMenuItems(actionsMenu.actions ?? [], restartMode);
        const step = resolveMenuKey(key, actionsMenu.cursor, items, LOGS_ACTIONS_MENU_CLOSE);
        if (step.type === 'move') {
          // Functional update: the closed-over menu may predate a list that just loaded.
          setActionsMenu((current) => (current === null ? null : { ...current, cursor: step.cursor }));
        } else if (step.type === 'choose') {
          closeActionsMenu();
          if (step.choice !== LOGS_ACTIONS_MENU_CLOSE) {
            runPaneAction(actionsMenu.repoPath, step.choice, actionsMenu.service);
          }
        }
        return;
      }

      // The filter editor captures every keystroke while open, from the grid or fullscreen —
      // checked first. Tab toggles text/regex mode; Ctrl+Left/Right cycle the level restriction
      // (bare Left/Right belong to the text caret). Escape restores the scope's pre-open spec
      // (filterEditor.preOpen) — a true cancel; Enter closes, keeping what's committed — a true
      // confirm, as TextInputLine's "[Enter] confirm  [Esc] cancel" hint promises.
      if (filterEditor !== null) {
        // Esc always closes the *whole* filter editor, even while the history grid is open on
        // top of it — never just the grid.
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
          // Commit — a compiled, non-empty draft is pushed onto its exact (scope, mode) history
          // list before the editor closes.
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
        // Tab and Shift+Tab both flip: with only two modes, reversing is the same move.
        if (resolveFocusStep(input, key, 'tab') !== null) {
          // Text and regex are distinct (scope, mode) history lists — flipping mode mid-recall
          // drops any browsing state (a stale `index`/`savedDraft` would be reused against the new
          // mode's list on the next ↑/↓). Like a printable char/Backspace while browsing, the
          // recalled entry is discarded and the original draft carries over into the new mode.
          // Snapping back out of a browsed entry changes `query`, so the caret resets to its end
          // (programmatic-overwrite convention); an untouched draft's caret position carries over.
          const { base: baseQuery, cursor: baseCursor } = resolveSnapBackBase(
            filterEditor.query,
            filterEditor.cursor,
            filterEditor.browsing,
          );
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
        // Cursor navigation: bare Left/Right/Home/End move the caret only — Ctrl+Left/Right above
        // claims the level cycle — and never touch `query`/`browsing`/`error`, so a pure caret move
        // never snaps a browsed history entry back to the saved draft.
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
          // While browsing, Backspace snaps back to the saved draft with the backspace applied on
          // top, rather than editing the recalled entry in place — caret at the saved draft's end,
          // like the typed-char snap-back below.
          const { base, cursor } = resolveSnapBackBase(filterEditor.query, filterEditor.cursor, filterEditor.browsing);
          const result = nextTextInputValue({ value: base, cursor }, input, key);
          applyFilterEditorDraft({ ...filterEditor, query: result.value, cursor: result.cursor, browsing: null });
          return;
        }
        if (!key.ctrl && !key.meta && input.length > 0) {
          // Any printable character while browsing snaps back to the draft with that keystroke
          // applied on top, inserted at the caret.
          const { base, cursor } = resolveSnapBackBase(filterEditor.query, filterEditor.cursor, filterEditor.browsing);
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
        // `/`/`f`/`i` — same bare-key-scopes-to-one-pane idiom as `c`/`w` below, fullscreen's one
        // pane standing in for "the sub-focused grid pane".
        if (input === '/') {
          openGlobalFilterEditor();
          return;
        }
        if (input === 'f') {
          openPaneFilterEditor(logsFullscreenTarget);
          return;
        }
        if (input === 'i') {
          setPaneFilterEngaged((current) => toggleGlobalFilterEngagement(current, logsFullscreenTarget));
          return;
        }
        const scrollDirection = resolveFullscreenScrollDirection(key);
        if (scrollDirection !== null) {
          handlePaneScroll(logsFullscreenTarget, scrollDirection);
          return;
        }
        // Ctrl+C and W ("apply to all open logs") are deliberately no-ops here — fullscreen has
        // only the one pane, and the bare key below already covers it.
        if (key.ctrl && input === 'c') {
          return;
        }
        if (input === 'c') {
          clearLogsPane(logsFullscreenTarget);
          return;
        }
        if (input === 'W') {
          return;
        }
        if (input === 'w' && !key.ctrl) {
          setPaneWrap((current) => togglePaneWrapFlag(current, logsFullscreenTarget));
          return;
        }
        // `R` / `O` are shortcuts into the service-action registry (`R` per logs.restartMode,
        // `O` open in IDE); the registry decides availability and a disabled one shows its reason
        // on the pane. Uppercase only: lowercase `r` is the global Routes-zone mnemonic (AppShell
        // exact-matches it whenever zoneInputCaptured is false, and Ink forwards every keypress to
        // all mounted useInput hooks) and lowercase `o` is the stdout toggle.
        const fullscreenService = serviceNameFor(logsFullscreenTarget);
        if (input === 'R') {
          runPaneShortcut(logsFullscreenTarget, 'restart', fullscreenService);
          return;
        }
        if (input === 'O') {
          runPaneShortcut(logsFullscreenTarget, 'ide', fullscreenService);
          return;
        }
        if (input === 'a' && !key.ctrl && !key.meta) {
          openActionsMenu(logsFullscreenTarget, fullscreenService);
          return;
        }
        const toggle = resolveVisibilityToggleKey(input);
        if (toggle !== null) {
          setVisibility((current) => toggleVisibilityFlag(current, toggle));
        }
        return;
      }

      // R restarts the focused pane once panes are open, so it only retries the load when there
      // is no pane to restart.
      if (input === 'R' && servicesStatus === 'error' && activePanes.length === 0) {
        void loadEdtsBranches();
        return;
      }

      const paneStep = resolveFocusStep(input, key, LOGS_PANE_FOCUS_NAV.mode);
      if (paneStep !== null) {
        setPaneFocus((current) => cycleLogsPaneFocus(current, paneStep));
        return;
      }

      // `/` (any Logs-zone focus) opens the global filter's editor — focus-independent, so it is
      // checked ahead of the per-list dispatch below, like Tab just above.
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

      // Escape, when no editor is open: on a sub-focused grid pane, clears its own filter if set,
      // else disengages it from the global filter; with list focus, clears the global filter.
      // resolveFilterClearTarget is the pure resolver; this dispatches its result.
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
        // Ctrl+A is scoped to the focused list only — the EDT-members list, the third
        // section, and the other list's own unselected rows are never touched from here.
        if (isSelectAllKey(input, key)) {
          const otherPaths = otherServices.map((service) => service.path);
          if (resolveSelectAllToggle(otherPaths, logsOtherSelected) === 'select-all') {
            selectAllLogsOtherServices(otherPaths);
          } else {
            deselectAllLogsOtherServices();
          }
          return;
        }
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
      if (input === 'w' && !key.ctrl) {
        const focused = activePanes[subFocus];
        if (focused !== undefined) {
          setPaneWrap((current) => togglePaneWrapFlag(current, focused.path));
        }
        return;
      }
      // `f` opens the sub-focused pane's own filter editor; `i` toggles its engagement with the
      // global filter — same bare-key-scopes-to-one-pane idiom as `c`/`w` above.
      if (input === 'f') {
        const focused = activePanes[subFocus];
        if (focused !== undefined) {
          openPaneFilterEditor(focused.path);
        }
        return;
      }
      if (input === 'i') {
        const focused = activePanes[subFocus];
        if (focused !== undefined) {
          setPaneFilterEngaged((current) => toggleGlobalFilterEngagement(current, focused.path));
        }
        return;
      }
      // `R` / `O` / `a` on the sub-focused grid pane — the registry shortcuts and the actions
      // menu, like fullscreen (see there for why only uppercase `R`/`O`).
      if (input === 'R' || input === 'O') {
        const focused = activePanes[subFocus];
        if (focused !== undefined) {
          runPaneShortcut(focused.path, input === 'R' ? 'restart' : 'ide', focused.service);
        }
        return;
      }
      if (input === 'a' && !key.ctrl && !key.meta) {
        const focused = activePanes[subFocus];
        if (focused !== undefined) {
          openActionsMenu(focused.path, focused.service);
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
    { isActive: zoneInputActive },
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
          restartMode={restartMode}
        />
      ) : (
        <Box flexDirection="column" flexGrow={1} minHeight={0}>
          <Text color={colors['text-dim']}>LOGS</Text>
          <ZoneLayout
            zoneId="logs"
            useStore={useStore}
            first={
            <Box flexDirection="column" flexGrow={1} paddingX={spacing['pane-padding-x']} minHeight={0} overflow="hidden">
              <Text color={paneFocus === 'edt-list' ? colors.accent : colors['text-dim']}>ACTIVE EDT MEMBERS</Text>
              {servicesStatus === 'loading' && rows.length === 0 ? <StateLine kind="loading" subject="services" /> : null}
              {servicesStatus === 'error' ? <StateLine kind="error" subject="services" retry={activePanes.length === 0} /> : null}
              {focusedEdt === undefined ? <StateLine kind="empty" subject="EDT" text="No active EDT." /> : null}
              {focusedEdt !== undefined && edtServices.length === 0 && servicesStatus !== 'error' ? (
                <StateLine kind="empty" subject="services" text="No services in the active EDT." />
              ) : null}
              {/* Bounded to edtListMaxVisibleRows, following the cursor only while this list owns
                  focus — otherwise the window anchors to the top. */}
              <BoundedList
                items={edtServices}
                maxVisibleRows={edtListMaxVisibleRows}
                cursorIndex={paneFocus === 'edt-list' ? clampedEdtCursor : undefined}
                renderItem={(service, index) => {
                  const displayHealth = displayHealthFor(service.path);
                  return (
                    <Box key={service.path} flexDirection="row">
                      <Text color={colors.accent} wrap="truncate-end">{paneFocus === 'edt-list' && index === clampedEdtCursor ? '›' : ' '}</Text>
                      <CheckboxListItem label={service.service} state={logsEdtSelected.includes(service.path) ? 'checked' : 'unchecked'} />
                      <Box marginLeft={1}>
                        <Box flexShrink={0}><StatusBadge state={healthBadgeState(displayHealth)} /></Box>
                        <Text color={colors['text-dim']} wrap="truncate-end">{` ${formatHealthLabel(displayHealth)}`}</Text>
                      </Box>
                    </Box>
                  );
                }}
              />

              <Text color={paneFocus === 'other-list' ? colors.accent : colors['text-dim']}>OTHER SERVICES</Text>
              {otherServices.length === 0 && servicesStatus !== 'loading' && servicesStatus !== 'error' ? (
                <StateLine kind="empty" subject="services" text="No other managed services." />
              ) : null}
              <BoundedList
                items={otherServices}
                maxVisibleRows={otherListMaxVisibleRows}
                cursorIndex={paneFocus === 'other-list' ? clampedOtherCursor : undefined}
                renderItem={(service, index) => {
                  const displayHealth = displayHealthFor(service.path);
                  return (
                    <Box key={service.path} flexDirection="row">
                      <Text color={colors.accent} wrap="truncate-end">{paneFocus === 'other-list' && index === clampedOtherCursor ? '›' : ' '}</Text>
                      <CheckboxListItem label={service.service} state={logsOtherSelected.includes(service.path) ? 'checked' : 'unchecked'} />
                      <Box marginLeft={1}>
                        <Box flexShrink={0}><StatusBadge state={healthBadgeState(displayHealth)} /></Box>
                        <Text color={colors['text-dim']} wrap="truncate-end">{` ${formatHealthLabel(displayHealth)}`}</Text>
                      </Box>
                    </Box>
                  );
                }}
              />

              {/* Info-only: every registry service whose manifest declares no container, from
                  either membership list. No cursor, no checkbox, no Tab stop, no Ctrl+A —
                  presence resolves async in the store, so this appears once known. */}
              {withoutContainerServices.length > 0 ? (
                <Box flexDirection="column" marginTop={spacing['section-gap']}>
                  <Text color={colors['text-dim']}>SERVICES WITHOUT CONTAINER</Text>
                  <BoundedList
                    items={withoutContainerServices}
                    maxVisibleRows={WITHOUT_CONTAINER_MAX_ROWS}
                    renderItem={(service) => {
                      // A container-less service declaring a `healthUrl` still gets its real
                      // up/down status (AD-23), labelled in its badge's tone; the others read as
                      // a dim no container.
                      const health = logsListedHealth[service.path] ?? 'no-container';
                      return (
                        <Box key={service.path} flexDirection="row">
                          <Text color={colors['text-dim']} wrap="truncate-end"> {service.service}</Text>
                          <Box marginLeft={1}>
                            <Box flexShrink={0}><StatusBadge state={healthBadgeState(health)} /></Box>
                            <Text color={health === 'no-container' ? colors['text-dim'] : STATUS_BADGES[healthBadgeState(health)].color} wrap="truncate-end"> {formatHealthLabel(health)}</Text>
                          </Box>
                        </Box>
                      );
                    }}
                  />
                </Box>
              ) : null}

              {/* Hidden while the filter editor is open: every hint here is a services-list or
                  editor-opening key, all inert once the editor captures input. Rendered anyway,
                  this block plus the editor (a sibling below, Ink has no absolute positioning)
                  overflows the terminal and Ink's diff-render corrupts painted lines. Also bounded
                  (hintsMaxVisibleRows), since the lists above can push it past the terminal's
                  rows even with the editor closed. */}
              {filterEditor === null && actionsMenu === null ? (
                <Box flexDirection="column" marginTop={spacing['section-gap']}>
                  <BoundedList
                    items={logsLegendHints(visibility).map(formatHint)}
                    maxVisibleRows={hintsMaxVisibleRows}
                    renderItem={(text, index) => <DimAnnotation key={index} text={text} />}
                  />
                </Box>
              ) : null}
            </Box>
            }
            second={
            <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden">
              {activePanes.length === 0 ? (
                <DimAnnotation text="No service selected — select one or more services on the left to stream their logs." />
              ) : (
                <LogsGrid
                  panes={activePanes.slice(0, visiblePaneCount)}
                  hiddenPaneCount={activePanes.length - visiblePaneCount}
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
                  restartMode={restartMode}
                />
              )}
            </Box>
            }
          />
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
      {actionsMenu !== null ? <LogsActionsMenu menu={actionsMenu} restartMode={restartMode} /> : null}
    </Box>
  );
}

