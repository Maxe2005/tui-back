import { describe, expect, it } from 'vitest';
import {
  MAX_BODY_CHARS,
  MAX_JSON_TREE_STATES,
  addHiddenKey,
  addOnlyKey,
  clampTreeSelection,
  classifyResponseBody,
  clearTreeRules,
  countActiveRules,
  countJsonNodes,
  createDefaultJsonTreeState,
  findParentIndex,
  flattenJson,
  foldNextDepthLevel,
  formatTreeStatusLine,
  listActiveRules,
  listTreeContainers,
  moveTreeSelection,
  normalizePath,
  pruneJsonTreeStates,
  removeActiveRule,
  resolveTreeKeyAction,
  resolveTreeListBudget,
  resolveTreePanelKeyAction,
  routeKeyFor,
  toggleFoldPath,
  toggleHideNulls,
  treeChromeRows,
  treePanelLineCount,
  truncateStringValue,
  unfoldNextDepthLevel,
  type TreeFilterRules,
} from './model.js';

const NO_RULES: TreeFilterRules = { hiddenKeys: [], onlyKeys: [], hideNulls: false };

describe('normalizePath', () => {
  it('generalizes array indices so folds survive re-fires with different lengths', () => {
    expect(normalizePath('data.items[0].tags')).toBe('data.items[].tags');
    expect(normalizePath('a[12][3].b')).toBe('a[][].b');
    expect(normalizePath('data.name')).toBe('data.name');
    expect(normalizePath('')).toBe('');
  });

  it('leaves escaped literal brackets alone while generalizing real indices', () => {
    expect(normalizePath('a\\[0\\]')).toBe('a\\[0\\]');
    expect(normalizePath('a\\[0\\].b[2]')).toBe('a\\[0\\].b[]');
    expect(normalizePath('a\\\\[0]')).toBe('a\\\\[]');
  });
});

describe('escaped key paths', () => {
  it('keeps a literal dotted key distinct from the nested path', () => {
    const rows = flattenJson({ 'a.b': 1, a: { b: 2 } }, [], NO_RULES);
    const paths = rows.map((row) => row.path);
    expect(new Set(paths).size).toBe(paths.length);
    const literal = rows.find((row) => row.key === 'a.b');
    expect(literal?.normalizedPath).toBe('a\\.b');
    // Folding the nested container leaves the literal key visible.
    const folded = flattenJson({ 'a.b': 1, a: { b: 2 } }, ['a'], NO_RULES);
    expect(folded.map((row) => row.key)).toEqual([null, 'a.b', 'a']);
  });
});

describe('routeKeyFor', () => {
  it('keys per-route state as METHOD + space + path', () => {
    expect(routeKeyFor('get', '/users')).toBe('GET /users');
    expect(routeKeyFor('POST', '  /users  ')).toBe('POST /users');
  });
});

describe('flattenJson (nested JSON matrix row)', () => {
  const value = { data: { name: 'ada', age: 36, admin: true, nick: null, tags: ['x', 'y'] } };

  it('emits indented rows with {n}/[n] size hints and scalar display values', () => {
    const rows = flattenJson(value, [], NO_RULES);
    expect(rows.map((row) => `${row.depth}:${row.key ?? (row.index !== null ? `[${row.index}]` : '<root>')}:${row.kind}`)).toEqual([
      '0:<root>:object',
      '1:data:object',
      '2:name:string',
      '2:age:number',
      '2:admin:boolean',
      '2:nick:null',
      '2:tags:array',
      '3:[0]:string',
      '3:[1]:string',
    ]);
    const byKey = new Map(rows.map((row) => [row.path, row]));
    expect(byKey.get('')?.size).toBe(1);
    expect(byKey.get('data')?.size).toBe(5);
    expect(byKey.get('data.tags')?.size).toBe(2);
    expect(byKey.get('data.name')?.displayValue).toBe('"ada"');
    expect(byKey.get('data.age')?.displayValue).toBe('36');
    expect(byKey.get('data.admin')?.displayValue).toBe('true');
    expect(byKey.get('data.nick')?.displayValue).toBe('null');
    expect(byKey.get('data.tags[0]')?.key).toBeNull();
    expect(byKey.get('data.tags[0]')?.index).toBe(0);
  });

  it('records concrete and normalized paths per row', () => {
    const rows = flattenJson({ items: [{ id: 1 }] }, [], NO_RULES);
    const leaf = rows.find((row) => row.path === 'items[0].id');
    expect(leaf?.normalizedPath).toBe('items[].id');
  });

  it('renders a scalar root as a single row', () => {
    const rows = flattenJson(42, [], NO_RULES);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ path: '', key: null, kind: 'number', displayValue: '42' });
  });
});

