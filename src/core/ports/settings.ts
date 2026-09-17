// core/ports/settings: the Settings model and the port the driven settings adapter
// implements (AD-1). Mirrors core/ports/manifest.ts's shape exactly — a plain interface plus
// a load/save port, no zod/fs import here (that lives in adapters/driven/settings).
//
// Story 2.19: backs the `:settings` screen. Unlike ManifestPort/RegistryPort's load(), a
// corrupt/invalid settings.yaml must never block the screen from opening (Boundaries: "falls
// back... never a crash") — so `load()` is `ok` even on a validation failure, with `settings`
// set to every default and `warning` carrying a human-readable field-naming message. Only a
// genuine I/O error (permission denied, etc.) is an `err` Result.
import type { Result } from '../result.js';

export interface Settings {
  commandPalette: {
    gridMaxRows: number;
  };
  edts: {
    hiddenActionHints: string[];
    // Amended 2026-08-28 (Sprint Change Proposal): the EDT detail pane's "Recent actions" log
    // entry types (create/switch/modify, story 2.15) the developer has chosen to hide — a
    // second, independent settings group on the EDTs tab alongside hiddenActionHints above.
    hiddenActionTypes: string[];
  };
  // Story 5.1: the Logs zone's per-service in-memory ring-buffer size (core/logs/index.ts) —
  // how many lines each active pane's LogsManager entry keeps from the live tail before
  // dropping the oldest. Never persisted to the buffer itself (AD-11: in memory only); this
  // setting only controls its capacity. Captured once per subscription (see LogsManager's own
  // doc comment) — a change here never resizes an already-running stream.
  logs: {
    bufferSize: number;
    // When true, subscribing to a service's logs immediately loads its most recent history
    // (the same fetch a manual scrollback-to-oldest — Ctrl+Up in the grid, Up/Down in
    // fullscreen — would trigger) instead of starting the pane on a genuinely empty buffer and
    // waiting for the live tail to produce its first new line. Default false preserves the
    // pre-existing "starts empty" behavior.
    startWithHistory: boolean;
  };
}

// Single source of truth for every default value — reused by the driven adapter's zod schema
// (so a missing/empty settings.yaml and a corrupt one both fall back to exactly this) and by
// the TUI store's initial state (before the first loadSettings() resolves, and for any
// pre-2.19 `createAppStore()` call left unwired in a test).
export const DEFAULT_SETTINGS: Settings = {
  commandPalette: { gridMaxRows: 8 },
  edts: { hiddenActionHints: [], hiddenActionTypes: [] },
  // Story 5.1's Boundaries: "a per-service in-memory ring buffer sized by
  // settings.logs.bufferSize (default 500 lines)".
  logs: { bufferSize: 500, startWithHistory: false },
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

export interface SettingsLoadResult {
  settings: Settings;
  warning: string | null;
}

export interface SettingsPort {
  load(): Promise<Result<SettingsLoadResult>>;
  save(settings: Settings): Promise<Result<void>>;
}
