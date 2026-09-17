// adapters/driven/container: the driven implementation of core's ContainerPort (story
// 3.1). Restart is executed via node:child_process against the container runtime (`docker
// restart <container>` by default) — no new npm dependency, per the spec's Ask-First
// (dockerode now vs. later never triggered: this stays on child_process). The executable
// is injectable so integration tests can stub it with a script on PATH. Core never imports
// this adapter (AD-1).
import { spawnSync } from 'node:child_process';
import { err, ok, type Result } from '../../../core/result.js';
import type { ContainerPort } from '../../../core/ports/container.js';

export function createContainerPort(executable = 'docker'): ContainerPort {
  return {
    restart: (container) => restartContainer(executable, container),
  };
}

// `docker restart -- <container>` — the trailing `--` terminates option parsing so a
// container value starting with `-` is never parsed as a flag (mirroring the git
// adapter's own `--` disambiguation). Exit-code taxonomy mirrors the git adapter's
// spawnFailureDetail convention: a missing binary (status === null) surfaces the spawn
// cause, never a bare "undefined". An empty container name is rejected upfront — it can
// never name a real container, so spawning the runtime with it would only produce a
// confusing runtime error.
export async function restartContainer(executable: string, container: string): Promise<Result<void>> {
  if (container.trim() === '') {
    return err('container-restart-error', 'Container name must not be empty');
  }
  const result = spawnSync(executable, ['restart', '--', container], { encoding: 'utf8' });
  if (result.status !== 0) {
    return err('container-restart-error', `${executable} restart ${container} failed: ${spawnFailureDetail(result)}`);
  }
  return ok(undefined);
}

function spawnFailureDetail(result: { status: number | null; stderr: string; error?: Error }): string {
  if (result.status === null) {
    const spawnError = result.error as (NodeJS.ErrnoException & Error) | undefined;
    const message = spawnError?.message;
    const code = spawnError?.code;
    return typeof message === 'string' && message !== '' ? message : (typeof code === 'string' ? code : 'unknown error');
  }
  // A runtime failure with blank stderr still needs a cause — fall back to the exit
  // status so the message never ends blank.
  const stderr = String(result.stderr).trim();
  return stderr !== '' ? stderr : `exit ${String(result.status)}`;
}
