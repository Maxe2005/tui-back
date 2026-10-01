// tui/zones/update: the Update zone (story 3.1) — the TUI face of the EDT-scoped group
// update. Enter starts the same core/scripts/group-update.ts use-case the CLI's
// `tui-back update` wraps, in-process via the store slice (AD-2, never by shelling out to
// the CLI). Idle shows the last outcome, the zero-member no-op message, or the interrupted
// re-run offer; a run shows a per-service spinner; the outcome summary follows. `q`
// mid-run requires confirmation via a ModalDialog — on confirm the EDT is marked
// `interrupted` and the app quits (AppShell's quitRequested handoff); the next idle render
// offers a re-run.
//
// Story 3.4 backs core's `onUpdateBlocker` seam here: a dirty/conflicted repo pauses the
// run on a bounded four-choice modal menu (stash / open in editor / cancel repo / cancel
// run) rendered as `ListRow`s. The editor spawn is driving-side only (`launchEditor`, with
// the command line taken from the `general.editorCommand` setting); every git write still
// goes through the core use-case (AD-1).
//
// Every keystroke behavior is a standalone pure function below, unit-tested directly — the
// `useInput` callback stays a thin dispatcher over them (the edts-zone.tsx convention:
// the shared renderToString harness's fake stdin never emits data, so a useInput callback
// itself is never invoked by any test in the repo).
import { spawnSync } from 'node:child_process';
import { resolve as resolvePath } from 'node:path';
import { useEffect, useState } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';
import type { GroupUpdateRepoResult, UpdateBlocker } from '../../../../../core/scripts/group-update.js';
import type { EdtRegistryEntry } from '../../../../../core/ports/edt-registry.js';
import { useAppStore, type AppStore } from '../../store/app-store.js';
import {
  BoundedList,
  DetailPane,
  ListDetailSplit,
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
import { formatServiceMeta, jumpSelection, moveSelection, resolveSelectionDirection, resolveSelectionJump } from '../edts/edts-zone.logic.js';
import {
  deriveUpdateServiceStatus,
  formatLiveServiceDetail,
  formatServiceOutcomeDetail,
  isServiceTargetedByRun,
  partitionUpdateServiceRows,
  resolveEditorCommand,
} from './update-zone.logic.js';
import { UpdateConfigDialog } from './update-config-dialog.js';
import { UpdateServiceMenuDialog, resolveServiceMenuChoice, resolveServiceMenuKey } from './update-service-menu-dialog.js';
import { UpdateServicePickDialog, toServicePickItems } from './update-service-pick-dialog.js';
import {
  beginUpdateConfigBranchEdit,
  clampUpdateConfigCursor,
  commitUpdateConfigBranchEdit,
  resolveUpdateConfigKey,
  toggleUpdateConfigRow,
  type BranchAutocompleteState,
} from './update-config-dialog.logic.js';

// Story 3.6: rough terminal-chrome budget (top bar, zone-tab bar, footer, the "UPDATE" title
// row, the list column's own section header/loading/error lines) subtracted from the raw
// window size before the service list's own BoundedList ever sees it — mirrors
// edts-zone.tsx's own EDTS_SERVICE_LISTS_CHROME_ROWS precedent ("an approximation is fine
// here").
const UPDATE_SERVICE_LIST_CHROME_ROWS = 8;

export const UPDATE_IDLE_PROMPT = '[G] EDT update, [P] this service, [Enter] for service actions.';
export const UPDATE_ALL_REPOS_PROMPT = 'Press [A] for all-repos maintenance mode (every managed repo).';
export const UPDATE_INTERRUPTED_OFFER = 'Last update was interrupted — press [Enter] for service actions.';
export const UPDATE_RUNNING_LABEL = 'Updating member services…';
export const UPDATE_ALL_RUNNING_LABEL = 'Updating all managed repos…';
export const UPDATE_SELECTION_RUNNING_LABEL = 'Updating selected services…';
export const UPDATE_LOADING_MEMBERS = 'Loading member services…';
export const UPDATE_QUIT_CONFIRM_TITLE = 'QUIT MID-RUN';
export const UPDATE_QUIT_CONFIRM_BODY = 'A group update is in progress. Quit and mark this EDT interrupted? ([y]/[n])';
export const UPDATE_QUIT_CONFIRM_BODY_ALL = 'A group update is in progress. Quit without marking anything interrupted? ([y]/[n])';
export const UPDATE_ALL_CONFIRM_TITLE = 'ALL-REPOS UPDATE';
export const UPDATE_ALL_CONFIRM_BODY =
  'Update every managed repo (outside the active EDT too)? Press [Enter] to confirm, [Esc] to cancel.';

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

// Story 3.11: the EDT-scoped main trigger — `g` while idle/done/error opens the config
// pre-scoped to every EDT member (never while a run is in flight — a second trigger is
// rejected by the same guard as every other scope).
export function shouldOpenEdtConfig(input: string, updateStatus: string): boolean {
  return (input === 'g' || input === 'G') && updateStatus !== 'running';
}

// Story 3.11: the single-service trigger — `p` while idle/done/error opens the config
// pre-scoped to the highlighted row (the dispatcher ignores it when no row is selected).
export function shouldOpenSingleConfig(input: string, updateStatus: string): boolean {
  return (input === 'p' || input === 'P') && updateStatus !== 'running';
}

// Story 3.9: the row-local trigger mapping — `a` still opens the shared pre-run
// configuration screen pre-scoped to every managed repo; `Enter` opens the per-service
// action menu for the selected row (Update this service / Clean restart / Cancel, the
// EDTs zone's own service-menu pattern). No trigger ever starts an unconfigured run.
//
// Story 3.11 extends the same mapping: `g` opens the config pre-scoped to the EDT
// (the main update, previously unreachable by key), `p` pre-scopes it to the highlighted
// row. Pure (the same unit style as `shouldOpenAllConfirm`) because the zone's `useInput`
// is never driven in tests, so an inline mapping would let a wiring regression back to a
// direct `runGroupUpdate` go undetected.
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
  if (input === 'y' || input === 'Y' || key.return === true) {
    return 'confirm';
  }
  if (input === 'n' || input === 'N' || key.escape === true) {
    return 'cancel';
  }
  return null;
}

