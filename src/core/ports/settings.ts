// core/ports/settings: the Settings model, its defaults and valid ranges, and the port the
// driven settings adapter implements. Unlike other ports' load(), a corrupt or invalid
// settings.yaml must never block the `:settings` screen: `load()` is `ok` with every default
// and a field-naming `warning`; only a genuine I/O error is an `err`.
import type { Result } from '../result.js';

export const UPDATE_MERGE_SOURCES = ['shared', 'edt-pending'] as const;
export type UpdateMergeSourceDefault = (typeof UPDATE_MERGE_SOURCES)[number];

// Post-switch service restart (FR-37): `none` is today's behaviour, `simple` a plain container
// restart, `clean` the manifest's clean-restart recipe (simple when none is declared).
export const SWITCH_RESTART_MODES = ['none', 'simple', 'clean'] as const;
export type SwitchRestartMode = (typeof SWITCH_RESTART_MODES)[number];

// none → simple → clean → none (direction -1 goes back) — shared by the :settings control and
// the switch dialog's selector so the two always cycle the same way.
export function cycleSwitchRestartMode(current: SwitchRestartMode, direction: 1 | -1): SwitchRestartMode {
  const index = SWITCH_RESTART_MODES.indexOf(current);
  return SWITCH_RESTART_MODES[(index + direction + SWITCH_RESTART_MODES.length) % SWITCH_RESTART_MODES.length] ?? 'none';
}

// Which drifted services realign selects when no explicit choice is made: none, the drifted
// active-EDT members, or every drifted service (members and other managed repos).
export const REALIGN_SCOPES = ['none', 'edt', 'all'] as const;
export type RealignScope = (typeof REALIGN_SCOPES)[number];

// none → edt → all → none (direction -1 goes back) — shared by the :settings control and the
// realign dialog's preset key, like cycleSwitchRestartMode below.
export function cycleRealignScope(current: RealignScope, direction: 1 | -1): RealignScope {
  const index = REALIGN_SCOPES.indexOf(current);
  return REALIGN_SCOPES[(index + direction + REALIGN_SCOPES.length) % REALIGN_SCOPES.length] ?? 'edt';
}

