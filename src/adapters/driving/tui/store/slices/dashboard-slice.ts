// tui/store/slices: the Dashboard's state — the services and registry-health sections, each with
// its own load status so they fill independently, plus the time of the last completed load.
// Builders run in-process over injected ports; unwired, a section degrades to an error state.
import { basename } from 'node:path';
import type { StateCreator } from 'zustand';
import { err, type Result } from '../../../../../core/result.js';
import {
  createServiceActions,
  openInIde,
  restartBlockingLocks,
  type RestartMode,
  type ServiceAction,
  type ServiceActions,
} from '../../../../../core/service-actions/index.js';
import {
  buildDashboardRegistrySummary,
  buildDashboardServices,
  type DashboardRegistrySummary,
  type DashboardServicesSection,
} from '../../../../../core/dashboard/snapshot.js';
import type { AppState, AppStoreDeps } from '../app-store.js';
import type { TerminalKind } from './terminal-slice.js';

export type DashboardSectionStatus = 'idle' | 'loading' | 'ready' | 'error';

// One service's action run, keyed by repo path: what is running now (with its progress line) and
// the last outcome, kept until the next run on that row.
export type DashboardActionState = {
  running: { actionId: string; text: string } | null;
  result: { ok: boolean; text: string } | null;
};

export type DashboardSlice = {
  dashboardServicesStatus: DashboardSectionStatus;
  dashboardServices: DashboardServicesSection | null;
  dashboardRegistryStatus: DashboardSectionStatus;
  dashboardRegistry: DashboardRegistrySummary | null;
  // Epoch ms of the last section that loaded successfully; null before the first one.
  dashboardUpdatedAt: number | null;
  loadDashboard: (options?: LoadDashboardOptions) => Promise<void>;
  // The registry's actions per repo path; absent until loaded (or when the ports are unwired).
  dashboardServiceActions: Record<string, ServiceAction[]>;
  dashboardActionState: Record<string, DashboardActionState>;
  loadDashboardServiceActions: (repoPath: string) => Promise<void>;
  runDashboardServiceAction: (repoPath: string, actionId: string) => Promise<void>;
  // The service `Enter` asked another zone to land on; that zone clears it once it has.
  pendingServiceFocus: string | null;
  openServiceInZone: (repoPath: string) => void;
  clearPendingServiceFocus: () => void;
};

const RESTART_MODES: Record<string, RestartMode> = {
  'restart-simple': 'simple',
  'restart-clean': 'clean',
};
// The registry's terminal entries open the Terminal overlay on the row's target; their
// availability was already re-read by runDashboardServiceAction, like every other action.
const TERMINAL_KINDS: Record<string, TerminalKind> = {
  'terminal-service': 'service',
  'terminal-container': 'container',
};
const RESTART_LABELS: Record<RestartMode, string> = {
  simple: 'Restart',
  clean: 'Clean restart',
};

function firstLine(message: string): string {
  return message.split('\n')[0] ?? message;
}

export type LoadDashboardOptions = {
  // Re-run once the in-flight load settles instead of dropping the call (an EDT switch).
  queueIfBusy?: boolean;
};

// Drops cached actions and results of rows no longer listed, except a row still running.
function pruneActionEntries(
  state: Pick<DashboardSlice, 'dashboardServiceActions' | 'dashboardActionState'>,
  listedPaths: readonly string[],
): Pick<DashboardSlice, 'dashboardServiceActions' | 'dashboardActionState'> {
  const keep = (path: string) => listedPaths.includes(path) || state.dashboardActionState[path]?.running != null;
  return {
    dashboardServiceActions: Object.fromEntries(Object.entries(state.dashboardServiceActions).filter(([path]) => keep(path))),
    dashboardActionState: Object.fromEntries(Object.entries(state.dashboardActionState).filter(([path]) => keep(path))),
  };
}

