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
    // `exit` skips the sentinel: no cwd reported.
    expect((await runIn(target, repo, 'exit 3')).outcome).toEqual({ status: 'exited', exitCode: 3 });
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

  it('runs without a TTY and with a dumb terminal and cat pagers', async () => {
    const repo = await makeRepo();

    const { lines } = await runIn(
      { kind: 'service', repoPath: repo },
      repo,
      'test -t 0 && echo tty0; test -t 1 && echo tty1; echo "$TERM $PAGER $GIT_PAGER"',
    );

    expect(lines).toEqual([{ stream: 'stdout', text: 'dumb cat cat' }]);
  });

  it('cancel kills the whole process group, grandchildren included, then settles cancelled', async () => {
    const repo = await makeRepo();
    const lines: ShellLine[] = [];
    const handle = createShellSessionPort().run(
      { kind: 'service', repoPath: repo },
      repo,
      // The grandchild `sleep` runs in the background; the shell waits on it.
      'sleep 30 & echo "$!"; wait',
      (line) => lines.push(line),
    );
    // Wait for the grandchild's pid to be printed.
    for (let attempt = 0; attempt < 100 && lines.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const grandchild = Number(lines[0]?.text);
    expect(alive(grandchild)).toBe(true);

    handle.cancel();
    handle.cancel();

    expect(await handle.done).toEqual({ status: 'cancelled' });
    expect(alive(grandchild)).toBe(false);
    handle.cancel();
  });

  it('escalates to SIGKILL when the group ignores SIGTERM', async () => {
    const repo = await makeRepo();
    const lines: ShellLine[] = [];
    const handle = createShellSessionPort({ killGraceMs: 100 }).run(
      { kind: 'service', repoPath: repo },
      repo,
      "trap '' TERM; echo ready; while :; do sleep 0.05; done",
      (line) => lines.push(line),
    );
    for (let attempt = 0; attempt < 100 && lines.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    handle.cancel();

    expect(await handle.done).toEqual({ status: 'cancelled' });
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
  // A stub `docker` that logs its argv (one arg per line, then a separator) and runs the
  // trailing `sh -c <script>` locally, so the sentinel round-trip is exercised too.
  async function makeStubDocker(): Promise<{ docker: string; logPath: string }> {
    const stubDir = await mkdtemp(join(tmpdir(), 'tui-back-docker-stub-'));
    tmpDirs.push(stubDir);
    const logPath = join(stubDir, 'argv.log');
    const docker = join(stubDir, 'docker');
    await writeFile(
      docker,
      `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a" >> "${logPath}"; done\necho --- >> "${logPath}"\n` +
        `while [ "$#" -gt 1 ] && [ "$1" != "-c" ]; do shift; done\nshift\nexec sh -c "$1"\n`,
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

  it('runs `docker exec <container> sh -c <wrapped>` without -t/-i, adding -w only when a cwd is known', async () => {
    const { docker, logPath } = await makeStubDocker();
    const target: ShellTarget = { kind: 'container', container: 'api' };

    const first = await runIn(target, undefined, 'echo hi', { docker });
    const second = await runIn(target, '/tmp', 'echo again', { docker });

    expect(first.lines).toEqual([{ stream: 'stdout', text: 'hi' }]);
    expect(first.outcome).toMatchObject({ status: 'exited', exitCode: 0 });
    expect(second.lines).toEqual([{ stream: 'stdout', text: 'again' }]);

    const [argv1, argv2] = await argvOf(logPath);
    expect(argv1?.slice(0, 4)).toEqual(['exec', 'api', 'sh', '-c']);
    // The wrapped script spans several log lines: the command, then the sentinel trailer.
    expect(argv1?.[4]).toBe('echo hi');
    expect(argv1?.[5]).toMatch(/^__rc=\$\?; printf /);
    expect(argv2?.slice(0, 6)).toEqual(['exec', '-w', '/tmp', 'api', 'sh', '-c']);
    for (const argv of [argv1, argv2]) {
      expect(argv).not.toContain('-t');
      expect(argv).not.toContain('-i');
      expect(argv).not.toContain('-it');
    }
  });

  it('settles failed/shell-unavailable when the docker executable is missing', async () => {
    const { outcome } = await runIn({ kind: 'container', container: 'api' }, undefined, 'ls', {
      docker: join(tmpdir(), 'tui-back-no-bin', 'docker'),
    });

    expect(outcome).toMatchObject({ status: 'failed', error: { code: 'shell-unavailable' } });
  });
});
