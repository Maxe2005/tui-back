// tui/shared/components/json-tree/model: story 6.7 — the JsonTree's pure core (no
// Ink/React imports): path normalization, JSON flattening with fold + filter rules,
// fold/rule reducers, tree-local key dispatch, response classification, and
// viewport-budget helpers. The thin Ink view (json-tree.tsx) renders the visible rows
// through BoundedList; per-route session state lives in the routes slice; this module
// never touches the store and never parses anything but a fire-result body string.
export const MAX_BODY_CHARS = 64 * 1024;
export const MAX_STRING_CHARS = 120;
export const MAX_JSON_TREE_STATES = 50;

export type JsonTreeKind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

export type JsonTreeRow = {
  // Concrete dotted path (`data.items[0].tags`); unique per row, used as the React key.
  path: string;
  // Array indices generalized (`data.items[].tags`): folds stored per normalized path
  // survive re-fires with different array lengths.
  normalizedPath: string;
  // Object key name; null for the root and for array items (no key rule ever matches them).
  key: string | null;
  // Array position for array items, null otherwise (the view renders `[i]` from this).
  index: number | null;
  depth: number;
  kind: JsonTreeKind;
  // Scalar text ready to render (strings quoted + truncated past 120 chars); null for containers.
  displayValue: string | null;
  // Original child count for containers (`{n}`/`[n]` hints); null for scalars.
  size: number | null;
  // True when this container's normalized path is folded (children hidden).
  folded: boolean;
};

export type TreeFilterRules = {
  hiddenKeys: readonly string[];
  onlyKeys: readonly string[];
  hideNulls: boolean;
};

// Serializable plain data, keyed per route (`METHOD + ' ' + path`) in the routes slice.
// Session-only, never persisted to disk.
export type JsonTreeState = {
  foldedPaths: string[];
  hiddenKeys: string[];
  onlyKeys: string[];
  hideNulls: boolean;
  selected: number;
};

export function createDefaultJsonTreeState(): JsonTreeState {
  return { foldedPaths: [], hiddenKeys: [], onlyKeys: [], hideNulls: false, selected: 0 };
}

export function routeKeyFor(method: string, path: string): string {
  return `${method.trim().toUpperCase()} ${path.trim()}`;
}

// `data.items[0].tags` -> `data.items[].tags`. Only unescaped `[<digits>]` segments
// generalize (literal dots/brackets in keys are backslash-escaped by buildNode, so a
// literal key `a[0]` never collides with the index path `a[0]`); anything else
// (object keys, even numeric-looking ones) passes through untouched.
export function normalizePath(path: string): string {
  // Generalize real `[<digits>]` index segments only: a `[<digits>]` preceded by a lone
  // (unpaired) backslash is an escaped literal bracket and passes through. Pairs of
  // backslashes are themselves escaped literals and do not protect the bracket.
  return path.replace(/(\\\\)*(\\)?\[\d+\]/g, (match, pairs: string | undefined, lone: string | undefined) =>
    lone === undefined ? `${pairs ?? ''}[]` : match,
  );
}

// Object keys join paths with `.`, so literal `\`, `.`, `[`, `]` in a key are
// backslash-escaped at build time: a literal key `a.b` and the nested path `a.b`
// get distinct concrete/normalized paths (and distinct React keys + fold scopes).
function escapePathSegment(key: string): string {
  return key.replace(/\\/g, '\\\\').replace(/\./g, '\\.').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

export function truncateStringValue(value: string): string {
  const chars = [...value];
  return chars.length > MAX_STRING_CHARS ? `${chars.slice(0, MAX_STRING_CHARS).join('')}…` : value;
}

type MutableNode = {
  path: string;
  normalizedPath: string;
  key: string | null;
  index: number | null;
  depth: number;
  kind: JsonTreeKind;
  displayValue: string | null;
  size: number | null;
  children: MutableNode[];
};

function kindOf(value: unknown): JsonTreeKind {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    default:
      return 'object';
  }
}

function scalarDisplay(kind: JsonTreeKind, value: unknown): string | null {
  switch (kind) {
    case 'string':
      // JSON.stringify escapes control characters, quotes and backslashes, so one
      // string always renders as exactly one row (BoundedList budgets per row).
      return `"${truncateStringValue(JSON.stringify(value as string).slice(1, -1))}"`;
    case 'number':
      return String(value);
    case 'boolean':
      return value === true ? 'true' : 'false';
    case 'null':
      return 'null';
    default:
      return null;
  }
}

