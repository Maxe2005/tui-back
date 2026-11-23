// tui/store/slices: the Update slice's run lifecycle — the group-update run (with its
// `shared-types` between-stage hook and conflict auto-resolution), the standalone service
// restart, IDE opening, and the interrupted/clear resets.
//
// Over the ~400-line target (~615 lines): `runGroupUpdate` alone is ~180 lines of
// set/get-ordered code that must stay verbatim, and the shared-types hook and auto-resolve
// builders only exist for it, so they stay beside it rather than behind a second file.
import { resolve } from 'node:path';
import {
  groupUpdate as groupUpdateUseCase,
  markGroupUpdateInterrupted as markGroupUpdateInterruptedUseCase,
  MIGRATION_FAILED_CODE,
  type AutoResolveConflict,
  type GroupUpdateRepoResult,
  type GroupUpdateScope,
  type StageControl,
  type OnUpdatePhase,
  type UpdatePhase,
} from '../../../../../core/scripts/group-update.js';
import { serviceRestart as serviceRestartUseCase } from '../../../../../core/scripts/service-restart.js';
import { openInIde } from '../../../../../core/service-actions/index.js';
import { err, ok, type Result } from '../../../../../core/result.js';
import { advanceServiceSteps, mergeLastServiceOutcomes } from '../../zones/update/update-zone.logic.js';
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
import { resolveSingleSourceOf, resolveSourceRegistries } from './shared-types/shared-types-slice.js';
import { createRaiseIncident } from './update/health/update-slice.incident.js';
import {
  appendLiveIssue,
  mergeLastServiceRuns,
  omitKey,
  resolveLiveIssues,
  type UpdateRunOptions,
  type UpdateSlice,
  type UpdateSliceContext,
  type UpdateSliceGet,
  type UpdateSliceSet,
} from './update/update-slice.types.js';

export function createUpdateRunActions(
  ctx: UpdateSliceContext,
  set: UpdateSliceSet,
  get: UpdateSliceGet,
): Pick<
  UpdateSlice,
  | 'updateStatus'
  | 'updateResults'
  | 'updateNote'
  | 'updateTopic'
  | 'updateError'
  | 'updateErrorCode'
  | 'updateUlid'
  | 'updateScope'
  | 'updateSelection'
  | 'liveServicePhase'
  | 'liveSharedTypesPhase'
  | 'liveServiceSteps'
  | 'updateNotice'
  | 'liveServiceDone'
  | 'liveServiceIssues'
  | 'lastServiceRuns'
  | 'runGroupUpdate'
  | 'serviceRestartInFlight'
  | 'lastServiceOutcomes'
  | 'openInIde'
  | 'describeServiceRestart'
  | 'runServiceRestart'
  | 'markUpdateInterrupted'
  | 'clearUpdate'
> {
  const { deps, incidentResolvers, raisedKinds } = ctx;
  const raiseIncident = createRaiseIncident(ctx, set);
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
    liveServicePhase: {},
    liveSharedTypesPhase: {},
    liveServiceSteps: {},
    updateNotice: null,
    liveServiceDone: {},
    liveServiceIssues: {},
    lastServiceRuns: {},
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
    serviceRestartInFlight: {},
    lastServiceOutcomes: {},
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
  };
}