export interface Settings {
  // The `q` keybinding (quit the app) is global, so it lives on the General tab. Only the raw
  // `q` keypress is gated by this flag; the `:quit` command always works.
  general: {
    quitShortcutEnabled: boolean;
    // The command line the Update zone's "Open in editor" choice runs on a blocked repo
    // (dirty worktree, merge conflict). `<repo>` is replaced by the repo's path — e.g.
    // `code <repo>` opens a VS Code window on the repo with its merge in progress; a
    // command without the placeholder gets the path appended as its last argument. Empty
    // (the default) means `$EDITOR`, falling back to `vi`.
    editorCommand: string;
  };
  commandPalette: {
    gridMaxRows: number;
    // How many recognized commands the `:` bar's recall list (StatePort.readCommandHistory)
    // keeps before trimming the oldest. Same range as logs.filterHistorySize.
    historySize: number;
    // Same semantics as logs.filterHistoryDedup: on = a repeated command moves to the front
    // wherever it was; off = only a repeat of the top entry is deduped.
    historyDedup: boolean;
  };
  edts: {
    hiddenActionHints: string[];
    // The EDT detail pane's "Recent actions" log entry types the developer chose to hide — a
    // second, independent settings group on the EDTs tab alongside hiddenActionHints above.
    hiddenActionTypes: string[];
    // Branch autocomplete dropdown's visible row count (shared BranchAutocompleteInput) — how
    // many substring-matched branches render below the field before a `… N more` overflow
    // line. Applies live on every render; no per-service override.
    branchDropdownMaxRows: number;
  };
  // The Logs zone's per-service in-memory ring-buffer size (core/logs/index.ts) — how many
  // lines each pane keeps from the live tail before dropping the oldest. Captured once per
  // subscription, so a change here never resizes an already-running stream.
  // The group update's bounded pool: how many services update at once (default 3, min 1; 1 is the strictly
  // sequential run). Read when a run starts.
  update: {
    concurrency: number;
    // Global defaults the Update config screen (3.7) seeds its run-wide toggles from, and the
    // CLI `update` falls back to when no explicit flag is passed. Never written back from a run.
    runMigrations: boolean;
    cleanRestart: boolean;
    mergeSource: UpdateMergeSourceDefault;
  };
  // The shared-types zone's option checkboxes' initial state; ticking one in the zone only
  // affects that run and never writes back here.
  sharedTypes: {
    install: boolean;
    cleanRestart: boolean;
    commit: boolean;
    // History view bounds: how many version bumps a by-branch search lists at most, and how
    // many commits it scans at most before giving up.
    historyDepth: number;
    maxCommitsScanned: number;
  };
  // The EDT switch's optional post-switch restart. `restartMode` pre-selects the switch
  // dialog's selector and is the CLI's default when `--restart` is absent; never written back
  // from a single switch. Read when a switch starts, so a change applies live.
  switch: {
    restartMode: SwitchRestartMode;
  };
  // Realign's defaults: the realign dialog's initial preset and restart selector, and the CLI
  // `realign`'s `--scope`/`--restart` when absent. Never written back from a run; read when a
  // realign starts, so a change applies live.
  realign: {
    defaultScope: RealignScope;
    restartMode: SwitchRestartMode;
  };
  logs: {
    bufferSize: number;
    // When true, subscribing to a service's logs immediately loads its most recent history
    // (the same fetch a manual scrollback-to-oldest would trigger) instead of starting the
    // pane on an empty buffer and waiting for the live tail. Default false.
    startWithHistory: boolean;
    // How many committed queries each independent (scope, mode) filter-history list
    // (global-text, global-regex, and per-service-text/per-service-regex for every manifest
    // service path — see StatePort.readFilterHistory/writeFilterHistory) keeps before trimming
    // the oldest entry off the back.
    filterHistorySize: number;
    // The filter-history grid browser's (`↓` on an untouched draft) max rows per column,
    // independent of commandPalette.gridMaxRows — a list of short query strings warrants its
    // own default/range.
    filterHistoryGridMaxRows: number;
    // When true, committing a query already present in its (scope, mode) history list moves
    // it to the front instead of storing a second instance — each filter exists at most once
    // per list. When false, only a repeat of the top entry is deduped (a non-top repeat is
    // stored twice). Toggleable from the Logs settings tab.
    filterHistoryDedup: boolean;
    // How `R` restarts a service in Logs: `simple` is a plain container restart, `clean` runs
    // the manifest's clean-restart recipe (falling back to a simple restart when none is
    // declared). Read on every `R`, so a change applies live. Default `simple`.
    restartMode: 'simple' | 'clean';
  };
  // Per-service local preferences, keyed by the manifest `service` name.
  services: {
    // Services whose `healthUrl` health check is turned off on this machine: the status
    // resolver (core/service-status) resolves them as if no `healthUrl` were declared and never
    // probes them. Unknown names are kept and ignored. Toggled from the :settings Services tab;
    // read at every resolution, so a change applies at the next poll/refresh.
    healthCheckDisabled: string[];
  };
}

// Single source of truth for every default value — reused by the driven adapter's zod schema
// (so a missing/empty settings.yaml and a corrupt one both fall back to exactly this) and by
// the TUI store's initial state (before the first loadSettings() resolves, and for any
// `createAppStore()` call left unwired in a test).
export const DEFAULT_SETTINGS: Settings = {
  // Default true, for anyone who never opens :settings.
  general: { quitShortcutEnabled: true, editorCommand: '' },
  commandPalette: { gridMaxRows: 8, historySize: 20, historyDedup: true },
  edts: { hiddenActionHints: [], hiddenActionTypes: [], branchDropdownMaxRows: 5 },
  // filterHistorySize=20 covers a session's worth of committed filters per (scope, mode) list
  // without state.json growing unbounded; filterHistoryGridMaxRows=8 mirrors
  // commandPalette.gridMaxRows' default, unrelated as the two settings are.
  update: { concurrency: 3, runMigrations: true, cleanRestart: false, mergeSource: 'shared' as const },
  sharedTypes: { install: true, cleanRestart: false, commit: true, historyDepth: 20, maxCommitsScanned: 1000 },
  switch: { restartMode: 'none' },
  realign: { defaultScope: 'edt', restartMode: 'none' },
  logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true, restartMode: 'simple' },
  services: { healthCheckDisabled: [] },
};

