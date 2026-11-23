// tui/zones/logs: log-filter model — rules, scopes, level detection, ANSI-safe compile/apply, formatting.
import type { ServiceBranchDivergence } from '../../../../../../core/edt/list.js';
import type { LogLine } from '../../../../../../core/ports/docker.js';
import { MAX_RULES_PER_LIST } from '../../../../../../core/logs/rule-sets.js';
import type { VisibilityFlags } from '../keys/logs-zone.keys.logic.js';
import { filterVisibleLines } from '../keys/logs-zone.keys.logic.js';

// The two-tier text/regex/level filter over already-buffered lines — a pure, render-time
// transform layered on top of filterVisibleLines above (never touches the subscription).
export type LogFilterMode = 'text' | 'regex';

export type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

// `action` keeps (`show`) or drops (`hide`) what the query matches; `target` says whether the
// unit is the whole line or only the matched text inside it. show+line is the classic filter.
export type LogFilterAction = 'show' | 'hide';

export type LogFilterTarget = 'line' | 'match';

// One rule of a scope's pipeline: `enabled` rules run top to bottom, each one filtering or
// rewriting the output of the previous one; a disabled rule is skipped as if absent.
export type LogFilterRule = {
  mode: LogFilterMode;
  query: string;
  action: LogFilterAction;
  target: LogFilterTarget;
  enabled: boolean;
};

// A scope (the global one, or one service's pane) holds an ordered rule list plus one level
// restriction that is ANDed with the pipeline and judged on the original, unrewritten text.
export type LogFilterScope = {
  level: LogLevel | null;
  rules: readonly LogFilterRule[];
};

export const DEFAULT_LOG_FILTER: LogFilterScope = { level: null, rules: [] };

export const MAX_LOG_FILTER_RULES = MAX_RULES_PER_LIST;

// Shared by every editor change and every pane's "pane filter: on" annotation — a scope with no
// rule and no level restriction is a no-op filter and must never be stored as an explicit
// paneFilters[repoPath] entry (the annotation/hasOwnFilter check keys off entry presence).
export function isDefaultLogFilterScope(scope: LogFilterScope): boolean {
  return scope.level === null && scope.rules.length === 0;
}

// Level filtering has no source field (LogLine has no level), so it uses a text heuristic
// (ERROR|WARN|INFO|DEBUG, case-insensitive) against line.text. Only the *first* matching token
// counts — real log lines never carry more than one level tag, and picking the first keeps this
// a total, order-independent function of the raw text.
const LOG_LEVEL_PATTERN = /\b(ERROR|WARN|INFO|DEBUG)\b/i;

export function detectLogLevel(text: string): LogLevel | null {
  const match = LOG_LEVEL_PATTERN.exec(splitAnsi(text).visible);
  return match === null ? null : (match[1].toUpperCase() as LogLevel);
}

// An invalid regex shows an inline error in the editor and is never applied, never thrown into
// the render tree — `compileLogFilter` is the one place a malformed pattern may throw (RegExp's
// constructor), caught here and turned into a typed failure the editor surfaces as text.
// `apply` returns the line as it should be displayed (a new object when the text was rewritten,
// the stored line untouched otherwise) or `null` when the line must not be displayed.
export type CompiledLogFilter =
  | { ok: true; apply: (line: LogLine) => LogLine | null }
  | { ok: false; error: string };

