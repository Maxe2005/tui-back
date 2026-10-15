// tui/shared/components/json-tree/model: the JsonTree's pure core (no Ink/React): path
// normalization, JSON flattening with fold + filter rules, fold/rule reducers, tree-local key
// dispatch, response classification, viewport-budget helpers, and the body-edit layer. It never
// touches the store and never parses anything but a fire-result body string.
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

// Tree-local key dispatch (the shared `NavigationKey` contract is deliberately not extended —
// arrows/Home/End/PgUp/PgDn are interpreted here from the raw Ink key flags), plus the edit
// keys (`Enter` edit, `a`/`d`/`t`/`r`), which only the body editor applies. Returns null for
// keys the tree does not own (Esc, digits, Ctrl combos): the zone swallows those while focused
// without acting.
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
  | 'toggle-panel'
  | 'edit-value'
  | 'add-entry'
  | 'delete-entry'
  | 'change-type'
  | 'open-raw';

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
    case 'a':
    case 'A':
      return 'add-entry';
    case 'd':
    case 'D':
      return 'delete-entry';
    case 't':
    case 'T':
      return 'change-type';
    case 'r':
    case 'R':
      return 'open-raw';
    case '\r':
      return 'edit-value';
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

// The edit layer: immutable ops over a JSON body draft (`setValue`/`addEntry`/`removeEntry`/
// `changeType`), scalar validators, concrete-path parsing, raw-buffer parsing with line/column,
// draft seeding/gating, and the editor status line. Per-path scalar errors keep the scalar kind
// the value had before the error, so fixing the text re-validates against the original kind.

export const MAX_BODY_DRAFTS = 50;

export type JsonScalarKind = 'string' | 'number' | 'boolean' | 'null';

// An invalid draft entry: the display reason plus the scalar kind the value held before
// the error (the draft itself holds the raw text, usually a string).
export type BodyEditError = { reason: string; kind: JsonScalarKind };

export type ScalarValidation = { ok: true; value: unknown } | { ok: false; reason: string };

export type EditResult = { ok: true; value: unknown } | { ok: false; reason: string; value: unknown };

export type RawParseResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: string; line: number; column: number; position: number };

export type JsonPathSegment = { type: 'key'; key: string } | { type: 'index'; index: number };

// Scalar entry validation against its kind (never coerced): strings always valid,
// numbers must JSON-parse to a finite number, booleans must be `true`/`false`, null
// must be the literal `null` (surrounding whitespace tolerated everywhere).
export function validateScalarText(kind: JsonScalarKind, text: string): ScalarValidation {
  switch (kind) {
    case 'string':
      return { ok: true, value: text };
    case 'number': {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return { ok: false, reason: `expected a number, got "${text}"` };
      }
      return typeof parsed === 'number' && Number.isFinite(parsed)
        ? { ok: true, value: parsed }
        : { ok: false, reason: `expected a number, got "${text}"` };
    }
    case 'boolean': {
      const trimmed = text.trim();
      return trimmed === 'true'
        ? { ok: true, value: true }
        : trimmed === 'false'
          ? { ok: true, value: false }
          : { ok: false, reason: `expected true or false, got "${text}"` };
    }
    case 'null':
      return text.trim() === 'null' ? { ok: true, value: null } : { ok: false, reason: `expected null, got "${text}"` };
  }
}

export function scalarKindOf(value: unknown): JsonScalarKind | null {
  switch (kindOf(value)) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    default:
      return null;
  }
}

