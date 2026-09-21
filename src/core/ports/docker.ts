// core/ports/docker: story 5.1's DockerPort — the single Docker touchpoint every log stream
// flows through (AD-1). Core consumes this port without ever importing the driven docker
// adapter (adapters/driven/docker), which shells the real `docker` binary via
// node:child_process (spawn for the live tail, spawnSync for a one-shot older-lines fetch),
// mirroring adapters/driven/git/index.ts's own shell-out convention — no new dependency (no
// dockerode).
//
// `streamLogs` is fire-and-forget from the caller's point of view: it starts a long-lived
// subscription immediately and returns a `stop` function, never a Result — any failure to
// even start (docker binary missing, daemon unreachable, container not found) is reported
// asynchronously (in practice, synchronously before `streamLogs` returns — see the adapter's
// own doc comment) via `onError`, exactly once per failed attempt, never thrown. A line
// arriving on either stdout or stderr is tagged before it ever reaches `onLine` so the ring
// buffer (core/logs/index.ts) never has to guess which stream a line came from.
import type { Result } from '../result.js';

export type LogStreamTag = 'stdout' | 'stderr';

export interface LogLine {
  // ISO-8601 timestamp — Docker's own `--timestamps` output for a fetched/replayed line, or
  // the receipt time for a freshly streamed line (see the adapter's own comment on why those
  // two sources differ slightly). Never fabricated as "now" for a historical line.
  timestamp: string;
  stream: LogStreamTag;
  text: string;
}

export interface DockerErrorLike {
  code: string;
  message: string;
}

export type HealthState = 'up' | 'down' | 'restarting';

export interface DockerPort {
  // Starts a long-lived subscription to `container`'s logs (docker adapter: `docker logs -f
  // --timestamps --since <now> <container>`, one child process per call). `onLine` fires once
  // per line, tagged stdout/stderr. `onError` fires at most... in practice however many times
  // a real failure occurs (start failure, or the stream dying mid-flight) — the caller
  // (core/logs/index.ts) treats every call as "this subscription is now broken" and never
  // assumes exactly-once. Returns a `stop` function that tears the subscription down
  // (idempotent — safe to call more than once, safe to call after the stream already died on
  // its own).
  streamLogs(container: string, onLine: (line: LogLine) => void, onError: (error: DockerErrorLike) => void): () => void;
  // One-shot fetch of up to `count` lines strictly before `beforeCursor` (an ISO timestamp),
  // most-recent-first-trimmed-then-chronologically-ordered (docker adapter: `docker logs
  // --until <beforeCursor> --tail <count> --timestamps <container>` via spawnSync — never
  // called from the Ink render loop, only from an async store action reacting to a keypress,
  // mirroring every other spawnSync call in this codebase).
  fetchLogsBefore(container: string, beforeCursor: string, count: number): Promise<Result<LogLine[]>>;
  // Live container health (story 5.3) — `docker inspect` mapped to HealthState: container
  // missing/inspect fails → `down`; `State.Restarting` true → `restarting`; `State.Running`
  // true → `up`; otherwise → `down`. A spawn-level failure (binary missing, timeout) is an
  // `err('docker-unavailable', ...)` so a scheduled poll can keep last-known health; a
  // definitive non-zero inspect (e.g. no such container) is `ok('down')`.
  getContainerHealth(container: string): Promise<Result<HealthState>>;
  // Developer-triggered restart only (story 5.3, replaces check_health.sh's auto-restart —
  // never called automatically). `docker restart` one-shot via spawnSync, same idiom as
  // fetchLogsBefore.
  restartContainer(container: string): Promise<Result<void>>;
}
