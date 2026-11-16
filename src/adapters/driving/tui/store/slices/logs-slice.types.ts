// tui/store/slices: shared types, constants and pure helpers of the Logs slice, plus the
// per-store context its sub-creators share. Kept free of any import from logs-slice.ts so the
// sub-creators never form an import cycle with the composing slice.
import type { StateCreator } from 'zustand';
import type { LogsManager } from '../../../../../core/logs/index.js';
import type { LogLine } from '../../../../../core/ports/docker.js';
import type { Manifest } from '../../../../../core/ports/manifest.js';
import { hasContainer, hasHealthUrl, type ServiceStatusState } from '../../../../../core/service-status/index.js';
import type { RestartMode, ServiceAction, ServiceActions } from '../../../../../core/service-actions/index.js';
import type { Result } from '../../../../../core/result.js';
import { GLOBAL_RULES_KEY, type StoredLogRule, type StoredRuleLists, type StoredRuleSet } from '../../../../../core/logs/rule-sets.js';
import type { PersistedHistoryStore } from '../../shared/input-history/index.js';
import type { InFlightGuard } from '../../shared/poll/in-flight-guard.js';
import type { FilterHistoryKey, LogFilterRule, LogFilterScope, VisibilityFlags } from '../../zones/logs/logs-zone.logic.js';
import type { AppState, AppStoreDeps } from '../app-store.js';

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

// Drops every per-service display setting (wrap, level restriction, global-filter engagement) for
// the given repoPaths — what deselecting a service resets, so re-selecting it starts from the
// defaults. The service's rule list is kept (it is persisted and only an explicit clear erases
// it), and the global settings (visibility flags, global filter) are never touched here.
export function withoutPaneSettings(state: AppState, repoPaths: readonly string[]): Partial<AppState> {
  const drop = new Set(repoPaths);
  const omit = <T>(record: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(record).filter(([path]) => !drop.has(path)));
  const paneFilters: Record<string, LogFilterScope> = {};
  for (const [path, scope] of Object.entries(state.logsPaneFilters)) {
    if (!drop.has(path)) {
      paneFilters[path] = scope;
    } else if (scope.rules.length > 0) {
      paneFilters[path] = { level: null, rules: scope.rules };
    }
  }
  return {
    logsPaneWrap: omit(state.logsPaneWrap),
    logsPaneFilterEngaged: omit(state.logsPaneFilterEngaged),
    logsPaneFilters: paneFilters,
  };
}

// The persisted shape of every scope's active rule list: `global` plus one entry per repoPath
// (selected or not), empty lists left out. The level restriction is never part of it.
export function persistedRuleLists(state: Pick<AppState, 'logsGlobalFilter' | 'logsPaneFilters'>): StoredRuleLists {
  const lists: StoredRuleLists = {};
  const copy = (rules: readonly LogFilterRule[]): StoredLogRule[] => rules.map((rule) => ({ ...rule }));
  if (state.logsGlobalFilter.rules.length > 0) {
    lists[GLOBAL_RULES_KEY] = copy(state.logsGlobalFilter.rules);
  }
  for (const [path, scope] of Object.entries(state.logsPaneFilters)) {
    if (scope.rules.length > 0) {
      lists[path] = copy(scope.rules);
    }
  }
  return lists;
}

export function summarizeRulesWarnings(warnings: readonly string[]): string | null {
  if (warnings.length === 0) {
    return null;
  }
  const more = warnings.length > 1 ? ` (+${warnings.length - 1} more)` : '';
  // Warnings can carry stored text (a regex, a set name): keep the line single and printable.
  return `Saved filter rules: ${warnings[0].replace(/[\u0000-\u001f\u007f]+/g, ' ')}${more}`;
}

export function emptyPane(repoPath: string, service: string): LogsPaneData {
  return { repoPath, service, lines: [], streamError: null, noMoreHistory: false, scrollOffset: 0, health: 'down', restarting: false, notice: null };
}

// Per-pane health poll cadence — on subscribe plus an interval, cleared on unsubscribe. Never
// resubscribes the log stream itself.
export const LOGS_HEALTH_POLL_INTERVAL_MS = 5000;
// Listed-row health poll cadence — one shared timer covering every listed row (mirroring
// update-slice.health.ts), not one timer per pane. Same 5s by convention, not by coupling.
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