// commandPalette.gridMaxRows' valid range — shared by the zod schema (adapters/driven/settings/
// schema.ts, which rejects out-of-range values from a hand-edited settings.yaml) and the
// settings screen's own clamp (adapters/driving/tui/shared/settings-screen.tsx, which keeps
// Up/Down/typed-digit input in range live) so the two can never drift apart.
export const MIN_GRID_MAX_ROWS = 1;
export const MAX_GRID_MAX_ROWS = 99;

// update.concurrency's valid range — shared by the zod schema and the settings screen's clamp.
export const MIN_UPDATE_CONCURRENCY = 1;
export const MAX_UPDATE_CONCURRENCY = 8;

// sharedTypes.historyDepth / maxCommitsScanned valid ranges — shared by the zod schema and the
// settings screen's clamp.
export const MIN_HISTORY_DEPTH = 1;
export const MAX_HISTORY_DEPTH = 200;
export const MIN_MAX_COMMITS_SCANNED = 100;
export const MAX_MAX_COMMITS_SCANNED = 20000;

// logs.bufferSize's valid range — shared by the zod schema (adapters/driven/settings/schema.ts)
// and the settings screen's own clamp (adapters/driving/tui/shared/settings-screen.tsx), same
// "single source of truth for both" convention as MIN/MAX_GRID_MAX_ROWS above. 50 is small
// enough to be a deliberate, memory-conscious choice; 5000 is generous enough for a genuinely
// chatty service without letting a hand-edited settings.yaml balloon every pane's ring buffer
// unboundedly.
export const MIN_LOG_BUFFER_SIZE = 50;
export const MAX_LOG_BUFFER_SIZE = 5000;

// The valid range of every input-history size setting (logs.filterHistorySize,
// commandPalette.historySize) — same single-source-of-truth convention as MIN/MAX_LOG_BUFFER_SIZE
// above, shared by the zod schema and the settings screen's clamp. 1 keeps the feature
// meaningful (a size of 0 would make history pointless); 200 is generous for a list of short
// strings without state.json growing unreasonably.
export const MIN_INPUT_HISTORY_SIZE = 1;
export const MAX_INPUT_HISTORY_SIZE = 200;

// logs.filterHistoryGridMaxRows' valid range — the same bounds as MIN/MAX_GRID_MAX_ROWS, but its
// own pair of constants since the two settings may drift apart on purpose.
export const MIN_FILTER_HISTORY_GRID_MAX_ROWS = 1;
export const MAX_FILTER_HISTORY_GRID_MAX_ROWS = 99;

// edts.branchDropdownMaxRows' valid range (branch autocomplete shared component) — same
// single-source-of-truth convention as MIN/MAX_GRID_MAX_ROWS above, shared by the zod schema
// (adapters/driven/settings/schema.ts) and the settings screen's own clamp
// (adapters/driving/tui/shared/settings-screen.tsx). 1 keeps the dropdown meaningful (0 rows
// would hide every proposal); 20 keeps the dropdown bounded inside a modal dialog.
export const MIN_EDTS_BRANCH_DROPDOWN_MAX_ROWS = 1;
export const MAX_EDTS_BRANCH_DROPDOWN_MAX_ROWS = 20;

export interface SettingsLoadResult {
  settings: Settings;
  warning: string | null;
}

export interface SettingsPort {
  load(): Promise<Result<SettingsLoadResult>>;
  save(settings: Settings): Promise<Result<void>>;
}
