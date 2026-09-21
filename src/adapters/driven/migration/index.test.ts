// adapters/driven/migration: integration tests against the real `sh` plus a stubbed shell
// (AD-13 driven layer). The stub-shell cases mirror the container adapter's
// stub-executable pattern: the adapter's whole contract is how the shell's exit
// codes/streams surface as Result errors, exercised through a stub `sh` script on a temp
// dir that records its argv and cwd and exits as instructed.
import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { createMigrationPort, runMigration } from './index.js';

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
  const dir = await mkdtemp(join(tmpdir(), 'tui-back-migration-repo-'));
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

describe('runMigration', () => {
  it('runs the command through the shell with the repo as its working directory and reports its stdout', async () => {
    const repo = await makeRepoDir();
    const { stubDir, logPath } = await makeStubShell(0, 'migrated 3 tables', '');

    const result = await runMigration(join(stubDir, 'sh'), repo, 'npm run migration:run');

    expect(result).toEqual({ ok: true, data: { output: 'migrated 3 tables' } });
    const logged = await readFile(logPath, 'utf8');
    expect(logged).toContain('-c npm run migration:run');
    expect(logged).toContain(repo);
  });

  it('runs against the real sh: a trivially true command succeeds with its output', async () => {
    const repo = await makeRepoDir();

    const result = await runMigration('sh', repo, 'echo hello-migration');

    expect(result).toEqual({ ok: true, data: { output: 'hello-migration' } });
  });

  it('surfaces a non-zero shell exit as migration-failed with the captured error output', async () => {
    const repo = await makeRepoDir();
    const { stubDir } = await makeStubShell(3, '', 'relation users does not exist');

    const result = await runMigration(join(stubDir, 'sh'), repo, 'npm run migration:run');

    expect(result).toMatchObject({ ok: false, error: { code: 'migration-failed' } });
    if (!result.ok) {
      expect(result.error.message).toContain('npm run migration:run');
      expect(result.error.message).toContain(repo);
      expect(result.error.message).toContain('relation users does not exist');
    }
  });

  it('runs against the real sh: a failing command surfaces its stderr, never a bare exit', async () => {
    const repo = await makeRepoDir();

    const result = await runMigration('sh', repo, 'echo migration-boom >&2; exit 3');

    expect(result).toMatchObject({ ok: false, error: { code: 'migration-failed' } });
    if (!result.ok) {
      expect(result.error.message).toContain('migration-boom');
    }
  });

  it('surfaces a missing shell binary (status === null) with the real spawn cause, never a bare stderr', async () => {
    const repo = await makeRepoDir();

    const result = await runMigration(join(tmpdir(), 'tui-back-no-bin', 'sh'), repo, 'npm run migration:run');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('migration-failed');
      expect(result.error.message).toMatch(/ENOENT/);
    }
  });

  it('rejects an empty or whitespace-only command upfront, never spawning the shell', async () => {
    const repo = await makeRepoDir();
    const { stubDir, logPath } = await makeStubShell(0, '', '');

    for (const command of ['', '   ']) {
      const result = await runMigration(join(stubDir, 'sh'), repo, command);

      expect(result).toMatchObject({ ok: false, error: { code: 'migration-failed' } });
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

    const result = await runMigration(join(stubDir, 'sh'), repo, 'npm run migration:run');

    expect(result).toMatchObject({ ok: false, error: { code: 'migration-failed' } });
    if (!result.ok) {
      expect(result.error.message).toContain('exit 1');
    }
  });
});

describe('createMigrationPort', () => {
  it('wires run behind the factory pattern with the default sh shell', async () => {
    const repo = await makeRepoDir();
    const { stubDir } = await makeStubShell(0, 'ok', '');
    const originalPath = process.env.PATH;
    process.env.PATH = `${stubDir}${delimiter}${originalPath}`;
    try {
      const port = createMigrationPort();

      expect(await port.run(repo, 'npm run migration:run')).toEqual({ ok: true, data: { output: 'ok' } });
    } finally {
      process.env.PATH = originalPath;
    }
  });
});
