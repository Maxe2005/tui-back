// tui/store/slices: the Dashboard's Heal overlay (`H`) — plans with core planHeal, shows the
// targets and the skipped services for confirmation with a switchable mode (seeded from
// `dashboard.restartMode`, never written back), then runs core runHeal in-process with live rows
// and refreshes the Dashboard. No target, a plan failure or a busy restart give an auto-dismissed
// notice instead of the overlay. Closing mid-run only hides the overlay: the run finishes and
// keeps other restarts blocked through `serviceRestartInFlight` until it ends.
import type { StateCreator } from 'zustand';
import type { RestartRow } from '../../../../../core/edt/switch-restart.js';
import { HEAL_NOTHING_TO_DO_MESSAGE, planHeal, runHeal, type HealPlan, type HealReport } from '../../../../../core/heal/index.js';
import { healthCheckEnabledFrom } from '../../../../../core/ports/settings.js';
import type { Result } from '../../../../../core/result.js';
import { createServiceActions, type RestartMode, type ServiceActions } from '../../../../../core/service-actions/index.js';
import type { AppState, AppStoreDeps } from '../app-store.js';

export const HEAL_NOTICE_TIMEOUT_MS = 5000;
export const HEAL_BUSY_MESSAGE = 'A service restart is already in progress — wait for it to finish before healing.';
export const HEAL_UNWIRED_MESSAGE = 'Heal needs the container, restart, Docker and health-probe ports, which are not wired — nothing was restarted.';

export type HealRunStatus = 'planning' | 'confirm' | 'running' | 'done' | 'error';

export type HealRun = {
  status: HealRunStatus;
  plan: HealPlan | null;
  // This run's mode — never written back to the settings.
  mode: RestartMode;
  // Targets first, then the skipped services, in member order; live while `running`.
  rows: RestartRow[];
  report: HealReport | null;
  error: string | null;
};

export type HealNotice = { message: string; tone: 'success' | 'warning' | 'error' };

export type HealSlice = {
  healScreenOpen: boolean;
  healRun: HealRun | null;
  healNotice: HealNotice | null;
  openHeal: () => Promise<void>;
  toggleHealMode: () => void;
  startHeal: () => Promise<void>;
  closeHeal: () => void;
};

// The confirm list: the targets, then the skipped services, each group in member order.
export function orderHealPlanRows(rows: readonly RestartRow[]): RestartRow[] {
  return [...rows.filter((row) => row.phase === 'pending'), ...rows.filter((row) => row.phase !== 'pending')];
}

export function isHealBusy(state: Pick<AppState, 'switchRestart' | 'serviceRestartInFlight' | 'healRun'>): boolean {
  return state.switchRestart?.status === 'running' || Object.keys(state.serviceRestartInFlight).length > 0 || state.healRun?.status === 'running';
}