// Story 3.4: the assisted-resolution menu — the seam's fixed choices rendered as
// `ListRow`s navigated like the EDT zone's `SERVICE_ACTION_MENU_ITEMS` (arrows/Home/End +
// Enter — the story 2.7 canonical contract; filterable-list widgets are overkill for four
// fixed rows). `Escape` answers `cancel-repo`: the least-destructive unblock (the repo is
// skipped, the rest of the run continues) so a stray keystroke never cancels the run.
export const UPDATE_BLOCKER_TITLE = 'UPDATE BLOCKED';

export const UPDATE_BLOCKER_MENU_ITEMS = Object.freeze([
  { value: 'stash', label: 'Stash changes and continue' },
  { value: 'edited', label: 'Open in editor, then retry' },
  { value: 'cancel-repo', label: 'Cancel this repo (continue with the rest)' },
  { value: 'cancel-run', label: 'Cancel the whole run' },
] as const);

export type UpdateBlockerMenuValue = (typeof UPDATE_BLOCKER_MENU_ITEMS)[number]['value'];

export type UpdateBlockerMenuItem = (typeof UPDATE_BLOCKER_MENU_ITEMS)[number];

// The choices offered for a blocker kind. A merge conflict drops `stash`: git refuses to
// stash unmerged paths, and once the conflict is resolved and staged a stash silently
// shelves the resolution and clears the merge (the retry then re-conflicts) — the editor
// retry and the two cancels are the only meaningful exits there.
export function blockerMenuItems(kind: UpdateBlocker['kind']): readonly UpdateBlockerMenuItem[] {
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

export type BlockerMenuKey = {
  upArrow?: boolean;
  downArrow?: boolean;
  home?: boolean;
  end?: boolean;
  return?: boolean;
  escape?: boolean;
};

export type BlockerMenuStep = { type: 'move'; cursor: number } | { type: 'choose'; choice: UpdateBlockerMenuValue } | { type: 'ignore' };

export function resolveBlockerMenuKey(
  input: string,
  key: BlockerMenuKey,
  cursor: number,
  items: readonly UpdateBlockerMenuItem[] = UPDATE_BLOCKER_MENU_ITEMS,
): BlockerMenuStep {
  const length = items.length;
  if (key.home === true) {
    return { type: 'move', cursor: 0 };
  }
  if (key.end === true) {
    return { type: 'move', cursor: length - 1 };
  }
  if (key.upArrow === true) {
    return { type: 'move', cursor: Math.max(0, cursor - 1) };
  }
  if (key.downArrow === true) {
    return { type: 'move', cursor: Math.min(length - 1, cursor + 1) };
  }
  if (key.return === true) {
    const item = items[cursor];
    if (item === undefined) {
      return { type: 'ignore' };
    }
    return { type: 'choose', choice: item.value };
  }
  if (key.escape === true) {
    return { type: 'choose', choice: 'cancel-repo' };
  }
  return { type: 'ignore' };
}

// Story 3.4: the driving-side editor launch — core only ever sees the `edited` choice,
// never an editor (AD-1: the TUI never calls a driven adapter; spawning the editor is
// driving-side only). Spawns the resolved editor command on the blocked repo with the
// terminal attached and waits for exit: the `general.editorCommand` setting when set
// (`code <repo>` opens a VS Code window on the repo with its merge in progress), else
// `$EDITOR`, else `vi` — see resolveEditorCommand. The exit status is deliberately unread
// — core's re-verification is the gate (a no-op edit, or a GUI editor that returns
// immediately, simply re-presents the menu). Only a command that could not be started at
// all (unknown binary, not executable) is reported, so a misconfigured setting is never a
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

export function UpdateZone({ useStore = useAppStore }: { useStore?: AppStore }) {
  const updateStatus = useStore((state) => state.updateStatus);
  const updateResults = useStore((state) => state.updateResults);
  const updateNote = useStore((state) => state.updateNote);
  const updateTopic = useStore((state) => state.updateTopic);
  const updateError = useStore((state) => state.updateError);
  const updateErrorCode = useStore((state) => state.updateErrorCode);
  const updateScope = useStore((state) => state.updateScope);
  const updateSelection = useStore((state) => state.updateSelection);
  const updateBlocker = useStore((state) => state.updateBlocker);
  const resolveUpdateBlocker = useStore((state) => state.resolveUpdateBlocker);
  const updateConfig = useStore((state) => state.updateConfig);
  const openUpdateConfig = useStore((state) => state.openUpdateConfig);
  const setUpdateConfig = useStore((state) => state.setUpdateConfig);  const closeUpdateConfig = useStore((state) => state.closeUpdateConfig);
  const confirmUpdateConfig = useStore((state) => state.confirmUpdateConfig);
  // Story 3.11: the no-arg `:update-service` handoff (zone selection → pinned config,
  // else the filterable quick-pick) plus the pick's own open candidates.
  const updateServiceSelectRequest = useStore((state) => state.updateServiceSelectRequest);
  const clearUpdateServiceSelectionRequest = useStore((state) => state.clearUpdateServiceSelectionRequest);
  const updateServicePick = useStore((state) => state.updateServicePick);
  const openUpdateServicePick = useStore((state) => state.openUpdateServicePick);
  const closeUpdateServicePick = useStore((state) => state.closeUpdateServicePick);
  const serviceRestartInFlight = useStore((state) => state.serviceRestartInFlight);
  const runServiceRestart = useStore((state) => state.runServiceRestart);
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

  // Story 3.6: the always-visible service-list shell — the same active-EDT-scoped
  // `edtsBranches` rows Logs/EDTs zones already load, plus this zone's own live health poll
  // and last-run-outcome map (Code Map).
  const services = useStore((state) => state.edtsBranches);
  const servicesStatus = useStore((state) => state.edtsBranchesStatus);
  const loadEdtsBranches = useStore((state) => state.loadEdtsBranches);
  const loadEdts = useStore((state) => state.loadEdts);
  const updateServiceHealth = useStore((state) => state.updateServiceHealth);
  const lastServiceOutcomes = useStore((state) => state.lastServiceOutcomes);
  const liveServicePhase = useStore((state) => state.liveServicePhase);
  const liveServiceIssues = useStore((state) => state.liveServiceIssues);
  const startUpdateHealthPolling = useStore((state) => state.startUpdateHealthPolling);
  const stopUpdateHealthPolling = useStore((state) => state.stopUpdateHealthPolling);
  const ratio = useStore((state) => state.splitterRatios.update);
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
  // Story 3.9: the row-local action menu's own target + cursor — zone-local UI state (the
  // same convention as the service-list cursor above; only cross-visit/cross-run state
  // belongs in update-slice.ts). Null when no menu is open.
  const [serviceMenu, setServiceMenu] = useState<{ service: string; repoPath: string } | null>(null);
  const [serviceMenuCursor, setServiceMenuCursor] = useState(0);
  // Story 3.6: the service list's own selection cursor — zone-local UI state (repo
  // convention: only cross-visit/cross-run state belongs in update-slice.ts).
  const [serviceCursor, setServiceCursor] = useState(0);
  // Story 3.7: the config screen's own keyboard cursor + in-progress branch edit — also
  // zone-local UI state. The draft itself (rows, toggles, error) is live run state in the
  // store; these two only say where the cursor is and what is being typed. The edit hosts
  // the shared autocomplete state; its branch source lives in the two states below,
  // fetched once per edit (mirroring the EDT zone's own fetch-once-per-session effect).
  const [configCursor, setConfigCursor] = useState(0);
  const [configEditing, setConfigEditing] = useState<BranchAutocompleteState | null>(null);
  const [configBranches, setConfigBranches] = useState<string[]>([]);
  const [configBranchesStatus, setConfigBranchesStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  // Story 3.11: the service quick-pick's own filter text, caret and highlighted row —
  // zone-local UI state (the same convention as the service-list cursor above; the
  // candidate list itself is store state so the `:update-service` command can open it from
  // any zone). The shape and every transition are the shared FilterablePickList's.
  const [pickState, setPickState] = useState<FilterablePickListState>(createFilterablePickListState);

  useEffect(() => {
    void loadEdtsBranches();
    void loadEdts();
    // Fires once on mount only, mirrors logs-zone.tsx's own mount effect (Code Map:
    // "pattern: logs-zone.tsx:225-230").
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = servicesStatus === 'error' ? [] : (services ?? []);
  const focusedEdt = (edts ?? []).find((entry) => entry.ulid === activeEdt);
  const serviceRows = partitionUpdateServiceRows(rows, focusedEdt);
  const clampedServiceCursor = serviceRows.length === 0 ? 0 : Math.min(serviceCursor, serviceRows.length - 1);
  const selectedServiceRow = serviceRows[clampedServiceCursor];

  // Story 3.6: this run's currently-targeted services — an all-repos run targets every
  // listed service; an EDT-scoped run targets only the active EDT's own members (the same
  // `runningMembers` the running-state spinner below already reads). A run confirmed with
  // a narrowed selection (a single-service update above all) targets only the selected
  // rows inside that scope — see isServiceTargetedByRun.
  const edtMembers = edts?.find((entry) => entry.ulid === activeEdt)?.members ?? [];
  const isAllRun = updateScope === 'all';
  const runningMemberPaths = new Set(edtMembers.map((member) => member.repoPath));
  const runTarget = { scope: isAllRun ? ('all' as const) : ('edt' as const), memberPaths: runningMemberPaths, selection: updateSelection };
  const isRowTargeted = (row: { service: string; path: string }): boolean =>
    updateStatus === 'running' && isServiceTargetedByRun(row, runTarget);
  const runningMembers = edtMembers.filter((member) => isRowTargeted({ service: member.service, path: member.repoPath }));
  // A narrowed all-scope run (a single service outside the active EDT) names its selected
  // rows — the generic "loading members" line is only for the unfiltered all-repos run.
  const runningSelectedRows = isAllRun && updateSelection !== null ? serviceRows.filter(isRowTargeted) : [];

  // Story 3.6: starts (or restarts, on a changed service list) this zone's own health poll
  // whenever the loaded service list changes — independent of Logs zone's own pane
  // subscriptions (Never: "no shared subscription"). Torn down on unmount so no poll timer
  // outlives the zone.
  const servicePaths = rows.map((row) => row.path).join('\u0000');
  useEffect(() => {
    if (servicePaths === '') {
      // Review fix: a service list that goes from non-empty to empty (edtsBranches becomes
      // `[]`, or servicesStatus flips to 'error') must stop the previous poll cycle too —
      // left un-stopped, a stale interval keeps polling repoPaths no longer displayed.
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
      quitConfirm || updateConfig !== null || updateBlocker !== null || serviceMenu !== null || updateServicePick !== null || updateServiceSelectRequest,
    );
  }, [quitConfirm, updateConfig, updateBlocker, serviceMenu, updateServicePick, updateServiceSelectRequest, setZoneInputCaptured]);

  // A newly opened service menu always starts browsing on its first row.
  useEffect(() => {
    if (serviceMenu !== null) {
      setServiceMenuCursor(0);
    }
  }, [serviceMenu]);

  // A newly raised blocker always opens the menu on its first row.
  useEffect(() => {
    if (updateBlocker !== null) {
      setBlockerCursor(0);
    }
    setEditorError(null);
  }, [updateBlocker]);

  // A newly opened config screen always starts browsing on its first row with no branch
  // edit in flight. Keyed on the open boolean — never the draft object — so a toggle or
  // branch commit (which replaces the draft) doesn't snap the cursor back to 0 or wipe an
  // edit session.
  const isUpdateConfigOpen = updateConfig !== null;
  useEffect(() => {
    if (isUpdateConfigOpen) {
      setConfigCursor(0);
      setConfigEditing(null);
      setConfigBranches([]);
      setConfigBranchesStatus('loading');
    }
  }, [isUpdateConfigOpen]);

  // Story 3.11: a newly opened service pick always starts unfiltered on its first row. The
  // single reset point is the pick *closing* — whoever closed it (Enter, Esc, or the store
  // itself on a run start/reset) — so the next open never paints a frame of the previous
  // session's filter. Keyed on the open boolean — never the candidate list — so a store
  // refresh underneath doesn't snap the cursor back or wipe typed filter text.
  const isUpdateServicePickOpen = updateServicePick !== null;
  useEffect(() => {
    if (!isUpdateServicePickOpen) {
      setPickState(createFilterablePickListState());
    }
  }, [isUpdateServicePickOpen]);

  // Story 3.11: consumes the no-arg `:update-service` request the command raised through
  // the store. A highlighted row pre-scopes the config to that one service (the `p`
  // behavior without the keypress); with no row selected the filterable quick-pick opens
  // instead. Runs through the same guarded openers, so a request racing a run start is
  // rejected rather than opening a screen mid-run.
  useEffect(() => {
    if (!updateServiceSelectRequest) {
      return;
    }
    clearUpdateServiceSelectionRequest();
    if (selectedServiceRow !== undefined) {
      void openUpdateConfig({ service: selectedServiceRow.service, repoPath: selectedServiceRow.path });
    } else {
      void openUpdateServicePick();
    }
    // Keyed on primitives — selectedServiceRow is re-derived every render, so depend on
    // its identity fields rather than the object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateServiceSelectRequest]);

  // Fetches the edited row's own listBranches(repoPath) once per branch-edit session —
  // the same shape as the EDT zone's own branch-picker effect (keyed on primitives, stale
  // responses dropped). Opening an edit resets the source to loading (see the begin-edit
  // dispatch below); closing it leaves the last source in place, unused until the next
  // edit re-arms it.
  const editingRepoPath =
    updateConfig !== null && configEditing !== null
      ? (updateConfig.rows[clampUpdateConfigCursor(updateConfig, configCursor)]?.repoPath ?? null)
      : null;
  const isConfigEditing = configEditing !== null;
  useEffect(() => {
    if (editingRepoPath === null || !isConfigEditing || configBranchesStatus !== 'loading') {
      return;
    }
    let cancelled = false;
    const repoPath = editingRepoPath;
    void (async () => {
      const result = await listBranchesAction(repoPath);
      if (cancelled) {
        return;
      }
      setConfigBranches(result.ok ? result.data : []);
      setConfigBranchesStatus(result.ok ? 'ready' : 'error');
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingRepoPath, isConfigEditing, configBranchesStatus, listBranchesAction]);

  useInput(
    (input, key) => {
      // Story 3.4: while a repo waits on the resolution seam, the menu owns every
      // keystroke — `q` must not open the quit-confirm underneath it (cancel the run
      // through the menu instead).
      if (updateBlocker !== null) {
        const step = resolveBlockerMenuKey(input, key, blockerCursor, blockerMenuItems(updateBlocker.kind));
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
      // Story 3.7: while the pre-run configuration screen is open it owns every
      // keystroke — the run starts only through its confirm path, with exactly the
      // confirmed configuration.
      if (updateConfig !== null) {
        const step = resolveUpdateConfigKey(
          input,
          key,
          { cursor: clampUpdateConfigCursor(updateConfig, configCursor), editing: configEditing },
          updateConfig,
          configBranches,
        );
        if (step.type === 'move') {
          setConfigCursor(step.cursor);
        } else if (step.type === 'toggle') {
          setUpdateConfig(toggleUpdateConfigRow(updateConfig, clampUpdateConfigCursor(updateConfig, configCursor)));
        } else if (step.type === 'begin-edit') {
          const editing = beginUpdateConfigBranchEdit(updateConfig, clampUpdateConfigCursor(updateConfig, configCursor));
          if (editing !== null) {
            setConfigEditing(editing);
            // Re-arm the per-row branch source: a fresh edit always starts loading, and the
            // effect above fetches this row's own listBranches once.
            setConfigBranches([]);
            setConfigBranchesStatus('loading');
          }
        } else if (step.type === 'edit') {
          setConfigEditing(step.editing);
        } else if (step.type === 'commit-edit') {
          if (configEditing !== null) {
            setUpdateConfig(
              commitUpdateConfigBranchEdit(updateConfig, clampUpdateConfigCursor(updateConfig, configCursor), configEditing.value),
            );
            setConfigEditing(null);
          }
        } else if (step.type === 'cancel-edit') {
          setConfigEditing(null);
        } else if (step.type === 'confirm') {
          void confirmUpdateConfig();
        } else if (step.type === 'cancel') {
          setConfigEditing(null);
          closeUpdateConfig();
        }
        return;
      }
      // Story 3.11: while the service quick-pick is open it owns every keystroke — the
      // shared pick reducer interprets it (filter editing, highlight movement); the zone
      // only acts on its outcome: Enter confirms the highlighted service into the 3.7
      // config pre-scoped to it, Esc closes without opening anything.
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
      // Story 3.9: while the row-local action menu is open it owns every keystroke —
      // arrows/Home/End move, Enter chooses, Esc cancels (the EDTs service-menu pattern).
      // Update routes to the 3.7 config screen pre-scoped to that single service; clean
      // restart runs the standalone single-service use-case for that repo alone.
      if (serviceMenu !== null) {
        const step = resolveServiceMenuKey(input, key, serviceMenuCursor);
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
      // Story 3.6: the service list's own cursor — moves regardless of run state (browsing
      // the always-visible list is harmless mid-run) and never conflicts with the existing
      // 3.1–3.4 triggers below, none of which use arrow/Home/End.
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
      if (updateStatus === 'running') {
        if (shouldConfirmQuit(input, updateStatus)) {
          setQuitConfirm(true);
        }
        return;
      }
      // Story 3.9: `a` pre-scopes the shared pre-run configuration screen to every
      // managed repo; `Enter` opens the row-local action menu for the selected service
      // (update this service / clean restart / cancel) — no git/docker action runs before
      // the menu choice is confirmed through its own path.
      //
      // Story 3.11: `g` pre-scopes the same screen to the EDT (the main update);
      // `p` pre-scopes it to the highlighted row alone.
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
        if (selectedServiceRow !== undefined) {
          void openUpdateConfig({ service: selectedServiceRow.service, repoPath: selectedServiceRow.path });
        }
        return;
      }
      if (trigger === 'open-service-menu') {
        if (selectedServiceRow !== undefined) {
          setServiceMenu({ service: selectedServiceRow.service, repoPath: selectedServiceRow.path });
        }
      }
    },
    { isActive: !commandBarOpen && !registryScreenOpen && !settingsScreenOpen && !resetScreenOpen && !resizeMode },
  );

  // The active EDT's own membership — the per-service spinner rows during a run, before the
  // core use-case resolves with its per-service outcome rows. An all-repos run targets no
  // single EDT, so it shows the generic loading line instead of EDT member rows.
  const offerRerun = shouldOfferRerun(edts, activeEdt);
  const runningLabel = !isAllRun ? UPDATE_RUNNING_LABEL : updateSelection !== null ? UPDATE_SELECTION_RUNNING_LABEL : UPDATE_ALL_RUNNING_LABEL;

  // Story 3.6: this zone's own service-list chrome budget (Code Map: "an approximation is
  // fine here", mirrors edts-zone.tsx/logs-zone.tsx's own precedent).
  const windowSize = useWindowSize();
  const serviceListMaxVisibleRows = Math.max(windowSize.rows - UPDATE_SERVICE_LIST_CHROME_ROWS, 3);

  const selectedLastOutcome = selectedServiceRow !== undefined ? lastServiceOutcomes[selectedServiceRow.service] : undefined;

  // Story 3.10: the live per-service view — while a run targets the selected service the
  // detail pane shows its current step plus the issue log (resolved/unresolved) instead
  // of the last-outcome view; afterwards it reverts to the final outcome. A standalone
  // restart reports through the same channel, so its in-flight step renders live too —
  // before its first emission the formatter reports `starting`, never a stale outcome.
  const selectedLivePhase = selectedServiceRow !== undefined ? liveServicePhase[selectedServiceRow.service] : undefined;
  const selectedLiveIssues = selectedServiceRow !== undefined ? (liveServiceIssues[selectedServiceRow.service] ?? []) : [];
  const isSelectedTargeted = selectedServiceRow !== undefined && isRowTargeted(selectedServiceRow);
  const isSelectedRestarting =
    selectedServiceRow !== undefined && serviceRestartInFlight[resolvePath(selectedServiceRow.path)] !== undefined;
  const showLiveDetail = isSelectedTargeted || isSelectedRestarting;
  const detailBody =
    selectedServiceRow === undefined
      ? 'No service selected.'
      : showLiveDetail
        ? formatLiveServiceDetail(selectedLivePhase, selectedLiveIssues)
        : formatServiceOutcomeDetail(selectedLastOutcome);

  return (
    <Box flexDirection="column" flexGrow={1} backgroundColor={colors.surface}>
      {/* Review fix: only the title line carries the pre-3.6 left padding back — the outer
          Box itself stays unpadded so it doesn't double up the list/detail panes' own
          paddingX (each pane below already pads itself, matching edts-zone.tsx/
          logs-zone.tsx's convention). */}
      <Box paddingX={spacing['pane-padding-x']}>
        <Text color={colors['text-dim']}>UPDATE</Text>
      </Box>
      <ListDetailSplit
        ratio={ratio[0]}
        listSplitterTargeted={resizeMode?.zone === 'update' && resizeMode.targetBoundary === 0}
        list={
          <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden" paddingX={spacing['pane-padding-x']}>
            <Text color={colors['text-dim']}>SERVICES</Text>
            {servicesStatus === 'loading' && rows.length === 0 ? <Text color={colors['text-dim']}>Loading services…</Text> : null}
            {servicesStatus === 'error' ? <Text color={colors.error}>Failed to load services</Text> : null}
            {rows.length === 0 && servicesStatus !== 'loading' && servicesStatus !== 'error' ? (
              <Text color={colors['text-dim']}>No managed services found.</Text>
            ) : null}
            {/* AC2/I-O matrix: every row always carries exactly one glyph from the closed
                up/down/restarting/updating/migrating/error set — never blank, never bridged
                through a generic state. */}
            <BoundedList
              items={serviceRows}
              maxVisibleRows={serviceListMaxVisibleRows}
              cursorIndex={clampedServiceCursor}
              renderItem={(row, index) => {
                const health = updateServiceHealth[row.path] ?? 'down';
                const lastOutcome = lastServiceOutcomes[row.service];
                const isTargeted = isRowTargeted(row);
                // Story 3.9: the coarse standalone-restart flag — the in-flight map holds
                // this service's resolved repoPath for the duration, no step detail.
                // Story 3.10: the live phase for this service refines the glyph — the
                // migrate step finally produces `migrating`.
                const isRestarting = serviceRestartInFlight[resolvePath(row.path)] !== undefined;
                const status = deriveUpdateServiceStatus(health, lastOutcome?.outcome, isTargeted, isRestarting, liveServicePhase[row.service]);
                return (
                  <Box key={row.path} flexDirection="row">
                    <StatusBadge state={status} />
                    <Box marginLeft={1} flexGrow={1} minWidth={0}>
                      <ListRow label={row.service} meta={formatServiceMeta(row)} selected={index === clampedServiceCursor} />
                    </Box>
                  </Box>
                );
              }}
            />
          </Box>
        }
        detail={
          <Box flexDirection="column" minHeight={0} overflow="hidden" paddingX={spacing['pane-padding-x']}>
            <DetailPane title={selectedServiceRow !== undefined ? selectedServiceRow.service : 'Service'}>
              {detailBody}
            </DetailPane>
            {updateStatus === 'running' ? (
              <Box flexDirection="column">
                <Box>
                  <Spinner />
                  <Text color={colors.text}> {runningLabel}</Text>
                </Box>
                {runningSelectedRows.length > 0 ? (
                  runningSelectedRows.map((row) => (
                    <Box key={row.path}>
                      <Spinner />
                      <Text color={colors.text}> {row.service}{row.branch !== null ? ` (${row.branch})` : ''}</Text>
                    </Box>
                  ))
                ) : isAllRun || runningMembers.length === 0 ? (
                  <Text color={colors['text-dim']}>{UPDATE_LOADING_MEMBERS}</Text>
                ) : (
                  runningMembers.map((member) => (
                    <Box key={member.repoPath}>
                      <Spinner />
                      <Text color={colors.text}> {member.service} ({member.branch})</Text>
                    </Box>
                  ))
                )}
              </Box>
            ) : null}
            {updateStatus === 'done' && updateTopic !== null ? (
              // The zero-member no-op carries its note as the primary outcome line — rendering
              // the success-toned `0 updated, 0 skipped, 0 failed` counts DetailPane for it
              // would overstate a no-op as a result.
              updateNote !== null && updateResults.length === 0 ? (
                <Box flexDirection="column">
                  <Text color={colors.text}>{updateNote}</Text>
                  <Text color={colors['text-dim']}>{UPDATE_IDLE_PROMPT}</Text>
                </Box>
              ) : (
                <Box flexDirection="column">
                  {updateResults.map((row, index) => (
                    // Duplicate service names occur within one EDT — key by service + index so
                    // React never drops a same-named row.
                    <Text key={`${row.service}-${index}`} color={colors.text}>
                      {formatUpdateRow(row)}
                    </Text>
                  ))}
                  <DetailPane
                    title={updateTopic === 'all-repos' ? 'All-repos update' : 'Group update'}
                    summary={{ tone: resolveUpdateTone(updateResults), text: formatUpdateSummary(updateTopic, updateResults) }}
                  >
                    {updateNote ?? UPDATE_IDLE_PROMPT}
                  </DetailPane>
                </Box>
              )
            ) : null}
            {updateStatus === 'error' ? (
              <Box flexDirection="column">
                <Text color={colors.error}>
                  {updateError ?? 'Group update failed.'}
                  {updateErrorCode !== null ? ` (code: ${updateErrorCode})` : ''}
                </Text>
                <Text color={colors['text-dim']}>{UPDATE_IDLE_PROMPT}</Text>
              </Box>
            ) : null}
            {updateStatus === 'idle' ? (
              <Box flexDirection="column">
                <Text color={colors.text}>{offerRerun ? UPDATE_INTERRUPTED_OFFER : UPDATE_IDLE_PROMPT}</Text>
                <Text color={colors['text-dim']}>{UPDATE_ALL_REPOS_PROMPT}</Text>
              </Box>
            ) : null}
          </Box>
        }
      />
      <ModalDialog title={UPDATE_QUIT_CONFIRM_TITLE} open={quitConfirm} onConfirm={() => {}} onCancel={() => setQuitConfirm(false)}>
        <Text color={colors.text}>{isAllRun ? UPDATE_QUIT_CONFIRM_BODY_ALL : UPDATE_QUIT_CONFIRM_BODY}</Text>
      </ModalDialog>
      {updateConfig !== null ? (
        <UpdateConfigDialog
          draft={updateConfig}
          view={{ cursor: clampUpdateConfigCursor(updateConfig, configCursor), editing: configEditing }}
          branches={configBranches}
          branchesStatus={configBranchesStatus}
          maxRows={branchDropdownMaxRows}
        />
      ) : null}
      {serviceMenu !== null ? <UpdateServiceMenuDialog service={serviceMenu.service} cursor={serviceMenuCursor} /> : null}
      {/* Story 3.11: the no-arg `:update-service` fallback — a filterable service
          quick-pick (the story 2.30 no-arg `edt-switch` mirror). Confirming a row opens
          the 3.7 config pre-scoped to that one service; Esc closes with nothing opened. */}
      {updateServicePick !== null ? <UpdateServicePickDialog state={pickState} candidates={updateServicePick} /> : null}
      <ModalDialog title={UPDATE_BLOCKER_TITLE} open={updateBlocker !== null} onConfirm={() => {}} onCancel={() => {}}>
        {updateBlocker !== null ? (
          <Box flexDirection="column">
            <Text color={colors.text}>{formatBlockerBody(updateBlocker)}</Text>
            {formatBlockerRetry(updateBlocker) !== null ? <Text color={colors.warning}>{formatBlockerRetry(updateBlocker)}</Text> : null}
            {editorError !== null ? <Text color={colors.error}>✖ {editorError}</Text> : null}
            {blockerMenuItems(updateBlocker.kind).map((item, index) => (
              <ListRow key={item.value} label={item.label} selected={index === blockerCursor} />
            ))}
          </Box>
        ) : null}
      </ModalDialog>
    </Box>
  );
}