// Colourised logs carry CSI escape sequences (`ESC [ … final byte`) inside the text. Rules and level
// detection work on the visible text; `escapes` remembers each sequence and the visible offset it
// sat in front of, so a rewritten line can keep every colour code.
const CSI_SEQUENCE = /\u001b\[[0-?]*[ -/]*[@-~]/g;

type AnsiSplit = { visible: string; escapes: Array<{ at: number; sequence: string }> };

function splitAnsi(text: string): AnsiSplit {
  if (!text.includes('\u001b')) {
    return { visible: text, escapes: [] };
  }
  const escapes: AnsiSplit['escapes'] = [];
  let visible = '';
  let cursor = 0;
  for (const match of text.matchAll(CSI_SEQUENCE)) {
    visible += text.slice(cursor, match.index);
    escapes.push({ at: visible.length, sequence: match[0] });
    cursor = match.index + match[0].length;
  }
  return { visible: visible + text.slice(cursor), escapes };
}

// Rebuilds a line from the kept visible ranges (ordered, non-overlapping), joined by `separator`,
// re-inserting every escape sequence in its original order so kept characters keep their colours.
function rebuildWithEscapes(split: AnsiSplit, kept: Array<[number, number]>, separator: string): string {
  let result = '';
  let escapeIndex = 0;
  const flushEscapes = (upTo: number): void => {
    while (escapeIndex < split.escapes.length && split.escapes[escapeIndex].at <= upTo) {
      result += split.escapes[escapeIndex].sequence;
      escapeIndex += 1;
    }
  };
  kept.forEach(([start, end], index) => {
    if (index > 0) {
      result += separator;
    }
    for (let position = start; position < end; position += 1) {
      flushEscapes(position);
      result += split.visible[position];
    }
  });
  flushEscapes(split.visible.length);
  return result;
}

// Every non-empty match of `query` in `text`, as [start, end) ranges. Empty matches (e.g. `a*`)
// are skipped, and the scan always advances, so a pattern that can match nothing cannot loop.
function findMatchRanges(text: string, matcher: RegExp): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  matcher.lastIndex = 0;
  for (;;) {
    const match = matcher.exec(text);
    if (match === null) {
      return ranges;
    }
    if (match[0].length === 0) {
      matcher.lastIndex += 1;
      if (matcher.lastIndex > text.length) {
        return ranges;
      }
      continue;
    }
    ranges.push([match.index, match.index + match[0].length]);
  }
}

