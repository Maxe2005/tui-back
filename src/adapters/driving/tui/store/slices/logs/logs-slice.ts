// tui/store/slices: Logs zone state — the selected services in both left-panel lists, the ad
// hoc fullscreen preview target, and the per-pane buffer/error/scroll/health state. The ring
// buffer itself lives in core/logs' LogsManager (one per store, in memory only); `logsPanes`
// is a mirror kept in sync via `onUpdate` so React re-renders, never a second source of truth.
// Also owns the persisted filter-history lists, the persisted rule lists and the rule-set library.
//
// This file only composes the slice: it builds the per-store context once per
// `createLogsSlice(deps)` call and spreads the sub-creators (filters, panes, health, actions).
// Every symbol it used to export is re-exported from here.
import type { StateCreator } from 'zustand';
import { createLogsManager, type LogsManager } from '../../../../../../core/logs/index.js';
import { createServiceActions, type ServiceActions } from '../../../../../../core/runtime/service-actions/index.js';
import {
  readRuleLists,
  readRuleSets,
  type StoredRuleLists,
  type StoredRuleSet,
} from '../../../../../../core/logs/rule-sets.js';
import { err, ok } from '../../../../../../core/result.js';
import { createPersistedHistoryStore } from '../../../shared/input-history/index.js';
import { createInFlightGuard } from '../../../shared/hooks/in-flight-guard.js';
import type { AppState, AppStoreDeps } from '../../app-store.js';
import { createLogsServiceActions } from './logs-slice.actions.js';
import { createLogsFilterActions } from './logs-slice.filters.js';
import { createLogsHealth } from './logs-slice.health.js';
import { createLogsPaneActions } from './logs-slice.panes.js';
import type { LogsSlice, LogsSliceContext } from './logs-slice.types.js';

export {
  LOGS_ACTION_FAILED_NOTICE,
  LOGS_ACTIONS_UNAVAILABLE_NOTICE,
  LOGS_HEALTH_POLL_INTERVAL_MS,
  LOGS_LISTED_HEALTH_POLL_INTERVAL_MS,
  unavailableNotice,
  type LogsPaneData,
  type LogsPaneErrorState,
  type LogsPaneShortcut,
  type LogsSlice,
} from './logs-slice.types.js';

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

  // The same controller sequences the rule lists and the library. The read wrappers sanitize what
  // state.json holds and report what they had to drop through `logsRulesWarning`.
  const loadWarnings: { rules: string[]; sets: string[] } = { rules: [], sets: [] };
  // A field whose last read failed is never overwritten blindly: the next write first re-reads it
  // and only proceeds once the file is readable again.
  const unreadable = { rules: false, sets: false };
  const rulesStore = createPersistedHistoryStore<StoredRuleLists>(
    deps
      ? {
          read: async () => {
            const result = await readRuleLists(deps.state);
            unreadable.rules = !result.ok;
            loadWarnings.rules = result.ok ? result.data.warnings : [`logRules: could not be read — ${result.error.message}`];
            return ok(result.ok ? result.data.value : null);
          },
          write: async (lists) => {
            if (unreadable.rules) {
              const probe = await deps.state.readLogRules();
              if (!probe.ok) {
                return err(probe.error.code, probe.error.message);
              }
              unreadable.rules = false;
            }
            return deps.state.writeLogRules(lists);
          },
        }
      : null,
  );
  const ruleSetsStore = createPersistedHistoryStore<StoredRuleSet[]>(
    deps
      ? {
          read: async () => {
            const result = await readRuleSets(deps.state);
            unreadable.sets = !result.ok;
            loadWarnings.sets = result.ok ? result.data.warnings : [`logRuleSets: could not be read — ${result.error.message}`];
            return ok(result.ok ? result.data.value : null);
          },
          write: async (sets) => {
            if (unreadable.sets) {
              const probe = await deps.state.readLogRuleSets();
              if (!probe.ok) {
                return err(probe.error.code, probe.error.message);
              }
              unreadable.sets = false;
            }
            return deps.state.writeLogRuleSets(sets);
          },
        }
      : null,
  );

  // The shared service-actions registry (restart + open-in-IDE), built once from the injected
  // ports. Absent when the restart ports are not wired — open-in-IDE then uses the editor alone.
  const serviceActions: ServiceActions | null =
    deps?.container && deps.restart && deps.editor
      ? createServiceActions({ manifest: deps.manifest, container: deps.container, restart: deps.restart, editor: deps.editor, lock: deps.lock, docker: deps.docker })
      : null;

  // Held in closure, never in Zustand state; shared by reference with every sub-creator.
  const ctx: LogsSliceContext = {
    deps,
    logsManager,
    filterHistoryStore,
    rulesStore,
    ruleSetsStore,
    loadWarnings,
    serviceActions,
    healthPollTimers: new Map(),
    paneHealthInFlight: createInFlightGuard(),
    listedHealthInFlight: createInFlightGuard(),
    probeOnlyRows: new Set(),
    pendingPresence: new Set(),
    listedHealthPollTimer: null,
    listedPollingRepoPaths: [],
  };
  return (set, get) => {
    const health = createLogsHealth(ctx, set, get);
    return {
      ...createLogsPaneActions(ctx, set, get, health.helpers),
      ...health.actions,
      ...createLogsFilterActions(ctx, set, get),
      ...createLogsServiceActions(ctx, set, get, health.helpers),
    };
  };
}
