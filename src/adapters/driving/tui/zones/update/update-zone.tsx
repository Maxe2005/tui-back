// tui/zones/update: the Update zone — runs core group-update in-process (AD-2) behind a pre-run
// configuration screen, with an always-visible service list (live health, last outcome, live
// phase and issue log). Dirty/conflicted repos pause the run on a bounded menu (stash / open in
// editor / cancel repo / cancel run); `q` mid-run asks to confirm and marks the EDT interrupted.
// Every keystroke decision is a pure function; useInput stays a thin dispatcher.
import { spawnSync } from 'node:child_process';
import { resolve as resolvePath } from 'node:path';
import { useEffect, useRef, useState } from 'react';
import { Box, Text, useWindowSize } from 'ink';
import { useInput } from '../../shared/hooks/use-input.js';
import type { GroupUpdateRepoResult, UpdateBlocker, UpdateBlockerChoice } from '../../../../../core/scripts/group-update.js';
import type { EdtRegistryEntry } from '../../../../../core/ports/edt-registry.js';
import { useAppStore, type AppStore } from '../../store/app-store.js';
import {
  BoundedList,
  DetailPane,
  ZoneLayout,
  ListRow,
  ModalDialog,
  Spinner,
  StatusBadge,
  createFilterablePickListState,
  handleFilterablePickListKey,
  type FilterablePickListState,
  type SummaryTone,
} from '../../shared/components/index.js';
import { colors, spacing } from '../../shared/theme/theme.js';
import { formatServiceMeta } from '../edts/edts-zone.logic.js';
import {
  deriveUpdateServiceStatus,
  formatLastUpdateRecap,
  formatLiveServiceDetail,
  formatServiceUpdateContext,
  formatServiceOutcomeDetail,
  isServiceTargetedByRun,
  partitionUpdateServiceRows,
  resolveEditorCommand,
  resolveRecapToggle,
  resolveUpdatePaneRows,
  applyReportScroll,
  buildServiceReport,
  inferSettledSteps,
  jumpToFailedStep,
  reportMaxOffset,
  resolveReportKey,
  PENDING_STEPS,
  splitUpdateServiceRows,
  UPDATE_MEMBERS_HEADER,
  UPDATE_OTHERS_HEADER,
  updateFooterContext,
} from './update-zone.logic.js';
import { UpdateServiceDetail } from './update-service-detail.js';
import { FullscreenReport } from './fullscreen-report.js';
import { useBounds } from '../../shared/bounds/bounds-context.js';
import { UPDATE_SERVICE_MENU_ESCAPE, UpdateServiceMenuDialog, resolveServiceMenuChoice, visibleServiceMenuItems } from './update-service-menu-dialog.js';
import { resolveMenuKey, type MenuItem } from '../../shared/components/menu-list.js';
import { UpdateServicePickDialog, toServicePickItems } from './update-service-pick-dialog.js';
import { UpdateConfigPanels } from './update-config-panels.js';
import { useUpdateConfigPanels } from './use-update-config-panels.js';
import { StateLine } from '../../shared/components/state-line.js';
import { formatHint, formatHints } from '../../shared/components/hints.js';
import { useFooterContext } from '../../shared/hooks/use-footer-context.js';
import { updateConfigFooterContext } from './update-config-panels.logic.js';
import { jumpSelection, moveSelection, resolveSelectionDirection, resolveSelectionJump } from '../../shared/keys/list-cursor.js';
import { ClampedParagraph } from '../../shared/components/truncated-text.js';
import { UpdateIncidentsDialog } from './update-incidents-dialog.js';
import { formatQuitRunCounts, reduceIncidentListKey } from './update-incidents.logic.js';

// Rough terminal-chrome budget (top bar, zone-tab bar, footer, the "UPDATE" title row, the list
// column's section header/loading/error lines) subtracted from the window size before the
// service list's BoundedList sees it — an approximation, like edts-zone.tsx's
// EDTS_SERVICE_LISTS_CHROME_ROWS.
const UPDATE_SERVICE_LIST_CHROME_ROWS = 8;

export const UPDATE_IDLE_PROMPT = formatHints([['M', 'EDT update'], ['P', 'this service'], ['Enter', 'service actions']]);
export const UPDATE_ALL_REPOS_PROMPT = formatHint(['A', 'all-repos maintenance mode (every managed repo)']);
export const UPDATE_INTERRUPTED_OFFER = `Last update was interrupted — ${formatHint(['Enter', 'service actions'])}`;
export const UPDATE_NO_RECAP = 'No update has run yet in this session.';
export const UPDATE_RUNNING_LABEL = 'Updating member services…';
export const UPDATE_ALL_RUNNING_LABEL = 'Updating all managed repos…';
export const UPDATE_SELECTION_RUNNING_LABEL = 'Updating selected services…';
export const UPDATE_QUIT_CONFIRM_TITLE = 'QUIT MID-RUN';
export const UPDATE_QUIT_CONFIRM_BODY = 'A group update is in progress. Quit and mark this EDT interrupted?';
export const UPDATE_QUIT_CONFIRM_BODY_ALL = 'A group update is in progress. Quit without marking anything interrupted?';

// Collapses a detail message to one line — git/runtime stderr is multi-line, and a row is
// always exactly one rendered line.
function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

// A per-service outcome row — glyph always paired with the outcome word (never color
// alone), followed by the kebab-case code and the human detail message.
export function formatUpdateRow(row: GroupUpdateRepoResult): string {
  switch (row.outcome) {
    case 'updated':
      return `✔ ${row.service} — updated`;
    case 'skipped': {
      const code = row.detail?.code ?? 'skipped';
      const message = row.detail?.message !== undefined ? `: ${oneLine(row.detail.message)}` : '';
      return `○ ${row.service} — skipped (${code})${message}`;
    }
    case 'failed': {
      const code = row.detail?.code ?? 'failed';
      const message = row.detail?.message !== undefined ? `: ${oneLine(row.detail.message)}` : '';
      return `✖ ${row.service} — failed (${code})${message}`;
    }
  }
}

export function resolveUpdateTone(results: readonly GroupUpdateRepoResult[]): SummaryTone {
  if (results.some((row) => row.outcome === 'failed')) {
    return 'error';
  }
  if (results.some((row) => row.outcome === 'skipped')) {
    return 'warning';
  }
  return 'success';
}

