// tui/store/slices: shared types, constants and pure helpers of the Update slice, plus the
// per-store context its sub-creators share. Kept free of any import from update-slice.ts so
// the sub-creators never form an import cycle with the composing slice.
import type { StateCreator } from 'zustand';
import type {
  GroupUpdateRepoResult,
  GroupUpdateScope,
  GroupUpdateSelectionItem,
  UpdateBlocker,
  UpdateBlockerChoice,
  UpdatePhase,
} from '../../../../../../core/workspace/scripts/group-update/group-update.js';
import type { Result } from '../../../../../../core/result.js';
import type { ServiceStatusState } from '../../../../../../core/runtime/service-status/index.js';
import type { InFlightGuard } from '../../../shared/hooks/in-flight-guard.js';
import { finalizeServiceSteps, type ServiceIssue, type ServiceStepStates } from '../../../zones/update/logic/update-zone.logic.js';
import type { SHARED_TYPES_PHASE_FAILED, SharedTypesMode, SharedTypesStage } from '../../../../../../core/workspace/shared-types/consumers/smart-update.js';
import type { UpdateConfigDraft } from '../../../zones/update/config/update-config-dialog.logic.js';
import type { AppState, AppStoreDeps } from '../../app-store.js';

// Parses the optional service argument off `:update-service <name>` (like
// openEdtSwitchDialog's query parsing): the command name is the first whitespace-separated
// token, everything after it is the service name. Returns null when no argument was given.
export function parseUpdateServiceArg(fullQuery: string): string | null {
  const parts = fullQuery.trim().split(/\s+/);
  if (parts.length <= 1) {
    return null;
  }
  const arg = parts.slice(1).join(' ').trim();
  return arg === '' ? null : arg;
}

export type UpdateRunStatus = 'idle' | 'running' | 'done' | 'error';

// The Update zone's own health-poll cadence — independent of the Logs zone's
// LOGS_HEALTH_POLL_INTERVAL_MS (no shared subscription); the same 5s by convention, not
// coupling.
export const UPDATE_HEALTH_POLL_INTERVAL_MS = 5000;

// Per-run overrides threaded from the confirmed pre-run configuration into
// the core use-case. Undefined fields fall back to the full default selection (no filter),
// migrate ON, and clean restart OFF — the same configuration the CLI passes explicitly.
export type UpdateRunOptions = {
  selection?: GroupUpdateSelectionItem[];
  runMigrations?: boolean;
  cleanRestart?: boolean;
  // Run-wide `shared-types` handling and the source repo it applies to: the source is updated
  // alone first, then published and propagated before the other services start.
  sharedTypes?: SharedTypesMode;
  sharedTypesSource?: string | null;
};

// The pre-run configuration target — an EDT/all scope, or a single service (`repoPath`
// disambiguates duplicate service names; without it the service is resolved through the
// active EDT first, then every managed repo).
export type OpenUpdateConfigTarget = GroupUpdateScope | { service: string; repoPath?: string };

