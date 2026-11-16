// core/logs/rule-sets: the persisted Logs filter rules — the tolerant sanitizers for what
// state.json holds (an uncompilable rule or a corrupt value is dropped with a warning naming the
// field, never a failure) and the pure operations of the named rule-set library (save, overwrite,
// apply, rename, delete). Rule shapes are plain JSON: core never imports the TUI's rule types.
import type { StatePort, StoredLogRule, StoredRuleLists, StoredRuleSet } from '../ports/state.js';
import { err, ok, type Result } from '../result.js';

export type { StoredLogRule, StoredRuleLists, StoredRuleSet } from '../ports/state.js';

export const MAX_RULES_PER_LIST = 10;
export const MAX_RULE_SETS = 20;
export const MAX_RULE_SET_NAME_LENGTH = 40;
// The key of the global scope's list in the persisted record (every other key is a repoPath).
export const GLOBAL_RULES_KEY = 'global';

export type Sanitized<T> = { value: T; warnings: string[] };

const RULES_FIELD = 'logRules';
// Names are printable single-line text; control characters would corrupt the one-line rows.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const SETS_FIELD = 'logRuleSets';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Validates one stored rule; the returned string is the reason it must be dropped.
function parseRule(raw: unknown): { rule: StoredLogRule } | { reason: string } {
  if (!isRecord(raw)) {
    return { reason: 'not an object' };
  }
  const { mode, query, action, target, enabled } = raw;
  if (mode !== 'text' && mode !== 'regex') {
    return { reason: 'unknown mode' };
  }
  if (typeof query !== 'string' || query === '') {
    return { reason: 'missing query' };
  }
  if (action !== 'show' && action !== 'hide') {
    return { reason: 'unknown action' };
  }
  if (target !== 'line' && target !== 'match') {
    return { reason: 'unknown target' };
  }
  if (typeof enabled !== 'boolean') {
    return { reason: 'missing enabled flag' };
  }
  if (mode === 'regex') {
    try {
      new RegExp(query, 'gi');
    } catch {
      return { reason: `uncompilable regex "${query}"` };
    }
  }
  return { rule: { mode, query, action, target, enabled } };
}

// One list of rules: each element validated alone, the list clamped to the cap.
function sanitizeRuleList(raw: unknown, path: string, warnings: string[]): StoredLogRule[] | null {
  if (!Array.isArray(raw)) {
    warnings.push(`${path}: expected a list of rules — dropped`);
    return null;
  }
  const rules: StoredLogRule[] = [];
  raw.forEach((element, index) => {
    const parsed = parseRule(element);
    if ('reason' in parsed) {
      warnings.push(`${path}[${index}]: ${parsed.reason} — rule dropped`);
    } else {
      rules.push(parsed.rule);
    }
  });
  if (rules.length > MAX_RULES_PER_LIST) {
    warnings.push(`${path}: more than ${MAX_RULES_PER_LIST} rules — extra rules dropped`);
    return rules.slice(0, MAX_RULES_PER_LIST);
  }
  return rules;
}

// The active rule lists as read from disk (`unknown`): a non-object value is dropped whole, a
// non-list entry drops that scope's list, an uncompilable or malformed rule drops alone. Empty
// lists are not kept.
export function sanitizeStoredRules(raw: unknown): Sanitized<StoredRuleLists> {
  const warnings: string[] = [];
  const value: StoredRuleLists = {};
  if (raw === null || raw === undefined) {
    return { value, warnings };
  }
  if (!isRecord(raw)) {
    warnings.push(`${RULES_FIELD}: expected an object keyed by scope — dropped`);
    return { value, warnings };
  }
  for (const [key, list] of Object.entries(raw)) {
    if (key === '__proto__') {
      warnings.push(`${RULES_FIELD}.${key}: reserved scope key — dropped`);
      continue;
    }
    const rules = sanitizeRuleList(list, `${RULES_FIELD}.${key}`, warnings);
    if (rules !== null && rules.length > 0) {
      value[key] = rules;
    }
  }
  return { value, warnings };
}

// The named-set library as read from disk: a non-list value is dropped whole; a malformed set
// (no usable name, a duplicate name) drops alone; its rules are sanitized like an active list.
export function sanitizeStoredRuleSets(raw: unknown): Sanitized<StoredRuleSet[]> {
  const warnings: string[] = [];
  const value: StoredRuleSet[] = [];
  if (raw === null || raw === undefined) {
    return { value, warnings };
  }
  if (!Array.isArray(raw)) {
    warnings.push(`${SETS_FIELD}: expected a list of sets — dropped`);
    return { value, warnings };
  }
  const seen = new Set<string>();
  raw.forEach((element, index) => {
    const path = `${SETS_FIELD}[${index}]`;
    if (!isRecord(element) || typeof element.name !== 'string' || element.name.trim() === '') {
      warnings.push(`${path}: missing set name — set dropped`);
      return;
    }
    const name = element.name.trim();
    if (name.length > MAX_RULE_SET_NAME_LENGTH || CONTROL_CHARACTERS.test(name)) {
      warnings.push(`${path}: invalid set name (at most ${MAX_RULE_SET_NAME_LENGTH} printable characters) — set dropped`);
      return;
    }
    if (seen.has(name)) {
      warnings.push(`${path}: duplicate set name "${name}" — set dropped`);
      return;
    }
    const rules = sanitizeRuleList(element.rules, `${path}.rules`, warnings);
    if (rules === null) {
      warnings.push(`${path}: set "${name}" dropped`);
      return;
    }
    if (value.length >= MAX_RULE_SETS) {
      warnings.push(`${SETS_FIELD}: more than ${MAX_RULE_SETS} sets — extra sets dropped`);
      return;
    }
    seen.add(name);
    value.push({ name, rules });
  });
  return { value, warnings };
}