// The DetailPane summary line for a finished run: every targeted service is named by count
// with an outcome from the closed set — none silently absent. The all-repos scope renders
// its own title variant (no EDT topic to name).
export function formatUpdateSummary(topic: string, results: readonly GroupUpdateRepoResult[]): string {
  const updated = results.filter((row) => row.outcome === 'updated').length;
  const skipped = results.filter((row) => row.outcome === 'skipped').length;
  const failed = results.filter((row) => row.outcome === 'failed').length;
  if (topic === 'all-repos') {
    return `All repos: ${updated} updated, ${skipped} skipped, ${failed} failed.`;
  }
  return `EDT "${topic}": ${updated} updated, ${skipped} skipped, ${failed} failed.`;
}

// The next idle render offers a re-run when the active EDT entry carries `interrupted`
// (an abandoned run) — a re-run is a true resume in effect because applied merges are
// no-ops.
export function shouldOfferRerun(
  edts: readonly EdtRegistryEntry[] | null,
  activeEdt: string | null,
): boolean {
  if (edts === null || activeEdt === null) {
    return false;
  }
  return edts.some((entry) => entry.ulid === activeEdt && entry.status === 'interrupted');
}

export function shouldConfirmQuit(input: string, updateStatus: string): boolean {
  return input === 'q' && updateStatus === 'running';
}

// The separate all-repos trigger: `a` while idle/done/error opens the confirm gate (never
// while a run is in flight — a second trigger is rejected by the core lock instead).
export function shouldOpenAllConfirm(input: string, updateStatus: string): boolean {
  return (input === 'a' || input === 'A') && updateStatus !== 'running';
}

// The EDT-scoped main trigger — `m` while idle/done/error opens the config pre-scoped to every
// EDT member (never while a run is in flight — a second trigger is rejected by the same guard as
// every other scope).
export function shouldOpenEdtConfig(input: string, updateStatus: string): boolean {
  return (input === 'm' || input === 'M') && updateStatus !== 'running';
}

// The single-service trigger — `p` while idle/done/error opens the config pre-scoped to the
// highlighted row (the dispatcher ignores it when no row is selected).
export function shouldOpenSingleConfig(input: string, updateStatus: string): boolean {
  return (input === 'p' || input === 'P') && updateStatus !== 'running';
}

// The trigger mapping — `a` opens the pre-run configuration screen pre-scoped to every managed
// repo, `m` to the EDT members, `p` to the highlighted row; `Enter` opens the per-service action menu
// for the selected row (Update this service / Clean restart / Cancel). No trigger ever starts
// an unconfigured run. Pure because the zone's `useInput` is never driven in tests, so an inline
// mapping would let a wiring regression back to a direct `runGroupUpdate` go undetected.
export type UpdateTriggerAction = 'open-edt-config' | 'open-all-config' | 'open-service-menu' | 'open-single-config' | 'none';

export function resolveUpdateTrigger(
  input: string,
  key: { return?: boolean },
  updateStatus: string,
): UpdateTriggerAction {
  if (updateStatus === 'running') {
    return 'none';
  }
  if (shouldOpenEdtConfig(input, updateStatus)) {
    return 'open-edt-config';
  }
  if (shouldOpenAllConfirm(input, updateStatus)) {
    return 'open-all-config';
  }
  if (shouldOpenSingleConfig(input, updateStatus)) {
    return 'open-single-config';
  }
  if (key.return === true) {
    return 'open-service-menu';
  }
  return 'none';
}

export type AllConfirmDecision = 'confirm' | 'cancel';

// The all-repos modal gate: [Enter] confirms (the run starts), [Esc] cancels. Anything
// else is ignored so a stray keystroke never launches the wider-blast-radius run.
export function resolveAllConfirm(input: string, key: { return?: boolean; escape?: boolean }): AllConfirmDecision | null {
  if (key.return === true) {
    return 'confirm';
  }
  if (key.escape === true) {
    return 'cancel';
  }
  return null;
}

export type QuitConfirmDecision = 'confirm' | 'cancel';

export function resolveQuitConfirm(input: string, key: { return?: boolean; escape?: boolean }): QuitConfirmDecision | null {
  if (key.return === true) {
    return 'confirm';
  }
  if (key.escape === true) {
    return 'cancel';
  }
  return null;
}

// The assisted-resolution menu — the seam's fixed choices rendered as `ListRow`s navigated like
// the EDT zone's `SERVICE_ACTION_MENU_ITEMS` (arrows/Home/End + Enter). `Escape` answers
// `cancel-repo`: the least-destructive unblock (the repo is skipped, the rest of the run
// continues) so a stray keystroke never cancels the run.
export const UPDATE_BLOCKER_TITLE = 'UPDATE BLOCKED';

export type UpdateBlockerMenuValue = 'stash' | 'edited' | 'cancel-repo' | 'cancel-run' | 'fetch';

export type UpdateBlockerMenuItem = MenuItem<UpdateBlockerMenuValue>;

export const UPDATE_BLOCKER_MENU_ESCAPE: UpdateBlockerMenuValue = 'cancel-repo';

export const UPDATE_BLOCKER_MENU_ITEMS: readonly UpdateBlockerMenuItem[] = Object.freeze([
  { value: 'stash', label: 'Stash changes and continue' },
  { value: 'edited', label: 'Open in editor, then retry' },
  { value: 'cancel-repo', label: 'Cancel this repo (continue with the rest)' },
  { value: 'cancel-run', label: 'Cancel the whole run' },
]);

// The choices offered for a blocker kind. A merge conflict drops `stash`: git refuses to
// stash unmerged paths, and once the conflict is resolved and staged a stash silently
// shelves the resolution and clears the merge (the retry then re-conflicts) — the editor
// retry and the two cancels are the only meaningful exits there.
export function blockerMenuItems(kind: UpdateBlocker['kind'], branch?: string): readonly UpdateBlockerMenuItem[] {
  if (kind === 'unpushed-commits') {
    // No stash (nothing is dirty); the plain fetch comes first as the proposed way out.
    return [
      { value: 'fetch', label: `Simple fetch (git fetch origin ${branch ?? '<branch>'}) and continue` },
      { value: 'edited', label: 'Open in editor, then retry' },
      { value: 'cancel-repo', label: 'Cancel this service (continue with the rest)' },
      { value: 'cancel-run', label: 'Cancel the whole run' },
    ];
  }
  return kind === 'merge-conflict' ? UPDATE_BLOCKER_MENU_ITEMS.filter((item) => item.value !== 'stash') : UPDATE_BLOCKER_MENU_ITEMS;
}

