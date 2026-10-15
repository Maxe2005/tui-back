// adapters/driven/restart: integration tests against the real `sh` plus a stubbed shell
// script on a temp dir that records its argv and cwd and exits as instructed — the adapter's
// contract is how the shell's exit codes/streams surface as Result errors.
import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { createRestartPort, runRestart } from './index.js';

const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function makeRepoDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tui-back-restart-repo-'));
  tmpDirs.push(dir);
  return dir;
}

// Writes a stub `sh` that appends "$@" and its cwd to argv.log, prints `stdoutText` to
// stdout / `stderrText` to stderr, and exits `exitCode`. Returns the stub dir (to pass as
// the injectable shell) and the log path.
async function makeStubShell(
  exitCode: number,
  stdoutText: string,
  stderrText: string,
): Promise<{ stubDir: string; logPath: string }> {
  const stubDir = await mkdtemp(join(tmpdir(), 'tui-back-sh-stub-'));
  tmpDirs.push(stubDir);
  const logPath = join(stubDir, 'argv.log');
  await writeFile(
    join(stubDir, 'sh'),
    `#!/bin/sh\necho "$@" >> "${logPath}"\npwd >> "${logPath}"\nprintf '%s' "${stdoutText}"\nprintf '%s' "${stderrText}" >&2\nexit ${exitCode}\n`,
    { mode: 0o755 },
  );
  return { stubDir, logPath };
}

describe('runRestart', () => {
  it('runs the command through the shell with the repo as its working directory and reports its stdout', async () => {
    const repo = await makeRepoDir();
    const { stubDir, logPath } = await makeStubShell(0, 'restarted clean', '');

    const result = await runRestart(join(stubDir, 'sh'), repo, 'npm ci');

    expect(result).toEqual({ ok: true, data: { output: 'restarted clean' } });
    const logged = await readFile(logPath, 'utf8');
    expect(logged).toContain('-c npm ci');
    expect(logged).toContain(repo);
  });

  it('runs against the real sh: a trivially true command succeeds with its output', async () => {
    const repo = await makeRepoDir();

    const result = await runRestart('sh', repo, 'echo hello-restart');

    expect(result).toEqual({ ok: true, data: { output: 'hello-restart' } });
  });

  it('surfaces a non-zero shell exit as restart-failed with the captured error output', async () => {
    const repo = await makeRepoDir();
    const { stubDir } = await makeStubShell(3, '', 'compose up blew up');

    const result = await runRestart(join(stubDir, 'sh'), repo, 'docker compose up -d --build');

    expect(result).toMatchObject({ ok: false, error: { code: 'restart-failed' } });
    if (!result.ok) {
      expect(result.error.message).toContain('docker compose up -d --build');
      expect(result.error.message).toContain(repo);
      expect(result.error.message).toContain('compose up blew up');
    }
  });

  it('runs against the real sh: a failing command surfaces its stderr, never a bare exit', async () => {
    const repo = await makeRepoDir();

    const result = await runRestart('sh', repo, 'echo restart-boom >&2; exit 3');

    expect(result).toMatchObject({ ok: false, error: { code: 'restart-failed' } });
    if (!result.ok) {
      expect(result.error.message).toContain('restart-boom');
    }
  });

  it('surfaces a missing shell binary (status === null) with the real spawn cause, never a bare stderr', async () => {
    const repo = await makeRepoDir();

    const result = await runRestart(join(tmpdir(), 'tui-back-no-bin', 'sh'), repo, 'npm ci');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('restart-failed');
      expect(result.error.message).toMatch(/ENOENT/);
    }
  });

  it('rejects an empty or whitespace-only command upfront, never spawning the shell', async () => {
    const repo = await makeRepoDir();
    const { stubDir, logPath } = await makeStubShell(0, '', '');

    for (const command of ['', '   ']) {
      const result = await runRestart(join(stubDir, 'sh'), repo, command);

      expect(result).toMatchObject({ ok: false, error: { code: 'restart-failed' } });
      if (!result.ok) {
        expect(result.error.message).toContain('must not be empty');
      }
    }
    // The shell was never invoked — no argv was ever recorded.
    await expect(readFile(logPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('falls back to the exit status when the command fails with blank output on both streams', async () => {
    const repo = await makeRepoDir();
    const { stubDir } = await makeStubShell(1, '', '');

    const result = await runRestart(join(stubDir, 'sh'), repo, 'npm ci');

    expect(result).toMatchObject({ ok: false, error: { code: 'restart-failed' } });
    if (!result.ok) {
      expect(result.error.message).toContain('exit 1');
    }
  });
});

describe('createRestartPort', () => {
  it('wires run behind the factory pattern with the default sh shell', async () => {
    const repo = await makeRepoDir();
    const { stubDir } = await makeStubShell(0, 'ok', '');
    const originalPath = process.env.PATH;
    process.env.PATH = `${stubDir}${delimiter}${originalPath}`;
    try {
      const port = createRestartPort();

      expect(await port.run(repo, 'npm ci')).toEqual({ ok: true, data: { output: 'ok' } });
    } finally {
      process.env.PATH = originalPath;
    }
  });
});
