// tui/zones/logs: filter history encoding and filter-editor / rule-set dialog state builders.
import type { FooterContextId } from '../../../keybindings/index.js';
import type { HistoryBrowseState } from '../../../shared/input-history/index.js';
import type { LogFilterMode, LogFilterAction, LogFilterTarget, LogFilterRule } from './logs-zone.filter.logic.js';
import { compileLogFilter, ruleDraftOf, isDefaultActionTarget, formatFilterActionTarget } from './logs-zone.filter.logic.js';

// Filter history recall. Each exact (scope, mode) combination — global-text, global-regex, and
// per-service-text/per-service-regex for every manifest service path — owns its own independent,
// persisted list of committed query strings. `repoPath` is only meaningful for `scope: 'pane'`.
export type FilterHistoryKey = { scope: 'global' | 'pane'; repoPath: string | null; mode: LogFilterMode };

// The flat string key StatePort.readFilterHistory/writeFilterHistory persists each list under
// (mirrors splitterRatios' own "keyed by a plain string, the driving layer resolves the
// encoding" convention — core/ports/state.ts has no notion of "scope"/"mode"/repoPath). Global
// scope ignores repoPath entirely; pane scope always carries one (openPaneFilterEditor in
// logs-zone.tsx never opens a pane editor without one).
export function filterHistoryKeyString(key: FilterHistoryKey): string {
  return key.scope === 'global' ? `global:${key.mode}` : `service:${key.repoPath}:${key.mode}`;
}

// History entries stay plain strings so older state files load unchanged and the shared
// input-history primitive keeps working as is. A show+line entry is the bare query (exactly what
// earlier versions wrote); any other action/target is the query behind a control-character
// header, so equality of two entries means equality of query, action and target.
const HISTORY_HEADER = '\u001f';

const HISTORY_HEADER_PATTERN = /^\u001f(show|hide):(line|match)\u001f/;

export type FilterHistoryEntry = { query: string; action: LogFilterAction; target: LogFilterTarget };

export function encodeFilterHistoryEntry(entry: FilterHistoryEntry): string {
  return isDefaultActionTarget(entry.action, entry.target) && !HISTORY_HEADER_PATTERN.test(entry.query)
    ? entry.query
    : `${HISTORY_HEADER}${entry.action}:${entry.target}${HISTORY_HEADER}${entry.query}`;
}

export function decodeFilterHistoryEntry(encoded: string): FilterHistoryEntry {
  const header = HISTORY_HEADER_PATTERN.exec(encoded);
  if (header === null) {
    return { query: encoded, action: 'show', target: 'line' };
  }
  return { query: encoded.slice(header[0].length), action: header[1] as LogFilterAction, target: header[2] as LogFilterTarget };
}

// Push/dedup/trim and the arrow-browse state machine are the shared input-history primitive
// (tui/shared/input-history) — re-exported under the Logs-facing names so callers read as before.
export { pushHistoryEntry as pushFilterHistoryEntry } from '../../../shared/input-history/index.js';
export {
  resolveHistoryBrowseDown,
  resolveHistoryBrowseUp,
  type HistoryBrowseResult as FilterHistoryBrowseResult,
  type HistoryBrowseState as FilterHistoryBrowseState,
} from '../../../shared/input-history/index.js';

// The filter editor — `/` opens one with scope 'global', `f` with scope 'pane' (repoPath set to
// the owning pane). It has two views: the scope's rule `list` (every change there is applied to
// the scope immediately) and the `rule` editor, whose draft only enters the list on Enter.
// `error` mirrors compileLogFilter's last result for the draft (recomputed on every keystroke).
export type RuleSetConfirm =
  | { kind: 'overwrite'; name: string }
  | { kind: 'apply'; index: number }
  | { kind: 'delete'; index: number };

export type FilterEditorState = {
  scope: 'global' | 'pane';
  repoPath: string | null;
  view: 'list' | 'rule' | 'library' | 'name';
  // The highlighted row of the rule list / of the named-set library.
  listCursor: number;
  libraryCursor: number;
  // The set-name input (`name` view): saving the active list as a set, or renaming one
  // (`nameIndex` is the renamed set's index).
  nameMode: 'save' | 'rename';
  nameIndex: number | null;
  name: string;
  nameCursor: number;
  // Non-null while the library views wait for a yes/no answer.
  setConfirm: RuleSetConfirm | null;
  // The rule the draft replaces on commit; null while adding a new one.
  ruleIndex: number | null;
  mode: LogFilterMode;
  query: string;
  // The caret position within `query`, threaded to TextInputLine like edts-zone.logic.ts's
  // `nextTextInputValue`/`TextInputState`. Every programmatic overwrite of `query` (open, history
  // recall, arrow-browse) resets this to `query.length`.
  cursor: number;
  action: LogFilterAction;
  target: LogFilterTarget;
  error: string | null;
  // A refusal shown in the list view (rule cap reached); cleared by the next key.
  notice: string | null;
  // True while the list view waits for the "clear all rules" confirmation.
  confirmClear: boolean;
  // Non-null while `↑`/`↓` are browsing this scope+mode's history — null on a fresh open and
  // whenever browsing has ended (snapped back to the draft, or walked past the most-recent entry).
  // See resolveHistoryBrowseUp/Down in tui/shared/input-history.
  browsing: HistoryBrowseState | null;
};