describe('truncateStringValue (120-char matrix row)', () => {
  it('truncates past 120 chars with … and leaves shorter strings alone', () => {
    expect(truncateStringValue('a'.repeat(120))).toBe('a'.repeat(120));
    expect(truncateStringValue('a'.repeat(121))).toBe(`${'a'.repeat(120)}…`);
  });

  it('applies inside flattened rows with quotes', () => {
    const rows = flattenJson({ bio: 'b'.repeat(200) }, [], NO_RULES);
    expect(rows[1]?.displayValue).toBe(`"${'b'.repeat(120)}…"`);
  });

  it('escapes control characters so one string stays on one row', () => {
    const rows = flattenJson({ msg: 'line1\nline2\t"q"' }, [], NO_RULES);
    const rendered = rows[1]?.displayValue ?? '';
    expect(rendered).not.toContain('\n');
    expect(rendered).not.toContain('\t');
    expect(rendered).toContain('\\n');
    expect(rendered.split('\n')).toHaveLength(1);
  });

  it('truncates by code points without splitting surrogate pairs', () => {
    expect(truncateStringValue(`a${'😀'.repeat(120)}`)).toBe(`a${'😀'.repeat(119)}…`);
  });
});

describe('fold/unfold (matrix row)', () => {
  const value = { a: { b: { c: 1 } }, d: 2 };

  it('hides children while keeping the folded container row', () => {
    const rows = flattenJson(value, ['a'], NO_RULES);
    expect(rows.map((row) => row.path)).toEqual(['', 'a', 'd']);
    expect(rows[1]).toMatchObject({ folded: true });
  });

  it('toggles one container path on and off', () => {
    expect(toggleFoldPath([], 'a', true)).toEqual(['a']);
    expect(toggleFoldPath(['a'], 'a', true)).toEqual([]);
    expect(toggleFoldPath([], 'a', false)).toBeNull();
    expect(toggleFoldPath([], null, true)).toBeNull();
  });

  it('moves ← on a folded container to its parent row', () => {
    const rows = flattenJson(value, ['a.b'], NO_RULES);
    const foldedIndex = rows.findIndex((row) => row.path === 'a.b');
    expect(rows[foldedIndex]?.folded).toBe(true);
    expect(findParentIndex(rows, foldedIndex)).toBe(rows.findIndex((row) => row.path === 'a'));
  });

  it('moves ← on a leaf to its parent and stays at the root', () => {
    const rows = flattenJson(value, [], NO_RULES);
    const leafIndex = rows.findIndex((row) => row.path === 'd');
    expect(findParentIndex(rows, leafIndex)).toBe(0);
    expect(findParentIndex(rows, 0)).toBeNull();
  });
});

describe('depth levels (+/- matrix row)', () => {
  const value = { a: { b: { c: 1 } }, d: { e: 2 } };

  it('folds the deepest unfolded level first, then the next one up', () => {
    const afterFirst = foldNextDepthLevel(value, []);
    expect(afterFirst).toEqual(['a.b']);
    const afterSecond = foldNextDepthLevel(value, afterFirst);
    expect(afterSecond.sort()).toEqual(['a', 'a.b', 'd']);
    expect(flattenJson(value, afterSecond, NO_RULES).map((row) => row.path)).toEqual(['', 'a', 'd']);
  });

  it('unfolds the shallowest reachable folded level first', () => {
    const folded = ['a', 'a.b', 'd'];
    const afterFirst = unfoldNextDepthLevel(value, folded);
    expect(afterFirst).toEqual(['a.b']);
    const afterSecond = unfoldNextDepthLevel(value, afterFirst);
    expect(afterSecond).toEqual([]);
  });

  it('never folds the root via `-` (that stays a manual ← action)', () => {
    expect(foldNextDepthLevel({ a: 1 }, [])).toEqual([]);
  });

  it('is a no-op (same content, new array) with nothing left to unfold', () => {
    expect(unfoldNextDepthLevel({ a: 1 }, [])).toEqual([]);
    expect(foldNextDepthLevel({ a: 1 }, [])).toEqual([]);
  });

  it('keeps stale folded paths for absent shapes', () => {
    expect(unfoldNextDepthLevel({ a: 1 }, ['gone.deep']).sort()).toEqual(['gone.deep']);
  });

  it('lists containers with fold + reachability state', () => {
    const sites = listTreeContainers(value, ['a']);
    expect(sites.find((site) => site.normalizedPath === 'a')).toMatchObject({ folded: true, reachable: true });
    expect(sites.find((site) => site.normalizedPath === 'a.b')).toMatchObject({ folded: false, reachable: false });
  });
});