function buildNode(value: unknown, path: string, key: string | null, index: number | null, depth: number): MutableNode {
  const kind = kindOf(value);
  const normalizedPath = normalizePath(path);
  if (kind === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return {
      path,
      normalizedPath,
      key,
      index,
      depth,
      kind,
      displayValue: null,
      size: entries.length,
      children: entries.map(([childKey, childValue]) =>
        buildNode(childValue, path === '' ? escapePathSegment(childKey) : `${path}.${escapePathSegment(childKey)}`, childKey, null, depth + 1),
      ),
    };
  }
  if (kind === 'array') {
    const items = value as unknown[];
    return {
      path,
      normalizedPath,
      key,
      index,
      depth,
      kind,
      displayValue: null,
      size: items.length,
      children: items.map((item, itemIndex) =>
        buildNode(item, `${path}[${itemIndex}]`, null, itemIndex, depth + 1),
      ),
    };
  }
  return { path, normalizedPath, key, index, depth, kind, displayValue: scalarDisplay(kind, value), size: null, children: [] };
}

function isVetoed(node: MutableNode, rules: TreeFilterRules): boolean {
  if (node.key !== null && rules.hiddenKeys.includes(node.key)) {
    return true;
  }
  if (rules.hideNulls && node.kind === 'null') {
    return true;
  }
  return false;
}

// True when this subtree holds a live allow-list match: a non-vetoed node whose key is
// listed (vetoed branches can never contribute — a global hide wins over an allow).
function subtreeHasLiveMatch(node: MutableNode, rules: TreeFilterRules): boolean {
  if (isVetoed(node, rules)) {
    return false;
  }
  if (node.key !== null && rules.onlyKeys.includes(node.key)) {
    return true;
  }
  return node.children.some((child) => subtreeHasLiveMatch(child, rules));
}

function toRow(node: MutableNode, folded: boolean): JsonTreeRow {
  return {
    path: node.path,
    normalizedPath: node.normalizedPath,
    key: node.key,
    index: node.index,
    depth: node.depth,
    kind: node.kind,
    displayValue: node.displayValue,
    size: node.size,
    folded,
  };
}

// Flatten to the visible rows only: folds hide whole subtrees (the folded container row
// itself stays), vetoes (hidden keys, nulls) drop subtrees, and a non-empty allow-list
// keeps matches plus their structural ancestors plus the full subtree of a matched
// container — every other line goes. Key-less nodes (root, array items) are structure:
// they always pass the key rules and are only ever vetoed by hideNulls (null root).
export function flattenJson(value: unknown, foldedPaths: readonly string[], rules: TreeFilterRules): JsonTreeRow[] {
  const folded = new Set(foldedPaths);
  const root = buildNode(value, '', null, null, 0);
  const rows: JsonTreeRow[] = [];
  const allowActive = rules.onlyKeys.length > 0;
  function visit(node: MutableNode, parentVisible: boolean, ancestorMatched: boolean): void {
    if (!parentVisible || isVetoed(node, rules)) {
      return;
    }
    const matched = node.key !== null && rules.onlyKeys.includes(node.key);
    if (allowActive && !matched && !ancestorMatched && !subtreeHasLiveMatch(node, rules)) {
      return;
    }
    const isContainer = node.kind === 'object' || node.kind === 'array';
    const isFolded = isContainer && folded.has(node.normalizedPath);
    rows.push(toRow(node, isFolded));
    if (isFolded) {
      return;
    }
    for (const child of node.children) {
      visit(child, true, ancestorMatched || matched);
    }
  }
  visit(root, true, false);
  return rows;
}

export function countJsonNodes(value: unknown): number {
  const root = buildNode(value, '', null, null, 0);
  function count(node: MutableNode): number {
    return 1 + node.children.reduce((total, child) => total + count(child), 0);
  }
  return count(root);
}

export type ContainerSite = {
  normalizedPath: string;
  depth: number;
  folded: boolean;
  reachable: boolean;
};

