import { describe, expect, it, vi } from 'vitest';
import { ok } from '../result.js';
import type { StatePort } from '../ports/state.js';
import {
  applyRuleSet,
  deleteRuleSet,
  MAX_RULE_SET_NAME_LENGTH,
  MAX_RULE_SETS,
  MAX_RULES_PER_LIST,
  readRuleLists,
  readRuleSets,
  renameRuleSet,
  sanitizeStoredRuleSets,
  sanitizeStoredRules,
  saveRuleSet,
  type StoredLogRule,
} from './rule-sets.js';

const rule = (query: string, patch: Partial<StoredLogRule> = {}): StoredLogRule => ({
  mode: 'text',
  query,
  action: 'hide',
  target: 'line',
  enabled: true,
  ...patch,
});

function fakeState(rules: unknown, sets: unknown): StatePort {
  return {
    readLogRules: vi.fn(async () => ok(rules)),
    readLogRuleSets: vi.fn(async () => ok(sets)),
  } as unknown as StatePort;
}

describe('sanitizeStoredRules', () => {
  it('keeps valid lists with order and enabled state', () => {
    const lists = { global: [rule('a'), rule('b', { enabled: false })], '/repo': [rule('c', { mode: 'regex', query: 'x+' })] };
    expect(sanitizeStoredRules(lists)).toEqual({ value: lists, warnings: [] });
  });

  it('drops an uncompilable regex alone and names the field', () => {
    const result = sanitizeStoredRules({ global: [rule('a'), rule('(', { mode: 'regex' }), rule('b')] });
    expect(result.value.global.map((r) => r.query)).toEqual(['a', 'b']);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('logRules.global[1]');
  });

  it('drops a corrupt whole value with a warning naming the field', () => {
    const result = sanitizeStoredRules('oops');
    expect(result.value).toEqual({});
    expect(result.warnings[0]).toContain('logRules');
  });

  it('drops a non-list scope but keeps its siblings', () => {
    const result = sanitizeStoredRules({ global: 'x', '/repo': [rule('a')] });
    expect(Object.keys(result.value)).toEqual(['/repo']);
    expect(result.warnings[0]).toContain('logRules.global');
  });

  it('drops malformed elements and clamps lists to the cap', () => {
    const many = Array.from({ length: MAX_RULES_PER_LIST + 3 }, (_, i) => rule(`r${i}`));
    const result = sanitizeStoredRules({ global: [...many, { query: 'x' }, null] });
    expect(result.value.global).toHaveLength(MAX_RULES_PER_LIST);
    expect(result.warnings.length).toBeGreaterThanOrEqual(3);
  });

  it('treats null as nothing persisted', () => {
    expect(sanitizeStoredRules(null)).toEqual({ value: {}, warnings: [] });
  });
});