export function createDashboardSlice(deps?: AppStoreDeps): StateCreator<AppState, [], [], DashboardSlice> {
  // Built once from the injected ports; absent when the restart ports are not wired.
  const serviceActions: ServiceActions | null =
    deps?.container && deps.restart && deps.editor
      ? createServiceActions({
          manifest: deps.manifest,
          container: deps.container,
          restart: deps.restart,
          editor: deps.editor,
          lock: deps.lock,
          // The container terminal's availability reads the container's live health.
          docker: deps.docker,
        })
      : null;
  return (set, get) => {
    let reloadQueued = false;
    function patchActionState(repoPath: string, patch: Partial<DashboardActionState>): void {
      set((state) => ({
        dashboardActionState: {
          ...state.dashboardActionState,
          [repoPath]: {
            ...(state.dashboardActionState[repoPath] ?? {
              running: null,
              result: null,
            }),
            ...patch,
          },
        },
      }));
    }
    const starting = new Set<string>();
    const fetchSeq = new Map<string, number>();
    // Reads one row's actions; a response older than a newer request for the same row is ignored.
    // Returns the fresh list, or null when it could not be loaded (the cached entry is dropped).
    async function fetchActions(repoPath: string, store: boolean): Promise<ServiceAction[] | null> {
      if (serviceActions === null) {
        return null;
      }
      const seq = (fetchSeq.get(repoPath) ?? 0) + 1;
      fetchSeq.set(repoPath, seq);
      const listed = await serviceActions
        .list(repoPath, {
          blockingLocks: restartBlockingLocks(get().activeEdt),
        })
        .catch((): Result<ServiceAction[]> => err('internal-error', 'Listing the service actions failed.'));
      if (store && fetchSeq.get(repoPath) === seq) {
        set((state) => {
          const next = { ...state.dashboardServiceActions };
          if (listed.ok) {
            next[repoPath] = listed.data;
          } else {
            delete next[repoPath];
          }
          return { dashboardServiceActions: next };
        });
      }
      return listed.ok ? listed.data : null;
    }
    async function runAction(repoPath: string, actionId: string): Promise<void> {
      if (actionId === 'open-in-ide') {
        const ctx = { editorCommand: get().settings.general.editorCommand };
        const opened: Result<void> = serviceActions
          ? serviceActions.openInIde(repoPath, ctx)
          : deps?.editor
            ? openInIde(deps.editor, repoPath, ctx)
            : err('editor-unavailable', 'No editor port is wired — cannot open the repo in an editor.');
        patchActionState(repoPath, {
          result: opened.ok ? { ok: true, text: 'Opened in IDE' } : { ok: false, text: firstLine(opened.error.message) },
        });
        return;
      }
      const terminalKind = TERMINAL_KINDS[actionId];
      if (terminalKind !== undefined) {
        const row = get().dashboardServices?.services.find((service) => service.path === repoPath);
        await get().openTerminal(repoPath, terminalKind, row?.service ?? basename(repoPath));
        return;
      }
      const mode = RESTART_MODES[actionId];
      if (mode === undefined) {
        return;
      }
      const label = RESTART_LABELS[mode];
      if (serviceActions === null) {
        patchActionState(repoPath, {
          result: {
            ok: false,
            text: 'No restart ports are wired — cannot restart the service.',
          },
        });
        return;
      }
      patchActionState(repoPath, {
        running: { actionId, text: `${label}…` },
        result: null,
      });
      const outcome = await serviceActions
        .restart(repoPath, mode, ({ step, total }) =>
          patchActionState(repoPath, {
            running: {
              actionId,
              text: mode === 'clean' ? `${label} — recipe step ${step}/${total}` : `${label}…`,
            },
          }),
        )
        .catch((): Result<{ notice?: string }> => err('internal-error', 'The restart failed unexpectedly.'));
      patchActionState(repoPath, {
        running: null,
        result: outcome.ok
          ? {
              ok: true,
              text: outcome.data.notice === undefined ? `${label} done` : `${label} done — ${outcome.data.notice}`,
            }
          : { ok: false, text: firstLine(outcome.error.message) },
      });
      // Only the action list refreshes (lock/availability); the table rows wait for `R`.
      await get().loadDashboardServiceActions(repoPath);
    }
    return {
      dashboardServiceActions: {},
      dashboardActionState: {},
      pendingServiceFocus: null,
      openServiceInZone: (repoPath) => set({ pendingServiceFocus: repoPath, activeZone: 'logs' }),
      clearPendingServiceFocus: () => set({ pendingServiceFocus: null }),
      loadDashboardServiceActions: async (repoPath) => {
        await fetchActions(repoPath, true);
      },
      runDashboardServiceAction: async (repoPath, actionId) => {
        if (get().dashboardActionState[repoPath]?.running != null || starting.has(repoPath)) {
          return;
        }
        starting.add(repoPath);
        try {
          if (serviceActions !== null) {
            // Never trust a cached availability: re-read it right before running and fail closed.
            const fresh = await fetchActions(repoPath, true);
            const target = fresh?.find((action) => action.id === actionId);
            if (fresh === null) {
              patchActionState(repoPath, {
                result: {
                  ok: false,
                  text: 'The actions could not be loaded — try again.',
                },
              });
              return;
            }
            if (target === undefined || !target.availability.available) {
              return;
            }
          }
          starting.delete(repoPath);
          await runAction(repoPath, actionId);
        } finally {
          starting.delete(repoPath);
        }
      },
      dashboardServicesStatus: 'idle',
      dashboardServices: null,
      dashboardRegistryStatus: 'idle',
      dashboardRegistry: null,
      dashboardUpdatedAt: null,
      loadDashboard: async (options) => {
        if (get().dashboardServicesStatus === 'loading' || get().dashboardRegistryStatus === 'loading') {
          reloadQueued = reloadQueued || options?.queueIfBusy === true;
          return;
        }
        if (deps === undefined) {
          set({
            dashboardServicesStatus: 'error',
            dashboardRegistryStatus: 'error',
          });
          return;
        }
        set({
          dashboardServicesStatus: 'loading',
          dashboardRegistryStatus: 'loading',
        });
        // A builder that throws degrades its own section; the other one is untouched.
        const services = buildDashboardServices(deps).then(
          (result) =>
            set((state) => ({
              dashboardServicesStatus: result.ok ? 'ready' : 'error',
              dashboardServices: result.ok ? result.data : null,
              ...(result.ok
                ? {
                    dashboardUpdatedAt: Date.now(),
                    ...pruneActionEntries(
                      state,
                      result.data.services.map((row) => row.path),
                    ),
                  }
                : {}),
            })),
          () => set({ dashboardServicesStatus: 'error', dashboardServices: null }),
        );
        const registry = buildDashboardRegistrySummary(deps).then(
          (result) =>
            set({
              dashboardRegistryStatus: result.ok ? 'ready' : 'error',
              dashboardRegistry: result.ok ? result.data : null,
              ...(result.ok ? { dashboardUpdatedAt: Date.now() } : {}),
            }),
          () => set({ dashboardRegistryStatus: 'error', dashboardRegistry: null }),
        );
        await Promise.all([services, registry]);
        if (reloadQueued) {
          reloadQueued = false;
          await get().loadDashboard();
        }
      },
    };
  };
}
