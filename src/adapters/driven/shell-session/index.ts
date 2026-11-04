// adapters/driven/shell-session: the driven implementation of core's ShellSessionPort (AD-22).
// Each run spawns one child: `sh -c <wrapped>` in the service's repo dir, or
// `docker exec -e … [-w <cwd>] <container> sh -c <wrapped>` — never `-t`/`-i`, stdin ignored,
// so no program ever gets a TTY (line-oriented by design; a PTY adapter is separate backlog).
// The wrapped command reports the shell's final `$PWD` from an EXIT trap, behind a per-run
// random sentinel on stdout, which is stripped from the output and returned as the outcome's
// `cwd`.
//
// POSIX-only: relies on a POSIX `sh`, on `detached: true` putting the child in its own process
// group, and on `process.kill(-pgid)` signalling that whole group.
//
// Process lifetime:
// - Cancel signals the run's whole process group (grandchildren included): SIGTERM, then
//   SIGKILL after 2 s, and settles `cancelled` once the group is gone. Calling cancel after
//   the shell already exited is a no-op: the run keeps its `exited` outcome.
// - A run that completes normally does NOT kill background jobs it started (`cmd &`): they
//   keep running, as in a regular shell. The run settles shortly after the shell exits even if
//   such a job still holds the output pipes (it stops being read).
// - Every process group this adapter started is SIGKILLed when the app process exits (one
//   `process.on('exit')` hook), so no group outlives the app.
// - For a container target, cancel/exit kills only the local `docker exec` client; with no TTY
//   allocated, the process inside the container may outlive it.
//
// Environment: TERM=dumb PAGER=cat GIT_PAGER=cat NO_COLOR=1, with FORCE_COLOR and
// CLICOLOR_FORCE removed, on the local child; the same four are passed into the container via
// `docker exec -e`. Both executables are injectable for tests.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { constants } from 'node:os';
import { createLineSplitter, createSentinelFilter, wrapCommand } from './index.logic.js';
import type { ShellLine, ShellRunHandle, ShellRunOutcome, ShellSessionPort, ShellTarget } from '../../../core/ports/shell-session.js';

export interface ShellSessionPortOptions {
  shell?: string;
  docker?: string;
  // Delay between SIGTERM and SIGKILL on cancel.
  killGraceMs?: number;
}

const DEFAULT_KILL_GRACE_MS = 2000;
// After the shell exited, how long to keep reading pipes a background grandchild may still
// hold open before settling anyway.
const PIPE_DRAIN_MS = 200;
// After the cancel's SIGKILL, how long to wait for the group to vanish before settling anyway.
const GROUP_REAP_MS = 1000;
const GROUP_POLL_MS = 25;

const CHILD_ENV = { TERM: 'dumb', PAGER: 'cat', GIT_PAGER: 'cat', NO_COLOR: '1' };
const STRIPPED_ENV = ['FORCE_COLOR', 'CLICOLOR_FORCE'];

// Process groups started by this module, SIGKILLed when the app exits. Dead groups are pruned
// whenever a new run starts so the set stays small.
const trackedGroups = new Set<number>();
let exitHookInstalled = false;

function trackGroup(pgid: number): void {
  for (const tracked of trackedGroups) {
    if (!groupAlive(tracked)) {
      trackedGroups.delete(tracked);
    }
  }
  trackedGroups.add(pgid);
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    process.on('exit', () => {
      for (const tracked of trackedGroups) {
        try {
          process.kill(-tracked, 'SIGKILL');
        } catch {
          // Already gone.
        }
      }
      trackedGroups.clear();
    });
  }
}

export function createShellSessionPort(options: ShellSessionPortOptions = {}): ShellSessionPort {
  const shell = options.shell ?? 'sh';
  const docker = options.docker ?? 'docker';
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  return {
    run: (target, cwd, command, onLine) => runShell({ shell, docker, killGraceMs }, target, cwd, command, onLine),
  };
}

function newSentinel(): string {
  return `__TUI_BACK_CWD_${randomBytes(12).toString('hex')}__:`;
}

function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...CHILD_ENV };
  for (const name of STRIPPED_ENV) {
    delete env[name];
  }
  return env;
}

export function buildInvocation(
  executables: { shell: string; docker: string },
  target: ShellTarget,
  cwd: string | undefined,
  wrapped: string,
): { file: string; args: string[]; cwd?: string } {
  if (target.kind === 'service') {
    return { file: executables.shell, args: ['-c', wrapped], cwd: cwd ?? target.repoPath };
  }
  const envArgs = Object.entries(CHILD_ENV).flatMap(([name, value]) => ['-e', `${name}=${value}`]);
  return {
    file: executables.docker,
    args: ['exec', ...envArgs, ...(cwd !== undefined && cwd !== '' ? ['-w', cwd] : []), target.container, 'sh', '-c', wrapped],
  };
}

function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    // EPERM means the group still exists but belongs to someone else — treat as alive.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  const pid = child.pid;
  if (pid === undefined) {
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    // Group already gone; fall back to the direct child in case it never got its own group.
    try {
      child.kill(signal);
    } catch {
      // Nothing left to signal.
    }
  }
}