export type UpdateSlice = {
  // The last (or in-flight) run: `updateResults`/`updateNote` carry a `done` run's outcome
  // (the idle render shows the last outcome, the zero-member no-op message, or the
  // interrupted re-run offer derived from `edts`); `updateError`/`updateErrorCode` carry a
  // top-level `error` run's failure (e.g. no-active-edt, update-already-running).
  updateStatus: UpdateRunStatus;
  updateResults: GroupUpdateRepoResult[];
  updateNote: string | null;
  updateTopic: string | null;
  updateError: string | null;
  updateErrorCode: string | null;
  // The EDT ulid the current/last run targeted — captured at run start so
  // markUpdateInterrupted() marks the run's own EDT even if the active pointer moved.
  // An all-repos run targets no EDT: `updateUlid` is `'all'` and `updateScope` is `'all'`.
  updateUlid: string | null;
  updateScope: GroupUpdateScope | null;
  // The confirmed selection the current/last run was started with (null when the run
  // started unfiltered — every service in `updateScope` is targeted). The scope alone
  // over-reports a narrowed run: a single-service update is scoped `edt`/`all` but
  // targets one service, so the zone's per-row `updating` status reads this too.
  updateSelection: GroupUpdateSelectionItem[] | null;
  // The currently raised resolution blocker (null when no repo is waiting).
  // Core's `onUpdateBlocker` seam sets this and waits; the Update zone renders the bounded
  // four-choice modal menu over it, and this dispatch carries the developer's choice back
  // to the waiting run. Every git write still goes through the core use-case (AD-1) — the
  // driving side owns only menu rendering and the editor process.
  // every service waiting on the developer is one incident in the run's queue
  // (oldest first); the queue replaces the single blocking blocker. Resolving one resumes only
  // that service. `incidentPopupOpen` is the popup's visibility (Esc closes it without
  // resolving anything), `incidentToast` names a late incident without stealing focus.
  incidents: UpdateIncident[];
  incidentPopupOpen: boolean;
  incidentToast: string | null;
  resolveUpdateIncident: (id: string, choice: UpdateBlockerChoice) => void;
  openIncidentPopup: () => void;
  closeIncidentPopup: () => void;
  clearIncidentToast: () => void;
  // The live per-service run tracking. `liveServicePhase` holds the current
  // step core's `onPhase` observer reported per service (cleared when the run lands);
  // `liveServiceIssues` holds the per-service issue log — a blocker firing appends an
  // unresolved entry, the next phase for that service flips its unresolved entries to
  // resolved (core resumed, so the re-verify passed; a failed re-verify never emits the
  // next phase), and a mid-run migration failure appends an unresolved `migration-failed`
  // entry at completion. Both maps are cleared per run (at start, and on top-level
  // error); the issue map additionally survives completion so a migration failure that
  // ended its service mid-run stays inspectable until the next run clears it.
  liveServicePhase: Record<string, UpdatePhase>;
  // The `shared-types` phase (publishing / propagating) currently running on a service — the
  // source repo, whose own row is already final while the phase runs. Cleared with the live maps.
  liveSharedTypesPhase: Record<string, SharedTypesStage>;
  liveServiceIssues: Record<string, ServiceIssue[]>;
  // The per-service step tracker (merge / migration / restart, each pending → running →
  // done|failed|skipped) advanced by the same `onPhase` emissions; cleared with the live maps.
  liveServiceSteps: Record<string, ServiceStepStates>;
  // A trigger rejected while a group run is in flight (second update, service restart, config
  // open): shown by the zone without touching `updateStatus`, cleared when the run ends.
  updateNotice: { code: string; message: string } | null;
  // Services of the in-flight run whose final row already landed (core's `onServiceResult`): the
  // detail pane shows their last-update view while the others are still running.
  liveServiceDone: Record<string, true>;
  // The last finished run's per-service snapshot — settled steps, final row, and the context
  // (merge source, target branch, EDT topic) — kept in memory for the detail pane's
  // "last update" view; merged per service, never wholesale-replaced.
  lastServiceRuns: Record<string, ServiceRunSnapshot>;
  // Starts the core use-case in-process. A no-op-with-signal guard, not a throw, when the
  // store is unwired; a second call while a run is already in flight reports
  // `update-already-running` so double-Enter gives feedback instead of silence.
  // `scope` defaults to `'edt'` (bare update); `'all'` runs the all-repos maintenance mode.
  runGroupUpdate: (scope?: GroupUpdateScope, opts?: UpdateRunOptions) => Promise<void>;
  // The pre-run configuration screen's store state. Null when no screen is
  // open; otherwise the draft the zone renders (rows pre-selected per scope, branches
  // pre-filled from each manifest `sharedBranch`, migrate ON, clean restart OFF). Opened
  // by every group-update trigger before any git/docker action runs — the run itself
  // starts only through `confirmUpdateConfig` with exactly the confirmed configuration.
  updateConfig: UpdateConfigDraft | null;
  // Opens the configuration screen pre-scoped to the target, resolving every row's branch
  // default before the screen renders. Rejects like `runGroupUpdate` when unwired, while a
  // run is in flight (`update-already-running`), or when the target cannot be resolved
  // (no-active-edt, edt-not-found, service-not-found) — the screen never opens in those
  // cases, so no git/docker action ever runs unconfigured.
  openUpdateConfig: (target: OpenUpdateConfigTarget) => Promise<void>;
  // The `:update-service [name]` entry point (like openEdtSwitchDialog's query-arg contract).
  // With a name, it resolves straight to that service's pre-scoped single-service config
  // (`service-not-found` when unknown, no screen). Without one, it raises
  // `updateServiceSelectRequest` for the Update zone to consume — the zone pre-scopes to its
  // highlighted row when one is selected, else opens the filterable service quick-pick below.
  // The running/restart guards match openUpdateConfig's, so no trigger opens a screen mid-run.
  openUpdateServiceDialog: (fullQuery: string) => Promise<void>;
  // Set by openUpdateServiceDialog's no-arg path; consumed once by the Update
  // zone's effect (selection → pinned config, else the quick-pick), which clears it via
  // clearUpdateServiceSelectionRequest. A plain boolean (not a counter): a second no-arg
  // command while one request is still unconsumed is the same intent, never a queue.
  updateServiceSelectRequest: boolean;
  clearUpdateServiceSelectionRequest: () => void;
  // The filterable service quick-pick's candidates (the no-arg `:update-service` fallback when
  // the Update zone has no row selected). Null when the pick is closed. Filter text and cursor
  // stay zone-local useState (only cross-visit state belongs in the slice); confirming a row
  // calls openUpdateConfig({service, repoPath}) directly.
  updateServicePick: { service: string; repoPath: string }[] | null;
  // Builds the pick candidates from every managed repo (the openAllReposConfig posture:
  // unmanaged paths silently skipped; any other load failure still lists a row under its
  // path-basename service so the run reports it instead of dropping it silently). Empty
  // registry (or nothing listable) fails `no-services-selected` with no pick opened.
  openUpdateServicePick: () => Promise<void>;
  closeUpdateServicePick: () => void;
  // Replaces the open draft wholesale (the zone computes the next draft through the
  // dialog logic's pure functions); a no-op without an open screen.
  setUpdateConfig: (draft: UpdateConfigDraft) => void;
  // Closes the screen without starting anything — nothing ran.
  closeUpdateConfig: () => void;
  // Confirms the open draft: zero selected (or a blank branch) is rejected inline and the
  // screen stays open; otherwise the screen closes and the run starts immediately with
  // exactly that configuration, no further prompt.
  confirmUpdateConfig: () => Promise<void>;
  // The EDTs the merge-source quick-pick offers: every registered EDT except the one being
  // updated. Empty when unwired or the registry cannot be read.
  listMergeSourceEdts: () => Promise<{ ulid: string; topic: string }[]>;
  // Re-resolves the open draft's rows from the chosen EDT's recorded member branches. A
  // vanished EDT leaves the draft untouched and reports inline.
  chooseMergeSourceEdt: (ulid: string) => Promise<void>;
  // Marks the run's EDT `interrupted` after an abandoned run (quit-mid-run confirmation)
  // and refreshes `edts` so the next idle render offers a re-run — but only while a run
  // is actually in flight: a quit-confirm racing completion must never mark a healthy,
  // already-finished EDT interrupted. Never throws when unwired or when no run ever
  // targeted an EDT.
  // Per-service standalone clean-restart in-flight map, keyed by resolved
  // repoPath (the core `service:<resolved-repoPath>` lock identity). Checked alongside the
  // global `updateStatus === 'running'` guard in both directions: a group run never starts
  // while any standalone restart is in flight, and a standalone restart never starts while
  // a group run (or the same service's own restart) is in flight. Serialization stays per
  // service — a different idle service stays triggerable while one restarts.
  serviceRestartInFlight: Record<string, 'restart'>;
  // Runs the standalone single-service clean restart in-process (recipe or plain fallback,
  // core-side decision). The row shows `restarting` while the map holds its repoPath; the
  // final `{service, outcome, detail?}` row merges into `lastServiceOutcomes` (never into the
  // group run's `updateResults`). Contention surfaces as `update-already-running`.
  runServiceRestart: (repoPath: string) => Promise<void>;
  // Whether the row-local action menu should offer a restart for this repo: a service with a
  // container always qualifies (the standalone path falls back to the plain container
  // restart), while a container-less one qualifies only with a declared `restartCommands`
  // recipe. Fail-open (an unloadable manifest still offers it) so the choice itself reports
  // the load failure instead of hiding the row silently. The zone calls this when opening
  // the menu — never a driven port directly from a component.
  describeServiceRestart: (repoPath: string) => Promise<{ restartAvailable: boolean }>;
  // Opens a repo in the developer's editor through the shared service-actions registry, with
  // the configured `general.editorCommand`. Synchronous: the editor owns the terminal until it
  // exits. Errors (unwired port, launch failure) come back as a Result for the caller to show.
  openInIde: (repoPath: string) => Result<void>;
  markUpdateInterrupted: () => Promise<void>;
  clearUpdate: () => void;

  // Live per-service health-first status (AD-23, through core/service-status) for the Update
  // zone's always-visible service list — keyed by repoPath, independent of the Logs zone's
  // `logsPanes[*].health`. A repoPath with no entry yet (poll in flight, or never started) reads
  // as `down`, until the first poll resolves. `no-container` is a manifest declaring neither a
  // `container` nor a probed `healthUrl` — recorded without ever polling Docker for the service.
  updateServiceHealth: Record<string, ServiceStatusState>;
  // The last completed run's per-service outcome, keyed by `service` (results
  // carry no repoPath) — merged, never wholesale-replaced, by runGroupUpdate's success
  // branch below, so a partial-scope run never drops another service's earlier outcome.
  lastServiceOutcomes: Record<string, GroupUpdateRepoResult>;
  // Starts (or restarts, on a changed service list) a one-shot-then-interval poll of every
  // given repoPath's container health — like logs-slice.health.ts's pollPaneHealth/
  // startHealthPolling, but one poll cycle covers every service in `edtsBranches` at once
  // rather than one timer per pane.
  startUpdateHealthPolling: (repoPaths: readonly string[]) => void;
  stopUpdateHealthPolling: () => void;
};

