// tui/store/slices: the shared-types zone's state — the active EDT's consuming services and the
// state of one propagation run (blocked / per-service results / live step). The zone's form
// state (version text, checklist, toggles) stays zone-local. The use-cases run in-process over
// the injected ports; with `sharedTypes` unwired every action degrades to an explicit error.
import type { StateCreator } from 'zustand';
import {
  isResumable,
  propagateVersion,
  type PropagateOptions,
  type PropagateServiceResult,
  type PropagateStep,
  type ResumeFrom,
} from '../../../../../core/shared-types/propagate-version.js';
import { listConsumers, type ConsumerIssue, type DependencyConsumer } from '../../../../../core/shared-types/list-consumers.js';
import type { AppState, AppStoreDeps } from '../app-store.js';

export type SharedTypesConsumersStatus = 'idle' | 'loading' | 'ready' | 'error';
export type SharedTypesRunStatus = 'idle' | 'running' | 'done' | 'blocked';

export type SharedTypesRun = {
  status: SharedTypesRunStatus;
  version: string;
  options: PropagateOptions;
  blocked: { code: string; message: string } | null;
  results: PropagateServiceResult[];
  // The service and step currently executing while status is `running`.
  live: { repoPath: string; step: PropagateStep } | null;
};

export type SharedTypesSlice = {
  sharedTypesConsumers: DependencyConsumer[];
  sharedTypesIssues: ConsumerIssue[];
  sharedTypesConsumersStatus: SharedTypesConsumersStatus;
  sharedTypesConsumersError: { code: string; message: string } | null;
  sharedTypesRun: SharedTypesRun;
  loadSharedTypesConsumers: () => Promise<void>;
  runSharedTypesPropagation: (input: { version: string; repoPaths: string[]; options: PropagateOptions }) => Promise<void>;
  retrySharedTypesService: (repoPath: string) => Promise<void>;
  resetSharedTypesRun: () => void;
};

const IDLE_OPTIONS: PropagateOptions = { install: false, cleanRestart: false, commit: false };

const IDLE_RUN: SharedTypesRun = {
  status: 'idle',
  version: '',
  options: IDLE_OPTIONS,
  blocked: null,
  results: [],
  live: null,
};

export function createSharedTypesSlice(deps?: AppStoreDeps): StateCreator<AppState, [], [], SharedTypesSlice> {
  return (set, get) => {
    async function execute(
      consumers: DependencyConsumer[],
      version: string,
      options: PropagateOptions,
      resume: Record<string, ResumeFrom>,
      merge: (fresh: PropagateServiceResult[]) => PropagateServiceResult[],
    ): Promise<void> {
      if (deps?.sharedTypes === undefined || deps.container === undefined || deps.restart === undefined) {
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
        return;
      }
      set((state) => ({ sharedTypesRun: { ...state.sharedTypesRun, status: 'running', version, options, blocked: null, live: null } }));
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
          options,
          resume,
          onProgress: (event) => set((state) => ({ sharedTypesRun: { ...state.sharedTypesRun, live: { repoPath: event.repoPath, step: event.step } } })),
        });
        if (report.status === 'blocked') {
          set((state) => ({ sharedTypesRun: { ...state.sharedTypesRun, status: 'blocked', blocked: report.error, live: null } }));
        } else {
          set((state) => ({
            sharedTypesRun: { ...state.sharedTypesRun, status: 'done', results: merge(report.results), live: null },
          }));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        set((state) => ({
          sharedTypesRun: { ...state.sharedTypesRun, status: 'blocked', blocked: { code: 'internal-error', message }, live: null },
        }));
      } finally {
        get().setRunInProgress(false);
      }
    }

    return {
      sharedTypesConsumers: [],
      sharedTypesIssues: [],
      sharedTypesConsumersStatus: 'idle',
      sharedTypesConsumersError: null,
      sharedTypesRun: IDLE_RUN,
      loadSharedTypesConsumers: async () => {
        if (deps?.sharedTypes === undefined) {
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
          return;
        }
        const resume: Record<string, ResumeFrom> = isResumable(previous.failedStep) ? { [repoPath]: previous.failedStep } : {};
        await execute([consumer], sharedTypesRun.version, sharedTypesRun.options, resume, (fresh) =>
          get().sharedTypesRun.results.map((result) => fresh.find((candidate) => candidate.repoPath === result.repoPath) ?? result),
        );
      },
      resetSharedTypesRun: () => {
        if (get().sharedTypesRun.status === 'running') {
          return;
        }
        set({ sharedTypesRun: IDLE_RUN });
      },
    };
  };
}