export const RESTART_LABELS: Record<RestartMode, string> = { simple: 'Restart', clean: 'Clean restart' };

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
  // Display settings of the Logs tab, kept in the store so they survive switching tabs and coming
  // back. Only the rule lists inside the two filters are also written to disk (see the persisted
  // rules below); everything else is lost on closing the tool.
  // Global ones: the t/o/p visibility flags and the global filter. Per-service ones, keyed by
  // repoPath: wrap, global-filter engagement, own filter — all dropped when the service is
  // deselected (its rule list excepted), so re-selecting it starts fresh while the global ones
  // stay applied.
  logsVisibility: VisibilityFlags;
  logsGlobalFilter: LogFilterScope;
  logsPaneWrap: Record<string, boolean>;
  logsPaneFilterEngaged: Record<string, boolean>;
  logsPaneFilters: Record<string, LogFilterScope>;
  setLogsVisibility: (update: (current: VisibilityFlags) => VisibilityFlags) => void;
  setLogsGlobalFilter: (filter: LogFilterScope | ((current: LogFilterScope) => LogFilterScope)) => void;
  setLogsPaneWrap: (update: (current: Record<string, boolean>) => Record<string, boolean>) => void;
  setLogsPaneFilterEngaged: (update: (current: Record<string, boolean>) => Record<string, boolean>) => void;
  setLogsPaneFilters: (update: (current: Record<string, LogFilterScope>) => Record<string, LogFilterScope>) => void;
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

  // Persisted filter rules. Every scope's active list (global, per service) is written to
  // state.json whenever its rules change (the level restriction stays in memory only); the named
  // sets live in `logsRuleSets`. A service's persisted list survives its deselection, and lists of
  // services that are no longer registered stay in the file untouched.
  logsRuleSets: StoredRuleSet[];
  // One line naming what could not be restored from state.json (an uncompilable rule, a corrupt
  // value) — null when the load was clean or the warning was dismissed.
  logsRulesWarning: string | null;
  dismissLogsRulesWarning: () => void;
  // Hydrates the rule lists and the library from state.json (AppShell mount, and again after `:reset`).
  loadLogsRules: () => Promise<void>;
  saveLogsRuleSet: (name: string, rules: readonly LogFilterRule[], options?: { overwrite?: boolean }) => Result<void>;
  renameLogsRuleSet: (index: number, name: string) => Result<void>;
  deleteLogsRuleSet: (index: number) => Result<void>;
  // `:settings` — deletes the whole library; active lists are untouched.
  clearLogsRuleSets: () => void;
  // `:settings` — empties one scope's persisted list (GLOBAL_RULES_KEY or a repoPath), live too;
  // its level restriction and every other scope are untouched.
  clearLogsScopeRules: (scopeKey: string) => void;
  // `:reset` — empties every list and the library, resolving once queued saves have landed.
  clearLogsRulesAndDrainSaves: () => Promise<void>;
};

export type LogsSliceSet = Parameters<StateCreator<AppState, [], [], LogsSlice>>[0];
export type LogsSliceGet = Parameters<StateCreator<AppState, [], [], LogsSlice>>[1];

// The closure state the Logs sub-creators share. Created once per `createLogsSlice(deps)` call
// (never at module level), so every store keeps its own manager, timers and caches; sub-creators
// read and write the mutable fields by reference. Never in Zustand state.
export interface LogsSliceContext {
  deps: AppStoreDeps | undefined;
  // One manager per store instance — never recreated per-render. Null for an unwired store.
  logsManager: LogsManager | null;
  // The shared persisted-history controllers (tui/shared/input-history): hydrate-once, version
  // guard, serialized save chain and await-in-flight-load.
  filterHistoryStore: PersistedHistoryStore<Record<string, string[]>>;
  rulesStore: PersistedHistoryStore<StoredRuleLists>;
  ruleSetsStore: PersistedHistoryStore<StoredRuleSet[]>;
  // What the rule/library reads had to drop, reported through `logsRulesWarning`.
  loadWarnings: { rules: string[]; sets: string[] };
  // The shared service-actions registry; null when the restart ports are not wired.
  serviceActions: ServiceActions | null;
  // One poll timer per subscribed pane (keyed by repoPath).
  healthPollTimers: Map<string, ReturnType<typeof setInterval>>;
  // Per-repo in-flight guards, one per poll kind, released when that poll stops.
  paneHealthInFlight: InFlightGuard;
  listedHealthInFlight: InFlightGuard;
  // Container-less rows that still get a real up/down status (a probed `healthUrl`).
  probeOnlyRows: Set<string>;
  // Rows whose container presence is being resolved right now.
  pendingPresence: Set<string>;
  // One shared poll timer for every currently-listed row, restarted whenever the rows change.
  listedHealthPollTimer: ReturnType<typeof setInterval> | null;
  listedPollingRepoPaths: readonly string[];
}

// Records whether a row is probe-only. A row whose health check is turned off locally stays
// recorded: the resolver then reads it as `no-container` on each poll (never probing it), and
// re-enabling the check needs no resubscribe — the next poll probes it again.
export function recordProbeOnly(ctx: LogsSliceContext, repoPath: string, manifest: Manifest): void {
  if (!hasContainer(manifest) && hasHealthUrl(manifest) && ctx.deps?.healthProbe !== undefined) {
    ctx.probeOnlyRows.add(repoPath);
  } else {
    ctx.probeOnlyRows.delete(repoPath);
  }
}
