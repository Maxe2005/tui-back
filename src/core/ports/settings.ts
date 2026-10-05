// core/ports/settings: the Settings model, its defaults and valid ranges, and the port the
// driven settings adapter implements. Unlike other ports' load(), a corrupt or invalid
// settings.yaml must never block the `:settings` screen: `load()` is `ok` with every default
// and a field-naming `warning`; only a genuine I/O error is an `err`.
import type { Result } from '../result.js';

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
  };
}

// Single source of truth for every default value — reused by the driven adapter's zod schema
// (so a missing/empty settings.yaml and a corrupt one both fall back to exactly this) and by
// the TUI store's initial state (before the first loadSettings() resolves, and for any
// `createAppStore()` call left unwired in a test).
export const DEFAULT_SETTINGS: Settings = {
  // Default true, for anyone who never opens :settings.
  general: { quitShortcutEnabled: true, editorCommand: '' },
  commandPalette: { gridMaxRows: 8 },
  edts: { hiddenActionHints: [], hiddenActionTypes: [], branchDropdownMaxRows: 5 },
  // filterHistorySize=20 covers a session's worth of committed filters per (scope, mode) list
  // without state.json growing unbounded; filterHistoryGridMaxRows=8 mirrors
  // commandPalette.gridMaxRows' default, unrelated as the two settings are.
  logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true },
};

// commandPalette.gridMaxRows' valid range — shared by the zod schema (adapters/driven/settings/
// schema.ts, which rejects out-of-range values from a hand-edited settings.yaml) and the
// settings screen's own clamp (adapters/driving/tui/shared/settings-screen.tsx, which keeps
// Up/Down/typed-digit input in range live) so the two can never drift apart.
export const MIN_GRID_MAX_ROWS = 1;
export const MAX_GRID_MAX_ROWS = 99;

// logs.bufferSize's valid range — shared by the zod schema (adapters/driven/settings/schema.ts)
// and the settings screen's own clamp (adapters/driving/tui/shared/settings-screen.tsx), same
// "single source of truth for both" convention as MIN/MAX_GRID_MAX_ROWS above. 50 is small
// enough to be a deliberate, memory-conscious choice; 5000 is generous enough for a genuinely
// chatty service without letting a hand-edited settings.yaml balloon every pane's ring buffer
// unboundedly.
export const MIN_LOG_BUFFER_SIZE = 50;
export const MAX_LOG_BUFFER_SIZE = 5000;

// logs.filterHistorySize's valid range — same single-source-of-truth convention as
// MIN/MAX_LOG_BUFFER_SIZE above, shared by the zod schema and the settings screen's own clamp.
// 1 keeps the feature meaningful (a size of 0 would make history pointless); 200 is generous for
// a list of short query strings without state.json growing unreasonably.
export const MIN_FILTER_HISTORY_SIZE = 1;
export const MAX_FILTER_HISTORY_SIZE = 200;

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