// The modal body names the blocked service, its repo path, and the blocker kind —
// mid-merge/mid-rebase rows stress that the pre-existing state is reported, never
// auto-touched.
export function formatBlockerBody(blocker: UpdateBlocker): string {
  switch (blocker.kind) {
    case 'dirty-worktree':
      return `"${blocker.service}" has uncommitted changes (${blocker.repoPath}).`;
    case 'merge-conflict':
      return `"${blocker.service}" hit a merge conflict (${blocker.repoPath}).`;
    case 'mid-merge':
      return `"${blocker.service}" is already mid-merge from an earlier run (${blocker.repoPath}) — left as-is.`;
    case 'unpushed-commits': {
      const commits = blocker.commits ?? [];
      return `There are unpushed commits on branch ${blocker.branch ?? '?'} of service "${blocker.service}", which prevents a clean fetch. How to proceed? Unpushed: ${commits.join(' | ')}`;
    }
    case 'mid-rebase':
      return `"${blocker.service}" is already mid-rebase from an earlier run (${blocker.repoPath}) — rebases are never touched.`;
  }
}

// A re-presented merge conflict (a failed stash/edit attempt) carries core's retry counter
// and the reason the last attempt did not settle it — rendered under the body so the
// endless resolve-and-retry loop stays legible. Null on a first prompt.
export function formatBlockerRetry(blocker: UpdateBlocker): string | null {
  if (blocker.retry === undefined || blocker.retry <= 0) {
    return null;
  }
  const reason = blocker.retryReason !== undefined && blocker.retryReason !== '' ? ` — ${blocker.retryReason}` : '';
  return `↻ Retry #${String(blocker.retry)} still blocked${reason}`;
}

// The driving-side editor launch — core only ever sees the `edited` choice. Spawns the resolved
// editor command (see resolveEditorCommand) on the blocked repo with the terminal attached and
// waits for exit. The exit status is deliberately unread: core's re-verification is the gate (a
// no-op edit, or a GUI editor that returns immediately, simply re-presents the menu). Only a
// command that could not be started at all is reported, so a misconfigured setting is never a
// silent no-op.
export type LaunchEditorResult = { ok: true } | { ok: false; message: string };

export function launchEditor(repoPath: string, configured = ''): LaunchEditorResult {
  const { binary, args } = resolveEditorCommand(configured, process.env.EDITOR, repoPath);
  const result = spawnSync(binary, args, { stdio: 'inherit' });
  if (result.error !== undefined) {
    return { ok: false, message: `Could not launch "${binary}": ${result.error.message}` };
  }
  return { ok: true };
}

// The zone opens on the global recap view with no service focused (`initialRecap`); an arrow
// key focuses a service. Tests pass `initialRecap={false}` to start on a service.
// Rows the detail pane keeps around the running list / the recap's result lines.
const RUNNING_LIST_CHROME_ROWS = 8;
const RECAP_CHROME_ROWS = 14;
const RECAP_CONTEXT_MAX_LINES = 4;