describe('global hide (h matrix row)', () => {
  const value = { tags: ['a'], nested: { tags: ['b'], other: 1 } };

  it('hides every line with the key name everywhere', () => {
    const rows = flattenJson(value, [], { ...NO_RULES, hiddenKeys: ['tags'] });
    expect(rows.map((row) => row.path)).toEqual(['', 'nested', 'nested.other']);
  });

  it('hiding a container drops its whole subtree', () => {
    const rows = flattenJson(value, [], { ...NO_RULES, hiddenKeys: ['nested'] });
    expect(rows.map((row) => row.path)).toEqual(['', 'tags', 'tags[0]']);
  });

  it('hidden count is total nodes minus visible rows', () => {
    const total = countJsonNodes(value);
    const rows = flattenJson(value, [], { ...NO_RULES, hiddenKeys: ['tags'] });
    expect(total - rows.length).toBe(4);
  });
});

describe('allow-list (H matrix row)', () => {
  const value = { id: 1, name: 'x', nested: { id: 2, other: 3 }, list: [{ id: 3, z: 4 }] };

  it('shows only listed keys plus structural ancestors', () => {
    const rows = flattenJson(value, [], { ...NO_RULES, onlyKeys: ['id'] });
    expect(rows.map((row) => row.path)).toEqual(['', 'id', 'nested', 'nested.id', 'list', 'list[0]', 'list[0].id']);
  });

  it('shows the full subtree of a matched container', () => {
    const rows = flattenJson({ data: { a: 1, b: 2 }, other: 3 }, [], { ...NO_RULES, onlyKeys: ['data'] });
    expect(rows.map((row) => row.path)).toEqual(['', 'data', 'data.a', 'data.b']);
  });

  it('lets a global hide win over an allow', () => {
    const rows = flattenJson(value, [], { hiddenKeys: ['nested'], onlyKeys: ['id'], hideNulls: false });
    expect(rows.map((row) => row.path)).toEqual(['', 'id', 'list', 'list[0]', 'list[0].id']);
  });
});

describe('hide nulls + rule reducers (filter panel matrix row)', () => {
  const value = { a: null, b: 1, c: { d: null } };

  it('hides null lines but keeps their containers', () => {
    const rows = flattenJson(value, [], { ...NO_RULES, hideNulls: true });
    expect(rows.map((row) => row.path)).toEqual(['', 'b', 'c']);
  });

  it('adds keys with dedupe and rejects key-less rows', () => {
    expect(addHiddenKey(NO_RULES, 'tags')).toMatchObject({ hiddenKeys: ['tags'] });
    expect(addHiddenKey({ ...NO_RULES, hiddenKeys: ['tags'] }, 'tags')).toBeNull();
    expect(addHiddenKey(NO_RULES, null)).toBeNull();
    expect(addOnlyKey(NO_RULES, 'id')).toMatchObject({ onlyKeys: ['id'] });
    expect(addOnlyKey(NO_RULES, null)).toBeNull();
  });

  it('removes the nth listed rule across hide + only rules', () => {
    const rules: TreeFilterRules = { hiddenKeys: ['tags'], onlyKeys: ['id'], hideNulls: false };
    expect(listActiveRules(rules)).toEqual([
      { kind: 'hide', key: 'tags' },
      { kind: 'only', key: 'id' },
    ]);
    expect(removeActiveRule(rules, 0)).toMatchObject({ hiddenKeys: [], onlyKeys: ['id'] });
    expect(removeActiveRule(rules, 1)).toMatchObject({ hiddenKeys: ['tags'], onlyKeys: [] });
    expect(removeActiveRule(rules, 7)).toBeNull();
  });

  it('toggles nulls and clears everything', () => {
    expect(toggleHideNulls(NO_RULES).hideNulls).toBe(true);
    const rules: TreeFilterRules = { hiddenKeys: ['a'], onlyKeys: [], hideNulls: true };
    expect(clearTreeRules(rules)).toEqual({ hiddenKeys: [], onlyKeys: [], hideNulls: false });
    expect(clearTreeRules(NO_RULES)).toBeNull();
  });

  it('counts hide + only + nulls rules', () => {
    expect(countActiveRules(NO_RULES)).toBe(0);
    expect(countActiveRules({ hiddenKeys: ['a'], onlyKeys: ['b'], hideNulls: true })).toBe(3);
  });
});

