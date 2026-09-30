// adapters/driven/restart: the driven implementation of core's RestartPort (story 3.8).
// One manifest `restartCommands` recipe entry is an arbitrary shell string, so it runs via
// `sh -c <command>` with the member repo as its working directory — a non-interactive
// child_process spawn with captured stdout/stderr (the migration adapter's own Ask-First
// baseline: no TTY passthrough, no interactive stdin). `GIT_TERMINAL_PROMPT=0` keeps a
// credential-requiring remote from hanging on an interactive prompt (the git adapter's
// own pullBranch precedent). The shell is injectable so integration tests can stub it
// with a script on PATH (the container adapter's executable-injection precedent). Core
// never imports this adapter (AD-1).
import { spawnSync } from 'node:child_process';
import { err, ok, type Result } from '../../../core/result.js';
import type { RestartPort } from '../../../core/ports/restart.js';

export function createRestartPort(shell = 'sh'): RestartPort {
  return {
    run: (repoPath, command) => runRestart(shell, repoPath, command),
  };
}

// The command arrives as `sh -c`'s operand (never a flag position), so a command value
// starting with `-` is never parsed as a shell flag — the same leading-dash class the
// git/container adapters close with trailing `--`. An empty command is rejected upfront:
// it can never be a real restart step, so spawning a shell with it would only produce a
// confusing no-op success.
export async function runRestart(
  shell: string,
  repoPath: string,
  command: string,
): Promise<Result<{ output: string }>> {
  if (command.trim() === '') {
    return err('restart-failed', `Restart command must not be empty (repo ${repoPath})`);
  }
  // spawnSync reports spawn failures (missing binary, bad cwd) as a null-status
  // result, but invalid arguments throw synchronously — never let that escape the
  // Result envelope (the core never-throw invariant).
  try {
    const result = spawnSync(shell, ['-c', command], {
      cwd: repoPath,
      encoding: 'utf8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    if (result.status !== 0) {
      return err('restart-failed', `Restart "${command}" failed in ${repoPath}: ${spawnFailureDetail(result)}`);
    }
    return ok({ output: String(result.stdout).trim() });
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    return err('restart-failed', `Restart "${command}" failed in ${repoPath}: ${cause}`);
  }
}

function spawnFailureDetail(result: {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}): string {
  if (result.status === null) {
    const spawnError = result.error as (NodeJS.ErrnoException & Error) | undefined;
    const message = spawnError?.message;
    const code = spawnError?.code;
    return typeof message === 'string' && message !== '' ? message : (typeof code === 'string' ? code : 'unknown error');
  }
  // A failing restart step with blank output on both streams still needs a cause — combine
  // both streams (restart steps report on either) and fall back to the exit status so the
  // message never ends blank.
  const combined = [String(result.stdout), String(result.stderr)]
    .map((stream) => stream.trim())
    .filter((stream) => stream !== '')
    .join('\n');
  return combined !== '' ? combined : `exit ${String(result.status)}`;
}
