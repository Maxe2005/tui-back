// tui/zones/logs: logs-zone.editor-actions — the filter editor's state transitions: opening it,
// reading/updating the scope it edits, history recall helpers, rule-set apply/save and rule-draft
// commit. Plain functions rebuilt each render over the zone's state, like the original closures.
import { applyRuleSet } from '../../../../../core/logs/rule-sets.js';
import {
  addLogRule,
  backToRuleListState,
  decodeFilterHistoryEntry,
  DEFAULT_LOG_FILTER,
  encodeFilterHistoryEntry,
  filterHistoryKeyString,
  MAX_LOG_FILTER_RULES,
  openFilterEditorState,
  replaceLogRule,
  setPaneLogFilter,
  validateRuleDraft,
  type FilterEditorState,
  type FilterHistoryBrowseResult,
  type FilterHistoryKey,
  type LogFilterScope,
} from './logs-zone.logic.js';
import type { LogsState } from './hooks/use-logs-state.js';
import type { LogsDerived } from './hooks/use-logs-derived.js';

export function createEditorActions(s: LogsState & LogsDerived) {
  const {
    dismissRulesWarning,
    setFilterEditor,
    setHistoryGridCursor,
    activeRepoPaths,
    logsFullscreenTarget,
    setGlobalFilter,
    setPaneFilters,
    filterHistory,
    ruleSets,
    saveRuleSetAction,
    commitFilterHistoryEntry,
    currentScopeOf,
  } = s;

  // Opens the filter-editor modal on its rule list — `/` (global, any Logs-zone focus) or `f`
  // (pane, sub-focused grid pane / fullscreen only). The list shows the scope's committed rules.
  function openGlobalFilterEditor(): void {
    dismissRulesWarning();
    setFilterEditor(openFilterEditorState('global', null));
    setHistoryGridCursor(null);
  }
  function openPaneFilterEditor(repoPath: string): void {
    dismissRulesWarning();
    setFilterEditor(openFilterEditorState('pane', repoPath));
    setHistoryGridCursor(null);
  }

  // Whether the pane a pane-scope editor targets is still shown (selected, or the fullscreen one).
  function isPaneScopeLive(editor: FilterEditorState): boolean {
    return editor.repoPath !== null && (activeRepoPaths.includes(editor.repoPath) || logsFullscreenTarget === editor.repoPath);
  }
  // Applies `update` to the scope's latest stored value (never a render-time copy). `update`
  // returns null to refuse; the result says whether the change was applied.
  function updateScopeOf(editor: FilterEditorState, update: (scope: LogFilterScope) => LogFilterScope | null): boolean {
    let applied = false;
    const run = (scope: LogFilterScope): LogFilterScope => {
      const next = update(scope);
      if (next === null) {
        return scope;
      }
      applied = true;
      return next;
    };
    if (editor.scope === 'global') {
      setGlobalFilter(run);
      return applied;
    }
    const repoPath = editor.repoPath;
    if (repoPath === null || !isPaneScopeLive(editor)) {
      return false;
    }
    setPaneFilters((current) => {
      const previous = current[repoPath] ?? DEFAULT_LOG_FILTER;
      const next = run(previous);
      return next === previous ? current : setPaneLogFilter(current, repoPath, next);
    });
    return applied;
  }

  // The exact (scope, mode) history list backing the open editor — recomputed live off the
  // store's `filterHistory`, never cached locally, so a commit is immediately visible to the next
  // arrow-recall/grid open.
  function historyForEditor(editor: FilterEditorState): string[] {
    const key: FilterHistoryKey = { scope: editor.scope, repoPath: editor.repoPath, mode: editor.mode };
    return filterHistory[filterHistoryKeyString(key)] ?? [];
  }

  // Browse results carry the draft as an encoded history entry (query + action + target); this
  // spreads it back onto the editor state.
  function withBrowseResult(editor: FilterEditorState, result: FilterHistoryBrowseResult): FilterEditorState {
    const decoded = decodeFilterHistoryEntry(result.query);
    return {
      ...editor,
      query: decoded.query,
      cursor: decoded.query.length,
      action: decoded.action,
      target: decoded.target,
      browsing: result.browsing,
    };
  }

  // Snapping back out of a browse restores the saved draft's action/target too; an untouched
  // draft keeps its own.
  function snapBackDraft(editor: FilterEditorState): Pick<FilterEditorState, 'query' | 'cursor' | 'action' | 'target'> {
    if (editor.browsing === null) {
      return { query: editor.query, cursor: editor.cursor, action: editor.action, target: editor.target };
    }
    const decoded = decodeFilterHistoryEntry(editor.browsing.savedDraft);
    return { query: decoded.query, cursor: decoded.query.length, action: decoded.action, target: decoded.target };
  }

  // The rule draft is only validated here (inline error, live); it enters the list on Enter.
  function applyFilterEditorDraft(next: FilterEditorState): void {
    setFilterEditor({ ...next, error: validateRuleDraft(next) });
  }

  // Back to the rule list from the rule editor, draft discarded.
  function backToRuleList(editor: FilterEditorState, listCursor: number, notice: string | null = null): void {
    setFilterEditor({ ...editor, view: 'list', listCursor, ruleIndex: null, error: null, notice, confirmClear: false, browsing: null });
    setHistoryGridCursor(null);
  }

  // Replaces the scope's active list with a copy of a set's rules and returns to the list.
  function applySetToScope(editor: FilterEditorState, index: number): void {
    const applied = applyRuleSet(ruleSets, index);
    if (!applied.ok) {
      setFilterEditor({ ...editor, setConfirm: null, error: applied.error.message });
      return;
    }
    const name = ruleSets[index]?.name ?? '';
    const rules = applied.data.map((rule) => ({ ...rule }));
    if (!updateScopeOf(editor, (current) => ({ ...current, rules }))) {
      setFilterEditor(null);
      setHistoryGridCursor(null);
      return;
    }
    setFilterEditor(backToRuleListState(editor, `Applied set "${name}".`, 0));
  }

  // Saves the active list as a set. A name already in the library asks before overwriting.
  function saveActiveRulesAs(editor: FilterEditorState, overwrite: boolean): void {
    const saved = saveRuleSetAction(editor.name, currentScopeOf(editor).rules, { overwrite });
    if (saved.ok) {
      setFilterEditor(backToRuleListState(editor, `Saved set "${editor.name.trim()}".`));
    } else if (saved.error.code === 'rule-set-exists') {
      setFilterEditor({ ...editor, setConfirm: { kind: 'overwrite', name: editor.name.trim() }, error: null });
    } else {
      setFilterEditor({ ...editor, setConfirm: null, error: saved.error.message });
    }
  }

  // Enter in the rule editor: an invalid or empty draft is refused inline and never enters the
  // list; a valid one is added/replaced, recorded in the (scope, mode) history, and the editor
  // returns to the list.
  function commitRuleDraft(editor: FilterEditorState): void {
    if (editor.error !== null) {
      return;
    }
    if (editor.query === '') {
      setFilterEditor({ ...editor, error: 'Enter a query for this rule.' });
      return;
    }
    const rule = { mode: editor.mode, query: editor.query, action: editor.action, target: editor.target };
    let listCursor = 0;
    let refusal: 'full' | null = null;
    const applied = updateScopeOf(editor, (scope) => {
      if (editor.ruleIndex === null) {
        const next = addLogRule(scope, { ...rule, enabled: true });
        if (next === null) {
          refusal = 'full';
          return null;
        }
        listCursor = scope.rules.length;
        return next;
      }
      const existing = scope.rules[editor.ruleIndex];
      if (existing === undefined) {
        return null;
      }
      listCursor = editor.ruleIndex;
      return replaceLogRule(scope, editor.ruleIndex, { ...rule, enabled: existing.enabled });
    });
    if (!applied) {
      if (refusal === 'full') {
        backToRuleList(editor, MAX_LOG_FILTER_RULES - 1, `Rule limit reached (${MAX_LOG_FILTER_RULES}) — delete one to add another.`);
      } else {
        // The rule or the pane is gone: nothing to save into.
        setFilterEditor(null);
        setHistoryGridCursor(null);
      }
      return;
    }
    commitFilterHistoryEntry(
      { scope: editor.scope, repoPath: editor.repoPath, mode: editor.mode },
      encodeFilterHistoryEntry(editor),
    );
    backToRuleList(editor, listCursor);
  }

  return {
    openGlobalFilterEditor,
    openPaneFilterEditor,
    isPaneScopeLive,
    updateScopeOf,
    historyForEditor,
    withBrowseResult,
    snapBackDraft,
    applyFilterEditorDraft,
    backToRuleList,
    applySetToScope,
    saveActiveRulesAs,
    commitRuleDraft,
  };
}

export type LogsEditorActions = ReturnType<typeof createEditorActions>;