describe('selection', () => {
  it('clamps into range and resets on empty', () => {
    expect(clampTreeSelection(99, 3)).toBe(2);
    expect(clampTreeSelection(-4, 3)).toBe(0);
    expect(clampTreeSelection(1, 0)).toBe(0);
  });

  it('moves line by line, jumps, and pages by the viewport', () => {
    expect(moveTreeSelection(2, 10, 4, 'up')).toBe(1);
    expect(moveTreeSelection(2, 10, 4, 'down')).toBe(3);
    expect(moveTreeSelection(5, 10, 4, 'home')).toBe(0);
    expect(moveTreeSelection(5, 10, 4, 'end')).toBe(9);
    expect(moveTreeSelection(5, 10, 4, 'page-up')).toBe(1);
    expect(moveTreeSelection(5, 10, 4, 'page-down')).toBe(9);
    expect(moveTreeSelection(0, 10, 4, 'page-up')).toBe(0);
  });
});

describe('resolveTreeKeyAction', () => {
  it('maps navigation keys tree-locally without touching the shared contract', () => {
    expect(resolveTreeKeyAction('', { upArrow: true })).toBe('up');
    expect(resolveTreeKeyAction('', { downArrow: true })).toBe('down');
    expect(resolveTreeKeyAction('', { home: true })).toBe('home');
    expect(resolveTreeKeyAction('', { end: true })).toBe('end');
    expect(resolveTreeKeyAction('', { pageUp: true })).toBe('page-up');
    expect(resolveTreeKeyAction('', { pageDown: true })).toBe('page-down');
    expect(resolveTreeKeyAction('', { leftArrow: true })).toBe('fold');
    expect(resolveTreeKeyAction('', { rightArrow: true })).toBe('unfold');
    expect(resolveTreeKeyAction(' ', {})).toBe('unfold');
    expect(resolveTreeKeyAction('+', {})).toBe('unfold-level');
    expect(resolveTreeKeyAction('-', {})).toBe('fold-level');
    expect(resolveTreeKeyAction('h', {})).toBe('hide-key');
    expect(resolveTreeKeyAction('H', {})).toBe('only-key');
    expect(resolveTreeKeyAction('f', {})).toBe('toggle-panel');
    expect(resolveTreeKeyAction('F', {})).toBe('toggle-panel');
  });

  it('leaves Enter, Esc, digits, and Ctrl combos to the zone', () => {
    expect(resolveTreeKeyAction('\r', { ctrl: false })).toBeNull();
    expect(resolveTreeKeyAction('', {})).toBeNull();
    expect(resolveTreeKeyAction('1', {})).toBeNull();
    expect(resolveTreeKeyAction('q', {})).toBeNull();
    expect(resolveTreeKeyAction('', { upArrow: true, ctrl: true })).toBeNull();
  });
});

