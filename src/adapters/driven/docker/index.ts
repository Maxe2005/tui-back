// adapters/driven/docker: the driven implementation of core's DockerPort (story 5.1) — the
// currently-empty src/adapters/driven/docker/ dir this story fills. Shells the `docker`
// binary via node:child_process, the same convention as adapters/driven/git/index.ts: `spawn`
// for the long-lived `-f` tail (Design Notes: "one long-lived spawn... child process per
// active pane"), `spawnSync` for the one-shot older-lines fetch — never a new dependency (no
// dockerode).
//
// Availability check: `spawn`'s own 'error' event (the binary missing) fires asynchronously,
// one tick after `streamLogs` already returned — too late to turn into this call's own
// synchronous-looking Result the way core/logs/index.ts's `subscribe` wants for the
// DOCKER_UNAVAILABLE case. So `streamLogs` runs one quick `spawnSync('docker', ['inspect',
// ...])` reachability probe first — the same kind of quick, synchronous pre-check
// `assertAllowedBranch`/`showRef` already run before every git write in this codebase — and
// only spawns the real `-f` tail once that probe succeeds. This is a deliberate, bounded
// exception to "never perform a synchronous/blocking Docker call on the Ink render loop"
// (Boundaries): `streamLogs` itself is only ever invoked from an async store action reacting
// to a keypress (never from React's render pass), exactly like every spawnSync git call in
// this codebase already runs from an async store action, never from a render.
//
// Line-parsing/merge logic (createLineSplitter, splitTimestampedLine, parseTimestampedOutput,
// mergeSortAndTrimLogs) lives in ./index.logic.ts, extracted so it's directly unit-testable
// without a live docker daemon (review fix — see that file's own header).
import { spawn, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { err, ok, type Result } from '../../../core/result.js';
import type { DockerErrorLike, DockerPort, LogLine } from '../../../core/ports/docker.js';
import { createLineSplitter, mergeSortAndTrimLogs, parseTimestampedOutput, splitTimestampedLine } from './index.logic.js';

// A hung/unresponsive docker daemon must never freeze the whole TUI process — `spawnSync`
// fully blocks Node's single event loop for as long as the child runs, so both one-shot
// `spawnSync` calls below (the availability probe and the older-lines fetch) are bounded by
// this timeout. A timeout manifests as `status: null` + `error.code === 'ETIMEDOUT'`,
// exactly like a missing-binary spawn failure, so `spawnFailureDetail`'s existing
// `status === null` branch already surfaces it (as `docker-unavailable`) without special-casing.
const DOCKER_SPAWN_TIMEOUT_MS = 5000;

export function createDockerPort(): DockerPort {
  return {
    streamLogs: (container, onLine, onError) => streamLogs(container, onLine, onError),
    fetchLogsBefore: (container, beforeCursor, count) => fetchLogsBefore(container, beforeCursor, count),
  };
}

function checkContainerAvailable(container: string): DockerErrorLike | null {
  const result = spawnSync('docker', ['inspect', '--format', '{{.State.Running}}', '--', container], {
    encoding: 'utf8',
    timeout: DOCKER_SPAWN_TIMEOUT_MS,
  });
  if (result.status === 0 && result.stdout.trim() === 'true') {
    return null;
  }
  if (result.status === 0) {
    // `docker inspect` exits 0 for a stopped/exited container too — only the printed
    // "true"/"false" value actually tells us whether it's running. Treating a bare exit-0 as
    // "available" let `docker logs -f` get spawned against a stopped container, which hangs
    // silently forever (no line, no error) rather than surfacing anything (review fix).
    return { code: 'docker-unavailable', message: `Docker is unavailable for container "${container}": container is not running` };
  }
  return { code: 'docker-unavailable', message: `Docker is unavailable for container "${container}": ${spawnFailureDetail(result)}` };
}

function streamLogs(
  container: string,
  onLine: (line: LogLine) => void,
  onError: (error: DockerErrorLike) => void,
): () => void {
  const unavailable = checkContainerAvailable(container);
  if (unavailable) {
    onError(unavailable);
    return () => {};
  }

  // `--since` scopes the tail to lines emitted from "now" on — the manager's own ring buffer
  // starts empty for a fresh subscription, so nothing is gained (and real cost is added) by
  // replaying the container's entire history through the live tail; `loadOlderLogsPane`'s own
  // `--until`/`--tail` fetch is the on-demand path for older lines.
  const since = new Date().toISOString();
  const child = spawn('docker', ['logs', '-f', '--timestamps', '--since', since, '--', container]);
  let stopped = false;

  const stdoutSplitter = createLineSplitter((line) => onLine(splitTimestampedLine(line, 'stdout')));
  const stderrSplitter = createLineSplitter((line) => onLine(splitTimestampedLine(line, 'stderr')));
  // Guarded by `stopped` — unlike the `error`/`exit` handlers below, `data` had no such guard
  // before this fix: a `data` event already queued in Node's event loop when `stop()` calls
  // `child.kill()` can still fire afterward, which would call `onLine` on a subscription the
  // caller just tore down (review fix).
  child.stdout?.on('data', (chunk) => {
    if (stopped) {
      return;
    }
    stdoutSplitter(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    if (stopped) {
      return;
    }
    stderrSplitter(chunk);
  });

  child.on('error', (spawnError) => {
    if (stopped) {
      return;
    }
    onError({ code: 'docker-unavailable', message: `Failed to start "docker logs -f" for "${container}": ${spawnError.message}` });
  });
  child.on('exit', (code, signal) => {
    // A `stop()`-initiated kill (SIGTERM, or any signal at all) is an intentional teardown,
    // never a stream error — only an unrequested exit (the daemon dying, the container being
    // removed mid-stream, or the container simply stopping on its own while being watched) is
    // reported.
    if (stopped || signal !== null) {
      return;
    }
    if (code === null) {
      return;
    }
    if (code === 0) {
      // A clean exit the caller never asked for (e.g. the watched container stopped normally)
      // used to be silently swallowed here, leaving the pane frozen forever with no error and
      // no further lines. Reported the same way as any other unrequested exit (review fix).
      onError({ code: 'docker-unavailable', message: `log stream ended for "${container}"` });
      return;
    }
    onError({ code: 'docker-unavailable', message: `"docker logs -f" exited unexpectedly for "${container}" (code ${code})` });
  });

  return () => {
    if (stopped) {
      return;
    }
    stopped = true;
    child.kill();
  };
}

async function fetchLogsBefore(container: string, beforeCursor: string, count: number): Promise<Result<LogLine[]>> {
  const result = spawnSync(
    'docker',
    ['logs', '--until', beforeCursor, '--tail', String(count), '--timestamps', '--', container],
    { encoding: 'utf8', timeout: DOCKER_SPAWN_TIMEOUT_MS },
  );
  if (result.status !== 0) {
    return err('docker-unavailable', `"docker logs --until" failed for "${container}": ${spawnFailureDetail(result)}`);
  }
  const stdoutLines = parseTimestampedOutput(result.stdout, 'stdout');
  const stderrLines = parseTimestampedOutput(result.stderr, 'stderr');
  // `--tail <count>` is applied independently to each demuxed pipe, so the merged result can
  // hold up to 2x count lines before this trim — never left over-count (review fix).
  return ok(mergeSortAndTrimLogs(stdoutLines, stderrLines, count));
}

// Mirrors adapters/driven/git/index.ts's own spawnFailureDetail exactly: when the binary
// itself cannot be spawned (status === null — e.g. docker missing from PATH, or the call timed
// out), stderr is undefined, so the message must come from the spawn error's own fields.
function spawnFailureDetail(result: SpawnSyncReturns<string>): string {
  if (result.status === null) {
    const spawnError = result.error as (NodeJS.ErrnoException & Error) | undefined;
    const message = spawnError?.message;
    const code = spawnError?.code;
    return typeof message === 'string' && message !== '' ? message : typeof code === 'string' ? code : 'unknown error';
  }
  const stderr = String(result.stderr).trim();
  // A non-zero exit with an empty stderr buffer previously rendered as a bare trailing colon
  // with no detail at all (e.g. `Docker is unavailable for container "x": `) — fall back to a
  // non-empty placeholder, matching the status === null branch just above (review fix).
  return stderr !== '' ? stderr : 'unknown error';
}
