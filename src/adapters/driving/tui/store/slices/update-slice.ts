// tui/store/slices: the Update zone's group-update run state. Calls the same
// core/scripts/group-update.ts use-case the CLI's `tui-back update` wraps, in-process (AD-2,
// never by shelling out to the CLI).
import { resolve } from 'node:path';
import type { StateCreator } from 'zustand';
import {
  groupUpdate as groupUpdateUseCase,
  markGroupUpdateInterrupted as markGroupUpdateInterruptedUseCase,
  MIGRATION_FAILED_CODE,
  type AutoResolveConflict,
  type GroupUpdateRepoResult,
  type GroupUpdateScope,
  type StageControl,
  type GroupUpdateSelectionItem,
  type OnUpdatePhase,
  type UpdateBlocker,
  type UpdateBlockerChoice,
  type UpdatePhase,
} from '../../../../../core/scripts/group-update.js';
import { serviceRestart as serviceRestartUseCase } from '../../../../../core/scripts/service-restart.js';
import { openInIde } from '../../../../../core/service-actions/index.js';
import { resolveServiceStatus, type ServiceStatusState } from '../../../../../core/service-status/index.js';
import { createInFlightGuard } from '../../shared/poll/in-flight-guard.js';
import { err, ok, type Result } from '../../../../../core/result.js';
import {
  advanceServiceSteps,
  finalizeServiceSteps,
  mergeLastServiceOutcomes,
  type ServiceIssue,
  type ServiceStepStates,
} from '../../zones/update/update-zone.logic.js';
import { autoResolveSharedTypesConflict } from '../../../../../core/shared-types/resolve-conflict.js';
import { listConsumers, type DependencyConsumer } from '../../../../../core/shared-types/list-consumers.js';
import {
  runSharedTypesPhase,
  SHARED_TYPES_PHASE_FAILED,
  shouldRunSharedTypesPhase,
  type SharedTypesMode,
  type SharedTypesPhaseFailure,
  type SharedTypesPhaseOutcome,
  type SharedTypesStage,
} from '../../../../../core/shared-types/smart-update.js';
import { resolveSingleSourceOf, resolveSourceRegistries } from './shared-types-slice.js';
import { loadMergeSourcesFromEdt } from '../../../../../core/scripts/resolve-merge-sources.js';
import {
  applyMergeStrategy,
  confirmUpdateConfigDraft,
  createUpdateConfigDraft,
  type ConfigLayout,
  type UpdateConfigRowInput,
  type UpdateConfigDraft,
} from '../../zones/update/update-config-dialog.logic.js';
import type { AppState, AppStoreDeps } from '../app-store.js';

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
  // given repoPath's container health — like logs-slice.ts's pollPaneHealth/
  // startHealthPolling, but one poll cycle covers every service in `edtsBranches` at once
  // rather than one timer per pane.
  startUpdateHealthPolling: (repoPaths: readonly string[]) => void;
  stopUpdateHealthPolling: () => void;
};