// Reads and sanitizes through the port; a failed read is the caller's to surface.
export async function readRuleLists(state: StatePort): Promise<Result<Sanitized<StoredRuleLists>>> {
  const read = await state.readLogRules();
  return read.ok ? ok(sanitizeStoredRules(read.data)) : read;
}

export async function readRuleSets(state: StatePort): Promise<Result<Sanitized<StoredRuleSet[]>>> {
  const read = await state.readLogRuleSets();
  return read.ok ? ok(sanitizeStoredRuleSets(read.data)) : read;
}

function copyRules(rules: readonly StoredLogRule[]): StoredLogRule[] {
  return rules.map((rule) => ({ ...rule }));
}

function validateName(name: string): Result<string> {
  const trimmed = name.trim();
  if (trimmed === '') {
    return err('rule-set-name-empty', 'Enter a name for this set.');
  }
  if (CONTROL_CHARACTERS.test(trimmed)) {
    return err('rule-set-name-invalid', 'Set names cannot contain control characters.');
  }
  if (trimmed.length > MAX_RULE_SET_NAME_LENGTH) {
    return err('rule-set-name-too-long', `Set names are limited to ${MAX_RULE_SET_NAME_LENGTH} characters.`);
  }
  return ok(trimmed);
}

export function findRuleSetIndex(library: readonly StoredRuleSet[], name: string): number {
  return library.findIndex((set) => set.name === name.trim());
}

// Saves a snapshot of `rules` under `name`. An existing name is only replaced with `overwrite`
// (`rule-set-exists` otherwise, so the caller can ask); a new name is refused once the library
// is full. The rules are copied: later edits to the active list never reach the stored set.
export function saveRuleSet(
  library: readonly StoredRuleSet[],
  name: string,
  rules: readonly StoredLogRule[],
  options: { overwrite?: boolean } = {},
): Result<StoredRuleSet[]> {
  const validName = validateName(name);
  if (!validName.ok) {
    return validName;
  }
  if (rules.length === 0) {
    return err('rule-set-no-rules', 'There are no rules to save.');
  }
  if (rules.length > MAX_RULES_PER_LIST) {
    return err('rule-set-too-many-rules', `A set holds at most ${MAX_RULES_PER_LIST} rules.`);
  }
  const entry: StoredRuleSet = { name: validName.data, rules: copyRules(rules) };
  const index = findRuleSetIndex(library, validName.data);
  if (index !== -1) {
    if (options.overwrite !== true) {
      return err('rule-set-exists', `A set named "${validName.data}" already exists.`);
    }
    return ok(library.map((set, i) => (i === index ? entry : set)));
  }
  if (library.length >= MAX_RULE_SETS) {
    return err('rule-set-library-full', `The library is full (${MAX_RULE_SETS} sets) — delete one first.`);
  }
  return ok([...library, entry]);
}

// The rules of one set as an independent copy, ready to become an active list.
export function applyRuleSet(library: readonly StoredRuleSet[], index: number): Result<StoredLogRule[]> {
  const set = library[index];
  return set === undefined ? err('rule-set-not-found', 'That set no longer exists.') : ok(copyRules(set.rules));
}

// Renames one set; only that set changes. A name already used by another set is refused.
export function renameRuleSet(library: readonly StoredRuleSet[], index: number, name: string): Result<StoredRuleSet[]> {
  const current = library[index];
  if (current === undefined) {
    return err('rule-set-not-found', 'That set no longer exists.');
  }
  const validName = validateName(name);
  if (!validName.ok) {
    return validName;
  }
  const clash = findRuleSetIndex(library, validName.data);
  if (clash !== -1 && clash !== index) {
    return err('rule-set-exists', `A set named "${validName.data}" already exists.`);
  }
  return ok(library.map((set, i) => (i === index ? { ...set, name: validName.data } : set)));
}

export function deleteRuleSet(library: readonly StoredRuleSet[], index: number): Result<StoredRuleSet[]> {
  return library[index] === undefined ? err('rule-set-not-found', 'That set no longer exists.') : ok(library.filter((_, i) => i !== index));
}
