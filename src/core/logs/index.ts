// core/logs: LogsManager — the per-service in-memory ring buffer every log-stream subscription
// flows through. Stateful, unlike most of core, because log lines live only in memory (AD-11).
// One instance per TUI store; subscriptions are keyed by a caller-chosen string (the TUI uses
// the service's repoPath). bufferSize is captured per subscription, so a settings change never
// resizes a buffer already in flight.
import { err, ok, type Result } from '../result.js';
import type { DockerErrorLike, DockerPort, LogLine } from '../ports/docker.js';

export interface LogsManagerEntry {
  lines: LogLine[];
  // Set the moment the stream reports a failure (start failure, or dying mid-flight) — never
  // cleared automatically; a fresh `subscribe()` call clears it again before trying.
  streamError: DockerErrorLike | null;
  // Set once a `loadOlder` fetch comes back empty or itself fails — a failed fetch and a
  // genuinely-exhausted history render identically: there is nothing more to load.
  noMoreHistory: boolean;
}

const EMPTY_ENTRY: LogsManagerEntry = { lines: [], streamError: null, noMoreHistory: false };

interface InternalEntry {
  lines: LogLine[];
  streamError: DockerErrorLike | null;
  noMoreHistory: boolean;
  bufferSize: number;
  stop: (() => void) | null;
}

export interface LogsManager {
  // Starts (or, if already subscribed, no-ops on) a live stream for `key`/`container`.
  // `onUpdate` fires synchronously every time this entry's own state changes (a new line, a
  // stream error) — the caller re-reads `getEntry(key)` from it to mirror the new state into
  // its own reactive store. Returns `err('docker-unavailable', ...)` when the very first
  // attempt to start the stream fails; a later failure is reported only through
  // `onUpdate`/`getEntry` (`subscribe` itself returns synchronously).
  subscribe(key: string, container: string, bufferSize: number, onUpdate: () => void): Result<void>;
  // Tears down key's subscription (idempotent — a key that was never subscribed, or already
  // unsubscribed, is a no-op) and discards its buffered lines: the ring buffer only exists
  // while something is actually watching it.
  unsubscribe(key: string): void;
  isSubscribed(key: string): boolean;
  // A snapshot copy — never the live internal array — so a caller can freely hold onto it
  // (e.g. to diff against a previous render) without the manager's own next push mutating it
  // out from under them.
  getEntry(key: string): LogsManagerEntry;
  // Fetches the next `bufferSize` lines strictly older than this key's own oldest buffered
  // line (or "now" when nothing is buffered yet) and prepends them. Never rejects: any
  // adapter-level failure, or a genuinely-empty result, both fold into `noMoreHistory: true`
  // on this entry and an `ok` Result with `appended: 0` — see `LogsManagerEntry.noMoreHistory`'s
  // own comment for why. Returns `ok({ appended: 0 })` for an unknown key too, rather than an
  // error, since "load older for a key nobody subscribed to" has nothing meaningful to do.
  loadOlder(key: string, container: string): Promise<Result<{ appended: number }>>;
  // Wipes this key's buffered lines (a display "clear", like a shell's `clear`/Ctrl+L) without
  // touching its live subscription — the stream keeps running and future lines keep arriving
  // normally. Also resets `noMoreHistory`: clearing conceptually forgets everything this pane
  // ever loaded, including "there's nothing further back", so a subsequent scrollback should
  // be free to try fetching history again rather than staying stuck at a pre-clear edge. A key
  // nobody subscribed to is a no-op, same idempotent-on-unknown-key convention as
  // unsubscribe/loadOlder above.
  clear(key: string): void;
}

function readStreamError(entry: InternalEntry): DockerErrorLike | null {
  return entry.streamError;
}

export function createLogsManager(docker: DockerPort): LogsManager {
  const entries = new Map<string, InternalEntry>();

  function ensure(key: string, bufferSize: number): InternalEntry {
    const existing = entries.get(key);
    if (existing) {
      return existing;
    }
    const created: InternalEntry = { lines: [], streamError: null, noMoreHistory: false, bufferSize, stop: null };
    entries.set(key, created);
    return created;
  }

  function pushLine(entry: InternalEntry, line: LogLine): void {
    entry.lines.push(line);
    if (entry.lines.length > entry.bufferSize) {
      entry.lines.splice(0, entry.lines.length - entry.bufferSize);
    }
  }

  return {
    subscribe(key, container, bufferSize, onUpdate) {
      const existing = entries.get(key);
      if (existing?.stop) {
        // Already streaming — idempotent: re-selecting a service, or a fullscreen preview on
        // an already-selected row, must never spawn a second child process for the same key.
        return ok(undefined);
      }
      const entry = ensure(key, bufferSize);
      entry.bufferSize = bufferSize;
      entry.streamError = null;
      const stop = docker.streamLogs(
        container,
        (line) => {
          pushLine(entry, line);
          onUpdate();
        },
        (error) => {
          entry.streamError = error;
          onUpdate();
        },
      );
      entry.stop = stop;
      // A failure the adapter can detect immediately (docker binary missing, daemon
      // unreachable, container not found) calls `onError` synchronously, before `streamLogs`
      // returns — `entry.streamError` is already set here in that case, so this first attempt
      // surfaces it as a real Result. Read through a helper (rather than `entry.streamError`
      // inline) so TS doesn't (unsoundly) keep narrowing this property to the `null` literal it
      // was assigned above, ignoring that `docker.streamLogs` may have reassigned it via the
      // `onError` callback.
      const streamError = readStreamError(entry);
      if (streamError !== null) {
        entry.stop = null;
        return err(streamError.code, streamError.message);
      }
      return ok(undefined);
    },
    unsubscribe(key) {
      const entry = entries.get(key);
      if (entry?.stop) {
        entry.stop();
      }
      entries.delete(key);
    },
    isSubscribed(key) {
      return entries.get(key)?.stop != null;
    },
    getEntry(key) {
      const entry = entries.get(key);
      if (!entry) {
        return EMPTY_ENTRY;
      }
      return { lines: [...entry.lines], streamError: entry.streamError, noMoreHistory: entry.noMoreHistory };
    },
    async loadOlder(key, container) {
      const entry = entries.get(key);
      if (!entry) {
        return ok({ appended: 0 });
      }
      if (entry.noMoreHistory) {
        return ok({ appended: 0 });
      }
      const cursor = entry.lines[0]?.timestamp ?? new Date().toISOString();
      const fetched = await docker.fetchLogsBefore(container, cursor, entry.bufferSize);
      if (!fetched.ok || fetched.data.length === 0) {
        entry.noMoreHistory = true;
        return ok({ appended: 0 });
      }
      // `beforeCursor` is exclusive in intent, but the adapter's own `--until` is not
      // guaranteed to exclude a line sharing the exact same timestamp as the current oldest
      // buffered line — without this filter, that line could be re-fetched and re-prepended as
      // a visible duplicate on a later scrollback call.
      const newLines = fetched.data.filter((line) => line.timestamp < cursor);
      if (newLines.length === 0) {
        entry.noMoreHistory = true;
        return ok({ appended: 0 });
      }
      entry.lines = [...newLines, ...entry.lines];
      return ok({ appended: newLines.length });
    },
    clear(key) {
      const entry = entries.get(key);
      if (!entry) {
        return;
      }
      entry.lines = [];
      entry.noMoreHistory = false;
    },
  };
}
