// adapters/driven/container: integration tests against a stubbed executable (AD-13 driven
// layer). The real `docker` binary is never invoked — the adapter's whole contract is how
// the runtime's exit codes/stderr surface as Result errors, exercised here through a stub
// `docker` script on a temp PATH dir that records its argv and exits as instructed.
import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { createContainerPort, restartContainer } from './index.js';

const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

// Writes a stub `docker` that appends "$@" to argv.log, prints `stderrText` to stderr, and
// exits `exitCode`. Returns the stub dir (to prepend to PATH) and the log path.
async function makeStubDocker(exitCode: number, stderrText: string): Promise<{ stubDir: string; logPath: string }> {
  const stubDir = await mkdtemp(join(tmpdir(), 'tui-back-docker-stub-'));
  tmpDirs.push(stubDir);
  const logPath = join(stubDir, 'argv.log');
  await writeFile(
    join(stubDir, 'docker'),
    `#!/bin/sh\necho "$@" >> "${logPath}"\nprintf '%s' "${stderrText}" >&2\nexit ${exitCode}\n`,
    { mode: 0o755 },
  );
  return { stubDir, logPath };
}

describe('restartContainer', () => {
  it('restarts the named container via `docker restart -- <container>` and reports ok', async () => {
    const { stubDir, logPath } = await makeStubDocker(0, '');

    const result = await restartContainer(join(stubDir, 'docker'), 'route-explorer');

    expect(result).toEqual({ ok: true, data: undefined });
    // The trailing `--` keeps a container value starting with `-` out of flag position.
    expect(await readFile(logPath, 'utf8')).toBe('restart -- route-explorer\n');
  });

  it('surfaces a non-zero runtime exit as container-restart-error with the runtime stderr', async () => {
    const { stubDir } = await makeStubDocker(1, 'Error: No such container: missing');

    const result = await restartContainer(join(stubDir, 'docker'), 'missing');

    expect(result).toMatchObject({ ok: false, error: { code: 'container-restart-error' } });
    if (!result.ok) {
      expect(result.error.message).toContain('No such container: missing');
    }
  });

  it('surfaces a missing runtime binary (status === null) with the real spawn cause, never a bare stderr', async () => {
    const result = await restartContainer(join(tmpdir(), 'tui-back-no-bin', 'docker'), 'route-explorer');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('container-restart-error');
      expect(result.error.message).toMatch(/ENOENT/);
    }
  });

  it('rejects an empty or whitespace-only container name upfront, never spawning the runtime', async () => {
    const { stubDir, logPath } = await makeStubDocker(0, '');

    for (const container of ['', '   ']) {
      const result = await restartContainer(join(stubDir, 'docker'), container);

      expect(result).toMatchObject({ ok: false, error: { code: 'container-restart-error' } });
      if (!result.ok) {
        expect(result.error.message).toContain('must not be empty');
      }
    }
    // The runtime was never invoked — no argv was ever recorded.
    await expect(readFile(logPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('falls back to the exit status when the runtime fails with blank stderr', async () => {
    const { stubDir } = await makeStubDocker(1, '');

    const result = await restartContainer(join(stubDir, 'docker'), 'route-explorer');

    expect(result).toMatchObject({ ok: false, error: { code: 'container-restart-error' } });
    if (!result.ok) {
      expect(result.error.message).toContain('exit 1');
    }
  });
});

describe('createContainerPort', () => {
  it('wires restart behind the factory pattern with the default docker executable', async () => {
    const { stubDir } = await makeStubDocker(0, '');
    const originalPath = process.env.PATH;
    process.env.PATH = `${stubDir}${delimiter}${originalPath}`;
    try {
      const port = createContainerPort();

      expect(await port.restart('route-explorer')).toEqual({ ok: true, data: undefined });
    } finally {
      process.env.PATH = originalPath;
    }
  });
});
