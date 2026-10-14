// tui/store/slices: the shared-types zone's state — the active EDT's consuming services,
// the source repo for publishing, and the states of one propagation run and one publish
// run. The zone's form state stays zone-local. Use-cases run in-process over injected
// ports; with `sharedTypes` unwired every action degrades to an explicit error.
import { join } from 'node:path';
import type { StateCreator } from 'zustand';
import {
  isResumable,
  propagateVersion,
  type PropagateOptions,
  type PropagateServiceResult,
  type PropagateStep,
  type ResumeFrom,
} from '../../../../../core/shared-types/propagate-version.js';
import { listConsumers, listSources, type ConsumerIssue, type DependencyConsumer, type SourceEntry, type SourceIssue } from '../../../../../core/shared-types/list-consumers.js';
import { runPublish } from '../../../../../core/shared-types/publish-version.js';
import {
  searchByBranch,
  searchByVersion,
  type BranchSearchEnd,
  type VersionHistoryEntry,
  type VersionHit,
} from '../../../../../core/shared-types/version-history.js';
import type { AppState, AppStoreDeps } from '../app-store.js';

export type SharedTypesConsumersStatus = 'idle' | 'loading' | 'ready' | 'error';
export type SharedTypesRunStatus = 'idle' | 'running' | 'done' | 'blocked';
export type SharedTypesPublishStatus = 'idle' | 'running' | 'done' | 'blocked';
export type SharedTypesSourceStatus = 'idle' | 'loading' | 'ready' | 'error';

export type SharedTypesRun = {
  status: SharedTypesRunStatus;
  version: string;
  options: PropagateOptions;
  blocked: { code: string; message: string } | null;
  results: PropagateServiceResult[];
  live: { repoPath: string; step: PropagateStep } | null;
  notice?: string | null;
};

export type SharedTypesPublish = {
  status: SharedTypesPublishStatus;
  version: string | null;
  output: string | null;
  error: { code: string; message: string } | null;
  notice: string | null;
};

export type SharedTypesHistoryMode = 'branch' | 'version';
export type SharedTypesHistoryStatus = 'idle' | 'searching' | 'done' | 'error';

// The History view's state: one search at a time, results streamed in as git yields them.
export type SharedTypesHistory = {
  mode: SharedTypesHistoryMode;
  status: SharedTypesHistoryStatus;
  query: string;
  entries: VersionHistoryEntry[];
  hits: VersionHit[];
  // By-version only: null until the search completed.
  found: boolean | null;
  earliestBranch: string | null;
  endedBy: BranchSearchEnd | null;
  scanned: number;
  error: { code: string; message: string } | null;
  // The bounds the search ran with, so the "stopped: ..." line states the real numbers.
  depth: number;
  maxScanned: number;
};

export type SharedTypesHistoryBranchesStatus = 'idle' | 'loading' | 'ready' | 'error';

export type SharedTypesSlice = {
  sharedTypesHistory: SharedTypesHistory;
  sharedTypesHistoryBranches: string[];
  sharedTypesHistoryBranchesStatus: SharedTypesHistoryBranchesStatus;
  startSharedTypesHistorySearch: (input: { mode: SharedTypesHistoryMode; query: string }) => Promise<void>;
  cancelSharedTypesHistorySearch: () => void;
  resetSharedTypesHistory: () => void;
  loadSharedTypesHistoryBranches: () => Promise<void>;
  sharedTypesConsumers: DependencyConsumer[];
  sharedTypesIssues: ConsumerIssue[];
  sharedTypesConsumersStatus: SharedTypesConsumersStatus;
  sharedTypesConsumersError: { code: string; message: string } | null;
  sharedTypesRun: SharedTypesRun;
  sharedTypesSources: SourceEntry[];
  sharedTypesSourceIssues: SourceIssue[];
  sharedTypesSourcesStatus: SharedTypesSourceStatus;
  sharedTypesSourcesError: { code: string; message: string } | null;
  sharedTypesPublish: SharedTypesPublish;
  loadSharedTypesConsumers: () => Promise<void>;
  runSharedTypesPropagation: (input: { version: string; repoPaths: string[]; options: PropagateOptions }) => Promise<void>;
  retrySharedTypesService: (repoPath: string) => Promise<void>;
  resetSharedTypesRun: () => void;
  loadSharedTypesSource: () => Promise<void>;
  runSharedTypesPublish: () => Promise<void>;
  retrySharedTypesPublish: () => Promise<void>;
  resetSharedTypesPublish: () => void;
};

