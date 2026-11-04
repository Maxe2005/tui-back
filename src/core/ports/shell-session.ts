// core/ports/shell-session: the line-oriented command-execution seam (AD-22). One `run` spawns
// one command — `sh -c` in a service's repo dir, or `docker exec` (no TTY) inside its
// container — and streams its stdout/stderr back line by line. Deliberately not a PTY: a PTY
// adapter can later implement this same contract without touching core. The shipped adapter is
// POSIX-only (a POSIX `sh`, detached process groups signalled via `kill(-pgid)`).
import type { ResultError } from '../result.js';

export type ShellTarget =
  | { kind: 'service'; repoPath: string }
  | { kind: 'container'; container: string };

export type ShellStreamTag = 'stdout' | 'stderr';

export interface ShellLine {
  stream: ShellStreamTag;
  text: string;
}

export type ShellRunOutcome =
  // The command ran to completion (any exit code, non-zero is not an error). `cwd` is the
  // shell's working directory after the command, when the adapter could observe it (absent
  // e.g. when the command itself called `exit`).
  | { status: 'exited'; exitCode: number; cwd?: string }
  | { status: 'cancelled' }
  // Could not start: `shell-unavailable` (executable missing / unspawnable) or `cwd-missing`
  // (the requested working directory no longer exists).
  | { status: 'failed'; error: ResultError };

export interface ShellRunHandle {
  // Terminates the run's whole process group; idempotent, a no-op once `done` settled or the
  // command already exited. For a container target only the local `docker exec` client is
  // terminated: the process inside the container may keep running.
  cancel(): void;
  // Settles once the run is over. Never rejects.
  done: Promise<ShellRunOutcome>;
}

export interface ShellSessionPort {
  // Starts `command` against `target`, in `cwd` when given (else the target's default dir:
  // the repo path for a service, the container's workdir for a container). `onLine` fires
  // once per output line, tagged stdout/stderr, without the line terminator.
  run(target: ShellTarget, cwd: string | undefined, command: string, onLine: (line: ShellLine) => void): ShellRunHandle;
}