// Appends an unresolved issue entry for a service, deduped — a re-presented
// menu for the same still-blocked kind (core loops the seam until re-verification passes)
// must not stack duplicate rows; the single entry flips to resolved once the run resumes.
export function appendLiveIssue(
  issues: Record<string, ServiceIssue[]>,
  service: string,
  issue: ServiceIssue,
): Record<string, ServiceIssue[]> {
  const existing = issues[service] ?? [];
  if (existing.some((entry) => entry.kind === issue.kind && !entry.resolved)) {
    return issues;
  }
  return { ...issues, [service]: [...existing, issue] };
}

// Marks a service's unresolved entries resolved — called when core emits the
// service's next phase, which only happens after a passing re-verification (a failed
// re-verify re-presents the menu instead of advancing the pipeline).
export function resolveLiveIssues(issues: Record<string, ServiceIssue[]>, service: string): Record<string, ServiceIssue[]> {
  const existing = issues[service];
  if (existing === undefined || existing.every((entry) => entry.resolved)) {
    return issues;
  }
  return { ...issues, [service]: existing.map((entry) => (entry.resolved ? entry : { ...entry, resolved: true })) };
}

export function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record;
  return rest;
}

// Settles each finished row's live steps into the in-memory last-run snapshot, with its
// merge source (confirmed override, else the shared branch), target branch and EDT topic.
export function mergeLastServiceRuns(
  state: AppState,
  results: readonly GroupUpdateRepoResult[],
  topic: string | null,
): Record<string, ServiceRunSnapshot> {
  const next = { ...state.lastServiceRuns };
  for (const result of results) {
    // Already settled when its row landed mid-run — the live steps are gone by now.
    if (state.liveServiceDone[result.service] === true) {
      continue;
    }
    next[result.service] = {
      steps: finalizeServiceSteps(state.liveServiceSteps[result.service], result),
      result,
      source: state.updateSelection?.find((item) => item.service === result.service)?.sourceBranch,
      target: state.edtsBranches?.find((row) => row.service === result.service)?.branch ?? null,
      topic,
    };
  }
  return next;
}