// Reverse of buildNode's escaping: splits a concrete path (`data.items[0].tags`, with
// literal `\`, `.`, `[`, `]` in keys backslash-escaped) into key/index segments.
// Returns null on malformed input (lone trailing backslash, unclosed/non-numeric
// brackets). The empty-string root key collides with the root path itself (`''`) — a
// pre-existing buildNode shape this parser cannot disambiguate; it resolves to the root.
export function parseJsonPath(path: string): JsonPathSegment[] | null {
  if (path === '') {
    return [];
  }
  const segments: JsonPathSegment[] = [];
  let index = 0;
  const length = path.length;
  while (index < length) {
    const char = path[index];
    if (char === '[') {
      let cursor = index + 1;
      let digits = '';
      while (cursor < length && path[cursor] !== ']') {
        digits += path[cursor];
        cursor += 1;
      }
      if (cursor >= length || digits.length === 0 || !/^\d+$/.test(digits)) {
        return null;
      }
      segments.push({ type: 'index', index: Number(digits) });
      index = cursor + 1;
      if (path[index] === '.') {
        index += 1;
        if (index >= length) {
          return null;
        }
      }
      continue;
    }
    if (char === '.') {
      return null;
    }
    let key = '';
    let closed = false;
    while (index < length) {
      const current = path[index];
      if (current === '\\') {
        const next = path[index + 1];
        if (next === undefined) {
          return null;
        }
        key += next;
        index += 2;
        continue;
      }
      if (current === '.' || current === '[') {
        closed = true;
        break;
      }
      if (current === ']') {
        return null;
      }
      key += current;
      index += 1;
    }
    segments.push({ type: 'key', key });
    if (!closed) {
      break;
    }
    if (path[index] === '.') {
      index += 1;
      if (index >= length) {
        return null;
      }
    }
  }
  return segments;
}

function getAtSegments(value: unknown, segments: readonly JsonPathSegment[]): { found: boolean; value: unknown } {
  let current = value;
  for (const segment of segments) {
    if (segment.type === 'key') {
      if (current === null || typeof current !== 'object' || Array.isArray(current)) {
        return { found: false, value: undefined };
      }
      if (!Object.prototype.hasOwnProperty.call(current, segment.key)) {
        return { found: false, value: undefined };
      }
      current = (current as Record<string, unknown>)[segment.key];
    } else {
      if (!Array.isArray(current) || segment.index < 0 || segment.index >= current.length) {
        return { found: false, value: undefined };
      }
      current = current[segment.index];
    }
  }
  return { found: true, value: current };
}

export function getValueAtPath(value: unknown, path: string): { found: boolean; value: unknown } {
  const segments = parseJsonPath(path);
  if (segments === null) {
    return { found: false, value: undefined };
  }
  return getAtSegments(value, segments);
}

function setAtSegments(value: unknown, segments: readonly JsonPathSegment[], next: unknown): { ok: boolean; value: unknown } {
  if (segments.length === 0) {
    return { ok: true, value: next };
  }
  const [head, ...tail] = segments as [JsonPathSegment, ...JsonPathSegment[]];
  if (head.type === 'key') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, value };
    }
    const record = value as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, head.key)) {
      return { ok: false, value };
    }
    const child = setAtSegments(record[head.key], tail, next);
    if (!child.ok) {
      return { ok: false, value };
    }
    return { ok: true, value: { ...record, [head.key]: child.value } };
  }
  if (!Array.isArray(value) || head.index < 0 || head.index >= value.length) {
    return { ok: false, value };
  }
  const child = setAtSegments(value[head.index], tail, next);
  if (!child.ok) {
    return { ok: false, value };
  }
  const copy = [...value];
  copy[head.index] = child.value;
  return { ok: true, value: copy };
}

// Immutable scalar/container replacement at a concrete path. The root (`''`) replaces
// the whole draft. Missing paths, type mismatches, and malformed paths fail with the
// original value preserved (never throws, never coerces).
export function setValueAtPath(value: unknown, path: string, next: unknown): EditResult {
  const segments = parseJsonPath(path);
  if (segments === null) {
    return { ok: false, reason: `not a valid path: "${path}"`, value };
  }
  const result = setAtSegments(value, segments, next);
  return result.ok ? { ok: true, value: result.value } : { ok: false, reason: `no editable value at "${path}"`, value };
}

