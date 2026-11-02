// tui/store/slices: the `:realign` overlay — the drifted services it lists (re-read on every
// open), the selection draft seeded from the `realign.*` settings, and `runRealign`, which calls
// core realignServices in-process with live per-service rows, then refreshes the Dashboard.
import type { StateCreator } from 'zustand';
import { listDriftCandidates, type DriftCandidate, type DriftCandidates } from '../../../../../core/dashboard/drift.js';
import type { RestartRow } from '../../../../../core/edt/switch-restart.js';
import { cycleSwitchRestartMode, type RealignScope, type SwitchRestartMode } from '../../../../../core/ports/settings.js';
import { realignServices, type RealignOutcome, type RealignRow } from '../../../../../core/realign/index.js';
import type { Result } from '../../../../../core/result.js';
import { createServiceActions, type ServiceActions } from '../../../../../core/service-actions/index.js';
import type { AppState, AppStoreDeps } from '../app-store.js';

const NO_DEPS_ERROR = 'No ports wired into the TUI store';

export type RealignLiveStatus = 'pending' | 'realigning' | RealignOutcome;

export type RealignLiveRow = {
  service: string;
  path: string;
  status: RealignLiveStatus;
  detail?: { code: string; message: string };
};

export type RealignCandidates = {
  status: 'loading' | 'ready' | 'error';
  // Drifted services only, members first.
  rows: DriftCandidate[];
  error: string | null;
};

export type RealignDraft = {
  cursor: number;
  // Selected repo paths.
  selected: string[];
  // This run's restart choice — never written back to the settings.
  restartMode: SwitchRestartMode;
};

export type RealignRun = {
  status: 'running' | 'done' | 'error';
  restartMode: SwitchRestartMode;
  rows: RealignLiveRow[];
  restartRows: RestartRow[];
  // Set when the restart phase could not run (the realign rows stand) or the run was refused.
  restartError: string | null;
  error: string | null;
};

export type RealignSlice = {
  realignScreenOpen: boolean;
  realignCandidates: RealignCandidates | null;
  realignDraft: RealignDraft;
  realignRun: RealignRun | null;
  openRealignScreen: () => void;
  closeRealignScreen: () => void;
  moveRealignCursor: (cursor: number) => void;
  toggleRealignRow: (path: string) => void;
  applyRealignPreset: (preset: RealignScope) => void;
  cycleRealignRestartMode: (direction: 1 | -1) => void;
  runRealign: () => Promise<void>;
};

// The rows a preset checks: none, the active EDT's members, or every listed row.
export function presetSelection(rows: readonly DriftCandidate[], preset: RealignScope): string[] {
  return rows.filter((row) => preset === 'all' || (preset === 'edt' && row.kind === 'member')).map((row) => row.path);
}

// The preset the selection matches, or null once a row was toggled away from every preset.
export function matchingPreset(rows: readonly DriftCandidate[], selected: readonly string[]): RealignScope | null {
  const chosen = new Set(selected);
  for (const preset of ['none', 'edt', 'all'] as const) {
    const expected = presetSelection(rows, preset);
    if (expected.length === chosen.size && expected.every((path) => chosen.has(path))) {
      return preset;
    }
  }
  return null;
}

// Finalises the first open row of `row.service` and promotes the next pending row: the use-case
// reports each row once done and has no start event. A row matching no open row (already
// finalised, or not listed) is dropped rather than pinned on another service.
export function applyRealignRow(rows: readonly RealignLiveRow[], row: RealignRow): RealignLiveRow[] {
  const open = (candidate: RealignLiveRow) => candidate.status === 'pending' || candidate.status === 'realigning';
  const index = rows.findIndex((candidate) => open(candidate) && candidate.service === row.service);
  if (index === -1) {
    return [...rows];
  }
  const next = rows.map((candidate, candidateIndex) =>
    candidateIndex === index ? { ...candidate, status: row.outcome, ...(row.detail !== undefined ? { detail: row.detail } : {}) } : candidate,
  );
  if (!next.some((candidate) => candidate.status === 'realigning')) {
    const pending = next.findIndex((candidate) => candidate.status === 'pending');
    if (pending !== -1) {
      next[pending] = { ...next[pending]!, status: 'realigning' };
    }
  }
  return next;
}

