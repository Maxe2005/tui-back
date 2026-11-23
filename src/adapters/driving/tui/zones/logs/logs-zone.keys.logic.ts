// tui/zones/logs: key predicates, stream-visibility toggles, footer context and legend hints.
import type { LogLine } from '../../../../../core/ports/docker.js';
import type { RestartMode } from '../../../../../core/service-actions/index.js';
import type { Hint } from '../../shared/components/dialogs/hints.js';
import type { FooterContextId } from '../../keybindings/index.js';

// Ctrl+A toggles select-all/deselect-all for the EDT list. A `Ctrl+letter` combo arrives as a
// single control byte (0x01-0x1A) with no shift information — Ink's parse-keypress.js sets
// `key.ctrl` but never `key.shift` on that branch — so Ctrl+Shift+A is indistinguishable from
// Ctrl+A unless the Kitty keyboard protocol is negotiated, which this app doesn't opt into
// (bin/tui.ts's `render()`). One reliable shortcut flips to deselect-all once all are selected.
type SelectAllKey = { ctrl?: boolean };

export function isSelectAllKey(input: string, key: SelectAllKey): boolean {
  return key.ctrl === true && input.toLowerCase() === 'a';
}

export type SelectAllAction = 'select-all' | 'deselect-all';

// `allPaths` is whichever list is currently visible (e.g. the EDT-members list, filtered by
// the active EDT) — flips to deselect-all only once every one of those paths is already in
// `selected`; an empty `allPaths` (nothing to select) resolves to select-all too, but that's
// harmless since selecting an empty list is itself a no-op.
export function resolveSelectAllToggle(allPaths: readonly string[], selected: readonly string[]): SelectAllAction {
  const isAllSelected = allPaths.length > 0 && allPaths.every((path) => selected.includes(path));
  return isAllSelected ? 'deselect-all' : 'select-all';
}

// Ctrl+C and Shift+W apply clear/wrap to every active pane at once, while the bare `c`/`w` stay
// scoped to the sub-focused (or fullscreen) pane. Ctrl+W belongs to the global resize-mode.
type LogsCtrlKey = { ctrl?: boolean };

export function isClearAllLogsKey(input: string, key: LogsCtrlKey): boolean {
  return key.ctrl === true && input.toLowerCase() === 'c';
}

export function isWrapAllLogsKey(input: string, key: LogsCtrlKey): boolean {
  return key.ctrl !== true && input === 'W';
}

// Toggles timestamp/stdout/stderr visibility independently (t/o/p) without reconnecting the
// stream — a pure display filter over the already-buffered lines. stderr is `p`, not `e`: `e` is
// the EDTs zone's tab mnemonic, and every mounted useInput hook receives the same keypress, so it
// would also switch zones (see logsPaneGridArrowsActive in navigation-slice.ts). Wrap is per pane
// (togglePaneWrapFlag/toggleAllPanesWrapFlag below), not a flag here.
export type VisibilityToggle = 'timestamp' | 'stdout' | 'stderr';

export function resolveVisibilityToggleKey(input: string): VisibilityToggle | null {
  if (input === 't') {
    return 'timestamp';
  }
  if (input === 'o') {
    return 'stdout';
  }
  if (input === 'p') {
    return 'stderr';
  }
  return null;
}

export type VisibilityFlags = { showTimestamps: boolean; showStdout: boolean; showStderr: boolean };

export function toggleVisibilityFlag(flags: VisibilityFlags, toggle: VisibilityToggle): VisibilityFlags {
  if (toggle === 'timestamp') {
    return { ...flags, showTimestamps: !flags.showTimestamps };
  }
  if (toggle === 'stdout') {
    return { ...flags, showStdout: !flags.showStdout };
  }
  return { ...flags, showStderr: !flags.showStderr };
}

export const DEFAULT_VISIBILITY_FLAGS: VisibilityFlags = { showTimestamps: true, showStdout: true, showStderr: true };

// Whether a fullscreen pane's footer advertises `R`: a pane known to be container-less does
// not. Display only — whether `R` actually runs is the service-action registry's decision.
export function isPaneRestartAdvertised(pane: { health?: string; noContainer?: boolean } | undefined): boolean {
  return pane === undefined || (pane.health !== 'no-container' && pane.noContainer !== true);
}

// The footer context while an overlay owns the keyboard: the actions menu and the filter editor
// (its history grid is its own sub-mode) sit above the fullscreen pane they may have been
// opened from. A service without a container has no restart, so its fullscreen pane never
// advertises one.
export function logsFooterContext(
  filterEditorOpen: boolean,
  historyGridOpen: boolean,
  fullscreen: { open: boolean; restartable: boolean },
  restartMode: RestartMode = 'simple',
  actionsMenuOpen = false,
  rules: { listOpen: boolean; confirmingClear: boolean } = { listOpen: false, confirmingClear: false },
  setsContext: FooterContextId | null = null,
): FooterContextId | null {
  if (actionsMenuOpen) {
    return 'logs-actions-menu';
  }
  if (filterEditorOpen && setsContext !== null) {
    return setsContext;
  }
  if (filterEditorOpen && rules.listOpen) {
    return rules.confirmingClear ? 'logs-filter-rules-confirm' : 'logs-filter-rules';
  }
  if (filterEditorOpen) {
    return historyGridOpen ? 'logs-filter-history' : 'logs-filter-edit';
  }
  if (!fullscreen.open) {
    return null;
  }
  if (!fullscreen.restartable) {
    return 'logs-fullscreen-no-container';
  }
  return restartMode === 'clean' ? 'logs-fullscreen-clean' : 'logs-fullscreen';
}

// The restart control's hint verb, naming the active mode so the developer sees what `R` will run.
export function restartHintVerb(mode: RestartMode): string {
  return mode === 'clean' ? 'restart (clean)' : 'restart';
}

// The key legend under the service list; the stream toggles show their live state.
export function logsLegendHints(visibility: VisibilityFlags): Hint[] {
  const state = (on: boolean) => (on ? 'on' : 'off');
  return [
    ['Space', 'toggle'],
    ['Enter', 'preview'],
    ['Ctrl+A', 'toggle all'],
    ['t', `timestamps ${state(visibility.showTimestamps)}`],
    ['o', `stdout ${state(visibility.showStdout)}`],
    ['p', `stderr ${state(visibility.showStderr)}`],
    ['Ctrl+↑/↓', 'scroll pane'],
    ['c', 'clear focused pane'],
    ['Ctrl+C', 'clear all panes'],
    ['w', 'wrap/truncate this pane'],
    ['W', 'wrap/truncate all'],
    ['R', 'restart focused pane'],
    ['a', 'actions (focused pane)'],
    ['/', 'edit global filter'],
    ['f', "edit this pane's filter"],
    ['i', 'toggle global filter (pane)'],
    ['Esc', 'clear filter (cascade)'],
  ];
}

export function filterVisibleLines(lines: readonly LogLine[], flags: VisibilityFlags): LogLine[] {
  return lines.filter((line) => (line.stream === 'stdout' ? flags.showStdout : flags.showStderr));
}
