// core/ports/docker: the DockerPort every log stream, health check and restart goes through.
// The driven adapter shells the real `docker` binary (no dockerode). `streamLogs` returns a
// `stop` function, never a Result: start failures arrive via `onError`, never thrown. Lines
// are tagged stdout/stderr before they reach `onLine`.
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
  // per line, tagged stdout/stderr. `onError` may fire more than once (start failure, or the
  // stream dying mid-flight) — the caller treats every call as "this subscription is now
  // broken". Returns an idempotent `stop` function, safe to call after the stream died.
  streamLogs(container: string, onLine: (line: LogLine) => void, onError: (error: DockerErrorLike) => void): () => void;
  // One-shot fetch of up to `count` lines strictly before `beforeCursor` (an ISO timestamp),
  // in chronological order (docker adapter: `docker logs --until <beforeCursor> --tail <count>
  // --timestamps <container>` via spawnSync — only from an async store action reacting to a
  // keypress, never from the Ink render loop).
  fetchLogsBefore(container: string, beforeCursor: string, count: number): Promise<Result<LogLine[]>>;
  // Live container health — `docker inspect` mapped to HealthState: container missing/inspect
  // fails → `down`; `State.Restarting` true → `restarting`; `State.Running` true → `up`;
  // otherwise → `down`. A spawn-level failure (binary missing, timeout) is an
  // `err('docker-unavailable', ...)` so a scheduled poll can keep last-known health; a
  // definitive non-zero inspect (e.g. no such container) is `ok('down')`.
  getContainerHealth(container: string): Promise<Result<HealthState>>;
  // Developer-triggered restart only, never called automatically. `docker restart` one-shot
  // via spawnSync, same idiom as fetchLogsBefore.
  restartContainer(container: string): Promise<Result<void>>;
}
