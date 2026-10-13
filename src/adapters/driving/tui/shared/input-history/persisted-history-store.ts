// A generic persisted-history store controller: the mechanics both history stores
// (Logs filter history, command history) need around a StatePort read/write pair, written once.
//   - hydrate-once: `load` reads the persisted value and hands it to the caller.
//   - version guard: a read that started before a newer live mutation never clobbers it.
//   - serialized save chain: writes land on disk in request order.
//   - await-in-flight-load: a mutation never runs on the still-empty pre-load value, which would
//     persist it wholesale and discard whatever was on disk.
// The caller owns where the value lives (the zustand store); this controller only sequences it.
import type { Result } from '../../../../../core/result.js';

export type PersistedHistoryStoreDeps<T> = {
  read: () => Promise<Result<T | null>>;
  write: (value: T) => Promise<Result<void>>;
};

export type PersistedHistoryStore<T> = {
  // Reads the persisted value once and passes it to `apply`, unless a mutation landed meanwhile
  // or nothing usable is persisted (missing file, I/O error, corrupt field → keep the default).
  load: (apply: (value: T) => void) => Promise<void>;
  // Applies a mutation (after any in-flight load settled) and persists the snapshot it returns.
  // Fire-and-forget: the live store updates synchronously inside `apply`.
  mutate: (apply: () => T) => void;
  // Applies a reset, then resolves only once every already-queued write has landed, so the
  // reset's own disk write can't be overwritten by a save that was still pending.
  resetAndDrain: (apply: () => void) => Promise<void>;
};

export function createPersistedHistoryStore<T>(deps: PersistedHistoryStoreDeps<T> | null): PersistedHistoryStore<T> {
  let saveChain: Promise<void> = Promise.resolve();
  let version = 0;
  let loadPromise: Promise<void> | null = null;

  function persist(next: T): void {
    if (!deps) {
      return;
    }
    const run = async () => {
      await deps.write(next);
    };
    saveChain = saveChain.then(run, run);
  }

  return {
    load: async (apply) => {
      if (!deps) {
        return;
      }
      // Captured before the await: a mutation landing while this read is in flight bumps the
      // version, and the stale result below must never clobber that newer live value.
      const startVersion = version;
      const promise = (async () => {
        const result = await deps.read();
        if (version !== startVersion) {
          return;
        }
        if (!result.ok || result.data === null) {
          return;
        }
        apply(result.data);
      })();
      // Published before awaiting, cleared only once this exact call settles.
      loadPromise = promise;
      try {
        await promise;
      } finally {
        if (loadPromise === promise) {
          loadPromise = null;
        }
      }
    },
    mutate: (apply) => {
      const run = async () => {
        if (loadPromise) {
          await loadPromise;
        }
        version += 1;
        persist(apply());
      };
      void run();
    },
    resetAndDrain: async (apply) => {
      if (loadPromise) {
        await loadPromise;
      }
      version += 1;
      apply();
      // A mutator's `run` may itself queue a new save while we wait — loop until the chain
      // stops growing.
      let pending: Promise<void>;
      do {
        pending = saveChain;
        await pending;
      } while (pending !== saveChain);
    },
  };
}
