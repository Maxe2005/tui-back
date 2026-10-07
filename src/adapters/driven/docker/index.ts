// adapters/driven/docker: the driven implementation of core's DockerPort. Shells the `docker`
// binary (no dockerode): `spawn` for the long-lived `-f` tail, one per active pane, and
// bounded one-shot calls: the reachability probe (the only `spawnSync`, since streamLogs must
// report an unavailable container synchronously) and the asynchronous older-lines fetch,
// health and restart.
// Pure line parsing lives in ./index.logic.ts.
import { spawn, spawnSync } from 'node:child_process';
import { err, ok, type Result } from '../../../core/result.js';
import type { DockerErrorLike, DockerPort, HealthState, LogLine } from '../../../core/ports/docker.js';
import { runProcess, type ProcessResult } from '../process.js';
import { createLineSplitter, mergeSortAndTrimLogs, parseHealthInspectOutput, parseTimestampedOutput, splitTimestampedLine } from './index.logic.js';

// A hung/unresponsive docker daemon must never freeze the whole TUI process — `spawnSync`
// fully blocks Node's single event loop for as long as the child runs, so both one-shot
// `spawnSync` calls below (the availability probe and the older-lines fetch) are bounded by
// this timeout. A timeout manifests as `status: null` + `error.code === 'ETIMEDOUT'`,
// exactly like a missing-binary spawn failure, so `spawnFailureDetail`'s existing
// `status === null` branch already surfaces it (as `docker-unavailable`) without special-casing.
const DOCKER_SPAWN_TIMEOUT_MS = 5000;

// `docker restart` is inherently slower than a probe or a log fetch — the daemon first stops
// the container (up to its `--time` grace period, 10s by default; a PID 1 that ignores
// SIGTERM, e.g. `sh -c 'sleep …'`, burns the whole grace) and only then starts it again.
// Sharing the 5s probe timeout would misreport a healthy-but-slow restart as a failure, so the
// restart call gets its own bound — still finite, so a hung daemon can never freeze the TUI's
// event loop forever (same rationale as DOCKER_SPAWN_TIMEOUT_MS above).
const DOCKER_RESTART_TIMEOUT_MS = 30000;

export function createDockerPort(): DockerPort {
  return {
    streamLogs: (container, onLine, onError) => streamLogs(container, onLine, onError),
    fetchLogsBefore: (container, beforeCursor, count) => fetchLogsBefore(container, beforeCursor, count),
    getContainerHealth: (container) => getContainerHealth(container),
    restartContainer: (container) => restartContainer(container),
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
    // "true"/"false" value tells whether it's running. `docker logs -f` spawned against a
    // stopped container hangs silently forever (no line, no error).
    return { code: 'docker-unavailable', message: `Docker is unavailable for container "${container}": container is not running` };
  }
  return { code: 'docker-unavailable', message: `Docker is unavailable for container "${container}": ${spawnFailureDetail(result)}` };
}

function streamLogs(
  container: string,
  onLine: (line: LogLine) => void,
  onError: (error: DockerErrorLike) => void,
): () => void {
  // A synchronous probe first: spawn's own 'error' event (binary missing) fires a tick after
  // streamLogs returns — too late for core's `subscribe` to report docker-unavailable as its
  // Result.
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
  // Guarded by `stopped`: a `data` event already queued in Node's event loop when `stop()`
  // calls `child.kill()` can still fire afterward, and must not call `onLine` on a
  // subscription the caller just tore down.
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
      // is reported like any other unrequested exit — otherwise the pane would freeze with no
      // error and no further lines.
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

// Live health via `docker inspect --format '{{.State.Running}} {{.State.Restarting}}'`
// (bounded spawnSync, only from an async store poll action). A spawn-level failure
// (status === null: binary missing, timeout) is `err('docker-unavailable', ...)` so the
// slice's poll keeps last-known health; a definitive non-zero inspect (container missing,
// daemon reporting an error for this name) is `ok('down')`, never thrown.
async function getContainerHealth(container: string): Promise<Result<HealthState>> {
  const result = await runProcess('docker', ['inspect', '--format', '{{.State.Running}} {{.State.Restarting}}', '--', container], {
    timeout: DOCKER_SPAWN_TIMEOUT_MS,
  });
  if (result.status === null) {
    return err('docker-unavailable', `"docker inspect" failed for "${container}": ${spawnFailureDetail(result)}`);
  }
  if (result.status !== 0) {
    return ok('down');
  }
  return ok(parseHealthInspectOutput(String(result.stdout)));
}

// Developer-triggered restart only, never called automatically. One-shot `docker restart` via
// spawnSync; any failure is `err('docker-unavailable', ...)` so the slice surfaces it inline
// on the pane.
async function restartContainer(container: string): Promise<Result<void>> {
  const result = await runProcess('docker', ['restart', '--', container], {
    timeout: DOCKER_RESTART_TIMEOUT_MS,
  });
  if (result.status !== 0) {
    return err('docker-unavailable', `"docker restart" failed for "${container}": ${spawnFailureDetail(result)}`);
  }
  return ok(undefined);
}

async function fetchLogsBefore(container: string, beforeCursor: string, count: number): Promise<Result<LogLine[]>> {
  const result = await runProcess(
    'docker',
    ['logs', '--until', beforeCursor, '--tail', String(count), '--timestamps', '--', container],
    { timeout: DOCKER_SPAWN_TIMEOUT_MS },
  );
  if (result.status !== 0) {
    return err('docker-unavailable', `"docker logs --until" failed for "${container}": ${spawnFailureDetail(result)}`);
  }
  const stdoutLines = parseTimestampedOutput(result.stdout, 'stdout');
  const stderrLines = parseTimestampedOutput(result.stderr, 'stderr');
  // `--tail <count>` is applied independently to each demuxed pipe, so the merged result can
  // hold up to 2x count lines before this trim.
  return ok(mergeSortAndTrimLogs(stdoutLines, stderrLines, count));
}

// Same as the git adapter's spawnFailureDetail: when the binary itself cannot be spawned
// (status === null — e.g. docker missing from PATH, or the call timed out), stderr is
// undefined, so the message must come from the spawn error's own fields.
function spawnFailureDetail(result: Pick<ProcessResult, 'status' | 'stderr' | 'error'>): string {
  if (result.status === null) {
    const spawnError = result.error as (NodeJS.ErrnoException & Error) | undefined;
    const message = spawnError?.message;
    const code = spawnError?.code;
    return typeof message === 'string' && message !== '' ? message : typeof code === 'string' ? code : 'unknown error';
  }
  const stderr = String(result.stderr).trim();
  // A non-zero exit with an empty stderr buffer would render as a bare trailing colon (e.g.
  // `Docker is unavailable for container "x": `) — fall back to a non-empty placeholder,
  // matching the status === null branch just above.
  return stderr !== '' ? stderr : 'unknown error';
}
