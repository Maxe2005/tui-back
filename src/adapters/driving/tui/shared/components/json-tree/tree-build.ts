// tui/shared/components/json-tree/tree-build: tree construction for the JsonTree (no Ink/React): the
// shared row/state/filter types, path normalization, JSON flattening with fold + filter rules,
// and the fold reducers (level-wise fold/unfold, toggle, parent lookup).

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

export function kindOf(value: unknown): JsonTreeKind {
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
