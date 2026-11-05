// tui/store/slices: Logs zone state — the selected services in both left-panel lists, the ad
// hoc fullscreen preview target, and the per-pane buffer/error/scroll/health state. The ring
// buffer itself lives in core/logs' LogsManager (one per store, in memory only); `logsPanes`
// is a mirror kept in sync via `onUpdate` so React re-renders, never a second source of truth.
// Also owns the persisted filter-history lists.
import { healthCheckEnabledFrom } from '../../../../../core/ports/settings.js';
import type { StateCreator } from 'zustand';
import { createLogsManager, type LogsManager } from '../../../../../core/logs/index.js';
import { clearLogs, loadOlderLogs, subscribeLogs, unsubscribeLogs } from '../../../../../core/logs/use-cases.js';
import type { LogLine } from '../../../../../core/ports/docker.js';
import type { Manifest } from '../../../../../core/ports/manifest.js';
import { hasContainer, hasHealthUrl, resolveManifestStatus, type ServiceStatusState } from '../../../../../core/service-status/index.js';
import {
  createServiceActions,
  NO_CLEAN_RECIPE_NOTICE,
  NO_CLEAN_RECIPE_REASON,
  openInIde,
  restartBlockingLocks,
  type RestartMode,
  type ServiceAction,
  type ServiceActions,
} from '../../../../../core/service-actions/index.js';
import { err, type Result } from '../../../../../core/result.js';
import type { AppState, AppStoreDeps } from '../app-store.js';
import { OPEN_IN_IDE_ACTION_ID, RESTART_ACTION_IDS, RESTART_MODES, TERMINAL_KINDS } from './service-action-ids.js';
import { createPersistedHistoryStore, pushHistoryEntry } from '../../shared/input-history/index.js';
import { createInFlightGuard } from '../../shared/poll/in-flight-guard.js';
import {
  DEFAULT_LOG_FILTER,
  DEFAULT_VISIBILITY_FLAGS,
  filterHistoryKeyString,
  resolvePostLoadScrollOffset,
  type FilterHistoryKey,
  type LogFilterSpec,
  type VisibilityFlags,
} from '../../zones/logs/logs-zone.logic.js';

export type LogsPaneErrorState = { code: string; message: string } | null;

export type LogsPaneData = {
  repoPath: string;
  service: string;
  lines: LogLine[];
  streamError: LogsPaneErrorState;
  noMoreHistory: boolean;
  // Health-first status for this pane's service (AD-23, through core/service-status — never
  // persisted, read on poll only) plus
  // whether a developer-triggered `docker restart` is in flight for this pane (gates the R
  // control + the no-op guard). Defaults: `down` (not yet proven up) and `false`.
  // `no-container` is the TUI-side state for a manifest without `container` — set without
  // ever touching Docker, and such a pane never subscribes, polls, or restarts.
  health: ServiceStatusState;
  // True once the manifest resolved without a `container`: no stream and no restart, whatever
  // `health` says (a container-less service declaring a probed `healthUrl` reads up/down).
  noContainer?: boolean;
  restarting: boolean;
  // A one-line, non-error annotation of the last restart or open-in-IDE attempt (the registry's
  // clean-restart fallback notice, or an IDE launch failure) — shown dim, distinct from
  // `streamError`. Cleared when the next restart or IDE launch starts.
  notice?: string | null;
  // How many lines back from the tail this pane is currently scrolled — 0 means "pinned to
  // the live tail". Purely local UI state (never mirrored from LogsManager); bumped by
  // loadOlderLogsPane's own successful prepend so the viewport doesn't visually jump.
  scrollOffset: number;
};

// Drops every per-service display setting (wrap, own filter, global-filter engagement) for the
// given repoPaths — what deselecting a service resets, so re-selecting it starts from the
// defaults. The global settings (visibility flags, global filter) are never touched here.
function withoutPaneSettings(state: AppState, repoPaths: readonly string[]): Partial<AppState> {
  const drop = new Set(repoPaths);
  const omit = <T>(record: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(record).filter(([path]) => !drop.has(path)));
  return {
    logsPaneWrap: omit(state.logsPaneWrap),
    logsPaneFilterEngaged: omit(state.logsPaneFilterEngaged),
    logsPaneFilters: omit(state.logsPaneFilters),
  };
}

function emptyPane(repoPath: string, service: string): LogsPaneData {
  return { repoPath, service, lines: [], streamError: null, noMoreHistory: false, scrollOffset: 0, health: 'down', restarting: false, notice: null };
}

// Per-pane health poll cadence — on subscribe plus an interval, cleared on unsubscribe. Never
// resubscribes the log stream itself.
export const LOGS_HEALTH_POLL_INTERVAL_MS = 5000;
// Listed-row health poll cadence — one shared timer covering every listed row (mirroring
// update-slice.ts), not one timer per pane. Same 5s by convention, not by coupling.
export const LOGS_LISTED_HEALTH_POLL_INTERVAL_MS = 5000;

export type LogsPaneShortcut = 'restart' | 'ide';

// The pane notice when the registry could not be listed right before running an action.
export const LOGS_ACTIONS_UNAVAILABLE_NOTICE = 'the service actions could not be loaded — try again';
// The pane notice when running an action threw (against the ports' contract).
export const LOGS_ACTION_FAILED_NOTICE = 'the action failed unexpectedly';

// The pane notice for an action that cannot run now, naming it: `Restart unavailable — group update`.
export function unavailableNotice(label: string, reason: string): string {
  return `${label} unavailable — ${reason}`;
}

const RESTART_LABELS: Record<RestartMode, string> = { simple: 'Restart', clean: 'Clean restart' };

