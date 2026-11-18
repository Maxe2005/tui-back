// tui/zones/update: use-update-state — the Update zone's store selectors and local `useState`s /
// refs. No derivation of its own (it also hosts the bounds/window-size/config-panel hooks); effects live in the layers built on top.
import { useRef, useState } from 'react';
import { useWindowSize } from 'ink';
import type { AppStore } from '../../store/app-store.js';
import { useBounds } from '../../shared/bounds/bounds-context.js';
import { createFilterablePickListState, type FilterablePickListState } from '../../shared/components/index.js';
import { useUpdateConfigPanels } from './use-update-config-panels.js';

export function useUpdateState(useStore: AppStore, initialRecap: boolean) {
  const updateStatus = useStore((state) => state.updateStatus);
  const updateResults = useStore((state) => state.updateResults);
  const updateNote = useStore((state) => state.updateNote);
  const updateTopic = useStore((state) => state.updateTopic);
  const updateError = useStore((state) => state.updateError);
  const updateErrorCode = useStore((state) => state.updateErrorCode);
  const updateScope = useStore((state) => state.updateScope);
  const updateSelection = useStore((state) => state.updateSelection);
  const incidents = useStore((state) => state.incidents);
  const incidentPopupOpen = useStore((state) => state.incidentPopupOpen);
  const incidentToast = useStore((state) => state.incidentToast);
  const resolveUpdateIncident = useStore((state) => state.resolveUpdateIncident);
  const openIncidentPopup = useStore((state) => state.openIncidentPopup);
  const closeIncidentPopup = useStore((state) => state.closeIncidentPopup);
  const clearIncidentToast = useStore((state) => state.clearIncidentToast);
  // The queue popup's own UI state: which incident is selected and whether the keys drive the
  // list or the selected incident's guided menu.
  const [incidentIndex, setIncidentIndex] = useState(0);
  const [incidentMode, setIncidentMode] = useState<'list' | 'menu'>('list');
  const [incidentNow, setIncidentNow] = useState(() => Date.now());
  const updateConfig = useStore((state) => state.updateConfig);
  const openUpdateConfig = useStore((state) => state.openUpdateConfig);
  const setUpdateConfig = useStore((state) => state.setUpdateConfig);
  const closeUpdateConfig = useStore((state) => state.closeUpdateConfig);
  const confirmUpdateConfig = useStore((state) => state.confirmUpdateConfig);
  const listMergeSourceEdts = useStore((state) => state.listMergeSourceEdts);
  const chooseMergeSourceEdt = useStore((state) => state.chooseMergeSourceEdt);
  // The no-arg `:update-service` handoff (zone selection → pinned config, else the filterable
  // quick-pick) plus the pick's own open candidates.
  const updateServiceSelectRequest = useStore((state) => state.updateServiceSelectRequest);
  const clearUpdateServiceSelectionRequest = useStore((state) => state.clearUpdateServiceSelectionRequest);
  const updateServicePick = useStore((state) => state.updateServicePick);
  const openUpdateServicePick = useStore((state) => state.openUpdateServicePick);
  const closeUpdateServicePick = useStore((state) => state.closeUpdateServicePick);
  const serviceRestartInFlight = useStore((state) => state.serviceRestartInFlight);
  const runServiceRestart = useStore((state) => state.runServiceRestart);
  const describeServiceRestart = useStore((state) => state.describeServiceRestart);
  const markUpdateInterrupted = useStore((state) => state.markUpdateInterrupted);
  const activeEdt = useStore((state) => state.activeEdt);
  const edts = useStore((state) => state.edts);
  const requestQuit = useStore((state) => state.requestQuit);
  const setZoneInputCaptured = useStore((state) => state.setZoneInputCaptured);

  // The always-visible service list — the same active-EDT-scoped `edtsBranches` rows the Logs
  // and EDTs zones load, plus this zone's own live health poll and last-run-outcome map.
  const services = useStore((state) => state.edtsBranches);
  const servicesStatus = useStore((state) => state.edtsBranchesStatus);
  const loadEdtsBranches = useStore((state) => state.loadEdtsBranches);
  const loadEdts = useStore((state) => state.loadEdts);
  const updateServiceHealth = useStore((state) => state.updateServiceHealth);
  const lastServiceOutcomes = useStore((state) => state.lastServiceOutcomes);
  const liveServicePhase = useStore((state) => state.liveServicePhase);
  const liveServiceIssues = useStore((state) => state.liveServiceIssues);
  const liveServiceSteps = useStore((state) => state.liveServiceSteps);
  const updateNotice = useStore((state) => state.updateNotice);
  const liveServiceDone = useStore((state) => state.liveServiceDone);
  const liveSharedTypesPhase = useStore((state) => state.liveSharedTypesPhase);
  const lastServiceRuns = useStore((state) => state.lastServiceRuns);
  const startUpdateHealthPolling = useStore((state) => state.startUpdateHealthPolling);
  const stopUpdateHealthPolling = useStore((state) => state.stopUpdateHealthPolling);
  // The shared branch autocomplete's visible row cap + the edited row's own branch source —
  // the same store actions the EDT zone's own picker sessions use (never `deps.git`
  // directly).
  const branchDropdownMaxRows = useStore((state) => state.settings.edts.branchDropdownMaxRows);
  const listBranchesAction = useStore((state) => state.listBranches);
  // The user-defined "Open in editor" command line (empty: `$EDITOR`, else `vi`).
  const openInIde = useStore((state) => state.openInIde);

  const [quitConfirm, setQuitConfirm] = useState(false);
  const [blockerCursor, setBlockerCursor] = useState(0);
  // The last "Open in editor" launch failure for the raised blocker (null when the editor
  // started, or was never tried) — shown inside the blocker menu, which stays open.
  const [editorError, setEditorError] = useState<string | null>(null);
  // The row-local action menu's target + cursor — zone-local UI state (only cross-visit/cross-run
  // state belongs in update-slice.ts). Null when no menu is open.
  const [serviceMenu, setServiceMenu] = useState<{ service: string; repoPath: string } | null>(null);
  const [serviceMenuCursor, setServiceMenuCursor] = useState(0);
  // Whether the open menu offers the restart row — resolved from the row's manifest when the
  // menu opens (a container-less service without a recipe has nothing to restart). Defaults
  // to offered so the menu never flickers rows away before the lookup lands.
  const [serviceMenuRestartAvailable, setServiceMenuRestartAvailable] = useState(true);
  // The service list's selection cursor — zone-local UI state (only cross-visit/cross-run state
  // belongs in update-slice.ts).
  const [serviceCursor, setServiceCursor] = useState(0);
  // Whether service focus is dropped (`Esc`): the right pane then shows the last-update recap
  // and the idle footer prompt; an arrow key hands focus back. Zone-local UI state.
  const [recapActive, setRecapActive] = useState(initialRecap);
  // The recap's result list scrolls with PgUp/PgDn: this is the entry the window follows.
  const [recapCursor, setRecapCursor] = useState(0);
  // The full-screen report: the service it shows (null: closed), its top-anchored scroll offset
  // and the wrap/truncate toggle (default wrap) — zone-local UI state; the content itself is
  // derived from the store every render so it updates live.
  const [reportService, setReportService] = useState<string | null>(null);
  const [reportOffset, setReportOffset] = useState(0);
  const [reportWrap, setReportWrap] = useState(true);
  const bounds = useBounds();
  // The report pane's real row/column budget, reported by FullscreenReport after each layout so
  // the key handler clamps and pages against the exact numbers the view renders with. Until the
  // first measurement the fallback is the zone bounds minus the report's one header row.
  const reportLayout = useRef<{ rows: number; columns: number } | null>(null);
  // The service quick-pick's filter text, caret and highlighted row — zone-local UI state (the
  // candidate list itself is store state so `:update-service` can open it from any zone). The
  // shape and every transition are the shared FilterablePickList's.
  const [pickState, setPickState] = useState<FilterablePickListState>(createFilterablePickListState);
  const windowSize = useWindowSize();
  const configPanels = useUpdateConfigPanels({
    draft: updateConfig,
    windowRows: windowSize.rows,
    dropdownMax: branchDropdownMaxRows,
    setUpdateConfig,
    closeUpdateConfig,
    confirmUpdateConfig,
    listMergeSourceEdts,
    chooseMergeSourceEdt,
    listBranches: listBranchesAction,
  });
  const membersRatio = useStore((state) => state.splitterRatios.update[1]) ?? 0.4;

  return {
    updateStatus, updateResults, updateNote, updateTopic, updateError, updateErrorCode, updateScope, updateSelection,
    incidents, incidentPopupOpen, incidentToast, resolveUpdateIncident, openIncidentPopup, closeIncidentPopup, clearIncidentToast,
    incidentIndex, setIncidentIndex, incidentMode, setIncidentMode, incidentNow, setIncidentNow,
    updateConfig, openUpdateConfig, updateServiceSelectRequest, clearUpdateServiceSelectionRequest,
    updateServicePick, openUpdateServicePick, closeUpdateServicePick,
    serviceRestartInFlight, runServiceRestart, describeServiceRestart, markUpdateInterrupted,
    activeEdt, edts, requestQuit, setZoneInputCaptured,
    services, servicesStatus, loadEdtsBranches, loadEdts, updateServiceHealth, lastServiceOutcomes,
    liveServicePhase, liveServiceIssues, liveServiceSteps, updateNotice, liveServiceDone, liveSharedTypesPhase,
    lastServiceRuns, startUpdateHealthPolling, stopUpdateHealthPolling, openInIde,
    quitConfirm, setQuitConfirm, blockerCursor, setBlockerCursor, editorError, setEditorError,
    serviceMenu, setServiceMenu, serviceMenuCursor, setServiceMenuCursor, serviceMenuRestartAvailable, setServiceMenuRestartAvailable,
    serviceCursor, setServiceCursor, recapActive, setRecapActive, recapCursor, setRecapCursor,
    reportService, setReportService, reportOffset, setReportOffset, reportWrap, setReportWrap,
    bounds, reportLayout, pickState, setPickState, windowSize, configPanels, membersRatio,
  };
}

export type UpdateState = ReturnType<typeof useUpdateState>;