export function compileLogFilter(spec: Pick<LogFilterRule, 'mode' | 'query' | 'action' | 'target'>): CompiledLogFilter {
  let matcher: RegExp | null = null;
  if (spec.query !== '') {
    if (spec.mode === 'regex') {
      try {
        matcher = new RegExp(spec.query, 'gi');
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Invalid regular expression' };
      }
    } else {
      // Matching on the original text (never a lowercased copy) keeps ranges aligned for
      // characters whose lowercase form has a different length.
      matcher = new RegExp(spec.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    }
  }
  const { action, target } = spec;
  return {
    ok: true,
    apply: (line) => {
      if (matcher === null) {
        return line;
      }
      const split = splitAnsi(line.text);
      const ranges = findMatchRanges(split.visible, matcher);
      if (target === 'line') {
        return (ranges.length > 0) === (action === 'show') ? line : null;
      }
      if (ranges.length === 0) {
        return action === 'show' ? null : line;
      }
      let kept = ranges;
      let separator = ' ';
      if (action === 'hide') {
        kept = [];
        separator = '';
        let cursor = 0;
        for (const [start, end] of ranges) {
          if (start > cursor) {
            kept.push([cursor, start]);
          }
          cursor = end;
        }
        if (cursor < split.visible.length) {
          kept.push([cursor, split.visible.length]);
        }
      }
      if (kept.every(([start, end]) => split.visible.slice(start, end).trim() === '')) {
        return null;
      }
      return { ...line, text: rebuildWithEscapes(split, kept, separator) };
    },
  };
}

// The inline error for a rule draft that does not compile, or null. Whether the query is
// non-empty is checked separately, on commit.
export function validateRuleDraft(draft: Pick<LogFilterRule, 'mode' | 'query' | 'action' | 'target'>): string | null {
  const compiled = compileLogFilter(draft);
  return compiled.ok ? null : compiled.error;
}

// The rule pipeline over already-visible lines. Each scope's level restriction is judged on the
// original text; then the global scope's enabled rules run (when given), then the pane's own, each
// rule seeing the previous rule's output. A rule that fails to compile is treated as pass-through
// rather than thrown or silently hiding every line — defensive only, since the editor never
// commits an uncompilable rule.
export function applyLogRules(lines: readonly LogLine[], global: LogFilterScope | null, own: LogFilterScope | null): LogLine[] {
  const levels = [global?.level ?? null, own?.level ?? null].filter((level): level is LogLevel => level !== null);
  const pipeline = [...(global?.rules ?? []), ...(own?.rules ?? [])]
    .filter((rule) => rule.enabled)
    .map((rule) => compileLogFilter(rule));
  const result: LogLine[] = [];
  for (const original of lines) {
    if (levels.length > 0) {
      const detected = detectLogLevel(original.text);
      if (levels.some((level) => level !== detected)) {
        continue;
      }
    }
    let line: LogLine | null = original;
    for (const compiled of pipeline) {
      if (line === null) {
        break;
      }
      if (compiled.ok) {
        line = compiled.apply(line);
      }
    }
    if (line !== null) {
      result.push(line);
    }
  }
  return result;
}

// Shared by LogsPaneView and FullscreenPane (both call applyLogRules right after
// filterVisibleLines, the layer the stdout/stderr toggle lives on). A pane's effective pipeline is
// (engaged ? global : nothing) followed by (own ?? nothing).
export function resolveEffectiveLines(
  pane: { lines: readonly LogLine[] } | undefined,
  visibility: VisibilityFlags,
  globalFilter: LogFilterScope,
  engaged: boolean,
  ownFilter: LogFilterScope | null,
): LogLine[] {
  if (!pane) {
    return [];
  }
  return applyLogRules(filterVisibleLines(pane.lines, visibility), engaged ? globalFilter : null, ownFilter);
}

// Per-pane engagement with the global filter, keyed by repoPath — mirrors isPaneWrapped/
// togglePaneWrapFlag's shape, but defaults to `true` (every pane is engaged by default).
export const DEFAULT_PANE_GLOBAL_FILTER_ENGAGED = true;

export function isPaneEngagedInGlobalFilter(engagedByPath: Readonly<Record<string, boolean>>, repoPath: string | null): boolean {
  if (repoPath === null) {
    return DEFAULT_PANE_GLOBAL_FILTER_ENGAGED;
  }
  return engagedByPath[repoPath] ?? DEFAULT_PANE_GLOBAL_FILTER_ENGAGED;
}

// The `i` key's toggle (an explicit flip, either direction).
export function toggleGlobalFilterEngagement(engagedByPath: Readonly<Record<string, boolean>>, repoPath: string): Record<string, boolean> {
  return { ...engagedByPath, [repoPath]: !isPaneEngagedInGlobalFilter(engagedByPath, repoPath) };
}

// Escape's own disengage step (resolveFilterClearTarget's 'pane-disengage' target) is a
// one-way "set to disengaged", never a toggle — pressing Escape again on an already-disengaged
// pane must stay a no-op, not re-engage it.
export function setPaneGlobalFilterEngagement(
  engagedByPath: Readonly<Record<string, boolean>>,
  repoPath: string,
  engaged: boolean,
): Record<string, boolean> {
  return { ...engagedByPath, [repoPath]: engaged };
}

export function setPaneLogFilter(
  paneFilters: Readonly<Record<string, LogFilterScope>>,
  repoPath: string,
  scope: LogFilterScope | null,
): Record<string, LogFilterScope> {
  if (scope === null || isDefaultLogFilterScope(scope)) {
    const next = { ...paneFilters };
    delete next[repoPath];
    return next;
  }
  return { ...paneFilters, [repoPath]: scope };
}

// Pure rule-list operations. Each returns the new scope (the input is never mutated); the ones
// that can be refused or are out of range return it unchanged / null as documented.
export function addLogRule(scope: LogFilterScope, rule: LogFilterRule): LogFilterScope | null {
  return scope.rules.length >= MAX_LOG_FILTER_RULES ? null : { ...scope, rules: [...scope.rules, rule] };
}

export function replaceLogRule(scope: LogFilterScope, index: number, rule: LogFilterRule): LogFilterScope {
  return index < 0 || index >= scope.rules.length ? scope : { ...scope, rules: scope.rules.map((current, i) => (i === index ? rule : current)) };
}

export function toggleLogRule(scope: LogFilterScope, index: number): LogFilterScope {
  const rule = scope.rules[index];
  return rule === undefined ? scope : replaceLogRule(scope, index, { ...rule, enabled: !rule.enabled });
}

export function deleteLogRule(scope: LogFilterScope, index: number): LogFilterScope {
  return index < 0 || index >= scope.rules.length ? scope : { ...scope, rules: scope.rules.filter((_, i) => i !== index) };
}

// Swaps a rule with its neighbour; at either end it is a no-op.
export function moveLogRule(scope: LogFilterScope, index: number, direction: 'up' | 'down'): LogFilterScope {
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || index >= scope.rules.length || target < 0 || target >= scope.rules.length) {
    return scope;
  }
  const rules = [...scope.rules];
  [rules[index], rules[target]] = [rules[target], rules[index]];
  return { ...scope, rules };
}