describe('sanitizeStoredRuleSets', () => {
  it('keeps valid sets', () => {
    const sets = [{ name: 'noise', rules: [rule('a')] }];
    expect(sanitizeStoredRuleSets(sets)).toEqual({ value: sets, warnings: [] });
  });

  it('drops a non-list library whole with a warning', () => {
    const result = sanitizeStoredRuleSets({ a: 1 });
    expect(result.value).toEqual([]);
    expect(result.warnings[0]).toContain('logRuleSets');
  });

  it('drops bad regex rules, nameless and duplicate sets, and clamps to the cap', () => {
    const sets = [
      { name: 'a', rules: [rule('x'), rule('(', { mode: 'regex' })] },
      { name: '', rules: [] },
      { name: 'a', rules: [] },
      ...Array.from({ length: MAX_RULE_SETS + 2 }, (_, i) => ({ name: `s${i}`, rules: [rule('q')] })),
    ];
    const result = sanitizeStoredRuleSets(sets);
    expect(result.value).toHaveLength(MAX_RULE_SETS);
    expect(result.value[0].rules).toHaveLength(1);
    expect(result.warnings.some((w) => w.includes('logRuleSets[0].rules[1]'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('logRuleSets[1]'))).toBe(true);
  });
});

describe('hostile stored values', () => {
  it('skips a __proto__ scope key with a warning and never pollutes the result', () => {
    const raw = JSON.parse('{"__proto__": [{"mode":"text","query":"x","action":"hide","target":"line","enabled":true}], "global": []}');
    const result = sanitizeStoredRules(raw);
    expect(Object.keys(result.value)).toEqual([]);
    expect(Object.getPrototypeOf(result.value)).toBe(Object.prototype);
    expect(result.warnings.some((w) => w.includes('__proto__'))).toBe(true);
  });

  it('drops sets whose name is over the cap or holds control characters, naming the field', () => {
    const result = sanitizeStoredRuleSets([
      { name: 'x'.repeat(MAX_RULE_SET_NAME_LENGTH + 1), rules: [] },
      { name: 'bad\nname', rules: [] },
      { name: 'ok', rules: [] },
    ]);
    expect(result.value.map((set) => set.name)).toEqual(['ok']);
    expect(result.warnings.some((w) => w.includes('logRuleSets[0]'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('logRuleSets[1]'))).toBe(true);
  });

  it('refuses a control character in a name on save and rename', () => {
    expect(saveRuleSet([], 'a\u0007b', [rule('a')])).toMatchObject({ ok: false, error: { code: 'rule-set-name-invalid' } });
    expect(renameRuleSet([{ name: 'a', rules: [] }], 0, 'a\tb')).toMatchObject({ ok: false, error: { code: 'rule-set-name-invalid' } });
  });
});

describe('read through the port', () => {
  it('sanitizes what the port returns', async () => {
    const state = fakeState({ global: [rule('a')] }, [{ name: 'n', rules: [rule('a')] }]);
    const lists = await readRuleLists(state);
    const sets = await readRuleSets(state);
    expect(lists.ok && lists.data.value.global).toHaveLength(1);
    expect(sets.ok && sets.data.value).toHaveLength(1);
  });
});

describe('library operations', () => {
  it('saves a copy of the rules, so later edits never alter the set', () => {
    const rules = [rule('a')];
    const saved = saveRuleSet([], ' noise ', rules);
    expect(saved.ok && saved.data).toEqual([{ name: 'noise', rules: [rule('a')] }]);
    rules[0].query = 'changed';
    expect(saved.ok && saved.data[0].rules[0].query).toBe('a');
  });

  it('refuses an empty name, empty rules, and an existing name without overwrite', () => {
    const library = [{ name: 'n', rules: [rule('a')] }];
    expect(saveRuleSet(library, '  ', [rule('a')])).toMatchObject({ ok: false, error: { code: 'rule-set-name-empty' } });
    expect(saveRuleSet(library, 'x', [])).toMatchObject({ ok: false, error: { code: 'rule-set-no-rules' } });
    expect(saveRuleSet(library, 'n', [rule('b')])).toMatchObject({ ok: false, error: { code: 'rule-set-exists' } });
  });

  it('overwrites an existing name in place when asked', () => {
    const library = [{ name: 'n', rules: [rule('a')] }, { name: 'm', rules: [rule('z')] }];
    const saved = saveRuleSet(library, 'n', [rule('b')], { overwrite: true });
    expect(saved.ok && saved.data).toEqual([{ name: 'n', rules: [rule('b')] }, library[1]]);
  });

  it('refuses a new set at the cap but still allows an overwrite', () => {
    const full = Array.from({ length: MAX_RULE_SETS }, (_, i) => ({ name: `s${i}`, rules: [rule('a')] }));
    expect(saveRuleSet(full, 'new', [rule('a')])).toMatchObject({ ok: false, error: { code: 'rule-set-library-full' } });
    expect(saveRuleSet(full, 's3', [rule('b')], { overwrite: true }).ok).toBe(true);
  });

  it('applies as an independent copy', () => {
    const library = [{ name: 'n', rules: [rule('a')] }];
    const applied = applyRuleSet(library, 0);
    expect(applied.ok && applied.data).toEqual([rule('a')]);
    if (applied.ok) {
      applied.data[0].query = 'changed';
    }
    expect(library[0].rules[0].query).toBe('a');
    expect(applyRuleSet(library, 4).ok).toBe(false);
  });

  it('renames only the targeted set and refuses clashes and empty names', () => {
    const library = [{ name: 'a', rules: [rule('1')] }, { name: 'b', rules: [rule('2')] }];
    const renamed = renameRuleSet(library, 0, 'c');
    expect(renamed.ok && renamed.data.map((s) => s.name)).toEqual(['c', 'b']);
    expect(renameRuleSet(library, 0, 'b')).toMatchObject({ ok: false, error: { code: 'rule-set-exists' } });
    expect(renameRuleSet(library, 0, '')).toMatchObject({ ok: false, error: { code: 'rule-set-name-empty' } });
    expect(renameRuleSet(library, 0, 'a').ok).toBe(true);
  });

  it('deletes only the targeted set', () => {
    const library = [{ name: 'a', rules: [] }, { name: 'b', rules: [] }];
    const deleted = deleteRuleSet(library, 0);
    expect(deleted.ok && deleted.data.map((s) => s.name)).toEqual(['b']);
    expect(deleteRuleSet(library, 9).ok).toBe(false);
  });
});
