// core/ports/state: the StatePort contract over XDG_STATE_HOME/tui-back/state.json (AD-10,
// AD-7). state.json is the durable, authoritative record of the active EDT — a TUI's Zustand
// store `activeEdt` field is a hydrated cache of it, re-synced via fs.watch/poll (deferred to
// a follow-up story, see deferred-work.md). Core consumes the contract without ever importing
// the adapter that persists it (AD-1); the driven `state` adapter owns fs/JSON parsing.
import type { Result } from '../result.js';

export interface StatePort {
  // null means no EDT has ever been made active (ENOENT / a freshly bootstrapped machine).
  readActiveEdt(): Promise<Result<string | null>>;
  writeActiveEdt(ulid: string): Promise<Result<void>>;
}