export type LogsSlice = {
  // repoPaths currently checked in the EDT-members list / the other-services list — any
  // manifest service can be streamed, not only active-EDT members.
  logsEdtSelected: string[];
  logsOtherSelected: string[];
  // Set only for an Enter-on-an-unselected-row ad hoc preview — never added to
  // logsEdtSelected/logsOtherSelected, so closing it never mutates selection.
  logsFullscreenTarget: string | null;
  // The service name to render as this preview's title, captured at the moment fullscreen was
  // opened rather than re-derived via a live `rows.find(...)` lookup — that can miss (e.g. a
  // transient services-list load error while the preview is open) and fall back to a bare
  // "Logs" label right when the user needs the service name most.
  logsFullscreenServiceName: string | null;
  // Keyed by repoPath — one entry per currently-active pane (selected, or the ad hoc
  // fullscreen target). A key with no entry yet (subscribe still in flight) is treated as an
  // empty/loading pane by the zone.
  logsPanes: Record<string, LogsPaneData>;
  // Display settings of the Logs tab, kept in the store (in memory only, never written to
  // disk) so they survive switching tabs and coming back, but not closing the tool.
  // Global ones: the t/o/p visibility flags and the global filter. Per-service ones, keyed by
  // repoPath: wrap, global-filter engagement, own filter — all dropped when the service is
  // deselected, so re-selecting it starts fresh while the global ones stay applied.
  logsVisibility: VisibilityFlags;
  logsGlobalFilter: LogFilterSpec;
  logsPaneWrap: Record<string, boolean>;
  logsPaneFilterEngaged: Record<string, boolean>;
  logsPaneFilters: Record<string, LogFilterSpec>;
  setLogsVisibility: (update: (current: VisibilityFlags) => VisibilityFlags) => void;
  setLogsGlobalFilter: (filter: LogFilterSpec) => void;
  setLogsPaneWrap: (update: (current: Record<string, boolean>) => Record<string, boolean>) => void;
  setLogsPaneFilterEngaged: (update: (current: Record<string, boolean>) => Record<string, boolean>) => void;
  setLogsPaneFilters: (update: (current: Record<string, LogFilterSpec>) => Record<string, LogFilterSpec>) => void;
  toggleLogsEdtSelection: (repoPath: string) => void;
  toggleLogsOtherSelection: (repoPath: string) => void;
  selectAllLogsEdtServices: (repoPaths: readonly string[]) => void;
  deselectAllLogsEdtServices: () => void;
  selectAllLogsOtherServices: (repoPaths: readonly string[]) => void;
  deselectAllLogsOtherServices: () => void;
  // Per-row container presence, keyed by repoPath — true exactly when that row's manifest
  // positively resolved without a `container`. Absent means unknown (not yet loaded, or the
  // load failed); such rows stay in their membership list and never enter the info-only
  // third section. Resolved async, cached, never blocks the first render.
  logsNoContainer: Record<string, boolean>;
  // Resolves presence for every given repoPath whose answer is not cached yet — one
  // manifest.load per uncached row, failures left absent for a later retry.
  resolveLogsContainerPresence: (repoPaths: readonly string[]) => void;
  // Listed-row health for the list badges, keyed by repoPath — covers every listed row, not
  // just subscribed panes (whose own logsPanes[repoPath].health stays the pane source of
  // truth). Missing reads as `down` at render, like the Update zone's own map.
  logsListedHealth: Record<string, ServiceStatusState>;
  // Starts (or restarts, on a changed row list) a one-shot-then-interval poll of every given
  // repoPath's health-first status — like startUpdateHealthPolling, one poll cycle covers every
  // row at once rather than one timer per pane.
  startLogsListedHealthPolling: (repoPaths: readonly string[]) => void;
  stopLogsListedHealthPolling: () => void;
  openLogsFullscreen: (repoPath: string, serviceName: string) => void;
  closeLogsFullscreen: () => void;
  // Resolves repoPath's manifest-declared container and starts (or, if already subscribed,
  // no-ops) a live stream for it — the store action every list-row/pane-becomes-active
  // transition calls (never core/logs directly from a component).
  subscribeLogsPane: (repoPath: string, service: string) => Promise<void>;
  unsubscribeLogsPane: (repoPath: string) => void;
  // Restarts one pane's service through the registry, in `mode` (default: the
  // `logs.restartMode` setting). A call while that pane is already restarting is a no-op —
  // never a second concurrent `docker restart`. After the call resolves, health is re-polled
  // immediately; a failure surfaces inline on the pane while the badge keeps last-known.
  // Availability is not checked here: `R` and the actions menu go through runLogsPane*.
  restartLogsPane: (repoPath: string, mode?: RestartMode) => Promise<void>;
  // The registry's actions for one pane's service (the `a` menu's rows), or null when they
  // could not be listed (restart ports unwired, list error). Never rejects.
  listLogsPaneActions: (repoPath: string) => Promise<ServiceAction[] | null>;
  // Runs one registry action on a pane's service: the list is re-read right before running and
  // fails closed — a now-disabled action does not run and `<label> unavailable — <reason>`
  // becomes the pane notice. Open in IDE (always available) runs without the re-read. Never
  // rejects.
  runLogsPaneAction: (repoPath: string, actionId: string, service: string) => Promise<void>;
  // `R` / `O` on a pane, resolved through the same registry: `restart` maps `logs.restartMode`
  // to its entry (a clean restart disabled only for NO_CLEAN_RECIPE_REASON falls back to the
  // simple one, with NO_CLEAN_RECIPE_NOTICE), `ide` opens in the IDE. Never rejects.
  runLogsPaneShortcut: (repoPath: string, shortcut: LogsPaneShortcut, service: string) => Promise<void>;
  // Opens the pane's service repo in the configured editor (O on a grid pane or fullscreen) —
  // works for container-less services too. A failure surfaces as a one-line pane notice.
  openLogsPaneInIde: (repoPath: string) => void;
  loadOlderLogsPane: (repoPath: string) => Promise<void>;
  // Wipes a pane's buffered/displayed lines (a display "clear", like a shell's `clear`) —
  // the stream itself keeps running, so a new line still appears immediately afterward.
  clearLogsPane: (repoPath: string) => void;
  setLogsPaneScrollOffset: (repoPath: string, offset: number) => void;
  // Tears down every currently-active pane's subscription (killing its docker child process,
  // if any). Normal zone-unmount teardown already stops each pane individually; this is the
  // process-level fallback for an abnormal exit (crash, Ctrl+C, SIGTERM) so a `docker logs -f`
  // child is never orphaned — wired into `process.on('exit'|'SIGINT'|'SIGTERM', ...)` in
  // src/bin/tui.ts.
  stopAllLogsPanes: () => void;

  // The filter-history lists, persisted to state.json — keyed by filterHistoryKeyString's flat
  // encoding of a FilterHistoryKey. In the store (not zone-local) so the Settings screen's
  // clear actions and the Logs zone's recall/grid browser share one source of truth, like
  // splitterRatios in navigation-slice.ts.
  filterHistory: Record<string, string[]>;
  // Hydrates filterHistory from state.json once at AppShell mount, mirroring
  // loadSplitterRatios() — a missing/corrupt file (or an unwired store) silently keeps the
  // empty-object default seeded below.
  loadFilterHistory: () => Promise<void>;
  // Called by the Logs zone on a successful filter-editor commit (Enter, compiles, non-empty)
  // — applies pushFilterHistoryEntry to the exact (scope, mode) list `key` identifies and
  // persists the whole map immediately (no separate save step, like setSplitterRatio).
  commitFilterHistoryEntry: (key: FilterHistoryKey, query: string) => void;
  // "Clear global" only touches the two global lists (text + regex).
  clearGlobalFilterHistory: () => void;
  // "Clear this service" only touches that one service's two lists (text + regex) — every
  // other service and the global lists are untouched.
  clearServiceFilterHistory: (repoPath: string) => void;
  // `:reset` (histories category): empties the in-memory map, bumps the version (so no
  // in-flight load re-applies stale disk data), and resolves only once every already-queued
  // writeFilterHistory has landed — so the reset's own disk write can't be overwritten by a
  // save that was still pending when it ran.
  clearFilterHistoryAndDrainSaves: () => Promise<void>;
};