// What the tab bar shows on the st tab: null = no badge, incidents 0 = running, N > 0 = N runs
// blocked awaiting the developer (same two states the Update tab's badge has).
export function sharedTypesBusy(state: { sharedTypesRun: { status: SharedTypesRunStatus }; sharedTypesPublish: { status: SharedTypesPublishStatus } }): { incidents: number } | null {
  const blocked = (state.sharedTypesRun.status === 'blocked' ? 1 : 0) + (state.sharedTypesPublish.status === 'blocked' ? 1 : 0);
  // A blocked run awaits the developer, which matters more than another run still going.
  if (blocked > 0) {
    return { incidents: blocked };
  }
  return state.sharedTypesRun.status === 'running' || state.sharedTypesPublish.status === 'running' ? { incidents: 0 } : null;
}

const IDLE_OPTIONS: PropagateOptions = { install: false, cleanRestart: false, commit: false };

const IDLE_RUN: SharedTypesRun = {
  status: 'idle',
  version: '',
  options: IDLE_OPTIONS,
  blocked: null,
  results: [],
  live: null,
  notice: null,
};

const IDLE_PUBLISH: SharedTypesPublish = {
  status: 'idle',
  version: null,
  output: null,
  error: null,
  notice: null,
};

const IDLE_HISTORY: SharedTypesHistory = {
  mode: 'branch',
  status: 'idle',
  query: '',
  entries: [],
  hits: [],
  found: null,
  earliestBranch: null,
  endedBy: null,
  scanned: 0,
  error: null,
  depth: 0,
  maxScanned: 0,
};

const RUN_IN_PROGRESS_MESSAGE = 'Another run is already in progress — wait for it to finish before starting another.';

// Best effort: dependency name → registry of the EDT's source modules. A failure here
// leaves the map empty (npm's own configuration then applies) and never blocks a run.
export async function resolveSourceRegistries(deps: AppStoreDeps | undefined): Promise<Record<string, string>> {
  if (deps?.sharedTypes?.sourceModuleId === undefined || deps.sharedTypes.parseSourceConfig === undefined) {
    return {};
  }
  try {
    const listed = await listSources({
      edtRegistry: deps.edtRegistry,
      manifest: deps.manifest,
      state: deps.state,
      moduleId: deps.sharedTypes.sourceModuleId,
      parseConfig: deps.sharedTypes.parseSourceConfig,
    });
    const registries: Record<string, string> = {};
    if (listed.ok) {
      for (const source of listed.data.sources) {
        if (source.registry !== undefined && registries[source.packageName] === undefined) {
          registries[source.packageName] = source.registry;
        }
      }
    }
    return registries;
  } catch {
    return {};
  }
}


export async function resolveSingleSourceOf(deps: AppStoreDeps | undefined): Promise<
  | { ok: true; source: SourceEntry }
  | { ok: false; kind: 'empty' | 'ambiguous' | 'error'; code?: string; message?: string }