function runShell(
  config: { shell: string; docker: string; killGraceMs: number },
  target: ShellTarget,
  cwd: string | undefined,
  command: string,
  onLine: (line: ShellLine) => void,
): ShellRunHandle {
  const sentinel = newSentinel();
  const deliver = (line: ShellLine): void => {
    try {
      onLine(line);
    } catch {
      // A throwing consumer must never escape as an uncaught listener exception.
    }
  };
  const stdoutFilter = createSentinelFilter(sentinel, (text) => deliver({ stream: 'stdout', text }));
  const stdoutSplitter = createLineSplitter((text) => stdoutFilter.line(text));
  const stderrSplitter = createLineSplitter((text) => {
    // A held-back empty stdout line came first: deliver it before this stderr line.
    stdoutFilter.flushHeld();
    deliver({ stream: 'stderr', text });
  });

  let resolveDone!: (outcome: ShellRunOutcome) => void;
  const done = new Promise<ShellRunOutcome>((resolve) => {
    resolveDone = resolve;
  });

  let settled = false;
  let cancelling = false;
  let exitInfo: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  const timers: NodeJS.Timeout[] = [];
  const settle = (outcome: ShellRunOutcome): void => {
    if (settled) {
      return;
    }
    settled = true;
    for (const timer of timers) {
      clearTimeout(timer);
    }
    resolveDone(outcome);
  };

  const invocation = buildInvocation(config, target, cwd, wrapCommand(command, sentinel));
  const spawnFailure = (error: unknown): ShellRunOutcome => {
    // Node reports a missing cwd as ENOENT, just like a missing executable: tell them apart by
    // checking the directory itself.
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT' && cwd !== undefined && invocation.cwd !== undefined && !existsSync(invocation.cwd)) {
      return { status: 'failed', error: { code: 'cwd-missing', message: `Working directory ${invocation.cwd} no longer exists` } };
    }
    return failed(invocation.file, error);
  };

  let child: ChildProcess;
  try {
    child = spawn(invocation.file, invocation.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      env: childEnv(),
      ...(invocation.cwd === undefined ? {} : { cwd: invocation.cwd }),
    });
  } catch (error) {
    settle(spawnFailure(error));
    return { cancel: () => undefined, done };
  }
  if (child.pid !== undefined) {
    trackGroup(child.pid);
  }

  const finishOutput = (): { cwd?: string } => {
    stdoutSplitter.end();
    stderrSplitter.end();
    return stdoutFilter.end();
  };

  const waitForGroupGone = (then: () => void): void => {
    const pid = child.pid;
    const deadline = Date.now() + config.killGraceMs + GROUP_REAP_MS;
    const poll = (): void => {
      if (settled) {
        return;
      }
      if (pid === undefined || !groupAlive(pid) || Date.now() >= deadline) {
        then();
        return;
      }
      timers.push(setTimeout(poll, GROUP_POLL_MS));
    };
    poll();
  };

  // Called once all output is in (pipes closed, or the drain grace elapsed).
  let completing = false;
  const complete = (): void => {
    if (settled || completing || exitInfo === undefined) {
      return;
    }
    completing = true;
    const reported = finishOutput();
    if (cancelling) {
      // Settle only once no process of the run's group remains.
      waitForGroupGone(() => settle({ status: 'cancelled' }));
      return;
    }
    const { code, signal } = exitInfo;
    const exitCode = code ?? (signal !== null ? 128 + (constants.signals[signal] ?? 0) : 1);
    settle({ status: 'exited', exitCode, ...reported });
  };

  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => stdoutSplitter.push(chunk));
  child.stderr?.on('data', (chunk: string) => stderrSplitter.push(chunk));

  child.on('error', (error) => {
    if (exitInfo !== undefined) {
      return;
    }
    finishOutput();
    settle(cancelling ? { status: 'cancelled' } : spawnFailure(error));
  });
  child.on('exit', (code, signal) => {
    exitInfo = { code, signal };
    // A background grandchild may hold the pipes open long after the shell exited: give the
    // pipes a short grace to drain, then stop reading and settle.
    timers.push(
      setTimeout(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
        complete();
      }, PIPE_DRAIN_MS),
    );
  });
  child.on('close', () => complete());

  const cancel = (): void => {
    // Once the shell exited the run is over (only draining output): its `exited` outcome
    // stands, and its PGID may already be reaped — never signal it.
    if (settled || cancelling || exitInfo !== undefined) {
      return;
    }
    cancelling = true;
    signalGroup(child, 'SIGTERM');
    timers.push(
      setTimeout(() => {
        if (child.pid !== undefined && groupAlive(child.pid)) {
          signalGroup(child, 'SIGKILL');
        }
      }, config.killGraceMs),
    );
  };

  return { cancel, done };
}

function failed(file: string, error: unknown): ShellRunOutcome {
  const cause = error instanceof Error ? error.message : String(error);
  return { status: 'failed', error: { code: 'shell-unavailable', message: `Could not start ${file}: ${cause}` } };
}
