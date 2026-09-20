// core/ports/state: the StatePort contract over XDG_STATE_HOME/tui-back/state.json (AD-10,
// AD-7). state.json is the durable, authoritative record of the active EDT — a TUI's Zustand
// store `activeEdt` field is a hydrated cache of it, re-synced via fs.watch/poll (deferred to
// a follow-up story, see deferred-work.md). Core consumes the contract without ever importing
// the adapter that persists it (AD-1); the driven `state` adapter owns fs/JSON parsing.
//
// Story 2.21: adds the per-zone splitter-boundary ratios alongside `activeEdt` on the same
// state.json file. Keyed by a plain `string` (not the TUI's `ZoneId`) — core never imports the
// driving-TUI's zone types (AD-1); the driving layer is responsible for narrowing/defaulting
// per zone. `null` means no ratios have ever been persisted (ENOENT / pre-2.21 file), mirroring
// `readActiveEdt`'s own ENOENT -> null convention.
//
// Story 5.4: adds the Logs zone's filter-history lists, same shape/convention as
// `splitterRatios` above — keyed by a plain `string` (the driving layer's
// `filterHistoryKeyString`, logs-zone.logic.ts, encodes/decodes the (scope, mode, repoPath)
// triple into one of these keys; core has no notion of "scope"/"mode"/repoPath, only that each
// key maps to an ordered list of plain query strings, most-recent first). `null` means nothing
// has ever been persisted (ENOENT / pre-5.4 file).
import type { Result } from '../result.js';

export interface StatePort {
  // null means no EDT has ever been made active (ENOENT / a freshly bootstrapped machine).
  readActiveEdt(): Promise<Result<string | null>>;
  writeActiveEdt(ulid: string): Promise<Result<void>>;
  readSplitterRatios(): Promise<Result<Record<string, number[]> | null>>;
  writeSplitterRatios(ratios: Record<string, number[]>): Promise<Result<void>>;
  readFilterHistory(): Promise<Result<Record<string, string[]> | null>>;
  writeFilterHistory(history: Record<string, string[]>): Promise<Result<void>>;
}
