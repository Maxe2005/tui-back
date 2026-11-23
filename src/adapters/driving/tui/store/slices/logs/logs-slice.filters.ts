// tui/store/slices: the Logs slice's display filters and their persistence — visibility flags,
// global/per-service filters, wrap, the persisted filter history, and the persisted rule lists
// and rule-set library.
import { GLOBAL_RULES_KEY, deleteRuleSet, renameRuleSet, saveRuleSet, type StoredRuleLists, type StoredRuleSet } from '../../../../../../core/logs/rule-sets.js';
import { ok, type Result } from '../../../../../../core/result.js';
import { pushHistoryEntry } from '../../../shared/input-history/index.js';
import {
  DEFAULT_LOG_FILTER,
  DEFAULT_VISIBILITY_FLAGS,
  filterHistoryKeyString,
  setPaneLogFilter,
} from '../../../zones/logs/logic/logs-zone.logic.js';
import {
  persistedRuleLists,
  summarizeRulesWarnings,
  type LogsSlice,
  type LogsSliceContext,
  type LogsSliceGet,
  type LogsSliceSet,
} from './logs-slice.types.js';

export function createLogsFilterActions(
  ctx: LogsSliceContext,
  set: LogsSliceSet,
  get: LogsSliceGet,
): Pick<
  LogsSlice,
  | 'logsVisibility'
  | 'logsGlobalFilter'
  | 'logsPaneWrap'
  | 'logsPaneFilterEngaged'
  | 'logsPaneFilters'
  | 'logsRuleSets'
  | 'logsRulesWarning'
  | 'setLogsVisibility'
  | 'setLogsGlobalFilter'
  | 'setLogsPaneWrap'
  | 'setLogsPaneFilterEngaged'
  | 'setLogsPaneFilters'
  | 'filterHistory'
  | 'loadFilterHistory'
  | 'commitFilterHistoryEntry'
  | 'clearGlobalFilterHistory'
  | 'clearServiceFilterHistory'
  | 'clearFilterHistoryAndDrainSaves'
  | 'dismissLogsRulesWarning'
  | 'loadLogsRules'
  | 'saveLogsRuleSet'
  | 'renameLogsRuleSet'
  | 'deleteLogsRuleSet'
  | 'clearLogsRuleSets'
  | 'clearLogsScopeRules'
  | 'clearLogsRulesAndDrainSaves'