export function openFilterEditorState(scope: 'global' | 'pane', repoPath: string | null): FilterEditorState {
  return {
    scope,
    repoPath,
    view: 'list',
    listCursor: 0,
    libraryCursor: 0,
    nameMode: 'save',
    nameIndex: null,
    name: '',
    nameCursor: 0,
    setConfirm: null,
    ruleIndex: null,
    ...ruleDraftOf(null),
    cursor: 0,
    error: null,
    notice: null,
    confirmClear: false,
    browsing: null,
  };
}

// Moves the editor to the rule view on `rule` (null = a new rule at the end of the list).
export function openRuleEditorState(editor: FilterEditorState, index: number | null, rule: LogFilterRule | null): FilterEditorState {
  const draft = ruleDraftOf(rule);
  return { ...editor, ...draft, view: 'rule', ruleIndex: index, cursor: draft.query.length, error: null, notice: null, confirmClear: false, browsing: null };
}

// The filter-history grid's `getLabel` for command-bar.tsx's generic grid primitives — the bare
// query for a show+line entry, prefixed with its action/target otherwise. Shared by LogsZone's
// useInput and LogFilterEditor's render.
export function historyEntryLabel(entry: string): string {
  const decoded = decodeFilterHistoryEntry(entry);
  return isDefaultActionTarget(decoded.action, decoded.target)
    ? decoded.query
    : `[${formatFilterActionTarget(decoded.action, decoded.target)}] ${decoded.query}`;
}

// The footer context of the library views (the named rule sets), or null while the rule list or
// the rule editor is showing.
export function ruleSetsFooterContext(editor: FilterEditorState): FooterContextId | null {
  if (editor.view === 'library') {
    return editor.setConfirm !== null ? 'logs-filter-sets-confirm' : 'logs-filter-sets';
  }
  if (editor.view === 'name') {
    return editor.setConfirm !== null ? 'logs-filter-sets-confirm' : 'logs-filter-set-name';
  }
  return null;
}

// Opens the name input to save the active list (`index` null) or to rename the set at `index`.
export function openRuleSetNameState(editor: FilterEditorState, index: number | null, current: string): FilterEditorState {
  return {
    ...editor,
    view: 'name',
    nameMode: index === null ? 'save' : 'rename',
    nameIndex: index,
    name: current,
    nameCursor: current.length,
    setConfirm: null,
    error: null,
    notice: null,
    confirmClear: false,
  };
}

// Back to the active rule list from the library or the name input, with an optional notice.
export function backToRuleListState(editor: FilterEditorState, notice: string | null = null, listCursor = editor.listCursor): FilterEditorState {
  return { ...editor, view: 'list', listCursor, setConfirm: null, error: null, notice, confirmClear: false, browsing: null };
}

function singleLine(text: string): string {
  return text.replace(/[\s\u0000-\u001f\u007f]+/g, ' ');
}

// The question shown while a library confirmation is pending.
export function formatRuleSetConfirm(confirm: RuleSetConfirm, library: readonly { name: string }[], activeRuleCount: number): string {
  switch (confirm.kind) {
    case 'overwrite':
      return `Overwrite set "${singleLine(confirm.name)}"? (y/Enter = yes, Esc = no)`;
    case 'apply':
      return `Replace the ${activeRuleCount} active ${activeRuleCount === 1 ? 'rule' : 'rules'} with set "${singleLine(library[confirm.index]?.name ?? '')}"? (y/Enter = yes, Esc = no)`;
    case 'delete':
      return `Delete set "${singleLine(library[confirm.index]?.name ?? '')}"? (y/Enter = yes, Esc = no)`;
  }
}

// One library row, e.g. `noise (3 rules)`.
export function formatRuleSetRow(set: { name: string; rules: readonly unknown[] }): string {
  const name = set.name.replace(/[\s\u0000-\u001f\u007f]+/g, ' ');
  return `${name} (${set.rules.length} ${set.rules.length === 1 ? 'rule' : 'rules'})`;
}
