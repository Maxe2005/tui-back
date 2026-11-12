// tui/shared/components/json-tree/tree-selection: selection/navigation clamping, response body
// classification, the status line, panel/viewport row budgets and session-state pruning.
import { JsonTreeState, MAX_BODY_CHARS, MAX_JSON_TREE_STATES } from './tree-build.js';

export function clampTreeSelection(selected: number, rowCount: number): number {
  if (!Number.isFinite(selected) || rowCount <= 0) {
    return 0;
  }
  return Math.min(Math.max(Math.floor(selected), 0), rowCount - 1);
}

export type TreeMoveAction = 'up' | 'down' | 'home' | 'end' | 'page-up' | 'page-down';

// Viewport is the visible item-row count (sanitized to >= 1); PgUp/PgDn move by it.
export function moveTreeSelection(selected: number, rowCount: number, viewport: number, action: TreeMoveAction): number {
  const step = Number.isFinite(viewport) ? Math.max(1, Math.floor(viewport)) : 1;
  const current = clampTreeSelection(selected, rowCount);
  switch (action) {
    case 'up':
      return clampTreeSelection(current - 1, rowCount);
    case 'down':
      return clampTreeSelection(current + 1, rowCount);
    case 'home':
      return clampTreeSelection(0, rowCount);
    case 'end':
      return clampTreeSelection(rowCount - 1, rowCount);
    case 'page-up':
      return clampTreeSelection(current - step, rowCount);
    case 'page-down':
      return clampTreeSelection(current + step, rowCount);
  }
}

export type BodyClassification =
  | { kind: 'empty'; emptyKind: 'empty-body' | 'empty-json' }
  | { kind: 'json'; value: unknown }
  | { kind: 'raw'; reason: 'truncated at 64 KB' | 'not JSON' };

// Classify a fired body in the driving adapter (never core): empty stays an explicit
// empty state (never an error), unparsable bodies fall back to scrollable raw text with
// their reason, and bodies at/above the silent-slice cap are always reported truncated —
// a truncated payload that still happens to parse must never render as a complete tree.
export function classifyResponseBody(body: string): BodyClassification {
  if (body.trim() === '') {
    return { kind: 'empty', emptyKind: 'empty-body' };
  }
  if (body.length >= MAX_BODY_CHARS) {
    return { kind: 'raw', reason: 'truncated at 64 KB' };
  }
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return { kind: 'raw', reason: 'not JSON' };
  }
  if (value !== null && typeof value === 'object') {
    const empty = Array.isArray(value) ? value.length === 0 : Object.keys(value).length === 0;
    if (empty) {
      return { kind: 'empty', emptyKind: 'empty-json' };
    }
  }
  return { kind: 'json', value };
}

// The status line always shows both counts, even at zero.
export function formatTreeStatusLine(hiddenCount: number, activeRuleCount: number): string {
  const safeHidden = Number.isFinite(hiddenCount) ? Math.max(0, Math.floor(hiddenCount)) : 0;
  const safeRules = Number.isFinite(activeRuleCount) ? Math.max(0, Math.floor(activeRuleCount)) : 0;
  return `${safeHidden} hidden · ${safeRules} ${safeRules === 1 ? 'rule' : 'rules'}`;
}

// Rule rows visible at once in the filter panel; past this the panel windows through
// BoundedList like every other list (the cursor still reaches every rule).
export const PANEL_VISIBLE_RULE_ROWS = 10;

// Total extra rows around the BoundedList: the status line plus, when open, the filter
// panel (header + up to PANEL_VISIBLE_RULE_ROWS windowed rule rows + the nulls-toggle
// row + the hints row).
export function treePanelLineCount(ruleCount: number): number {
  const safe = Number.isFinite(ruleCount) ? Math.max(0, Math.floor(ruleCount)) : 0;
  return 3 + Math.min(safe, PANEL_VISIBLE_RULE_ROWS);
}

export function treeChromeRows(panelOpen: boolean, ruleCount: number): number {
  return 1 + (panelOpen ? treePanelLineCount(ruleCount) : 0);
}

// Item-row budget for the BoundedList inside a measured total row budget.
export function resolveTreeListBudget(totalBudget: number, panelOpen: boolean, ruleCount: number): number {
  const total = Number.isFinite(totalBudget) ? Math.max(0, Math.floor(totalBudget)) : 0;
  return Math.max(0, total - treeChromeRows(panelOpen, ruleCount));
}

// Prune session tree states to the most-recently-touched entries: touches delete +
// re-insert (Record preserves insertion order), so the front is the oldest.
export function pruneJsonTreeStates(
  states: Record<string, JsonTreeState>,
  limit: number = MAX_JSON_TREE_STATES,
): Record<string, JsonTreeState> {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : MAX_JSON_TREE_STATES;
  const keys = Object.keys(states);
  if (keys.length <= safeLimit) {
    return states;
  }
  const pruned: Record<string, JsonTreeState> = {};
  for (const key of keys.slice(keys.length - safeLimit)) {
    pruned[key] = states[key] as JsonTreeState;
  }
  return pruned;
}