export function UpdateZone({ useStore = useAppStore, initialRecap = true }: { useStore?: AppStore; initialRecap?: boolean }) {
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
  const awaitingServices = new Set(incidents.map((incident) => incident.blocker.service));
  const popupOpen = incidentPopupOpen && incidents.length > 0;
  const selectedIncidentIndex = Math.min(incidentIndex, Math.max(incidents.length - 1, 0));
  const selectedIncident = incidents[selectedIncidentIndex];
  // The guided menu's blocker: only while the popup's menu mode is active.
  const updateBlocker = popupOpen && incidentMode === 'menu' ? (selectedIncident?.blocker ?? null) : null;
  const incidentListActive = popupOpen && incidentMode === 'list';
  const resolveUpdateBlocker = (choice: UpdateBlockerChoice): void => {
    if (selectedIncident !== undefined) {
      resolveUpdateIncident(selectedIncident.id, choice);
    }
    setIncidentMode('list');
  };
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
  const commandBarOpen = useStore((state) => state.commandBarOpen);
  const registryScreenOpen = useStore((state) => state.registryScreenOpen);
  const settingsScreenOpen = useStore((state) => state.settingsScreenOpen);
  const resetScreenOpen = useStore((state) => state.resetScreenOpen);
  const resizeMode = useStore((state) => state.resizeMode);

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
  const lastServiceRuns = useStore((state) => state.lastServiceRuns);
  const startUpdateHealthPolling = useStore((state) => state.startUpdateHealthPolling);
  const stopUpdateHealthPolling = useStore((state) => state.stopUpdateHealthPolling);
  // The shared branch autocomplete's visible row cap + the edited row's own branch source —
  // the same store actions the EDT zone's own picker sessions use (never `deps.git`
  // directly).
  const branchDropdownMaxRows = useStore((state) => state.settings.edts.branchDropdownMaxRows);
  const listBranchesAction = useStore((state) => state.listBranches);
  // The user-defined "Open in editor" command line (empty: `$EDITOR`, else `vi`).
  const editorCommand = useStore((state) => state.settings.general.editorCommand);

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
  const windowSizeForConfig = useWindowSize();
  const configPanels = useUpdateConfigPanels({
    draft: updateConfig,
    windowRows: windowSizeForConfig.rows,
    dropdownMax: branchDropdownMaxRows,
    setUpdateConfig,
    closeUpdateConfig,
    confirmUpdateConfig,
    listMergeSourceEdts,
    chooseMergeSourceEdt,
    listBranches: listBranchesAction,
  });

  // The layer that owns the keyboard, in the same priority order as the key handler below.
  useFooterContext(
    'update',
    updateFooterContext({
      blocker: updateBlocker !== null,
      incidentList: incidentListActive,
      config: updateConfig !== null ? updateConfigFooterContext(configPanels.view, configPanels.box) : null,
      servicePick: updateServicePick !== null,
      quitConfirm,
      serviceMenu: serviceMenu !== null,
      selectRequest: updateServiceSelectRequest,
      report: reportService !== null,
    }),
    useStore,
  );

  useEffect(() => {
    void loadEdtsBranches();
    void loadEdts();
    // Fires once on mount only, like logs-zone.tsx's mount effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = servicesStatus === 'error' ? [] : (services ?? []);
  const focusedEdt = (edts ?? []).find((entry) => entry.ulid === activeEdt);
  const allServiceRows = partitionUpdateServiceRows(rows, focusedEdt);
  // The open row-local menu's visible rows — the restart row drops out for a container-less
  // service without a recipe (see describeServiceRestart), and the cursor clamps with it so
  // a row that arrived while browsing never points past the last visible item.
  const serviceMenuItems = visibleServiceMenuItems(serviceMenuRestartAvailable);
  const clampedServiceMenuCursor = Math.min(serviceMenuCursor, serviceMenuItems.length - 1);

  // This run's currently-targeted services — an all-repos run targets every listed service; an
  // EDT-scoped run only the active EDT's members (the same `runningMembers` the spinner below
  // reads). A run confirmed with a narrowed selection targets only the selected rows inside that
  // scope — see isServiceTargetedByRun.
  const edtMembers = edts?.find((entry) => entry.ulid === activeEdt)?.members ?? [];
  const isAllRun = updateScope === 'all';
  const runningMemberPaths = new Set(edtMembers.map((member) => member.repoPath));
  const runTarget = { scope: isAllRun ? ('all' as const) : ('edt' as const), memberPaths: runningMemberPaths, selection: updateSelection };
  // Whether the in-flight run covers this row at all (finished services included), vs.
  // `isRowTargeted`: covered and still being processed.
  const isRowInRun = (row: { service: string; path: string }): boolean =>
    updateStatus === 'running' && isServiceTargetedByRun(row, runTarget);
  const isRowTargeted = (row: { service: string; path: string }): boolean => isRowInRun(row) && liveServiceDone[row.service] !== true;
  // During a run the list keeps only the services the run covers.
  const serviceRows = updateStatus === 'running' ? allServiceRows.filter(isRowInRun) : allServiceRows;
  const panes = splitUpdateServiceRows(serviceRows);
  const clampedServiceCursor = serviceRows.length === 0 ? 0 : Math.min(serviceCursor, serviceRows.length - 1);
  const selectedServiceRow = serviceRows[clampedServiceCursor];
  // Triggers act on a focused service only — never on the remembered cursor behind the recap.
  const focusedServiceRow = recapActive ? undefined : selectedServiceRow;
  const runningMembers = edtMembers.filter((member) => isRowTargeted({ service: member.service, path: member.repoPath }));
  // A narrowed all-scope run (a single service outside the active EDT) names its selected
  // rows — the generic "loading members" line is only for the unfiltered all-repos run.
  const runningSelectedRows = isAllRun && updateSelection !== null ? serviceRows.filter(isRowTargeted) : [];

  // Starts (or restarts, on a changed service list) this zone's own health poll whenever the
  // loaded service list changes — independent of the Logs zone's subscriptions. Torn down on
  // unmount so no poll timer outlives the zone.
  const servicePaths = rows.map((row) => row.path).join('\u0000');
  useEffect(() => {
    if (servicePaths === '') {
      // A service list going from non-empty to empty (edtsBranches becomes `[]`, or
      // servicesStatus flips to 'error') stops the previous poll cycle too — otherwise a stale
      // interval keeps polling repoPaths no longer displayed.
      stopUpdateHealthPolling();
      return;
    }
    startUpdateHealthPolling(servicePaths.split('\u0000'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servicePaths]);
  useEffect(() => () => stopUpdateHealthPolling(), [stopUpdateHealthPolling]);

  // While any dialog owns the keystroke, every global shortcut (including `?`
  // help and the zone mnemonics) must not fire — the same zoneInputCaptured gate the EDTs
  // zone's own dialogs use. The blocker menu captures hardest: while a repo waits, no
  // other zone key may fire at all. A pending no-arg service request captures too, so a
  // second trigger can't race the pick opening underneath it.
  useEffect(() => {
    setZoneInputCaptured(
      quitConfirm || updateConfig !== null || popupOpen || serviceMenu !== null || updateServicePick !== null || updateServiceSelectRequest || reportService !== null,
    );
  }, [quitConfirm, updateConfig, popupOpen, serviceMenu, updateServicePick, updateServiceSelectRequest, reportService, setZoneInputCaptured]);

  // A newly opened service menu always starts browsing on its first row.
  useEffect(() => {
    if (serviceMenu !== null) {
      setServiceMenuCursor(0);
    }
  }, [serviceMenu]);

  // A newly opened incident menu always starts on its first row; every selection change or
  // popup open lands back on the list.
  useEffect(() => {
    if (incidentMode === 'menu') {
      setBlockerCursor(0);
    }
    setEditorError(null);
  }, [incidentMode, selectedIncident?.id]);
  // A choice is always for the incident the menu opened on: if that one leaves the queue (or the
  // selection shifts) the keys fall back to the list rather than answering another incident.
  const menuIncidentId = useRef<string | null>(null);
  useEffect(() => {
    if (incidentMode !== 'menu') {
      menuIncidentId.current = null;
    } else if (menuIncidentId.current === null) {
      menuIncidentId.current = selectedIncident?.id ?? null;
    } else if (menuIncidentId.current !== selectedIncident?.id) {
      menuIncidentId.current = null;
      setIncidentMode('list');
    }
  }, [incidentMode, selectedIncident?.id]);
  useEffect(() => {
    if (!popupOpen) {
      setIncidentMode('list');
      setIncidentIndex(0);
    }
  }, [popupOpen]);
  // The popup's ages tick while it is open; the toast of a late incident fades on its own.
  useEffect(() => {
    if (!popupOpen) {
      return undefined;
    }
    setIncidentNow(Date.now());
    const timer = setInterval(() => setIncidentNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [popupOpen]);
  useEffect(() => {
    if (incidentToast === null) {
      return undefined;
    }
    const timer = setTimeout(clearIncidentToast, 5000);
    return () => clearTimeout(timer);
  }, [incidentToast, clearIncidentToast]);

  // A newly opened service pick always starts unfiltered on its first row. The single reset point
  // is the pick *closing* — whoever closed it (Enter, Esc, or the store on a run start/reset) —
  // so the next open never paints a frame of the previous session's filter. Keyed on the open
  // boolean, never the candidate list, so a store refresh doesn't wipe typed filter text.
  const isUpdateServicePickOpen = updateServicePick !== null;
  useEffect(() => {
    if (!isUpdateServicePickOpen) {
      setPickState(createFilterablePickListState());
    }
  }, [isUpdateServicePickOpen]);

  // Consumes the no-arg `:update-service` request raised through the store. A highlighted row
  // pre-scopes the config to that one service (`p` without the keypress); with no row selected
  // the filterable quick-pick opens. Runs through the same guarded openers, so a request racing a
  // run start is rejected rather than opening a screen mid-run.
  useEffect(() => {
    if (!updateServiceSelectRequest) {
      return;
    }
    clearUpdateServiceSelectionRequest();
    if (focusedServiceRow !== undefined) {
      void openUpdateConfig({ service: focusedServiceRow.service, repoPath: focusedServiceRow.path });
    } else {
      void openUpdateServicePick();
    }
    // Keyed on primitives — selectedServiceRow is re-derived every render, so depend on
    // its identity fields rather than the object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateServiceSelectRequest]);

  // The full report's content for a service, read from the store every render: the live steps and
  // issue log while a run targets it, the settled last run afterwards (falling back to its last
  // outcome row when no run snapshot exists). `available` drives whether `f` opens anything.
  const reportInputFor = (service: string) => {
    const row = serviceRows.find((candidate) => candidate.service === service);
    const live = row !== undefined && (isRowTargeted(row) || serviceRestartInFlight[resolvePath(row.path)] !== undefined);
    const run = lastServiceRuns[service];
    const outcome = lastServiceOutcomes[service] ?? updateResults.find((candidate) => candidate.service === service);
    const issues = liveServiceIssues[service] ?? [];
    const settled = run ?? (outcome !== undefined ? { steps: inferSettledSteps(outcome), result: outcome, source: undefined, target: row?.branch ?? null, topic: updateTopic } : undefined);
    const mode: 'live' | 'last' | 'never' = live ? 'live' : settled !== undefined ? 'last' : 'never';
    return {
      available: live || settled !== undefined || issues.length > 0,
      input: {
        service,
        mode,
        context: settled !== undefined && !live ? formatServiceUpdateContext(settled.source, settled.target, settled.topic) : null,
        steps: live ? (liveServiceSteps[service] ?? PENDING_STEPS) : settled?.steps,
        result: live ? undefined : settled?.result,
        issues,
      },
    };
  };
  const report = reportService !== null ? buildServiceReport(reportInputFor(reportService).input) : null;
  const REPORT_HEADER_ROWS = 1;
  const reportBudget = Math.max(1, bounds.rows - REPORT_HEADER_ROWS);
  const reportWidth = Math.max(1, bounds.columns - 2 * spacing['pane-padding-x']);
  const reportAvailable = reportService !== null && reportInputFor(reportService).available;
  // A report whose service lost everything to show (a new run reset it) closes on its own.
  useEffect(() => {
    if (reportService !== null && !reportAvailable) {
      setReportService(null);
      setReportOffset(0);
    }
  }, [reportService, reportAvailable]);
  const openReport = (service: string): boolean => {
    if (!reportInputFor(service).available) {
      return false;
    }
    setReportService(service);
    setReportOffset(0);
    return true;
  };

  useInput(
    (input, key) => {
      // The incident popup owns every keystroke while open — `q` must not open the quit-confirm
      // underneath it. In list mode the arrows pick an incident, Enter opens its guided menu and
      // Esc closes the popup without resolving anything (incidents and services stay paused).
      if (incidentListActive) {
        const step = reduceIncidentListKey(key, selectedIncidentIndex, incidents.length);
        if (step.type === 'move') {
          setIncidentIndex(step.index);
        } else if (step.type === 'open-menu') {
          setIncidentMode('menu');
        } else if (step.type === 'close') {
          closeIncidentPopup();
        }
        return;
      }
      // The guided menu of the selected incident (Esc steps back to the list: resolving is always
      // an explicit choice).
      if (updateBlocker !== null) {
        if (key.escape === true) {
          setIncidentMode('list');
          return;
        }
        const step = resolveMenuKey(key, blockerCursor, blockerMenuItems(updateBlocker.kind, updateBlocker.branch), UPDATE_BLOCKER_MENU_ESCAPE);
        if (step.type === 'move') {
          setBlockerCursor(step.cursor);
        } else if (step.type === 'choose') {
          if (step.choice === 'edited') {
            // Driving-side editor: spawn the configured command and wait for exit, then
            // report the choice — core re-verifies before resuming (a no-op edit
            // re-presents). An editor that could not be started reports nothing to core:
            // the menu stays open on its error line so another choice can be made.
            const launched = launchEditor(updateBlocker.repoPath, editorCommand);
            if (!launched.ok) {
              setEditorError(launched.message);
              return;
            }
          }
          resolveUpdateBlocker(step.choice);
        }
        return;
      }
      // While the pre-run configuration screen is open it owns every keystroke — the run starts
      // only through its confirm path, with exactly the confirmed configuration.
      if (updateConfig !== null) {
        configPanels.handleKey(input, key);
        return;
      }
      // While the service quick-pick is open it owns every keystroke — the shared pick reducer
      // interprets it; the zone only acts on its outcome: Enter confirms the highlighted service
      // into a config pre-scoped to it, Esc closes without opening anything.
      if (updateServicePick !== null) {
        const pickItems = toServicePickItems(updateServicePick);
        const result = handleFilterablePickListKey(pickState, pickItems, input, key);
        if (result.type === 'update') {
          // Re-run the reducer against the latest state rather than applying the result
          // computed from `pickState` (this render's snapshot): two keypresses delivered
          // before a re-render (key-repeat) must each build on the previous one.
          setPickState((previous) => {
            const latest = handleFilterablePickListKey(previous, pickItems, input, key);
            return latest.type === 'update' ? latest.state : previous;
          });
          return;
        }
        closeUpdateServicePick();
        if (result.type === 'select') {
          void openUpdateConfig({ service: result.item.value.service, repoPath: result.item.value.repoPath });
        }
        return;
      }
      if (quitConfirm) {
        const decision = resolveQuitConfirm(input, key);
        if (decision === 'confirm') {
          setQuitConfirm(false);
          void markUpdateInterrupted().then(() => requestQuit());
        } else if (decision === 'cancel') {
          setQuitConfirm(false);
        }
        return;
      }
      // While the row-local action menu is open it owns every keystroke — arrows/Home/End move,
      // Enter chooses, Esc cancels. Update routes to the config screen pre-scoped to that single
      // service; clean restart runs the standalone single-service use-case for that repo alone.
      if (serviceMenu !== null) {
        const menuItems = visibleServiceMenuItems(serviceMenuRestartAvailable);
        const step = resolveMenuKey(key, Math.min(serviceMenuCursor, menuItems.length - 1), menuItems, UPDATE_SERVICE_MENU_ESCAPE);
        if (step.type === 'move') {
          setServiceMenuCursor(step.cursor);
        } else if (step.type === 'choose') {
          const action = resolveServiceMenuChoice(step.choice, serviceMenu);
          if (action.type === 'open-config') {
            setServiceMenu(null);
            void openUpdateConfig({ service: action.service, repoPath: action.repoPath });
          } else if (action.type === 'restart') {
            setServiceMenu(null);
            void runServiceRestart(action.repoPath);
          } else {
            setServiceMenu(null);
          }
        }
        return;
      }
      // The full-screen report owns every keystroke (before the recap toggle and the triggers, so
      // `p` and `Esc` keep their report meaning). Scrolling is clamped to what still fills the pane.
      if (reportService !== null && report !== null) {
        const action = resolveReportKey(input, key);
        const budget = reportLayout.current?.rows ?? reportBudget;
        const width = reportLayout.current?.columns ?? reportWidth;
        const maxOffset = reportMaxOffset(report.lines, budget, width, reportWrap);
        if (action === 'close') {
          setReportService(null);
        } else if (action === 'toggle-wrap') {
          const nextWrap = !reportWrap;
          setReportWrap(nextWrap);
          setReportOffset(Math.min(reportOffset, reportMaxOffset(report.lines, budget, width, nextWrap)));
        } else if (action === 'next-failed' || action === 'prev-failed') {
          const target = jumpToFailedStep(report.failedLines, reportOffset, action === 'next-failed' ? 'next' : 'prev');
          if (target !== null) {
            setReportOffset(Math.min(target, maxOffset));
          }
        } else if (action !== null) {
          setReportOffset(applyReportScroll(reportOffset, action, maxOffset, budget));
        }
        return;
      }
      // `Enter` on a failed recap row opens that service's report; other rows do nothing.
      if (recapActive && key.return) {
        const row = updateResults[Math.min(recapCursor, Math.max(0, updateResults.length - 1))];
        if (row !== undefined && row.outcome === 'failed') {
          openReport(row.service);
        }
        return;
      }
      // `Esc` drops service focus onto the last-update recap; an arrow key restores it (the
      // remembered service, unmoved).
      if (recapActive && (key.pageDown || key.pageUp)) {
        const page = Math.max(1, windowSizeForConfig.rows - RECAP_CHROME_ROWS - 1);
        const last = Math.max(0, updateResults.length - 1);
        setRecapCursor((current) => (key.pageDown ? Math.min(last, current + page) : Math.max(0, current - page)));
        return;
      }
      const recapToggle = resolveRecapToggle(recapActive, key);
      if (recapToggle.handled) {
        setRecapActive(recapToggle.recapActive);
        return;
      }
      if (input === 'R' && servicesStatus === 'error' && updateStatus !== 'running') {
        void loadEdtsBranches();
        return;
      }
      // The service list's own cursor — moves regardless of run state (browsing is harmless
      // mid-run); none of the triggers below use arrow/Home/End.
      const jump = resolveSelectionJump(key);
      if (jump !== null) {
        setServiceCursor(jumpSelection(jump, serviceRows.length));
        return;
      }
      const direction = resolveSelectionDirection(key);
      if (direction !== null) {
        setServiceCursor((current) => moveSelection(current, direction, serviceRows.length));
        return;
      }
      if (input === 'i' && incidents.length > 0) {
        openIncidentPopup();
        return;
      }
      if ((input === 'f' || input === 'F') && focusedServiceRow !== undefined) {
        openReport(focusedServiceRow.service);
        return;
      }
      if (updateStatus === 'running') {
        if (shouldConfirmQuit(input, updateStatus)) {
          setQuitConfirm(true);
        }
        return;
      }
      // `a`/`m`/`p` pre-scope the pre-run configuration screen to every managed repo, the EDT,
      // or the highlighted row; `Enter` opens the row-local action menu — no git/docker action
      // runs before a choice is confirmed through its own path.
      const trigger = resolveUpdateTrigger(input, key, updateStatus);
      if (trigger === 'open-edt-config') {
        void openUpdateConfig('edt');
        return;
      }
      if (trigger === 'open-all-config') {
        void openUpdateConfig('all');
        return;
      }
      if (trigger === 'open-single-config') {
        if (focusedServiceRow !== undefined) {
          void openUpdateConfig({ service: focusedServiceRow.service, repoPath: focusedServiceRow.path });
        }
        return;
      }
      if (trigger === 'open-service-menu') {
        if (focusedServiceRow !== undefined) {
          const target = { service: focusedServiceRow.service, repoPath: focusedServiceRow.path };
          setServiceMenu(target);
          // Offered until the manifest says otherwise — a slow lookup must never hide the
          // row, only a confirmed container-less-without-recipe manifest does.
          setServiceMenuRestartAvailable(true);
          void describeServiceRestart(target.repoPath).then(({ restartAvailable }) => {
            setServiceMenuRestartAvailable(restartAvailable);
          });
        }
      }
    },
    { isActive: !commandBarOpen && !registryScreenOpen && !settingsScreenOpen && !resetScreenOpen && !resizeMode },
  );

  // The active EDT's own membership — the per-service spinner rows during a run, before the
  // core use-case resolves with its per-service outcome rows. An all-repos run targets no
  // single EDT, so it shows the generic loading line instead of EDT member rows.
  const offerRerun = shouldOfferRerun(edts, activeEdt);
  const baseRunningLabel = !isAllRun ? UPDATE_RUNNING_LABEL : updateSelection !== null ? UPDATE_SELECTION_RUNNING_LABEL : UPDATE_ALL_RUNNING_LABEL;
  // Services paused on an incident are not in flight: they wait on the developer.
  const quitCounts = formatQuitRunCounts(
    incidents.length,
    Object.keys(liveServicePhase).filter((service) => !awaitingServices.has(service)).length,
  );
  // The zone header counts the pending incidents next to the run label.
  const runningLabel = incidents.length > 0 ? `${baseRunningLabel} · ◐ ${incidents.length} awaiting you (i)` : baseRunningLabel;

  // This zone's service-list chrome budget (an approximation, like edts-zone.tsx/logs-zone.tsx).
  const windowSize = useWindowSize();
  const serviceListMaxVisibleRows = Math.max(windowSize.rows - UPDATE_SERVICE_LIST_CHROME_ROWS, 3);
  const membersRatio = useStore((state) => state.splitterRatios.update[1]) ?? 0.4;
  const paneRows = resolveUpdatePaneRows(serviceListMaxVisibleRows, membersRatio);
  // Pane-local cursor: members come first in the flat row array, so others are offset by them.
  const cursorInMembers = clampedServiceCursor < panes.members.length;
  const renderServiceRow = (row: (typeof serviceRows)[number], index: number) => {
    const health = updateServiceHealth[row.path] ?? 'down';
    const lastOutcome = lastServiceOutcomes[row.service];
    const isTargeted = isRowTargeted(row);
    // The coarse standalone-restart flag (the in-flight map holds this service's resolved
    // repoPath) and the live phase, which refines the glyph to `migrating`.
    const isRestarting = serviceRestartInFlight[resolvePath(row.path)] !== undefined;
    const status = deriveUpdateServiceStatus(health, lastOutcome?.outcome, isTargeted, isRestarting, liveServicePhase[row.service], awaitingServices.has(row.service));
    return (
      <Box key={row.path} flexDirection="row">
        <StatusBadge state={status} />
        {status === 'no-container' ? (
          <Box marginLeft={1}>
            <Text color={colors['text-dim']}>no container</Text>
          </Box>
        ) : null}
        <Box marginLeft={1} flexGrow={1} minWidth={0}>
          <ListRow label={row.service} meta={formatServiceMeta(row)} selected={!recapActive && index === clampedServiceCursor} />
        </Box>
      </Box>
    );
  };

  const branchByService = Object.fromEntries(serviceRows.map((row) => [row.service, row.branch]));
  const recap = formatLastUpdateRecap(updateTopic, updateResults, updateSelection, branchByService);
  const selectedLastOutcome = selectedServiceRow !== undefined ? lastServiceOutcomes[selectedServiceRow.service] : undefined;

  // The live per-service view — while a run targets the selected service the detail pane shows
  // its current step plus the issue log (resolved/unresolved) instead of the last-outcome view;
  // afterwards it reverts to the final outcome. A standalone restart reports through the same
  // channel; before its first emission the formatter reports `starting`, never a stale outcome.
  const selectedLivePhase = selectedServiceRow !== undefined ? liveServicePhase[selectedServiceRow.service] : undefined;
  const selectedLiveIssues = selectedServiceRow !== undefined ? (liveServiceIssues[selectedServiceRow.service] ?? []) : [];
  const isSelectedTargeted = selectedServiceRow !== undefined && isRowTargeted(selectedServiceRow);
  const isSelectedRestarting =
    selectedServiceRow !== undefined && serviceRestartInFlight[resolvePath(selectedServiceRow.path)] !== undefined;
  const selectedRun = selectedServiceRow !== undefined ? lastServiceRuns[selectedServiceRow.service] : undefined;
  const showLiveDetail = isSelectedTargeted || isSelectedRestarting;
  const detailBody =
    selectedServiceRow === undefined
      ? 'No service selected.'
      : showLiveDetail
        ? formatLiveServiceDetail(selectedLivePhase, selectedLiveIssues)
        : formatServiceOutcomeDetail(selectedLastOutcome);

  return (
    <Box flexDirection="column" flexGrow={1} backgroundColor={colors.surface}>
      {/* Only the title line carries left padding — the outer Box stays unpadded so it doesn't
          double up the list/detail panes' own paddingX. */}
      {report !== null ? (
        <FullscreenReport lines={report.lines} offset={reportOffset} wrapLines={reportWrap} visibleLines={reportBudget} contentWidth={reportWidth} onLayout={(rows, columns) => { reportLayout.current = { rows, columns }; }} />
      ) : (
        <>
      <Box paddingX={spacing['pane-padding-x']}>
        <Text color={colors['text-dim']}>UPDATE</Text>
      </Box>
      <ZoneLayout
        zoneId="update"
        useStore={useStore}
        first={
          <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden" paddingX={spacing['pane-padding-x']}>
            <Text color={colors['text-dim']}>SERVICES</Text>
            {servicesStatus === 'loading' && rows.length === 0 ? <StateLine kind="loading" subject="services" /> : null}
            {servicesStatus === 'error' ? <StateLine kind="error" subject="services" retry={updateStatus !== 'running'} /> : null}
            {rows.length === 0 && servicesStatus !== 'loading' && servicesStatus !== 'error' ? (
              <StateLine kind="empty" subject="managed services" text="No managed services found." />
            ) : null}
            {/* Two distinct panes like the EDTs zone's, resizable through boundary 1. Every row
                always carries exactly one glyph from the closed
                up/down/restarting/updating/migrating/error set — never blank, never bridged
                through a generic state. */}
            <ZoneLayout
              zoneId="update"
              boundary={1}
              useStore={useStore}
              first={
                <>
                  <Text color={!recapActive && cursorInMembers ? colors.accent : colors['text-dim']} wrap="truncate-end">{UPDATE_MEMBERS_HEADER}</Text>
                  {panes.members.length === 0 ? <Text color={colors['text-dim']}>No services in this EDT.</Text> : null}
                  <BoundedList
                    items={panes.members}
                    maxVisibleRows={paneRows.members}
                    cursorIndex={cursorInMembers ? clampedServiceCursor : undefined}
                    renderItem={(row, index) => renderServiceRow(row, index)}
                  />
                </>
              }
              second={
                <>
                  <Text color={!recapActive && !cursorInMembers ? colors.accent : colors['text-dim']} wrap="truncate-end">{UPDATE_OTHERS_HEADER}</Text>
                  {panes.others.length === 0 ? <Text color={colors['text-dim']}>No other services.</Text> : null}
                  <BoundedList
                    items={panes.others}
                    maxVisibleRows={paneRows.others}
                    cursorIndex={cursorInMembers ? undefined : clampedServiceCursor - panes.members.length}
                    renderItem={(row, index) => renderServiceRow(row, panes.members.length + index)}
                  />
                </>
              }
            />
          </Box>
        }
        second={
          <Box flexDirection="column" minHeight={0} overflow="hidden" paddingX={spacing['pane-padding-x']}>
            {!recapActive ? (
              selectedServiceRow !== undefined &&
              !isSelectedRestarting &&
              (isSelectedTargeted || selectedRun !== undefined || selectedLastOutcome === undefined) ? (
                <UpdateServiceDetail
                  service={selectedServiceRow.service}
                  mode={isSelectedTargeted ? 'live' : selectedRun !== undefined ? 'last' : 'never'}
                  context={
                    selectedRun !== undefined && !isSelectedTargeted
                      ? formatServiceUpdateContext(selectedRun.source, selectedRun.target, selectedRun.topic)
                      : null
                  }
                  steps={isSelectedTargeted ? liveServiceSteps[selectedServiceRow.service] : selectedRun?.steps}
                  result={isSelectedTargeted ? undefined : selectedRun?.result}
                  issues={selectedLiveIssues}
                />
              ) : (
                <DetailPane title={selectedServiceRow !== undefined ? selectedServiceRow.service : 'Service'}>{detailBody}</DetailPane>
              )
            ) : null}
            {!recapActive && updateStatus === 'running' ? (
              <Box>
                <Spinner />
                <Text color={colors.text} wrap="truncate-end"> {runningLabel}</Text>
              </Box>
            ) : null}
            {incidentToast !== null ? (
              <Text color={colors.warning} wrap="truncate-end">
                ◐ {incidentToast} — press i
              </Text>
            ) : null}
            {updateNotice !== null ? (
              <Text color={colors.warning} wrap="truncate-end">
                ⚠ {updateNotice.message} ({updateNotice.code})
              </Text>
            ) : null}
            {updateStatus === 'error' ? (
              <Box flexDirection="column">
                <ClampedParagraph color={colors.error} maxLines={4}>{`${updateError ?? 'Group update failed.'}${updateErrorCode !== null ? ` (code: ${updateErrorCode})` : ''}`}</ClampedParagraph>
                {recapActive ? <Text color={colors['text-dim']} wrap="truncate-end">{UPDATE_IDLE_PROMPT}</Text> : null}
              </Box>
            ) : null}
            {recapActive ? (
              <Box flexDirection="column">
            {updateStatus === 'running' ? (
              <Box flexDirection="column">
                <Box>
                  <Spinner />
                  <Text color={colors.text} wrap="truncate-end"> {runningLabel}</Text>
                </Box>
                {runningSelectedRows.length > 0 ? (
                  <BoundedList
                    items={runningSelectedRows}
                    chromeRows={RUNNING_LIST_CHROME_ROWS}
                    renderItem={(row) => (
                      <Box key={row.path}>
                        <Spinner />
                        <Text color={colors.text} wrap="truncate-end"> {row.service}{row.branch !== null ? ` (${row.branch})` : ''}</Text>
                      </Box>
                    )}
                  />
                ) : isAllRun || runningMembers.length === 0 ? (
                  <StateLine kind="loading" subject="member services" />
                ) : (
                  <BoundedList
                    items={runningMembers}
                    chromeRows={RUNNING_LIST_CHROME_ROWS}
                    renderItem={(member) => (
                      <Box key={member.repoPath}>
                        <Spinner />
                        <Text color={colors.text} wrap="truncate-end"> {member.service} ({member.branch})</Text>
                      </Box>
                    )}
                  />
                )}
              </Box>
            ) : null}
            {updateStatus === 'done' && updateTopic !== null ? (
              // The zero-member no-op carries its note as the primary outcome line — rendering
              // the success-toned `0 updated, 0 skipped, 0 failed` counts DetailPane for it
              // would overstate a no-op as a result.
              updateNote !== null && updateResults.length === 0 ? (
                <Box flexDirection="column">
                  <Text color={colors.text} wrap="truncate-end">{updateNote}</Text>
                  <Text color={colors['text-dim']} wrap="truncate-end">{UPDATE_IDLE_PROMPT}</Text>
                </Box>
              ) : (
                <Box flexDirection="column">
                  {recap !== null ? (
                    <Box flexDirection="column">
                      <Text bold color={colors.text} wrap="truncate-end">
                        {recap.title}
                      </Text>
                      {recap.contextLines.slice(0, RECAP_CONTEXT_MAX_LINES).map((line) => (
                        <Text key={line} color={colors['text-dim']} wrap="truncate-end">
                          {line}
                        </Text>
                      ))}
                      <BoundedList
                        items={recap.resultLines}
                        chromeRows={RECAP_CHROME_ROWS}
                        cursorIndex={Math.min(recapCursor, Math.max(0, recap.resultLines.length - 1))}
                        renderItem={(line, index) => (
                          // Duplicate service names occur within one EDT — key by line + index.
                          <Text key={`${line}-${index}`} color={colors.text} wrap="truncate-end">
                            {line}
                          </Text>
                        )}
                      />
                    </Box>
                  ) : null}
                  <DetailPane
                    title={updateTopic === 'all-repos' ? 'All-repos update' : 'Group update'}
                    summary={{ tone: resolveUpdateTone(updateResults), text: formatUpdateSummary(updateTopic, updateResults) }}
                  >
                    {updateNote ?? UPDATE_IDLE_PROMPT}
                  </DetailPane>
                </Box>
              )
            ) : null}
            {updateStatus === 'idle' ? (
              <Box flexDirection="column">
                <Text color={colors.text} wrap="truncate-end">{offerRerun ? UPDATE_INTERRUPTED_OFFER : UPDATE_IDLE_PROMPT}</Text>
                <Text color={colors['text-dim']} wrap="truncate-end">{UPDATE_ALL_REPOS_PROMPT}</Text>
                <Text color={colors['text-dim']} wrap="truncate-end">{UPDATE_NO_RECAP}</Text>
              </Box>
            ) : null}
              </Box>
            ) : null}
          </Box>
        }
      />
        </>
      )}
      <ModalDialog title={UPDATE_QUIT_CONFIRM_TITLE} open={quitConfirm}>
        <ClampedParagraph color={colors.text} maxLines={4}>{`${isAllRun ? UPDATE_QUIT_CONFIRM_BODY_ALL : UPDATE_QUIT_CONFIRM_BODY}${quitCounts !== null ? ` ${quitCounts}` : ''}`}</ClampedParagraph>
      </ModalDialog>
      {updateConfig !== null ? (
        <UpdateConfigPanels
          draft={updateConfig}
          view={configPanels.view}
          budget={configPanels.budget}
          edtState={configPanels.edtField}
          edtTopics={configPanels.edtTopics}
          edtStatus={configPanels.edtStatus}
          box={configPanels.box}
          boxContext={configPanels.boxContext}
        />
      ) : null}
      {serviceMenu !== null ? (
        <UpdateServiceMenuDialog service={serviceMenu.service} cursor={clampedServiceMenuCursor} items={serviceMenuItems} />
      ) : null}
      {/* The no-arg `:update-service` fallback — a filterable service quick-pick. Confirming a
          row opens the config pre-scoped to that one service; Esc closes with nothing opened. */}
      {updateServicePick !== null ? <UpdateServicePickDialog state={pickState} candidates={updateServicePick} /> : null}
      {popupOpen ? (
        <UpdateIncidentsDialog
          incidents={incidents}
          selected={selectedIncidentIndex}
          mode={incidentMode}
          menuCursor={blockerCursor}
          editorError={editorError}
          now={incidentNow}
        />
      ) : null}
    </Box>
  );
}