> {
  if (deps?.sharedTypes === undefined || deps.sharedTypes.sourceModuleId === undefined || deps.sharedTypes.parseSourceConfig === undefined) {
    return { ok: false, kind: 'error', code: 'not-wired', message: 'Version publishing is not available in this session.' };
  }
  let listed: Awaited<ReturnType<typeof listSources>>;
  try {
    listed = await listSources({
      edtRegistry: deps.edtRegistry,
      manifest: deps.manifest,
      state: deps.state,
      moduleId: deps.sharedTypes.sourceModuleId,
      parseConfig: deps.sharedTypes.parseSourceConfig,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, kind: 'error', code: 'internal-error', message };
  }
  if (!listed.ok) {
    return { ok: false, kind: 'error', code: listed.error.code, message: listed.error.message };
  }
  if (listed.data.sources.length > 1) {
    const names = listed.data.sources.map((entry) => entry.service).join(', ');
    return { ok: false, kind: 'ambiguous', code: 'ambiguous-source', message: `Several source repos in the active EDT (${names}) — publish is blocked.` };
  }
  if (listed.data.sources.length === 0) {
    const first = listed.data.issues[0];
    if (first !== undefined) {
      return { ok: false, kind: 'error', code: first.code, message: first.message };
    }
    return { ok: false, kind: 'empty' };
  }
  return { ok: true, source: listed.data.sources[0] as SourceEntry };
}


export function createSharedTypesSlice(deps?: AppStoreDeps): StateCreator<AppState, [], [], SharedTypesSlice> {
  return (set, get) => {
    async function execute(
      consumers: DependencyConsumer[],
      version: string,
      options: PropagateOptions,
      resume: Record<string, ResumeFrom>,
      merge: (fresh: PropagateServiceResult[]) => PropagateServiceResult[],
      isRetry = false,
    ): Promise<void> {
      const keepResults = (message: string) =>
        set((state) => ({ sharedTypesRun: { ...state.sharedTypesRun, status: 'done', blocked: null, live: null, notice: message } }));
      if (deps?.sharedTypes === undefined || deps.container === undefined || deps.restart === undefined) {
        if (isRetry) {
          keepResults('Version propagation is not available in this session.');
          return;
        }
        set({
          sharedTypesRun: {
            ...IDLE_RUN,
            status: 'blocked',
            version,
            options,
            blocked: { code: 'not-wired', message: 'Version propagation is not available in this session.' },
          },
        });
        return;
      }
      if (get().runInProgress) {
        if (isRetry) {
          keepResults(RUN_IN_PROGRESS_MESSAGE);
        } else {
          set((state) => ({ sharedTypesRun: { ...state.sharedTypesRun, notice: RUN_IN_PROGRESS_MESSAGE } }));
        }
        return;
      }
      set((state) => ({ sharedTypesRun: { ...state.sharedTypesRun, status: 'running', version, options, blocked: null, live: null, notice: null } }));
      get().setRunInProgress(true);
      try {
        const report = await propagateVersion({
          git: deps.git,
          manifest: deps.manifest,
          container: deps.container,
          restart: deps.restart,
          shared: deps.sharedTypes.port,
          version,
          consumers,
          registries: await sourceRegistries(),
          options,
          resume,
          onProgress: (event) => set((state) => ({ sharedTypesRun: { ...state.sharedTypesRun, live: { repoPath: event.repoPath, step: event.step } } })),
        });
        if (report.status === 'blocked' && isRetry) {
          keepResults(report.error.message);
        } else if (report.status === 'blocked') {
          set((state) => ({ sharedTypesRun: { ...state.sharedTypesRun, status: 'blocked', blocked: report.error, live: null } }));
        } else {
          set((state) => ({
            sharedTypesRun: { ...state.sharedTypesRun, status: 'done', results: merge(report.results), live: null },
          }));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (isRetry) {
          keepResults(message);
        } else {
          set((state) => ({
            sharedTypesRun: { ...state.sharedTypesRun, status: 'blocked', blocked: { code: 'internal-error', message }, live: null },
          }));
        }
      } finally {
        get().setRunInProgress(false);
      }
    }

    const sourceRegistries = () => resolveSourceRegistries(deps);
    const resolveSingleSource = () => resolveSingleSourceOf(deps);

    // Runs the publish command once for the resolved source. The caller holds the
    // `runInProgress` guard and has already set the running state; this only lands
    // the done/blocked outcome and never touches the guard.
    async function executePublish(source: SourceEntry): Promise<void> {
      if (deps?.sharedTypes === undefined || deps.restart === undefined) {
        set((state) => ({
          sharedTypesPublish: { ...state.sharedTypesPublish, status: 'blocked', error: { code: 'not-wired', message: 'Version publishing is not available in this session.' }, notice: null },
        }));
        return;
      }
      let result: Awaited<ReturnType<typeof runPublish>>;
      try {
        result = await runPublish({
          git: deps.git,
          restart: deps.restart,
          shared: deps.sharedTypes.port,
          sourceRepoPath: source.repoPath,
          publishCommand: source.publishCommand,
          packageName: source.packageName,
          registry: source.registry,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        set((state) => ({
          sharedTypesPublish: { ...state.sharedTypesPublish, status: 'blocked', error: { code: 'internal-error', message }, notice: null },
        }));
        return;
      }
      if (!result.ok) {
        set({ sharedTypesPublish: { ...IDLE_PUBLISH, status: 'blocked', error: result.error } });
        return;
      }
      set({ sharedTypesPublish: { ...IDLE_PUBLISH, status: 'done', version: result.data.version, output: result.data.output } });
    }

    // The one live history walk: a new search or a cancel aborts it, and its callbacks only
    // land while their token is still the current one.
    let historyController: AbortController | null = null;
    let historyToken = 0;

    function stopHistoryWalk(): void {
      historyController?.abort();
      historyController = null;
      historyToken += 1;
    }

    return {
      sharedTypesHistory: IDLE_HISTORY,
      sharedTypesHistoryBranches: [],
      sharedTypesHistoryBranchesStatus: 'idle',
      startSharedTypesHistorySearch: async ({ mode, query }) => {
        stopHistoryWalk();
        const token = historyToken;
        const controller = new AbortController();
        historyController = controller;
        const bounds = get().settings.sharedTypes;
        const base: SharedTypesHistory = { ...IDLE_HISTORY, mode, query: query.trim(), status: 'searching', depth: bounds.historyDepth, maxScanned: bounds.maxCommitsScanned };
        const current = (): boolean => token === historyToken && !controller.signal.aborted;
        const fail = (error: { code: string; message: string }): void => {
          if (token === historyToken) {
            set((state) => ({ sharedTypesHistory: { ...state.sharedTypesHistory, status: 'error', error } }));
          }
        };
        // Validate before any git call (an invalid version never reaches the adapter).
        set({ sharedTypesHistory: base });
        try {
          const resolved = await resolveSingleSource();
          if (!current()) {
            return;
          }
          if (!resolved.ok) {
            fail({
              code: resolved.code ?? 'no-source',
              message: resolved.message ?? 'No shared-types source repo in the active EDT.',
            });
            return;
          }
          const repoPath = resolved.source.repoPath;
          if (mode === 'branch') {
            const result = await searchByBranch({
              git: deps!.git,
              repoPath,
              branch: query,
              depth: bounds.historyDepth,
              maxScanned: bounds.maxCommitsScanned,
              signal: controller.signal,
              onEntry: (entry) => {
                if (current()) {
                  set((state) => ({ sharedTypesHistory: { ...state.sharedTypesHistory, entries: [...state.sharedTypesHistory.entries, entry] } }));
                }
              },
            });
            if (token !== historyToken) {
              return;
            }
            if (!result.ok) {
              fail(result.error);
              return;
            }
            set((state) => ({ sharedTypesHistory: { ...state.sharedTypesHistory, status: 'done', endedBy: result.data.endedBy, scanned: result.data.scanned } }));
            return;
          }
          const result = await searchByVersion({
            git: deps!.git,
            repoPath,
            version: query,
            signal: controller.signal,
            onHit: (hit) => {
              if (current()) {
                set((state) => ({ sharedTypesHistory: { ...state.sharedTypesHistory, hits: [...state.sharedTypesHistory.hits, hit] } }));
              }
            },
          });
          if (token !== historyToken) {
            return;
          }
          if (!result.ok) {
            fail(result.error);
            return;
          }
          set((state) => ({
            sharedTypesHistory: {
              ...state.sharedTypesHistory,
              status: 'done',
              hits: result.data.hits,
              found: result.data.aborted ? null : result.data.found,
              earliestBranch: result.data.earliestBranch,
              endedBy: result.data.aborted ? 'aborted' : null,
            },
          }));
        } catch (error) {
          fail({ code: 'internal-error', message: error instanceof Error ? error.message : String(error) });
        } finally {
          if (token === historyToken) {
            historyController = null;
          }
        }
      },
      cancelSharedTypesHistorySearch: () => {
        if (get().sharedTypesHistory.status !== 'searching') {
          return;
        }
        stopHistoryWalk();
        set((state) => ({ sharedTypesHistory: { ...state.sharedTypesHistory, status: 'done', endedBy: 'aborted' } }));
      },
      resetSharedTypesHistory: () => {
        stopHistoryWalk();
        set({ sharedTypesHistory: IDLE_HISTORY });
      },
      loadSharedTypesHistoryBranches: async () => {
        set({ sharedTypesHistoryBranchesStatus: 'loading' });
        try {
          const resolved = await resolveSingleSource();
          if (!resolved.ok || deps === undefined) {
            set({ sharedTypesHistoryBranches: [], sharedTypesHistoryBranchesStatus: 'error' });
            return;
          }
          const [local, remote] = await Promise.all([
            deps.git.listBranches(resolved.source.repoPath),
            deps.git.listRemoteBranches(resolved.source.repoPath),
          ]);
          if (!local.ok && !remote.ok) {
            set({ sharedTypesHistoryBranches: [], sharedTypesHistoryBranchesStatus: 'error' });
            return;
          }
          const names = [...(local.ok ? local.data : []), ...(remote.ok ? remote.data : [])];
          set({ sharedTypesHistoryBranches: [...new Set(names)], sharedTypesHistoryBranchesStatus: 'ready' });
        } catch {
          set({ sharedTypesHistoryBranches: [], sharedTypesHistoryBranchesStatus: 'error' });
        }
      },
      sharedTypesConsumers: [],
      sharedTypesIssues: [],
      sharedTypesConsumersStatus: 'idle',
      sharedTypesConsumersError: null,
      sharedTypesRun: IDLE_RUN,
      sharedTypesSources: [],
      sharedTypesSourceIssues: [],
      sharedTypesSourcesStatus: 'idle',
      sharedTypesSourcesError: null,
      sharedTypesPublish: IDLE_PUBLISH,
      loadSharedTypesConsumers: async () => {
        if (deps?.sharedTypes === undefined || deps.sharedTypes.consumerModuleId === undefined || deps.sharedTypes.parseConsumerConfig === undefined) {
          set({
            sharedTypesConsumersStatus: 'error',
            sharedTypesConsumersError: { code: 'not-wired', message: 'Version propagation is not available in this session.' },
          });
          return;
        }
        set({ sharedTypesConsumersStatus: 'loading', sharedTypesConsumersError: null });
        const listed = await listConsumers({
          edtRegistry: deps.edtRegistry,
          manifest: deps.manifest,
          state: deps.state,
          moduleId: deps.sharedTypes.consumerModuleId,
          parseConfig: deps.sharedTypes.parseConsumerConfig,
        });
        if (!listed.ok) {
          set({ sharedTypesConsumersStatus: 'error', sharedTypesConsumersError: listed.error });
          return;
        }
        set({
          sharedTypesConsumers: listed.data.consumers,
          sharedTypesIssues: listed.data.issues,
          sharedTypesConsumersStatus: 'ready',
        });
      },
      runSharedTypesPropagation: async ({ version, repoPaths, options }) => {
        const chosen = get().sharedTypesConsumers.filter((consumer) => repoPaths.includes(consumer.repoPath));
        await execute(chosen, version, options, {}, (fresh) => fresh);
      },
      retrySharedTypesService: async (repoPath) => {
        const { sharedTypesRun, sharedTypesConsumers } = get();
        const previous = sharedTypesRun.results.find((result) => result.repoPath === repoPath);
        const consumer = sharedTypesConsumers.find((candidate) => candidate.repoPath === repoPath);
        if (previous === undefined || consumer === undefined || previous.outcome !== 'failed') {
          set((state) => ({ sharedTypesRun: { ...state.sharedTypesRun, notice: 'Nothing to retry — pick a failed service first.' } }));
          return;
        }
        const resume: Record<string, ResumeFrom> = isResumable(previous.failedStep) ? { [repoPath]: previous.failedStep } : {};
        await execute([consumer], sharedTypesRun.version, sharedTypesRun.options, resume, (fresh) =>
          get().sharedTypesRun.results.map((result) => fresh.find((candidate) => candidate.repoPath === result.repoPath) ?? result),
          true,
        );
      },
      resetSharedTypesRun: () => {
        if (get().sharedTypesRun.status === 'running') {
          return;
        }
        set({ sharedTypesRun: IDLE_RUN });
      },
      loadSharedTypesSource: async () => {
        if (get().sharedTypesPublish.status !== 'running') {
          set({ sharedTypesPublish: IDLE_PUBLISH });
        }
        if (deps?.sharedTypes === undefined || deps.sharedTypes.sourceModuleId === undefined || deps.sharedTypes.parseSourceConfig === undefined) {
          set({
            sharedTypesSourcesStatus: 'error',
            sharedTypesSourcesError: { code: 'not-wired', message: 'Version publishing is not available in this session.' },
          });
          return;
        }
        set({ sharedTypesSourcesStatus: 'loading', sharedTypesSourcesError: null });
        let listed: Awaited<ReturnType<typeof listSources>>;
        try {
          listed = await listSources({
            edtRegistry: deps.edtRegistry,
            manifest: deps.manifest,
            state: deps.state,
            moduleId: deps.sharedTypes.sourceModuleId,
            parseConfig: deps.sharedTypes.parseSourceConfig,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          set({ sharedTypesSourcesStatus: 'error', sharedTypesSources: [], sharedTypesSourcesError: { code: 'internal-error', message } });
          return;
        }
        if (!listed.ok) {
          set({ sharedTypesSourcesStatus: 'error', sharedTypesSources: [], sharedTypesSourcesError: listed.error });
          return;
        }
        if (listed.data.sources.length > 1) {
          const names = listed.data.sources.map((entry) => entry.service).join(', ');
          set({
            sharedTypesSources: listed.data.sources,
            sharedTypesSourceIssues: listed.data.issues,
            sharedTypesSourcesStatus: 'error',
            sharedTypesSourcesError: { code: 'ambiguous-source', message: `Several source repos in the active EDT (${names}) — publish is blocked.` },
          });
          return;
        }
        if (listed.data.sources.length === 0 && listed.data.issues.length > 0) {
          const first = listed.data.issues[0] as SourceIssue;
          set({
            sharedTypesSources: [],
            sharedTypesSourceIssues: listed.data.issues,
            sharedTypesSourcesStatus: 'error',
            sharedTypesSourcesError: { code: first.code, message: first.message },
          });
          return;
        }
        set({
          sharedTypesSources: listed.data.sources,
          sharedTypesSourceIssues: listed.data.issues,
          sharedTypesSourcesStatus: 'ready',
          sharedTypesSourcesError: null,
        });
      },
      runSharedTypesPublish: async () => {
        if (get().runInProgress || get().sharedTypesPublish.status === 'running') {
          set((state) => ({ sharedTypesPublish: { ...state.sharedTypesPublish, notice: RUN_IN_PROGRESS_MESSAGE } }));
          return;
        }
        get().setRunInProgress(true);
        set({ sharedTypesPublish: { ...IDLE_PUBLISH, status: 'running' } });
        try {
          const resolved = await resolveSingleSource();
          if (!resolved.ok && resolved.kind === 'empty') {
            set((state) => ({ sharedTypesPublish: { ...state.sharedTypesPublish, status: 'idle', error: null, notice: 'No source repo in the active EDT — publish is not offered.' } }));
            return;
          }
          if (!resolved.ok) {
            set({
              sharedTypesPublish: { ...IDLE_PUBLISH, status: 'blocked', error: { code: resolved.code ?? 'internal-error', message: resolved.message ?? 'Cannot resolve the source repo.' } },
            });
            return;
          }
          await executePublish(resolved.source);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          set((state) => ({
            sharedTypesPublish: { ...state.sharedTypesPublish, status: 'blocked', error: { code: 'internal-error', message }, notice: null },
          }));
        } finally {
          get().setRunInProgress(false);
        }
      },
      retrySharedTypesPublish: async () => {
        if (get().runInProgress || get().sharedTypesPublish.status === 'running') {
          set((state) => ({ sharedTypesPublish: { ...state.sharedTypesPublish, notice: RUN_IN_PROGRESS_MESSAGE } }));
          return;
        }
        if (deps?.sharedTypes === undefined || deps.restart === undefined) {
          set((state) => ({
            sharedTypesPublish: { ...state.sharedTypesPublish, status: 'blocked', error: { code: 'not-wired', message: 'Version publishing is not available in this session.' }, notice: null },
          }));
          return;
        }
        get().setRunInProgress(true);
        try {
          const resolved = await resolveSingleSource();
          if (!resolved.ok && resolved.kind === 'empty') {
            set((state) => ({ sharedTypesPublish: { ...state.sharedTypesPublish, notice: 'No source repo in the active EDT — publish is not offered.' } }));
            return;
          }
          if (!resolved.ok) {
            set((state) => ({
              sharedTypesPublish: { ...state.sharedTypesPublish, status: 'blocked', error: { code: resolved.code ?? 'internal-error', message: resolved.message ?? 'Cannot resolve the source repo.' }, notice: null },
            }));
            return;
          }
          const source = resolved.source;
          set((state) => ({ sharedTypesPublish: { ...state.sharedTypesPublish, error: null, notice: null } }));
          let owned: Awaited<ReturnType<typeof deps.sharedTypes.port.readOwnVersion>>;
          try {
            owned = await deps.sharedTypes.port.readOwnVersion(join(source.repoPath, 'package.json'));
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            set((state) => ({
              sharedTypesPublish: { ...state.sharedTypesPublish, status: 'blocked', error: { code: 'internal-error', message }, notice: null },
            }));
            return;
          }
          if (!owned.ok) {
            set((state) => ({
              sharedTypesPublish: { ...state.sharedTypesPublish, status: 'blocked', error: owned.error, notice: null },
            }));
            return;
          }
          const version = owned.data.trim();
          if (version === '') {
            set((state) => ({
              sharedTypesPublish: { ...state.sharedTypesPublish, status: 'blocked', error: { code: 'package-json-unreadable', message: `Cannot read ${join(source.repoPath, 'package.json')}: missing or blank "version" field` }, notice: null },
            }));
            return;
          }
          let verified: Awaited<ReturnType<typeof deps.sharedTypes.port.verifyPublished>>;
          try {
            verified = await deps.sharedTypes.port.verifyPublished(source.packageName, version, source.registry);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            set((state) => ({
              sharedTypesPublish: { ...state.sharedTypesPublish, status: 'blocked', error: { code: 'internal-error', message }, notice: null },
            }));
            return;
          }
          if (!verified.ok) {
            set((state) => ({
              sharedTypesPublish: { ...state.sharedTypesPublish, status: 'blocked', error: verified.error, notice: null },
            }));
            return;
          }
          if (verified.data) {
            set({ sharedTypesPublish: { ...IDLE_PUBLISH, status: 'done', version } });
            return;
          }
          set((state) => ({ sharedTypesPublish: { ...state.sharedTypesPublish, status: 'running' } }));
          await executePublish(source);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          set((state) => ({
            sharedTypesPublish: { ...state.sharedTypesPublish, status: 'blocked', error: { code: 'internal-error', message }, notice: null },
          }));
        } finally {
          get().setRunInProgress(false);
        }
      },
      resetSharedTypesPublish: () => {
        if (get().sharedTypesPublish.status === 'running') {
          return;
        }
        set({ sharedTypesPublish: IDLE_PUBLISH });
      },
    };
  };
}