// Structural add under a container path: objects take a caller-provided key (empty and
// duplicate names rejected, prompt stays), arrays append an empty-string item and ignore
// the key. New entries default to `""`. `__proto__`/`constructor`/`prototype` are never
// accepted as key names (prototype-pollution safety), nor are whitespace-only names.
// Scalars, missing paths, and the empty draft fail with the original value preserved.
export function addEntryAtPath(value: unknown, parentPath: string, keyName?: string): EditResult {
  const segments = parseJsonPath(parentPath);
  if (segments === null) {
    return { ok: false, reason: `not a valid path: "${parentPath}"`, value };
  }
  const target = getAtSegments(value, segments);
  if (!target.found) {
    return { ok: false, reason: `no editable value at "${parentPath}"`, value };
  }
  if (Array.isArray(target.value)) {
    const copy = [...(target.value as unknown[]), ''];
    const result = setAtSegments(value, segments, copy);
    return result.ok ? { ok: true, value: result.value } : { ok: false, reason: `no editable value at "${parentPath}"`, value };
  }
  if (target.value !== null && typeof target.value === 'object') {
    const name = keyName ?? '';
    if (name.trim() === '') {
      return { ok: false, reason: 'key name must not be empty', value };
    }
    if (name === '__proto__' || name === 'constructor' || name === 'prototype') {
      return { ok: false, reason: `reserved key name: "${name}"`, value };
    }
    const record = target.value as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(record, name)) {
      return { ok: false, reason: `duplicate key: "${name}"`, value };
    }
    const result = setAtSegments(value, segments, { ...record, [name]: '' });
    return result.ok ? { ok: true, value: result.value } : { ok: false, reason: `no editable value at "${parentPath}"`, value };
  }
  return { ok: false, reason: `can only add to an object or array`, value };
}

// Immutable removal at a concrete path. The root cannot be deleted (nothing would
// remain); array items splice (later indices shift), object keys drop with their whole
// subtree. Failures preserve the original value.
export function removeEntryAtPath(value: unknown, path: string): EditResult {
  if (path === '') {
    return { ok: false, reason: 'cannot delete the root value', value };
  }
  const segments = parseJsonPath(path);
  if (segments === null || segments.length === 0) {
    return { ok: false, reason: `not a valid path: "${path}"`, value };
  }
  const last = segments[segments.length - 1] as JsonPathSegment;
  const parent = getAtSegments(value, segments.slice(0, -1));
  if (!parent.found) {
    return { ok: false, reason: `no editable value at "${path}"`, value };
  }
  if (last.type === 'key') {
    if (parent.value === null || typeof parent.value !== 'object' || Array.isArray(parent.value)) {
      return { ok: false, reason: `no editable value at "${path}"`, value };
    }
    const record = { ...(parent.value as Record<string, unknown>) };
    if (!Object.prototype.hasOwnProperty.call(record, last.key)) {
      return { ok: false, reason: `no editable value at "${path}"`, value };
    }
    delete record[last.key];
    const result = setAtSegments(value, segments.slice(0, -1), record);
    return result.ok ? { ok: true, value: result.value } : { ok: false, reason: `no editable value at "${path}"`, value };
  }
  if (!Array.isArray(parent.value) || last.index < 0 || last.index >= (parent.value as unknown[]).length) {
    return { ok: false, reason: `no editable value at "${path}"`, value };
  }
  const copy = [...(parent.value as unknown[])];
  copy.splice(last.index, 1);
  const result = setAtSegments(value, segments.slice(0, -1), copy);
  return result.ok ? { ok: true, value: result.value } : { ok: false, reason: `no editable value at "${path}"`, value };
}

const SCALAR_CYCLE: readonly JsonScalarKind[] = ['string', 'number', 'boolean', 'null'];

