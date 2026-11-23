// tui/shared/poll: the per-key in-flight guard the status polls share (Logs panes, Logs listed
// rows, Update list). A tick for a key whose previous poll is still awaiting is skipped, so a
// slow health route never stacks probes. Each poll holds a token: stopping the poll releases the
// key, and a late-settling poll of an older token then neither writes state (`isCurrent` is
// false) nor frees a newer poll's entry (`end` only deletes its own token).
export interface InFlightGuard {
  // A token for a new poll of `key`, or null while another poll of `key` is in flight.
  begin(key: string): symbol | null;
  // True while `token` is still the live poll of `key` — check it after every await.
  isCurrent(key: string, token: symbol): boolean;
  // Ends the poll holding `token`; a no-op once the key was released or taken by a newer poll.
  end(key: string, token: symbol): void;
  release(key: string): void;
  releaseAll(): void;
}

export function createInFlightGuard(): InFlightGuard {
  const entries = new Map<string, symbol>();
  return {
    begin(key) {
      if (entries.has(key)) {
        return null;
      }
      const token = Symbol(key);
      entries.set(key, token);
      return token;
    },
    isCurrent: (key, token) => entries.get(key) === token,
    end(key, token) {
      if (entries.get(key) === token) {
        entries.delete(key);
      }
    },
    release(key) {
      entries.delete(key);
    },
    releaseAll() {
      entries.clear();
    },
  };
}