describe('resolveTreePanelKeyAction', () => {
  it('removes the nth rule, toggles nulls, clears, and closes', () => {
    expect(resolveTreePanelKeyAction('1', 2)).toEqual({ type: 'remove-rule', index: 0 });
    expect(resolveTreePanelKeyAction('2', 2)).toEqual({ type: 'remove-rule', index: 1 });
    expect(resolveTreePanelKeyAction('3', 2)).toBeNull();
    expect(resolveTreePanelKeyAction('n', 0)).toEqual({ type: 'toggle-nulls' });
    expect(resolveTreePanelKeyAction('c', 0)).toEqual({ type: 'clear-all' });
    expect(resolveTreePanelKeyAction('f', 0)).toEqual({ type: 'close-panel' });
    expect(resolveTreePanelKeyAction('h', 0)).toBeNull();
  });
});

describe('classifyResponseBody (response classification matrix rows)', () => {
  it('treats empty bodies and empty objects/arrays as explicit empty states', () => {
    expect(classifyResponseBody('')).toEqual({ kind: 'empty', emptyKind: 'empty-body' });
    expect(classifyResponseBody('   ')).toEqual({ kind: 'empty', emptyKind: 'empty-body' });
    expect(classifyResponseBody('{}')).toEqual({ kind: 'empty', emptyKind: 'empty-json' });
    expect(classifyResponseBody('[]')).toEqual({ kind: 'empty', emptyKind: 'empty-json' });
  });

  it('parses JSON bodies to trees', () => {
    const classified = classifyResponseBody('{"a":1}');
    expect(classified.kind).toBe('json');
    if (classified.kind === 'json') {
      expect(classified.value).toEqual({ a: 1 });
    }
  });

  it('falls back to raw text with a not-JSON reason under the cap', () => {
    expect(classifyResponseBody('<html>hi</html>')).toEqual({ kind: 'raw', reason: 'not JSON' });
  });

  it('never renders a partial tree at or above the 64 KB cap', () => {
    const bigInvalid = `not json ${'x'.repeat(MAX_BODY_CHARS)}`;
    expect(classifyResponseBody(bigInvalid)).toEqual({ kind: 'raw', reason: 'truncated at 64 KB' });
    const bigValid = `{"data":"${'x'.repeat(MAX_BODY_CHARS)}"}`;
    expect(classifyResponseBody(bigValid)).toEqual({ kind: 'raw', reason: 'truncated at 64 KB' });
  });
});

describe('status line + budgets', () => {
  it('always shows hidden and rule counts', () => {
    expect(formatTreeStatusLine(0, 0)).toBe('0 hidden · 0 rules');
    expect(formatTreeStatusLine(3, 1)).toBe('3 hidden · 1 rule');
    expect(formatTreeStatusLine(5, 2)).toBe('5 hidden · 2 rules');
  });

  it('reserves the status row plus the open panel', () => {
    expect(treePanelLineCount(2)).toBe(5);
    expect(treeChromeRows(false, 2)).toBe(1);
    expect(treeChromeRows(true, 2)).toBe(6);
    expect(resolveTreeListBudget(10, false, 0)).toBe(9);
    expect(resolveTreeListBudget(10, true, 2)).toBe(4);
    expect(resolveTreeListBudget(2, true, 5)).toBe(0);
  });

  it('windows the panel rule rows past 10 instead of growing the chrome', () => {
    expect(treePanelLineCount(10)).toBe(13);
    expect(treePanelLineCount(25)).toBe(13);
    expect(treeChromeRows(true, 25)).toBe(14);
    expect(resolveTreeListBudget(20, true, 25)).toBe(6);
  });
});

describe('pruneJsonTreeStates', () => {
  function statesFor(count: number): Record<string, ReturnType<typeof createDefaultJsonTreeState>> {
    const states: Record<string, ReturnType<typeof createDefaultJsonTreeState>> = {};
    for (let index = 0; index < count; index += 1) {
      states[`GET /r-${index}`] = createDefaultJsonTreeState();
    }
    return states;
  }

  it('keeps the map untouched at or under the limit', () => {
    const states = statesFor(MAX_JSON_TREE_STATES);
    expect(pruneJsonTreeStates(states)).toBe(states);
  });

  it('drops the oldest entries past 50', () => {
    const pruned = pruneJsonTreeStates(statesFor(52));
    expect(Object.keys(pruned)).toHaveLength(50);
    expect(pruned['GET /r-0']).toBeUndefined();
    expect(pruned['GET /r-1']).toBeUndefined();
    expect(pruned['GET /r-51']).toBeDefined();
  });
});