// Cycle a scalar's kind string → number → boolean → null → string (containers are not
// type-changeable). Conversions: string re-parses as a JSON number — text that does not
// parse falls back to kind string (which always parses), so a type change never leaves
// an error state and the value visibly becomes a string; nonzero numbers become true,
// booleans become null, null becomes `""`. Only missing paths and containers fail, with
// the original value preserved.
export function changeTypeAtPath(value: unknown, path: string): EditResult {
  const segments = parseJsonPath(path);
  if (segments === null) {
    return { ok: false, reason: `not a valid path: "${path}"`, value };
  }
  const target = getAtSegments(value, segments);
  if (!target.found) {
    return { ok: false, reason: `no editable value at "${path}"`, value };
  }
  const kind = scalarKindOf(target.value);
  if (kind === null) {
    return { ok: false, reason: 'only scalar values can change type', value };
  }
  const nextKind = SCALAR_CYCLE[(SCALAR_CYCLE.indexOf(kind) + 1) % SCALAR_CYCLE.length] as JsonScalarKind;
  let next: unknown;
  switch (nextKind) {
    case 'number': {
      const text = target.value as string;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
      next = typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : text;
      break;
    }
    case 'boolean':
      next = (target.value as number) !== 0;
      break;
    case 'null':
      next = null;
      break;
    case 'string':
      next = '';
      break;
  }
  const result = setAtSegments(value, segments, next);
  return result.ok ? { ok: true, value: result.value } : { ok: false, reason: `no editable value at "${path}"`, value };
}

// Resolve the container an `a` keypress adds into: a container selection adds into
// itself, a scalar selection adds into its parent container. Null when there is no
// container (empty draft, scalar root, missing path, scalar parent).
export function resolveAddParentPath(value: unknown, selectedPath: string): string | null {
  if (value === undefined) {
    return null;
  }
  const segments = parseJsonPath(selectedPath);
  if (segments === null) {
    return null;
  }
  const selected = getAtSegments(value, segments);
  if (!selected.found) {
    return null;
  }
  if (selected.value !== null && typeof selected.value === 'object') {
    return selectedPath;
  }
  const parent = parentPathOf(selectedPath);
  if (parent === null) {
    return null;
  }
  const parentSegments = parseJsonPath(parent);
  if (parentSegments === null) {
    return null;
  }
  const resolved = getAtSegments(value, parentSegments);
  if (!resolved.found || resolved.value === null || typeof resolved.value !== 'object') {
    return null;
  }
  return parent;
}

export function parentPathOf(path: string): string | null {
  if (path === '') {
    return null;
  }
  const segments = parseJsonPath(path);
  if (segments === null || segments.length === 0) {
    return null;
  }
  const parentSegments = segments.slice(0, -1);
  if (parentSegments.length === 0) {
    return '';
  }
  return rebuildConcretePath(parentSegments);
}

function escapeRebuild(key: string): string {
  return key.replace(/\\/g, '\\\\').replace(/\./g, '\\.').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

function rebuildConcretePath(segments: readonly JsonPathSegment[]): string {
  let out = '';
  for (const segment of segments) {
    if (segment.type === 'index') {
      out += `[${segment.index}]`;
    } else if (out === '') {
      out = escapeRebuild(segment.key);
    } else {
      out += `.${escapeRebuild(segment.key)}`;
    }
  }
  return out;
}

// Parse a raw-buffer body: valid JSON replaces the draft, anything else keeps the
// developer in raw mode with the parse error plus its 1-based line/column (V8 reports
// the byte offset as `at position N`; messages without one fall back to the buffer end).
export function parseRawJsonBuffer(text: string): RawParseResult {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const match = /position\s+(\d+)/i.exec(message);
    const rawPosition = match?.[1] !== undefined ? Number(match[1]) : text.length;
    const position = Number.isFinite(rawPosition) ? Math.min(Math.max(Math.floor(rawPosition), 0), text.length) : text.length;
    const before = text.slice(0, position);
    const lines = before.split('\n');
    return { ok: false, reason: message, line: lines.length, column: (lines[lines.length - 1] ?? '').length + 1, position };
  }
}

export type EditableRoute = { bodyExample?: unknown; bodyContentType?: string };

// The editor opens for a route carrying `bodyExample` or any `bodyContentType` (non-JSON
// bodies start empty); routes with neither stay inert with no hint.
export function canEditRouteBody(route: EditableRoute): boolean {
  if (route.bodyExample !== undefined) {
    return true;
  }
  return typeof route.bodyContentType === 'string' && route.bodyContentType.length > 0;
}

function cloneJsonValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return value;
  }
}

// Lazy per-route seed: a deep clone of the route's `bodyExample`, or `undefined` (empty — press
// `r`) when the route carries only a content type.
export function seedBodyDraft(route: EditableRoute): unknown {
  return route.bodyExample === undefined ? undefined : cloneJsonValue(route.bodyExample);
}

