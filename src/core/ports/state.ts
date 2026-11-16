// core/ports/state: the StatePort contract over XDG_STATE_HOME/tui-back/state.json — the
// authoritative record of the active EDT (the TUI store's `activeEdt` is a cache of it), plus
// per-zone splitter ratios, the Logs filter-history lists, the command-bar history and the Logs filter rules (active lists and named sets). Both are keyed by a plain
// `string` because core never imports the TUI's zone or filter types (AD-1); `null` means
// nothing was ever persisted (ENOENT), like `readActiveEdt`.
import type { Result } from '../result.js';

// Plain-JSON shapes of the persisted Logs filter rules (AD-1: no TUI types in core). The active
// lists are keyed by `global` or a service's repoPath; the library is an ordered list of named sets.
export type StoredLogRule = {
  mode: 'text' | 'regex';
  query: string;
  action: 'show' | 'hide';
  target: 'line' | 'match';
  enabled: boolean;
};
export type StoredRuleLists = Record<string, StoredLogRule[]>;
export type StoredRuleSet = { name: string; rules: StoredLogRule[] };

export interface StatePort {
  // null means no EDT has ever been made active (ENOENT / a freshly bootstrapped machine).
  readActiveEdt(): Promise<Result<string | null>>;
  // `null` clears the pointer (the `:reset` command's EDT category) — the schema has always
  // allowed a null activeEdt, so no new method is needed just to unset it.
  writeActiveEdt(ulid: string | null): Promise<Result<void>>;
  readSplitterRatios(): Promise<Result<Record<string, number[]> | null>>;
  writeSplitterRatios(ratios: Record<string, number[]>): Promise<Result<void>>;
  readFilterHistory(): Promise<Result<Record<string, string[]> | null>>;
  writeFilterHistory(history: Record<string, string[]>): Promise<Result<void>>;
  // The `:` command bar's recall list, most recent first — a single flat list (no scope key).
  readCommandHistory(): Promise<Result<string[] | null>>;
  writeCommandHistory(history: string[]): Promise<Result<void>>;
  // The persisted active rule lists and named rule sets. Reads hand back the raw stored value
  // (`unknown`): the file may hold anything, and core/logs/rule-sets sanitizes it element by
  // element, dropping what it cannot trust with a warning.
  readLogRules(): Promise<Result<unknown | null>>;
  writeLogRules(rules: StoredRuleLists): Promise<Result<void>>;
  readLogRuleSets(): Promise<Result<unknown | null>>;
  writeLogRuleSets(sets: StoredRuleSet[]): Promise<Result<void>>;
}