export function createLogsSlice(deps?: AppStoreDeps): StateCreator<AppState, [], [], LogsSlice> {
  // One manager per store instance — never recreated per-render. `deps` is optional so an
  // unwired `createAppStore()` (tests included) keeps working.
  const logsManager: LogsManager | null = deps ? createLogsManager(deps.docker) : null;

  // The shared persisted-history controller (tui/shared/input-history): hydrate-once, version
  // guard, serialized save chain and await-in-flight-load, written once for filter and command
  // history alike.
  const filterHistoryStore = createPersistedHistoryStore<Record<string, string[]>>(
    deps ? { read: () => deps.state.readFilterHistory(), write: (history) => deps.state.writeFilterHistory(history) } : null,
  );

  // The shared service-actions registry (restart + open-in-IDE), built once from the injected
  // ports. Absent when the restart ports are not wired — open-in-IDE then uses the editor alone.
  const serviceActions: ServiceActions | null =
    deps?.container && deps.restart && deps.editor
      ? createServiceActions({ manifest: deps.manifest, container: deps.container, restart: deps.restart, editor: deps.editor, lock: deps.lock, docker: deps.docker })
      : null;

  // One poll timer per subscribed pane (keyed by repoPath) — started on subscribe,
  // cleared on unsubscribe/stopAll. Never resubscribes the log stream itself.
  const healthPollTimers = new Map<string, ReturnType<typeof setInterval>>();
  // Per-repo in-flight guards: a tick for a repo whose previous poll (probe included) is still
  // awaiting is skipped, so a slow health route never stacks probes. One guard per poll kind,
  // released when that poll stops so a late result of a stopped poll is dropped.
  const paneHealthInFlight = createInFlightGuard();
  const listedHealthInFlight = createInFlightGuard();
  // Container-less rows that still get a real up/down status: they declare a `healthUrl` and a
  // probe is wired. Recorded whenever their manifest loads, so the presence cache can skip the
  // reload for every other container-less row.
  const probeOnlyRows = new Set<string>();
  // A row whose health check is turned off locally stays recorded here: the resolver then reads
  // it as `no-container` on each poll (never probing it), and re-enabling the check needs no
  // resubscribe — the next poll probes it again.
  function recordProbeOnly(repoPath: string, manifest: Manifest): void {
    if (!hasContainer(manifest) && hasHealthUrl(manifest) && deps?.healthProbe !== undefined) {
      probeOnlyRows.add(repoPath);
    } else {
      probeOnlyRows.delete(repoPath);
    }
  }

  return (set, get) => {
    // The status resolver's ports, plus the live per-service health-check toggle — read at
    // every poll, so a change in :settings applies at the next tick.
    const statusPorts = deps
      ? {
          docker: deps.docker,
          ...(deps.healthProbe === undefined ? {} : { healthProbe: deps.healthProbe }),
          isHealthCheckEnabled: healthCheckEnabledFrom(() => get().settings),
        }
      : null;
    // Shared by loadOlderLogsPane and subscribeLogsPane's startWithHistory fetch — both "fetch
    // the next bufferSize older lines and prepend them" over an already-subscribed key,
    // differing only in when they're invoked (a manual scrollback-to-oldest vs. right after a
    // fresh subscription).
    async function loadOlder(repoPath: string, container: string): Promise<void> {
      const pane = get().logsPanes[repoPath];
      if (!pane || !logsManager) {
        return;
      }
      const beforeCount = pane.lines.length;
      const result = await loadOlderLogs({ manager: logsManager, key: repoPath, container });
      const entry = logsManager.getEntry(repoPath);
      set((state) => {
        const current = state.logsPanes[repoPath];
        if (!current) {
          return {};
        }
        const appended = result.ok ? result.data.appended : 0;
        return {
          logsPanes: {
            ...state.logsPanes,
            [repoPath]: {
              ...current,
              lines: entry.lines,
              noMoreHistory: entry.noMoreHistory,
              // Preserves the visible viewport for a pane that already had visible lines — or,
              // for a pane that started genuinely empty, pins to the newest of the just-fetched
              // history instead (see resolvePostLoadScrollOffset).
              scrollOffset: resolvePostLoadScrollOffset(current.scrollOffset, beforeCount, appended, entry.lines.length),
            },
          },
        };
      });
    }

    // One poll cycle for a single pane — resolves the service's health-first status through
    // core/service-status and updates the badge only on success. Any failure (manifest load
    // fails, Docker and the probe both fail) keeps last-known health and never crashes the view.
    // A manifest without `container` marks the pane container-less; unless it declares a probed
    // `healthUrl` (then it gets a real up/down) it records no-container, stops its own timer and
    // never reaches Docker. Skipped while the previous cycle for this repo is still awaiting.
    async function pollPaneHealth(repoPath: string): Promise<void> {
      if (!deps || !statusPorts || !get().logsPanes[repoPath]) {
        return;
      }
      const token = paneHealthInFlight.begin(repoPath);
      if (token === null) {
        return;
      }
      const patchPane = (patch: Partial<LogsPaneData>) =>
        set((state) => {
          const current = state.logsPanes[repoPath];
          if (!current || (Object.keys(patch) as Array<keyof LogsPaneData>).every((key) => current[key] === patch[key])) {
            return {};
          }
          return { logsPanes: { ...state.logsPanes, [repoPath]: { ...current, ...patch } } };
        });
      try {
        const manifestResult = await deps.manifest.load(repoPath);
        if (!manifestResult.ok || !paneHealthInFlight.isCurrent(repoPath, token)) {
          return;
        }
        recordProbeOnly(repoPath, manifestResult.data);
        const containerLess = !hasContainer(manifestResult.data);
        if (containerLess && !probeOnlyRows.has(repoPath)) {
          clearPaneTimer(repoPath);
          patchPane({ health: 'no-container', noContainer: true });
          return;
        }
        const status = await resolveManifestStatus(statusPorts, manifestResult.data);
        if (!status.ok || !paneHealthInFlight.isCurrent(repoPath, token)) {
          return;
        }
        patchPane(containerLess ? { health: status.data.state, noContainer: true } : { health: status.data.state });
      } catch {
        // A port that rejects (against its contract) is a failed poll: keep last-known health.
      } finally {
        paneHealthInFlight.end(repoPath, token);
      }
    }

    function startHealthPolling(repoPath: string): void {
      if (!deps) {
        return;
      }
      if (healthPollTimers.has(repoPath)) {
        return;
      }
      void pollPaneHealth(repoPath);
      const timer = setInterval(() => {
        void pollPaneHealth(repoPath);
      }, LOGS_HEALTH_POLL_INTERVAL_MS);
      // Never keep the process alive for a poll timer alone (tests, abnormal exits).
      const unrefable = timer as unknown as { unref?: () => void };
      if (typeof unrefable.unref === 'function') {
        unrefable.unref();
      }
      healthPollTimers.set(repoPath, timer);
    }

    function clearPaneTimer(repoPath: string): void {
      const timer = healthPollTimers.get(repoPath);
      if (timer !== undefined) {
        clearInterval(timer);
        healthPollTimers.delete(repoPath);
      }
    }

    // Stops a pane's poll: its timer, and its in-flight entry so a late result is dropped.
    function stopHealthPolling(repoPath: string): void {
      clearPaneTimer(repoPath);
      paneHealthInFlight.release(repoPath);
    }

    // One shared poll timer for every currently-listed row (not one per repoPath, unlike the
    // pane timers above) — restarted whenever the listed rows change so a service that
    // appears/disappears is picked up without leaking a stale timer.
    let listedHealthPollTimer: ReturnType<typeof setInterval> | null = null;
    let listedPollingRepoPaths: readonly string[] = [];

    // Resolves one row's container presence without blocking — cached, so a repeated call
    // for an already-known row never reloads its manifest. A failed load leaves the row
    // absent (unknown), never recorded as either answer.
    const pendingPresence = new Set<string>();
    async function resolveContainerPresence(repoPath: string): Promise<void> {
      if (!deps) {
        return;
      }
      if (repoPath in get().logsNoContainer || pendingPresence.has(repoPath)) {
        return;
      }
      pendingPresence.add(repoPath);
      try {
        const manifestResult = await deps.manifest.load(repoPath);
        if (!manifestResult.ok) {
          return;
        }
        // Keyed idempotent write: even a superseded resolve records this path's current
        // manifest truth, and the next polling retarget prunes rows that left the list.
        const withoutContainer = !hasContainer(manifestResult.data);
        recordProbeOnly(repoPath, manifestResult.data);
        set((state) => {
          if (state.logsNoContainer[repoPath] === withoutContainer) {
            return {};
          }
          return { logsNoContainer: { ...state.logsNoContainer, [repoPath]: withoutContainer } };
        });
      } finally {
        pendingPresence.delete(repoPath);
      }
    }

    // One poll cycle for a single listed row — like pollPaneHealth above, but writing the
    // row-health map instead of a pane entry, so badges render for rows that were never
    // subscribed. A manifest without `container` records its presence and, unless it declares a
    // probed `healthUrl`, the no-container health without reaching Docker. Any failure keeps
    // last-known health and never crashes; a tick for a repo still awaiting is skipped.
    async function pollListedRowHealth(repoPath: string): Promise<void> {
      if (!deps || !statusPorts) {
        return;
      }
      // A positively-resolved container-less row with no probed route never reloads its
      // manifest here — the presence cache already answered.
      if (get().logsNoContainer[repoPath] === true && !probeOnlyRows.has(repoPath)) {
        set((state) => {
          if (state.logsListedHealth[repoPath] === 'no-container') {
            return {};
          }
          return { logsListedHealth: { ...state.logsListedHealth, [repoPath]: 'no-container' as const } };
        });
        return;
      }
      const token = listedHealthInFlight.begin(repoPath);
      if (token === null) {
        return;
      }
      try {
        const manifestResult = await deps.manifest.load(repoPath);
        if (!manifestResult.ok) {
          return;
        }
        if (!listedPollingRepoPaths.includes(repoPath) || !listedHealthInFlight.isCurrent(repoPath, token)) {
          return;
        }
        recordProbeOnly(repoPath, manifestResult.data);
        const withoutContainer = !hasContainer(manifestResult.data);
        set((state) => {
          if (state.logsNoContainer[repoPath] === withoutContainer) {
            return {};
          }
          return { logsNoContainer: { ...state.logsNoContainer, [repoPath]: withoutContainer } };
        });
        const status = await resolveManifestStatus(statusPorts, manifestResult.data);
        if (!status.ok) {
          return;
        }
        if (!listedPollingRepoPaths.includes(repoPath) || !listedHealthInFlight.isCurrent(repoPath, token)) {
          return;
        }
        const health = status.data.state;
        set((state) => {
          if (state.logsListedHealth[repoPath] === health) {
            return {};
          }
          return { logsListedHealth: { ...state.logsListedHealth, [repoPath]: health } };
        });
      } catch {
        // A port that rejects (against its contract) is a failed poll: keep last-known health.
      } finally {
        listedHealthInFlight.end(repoPath, token);
      }
    }

    function pollAllListed(repoPaths: readonly string[]): void {
      for (const repoPath of repoPaths) {
        void pollListedRowHealth(repoPath);
      }
    }

    function patchPaneNotice(repoPath: string, notice: string | null): void {
      set((state) => {
        const current = state.logsPanes[repoPath];
        return current ? { logsPanes: { ...state.logsPanes, [repoPath]: { ...current, notice } } } : {};
      });
    }

    function settingsRestartMode(): RestartMode {
      return get().settings.logs.restartMode === 'clean' ? 'clean' : 'simple';
    }

    async function listPaneActions(repoPath: string): Promise<ServiceAction[] | null> {
      if (serviceActions === null) {
        return null;
      }
      const listed = await serviceActions
        .list(repoPath, { blockingLocks: restartBlockingLocks(get().activeEdt) })
        .catch((): Result<ServiceAction[]> => err('internal-error', 'Listing the service actions failed.'));
      return listed.ok ? listed.data : null;
    }

    // Runs one freshly-listed registry entry: a disabled one only shows its reason on the pane.
    async function runEntry(repoPath: string, entry: ServiceAction, service: string, restartNotice?: string): Promise<void> {
      if (!entry.availability.available) {
        patchPaneNotice(repoPath, unavailableNotice(entry.label, entry.availability.reason));
        return;
      }
      if (entry.id === OPEN_IN_IDE_ACTION_ID) {
        get().openLogsPaneInIde(repoPath);
        return;
      }
      const terminalKind = TERMINAL_KINDS[entry.id];
      if (terminalKind !== undefined) {
        await get().openTerminal(repoPath, terminalKind, service);
        return;
      }
      const mode = RESTART_MODES[entry.id];
      if (mode !== undefined) {
        await restartPane(repoPath, mode, restartNotice);
        return;
      }
      patchPaneNotice(repoPath, unavailableNotice(entry.label, 'not supported in Logs'));
    }

    // Re-lists the registry right before running (never trusting a cached availability) and
    // finds `actionId`. Null — with the reason already on the pane, or the pane gone — when
    // nothing should run.
    async function freshEntry(repoPath: string, actionId: string): Promise<{ entry: ServiceAction; fresh: ServiceAction[] } | null> {
      const fresh = await listPaneActions(repoPath);
      if (!get().logsPanes[repoPath]) {
        return null;
      }
      if (fresh === null) {
        patchPaneNotice(repoPath, LOGS_ACTIONS_UNAVAILABLE_NOTICE);
        return null;
      }
      const entry = fresh.find((action) => action.id === actionId);
      if (entry === undefined) {
        patchPaneNotice(repoPath, unavailableNotice(actionId, 'not offered for this service'));
        return null;
      }
      return { entry, fresh };
    }

    // The public actions never reject: an unexpected throw becomes a pane notice.
    async function guarded(repoPath: string, run: () => Promise<void>): Promise<void> {
      try {
        await run();
      } catch {
        patchPaneNotice(repoPath, LOGS_ACTION_FAILED_NOTICE);
      }
    }

    // `fallbackNotice` is shown after a restart that stood in for another one (the `R`
    // clean→simple fallback), next to the streamError when it fails; the restart's own notice
    // wins when it has one.
    async function restartPane(repoPath: string, mode: RestartMode, fallbackNotice?: string): Promise<void> {
      if (!logsManager) {
        return;
      }
      const pane = get().logsPanes[repoPath];
      if (!pane) {
        return;
      }
      // A pane already restarting (requested here, or reported by the health poll) never gets a
      // second concurrent restart; a container-less pane has nothing to restart. Either way the
      // pane says why instead of silently ignoring the key.
      const label = RESTART_LABELS[mode];
      if (pane.restarting || pane.health === 'restarting') {
        patchPaneNotice(repoPath, unavailableNotice(label, 'restart in progress'));
        return;
      }
      if (pane.noContainer === true || pane.health === 'no-container') {
        patchPaneNotice(repoPath, unavailableNotice(label, 'no container'));
        return;
      }
      const patchPane = (patch: Partial<LogsPaneData>) =>
        set((state) => {
          const current = state.logsPanes[repoPath];
          return current ? { logsPanes: { ...state.logsPanes, [repoPath]: { ...current, ...patch } } } : {};
        });
      patchPane({ restarting: true, notice: null, streamError: null });
      const restarted: Result<{ notice?: string }> = serviceActions
        ? await serviceActions
            .restart(repoPath, mode)
            .catch((): Result<{ notice?: string }> => err('internal-error', 'The restart failed unexpectedly.'))
        : err('restart-unavailable', 'No restart ports are wired — cannot restart the service.');
      if (!restarted.ok) {
        // Failure surfaces inline on the pane; the badge keeps last-known health, except a
        // manifest that turned out to declare no container.
        patchPane({
          restarting: false,
          notice: fallbackNotice ?? null,
          ...(restarted.error.code === 'no-container' ? { noContainer: true, health: 'no-container' as const } : {}),
          streamError: { code: restarted.error.code, message: restarted.error.message },
        });
        return;
      }
      patchPane({ restarting: false, streamError: null, notice: restarted.data.notice ?? fallbackNotice ?? null });
      // After the restart call resolves, health is re-polled immediately so the badge
      // reflects the new state.
      await pollPaneHealth(repoPath);
    }

    return {
      logsEdtSelected: [],
      logsOtherSelected: [],
      logsNoContainer: {},
      logsListedHealth: {},
      logsFullscreenTarget: null,
      logsFullscreenServiceName: null,
      logsPanes: {},
      logsVisibility: DEFAULT_VISIBILITY_FLAGS,
      logsGlobalFilter: DEFAULT_LOG_FILTER,
      logsPaneWrap: {},
      logsPaneFilterEngaged: {},
      logsPaneFilters: {},

      setLogsVisibility: (update) => set((state) => ({ logsVisibility: update(state.logsVisibility) })),
      setLogsGlobalFilter: (filter) => set({ logsGlobalFilter: filter }),
      setLogsPaneWrap: (update) => set((state) => ({ logsPaneWrap: update(state.logsPaneWrap) })),
      setLogsPaneFilterEngaged: (update) => set((state) => ({ logsPaneFilterEngaged: update(state.logsPaneFilterEngaged) })),
      setLogsPaneFilters: (update) => set((state) => ({ logsPaneFilters: update(state.logsPaneFilters) })),

      toggleLogsEdtSelection: (repoPath) =>
        set((state) =>
          state.logsEdtSelected.includes(repoPath)
            ? {
                logsEdtSelected: state.logsEdtSelected.filter((candidate) => candidate !== repoPath),
                ...withoutPaneSettings(state, [repoPath]),
              }
            : { logsEdtSelected: [...state.logsEdtSelected, repoPath] },
        ),
      toggleLogsOtherSelection: (repoPath) =>
        set((state) =>
          state.logsOtherSelected.includes(repoPath)
            ? {
                logsOtherSelected: state.logsOtherSelected.filter((candidate) => candidate !== repoPath),
                ...withoutPaneSettings(state, [repoPath]),
              }
            : { logsOtherSelected: [...state.logsOtherSelected, repoPath] },
        ),
      selectAllLogsEdtServices: (repoPaths) =>
        set((state) => ({
          logsEdtSelected: [...repoPaths],
          ...withoutPaneSettings(state, state.logsEdtSelected.filter((path) => !repoPaths.includes(path))),
        })),
      deselectAllLogsEdtServices: () =>
        set((state) => ({ logsEdtSelected: [], ...withoutPaneSettings(state, state.logsEdtSelected) })),
      selectAllLogsOtherServices: (repoPaths) =>
        set((state) => ({
          logsOtherSelected: [...repoPaths],
          ...withoutPaneSettings(state, state.logsOtherSelected.filter((path) => !repoPaths.includes(path))),
        })),
      deselectAllLogsOtherServices: () =>
        set((state) => ({ logsOtherSelected: [], ...withoutPaneSettings(state, state.logsOtherSelected) })),
      resolveLogsContainerPresence: (repoPaths) => {
        for (const repoPath of repoPaths) {
          void resolveContainerPresence(repoPath);
        }
      },
      startLogsListedHealthPolling: (repoPaths) => {
        const wanted = new Set(repoPaths);
        // Rows leaving the list release their in-flight poll (its late result is dropped) and
        // their probe-only mark, like the two maps below.
        for (const path of listedPollingRepoPaths) {
          if (!wanted.has(path)) {
            listedHealthInFlight.release(path);
          }
        }
        for (const path of [...probeOnlyRows]) {
          if (!wanted.has(path)) {
            probeOnlyRows.delete(path);
          }
        }
        listedPollingRepoPaths = [...repoPaths];
        // Stale rows (renamed/unregistered since the last retarget) leave both maps so
        // a removed service can neither badge nor resurface from cache.
        set((state) => {
          const logsNoContainer: Record<string, boolean> = {};
          const logsListedHealth: Record<string, ServiceStatusState> = {};
          for (const path of Object.keys(state.logsNoContainer)) {
            if (wanted.has(path)) {
              logsNoContainer[path] = state.logsNoContainer[path];
            }
          }
          for (const path of Object.keys(state.logsListedHealth)) {
            if (wanted.has(path)) {
              logsListedHealth[path] = state.logsListedHealth[path];
            }
          }
          return { logsNoContainer, logsListedHealth };
        });
        if (listedPollingRepoPaths.length === 0) {
          if (listedHealthPollTimer !== null) {
            clearInterval(listedHealthPollTimer);
            listedHealthPollTimer = null;
          }
          return;
        }
        pollAllListed(listedPollingRepoPaths);
        if (listedHealthPollTimer !== null) {
          clearInterval(listedHealthPollTimer);
        }
        listedHealthPollTimer = setInterval(() => {
          pollAllListed(listedPollingRepoPaths);
        }, LOGS_LISTED_HEALTH_POLL_INTERVAL_MS);
        const unrefable = listedHealthPollTimer as unknown as { unref?: () => void };
        if (typeof unrefable.unref === 'function') {
          unrefable.unref();
        }
      },
      stopLogsListedHealthPolling: () => {
        if (listedHealthPollTimer !== null) {
          clearInterval(listedHealthPollTimer);
          listedHealthPollTimer = null;
        }
        listedPollingRepoPaths = [];
        listedHealthInFlight.releaseAll();
      },
      openLogsFullscreen: (repoPath, serviceName) => set({ logsFullscreenTarget: repoPath, logsFullscreenServiceName: serviceName }),
      // An ad hoc preview of an unselected service leaves no per-service settings behind, like a
      // deselected one.
      closeLogsFullscreen: () =>
        set((state) => {
          const target = state.logsFullscreenTarget;
          const selected = target !== null && (state.logsEdtSelected.includes(target) || state.logsOtherSelected.includes(target));
          return {
            logsFullscreenTarget: null,
            logsFullscreenServiceName: null,
            ...(target !== null && !selected ? withoutPaneSettings(state, [target]) : {}),
          };
        }),

      subscribeLogsPane: async (repoPath, service) => {
        if (!deps || !logsManager) {
          return;
        }
        set((state) => ({
          logsPanes: { ...state.logsPanes, [repoPath]: state.logsPanes[repoPath] ?? emptyPane(repoPath, service) },
        }));
        if (logsManager.isSubscribed(repoPath)) {
          // Already streaming (e.g. a fullscreen preview opened on an already-selected row) —
          // nothing new to start.
          startHealthPolling(repoPath);
          return;
        }
        const manifestResult = await deps.manifest.load(repoPath);
        if (!manifestResult.ok) {
          set((state) => ({
            logsPanes: {
              ...state.logsPanes,
              [repoPath]: {
                ...(state.logsPanes[repoPath] ?? emptyPane(repoPath, service)),
                streamError: { code: manifestResult.error.code, message: manifestResult.error.message },
              },
            },
          }));
          // Health polling starts with the subscription (per pane, on subscribe plus
          // a ~5s interval). Idempotent — a second subscribe for an already-polling pane (e.g.
          // fullscreen opened on an already-selected row) never starts a second timer.
          startHealthPolling(repoPath);
          return;
        }
        if (!hasContainer(manifestResult.data)) {
          // No Docker runtime for this service — the pane degrades explicitly (no
          // subscription, no docker call), and the zone renders it with no restart control.
          // Only a declared, probed `healthUrl` keeps a health timer, for its real up/down.
          recordProbeOnly(repoPath, manifestResult.data);
          const probeOnly = probeOnlyRows.has(repoPath);
          set((state) => {
            const current = state.logsPanes[repoPath] ?? emptyPane(repoPath, service);
            return {
              logsPanes: {
                ...state.logsPanes,
                [repoPath]: { ...current, noContainer: true, ...(probeOnly ? {} : { health: 'no-container' as const }) },
              },
            };
          });
          if (probeOnly) {
            startHealthPolling(repoPath);
          }
          return;
        }
        // Health polling starts with the subscription (per pane, on subscribe plus
        // a ~5s interval). Idempotent — a second subscribe for an already-polling pane (e.g.
        // fullscreen opened on an already-selected row) never starts a second timer.
        startHealthPolling(repoPath);
        const bufferSize = get().settings.logs.bufferSize;
        const mirror = () => {
          const entry = logsManager.getEntry(repoPath);
          set((state) => ({
            logsPanes: {
              ...state.logsPanes,
              [repoPath]: {
                ...(state.logsPanes[repoPath] ?? emptyPane(repoPath, service)),
                lines: entry.lines,
                streamError: entry.streamError,
                noMoreHistory: entry.noMoreHistory,
              },
            },
          }));
        };
        const result = subscribeLogs({
          manager: logsManager,
          key: repoPath,
          container: manifestResult.data.container,
          bufferSize,
          onUpdate: mirror,
        });
        if (!result.ok) {
          set((state) => ({
            logsPanes: {
              ...state.logsPanes,
              [repoPath]: { ...(state.logsPanes[repoPath] ?? emptyPane(repoPath, service)), streamError: result.error },
            },
          }));
          return;
        }
        // Reflects whatever the manager already knows synchronously (in practice still empty
        // for a brand-new subscription, but keeps this action total/idempotent either way).
        mirror();
        // "Start streaming with the most recent history" opts a fresh subscription into the
        // same fetch a manual scrollback-to-oldest (Ctrl+Up in the grid, Up/Down in fullscreen)
        // would trigger, instead of leaving the pane empty until the live tail produces a line.
        // Only reachable past the `isSubscribed` early-return above, so re-selecting an
        // already-streaming pane (or opening fullscreen on one) never re-fetches history.
        if (get().settings.logs.startWithHistory) {
          await loadOlder(repoPath, manifestResult.data.container);
        }
      },

      restartLogsPane: (repoPath, mode) => restartPane(repoPath, mode ?? settingsRestartMode()),

      listLogsPaneActions: (repoPath) => listPaneActions(repoPath),

      runLogsPaneAction: (repoPath, actionId, service) =>
        guarded(repoPath, async () => {
          // Open in IDE is always available: never held up by a failed or slow listing.
          if (actionId === OPEN_IN_IDE_ACTION_ID) {
            get().openLogsPaneInIde(repoPath);
            return;
          }
          if (serviceActions === null) {
            patchPaneNotice(repoPath, LOGS_ACTIONS_UNAVAILABLE_NOTICE);
            return;
          }
          const found = await freshEntry(repoPath, actionId);
          if (found !== null) {
            await runEntry(repoPath, found.entry, service);
          }
        }),

      runLogsPaneShortcut: (repoPath, shortcut, service) =>
        guarded(repoPath, async () => {
          if (shortcut === 'ide') {
            get().openLogsPaneInIde(repoPath);
            return;
          }
          if (serviceActions === null) {
            // Unwired restart ports: restartPane reports why it cannot restart.
            await restartPane(repoPath, settingsRestartMode());
            return;
          }
          const found = await freshEntry(repoPath, RESTART_ACTION_IDS[settingsRestartMode()]);
          if (found === null) {
            return;
          }
          const { availability } = found.entry;
          if (!availability.available && availability.reason === NO_CLEAN_RECIPE_REASON) {
            // A clean restart disabled only for its missing recipe falls back to the simple one
            // (which may itself be disabled: then its own reason shows).
            const simple = found.fresh.find((action) => action.id === RESTART_ACTION_IDS.simple);
            if (simple === undefined) {
              patchPaneNotice(repoPath, unavailableNotice(RESTART_LABELS.simple, 'not offered for this service'));
              return;
            }
            await runEntry(repoPath, simple, service, NO_CLEAN_RECIPE_NOTICE);
            return;
          }
          await runEntry(repoPath, found.entry, service);
        }),

      openLogsPaneInIde: (repoPath) => {
        const patchNotice = (notice: string | null) =>
          set((state) => {
            const current = state.logsPanes[repoPath];
            return current ? { logsPanes: { ...state.logsPanes, [repoPath]: { ...current, notice } } } : {};
          });
        patchNotice(null);
        const ctx = { editorCommand: get().settings.general.editorCommand };
        const opened: Result<void> = serviceActions
          ? serviceActions.openInIde(repoPath, ctx)
          : deps?.editor
            ? openInIde(deps.editor, repoPath, ctx)
            : err('editor-unavailable', 'No editor port is wired — cannot open the repo in an editor.');
        if (!opened.ok) {
          patchNotice(opened.error.message.split('\n')[0] ?? opened.error.message);
        }
      },

      unsubscribeLogsPane: (repoPath) => {
        // The poll timer is cleared on unsubscribe — polling never outlives the pane.
        stopHealthPolling(repoPath);
        if (!logsManager) {
          return;
        }
        unsubscribeLogs({ manager: logsManager, key: repoPath });
        set((state) => {
          if (!(repoPath in state.logsPanes)) {
            return {};
          }
          const next = { ...state.logsPanes };
          delete next[repoPath];
          return { logsPanes: next };
        });
      },

      loadOlderLogsPane: async (repoPath) => {
        if (!deps || !logsManager) {
          return;
        }
        const pane = get().logsPanes[repoPath];
        if (!pane) {
          return;
        }
        const manifestResult = await deps.manifest.load(repoPath);
        if (!manifestResult.ok) {
          // Surface the failure like every other manifest-load failure in this file — a bare
          // return would leave every later scroll-to-edge silently no-oping.
          set((state) => {
            const current = state.logsPanes[repoPath];
            if (!current) {
              return {};
            }
            return {
              logsPanes: {
                ...state.logsPanes,
                [repoPath]: { ...current, streamError: { code: manifestResult.error.code, message: manifestResult.error.message } },
              },
            };
          });
          return;
        }
        if (!hasContainer(manifestResult.data)) {
          // No stream exists for this pane, so there is no older history to fetch either. Its
          // health is left to the poll (a probed `healthUrl` still reads up/down).
          set((state) => {
            const current = state.logsPanes[repoPath];
            if (!current || current.noContainer === true) {
              return {};
            }
            return {
              logsPanes: {
                ...state.logsPanes,
                [repoPath]: { ...current, noContainer: true, ...(probeOnlyRows.has(repoPath) ? {} : { health: 'no-container' as const }) },
              },
            };
          });
          return;
        }
        await loadOlder(repoPath, manifestResult.data.container);
      },

      clearLogsPane: (repoPath) => {
        if (!logsManager) {
          return;
        }
        clearLogs({ manager: logsManager, key: repoPath });
        set((state) => {
          const current = state.logsPanes[repoPath];
          if (!current) {
            return {};
          }
          return { logsPanes: { ...state.logsPanes, [repoPath]: { ...current, lines: [], noMoreHistory: false, scrollOffset: 0 } } };
        });
      },

      setLogsPaneScrollOffset: (repoPath, offset) =>
        set((state) => {
          const current = state.logsPanes[repoPath];
          if (!current) {
            return {};
          }
          const clamped = Math.min(Math.max(offset, 0), Math.max(current.lines.length - 1, 0));
          return { logsPanes: { ...state.logsPanes, [repoPath]: { ...current, scrollOffset: clamped } } };
        }),

      stopAllLogsPanes: () => {
        for (const repoPath of [...healthPollTimers.keys()]) {
          stopHealthPolling(repoPath);
        }
        paneHealthInFlight.releaseAll();
        if (!logsManager) {
          return;
        }
        for (const repoPath of Object.keys(get().logsPanes)) {
          unsubscribeLogs({ manager: logsManager, key: repoPath });
        }
        set({ logsPanes: {} });
      },

      filterHistory: {},
      loadFilterHistory: () => filterHistoryStore.load((history) => set({ filterHistory: history })),
      commitFilterHistoryEntry: (key, query) => {
        filterHistoryStore.mutate(() => {
          const historyKey = filterHistoryKeyString(key);
          const maxSize = get().settings.logs.filterHistorySize;
          const dedupEverywhere = get().settings.logs.filterHistoryDedup;
          set((state) => ({
            filterHistory: {
              ...state.filterHistory,
              [historyKey]: pushHistoryEntry(state.filterHistory[historyKey] ?? [], query, maxSize, dedupEverywhere),
            },
          }));
          return get().filterHistory;
        });
      },
      clearGlobalFilterHistory: () => {
        filterHistoryStore.mutate(() => {
          set((state) => {
            const next = { ...state.filterHistory };
            delete next[filterHistoryKeyString({ scope: 'global', repoPath: null, mode: 'text' })];
            delete next[filterHistoryKeyString({ scope: 'global', repoPath: null, mode: 'regex' })];
            return { filterHistory: next };
          });
          return get().filterHistory;
        });
      },
      clearFilterHistoryAndDrainSaves: () => filterHistoryStore.resetAndDrain(() => set({ filterHistory: {} })),
      clearServiceFilterHistory: (repoPath) => {
        filterHistoryStore.mutate(() => {
          set((state) => {
            const next = { ...state.filterHistory };
            delete next[filterHistoryKeyString({ scope: 'pane', repoPath, mode: 'text' })];
            delete next[filterHistoryKeyString({ scope: 'pane', repoPath, mode: 'regex' })];
            return { filterHistory: next };
          });
          return get().filterHistory;
        });
      },
    };
  };
}
