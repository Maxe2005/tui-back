import { describe, expect, it, vi } from 'vitest';
import { err, ok, type Result } from '../result.js';
import type { HealthState } from '../ports/docker.js';
import type { ShellLine, ShellRunOutcome, ShellSessionPort, ShellTarget } from '../ports/shell-session.js';
import { createShellSession, type ShellSession } from './index.js';

// A controllable fake ShellSessionPort: each `run` is recorded with its onLine callback, and
// the test settles it via `finish` (or it settles `cancelled` when the handle is cancelled).
function fakeShell() {
  const runs: {
    target: ShellTarget;
    cwd: string | undefined;
    command: string;
    emit: (line: ShellLine) => void;
    finish: (outcome: ShellRunOutcome) => void;
    cancel: ReturnType<typeof vi.fn>;
  }[] = [];
  const port: ShellSessionPort = {
    run: vi.fn((target, cwd, command, onLine) => {
      let resolve!: (outcome: ShellRunOutcome) => void;
      const done = new Promise<ShellRunOutcome>((r) => {
        resolve = r;
      });
      const cancel = vi.fn(() => resolve({ status: 'cancelled' }));
      runs.push({ target, cwd, command, emit: onLine, finish: resolve, cancel });
      return { cancel, done };
    }),
  };
  return { port, runs };
}

function fakeDocker(health: Result<HealthState> = ok('up')) {
  return { getContainerHealth: vi.fn(async () => health) };
}

const service: ShellTarget = { kind: 'service', repoPath: '/repo' };
const container: ShellTarget = { kind: 'container', container: 'api' };

function session(target: ShellTarget, deps: { port: ShellSessionPort; docker?: ReturnType<typeof fakeDocker> }, maxLines?: number): ShellSession {
  const created = createShellSession(
    { shell: deps.port, docker: deps.docker ?? fakeDocker() },
    target,
    maxLines === undefined ? {} : { maxLines },
  );
  if (!created.ok) {
    throw new Error(created.error.message);
  }
  return created.data;
}

// Lets the session's internal awaits (health check) run before the test inspects the fake.
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('createShellSession', () => {
  it('rejects a blank repo path', () => {
    const { port } = fakeShell();
    for (const repoPath of ['', '   ']) {
      expect(createShellSession({ shell: port, docker: fakeDocker() }, { kind: 'service', repoPath })).toMatchObject({
        ok: false,
        error: { code: 'invalid-repo-path' },
      });
    }
  });

  it('rejects a blank container name', () => {
    const { port } = fakeShell();
    expect(createShellSession({ shell: port, docker: fakeDocker() }, { kind: 'container', container: ' ' })).toMatchObject({
      ok: false,
      error: { code: 'invalid-container' },
    });
  });

  it('starts a service session in its repo path and a container session with no cwd', () => {
    const { port } = fakeShell();
    expect(session(service, { port }).cwd()).toBe('/repo');
    expect(session(container, { port }).cwd()).toBeUndefined();
  });
});

