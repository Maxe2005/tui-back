import { err, ok, type Result } from '../result.js';
import type { DockerPort } from '../ports/docker.js';
import type { ShellLine, ShellRunHandle, ShellRunOutcome, ShellSessionPort, ShellTarget } from '../ports/shell-session.js';
import { createLineBuffer, DEFAULT_MAX_LINES, type LineBufferSnapshot } from './line-buffer.js';
import { detectTtyCommand } from './tty-guard.js';

// core/shell: one terminal session on a service (its repo dir) or its container (AD-22). The
// session owns what the port does not: the working directory carried across commands, the
// one-run-at-a-time rule, the TTY fail-fast guard, the container-running precondition and the
// bounded output retention. Every method returns a Result and never rejects or throws.

export type ShellRunResult = ShellRunOutcome | { status: 'noop' };

export interface ShellSession {
  // Runs one command. Settles once it is over: `exited` (any exit code), `cancelled`, `failed`
  // (could not start), or `noop` for a blank command. Rejected upfront with `command-running`,
  // `tty-required` (hint in the message), `container-not-running`, or the health check's own
  // error.
  run(command: string, onLine: (line: ShellLine) => void): Promise<Result<ShellRunResult>>;
  // Cancels the active run; idempotent, a no-op when idle.
  cancel(): void;
  // The directory the next command runs in; undefined for a container until a command reported
  // one (the container's own workdir applies).
  cwd(): string | undefined;
  isRunning(): boolean;
  // The retained output (last `maxLines` lines, across runs) and how many were dropped.
  output(): LineBufferSnapshot;
}

export interface ShellSessionDeps {
  shell: ShellSessionPort;
  docker: Pick<DockerPort, 'getContainerHealth'>;
}

export interface ShellSessionOptions {
  maxLines?: number;
}

export function createShellSession(
  deps: ShellSessionDeps,
  target: ShellTarget,
  options: ShellSessionOptions = {},
): Result<ShellSession> {
  const validated = validateTarget(target);
  if (!validated.ok) {
    return validated;
  }
  const shellTarget = validated.data;
  const initialCwd = (): string | undefined => (shellTarget.kind === 'service' ? shellTarget.repoPath : undefined);

  const buffer = createLineBuffer(options.maxLines ?? DEFAULT_MAX_LINES);
  let currentCwd: string | undefined = initialCwd();
  let running = false;
  let cancelRequested = false;
  let handle: ShellRunHandle | undefined;

  const execute = async (command: string, onLine: (line: ShellLine) => void): Promise<Result<ShellRunResult>> => {
    if (shellTarget.kind === 'container') {
      const health = await deps.docker.getContainerHealth(shellTarget.container);
      if (!health.ok) {
        return health;
      }
      if (health.data !== 'up') {
        return err('container-not-running', `Container ${shellTarget.container} is not running (${health.data})`);
      }
    }
    if (cancelRequested) {
      return ok({ status: 'cancelled' });
    }
    const record = (line: ShellLine): void => {
      buffer.push(line);
      try {
        onLine(line);
      } catch {
        // A throwing consumer must not break the run.
      }
    };
    handle = deps.shell.run(shellTarget, currentCwd, command, record);
    const outcome = await handle.done;
    if (outcome.status === 'exited' && outcome.cwd !== undefined && outcome.cwd !== '') {
      currentCwd = outcome.cwd;
    }
    if (outcome.status === 'failed' && outcome.error.code === 'cwd-missing') {
      // The directory vanished (deleted, or the repo moved): fall back to the target's default
      // so the next command can run.
      currentCwd = initialCwd();
      return err('cwd-missing', `${outcome.error.message}; back to ${currentCwd ?? "the container's workdir"}`);
    }
    return ok(outcome);
  };

  return ok({
    async run(command, onLine) {
      if (running) {
        return err('command-running', 'A command is already running in this shell');
      }
      if (command.trim() === '') {
        return ok({ status: 'noop' });
      }
      const ttyHint = detectTtyCommand(command);
      if (ttyHint !== null) {
        return err('tty-required', ttyHint);
      }
      running = true;
      cancelRequested = false;
      try {
        return await execute(command, onLine);
      } catch (error) {
        const cause = error instanceof Error ? error.message : String(error);
        return err('shell-unavailable', `Could not run the command: ${cause}`);
      } finally {
        running = false;
        handle = undefined;
      }
    },
    cancel() {
      if (!running) {
        return;
      }
      cancelRequested = true;
      try {
        handle?.cancel();
      } catch {
        // Cancel is best-effort and must never throw.
      }
    },
    cwd: () => currentCwd,
    isRunning: () => running,
    output: () => buffer.snapshot(),
  });
}

// A service shell needs an absolute repo path; a container name is trimmed and must not look
// like a flag (it lands in `docker exec`'s argv before the command).
function validateTarget(target: ShellTarget): Result<ShellTarget> {
  if (target.kind === 'service') {
    if (target.repoPath.trim() === '') {
      return err('invalid-repo-path', 'A service shell needs a non-empty repo path');
    }
    if (!target.repoPath.startsWith('/')) {
      return err('invalid-repo-path', `A service shell needs an absolute repo path, got ${target.repoPath}`);
    }
    return ok(target);
  }
  const container = target.container.trim();
  if (container === '') {
    return err('invalid-container', 'A container shell needs a non-empty container name');
  }
  if (container.startsWith('-')) {
    return err('invalid-container', `Invalid container name ${container}`);
  }
  return ok({ kind: 'container', container });
}