// The draft the rule editor opens on: an existing rule, or a fresh show+line text rule.
export function ruleDraftOf(rule: LogFilterRule | null): Pick<LogFilterRule, 'mode' | 'query' | 'action' | 'target'> {
  return rule === null
    ? { mode: 'text', query: '', action: 'show', target: 'line' }
    : { mode: rule.mode, query: rule.query, action: rule.action, target: rule.target };
}

// The rule list's Ctrl+Left/Right keys cycle a scope's level restriction through "no
// restriction" and each of the four detectable levels.
export const LOG_FILTER_LEVEL_CYCLE: readonly (LogLevel | null)[] = [null, 'ERROR', 'WARN', 'INFO', 'DEBUG'];

export function cycleFilterLevel(current: LogLevel | null, direction: 'next' | 'previous'): LogLevel | null {
  const idx = LOG_FILTER_LEVEL_CYCLE.indexOf(current);
  const safeIdx = idx === -1 ? 0 : idx;
  const delta = direction === 'next' ? 1 : -1;
  const nextIdx = (safeIdx + delta + LOG_FILTER_LEVEL_CYCLE.length) % LOG_FILTER_LEVEL_CYCLE.length;
  return LOG_FILTER_LEVEL_CYCLE[nextIdx];
}

export function toggleFilterMode(mode: LogFilterMode): LogFilterMode {
  return mode === 'text' ? 'regex' : 'text';
}

export function isDefaultActionTarget(action: LogFilterAction, target: LogFilterTarget): boolean {
  return action === 'show' && target === 'line';
}

export function toggleFilterAction(action: LogFilterAction): LogFilterAction {
  return action === 'show' ? 'hide' : 'show';
}

export function toggleFilterTarget(target: LogFilterTarget): LogFilterTarget {
  return target === 'line' ? 'match' : 'line';
}

// The compact action/target indicator shown beside the query, e.g. `show line`, `hide match`.
export function formatFilterActionTarget(action: LogFilterAction, target: LogFilterTarget): string {
  return `${action} ${target}`;
}

// One rule as a list row, e.g. `[x] hide match text "Aucun service"` (`[ ]` when disabled).
export function formatLogRule(rule: LogFilterRule): string {
  // Whitespace and control characters (newlines included) collapse so a row stays on one line.
  const query = rule.query.replace(/[\s\u0000-\u001f\u007f]+/g, ' ');
  return `${rule.enabled ? '[x]' : '[ ]'} ${formatFilterActionTarget(rule.action, rule.target)} ${rule.mode} "${query}"`;
}

// A short human-readable rendering of a scope, e.g. `3 rules (1 off) [ERROR]` — used on the
// pane/fullscreen annotations so a user can tell *what* is filtering a pane without reopening its
// editor.
export function formatLogFilterScope(scope: LogFilterScope): string {
  const levelPart = scope.level !== null ? ` [${scope.level}]` : '';
  const total = scope.rules.length;
  if (total === 0) {
    return `(any)${levelPart}`;
  }
  const off = scope.rules.filter((rule) => !rule.enabled).length;
  const rulesPart = `${total} ${total === 1 ? 'rule' : 'rules'}${off > 0 ? ` (${off} off)` : ''}`;
  return `${rulesPart}${levelPart}`;
}

// Escape, when no editor is open: on a sub-focused grid pane (not fullscreen), clears that pane's
// own filter if set, else disengages it from the global filter; with no pane sub-focused
// (list-focus), clears the global filter entirely. A pure resolver — logs-zone.tsx's useInput
// dispatches the returned target.
export type FilterClearTarget =
  | { scope: 'pane-own'; repoPath: string }
  | { scope: 'pane-disengage'; repoPath: string }
  | { scope: 'global' };

export function resolveFilterClearTarget(paneSubFocused: boolean, repoPath: string | null, hasOwnFilter: boolean): FilterClearTarget {
  if (paneSubFocused && repoPath !== null) {
    return hasOwnFilter ? { scope: 'pane-own', repoPath } : { scope: 'pane-disengage', repoPath };
  }
  return { scope: 'global' };
}

export function formatLogLine(line: LogLine, showTimestamps: boolean): string {
  return showTimestamps ? `[${line.timestamp}] ${line.text}` : line.text;
}

// Any manifest service can be streamed, not only active-EDT members — a service row identity,
// kept minimal (only what a pane/subscription needs) rather than reusing ServiceBranchDivergence.
export type LogsServiceRow = Pick<ServiceBranchDivergence, 'service' | 'path'>;
