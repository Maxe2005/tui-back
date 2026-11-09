// adapters/driven/shell-session: integration tests against the real `sh` in a temp dir, and a
// stub `docker` script (same seam as the container adapter's tests) recording its argv.
import { describe, expect, it, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createShellSessionPort } from './index.js';
import type { ShellLine, ShellRunOutcome, ShellTarget } from '../../../core/ports/shell-session.js';

const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function makeRepo(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'tui-back-shell-')));
  tmpDirs.push(dir);
  await mkdir(join(dir, 'sub'));
  return dir;
}

async function runIn(
  target: ShellTarget,
  cwd: string | undefined,
  command: string,
  options: Parameters<typeof createShellSessionPort>[0] = {},
): Promise<{ lines: ShellLine[]; outcome: ShellRunOutcome }> {
  const lines: ShellLine[] = [];
  const handle = createShellSessionPort(options).run(target, cwd, command, (line) => lines.push(line));
  return { lines, outcome: await handle.done };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// The process group is gone when signalling it reports ESRCH.
function groupErrorCode(pgid: number): string | undefined {
  try {
    process.kill(-pgid, 0);
    return undefined;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code;
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('createShellSessionPort — service target (real sh)', () => {
  it('streams tagged stdout/stderr lines, hides the sentinel and reports exit code and cwd', async () => {
    const repo = await makeRepo();

    const { lines, outcome } = await runIn({ kind: 'service', repoPath: repo }, undefined, 'echo a; echo b >&2');

    expect(lines).toEqual([
      { stream: 'stdout', text: 'a' },
      { stream: 'stderr', text: 'b' },
    ]);
    expect(outcome).toEqual({ status: 'exited', exitCode: 0, cwd: repo });
  });

  it('reports a non-zero exit code as a normal outcome', async () => {
    const repo = await makeRepo();
    const target: ShellTarget = { kind: 'service', repoPath: repo };

    expect((await runIn(target, repo, 'false')).outcome).toEqual({ status: 'exited', exitCode: 1, cwd: repo });
    // The EXIT trap still reports cwd when the command calls `exit`.
    const exited = await runIn(target, repo, 'exit 3');
    expect(exited.outcome).toEqual({ status: 'exited', exitCode: 3, cwd: repo });
    expect(exited.lines).toEqual([]);
  });

  it('survives a trailing backslash, keeping the sentinel hidden', async () => {
    const repo = await makeRepo();

    const { lines, outcome } = await runIn({ kind: 'service', repoPath: repo }, repo, 'echo a \\');

    expect(outcome).toEqual({ status: 'exited', exitCode: 0, cwd: repo });
    expect(lines.every((line) => !line.text.includes('__TUI_BACK_CWD_'))).toBe(true);
    expect(lines[0]?.text.startsWith('a')).toBe(true);
  });

  it('reports the exit code and cwd under set -e, keeping the sentinel hidden', async () => {
    const repo = await makeRepo();

    const { lines, outcome } = await runIn({ kind: 'service', repoPath: repo }, repo, 'set -e; false; echo x');

    expect(outcome).toEqual({ status: 'exited', exitCode: 1, cwd: repo });
    expect(lines).toEqual([]);
  });

  it('maps a signal death to 128 + signal number', async () => {
    const repo = await makeRepo();
    const target: ShellTarget = { kind: 'service', repoPath: repo };

    // SIGKILL can't run the EXIT trap: no cwd.
    expect((await runIn(target, repo, 'kill -KILL $$')).outcome).toEqual({ status: 'exited', exitCode: 137 });
    // POSIX sh (dash) skips the EXIT trap on an untrapped fatal signal; bash-as-sh may run it.
    const term = await runIn(target, repo, 'kill -TERM $$');
    expect(term.outcome).toMatchObject({ status: 'exited', exitCode: 143 });
    if (term.outcome.status === 'exited' && term.outcome.cwd !== undefined) {
      expect(term.outcome.cwd).toBe(repo);
    }
    expect(term.lines).toEqual([]);
  });

  it('settles shortly after the shell exits even when a background job holds the pipes', async () => {
    const repo = await makeRepo();
    const started = Date.now();

    const { lines, outcome } = await runIn({ kind: 'service', repoPath: repo }, repo, 'sleep 5 & echo "$!"; echo started');

    expect(Date.now() - started).toBeLessThan(1500);
    expect(outcome).toEqual({ status: 'exited', exitCode: 0, cwd: repo });
    expect(lines[1]).toEqual({ stream: 'stdout', text: 'started' });
    // A normally completed run leaves its background job alone; clean it up here.
    const sleeper = Number(lines[0]?.text);
    expect(alive(sleeper)).toBe(true);
    process.kill(sleeper, 'SIGKILL');
  });

  it('ignores cancel once the shell exited: the run keeps its exited outcome', async () => {
    const repo = await makeRepo();
    const lines: ShellLine[] = [];
    // The background sleep holds the pipes, so the run stays in its drain window after exit.
    const handle = createShellSessionPort().run(
      { kind: 'service', repoPath: repo },
      repo,
      'sleep 3 & echo "$!"; exit 4',
      (line) => lines.push(line),
    );
    await waitFor(() => lines.length > 0);
    const sleeper = Number(lines[0]?.text);
    expect(Number.isInteger(sleeper)).toBe(true);
    // Give the shell time to exit (the sleeper keeps the pipes open).
    await new Promise((resolve) => setTimeout(resolve, 100));

    handle.cancel();

    expect(await handle.done).toEqual({ status: 'exited', exitCode: 4, cwd: repo });
    // No signal reached the group: the background job is untouched.
    expect(alive(sleeper)).toBe(true);
    process.kill(sleeper, 'SIGKILL');
  });

  it('settles failed/cwd-missing when the requested cwd no longer exists', async () => {
    const repo = await makeRepo();

    const { outcome } = await runIn({ kind: 'service', repoPath: repo }, join(repo, 'deleted'), 'ls');

    expect(outcome).toMatchObject({ status: 'failed', error: { code: 'cwd-missing' } });
  });

  it('reports the new cwd after cd and runs the next command there', async () => {
    const repo = await makeRepo();
    const target: ShellTarget = { kind: 'service', repoPath: repo };

    const cd = await runIn(target, repo, 'cd sub');
    expect(cd.outcome).toEqual({ status: 'exited', exitCode: 0, cwd: join(repo, 'sub') });

    const pwd = await runIn(target, join(repo, 'sub'), 'pwd');
    expect(pwd.lines).toEqual([{ stream: 'stdout', text: join(repo, 'sub') }]);
  });

  it('keeps the cwd on a bad cd, with the shell error on stderr', async () => {
    const repo = await makeRepo();

    const { lines, outcome } = await runIn({ kind: 'service', repoPath: repo }, repo, 'cd nope');

    expect(outcome).toMatchObject({ status: 'exited', cwd: repo });
    expect(outcome.status === 'exited' && outcome.exitCode).not.toBe(0);
    expect(lines.some((line) => line.stream === 'stderr' && line.text.includes('nope'))).toBe(true);
  });

  it('flushes an unterminated last line and keeps genuine empty lines', async () => {
    const repo = await makeRepo();

    const { lines, outcome } = await runIn({ kind: 'service', repoPath: repo }, repo, "printf 'x\\n\\ny'; printf 'tail' >&2");

    expect(lines.filter((line) => line.stream === 'stdout').map((line) => line.text)).toEqual(['x', '', 'y']);
    expect(lines.filter((line) => line.stream === 'stderr').map((line) => line.text)).toEqual(['tail']);
    expect(outcome).toMatchObject({ status: 'exited', exitCode: 0 });
  });

  it('runs without a TTY, with a dumb terminal, cat pagers and colours disabled', async () => {
    const repo = await makeRepo();
    const saved = { FORCE_COLOR: process.env.FORCE_COLOR, CLICOLOR_FORCE: process.env.CLICOLOR_FORCE };
    process.env.FORCE_COLOR = '1';
    process.env.CLICOLOR_FORCE = '1';
    try {
      const { lines } = await runIn(
        { kind: 'service', repoPath: repo },
        repo,
        'test -t 0 && echo tty0; test -t 1 && echo tty1; echo "$TERM $PAGER $GIT_PAGER $NO_COLOR [${FORCE_COLOR-unset}] [${CLICOLOR_FORCE-unset}]"',
      );

      expect(lines).toEqual([{ stream: 'stdout', text: 'dumb cat cat 1 [unset] [unset]' }]);
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    }
  });

  it('delivers a held empty stdout line before a following stderr line', async () => {
    const repo = await makeRepo();

    const { lines } = await runIn({ kind: 'service', repoPath: repo }, repo, "printf 'a\\n\\n'; sleep 0.1; echo b >&2");

    expect(lines).toEqual([
      { stream: 'stdout', text: 'a' },
      { stream: 'stdout', text: '' },
      { stream: 'stderr', text: 'b' },
    ]);
  });

  it('cancel kills the whole process group, grandchildren included, then settles cancelled', async () => {
    const repo = await makeRepo();
    const lines: ShellLine[] = [];
    const handle = createShellSessionPort().run(
      { kind: 'service', repoPath: repo },
      repo,
      // The grandchild `sleep` runs in the background; the shell (its group leader) waits on it.
      'sleep 30 & echo "$$ $!"; wait',
      (line) => lines.push(line),
    );
    await waitFor(() => lines.length > 0);
    const [pgid, grandchild] = (lines[0]?.text ?? '').split(' ').map(Number);
    expect(Number.isInteger(pgid) && Number.isInteger(grandchild)).toBe(true);
    expect(alive(grandchild!)).toBe(true);

    handle.cancel();
    handle.cancel();

    expect(await handle.done).toEqual({ status: 'cancelled' });
    expect(alive(grandchild!)).toBe(false);
    expect(groupErrorCode(pgid!)).toBe('ESRCH');
    handle.cancel();
  });

  it('escalates to SIGKILL when the group ignores SIGTERM', async () => {
    const repo = await makeRepo();
    const lines: ShellLine[] = [];
    const handle = createShellSessionPort({ killGraceMs: 100 }).run(
      { kind: 'service', repoPath: repo },
      repo,
      "trap '' TERM; echo ready $$; while :; do sleep 0.05; done",
      (line) => lines.push(line),
    );
    await waitFor(() => lines.length > 0);
    expect(lines[0]?.text).toMatch(/^ready \d+$/);
    const pgid = Number(lines[0]?.text.split(' ')[1]);

    handle.cancel();

    expect(await handle.done).toEqual({ status: 'cancelled' });
    expect(groupErrorCode(pgid)).toBe('ESRCH');
  });

  it('settles failed/shell-unavailable when the shell cannot be spawned, never rejecting', async () => {
    const repo = await makeRepo();

    const { outcome } = await runIn({ kind: 'service', repoPath: repo }, repo, 'ls', {
      shell: join(repo, 'no-such-shell'),
    });

    expect(outcome).toMatchObject({ status: 'failed', error: { code: 'shell-unavailable' } });
  });
});

describe('createShellSessionPort — container target (stub docker)', () => {
  // A stub `docker` that logs its argv (one arg per line, then a separator), honours `-w` and
  // runs the trailing `sh -c <script>` locally, so the sentinel round-trip is exercised too.
  async function makeStubDocker(): Promise<{ docker: string; logPath: string }> {
    const stubDir = await mkdtemp(join(tmpdir(), 'tui-back-docker-stub-'));
    tmpDirs.push(stubDir);
    const logPath = join(stubDir, 'argv.log');
    const docker = join(stubDir, 'docker');
    await writeFile(
      docker,
      `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a" >> "${logPath}"; done\necho --- >> "${logPath}"\n` +
        `while [ "$#" -gt 0 ]; do case "$1" in -w) shift; cd "$1" || exit 126;; -c) shift; exec sh -c "$1";; esac; shift; done\n`,
      { mode: 0o755 },
    );
    return { docker, logPath };
  }

  async function argvOf(logPath: string): Promise<string[][]> {
    const text = await readFile(logPath, 'utf8');
    return text
      .split('---\n')
      .filter((chunk) => chunk !== '')
      .map((chunk) => chunk.split('\n'));
  }

  const ENV_ARGS = ['-e', 'TERM=dumb', '-e', 'PAGER=cat', '-e', 'GIT_PAGER=cat', '-e', 'NO_COLOR=1'];

  it('runs `docker exec -e … <container> sh -c <wrapped>` without -t/-i, adding -w only when a cwd is known', async () => {
    const { docker, logPath } = await makeStubDocker();
    const target: ShellTarget = { kind: 'container', container: 'api' };

    const first = await runIn(target, undefined, 'echo hi', { docker });
    const second = await runIn(target, '/tmp', 'echo again', { docker });

    expect(first.lines).toEqual([{ stream: 'stdout', text: 'hi' }]);
    expect(first.outcome).toMatchObject({ status: 'exited', exitCode: 0 });
    expect(second.lines).toEqual([{ stream: 'stdout', text: 'again' }]);

    const [argv1, argv2] = await argvOf(logPath);
    expect(argv1?.slice(0, 12)).toEqual(['exec', ...ENV_ARGS, 'api', 'sh', '-c']);
    // The wrapped script spans several log lines: the sentinel trap, then the command.
    expect(argv1?.[12]).toMatch(/^trap '__rc=\$\?; printf /);
    expect(argv1?.[13]).toBe('echo hi');
    expect(argv2?.slice(0, 14)).toEqual(['exec', ...ENV_ARGS, '-w', '/tmp', 'api', 'sh', '-c']);
    for (const argv of [argv1, argv2]) {
      expect(argv).not.toContain('-t');
      expect(argv).not.toContain('-i');
      expect(argv).not.toContain('-it');
    }
  });

  it('reports the container-side cwd from the sentinel', async () => {
    const { docker } = await makeStubDocker();
    const repo = await makeRepo();
    const target: ShellTarget = { kind: 'container', container: 'api' };

    const { lines, outcome } = await runIn(target, join(repo, 'sub'), 'cd ..; echo moved', { docker });

    expect(lines).toEqual([{ stream: 'stdout', text: 'moved' }]);
    expect(outcome).toEqual({ status: 'exited', exitCode: 0, cwd: repo });
  });

  it('settles failed/shell-unavailable when the docker executable is missing', async () => {
    const { outcome } = await runIn({ kind: 'container', container: 'api' }, undefined, 'ls', {
      docker: join(tmpdir(), 'tui-back-no-bin', 'docker'),
    });

    expect(outcome).toMatchObject({ status: 'failed', error: { code: 'shell-unavailable' } });
  });
});