// Appends an unresolved issue entry for a service, deduped — a re-presented
// menu for the same still-blocked kind (core loops the seam until re-verification passes)
// must not stack duplicate rows; the single entry flips to resolved once the run resumes.
function appendLiveIssue(
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
function resolveLiveIssues(issues: Record<string, ServiceIssue[]>, service: string): Record<string, ServiceIssue[]> {
  const existing = issues[service];
  if (existing === undefined || existing.every((entry) => entry.resolved)) {
    return issues;
  }
  return { ...issues, [service]: existing.map((entry) => (entry.resolved ? entry : { ...entry, resolved: true })) };
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record;
  return rest;
}

// Settles each finished row's live steps into the in-memory last-run snapshot, with its
// merge source (confirmed override, else the shared branch), target branch and EDT topic.
function mergeLastServiceRuns(
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

export function createUpdateSlice(deps?: AppStoreDeps): StateCreator<AppState, [], [], UpdateSlice> {
  // The pending seam promise's resolver — installed when core raises a blocker,
  // consumed when the zone menu dispatches a choice. Held in closure, never in Zustand
  // state (a function is non-serializable, and set() replacements must not drop it).
  const incidentResolvers = new Map<string, (choice: UpdateBlockerChoice) => void>();
  // The kind of the last incident each service raised in this run — a second incident of the same
  // kind is a failed re-verification ("still blocked"). Never in Zustand state.
  const raisedKinds = new Map<string, IncidentBlocker['kind']>();
  let incidentSequence = 0;
  // One shared poll timer for every currently-tracked service (not one per
  // repoPath, unlike logs-slice.ts) — restarted whenever the tracked list changes so a
  // service that appears/disappears from `edtsBranches` is picked up without leaking a
  // stale timer. Held in closure, mirrors logs-slice.ts's own healthPollTimers convention.
  let healthPollTimer: ReturnType<typeof setInterval> | null = null;
  // Per-repo in-flight guard for the health poll: a slow health route never stacks probes, and a
  // poll still settling after stop/retarget is dropped.
  const healthInFlight = createInFlightGuard();
  let pollingRepoPaths: readonly string[] = [];
  // The service quick-pick's generation — bumped on every open and every
  // close so a slow enumeration from an earlier open can never pop the pick open after
  // the user already cancelled (or re-opened). Held in closure, never in Zustand state.
  let servicePickGeneration = 0;
  return (set, get) => {
    // One poll cycle for a single service — resolves its health-first status through
    // core/service-status, updating the badge only on success. Like logs-slice.ts's
    // pollPaneHealth, any failure (manifest load fails, Docker and the probe both fail) keeps
    // last-known health and never crashes the view. A tick for a repo whose previous poll (probe
    // included) is still awaiting is skipped.
    async function pollServiceHealth(repoPath: string): Promise<void> {
      if (!deps) {
        return;
      }
      const token = healthInFlight.begin(repoPath);
      if (token === null) {
        return;
      }
      try {
        const status = await resolveServiceStatus(
          { manifest: deps.manifest, docker: deps.docker, ...(deps.healthProbe === undefined ? {} : { healthProbe: deps.healthProbe }) },
          repoPath,
        );
        // A repo no longer polled (stopped, or retargeted away) keeps no late write.
        if (!status.ok || !pollingRepoPaths.includes(repoPath) || !healthInFlight.isCurrent(repoPath, token)) {
          return;
        }
        const health = status.data.state;
        set((state) => {
          if (state.updateServiceHealth[repoPath] === health) {
            return {};
          }
          return { updateServiceHealth: { ...state.updateServiceHealth, [repoPath]: health } };
        });
      } finally {
        healthInFlight.end(repoPath, token);
      }
    }

    function pollAll(repoPaths: readonly string[]): void {
      for (const repoPath of repoPaths) {
        void pollServiceHealth(repoPath);
      }
    }

    // Resolves one repo's branch default for the config screen — the manifest
    // `sharedBranch`, falling back to the schema default (`development`) when the manifest
    // fails to load so the row still renders and the run itself reports the load failure
    // as that service's `failed` row.
    async function resolveBranchDefault(repoPath: string): Promise<string> {
      return (await resolveRowManifest(repoPath)).sourceBranch;
    }

    // What one row needs from its manifest: the shared branch plus whether the migration
    // command and the clean-restart recipe are declared (an undeclared action never runs).
    async function resolveRowManifest(
      repoPath: string,
    ): Promise<{ sourceBranch: string; migrationDeclared: boolean; recipeDeclared: boolean }> {
      const loaded = deps ? await deps.manifest.load(repoPath) : null;
      if (loaded === null || !loaded.ok) {
        // Unreadable manifest: claim nothing (the run reports the load failure on its own row).
      return { sourceBranch: 'development', migrationDeclared: false, recipeDeclared: false };
      }
      return {
        sourceBranch: loaded.data.sharedBranch,
        migrationDeclared: (loaded.data.migrationCommand?.trim() ?? '') !== '',
        recipeDeclared: (loaded.data.restartCommands?.length ?? 0) > 0,
      };
    }

    function failConfigOpen(code: string, message: string): void {
      set({ updateStatus: 'error', updateError: message, updateErrorCode: code });
    }

    // Opens the screen over a clean banner: a stale `done`/`error` outcome from the previous
    // run must not linger underneath the new configuration. Per-run history
    // (`updateResults`, `lastServiceOutcomes`) is kept — only the banner fields reset.
    // The `shared-types` row exists only when the active EDT has exactly one source repo and it
    // is one of the rows: that row's repoPath, else null (row hidden).
    async function resolveSharedTypesSource(rows: readonly UpdateConfigRowInput[]): Promise<string | null> {
      try {
        const resolved = await resolveSingleSourceOf(deps);
        if (!resolved.ok) {
          return null;
        }
        const wanted = resolve(resolved.source.repoPath);
        return rows.find((row) => resolve(row.repoPath) === wanted)?.repoPath ?? null;
      } catch {
        return null;
      }
    }

    async function openConfigDraft(
      scope: GroupUpdateScope,
      rows: UpdateConfigRowInput[],
      options?: { layout?: ConfigLayout },
    ): Promise<void> {
      const sharedTypesSource = await resolveSharedTypesSource(rows);
      set({
        updateConfig: createUpdateConfigDraft(scope, rows, {
          ...options,
          sharedTypesSource,
          defaults: get().settings.update,
        }),
        updateStatus: 'idle',
        updateError: null,
        updateErrorCode: null,
        updateNote: null,
      });
    }

    // Pre-scopes the screen to the active EDT's members (deduped by resolved
    // repoPath, first wins — the core use-case's own rule).
    async function openEdtConfig(): Promise<void> {
      if (!deps) {
        return;
      }
      const currentActive = await deps.state.readActiveEdt();
      if (!currentActive.ok) {
        failConfigOpen(currentActive.error.code, currentActive.error.message);
        return;
      }
      if (currentActive.data === null) {
        failConfigOpen('no-active-edt', 'No active EDT — switch to an EDT before running tui-back update');
        return;
      }
      const listed = await deps.edtRegistry.list();
      if (!listed.ok) {
        failConfigOpen(listed.error.code, listed.error.message);
        return;
      }
      const active = listed.data.find((candidate) => candidate.ulid === currentActive.data);
      if (active === undefined) {
        failConfigOpen('edt-not-found', `Active EDT "${currentActive.data}" is no longer registered`);
        return;
      }
      const seen = new Set<string>();
      const members = active.members.filter((member) => {
        const key = resolve(member.repoPath);
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
      const rows = [];
      for (const member of members) {
        rows.push({ service: member.service, repoPath: member.repoPath, ...(await resolveRowManifest(member.repoPath)) });
      }
      if (rows.length === 0) {
        failConfigOpen('no-services-selected', `EDT "${active.topic}" has no member services — nothing to update.`);
        return;
      }
      await openConfigDraft('edt', rows, { layout: 'edt-panels' });
    }

    // The managed-repo enumeration shared by openAllReposConfig and
    // openUpdateServicePick (one definition so the all-repos config and the service
    // quick-pick can never list different services): the list-repos posture — unmanaged
    // paths silently skipped; any other load failure still yields a row under its
    // path-basename service so the run reports it instead of dropping it silently;
    // deduped by resolved repoPath, first wins.
    async function listManagedServiceRows(): Promise<
      { ok: true; rows: { service: string; repoPath: string; sourceBranch: string }[] } | { ok: false; code: string; message: string }
    > {
      if (!deps) {
        return { ok: false, code: 'store-not-wired', message: 'No ports wired into the TUI store' };
      }
      const listed = await deps.registry.list();
      if (!listed.ok) {
        return { ok: false, code: listed.error.code, message: listed.error.message };
      }
      const seen = new Set<string>();
      const paths = listed.data
        .filter((candidate) => candidate.trim() !== '')
        .filter((candidate) => {
          const key = resolve(candidate);
          if (seen.has(key)) {
            return false;
          }
          seen.add(key);
          return true;
        });
      const rows = [];
      for (const repoPath of paths) {
        const loaded = await deps.manifest.load(repoPath);
        if (!loaded.ok) {
          if (loaded.error.code === 'manifest-not-found') {
            continue;
          }
          const base = repoPath.split('/').pop();
          rows.push({ service: base !== undefined && base !== '' ? base : repoPath, repoPath, sourceBranch: 'development' });
          continue;
        }
        rows.push({ service: loaded.data.service, repoPath, ...(await resolveRowManifest(repoPath)) });
      }
      return { ok: true, rows };
    }

    // Pre-scopes the screen to every managed repo (the list-repos posture:
    // unmanaged paths silently skipped; any other load failure still renders a row under
    // its path-basename service so the run reports it instead of dropping it silently).
    async function openAllReposConfig(): Promise<void> {
      const enumerated = await listManagedServiceRows();
      if (!enumerated.ok) {
        // An unwired store degrades to the same explicit error state openUpdateConfig's
        // own guard reports — never a throw, never a screen.
        failConfigOpen(enumerated.code, enumerated.message);
        return;
      }
      if (enumerated.rows.length === 0) {
        failConfigOpen('no-services-selected', 'No managed repos found — nothing to update.');
        return;
      }
      await openConfigDraft('all', enumerated.rows, { layout: 'all-panels' });
    }

    // The reusable pre-scoped entry point (the single-service update reuses it): exactly one
    // row. An explicit `repoPath` pins the repo directly; otherwise the service resolves
    // through the active EDT's members first, then every managed repo. The run scope follows
    // where the service was found.
    async function openSingleServiceConfig(service: string, repoPath?: string): Promise<void> {
      if (!deps) {
        return;
      }
      if (repoPath !== undefined) {
        const loaded = await deps.manifest.load(repoPath);
        if (!loaded.ok) {
          failConfigOpen(loaded.error.code, loaded.error.message);
          return;
        }
        const scope = await scopeForRepoPath(repoPath);
        if (!scope.ok) {
          failConfigOpen(scope.error.code, scope.error.message);
          return;
        }
        await openConfigDraft(scope.data, [
          { service: loaded.data.service, repoPath, sourceBranch: loaded.data.sharedBranch },
        ]);
        return;
      }
      const currentActive = await deps.state.readActiveEdt();
      if (currentActive.ok && currentActive.data !== null) {
        const listed = await deps.edtRegistry.list();
        if (!listed.ok) {
          failConfigOpen(listed.error.code, listed.error.message);
          return;
        }
        const active = listed.data.find((candidate) => candidate.ulid === currentActive.data);
        const wanted = service.toLowerCase();
        const member = active?.members.find((candidate) => candidate.service.toLowerCase() === wanted);
        if (member !== undefined) {
          await openConfigDraft('edt', [
            { service: member.service, repoPath: member.repoPath, sourceBranch: await resolveBranchDefault(member.repoPath) },
          ]);
          return;
        }
      }
      const registered = await deps.registry.list();
      if (!registered.ok) {
        failConfigOpen(registered.error.code, registered.error.message);
        return;
      }
      for (const candidate of registered.data) {
        if (candidate.trim() === '') {
          continue;
        }
        const loaded = await deps.manifest.load(candidate);
        if (loaded.ok && loaded.data.service.toLowerCase() === service.toLowerCase()) {
          await openConfigDraft('all', [
            { service: loaded.data.service, repoPath: candidate, sourceBranch: loaded.data.sharedBranch },
          ]);
          return;
        }
      }
      failConfigOpen('service-not-found', `Service "${service}" is neither a member of the active EDT nor a managed repo`);
    }

    // The run scope for a pinned repoPath: `edt` when it is a member of the active EDT,
    // `all` otherwise (the core use-case's unexpected-branch gate only applies under `edt`).
    // A null active pointer still resolves to `all` (no EDT to gate against), but a failing
    // state read or registry list rejects the open with the underlying error instead of
    // silently downgrading the gate away.
    async function scopeForRepoPath(repoPath: string): Promise<Result<GroupUpdateScope>> {
      if (!deps) {
        return err('internal-error', 'No ports wired into the TUI store');
      }
      const currentActive = await deps.state.readActiveEdt();
      if (!currentActive.ok) {
        return err(currentActive.error.code, currentActive.error.message);
      }
      if (currentActive.data === null) {
        return ok('all');
      }
      const listed = await deps.edtRegistry.list();
      if (!listed.ok) {
        return err(listed.error.code, listed.error.message);
      }
      const active = listed.data.find((candidate) => candidate.ulid === currentActive.data);
      const wanted = resolve(repoPath);
      return ok(active !== undefined && active.members.some((member) => resolve(member.repoPath) === wanted) ? 'edt' : 'all');
    }

    // Raises one incident in the queue and waits for the developer's choice. Shared by core's
    // blocker seam and the `shared-types` phase failure: the first incident opens the popup when
    // the developer is in the Update zone, later ones never steal focus (a toast names them).
    function raiseIncident(blocker: IncidentBlocker): Promise<UpdateBlockerChoice> {
      incidentSequence += 1;
      const id = `incident-${incidentSequence}`;
      const stillBlocked = raisedKinds.get(blocker.service) === blocker.kind;
      raisedKinds.set(blocker.service, blocker.kind);
      const reason = 'retryReason' in blocker ? blocker.retryReason : undefined;
      const incident: UpdateIncident = {
        id,
        blocker,
        raisedAt: Date.now(),
        ...(stillBlocked
          ? { stillBlocked: { reason: blocker.kind === SHARED_TYPES_PHASE_FAILED ? (blocker as SharedTypesPhaseBlocker).message : (reason ?? 'Re-verification failed — the repo is still blocked') } }
          : {}),
      };
      return new Promise<UpdateBlockerChoice>((resolveChoice) => {
        incidentResolvers.set(id, resolveChoice);
        set((state) => {
          const first = state.incidents.length === 0;
          const popupOpensNow = first && state.activeZone === 'update';
          return {
            incidents: [...state.incidents, incident],
            incidentPopupOpen: popupOpensNow ? true : state.incidentPopupOpen,
            incidentToast: popupOpensNow ? state.incidentToast : `${blocker.service} needs you (${blocker.kind})`,
            // A resolved entry re-raised stays unresolved; only a fresh service appends.
            liveServiceIssues: stillBlocked
              ? state.liveServiceIssues
              : appendLiveIssue(state.liveServiceIssues, blocker.service, {
                  kind: blocker.kind,
                  detail:
                    blocker.kind === SHARED_TYPES_PHASE_FAILED
                      ? (blocker as SharedTypesPhaseBlocker).message
                      : blocker.kind === 'unpushed-commits'
                        ? `${blocker.branch ?? ''}: ${(blocker.commits ?? []).join(' | ')}`
                        : blocker.kind === 'merge-conflict' && blocker.autoResolveNote !== undefined
                          ? `${blocker.repoPath} — ${blocker.autoResolveNote}`
                          : blocker.repoPath,
                  resolved: false,
                }),
          };
        });
      });
    }

    // Builds the between-stage hook of a smart group update: once the source repo (alone in
    // stage 0) is updated, publish and propagate its version; on failure pause on an incident
    // (retry / skip / abort). Never throws — every failure becomes a phase failure.
    function buildSharedTypesHook(mode: SharedTypesMode, sourceRepoPath: string | null | undefined, runState: { publishedVersion: string | undefined }) {
      if (
        mode === 'off' ||
        sourceRepoPath === null ||
        sourceRepoPath === undefined ||
        !deps ||
        deps.container === undefined ||
        deps.restart === undefined ||
        deps.sharedTypes === undefined
      ) {
        return null;
      }
      const sharedDeps = deps;
      const wired = deps.sharedTypes;
      const container = deps.container;
      const restart = deps.restart;
      const sourceKey = resolve(sourceRepoPath);
      const setStage = (service: string, stage: SharedTypesStage | null) =>
        set((state) => ({ liveSharedTypesPhase: stage === null ? omitKey(state.liveSharedTypesPhase, service) : { ...state.liveSharedTypesPhase, [service]: stage } }));

      const attempt = async (sourceRow: GroupUpdateRepoResult | undefined, publishedVersion: string | undefined): Promise<Result<unknown>> => {
        const resolved = await resolveSingleSourceOf(sharedDeps);
        if (!resolved.ok) {
          return err(SHARED_TYPES_PHASE_FAILED, resolved.message ?? 'Cannot resolve the source repo.');
        }
        const source = resolved.source;
        if (resolve(source.repoPath) !== sourceKey) {
          return err(SHARED_TYPES_PHASE_FAILED, `The source repo changed since the configuration was opened (${source.service}).`);
        }
        if (!shouldRunSharedTypesPhase(mode, sourceRow)) {
          return ok(undefined);
        }
        if (wired.consumerModuleId === undefined || wired.parseConsumerConfig === undefined) {
          return err(SHARED_TYPES_PHASE_FAILED, 'Version propagation is not available in this session.');
        }
        const consumers = await listConsumers({
          edtRegistry: sharedDeps.edtRegistry,
          manifest: sharedDeps.manifest,
          state: sharedDeps.state,
          moduleId: wired.consumerModuleId,
          parseConfig: wired.parseConsumerConfig,
        });
        if (!consumers.ok) {
          return err(SHARED_TYPES_PHASE_FAILED, consumers.error.message);
        }
        return runSharedTypesPhase({
          git: sharedDeps.git,
          manifest: sharedDeps.manifest,
          container,
          restart,
          shared: wired.port,
          mode,
          source,
          sourceRow,
          consumers: consumers.data.consumers,
          registries: await resolveSourceRegistries(sharedDeps),
          ...(publishedVersion !== undefined ? { publishedVersion } : {}),
          onStage: (stage) => setStage(source.service, stage),
        });
      };

      const afterStage = async (stage: number, rows: GroupUpdateRepoResult[], control: StageControl): Promise<void> => {
        // Stage 0 holds the source repo alone; later stages are the remaining services.
        const sourceRow = stage === 0 ? rows[0] : undefined;
        if (stage !== 0 || sourceRow === undefined || !shouldRunSharedTypesPhase(mode, sourceRow)) {
          return;
        }
        const service = sourceRow.service;
        let publishedVersion: string | undefined;
        for (;;) {
          let outcome: Result<unknown>;
          try {
            outcome = await attempt(sourceRow, publishedVersion);
          } catch (error) {
            outcome = err(SHARED_TYPES_PHASE_FAILED, error instanceof Error ? error.message : String(error));
          }
          setStage(service, null);
          if (outcome.ok) {
            const phase = outcome.data as SharedTypesPhaseOutcome | undefined;
            if (phase?.status === 'done') {
              // Kept by the conflict auto-resolver for the rest of the run.
              runState.publishedVersion = phase.version;
            }
            set((state) => ({ liveServiceIssues: resolveLiveIssues(state.liveServiceIssues, service) }));
            return;
          }
          const details = outcome.error.details as SharedTypesPhaseFailure | undefined;
          publishedVersion = details?.publishedVersion ?? publishedVersion;
          if (publishedVersion !== undefined) {
            runState.publishedVersion = publishedVersion;
          }
          const choice = await raiseIncident({ service, repoPath: sourceRepoPath, kind: SHARED_TYPES_PHASE_FAILED, message: outcome.error.message });
          if (choice === 'edited') {
            continue;
          }
          set((state) => ({ liveServiceIssues: resolveLiveIssues(state.liveServiceIssues, service) }));
          if (choice === 'cancel-run') {
            control.cancel();
          }
          return;
        }
      };

      return { ordering: (target: { service: string; repoPath: string }) => (resolve(target.repoPath) === sourceKey ? 0 : 1), afterStage };
    }

    // The conflict auto-resolution seam of a run: settles the consumers' dependency version on a
    // conflicting merge/pull. Null when the consumer module or the restart port is not wired.
    function buildAutoResolveConflict(runState: { publishedVersion: string | undefined }): AutoResolveConflict | null {
      const wired = deps?.sharedTypes;
      if (
        !deps ||
        deps.restart === undefined ||
        wired === undefined ||
        wired.consumerModuleId === undefined ||
        wired.parseConsumerConfig === undefined
      ) {
        return null;
      }
      const resolverDeps = deps;
      const restart = deps.restart;
      const moduleId = wired.consumerModuleId;
      const parseConfig = wired.parseConsumerConfig;
      // Cached once read successfully; a failed read is retried on the next conflict.
      let consumers: DependencyConsumer[] | undefined;
      return async ({ repoPath }) => {
        if (consumers === undefined) {
          const listed = await listConsumers({
            edtRegistry: resolverDeps.edtRegistry,
            manifest: resolverDeps.manifest,
            state: resolverDeps.state,
            moduleId,
            parseConfig,
          });
          if (!listed.ok) {
            return { touched: false, issue: `Cannot list the consumers of the active EDT: ${listed.error.message}` };
          }
          consumers = listed.data.consumers;
        }
        const wanted = resolve(repoPath);
        const consumer = consumers.find((candidate) => resolve(candidate.repoPath) === wanted);
        if (consumer === undefined) {
          return { touched: false };
        }
        return autoResolveSharedTypesConflict({
          git: resolverDeps.git,
          restart,
          repoPath,
          consumer,
          ...(runState.publishedVersion !== undefined ? { preferredVersion: runState.publishedVersion } : {}),
        });
      };
    }

    return {
      updateStatus: 'idle',
      updateResults: [],
      updateNote: null,
      updateTopic: null,
      updateError: null,
      updateErrorCode: null,
      updateUlid: null,
      updateScope: null,
      updateSelection: null,
      incidents: [],
      incidentPopupOpen: false,
      incidentToast: null,
      liveServicePhase: {},
      liveSharedTypesPhase: {},
      liveServiceSteps: {},
      updateNotice: null,
      liveServiceDone: {},
      liveServiceIssues: {},
      lastServiceRuns: {},
      resolveUpdateIncident: (id: string, choice: UpdateBlockerChoice) => {
        const resolveChoice = incidentResolvers.get(id);
        if (resolveChoice === undefined) {
          return;
        }
        incidentResolvers.delete(id);
        if (choice === 'cancel-run') {
          // Cancelling the whole run closes every other pending incident as cancelled; core
          // stops unstarted services and finishes in-flight ones at their step boundary.
          const others = [...incidentResolvers.entries()];
          incidentResolvers.clear();
          set({ incidents: [], incidentPopupOpen: false, incidentToast: null });
          resolveChoice(choice);
          for (const [, otherResolve] of others) {
            otherResolve('cancel-run');
          }
          return;
        }
        set((state) => {
          const incidents = state.incidents.filter((incident) => incident.id !== id);
          return {
            incidents,
            incidentPopupOpen: incidents.length === 0 ? false : state.incidentPopupOpen,
            incidentToast: incidents.length === 0 ? null : state.incidentToast,
          };
        });
        resolveChoice(choice);
      },
      openIncidentPopup: () => {
        if (get().incidents.length > 0) {
          set({ incidentPopupOpen: true });
        }
      },
      closeIncidentPopup: () => set({ incidentPopupOpen: false }),
      clearIncidentToast: () => set({ incidentToast: null }),
      runGroupUpdate: async (scope: GroupUpdateScope = 'edt', opts: UpdateRunOptions = {}) => {
        if (!deps || !deps.container || !deps.migration || !deps.restart) {
          set({
            updateStatus: 'error',
            updateError: 'No ports wired into the TUI store',
            updateErrorCode: 'store-not-wired',
          });
          return;
        }
        if (get().updateStatus === 'running') {
          // The in-flight run keeps its `running` status — a rejected trigger only raises a notice.
          set({ updateNotice: { code: 'update-already-running', message: 'A group update is already in progress — wait for it to finish before starting another.' } });
          return;
        }
        if (Object.keys(get().serviceRestartInFlight).length > 0) {
          set({
            updateStatus: 'error',
            updateError: 'A service restart is already in progress — wait for it to finish before starting a group update.',
            updateErrorCode: 'update-already-running',
          });
          return;
        }
        set({
          updateStatus: 'running',
          updateResults: [],
          updateNote: null,
          updateTopic: null,
          updateError: null,
          updateErrorCode: null,
          updateUlid: null,
          updateScope: scope,
          updateSelection: opts.selection ?? null,
          incidents: [],
          incidentPopupOpen: false,
          incidentToast: null,
          // A fresh run starts with a fresh live view — stale phases and
          // resolved/unresolved entries from the previous run never leak into this one.
          liveServicePhase: {},
          liveSharedTypesPhase: {},
          liveServiceSteps: {},
          updateNotice: null,
          liveServiceDone: {},
          liveServiceIssues: {},
        });
        incidentResolvers.clear();
        raisedKinds.clear();
        get().setRunInProgress(true);
        const runState: { publishedVersion: string | undefined } = { publishedVersion: undefined };
        const sharedTypesHook = buildSharedTypesHook(opts.sharedTypes ?? 'off', opts.sharedTypesSource, runState);
        const autoResolveConflict = buildAutoResolveConflict(runState);
        // try/finally: a throwing use-case (a rejecting fake port in tests, a truly
        // unexpected failure in production) must still clear `runInProgress` — otherwise the
        // AppShell `q` gate and every `runInProgress` reader wedge in `running` forever.
        try {
          const result = await groupUpdateUseCase({
            edtRegistry: deps.edtRegistry,
            state: deps.state,
            manifest: deps.manifest,
            git: deps.git,
            container: deps.container,
            migration: deps.migration,
            restart: deps.restart,
            lock: deps.lock,
            registry: deps.registry,
            scope,
            // The pool size comes from the global settings, read once when the run starts.
            concurrency: get().settings.update.concurrency,
            // The confirmed pre-run configuration (or the full defaults when the
            // run started without a screen — selection omitted, migrate ON, clean OFF).
            ...(opts.selection !== undefined ? { selection: opts.selection } : {}),
            ...(opts.runMigrations !== undefined ? { runMigrations: opts.runMigrations } : {}),
            ...(opts.cleanRestart !== undefined ? { cleanRestart: opts.cleanRestart } : {}),
            // Smart group update: the source repo goes first and alone, then the phase runs.
            ...(sharedTypesHook !== null ? sharedTypesHook : {}),
            ...(autoResolveConflict !== null ? { autoResolveConflict } : {}),
            // The TUI backs the assisted-resolution seam — core pauses the run on each
            // dirty/conflicted repo and waits here while the zone's modal menu collects the
            // developer's choice (stash / open in editor / cancel repo / cancel run). Raising the
            // menu also appends the live issue-log entry (unresolved until the run moves on).
            onUpdateBlocker: (blocker) => raiseIncident(blocker),
            // The TUI backs the live-phase observer — core reports each
            // service's current step at its phase boundaries. The next phase for a service
            // implies its re-verification passed, so its unresolved entries flip to
            // resolved here (a failed re-verify never advances the pipeline).
            onServiceResult: (row) => {
              set((state) => ({
                liveServiceDone: { ...state.liveServiceDone, [row.service]: true as const },
                liveServicePhase: omitKey(state.liveServicePhase, row.service),
                liveServiceSteps: omitKey(state.liveServiceSteps, row.service),
                lastServiceRuns: mergeLastServiceRuns(state, [row], state.updateScope === 'all' ? 'all-repos' : (state.edts?.find((entry) => entry.ulid === state.activeEdt)?.topic ?? null)),
                lastServiceOutcomes: mergeLastServiceOutcomes(state.lastServiceOutcomes, [row]),
              }));
            },
            onPhase: ((service: string, phase: UpdatePhase) => {
              set((state) => ({
                liveServicePhase: { ...state.liveServicePhase, [service]: phase },
                liveServiceSteps: { ...state.liveServiceSteps, [service]: advanceServiceSteps(state.liveServiceSteps[service], phase) },
                liveServiceIssues: resolveLiveIssues(state.liveServiceIssues, service),
              }));
            }) satisfies OnUpdatePhase,
          });
          if (result.ok) {
            set((state) => {
              // A migration failure ends its service mid-run while the run
              // continues — core reports it only in the final rows, so the unresolved
              // `migration-failed` entries are derived here at completion (the detail pane
              // itself reverts to the final-outcome view; the entries stay inspectable in
              // the map until the next run clears them).
              let liveServiceIssues = state.liveServiceIssues;
              for (const row of result.data.results) {
                if (row.outcome === 'failed' && row.detail?.code === MIGRATION_FAILED_CODE) {
                  liveServiceIssues = appendLiveIssue(liveServiceIssues, row.service, {
                    kind: 'migration-failed',
                    detail: row.detail.message,
                    resolved: false,
                  });
                }
              }
              return {
                // A run finishing while another zone is active badges the Update tab; the
                // badge clears when the Update zone is next visited.
                ...(state.activeZone !== 'update'
                  ? { zoneEvents: { ...state.zoneEvents, update: state.zoneEvents.update + 1 } }
                  : {}),
                updateStatus: 'done',
                updateResults: result.data.results,
                updateNote: result.data.note ?? null,
                updateTopic: result.data.topic,
                updateUlid: result.data.ulid,
                updateScope: result.data.scope,
                // The live step clears with the run — revisiting a covered service shows the
                // final per-service outcome, with its settled steps and context snapshot.
                liveServicePhase: {},
                liveSharedTypesPhase: {},
                liveServiceSteps: {},
                updateNotice: null,
                liveServiceDone: {},
                lastServiceRuns: mergeLastServiceRuns(state, result.data.results, result.data.topic),
                liveServiceIssues,
                // Merged, never wholesale-replaced — a partial-scope run (a single
                // EDT) must never drop another service's earlier outcome.
                lastServiceOutcomes: mergeLastServiceOutcomes(state.lastServiceOutcomes, result.data.results),
              };
            });
          } else {
            set({
              updateStatus: 'error',
              updateError: result.error.message,
              updateErrorCode: result.error.code,
              // A top-level rejection ran nothing — no live state survives it.
              liveServicePhase: {},
              liveSharedTypesPhase: {},
              liveServiceSteps: {},
              updateNotice: null,
              liveServiceDone: {},
              liveServiceIssues: {},
            });
          }
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          set({
            updateStatus: 'error',
            updateError: detail,
            updateErrorCode: 'internal-error',
            liveServicePhase: {},
            liveSharedTypesPhase: {},
            liveServiceSteps: {},
            updateNotice: null,
            liveServiceDone: {},
            liveServiceIssues: {},
          });
        } finally {
          // A run that threw while a blocker was still raised (a rejecting fake port under a
          // test, a truly unexpected failure in production) must not leave the menu raised
          // forever — the choice path already cleared it via resolveUpdateBlocker.
          incidentResolvers.clear();
          if (get().incidents.length > 0 || get().incidentPopupOpen) {
            set({ incidents: [], incidentPopupOpen: false });
          }
          get().setRunInProgress(false);
        }
      },
      updateConfig: null,
      updateServiceSelectRequest: false,
      updateServicePick: null,
      serviceRestartInFlight: {},
      openUpdateConfig: async (target: OpenUpdateConfigTarget) => {
        if (!deps || !deps.container || !deps.migration || !deps.restart) {
          set({
            updateStatus: 'error',
            updateError: 'No ports wired into the TUI store',
            updateErrorCode: 'store-not-wired',
          });
          return;
        }
        if (get().updateStatus === 'running') {
          // The in-flight run keeps its `running` status — a rejected trigger only raises a notice.
          set({ updateNotice: { code: 'update-already-running', message: 'A group update is already in progress — wait for it to finish before starting another.' } });
          return;
        }
        if (Object.keys(get().serviceRestartInFlight).length > 0) {
          set({
            updateStatus: 'error',
            updateError: 'A service restart is already in progress — wait for it to finish before starting a group update.',
            updateErrorCode: 'update-already-running',
          });
          return;
        }
        if (typeof target === 'string') {
          if (target === 'all') {
            await openAllReposConfig();
          } else {
            await openEdtConfig();
          }
          return;
        }
        await openSingleServiceConfig(target.service, target.repoPath);
      },
      openUpdateServiceDialog: async (fullQuery: string) => {
        if (!deps || !deps.container || !deps.migration || !deps.restart) {
          set({
            updateStatus: 'error',
            updateError: 'No ports wired into the TUI store',
            updateErrorCode: 'store-not-wired',
          });
          return;
        }
        if (get().updateStatus === 'running') {
          // The in-flight run keeps its `running` status — a rejected trigger only raises a notice.
          set({ updateNotice: { code: 'update-already-running', message: 'A group update is already in progress — wait for it to finish before starting another.' } });
          return;
        }
        if (Object.keys(get().serviceRestartInFlight).length > 0) {
          set({
            updateStatus: 'error',
            updateError: 'A service restart is already in progress — wait for it to finish before starting a group update.',
            updateErrorCode: 'update-already-running',
          });
          return;
        }
        const service = parseUpdateServiceArg(fullQuery);
        if (service !== null) {
          // A previously raised no-arg request must not survive: the zone would consume it
          // into a second screen on top of this one.
          set({ updateServiceSelectRequest: false });
          await openSingleServiceConfig(service);
          return;
        }
        // No argument: the Update zone consumes this — its highlighted row pre-scopes the
        // config when one is selected, else the filterable service quick-pick opens.
        set({ updateServiceSelectRequest: true });
      },
      clearUpdateServiceSelectionRequest: () => {
        if (get().updateServiceSelectRequest) {
          set({ updateServiceSelectRequest: false });
        }
      },
      openUpdateServicePick: async () => {
        if (!deps || !deps.container || !deps.migration || !deps.restart) {
          set({
            updateStatus: 'error',
            updateError: 'No ports wired into the TUI store',
            updateErrorCode: 'store-not-wired',
          });
          return;
        }
        if (get().updateStatus === 'running') {
          // The in-flight run keeps its `running` status — a rejected trigger only raises a notice.
          set({ updateNotice: { code: 'update-already-running', message: 'A group update is already in progress — wait for it to finish before starting another.' } });
          return;
        }
        if (Object.keys(get().serviceRestartInFlight).length > 0) {
          set({
            updateStatus: 'error',
            updateError: 'A service restart is already in progress — wait for it to finish before starting a group update.',
            updateErrorCode: 'update-already-running',
          });
          return;
        }
        const generation = ++servicePickGeneration;
        const enumerated = await listManagedServiceRows();
        if (generation !== servicePickGeneration) {
          // Cancelled (or superseded by a newer open) while enumerating — never pop a
          // stale pick open over whatever the developer sees now.
          return;
        }
        if (!enumerated.ok) {
          failConfigOpen(enumerated.code, enumerated.message);
          return;
        }
        if (enumerated.rows.length === 0) {
          failConfigOpen('no-services-selected', 'No managed repos found — nothing to update.');
          return;
        }
        // Opening the pick runs no git/docker action and starts no run — like the config
        // screen, over a clean banner.
        set({
          updateServicePick: enumerated.rows.map((row) => ({ service: row.service, repoPath: row.repoPath })),
          updateStatus: 'idle',
          updateError: null,
          updateErrorCode: null,
          updateNote: null,
        });
      },
      closeUpdateServicePick: () => {
        servicePickGeneration += 1;
        if (get().updateServicePick !== null) {
          set({ updateServicePick: null });
        }
      },
      setUpdateConfig: (draft: UpdateConfigDraft) => {
        if (get().updateConfig === null) {
          return;
        }
        set({ updateConfig: draft });
      },
      listMergeSourceEdts: async () => {
        if (!deps) {
          return [];
        }
        const [active, listed] = await Promise.all([deps.state.readActiveEdt(), deps.edtRegistry.list()]);
        // Without a readable active EDT the one being updated could be offered as its own
        // source, so nothing is offered.
        if (!listed.ok || !active.ok) {
          return [];
        }
        return listed.data.filter((entry) => entry.ulid !== active.data).map((entry) => ({ ulid: entry.ulid, topic: entry.topic }));
      },
      chooseMergeSourceEdt: async (ulid: string) => {
        const draft = get().updateConfig;
        if (!deps || draft === null) {
          return;
        }
        const [listed, active] = await Promise.all([deps.edtRegistry.list(), deps.state.readActiveEdt()]);
        const source = listed.ok ? listed.data.find((entry) => entry.ulid === ulid) : undefined;
        if (source === undefined) {
          set({ updateConfig: { ...draft, error: 'The chosen EDT no longer exists.' } });
          return;
        }
        if (!active.ok || source.ulid === active.data) {
          set({ updateConfig: { ...draft, error: 'An EDT cannot be its own merge source.' } });
          return;
        }
        const resolved = await loadMergeSourcesFromEdt(deps.git, draft.rows, source);
        const current = get().updateConfig;
        // The resolution is dropped when the screen closed, changed layout or went back to
        // shared branches while git was being read — the developer's newer choice wins.
        if (!resolved.ok || current === null || current.layout !== draft.layout || current.strategy.kind === 'shared') {
          return;
        }
        set({ updateConfig: applyMergeStrategy(current, { kind: 'edt', ulid, topic: source.topic, resolved: resolved.data }) });
      },
      closeUpdateConfig: () => {
        set({ updateConfig: null });
      },
      confirmUpdateConfig: async () => {
        const draft = get().updateConfig;
        if (draft === null) {
          return;
        }
        if (get().updateStatus === 'running') {
          set({
            updateConfig: {
              ...draft,
              error: 'A group update is already in progress — wait for it to finish before starting another.',
            },
          });
          return;
        }
        if (Object.keys(get().serviceRestartInFlight).length > 0) {
          set({
            updateConfig: {
              ...draft,
              error: 'A service restart is already in progress — wait for it to finish before starting a group update.',
            },
          });
          return;
        }
        const confirmed = confirmUpdateConfigDraft(draft);
        if (!confirmed.ok) {
          set({ updateConfig: { ...draft, error: confirmed.error } });
          return;
        }
        const snapshot = draft;
        set({ updateConfig: null });
        await get().runGroupUpdate(confirmed.config.scope, {
          selection: confirmed.config.selection,
          runMigrations: confirmed.config.runMigrations,
          cleanRestart: confirmed.config.cleanRestart,
          ...(confirmed.config.sharedTypes !== undefined ? { sharedTypes: confirmed.config.sharedTypes, sharedTypesSource: confirmed.config.sharedTypesSource ?? null } : {}),
        });
        // A core pre-lock rejection (`unknown-branch`, `no-services-selected` — both are
        // only ever returned before any lock is taken, so nothing ran) restores the screen
        // with the message inline instead of destroying the confirmed selection, toggles,
        // and branch edits. The run banner resets to idle around it, mirroring the
        // zero-selection inline pattern above.
        const rejection = get().updateErrorCode;
        if (get().updateStatus === 'error' && (rejection === 'unknown-branch' || rejection === 'no-services-selected')) {
          set({
            updateConfig: { ...snapshot, error: get().updateError ?? 'The run was rejected before starting.' },
            updateStatus: 'idle',
            updateError: null,
            updateErrorCode: null,
            updateNote: null,
            updateScope: null,
            updateUlid: null,
          });
        }
      },
      openInIde: (repoPath: string) => {
        if (deps?.editor === undefined) {
          return err('editor-unavailable', 'No editor port is wired — cannot open the repo in an editor.');
        }
        return openInIde(deps.editor, repoPath, { editorCommand: get().settings.general.editorCommand });
      },
      describeServiceRestart: async (repoPath: string) => {
        if (!deps) {
          return { restartAvailable: true };
        }
        const loaded = await deps.manifest.load(repoPath);
        if (!loaded.ok) {
          return { restartAvailable: true };
        }
        if (loaded.data.container !== undefined && loaded.data.container.trim() !== '') {
          return { restartAvailable: true };
        }
        return { restartAvailable: (loaded.data.restartCommands?.length ?? 0) > 0 };
      },
      runServiceRestart: async (repoPath: string) => {
        if (!deps || !deps.container || !deps.restart) {
          set({
            updateStatus: 'error',
            updateError: 'No ports wired into the TUI store',
            updateErrorCode: 'store-not-wired',
          });
          return;
        }
        if (get().updateStatus === 'running') {
          // The in-flight run keeps its `running` status — a rejected trigger only raises a notice.
          set({ updateNotice: { code: 'update-already-running', message: 'A group update is already in progress — wait for it to finish before starting another.' } });
          return;
        }
        const key = resolve(repoPath);
        if (get().serviceRestartInFlight[key] !== undefined) {
          set({
            updateStatus: 'error',
            updateError: `A restart for ${repoPath} is already in progress — wait for it to finish before starting another.`,
            updateErrorCode: 'update-already-running',
          });
          return;
        }
        // A stale contention banner from an earlier rejection must not linger underneath
        // a newly started restart — the row's own `restarting` badge is the live signal.
        if (get().updateStatus === 'error' && get().updateErrorCode === 'update-already-running') {
          set({ updateStatus: 'idle', updateError: null, updateErrorCode: null });
        }
        set((state) => ({ serviceRestartInFlight: { ...state.serviceRestartInFlight, [key]: 'restart' as const } }));
        // The standalone path reports through the same live-phase channel —
        // the emitted service name is captured so only this service's key is cleared below
        // (a group run can never be in flight alongside, per the guards above).
        let restartService: string | null = null;
        try {
          const result = await serviceRestartUseCase({
            manifest: deps.manifest,
            container: deps.container,
            restart: deps.restart,
            lock: deps.lock,
            repoPath,
            onPhase: ((service: string, phase: UpdatePhase) => {
              restartService = service;
              set((state) => {
                const liveServicePhase = { ...state.liveServicePhase, [service]: phase };
                // A standalone restart opens with a fresh issue log for its service — stale
                // group-run entries never render under its live step. The use-case emits
                // exactly once (at the restart boundary), so resetting on emission is
                // start-scoped, never mid-run.
                if (state.liveServiceIssues[service] === undefined) {
                  return { liveServicePhase };
                }
                const liveServiceIssues = { ...state.liveServiceIssues };
                delete liveServiceIssues[service];
                return { liveServicePhase, liveServiceIssues };
              });
            }) satisfies OnUpdatePhase,
          });
          if (result.ok) {
            set((state) => ({
              lastServiceOutcomes: mergeLastServiceOutcomes(state.lastServiceOutcomes, [result.data]),
            }));
          } else {
            set({
              updateStatus: 'error',
              updateError: result.error.message,
              updateErrorCode: result.error.code,
            });
          }
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          set({ updateStatus: 'error', updateError: detail, updateErrorCode: 'internal-error' });
        } finally {
          set((state) => {
            if (state.serviceRestartInFlight[key] === undefined) {
              return {};
            }
            const next = { ...state.serviceRestartInFlight };
            delete next[key];
            // The standalone live step clears with its action.
            if (restartService === null || state.liveServicePhase[restartService] === undefined) {
              return { serviceRestartInFlight: next };
            }
            const phases = { ...state.liveServicePhase };
            delete phases[restartService];
            return { serviceRestartInFlight: next, liveServicePhase: phases };
          });
        }
      },
      markUpdateInterrupted: async () => {
        // The run already finished (or never started) — the quit-confirm simply raced
        // completion. Reset the flag and leave the outcome (and the EDT status) alone.
        if (get().updateStatus !== 'running') {
          get().setRunInProgress(false);
          return;
        }
        const ulid = get().updateUlid ?? get().activeEdt;
        // An all-repos run targets no EDT — there is nothing to mark interrupted. Reset to
        // idle (and clear the flag) without touching the EDT registry.
        if (get().updateScope === 'all' || ulid === 'all') {
          get().setRunInProgress(false);
          set({ updateStatus: 'idle' });
          return;
        }
        if (!deps || ulid === null) {
          get().setRunInProgress(false);
          set({ updateStatus: 'idle' });
          return;
        }
        // A setStatus/loadEdts failure surfaces as an error state — never a silent return to
        // `idle` pretending the interruption was recorded.
        try {
          const marked = await markGroupUpdateInterruptedUseCase(deps.edtRegistry, ulid);
          if (!marked.ok) {
            set({ updateStatus: 'error', updateError: marked.error.message, updateErrorCode: marked.error.code });
            return;
          }
          set({ updateStatus: 'idle' });
          // Refresh the registry entries so the next idle render sees the `interrupted`
          // status and offers a re-run (mirrors loadEdts' own mount-effect idiom).
          await get().loadEdts();
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          set({ updateStatus: 'error', updateError: detail, updateErrorCode: 'internal-error' });
        } finally {
          get().setRunInProgress(false);
        }
      },
      clearUpdate: () => {
        incidentResolvers.clear();
        raisedKinds.clear();
        set({
          updateStatus: 'idle',
          updateResults: [],
          updateNote: null,
          updateTopic: null,
          updateError: null,
          updateErrorCode: null,
          updateUlid: null,
          updateScope: null,
          updateSelection: null,
          incidents: [],
          incidentPopupOpen: false,
          incidentToast: null,
          updateConfig: null,
          updateServiceSelectRequest: false,
          updateServicePick: null,
          serviceRestartInFlight: {},
          liveServicePhase: {},
          liveSharedTypesPhase: {},
          liveServiceSteps: {},
          updateNotice: null,
          liveServiceDone: {},
          liveServiceIssues: {},
        });
      },

      updateServiceHealth: {},
      lastServiceOutcomes: {},
      startUpdateHealthPolling: (repoPaths) => {
        for (const path of pollingRepoPaths) {
          if (!repoPaths.includes(path)) {
            healthInFlight.release(path);
          }
        }
        pollingRepoPaths = [...repoPaths];
        pollAll(pollingRepoPaths);
        if (healthPollTimer !== null) {
          clearInterval(healthPollTimer);
        }
        healthPollTimer = setInterval(() => {
          pollAll(pollingRepoPaths);
        }, UPDATE_HEALTH_POLL_INTERVAL_MS);
        // Never keep the process alive for a poll timer alone (tests, abnormal exits) —
        // mirrors logs-slice.ts's own startHealthPolling.
        const unrefable = healthPollTimer as unknown as { unref?: () => void };
        if (typeof unrefable.unref === 'function') {
          unrefable.unref();
        }
      },
      stopUpdateHealthPolling: () => {
        if (healthPollTimer !== null) {
          clearInterval(healthPollTimer);
          healthPollTimer = null;
        }
        pollingRepoPaths = [];
        healthInFlight.releaseAll();
      },
    };
  };
}