// Every non-empty container in the value with its fold + reachability state (a container
// under a folded ancestor is listed but unreachable — folding it would be a no-op).
export function listTreeContainers(value: unknown, foldedPaths: readonly string[]): ContainerSite[] {
  const folded = new Set(foldedPaths);
  const root = buildNode(value, '', null, null, 0);
  const sites: ContainerSite[] = [];
  function visit(node: MutableNode, blocked: boolean): void {
    const isContainer = node.kind === 'object' || node.kind === 'array';
    const isFolded = isContainer && folded.has(node.normalizedPath);
    if (isContainer && (node.size ?? 0) > 0) {
      sites.push({ normalizedPath: node.normalizedPath, depth: node.depth, folded: isFolded, reachable: !blocked });
    }
    for (const child of node.children) {
      visit(child, blocked || isFolded);
    }
  }
  visit(root, false);
  return sites;
}

// `+`: unfold every reachable folded container at the shallowest folded depth (one level
// at a time; stale paths for absent shapes pass through untouched).
export function unfoldNextDepthLevel(value: unknown, foldedPaths: readonly string[]): string[] {
  const sites = listTreeContainers(value, foldedPaths).filter((site) => site.folded && site.reachable);
  if (sites.length === 0) {
    return [...foldedPaths];
  }
  const shallowest = Math.min(...sites.map((site) => site.depth));
  const level = new Set(sites.filter((site) => site.depth === shallowest).map((site) => site.normalizedPath));
  return foldedPaths.filter((path) => !level.has(path));
}

// `-`: fold every reachable unfolded container at the deepest unfolded depth. The root
// itself is excluded (collapsing the whole tree to one row stays a manual `←` action).
export function foldNextDepthLevel(value: unknown, foldedPaths: readonly string[]): string[] {
  const sites = listTreeContainers(value, foldedPaths).filter(
    (site) => !site.folded && site.reachable && site.normalizedPath !== '',
  );
  if (sites.length === 0) {
    return [...foldedPaths];
  }
  const deepest = Math.max(...sites.map((site) => site.depth));
  const next = new Set(foldedPaths);
  for (const site of sites) {
    if (site.depth === deepest) {
      next.add(site.normalizedPath);
    }
  }
  return [...next];
}

// Toggle one container's fold. Null unless the selected row is a foldable container.
export function toggleFoldPath(foldedPaths: readonly string[], normalizedPath: string | null, isContainer: boolean): string[] | null {
  if (!isContainer || normalizedPath === null) {
    return null;
  }
  return foldedPaths.includes(normalizedPath)
    ? foldedPaths.filter((path) => path !== normalizedPath)
    : [...foldedPaths, normalizedPath];
}

// Nearest previous row one depth up (rows are DFS-ordered, so the parent is the closest
// earlier row at depth - 1); null at the root.
export function findParentIndex(rows: readonly JsonTreeRow[], index: number): number | null {
  if (index <= 0 || index >= rows.length) {
    return null;
  }
  const depth = rows[index]?.depth ?? 0;
  if (depth <= 0) {
    return null;
  }
  for (let candidate = index - 1; candidate >= 0; candidate -= 1) {
    if (rows[candidate]?.depth === depth - 1) {
      return candidate;
    }
  }
  return null;
}

export type ActiveRule = { kind: 'hide' | 'only'; key: string };

export function listActiveRules(rules: TreeFilterRules): ActiveRule[] {
  return [
    ...rules.hiddenKeys.map((key): ActiveRule => ({ kind: 'hide', key })),
    ...rules.onlyKeys.map((key): ActiveRule => ({ kind: 'only', key })),
  ];
}

export function countActiveRules(rules: TreeFilterRules): number {
  return rules.hiddenKeys.length + rules.onlyKeys.length + (rules.hideNulls ? 1 : 0);
}

// Every reducer below returns null when the keypress would change nothing, so the zone
// can skip the store update (and the prune-order touch) entirely.
export function addHiddenKey(rules: TreeFilterRules, key: string | null): TreeFilterRules | null {
  if (key === null || key === '' || rules.hiddenKeys.includes(key)) {
    return null;
  }
  return { hiddenKeys: [...rules.hiddenKeys, key], onlyKeys: [...rules.onlyKeys], hideNulls: rules.hideNulls };
}

export function addOnlyKey(rules: TreeFilterRules, key: string | null): TreeFilterRules | null {
  if (key === null || key === '' || rules.onlyKeys.includes(key)) {
    return null;
  }
  return { hiddenKeys: [...rules.hiddenKeys], onlyKeys: [...rules.onlyKeys, key], hideNulls: rules.hideNulls };
}

