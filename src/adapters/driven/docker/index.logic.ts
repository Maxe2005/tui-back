// adapters/driven/docker/index.logic: pure, adapter-independent line-parsing/merge logic used
// by index.ts (story 5.1 review fix — extracted so it is directly unit-testable without a live
// docker daemon; index.test.ts's real-docker suite is `describe.skipIf(!dockerAvailable)`, so
// without this split none of this logic ran at all in a sandboxed/CI environment with no
// reachable daemon). Mirrors how logs-zone.logic.ts was split out of logs-zone.tsx in this same
// story: index.ts itself still owns every actual `spawn`/`spawnSync` call; this module only
// transforms text those calls already produced.
import type { HealthState, LogLine, LogStreamTag } from '../../../core/ports/docker.js';

function stripTrailingCr(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

// Splits a chunked stdout/stderr stream into whole lines, buffering across chunk boundaries —
// a naive per-chunk `.split('\n')` would silently corrupt a line straddling two `data` events.
// A trailing `\r` (a CRLF-terminated line from docker) is stripped from each emitted line so it
// never leaks into `LogLine.text` and visually corrupts terminal rendering.
export function createLineSplitter(onFullLine: (line: string) => void): (chunk: Buffer | string) => void {
  let buffered = '';
  return (chunk) => {
    buffered += chunk.toString('utf8');
    const parts = buffered.split('\n');
    buffered = parts.pop() ?? '';
    for (const part of parts) {
      const line = stripTrailingCr(part);
      if (line !== '') {
        onFullLine(line);
      }
    }
  };
}

// Docker's `--timestamps` flag prepends an RFC3339Nano timestamp + one space to every line —
// used on both the live tail and the older-lines fetch so every LogLine carries docker's own
// timestamp (Boundaries: "Each buffered line carries a timestamp"), never a fabricated
// receipt-time one, whenever docker actually provides it.
export function splitTimestampedLine(rawLine: string, stream: LogStreamTag): LogLine {
  const spaceIndex = rawLine.indexOf(' ');
  if (spaceIndex === -1) {
    return { timestamp: new Date().toISOString(), stream, text: rawLine };
  }
  return { timestamp: rawLine.slice(0, spaceIndex), stream, text: rawLine.slice(spaceIndex + 1) };
}

// Parses a one-shot `spawnSync` stdout/stderr buffer (fetchLogsBefore) into tagged LogLines —
// same trailing-`\r` stripping as createLineSplitter, for the same reason, even though this
// path never has to worry about a line straddling a chunk boundary.
export function parseTimestampedOutput(raw: string, stream: LogStreamTag): LogLine[] {
  return String(raw)
    .split('\n')
    .map(stripTrailingCr)
    .filter((line) => line !== '')
    .map((line) => splitTimestampedLine(line, stream));
}

// Docker demuxes stdout/stderr separately when captured like this, so `--tail <count>` is
// applied independently to each pipe — the merged, chronologically-sorted result can hold up to
// 2x count lines. Trims back down to the most recent `count` after merging+sorting (review fix
// — the un-trimmed merge previously escaped as-is).
export function mergeSortAndTrimLogs(stdoutLines: readonly LogLine[], stderrLines: readonly LogLine[], count: number): LogLine[] {
  const merged = [...stdoutLines, ...stderrLines].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return merged.slice(-count);
}

// Story 5.3: maps `docker inspect --format '{{.State.Running}} {{.State.Restarting}}'` output
// to HealthState — container missing/inspect fails is handled by the caller (index.ts maps a
// non-zero inspect to `down` without ever calling this); a spawn-level failure never reaches
// here either. `State.Restarting` true → `restarting`; `State.Running` true → `up`;
// otherwise → `down`. Pure so it's directly unit-testable without a live daemon.
export function mapInspectToHealthState(running: boolean, restarting: boolean): HealthState {
  if (restarting) {
    return 'restarting';
  }
  if (running) {
    return 'up';
  }
  return 'down';
}

// Parses the raw `{{.State.Running}} {{.State.Restarting}}` inspect string (e.g. "true false")
// into HealthState via mapInspectToHealthState — any unparseable output falls back to `down`
// (never throws into the render tree).
export function parseHealthInspectOutput(raw: string): HealthState {
  const parts = raw.trim().split(/\s+/);
  const running = parts[0] === 'true';
  const restarting = parts[1] === 'true';
  return mapInspectToHealthState(running, restarting);
}