> {
  const { filterHistoryStore, rulesStore, ruleSetsStore, loadWarnings } = ctx;
  // Writes the active rule lists when (and only when) a change touched their rules — level
  // changes, selection and engagement never cause a write.
  const persistRuleListsIfChanged = (before: StoredRuleLists): void => {
    if (JSON.stringify(persistedRuleLists(get())) !== JSON.stringify(before)) {
      rulesStore.mutate(() => persistedRuleLists(get()));
    }
  };
  const publishRulesWarning = (): void => {
    set({ logsRulesWarning: summarizeRulesWarnings([...loadWarnings.rules, ...loadWarnings.sets]) });
  };
  // Applies a library operation: the new library lands in the store at once (the UI answers
  // synchronously) and is persisted. If the hydration read replaced the library in between, the
  // operation is replayed on what that read brought in, so neither side is lost.
  const mutateRuleSets = (op: (library: readonly StoredRuleSet[]) => Result<StoredRuleSet[]>): Result<void> => {
    const result = op(get().logsRuleSets);
    if (!result.ok) {
      return result;
    }
    const optimistic = result.data;
    set({ logsRuleSets: optimistic });
    ruleSetsStore.mutate(() => {
      let library = get().logsRuleSets;
      if (library !== optimistic) {
        const replayed = op(library);
        if (replayed.ok) {
          library = replayed.data;
          set({ logsRuleSets: library });
        }
      }
      return library;
    });
    return ok(undefined);
  };

  return {
    logsVisibility: DEFAULT_VISIBILITY_FLAGS,
    logsGlobalFilter: DEFAULT_LOG_FILTER,
    logsPaneWrap: {},
    logsPaneFilterEngaged: {},
    logsPaneFilters: {},
    logsRuleSets: [],
    logsRulesWarning: null,

    setLogsVisibility: (update) => set((state) => ({ logsVisibility: update(state.logsVisibility) })),
    setLogsGlobalFilter: (filter) => {
      const before = persistedRuleLists(get());
      set((state) => ({ logsGlobalFilter: typeof filter === 'function' ? filter(state.logsGlobalFilter) : filter }));
      persistRuleListsIfChanged(before);
    },
    setLogsPaneWrap: (update) => set((state) => ({ logsPaneWrap: update(state.logsPaneWrap) })),
    setLogsPaneFilterEngaged: (update) => set((state) => ({ logsPaneFilterEngaged: update(state.logsPaneFilterEngaged) })),
    setLogsPaneFilters: (update) => {
      const before = persistedRuleLists(get());
      set((state) => ({ logsPaneFilters: update(state.logsPaneFilters) }));
      persistRuleListsIfChanged(before);
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

    dismissLogsRulesWarning: () => set({ logsRulesWarning: null }),
    loadLogsRules: async () => {
      loadWarnings.rules = [];
      loadWarnings.sets = [];
      await Promise.all([
        rulesStore.load((lists) =>
          set((state) => {
            // Never overwrite a scope the user already edited while the read was in flight.
            const paneFilters = { ...state.logsPaneFilters };
            for (const [key, rules] of Object.entries(lists)) {
              if (key !== GLOBAL_RULES_KEY && (paneFilters[key]?.rules.length ?? 0) === 0) {
                paneFilters[key] = { level: paneFilters[key]?.level ?? null, rules };
              }
            }
            const globalRules = lists[GLOBAL_RULES_KEY];
            return {
              logsPaneFilters: paneFilters,
              ...(globalRules !== undefined && state.logsGlobalFilter.rules.length === 0
                ? { logsGlobalFilter: { ...state.logsGlobalFilter, rules: globalRules } }
                : {}),
            };
          }),
        ),
        ruleSetsStore.load((sets) => set({ logsRuleSets: sets })),
      ]);
      publishRulesWarning();
    },
    saveLogsRuleSet: (name, rules, options) => mutateRuleSets((library) => saveRuleSet(library, name, rules, options)),
    renameLogsRuleSet: (index, name) => mutateRuleSets((library) => renameRuleSet(library, index, name)),
    deleteLogsRuleSet: (index) => mutateRuleSets((library) => deleteRuleSet(library, index)),
    clearLogsRuleSets: () => {
      mutateRuleSets(() => ok([]));
    },
    clearLogsScopeRules: (scopeKey) => {
      const before = persistedRuleLists(get());
      set((state) => {
        if (scopeKey === GLOBAL_RULES_KEY) {
          return { logsGlobalFilter: { ...state.logsGlobalFilter, rules: [] } };
        }
        return { logsPaneFilters: setPaneLogFilter(state.logsPaneFilters, scopeKey, state.logsPaneFilters[scopeKey] === undefined ? null : { ...state.logsPaneFilters[scopeKey], rules: [] }) };
      });
      persistRuleListsIfChanged(before);
    },
    clearLogsRulesAndDrainSaves: async () => {
      const clearLive = () =>
        set((state) => ({
          logsRuleSets: [],
          logsGlobalFilter: { ...state.logsGlobalFilter, rules: [] },
          logsPaneFilters: Object.fromEntries(
            Object.entries(state.logsPaneFilters)
              .map(([path, scope]) => [path, { ...scope, rules: [] }] as const)
              .filter(([, scope]) => scope.level !== null),
          ),
        }));
      await Promise.all([rulesStore.resetAndDrain(clearLive), ruleSetsStore.resetAndDrain(() => {})]);
    },
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
}