export function pruneBodyDrafts<T>(states: Record<string, T>, limit: number = MAX_BODY_DRAFTS): Record<string, T> {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : MAX_BODY_DRAFTS;
  const keys = Object.keys(states);
  if (keys.length <= safeLimit) {
    return states;
  }
  const pruned: Record<string, T> = {};
  for (const key of keys.slice(keys.length - safeLimit)) {
    pruned[key] = states[key] as T;
  }
  return pruned;
}

// First validation error by sorted path (deterministic for the status line); null when
// the route has no invalid entries.
export function firstEditError(errors: Readonly<Record<string, BodyEditError>>): string | null {
  const keys = Object.keys(errors).sort();
  const first = keys[0];
  return first === undefined ? null : (errors[first] as BodyEditError).reason;
}

// Editor status: the first validation error when present, plus `N lines hidden — still
// sent` whenever hiddenCount > 0 (hiding never removes content from the draft).
export function formatBodyEditStatus(firstError: string | null, hiddenCount: number): string {
  const safeHidden = Number.isFinite(hiddenCount) ? Math.max(0, Math.floor(hiddenCount)) : 0;
  const hiddenPart = safeHidden > 0 ? `${safeHidden} ${safeHidden === 1 ? 'line' : 'lines'} hidden — still sent` : null;
  if (firstError !== null && firstError !== '') {
    return hiddenPart !== null ? `✖ ${firstError} · ${hiddenPart}` : `✖ ${firstError}`;
  }
  return hiddenPart ?? '0 lines hidden — still sent';
}

// True when a concrete path falls under a container prefix (exact match, `.child`, or
// `[i]` continuation); the root prefix matches everything.
export function isPathUnderPrefix(path: string, prefix: string): boolean {
  if (prefix === '') {
    return true;
  }
  return path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`);
}

// Re-align a per-path error map after deleting `deletedPath`: the removed subtree's
// errors drop, and when an array item is spliced, errors on later siblings shift down
// by one (`scores[2]` becomes `scores[1]`) so they stay pinned to their values.
// Object deletes only drop the subtree (keys never shift). Unparseable paths pass
// through untouched; a malformed deleted path falls back to a plain subtree drop.
export function remapErrorsForDelete<T>(errors: Readonly<Record<string, T>>, deletedPath: string): Record<string, T> {
  const segments = parseJsonPath(deletedPath);
  if (segments === null || segments.length === 0) {
    const kept: Record<string, T> = {};
    for (const [path, entry] of Object.entries(errors)) {
      if (!isPathUnderPrefix(path, deletedPath)) {
        kept[path] = entry;
      }
    }
    return kept;
  }
  const parentSegments = segments.slice(0, -1);
  const last = segments[segments.length - 1] as JsonPathSegment;
  const removedIndex = last.type === 'index' ? last.index : null;
  const remapped: Record<string, T> = {};
  for (const [path, entry] of Object.entries(errors)) {
    if (isPathUnderPrefix(path, deletedPath)) {
      continue;
    }
    if (removedIndex === null) {
      remapped[path] = entry;
      continue;
    }
    const pathSegments = parseJsonPath(path);
    if (pathSegments === null || pathSegments.length <= parentSegments.length) {
      remapped[path] = entry;
      continue;
    }
    const head = pathSegments.slice(0, parentSegments.length);
    if (JSON.stringify(head) !== JSON.stringify(parentSegments)) {
      remapped[path] = entry;
      continue;
    }
    const sibling = pathSegments[parentSegments.length] as JsonPathSegment;
    if (sibling.type !== 'index' || sibling.index <= removedIndex) {
      remapped[path] = entry;
      continue;
    }
    const shifted: JsonPathSegment[] = [
      ...parentSegments,
      { type: 'index', index: sibling.index - 1 },
      ...pathSegments.slice(parentSegments.length + 1),
    ];
    remapped[rebuildConcretePath(shifted)] = entry;
  }
  return remapped;
}