describe('ShellSession.run', () => {
  it('streams lines to the caller, retains them, and settles with the exit outcome', async () => {
    const { port, runs } = fakeShell();
    const shell = session(service, { port });
    const seen: ShellLine[] = [];

    const pending = shell.run('echo a; echo b >&2', (line) => seen.push(line));
    await flush();
    expect(shell.isRunning()).toBe(true);
    const run = runs[0]!;
    expect(run).toMatchObject({ target: service, cwd: '/repo', command: 'echo a; echo b >&2' });
    run.emit({ stream: 'stdout', text: 'a' });
    run.emit({ stream: 'stderr', text: 'b' });
    run.finish({ status: 'exited', exitCode: 0, cwd: '/repo' });

    expect(await pending).toEqual(ok({ status: 'exited', exitCode: 0, cwd: '/repo' }));
    expect(seen).toEqual([
      { stream: 'stdout', text: 'a' },
      { stream: 'stderr', text: 'b' },
    ]);
    expect(shell.output()).toEqual({ lines: seen, droppedCount: 0 });
    expect(shell.isRunning()).toBe(false);
  });

  it('treats a non-zero exit as a normal outcome and keeps cwd when none is reported', async () => {
    const { port, runs } = fakeShell();
    const shell = session(service, { port });

    const pending = shell.run('exit 3', () => undefined);
    await flush();
    runs[0]!.finish({ status: 'exited', exitCode: 3 });

    expect(await pending).toEqual(ok({ status: 'exited', exitCode: 3 }));
    expect(shell.cwd()).toBe('/repo');
  });

  it('carries the reported cwd into the next run', async () => {
    const { port, runs } = fakeShell();
    const shell = session(service, { port });

    const first = shell.run('cd sub', () => undefined);
    await flush();
    runs[0]!.finish({ status: 'exited', exitCode: 0, cwd: '/repo/sub' });
    await first;
    expect(shell.cwd()).toBe('/repo/sub');

    const second = shell.run('pwd', () => undefined);
    await flush();
    expect(runs[1]!.cwd).toBe('/repo/sub');
    runs[1]!.finish({ status: 'exited', exitCode: 0, cwd: '/repo/sub' });
    await second;
  });

  it('only updates cwd from an exited outcome', async () => {
    const { port, runs } = fakeShell();
    const shell = session(service, { port });

    const pending = shell.run('broken', () => undefined);
    await flush();
    runs[0]!.finish({ status: 'failed', error: { code: 'shell-unavailable', message: 'no sh' } });

    expect(await pending).toEqual(ok({ status: 'failed', error: { code: 'shell-unavailable', message: 'no sh' } }));
    expect(shell.cwd()).toBe('/repo');
  });

  it('rejects a second run while one is active', async () => {
    const { port, runs } = fakeShell();
    const shell = session(service, { port });

    const first = shell.run('sleep 30', () => undefined);
    await flush();
    expect(await shell.run('ls', () => undefined)).toMatchObject({ ok: false, error: { code: 'command-running' } });
    expect(runs).toHaveLength(1);

    runs[0]!.finish({ status: 'exited', exitCode: 0 });
    await first;
  });

  it('cancels the active run and settles cancelled; cancel is idempotent and a no-op when idle', async () => {
    const { port, runs } = fakeShell();
    const shell = session(service, { port });
    shell.cancel();

    const pending = shell.run('sleep 30', () => undefined);
    await flush();
    shell.cancel();
    shell.cancel();

    expect(await pending).toEqual(ok({ status: 'cancelled' }));
    expect(runs[0]!.cancel).toHaveBeenCalled();
    expect(shell.isRunning()).toBe(false);
  });

  it.each(['', '   '])('treats the blank command %j as a no-op without spawning', async (command) => {
    const { port } = fakeShell();
    const shell = session(service, { port });

    expect(await shell.run(command, () => undefined)).toEqual(ok({ status: 'noop' }));
    expect(port.run).not.toHaveBeenCalled();
  });

  it.each(['vim x', 'less f', 'top', 'ssh host', 'sh', 'bash'])('fails fast on the TTY program %j', async (command) => {
    const { port } = fakeShell();
    const shell = session(service, { port });

    const result = await shell.run(command, () => undefined);

    expect(result).toMatchObject({ ok: false, error: { code: 'tty-required' } });
    if (!result.ok) {
      expect(result.error.message).toMatch(/interactive terminal/);
    }
    expect(port.run).not.toHaveBeenCalled();
    expect(shell.isRunning()).toBe(false);
  });

  it('keeps only the last maxLines lines across runs and counts the dropped ones', async () => {
    const { port, runs } = fakeShell();
    const shell = session(service, { port }, 3);

    const pending = shell.run('seq 5', () => undefined);
    await flush();
    for (let index = 1; index <= 5; index += 1) {
      runs[0]!.emit({ stream: 'stdout', text: String(index) });
    }
    runs[0]!.finish({ status: 'exited', exitCode: 0 });
    await pending;

    expect(shell.output()).toEqual({
      lines: ['3', '4', '5'].map((text) => ({ stream: 'stdout', text })),
      droppedCount: 2,
    });
  });

  it('survives a throwing onLine consumer', async () => {
    const { port, runs } = fakeShell();
    const shell = session(service, { port });

    const pending = shell.run('echo a', () => {
      throw new Error('boom');
    });
    await flush();
    runs[0]!.emit({ stream: 'stdout', text: 'a' });
    runs[0]!.finish({ status: 'exited', exitCode: 0 });

    expect(await pending).toEqual(ok({ status: 'exited', exitCode: 0 }));
    expect(shell.output().lines).toEqual([{ stream: 'stdout', text: 'a' }]);
  });

  it('reports a throwing port as shell-unavailable instead of rejecting', async () => {
    const port: ShellSessionPort = {
      run: () => {
        throw new Error('spawn exploded');
      },
    };
    const shell = session(service, { port });

    expect(await shell.run('ls', () => undefined)).toMatchObject({ ok: false, error: { code: 'shell-unavailable' } });
    expect(shell.isRunning()).toBe(false);
  });
});

describe('ShellSession.run on a container', () => {
  it('runs once the container is up, passing the target through', async () => {
    const { port, runs } = fakeShell();
    const docker = fakeDocker(ok('up'));
    const shell = session(container, { port, docker });

    const pending = shell.run('ls', () => undefined);
    await flush();
    expect(docker.getContainerHealth).toHaveBeenCalledWith('api');
    expect(runs[0]).toMatchObject({ target: container, cwd: undefined });
    runs[0]!.finish({ status: 'exited', exitCode: 0, cwd: '/app' });
    await pending;
    expect(shell.cwd()).toBe('/app');
  });

  it.each<HealthState>(['down', 'restarting'])('refuses with container-not-running when health is %s', async (state) => {
    const { port } = fakeShell();
    const shell = session(container, { port, docker: fakeDocker(ok(state)) });

    expect(await shell.run('ls', () => undefined)).toMatchObject({ ok: false, error: { code: 'container-not-running' } });
    expect(port.run).not.toHaveBeenCalled();
    expect(shell.isRunning()).toBe(false);
  });

  it('propagates a health-check error as-is', async () => {
    const { port } = fakeShell();
    const failure = err('docker-unavailable', 'docker missing');
    const shell = session(container, { port, docker: fakeDocker(failure) });

    expect(await shell.run('ls', () => undefined)).toEqual(failure);
    expect(port.run).not.toHaveBeenCalled();
  });

  it('counts the health check as part of the run: concurrent runs and cancel apply', async () => {
    const { port } = fakeShell();
    let release!: (value: Result<HealthState>) => void;
    const docker = { getContainerHealth: vi.fn(() => new Promise<Result<HealthState>>((r) => (release = r))) };
    const shell = session(container, { port, docker });

    const pending = shell.run('ls', () => undefined);
    expect(await shell.run('pwd', () => undefined)).toMatchObject({ ok: false, error: { code: 'command-running' } });
    shell.cancel();
    release(ok('up'));

    expect(await pending).toEqual(ok({ status: 'cancelled' }));
    expect(port.run).not.toHaveBeenCalled();
  });
});