export function createHealSlice(deps?: AppStoreDeps): StateCreator<AppState, [], [], HealSlice> {
  let getState: (() => AppState) | null = null;
  // Like realign: the run restarts and verifies, so it is refused without the Docker and
  // health-probe ports. The editor is never used by restart/verify.
  const serviceActions: ServiceActions | null =
    deps?.container && deps.restart && deps.docker && deps.healthProbe
      ? createServiceActions({
          manifest: deps.manifest,
          container: deps.container,
          restart: deps.restart,
          editor: deps.editor ?? { launch: () => ({ ok: false, error: { code: 'editor-launch-failed', message: 'No editor is wired' } }) },
          lock: deps.lock,
          docker: deps.docker,
          healthProbe: deps.healthProbe,
          // Late-bound and read live, so a :settings change applies without a restart.
          isHealthCheckEnabled: healthCheckEnabledFrom(() => getState?.().settings ?? null),
        })
      : null;
  // Bumped on every notice so an older timer never clears a newer notice (even one with the same text).
  let noticeToken = 0;

  return (set, get) => {
    getState = get;
    // Auto-dismissed rather than keypress-dismissed: the `H` that triggered it reaches every
    // mounted handler, so a "next key clears it" rule could erase it before it is seen.
    const showNotice = (notice: HealNotice) => {
      noticeToken += 1;
      const token = noticeToken;
      set({ healNotice: notice });
      const timer = setTimeout(() => {
        if (token === noticeToken) {
          set({ healNotice: null });
        }
      }, HEAL_NOTICE_TIMEOUT_MS);
      timer.unref?.();
    };

    return {
      healScreenOpen: false,
      healRun: null,
      healNotice: null,
      openHeal: async () => {
        const state = get();
        if (state.healScreenOpen || state.healRun?.status === 'planning') {
          return;
        }
        if (isHealBusy(state)) {
          showNotice({ message: HEAL_BUSY_MESSAGE, tone: 'warning' });
          return;
        }
        if (!deps || serviceActions === null || deps.healthProbe === undefined) {
          showNotice({ message: HEAL_UNWIRED_MESSAGE, tone: 'error' });
          return;
        }
        // Read when the overlay is asked for, so a settings change applies to the next open.
        const mode = state.settings.dashboard.restartMode;
        set({ healRun: { status: 'planning', plan: null, mode, rows: [], report: null, error: null } });
        let plan: Result<HealPlan>;
        try {
          plan = await planHeal({
            state: deps.state,
            edtRegistry: deps.edtRegistry,
            manifest: deps.manifest,
            docker: deps.docker,
            healthProbe: deps.healthProbe,
            isHealthCheckEnabled: healthCheckEnabledFrom(() => get().settings),
          });
        } catch (error) {
          plan = { ok: false, error: { code: 'heal-plan-failed', message: errorMessage(error) } };
        }
        if (get().healRun?.status !== 'planning') {
          return;
        }
        if (!plan.ok) {
          set({ healRun: null });
          showNotice({ message: plan.error.message, tone: 'error' });
          return;
        }
        if (!plan.data.rows.some((row) => row.phase === 'pending')) {
          set({ healRun: null });
          showNotice({ message: HEAL_NOTHING_TO_DO_MESSAGE, tone: 'success' });
          return;
        }
        set({
          healScreenOpen: true,
          healNotice: null,
          healRun: { status: 'confirm', plan: plan.data, mode, rows: orderHealPlanRows(plan.data.rows), report: null, error: null },
        });
      },
      toggleHealMode: () => {
        const run = get().healRun;
        if (run?.status !== 'confirm') {
          return;
        }
        set({ healRun: { ...run, mode: run.mode === 'simple' ? 'clean' : 'simple' } });
      },
      startHeal: async () => {
        const run = get().healRun;
        if (run?.status !== 'confirm' || run.plan === null) {
          return;
        }
        const { plan, mode } = run;
        if (!deps || serviceActions === null) {
          set({ healRun: { ...run, status: 'error', error: HEAL_UNWIRED_MESSAGE } });
          return;
        }
        // Another restart may have started while the overlay was open.
        if (isHealBusy(get())) {
          set({ healRun: { ...run, status: 'error', error: HEAL_BUSY_MESSAGE } });
          return;
        }
        // Claimed in one update, before the first await, so a second start cannot pass the guards
        // above and no restart can slip in between the run and its in-flight marks.
        const inFlightPaths = plan.rows.filter((row) => row.phase === 'pending').map((row) => row.repoPath);
        set({
          healRun: { ...run, status: 'running' },
          serviceRestartInFlight: { ...get().serviceRestartInFlight, ...Object.fromEntries(inFlightPaths.map((path) => [path, 'restart' as const])) },
        });
        const live = new Map<string, RestartRow>();
        let report: Result<HealReport> = { ok: false, error: { code: 'heal-failed', message: 'The heal ended without a report' } };
        try {
          report = await runHeal({
            plan,
            mode,
            concurrency: get().settings.update.concurrency,
            serviceActions,
            lock: deps.lock,
            onPhase: (row) => {
              const current = get().healRun;
              if (current?.status !== 'running') {
                return;
              }
              live.set(row.repoPath, row);
              set({ healRun: { ...current, rows: current.rows.map((candidate) => live.get(candidate.repoPath) ?? candidate) } });
            },
          });
        } catch (error) {
          report = { ok: false, error: { code: 'heal-failed', message: errorMessage(error) } };
        } finally {
          // Whatever happened above, the targets are released and the run settles.
          const remaining = { ...get().serviceRestartInFlight };
          for (const path of inFlightPaths) {
            delete remaining[path];
          }
          const current = get().healRun ?? run;
          set({
            serviceRestartInFlight: remaining,
            healRun: report.ok
              ? { ...current, status: 'done', rows: report.data.rows, report: report.data, error: null }
              : { ...current, status: 'error', error: report.error.message },
          });
          void get().loadDashboard({ queueIfBusy: true });
        }
      },
      closeHeal: () => {
        // Mid-run the overlay only hides: the run finishes in the background (runHeal has no
        // cancellation) and the slice keeps owning it.
        if (get().healRun?.status === 'running') {
          set({ healScreenOpen: false });
          return;
        }
        set({ healScreenOpen: false, healRun: null });
      },
    };
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
