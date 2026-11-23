// tui/zones/logs: use-logs-state — the Logs zone's store selectors, local `useState`s and the
// actions-menu sequence ref. No derivation, no effects: those live in the layers built on top.
import { useRef, useState } from 'react';
import type { AppStore } from '../../store/app-store.js';
import type { GridCursor } from '../../shared/screens/command-bar/command-bar.js';
import type { LogsActionsMenuState } from './logs-actions-menu.js';
import type { FilterEditorState, LogsPaneFocus } from './logs-zone.logic.js';

export function useLogsState(useStore: AppStore) {
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
  const ruleSets = useStore((state) => state.logsRuleSets);
  const saveRuleSetAction = useStore((state) => state.saveLogsRuleSet);
  const renameRuleSetAction = useStore((state) => state.renameLogsRuleSet);
  const deleteRuleSetAction = useStore((state) => state.deleteLogsRuleSet);
  const rulesWarning = useStore((state) => state.logsRulesWarning);
  const dismissRulesWarning = useStore((state) => state.dismissLogsRulesWarning);

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

  // `Enter` on a Dashboard row lands here: select that service's pane (when it has a container)
  // and put the list cursor on it. Dropped once the listing is loaded without it.
  const pendingServiceFocus = useStore((state) => state.pendingServiceFocus);
  const clearPendingServiceFocus = useStore((state) => state.clearPendingServiceFocus);

  return {
    services,
    servicesStatus,
    loadEdtsBranches,
    edts,
    loadEdts,
    activeEdtUlid,
    logsEdtSelected,
    logsOtherSelected,
    toggleLogsEdtSelection,
    toggleLogsOtherSelection,
    selectAllLogsEdtServices,
    deselectAllLogsEdtServices,
    selectAllLogsOtherServices,
    deselectAllLogsOtherServices,
    logsNoContainer,
    logsListedHealth,
    resolveLogsContainerPresence,
    startLogsListedHealthPolling,
    stopLogsListedHealthPolling,
    logsFullscreenTarget,
    logsFullscreenServiceName,
    openLogsFullscreen,
    closeLogsFullscreen,
    logsPanes,
    listRatio,
    subscribeLogsPane,
    unsubscribeLogsPane,
    loadOlderLogsPane,
    clearLogsPane,
    listLogsPaneActions,
    runLogsPaneAction,
    runLogsPaneShortcut,
    restartMode,
    setLogsPaneScrollOffset,
    setZoneInputCaptured,
    setLogsPaneGridArrowsActive,
    filterHistory,
    commitFilterHistoryEntry,
    filterHistoryGridMaxRows,
    ruleSets,
    saveRuleSetAction,
    renameRuleSetAction,
    deleteRuleSetAction,
    rulesWarning,
    dismissRulesWarning,
    paneFocus,
    setPaneFocus,
    edtCursor,
    setEdtCursor,
    otherCursor,
    setOtherCursor,
    subFocus,
    setSubFocus,
    visibility,
    setVisibility,
    paneWrap,
    setPaneWrap,
    globalFilter,
    setGlobalFilter,
    paneFilterEngaged,
    setPaneFilterEngaged,
    paneFilters,
    setPaneFilters,
    filterEditor,
    setFilterEditor,
    historyGridCursor,
    setHistoryGridCursor,
    historyGridScroll,
    setHistoryGridScroll,
    actionsMenu,
    setActionsMenu,
    actionsMenuSeq,
    pendingServiceFocus,
    clearPendingServiceFocus,
  };
}

export type LogsState = ReturnType<typeof useLogsState>;