export interface ServiceRunSnapshot {
  steps: ServiceStepStates;
  result: GroupUpdateRepoResult;
  source: string | undefined;
  target: string | null;
  topic: string | null;
}

// The `shared-types` phase failed (publish or propagation): the run is paused on the source
// service until the developer picks retry / skip / abort. Raised through the same incident
// queue as the core blockers, which stay untouched.
export interface SharedTypesPhaseBlocker {
  service: string;
  repoPath: string;
  kind: typeof SHARED_TYPES_PHASE_FAILED;
  message: string;
}

export type IncidentBlocker = UpdateBlocker | SharedTypesPhaseBlocker;

// One service waiting on the developer. `stillBlocked` marks an incident re-raised after a
// choice whose re-verification did not settle it, with the reason core reported.
export interface UpdateIncident {
  id: string;
  blocker: IncidentBlocker;
  raisedAt: number;
  stillBlocked?: { reason: string };
}

export type UpdateSliceSet = Parameters<StateCreator<AppState, [], [], UpdateSlice>>[0];
export type UpdateSliceGet = Parameters<StateCreator<AppState, [], [], UpdateSlice>>[1];

// The mutable closure state the Update sub-creators share. Created once per
// `createUpdateSlice(deps)` call (never at module level) so it keeps the lifetime the single
// closure had; sub-creators read and write these fields by reference. Never in Zustand state.
export interface UpdateSliceContext {
  deps: AppStoreDeps | undefined;
  // The pending seam promise's resolver — installed when core raises a blocker,
  // consumed when the zone menu dispatches a choice (a function is non-serializable, and
  // set() replacements must not drop it).
  incidentResolvers: Map<string, (choice: UpdateBlockerChoice) => void>;
  // The kind of the last incident each service raised in this run — a second incident of the same
  // kind is a failed re-verification ("still blocked").
  raisedKinds: Map<string, IncidentBlocker['kind']>;
  incidentSequence: number;
  // One shared poll timer for every currently-tracked service, restarted whenever the tracked
  // list changes so a stale timer never leaks.
  healthPollTimer: ReturnType<typeof setInterval> | null;
  // Per-repo in-flight guard for the health poll: a slow health route never stacks probes, and a
  // poll still settling after stop/retarget is dropped.
  healthInFlight: InFlightGuard;
  pollingRepoPaths: readonly string[];
  // The service quick-pick's generation — bumped on every open and every close so a slow
  // enumeration from an earlier open can never pop the pick open after the user cancelled.
  servicePickGeneration: number;
}