export function removeActiveRule(rules: TreeFilterRules, index: number): TreeFilterRules | null {
  const active = listActiveRules(rules);
  const target = active[index];
  if (target === undefined) {
    return null;
  }
  return target.kind === 'hide'
    ? { hiddenKeys: rules.hiddenKeys.filter((key) => key !== target.key), onlyKeys: [...rules.onlyKeys], hideNulls: rules.hideNulls }
    : { hiddenKeys: [...rules.hiddenKeys], onlyKeys: rules.onlyKeys.filter((key) => key !== target.key), hideNulls: rules.hideNulls };
}

export function toggleHideNulls(rules: TreeFilterRules): TreeFilterRules {
  return { hiddenKeys: [...rules.hiddenKeys], onlyKeys: [...rules.onlyKeys], hideNulls: !rules.hideNulls };
}

export function clearTreeRules(rules: TreeFilterRules): TreeFilterRules | null {
  if (rules.hiddenKeys.length === 0 && rules.onlyKeys.length === 0 && !rules.hideNulls) {
    return null;
  }
  return { hiddenKeys: [], onlyKeys: [], hideNulls: false };
}

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

// Tree-local key dispatch (story 6.7 deliberately does not extend the shared
// `NavigationKey` contract — arrows/Home/End/PgUp/PgDn are interpreted here, inside the
// tree, from the raw Ink key flags). Returns null for keys the tree does not own (Enter,
// Esc, digits, Ctrl combos): the zone swallows those while focused without acting.
export type TreeKeyFlags = {
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  pageUp?: boolean;
  pageDown?: boolean;
  home?: boolean;
  end?: boolean;
  ctrl?: boolean;
};

export type TreeKeyAction =
  | 'up'
  | 'down'
  | 'home'
  | 'end'
  | 'page-up'
  | 'page-down'
  | 'fold'
  | 'unfold'
  | 'fold-level'
  | 'unfold-level'
  | 'hide-key'
  | 'only-key'
  | 'toggle-panel';

export function resolveTreeKeyAction(input: string, key: TreeKeyFlags): TreeKeyAction | null {
  if (key.ctrl === true) {
    return null;
  }
  if (key.upArrow === true) {
    return 'up';
  }
  if (key.downArrow === true) {
    return 'down';
  }
  if (key.home === true) {
    return 'home';
  }
  if (key.end === true) {
    return 'end';
  }
  if (key.pageUp === true) {
    return 'page-up';
  }
  if (key.pageDown === true) {
    return 'page-down';
  }
  if (key.leftArrow === true) {
    return 'fold';
  }
  if (key.rightArrow === true) {
    return 'unfold';
  }
  switch (input) {
    case ' ':
      return 'unfold';
    case '+':
      return 'unfold-level';
    case '-':
      return 'fold-level';
    case 'h':
      return 'hide-key';
    case 'H':
      return 'only-key';
    case 'f':
    case 'F':
      return 'toggle-panel';
    default:
      return null;
  }
}

export type TreePanelAction =
  | { type: 'remove-rule'; index: number }
  | { type: 'toggle-nulls' }
  | { type: 'clear-all' }
  | { type: 'close-panel' };

// Filter-panel dispatch: digits remove the nth listed rule, `n` flips hide-nulls, `c`
// clears everything, `f` closes (Esc closes too, handled by the zone so focus unwinds).
export function resolveTreePanelKeyAction(input: string, ruleCount: number): TreePanelAction | null {
  if (input >= '1' && input <= '9') {
    const index = Number(input) - 1;
    return index < ruleCount ? { type: 'remove-rule', index } : null;
  }
  switch (input) {
    case 'n':
    case 'N':
      return { type: 'toggle-nulls' };
    case 'c':
    case 'C':
      return { type: 'clear-all' };
    case 'f':
    case 'F':
      return { type: 'close-panel' };
    default:
      return null;
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

// Total extra rows around the BoundedList: the status line plus, when open, the filter
// panel (header + one row per rule + the nulls-toggle row + the hints row).
export function treePanelLineCount(ruleCount: number): number {
  const safe = Number.isFinite(ruleCount) ? Math.max(0, Math.floor(ruleCount)) : 0;
  return 3 + safe;
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