const EMPTY_DRAFT: RealignDraft = { cursor: 0, selected: [], restartMode: 'none' };

export function createRealignSlice(deps?: AppStoreDeps): StateCreator<AppState, [], [], RealignSlice> {
  // Bumped on every open so a candidates load from a superseded session never lands late.
  let session = 0;
  // The restart phase needs to restart and verify; like the CLI, it is refused without the
  // Docker and health-probe ports. The editor is never used by restart/verify.
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
        })
      : null;

  return (set, get) => {
    const loadCandidates = async (current: number, preset: RealignScope) => {
      if (!deps) {
        set({ realignCandidates: { status: 'error', rows: [], error: NO_DEPS_ERROR } });
        return;
      }
      let listed: Result<DriftCandidates>;
      try {
        listed = await listDriftCandidates(deps);
      } catch (error) {
        listed = { ok: false, error: { code: 'realign-failed', message: errorMessage(error) } };
      }
      if (current !== session) {
        return;
      }
      if (!listed.ok) {
        set({ realignCandidates: { status: 'error', rows: [], error: listed.error.message } });
        return;
      }
      if (listed.data.active === null) {
        set({ realignCandidates: { status: 'error', rows: [], error: 'No active EDT — switch to an EDT before realigning.' } });
        return;
      }
      const rows = [...listed.data.members, ...listed.data.others].filter((candidate) => candidate.drift === 'drifted');
      set((state) => ({
        realignCandidates: { status: 'ready', rows, error: null },
        realignDraft: { ...state.realignDraft, cursor: 0, selected: presetSelection(rows, preset) },
      }));
    };

    return {
      realignScreenOpen: false,
      realignCandidates: null,
      realignDraft: EMPTY_DRAFT,
      realignRun: null,
      openRealignScreen: () => {
        if (get().realignScreenOpen) {
          return;
        }
        session += 1;
        // Both defaults are read together when the dialog opens, so a settings change applies
        // to the next open; the preset is applied once the candidates arrive.
        const { defaultScope, restartMode } = get().settings.realign;
        set({
          realignScreenOpen: true,
          realignCandidates: { status: 'loading', rows: [], error: null },
          realignDraft: { ...EMPTY_DRAFT, restartMode },
          realignRun: null,
        });
        void loadCandidates(session, defaultScope);
      },
      closeRealignScreen: () => {
        // A running realign cannot be abandoned mid-way — the overlay stays until it settles.
        if (get().realignRun?.status === 'running') {
          return;
        }
        session += 1;
        set({ realignScreenOpen: false, realignCandidates: null, realignDraft: EMPTY_DRAFT, realignRun: null });
      },
      moveRealignCursor: (cursor) => {
        const count = get().realignCandidates?.rows.length ?? 0;
        set((state) => ({ realignDraft: { ...state.realignDraft, cursor: Math.min(Math.max(cursor, 0), Math.max(count - 1, 0)) } }));
      },
      toggleRealignRow: (path) => {
        if (get().realignRun !== null) {
          return;
        }
        set((state) => {
          const selected = state.realignDraft.selected;
          return {
            realignDraft: {
              ...state.realignDraft,
              selected: selected.includes(path) ? selected.filter((candidate) => candidate !== path) : [...selected, path],
            },
          };
        });
      },
      applyRealignPreset: (preset) => {
        if (get().realignRun !== null) {
          return;
        }
        set((state) => ({ realignDraft: { ...state.realignDraft, selected: presetSelection(state.realignCandidates?.rows ?? [], preset) } }));
      },
      cycleRealignRestartMode: (direction) => {
        if (get().realignRun !== null) {
          return;
        }
        set((state) => ({
          realignDraft: { ...state.realignDraft, restartMode: cycleSwitchRestartMode(state.realignDraft.restartMode, direction) },
        }));
      },
      runRealign: async () => {
        const { realignCandidates: candidates, realignDraft: draft, realignRun } = get();
        if (realignRun?.status === 'running' || candidates?.status !== 'ready') {
          return;
        }
        const chosen = new Set(draft.selected);
        const selection = candidates.rows.filter((row) => chosen.has(row.path));
        if (selection.length === 0) {
          return;
        }
        const restartMode = draft.restartMode;
        const refuse = (message: string) =>
          set({ realignRun: { status: 'error', restartMode, rows: [], restartRows: [], restartError: null, error: message } });
        if (!deps) {
          refuse(NO_DEPS_ERROR);
          return;
        }
        if (restartMode !== 'none') {
          if (serviceActions === null) {
            refuse('Post-realign restart needs the Docker and health-probe ports, which are not wired — nothing was realigned.');
            return;
          }
          if (get().switchRestart?.status === 'running' || Object.keys(get().serviceRestartInFlight).length > 0) {
            refuse('A service restart is already in progress — wait for it to finish before realigning with a restart.');
            return;
          }
        }
        // Claimed before the first await so two interleaved starts cannot both pass the guards above.
        const rows: RealignLiveRow[] = selection.map((row, index) => ({
          service: row.service,
          path: row.path,
          status: index === 0 ? 'realigning' : 'pending',
        }));
        set({ realignRun: { status: 'running', restartMode, rows, restartRows: [], restartError: null, error: null } });
        const inFlightPaths = restartMode !== 'none' ? selection.map((row) => row.path) : [];
        if (inFlightPaths.length > 0) {
          set({
            serviceRestartInFlight: { ...get().serviceRestartInFlight, ...Object.fromEntries(inFlightPaths.map((path) => [path, 'restart' as const])) },
          });
        }
        const liveRestart = new Map<string, RestartRow>();
        const update = (patch: Partial<RealignRun>) => {
          const current = get().realignRun;
          if (current?.status === 'running') {
            set({ realignRun: { ...current, ...patch } });
          }
        };
        let outcome: Awaited<ReturnType<typeof realignServices>>;
        try {
          outcome = await realignServices({
            registry: deps.registry,
            manifest: deps.manifest,
            manifestCarry: deps.manifestCarry,
            git: deps.git,
            lock: deps.lock,
            state: deps.state,
            edtRegistry: deps.edtRegistry,
            // Drift is re-read under the lock: an entry aligned meanwhile comes back `unchanged`.
            scope: 'none',
            services: selection.map((row) => row.service),
            onRow: (row) => update({ rows: applyRealignRow(get().realignRun?.rows ?? [], row) }),
            ...(restartMode !== 'none' && serviceActions !== null
              ? {
                  restart: {
                    mode: restartMode,
                    concurrency: get().settings.update.concurrency,
                    serviceActions,
                    onPhase: (row: RestartRow) => {
                      liveRestart.set(row.repoPath, row);
                      update({ restartRows: [...liveRestart.values()] });
                    },
                  },
                }
              : {}),
          });
        } catch (error) {
          outcome = { ok: false, error: { code: 'realign-failed', message: errorMessage(error) } };
        }
        if (inFlightPaths.length > 0) {
          const remaining = { ...get().serviceRestartInFlight };
          for (const path of inFlightPaths) {
            delete remaining[path];
          }
          set({ serviceRestartInFlight: remaining });
        }
        if (outcome.ok) {
          const finalRows = outcome.data.rows.reduce(applyRealignRow, get().realignRun?.rows ?? rows);
          set({
            realignRun: {
              status: 'done',
              restartMode,
              rows: finalRows,
              restartRows: outcome.data.restart?.rows ?? [...liveRestart.values()],
              restartError: outcome.data.restartError?.message ?? null,
              error: null,
            },
          });
        } else {
          // The run stopped before or between rows (lock held, active EDT changed, unreadable
          // registry, a throw): rows that already finished stay listed so the developer sees what
          // was realigned before the error; the rest are dropped.
          const finished = (get().realignRun?.rows ?? []).filter((row) => row.status !== 'pending' && row.status !== 'realigning');
          set({ realignRun: { status: 'error', restartMode, rows: finished, restartRows: [...liveRestart.values()], restartError: null, error: outcome.error.message } });
        }
        void get().loadDashboard({ queueIfBusy: true });
      },
    };
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
