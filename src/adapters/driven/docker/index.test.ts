// adapters/driven/docker: integration tests against a real, disposable `busybox` container —
// the binary is not mocked. Skipped entirely when no docker daemon is reachable (e.g. a
// sandboxed CI runner): there is nothing to assert about the real `docker` CLI without one.
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LogLine } from '../../../core/ports/docker.js';
import { createDockerPort } from './index.js';

const dockerAvailable = spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;

const containers: string[] = [];

function runDocker(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8' }).trim();
}

function startContainer(shellCommand: string): string {
  const name = `tui-back-docker-test-${randomUUID()}`;
  runDocker(['run', '-d', '--rm', '--name', name, 'busybox', 'sh', '-c', shellCommand]);
  containers.push(name);
  return name;
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor: timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

afterEach(() => {
  while (containers.length > 0) {
    const name = containers.pop();
    if (name === undefined) {
      continue;
    }
    try {
      runDocker(['rm', '-f', name]);
    } catch {
      // Already gone (e.g. the container's own command already exited and --rm cleaned it up).
    }
  }
});

describe.skipIf(!dockerAvailable)('createDockerPort (real docker integration)', () => {
  it(
    'streamLogs tags every line by stream and delivers it as the container emits it',
    async () => {
      const name = startContainer(
        'i=0; while [ $i -lt 5 ]; do echo "out-$i"; echo "err-$i" >&2; i=$((i+1)); sleep 0.1; done; sleep 5',
      );
      const port = createDockerPort();
      const lines: LogLine[] = [];
      const errors: unknown[] = [];
      const stop = port.streamLogs(
        name,
        (line) => lines.push(line),
        (error) => errors.push(error),
      );

      try {
        await waitFor(() => lines.some((l) => l.text === 'out-4') && lines.some((l) => l.text === 'err-4'), 8000);
      } finally {
        stop();
      }

      expect(errors).toEqual([]);
      // `--since` is captured the moment streamLogs() is called, after the container has
      // already been running for a little while — an earlier line (out-0, out-1, ...) may
      // already have been emitted before this subscription attached, so only the two lines
      // this waitFor() call itself waited on are guaranteed to have been captured.
      const outLine = lines.find((l) => l.text === 'out-4');
      const errLine = lines.find((l) => l.text === 'err-4');
      expect(outLine?.stream).toBe('stdout');
      expect(errLine?.stream).toBe('stderr');
      // Docker's own --timestamps RFC3339Nano prefix, not a fabricated receipt time.
      expect(outLine?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    },
    15000,
  );

  it('streamLogs reports a docker-unavailable error for a container that does not exist, and never spawns the -f tail', () => {
    const port = createDockerPort();
    const errors: { code: string; message: string }[] = [];
    const lines: LogLine[] = [];
    const stop = port.streamLogs(
      'tui-back-docker-test-does-not-exist',
      (line) => lines.push(line),
      (error) => errors.push(error),
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('docker-unavailable');
    expect(lines).toEqual([]);
    // The returned stop() is a no-op stub in this path — must never throw.
    expect(() => stop()).not.toThrow();
  });

  it(
    'fetchLogsBefore returns every buffered line strictly before the cursor, tagged and timestamped, chronologically ordered',
    async () => {
      const name = startContainer('echo first; sleep 0.3; echo second; sleep 10');
      await waitFor(() => runDocker(['logs', name]).includes('second'), 8000);

      const port = createDockerPort();
      const result = await port.fetchLogsBefore(name, new Date().toISOString(), 10);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.map((line) => line.text)).toEqual(['first', 'second']);
        expect(result.data.every((line) => line.stream === 'stdout')).toBe(true);
      }
    },
    10000,
  );

  it('fetchLogsBefore returns a docker-unavailable error for a container that does not exist', async () => {
    const port = createDockerPort();
    const result = await port.fetchLogsBefore('tui-back-docker-test-does-not-exist', new Date().toISOString(), 10);
    expect(result).toMatchObject({ ok: false, error: { code: 'docker-unavailable' } });
  });

  it('getContainerHealth returns up for a running container', async () => {
    const name = startContainer('sleep 30');
    const port = createDockerPort();

    const result = await port.getContainerHealth(name);

    expect(result).toEqual({ ok: true, data: 'up' });
  });

  it(
    'getContainerHealth returns down for a stopped (exited) container',
    async () => {
      // No `--rm` here (unlike startContainer): a removed container would exercise the
      // missing-name path below instead of the stopped-but-present mapping.
      const name = `tui-back-docker-test-${randomUUID()}`;
      runDocker(['run', '-d', '--name', name, 'busybox', 'true']);
      containers.push(name);
      await waitFor(() => runDocker(['inspect', '--format', '{{.State.Running}}', '--', name]) === 'false', 8000);

      const port = createDockerPort();
      const result = await port.getContainerHealth(name);

      expect(result).toEqual({ ok: true, data: 'down' });
    },
    15000,
  );

  it('getContainerHealth returns down for a container that does not exist', async () => {
    const port = createDockerPort();

    const result = await port.getContainerHealth('tui-back-docker-test-does-not-exist');

    expect(result).toEqual({ ok: true, data: 'down' });
  });

  it(
    'restartContainer restarts a running container, which reads up before and after',
    async () => {
      const name = startContainer('sleep 30');
      const port = createDockerPort();
      expect(await port.getContainerHealth(name)).toEqual({ ok: true, data: 'up' });

      const restarted = await port.restartContainer(name);

      expect(restarted).toEqual({ ok: true, data: undefined });
      // The restart itself is asynchronous daemon-side — wait until docker reports the
      // container running again before asserting the post-restart health.
      await waitFor(() => runDocker(['inspect', '--format', '{{.State.Running}}', '--', name]) === 'true', 8000);
      expect(await port.getContainerHealth(name)).toEqual({ ok: true, data: 'up' });
    },
    20000,
  );

  it('restartContainer returns a docker-unavailable error for a container that does not exist', async () => {
    const port = createDockerPort();

    const result = await port.restartContainer('tui-back-docker-test-does-not-exist');

    expect(result).toMatchObject({ ok: false, error: { code: 'docker-unavailable' } });
  });
});

describe.skipIf(dockerAvailable)('createDockerPort (docker unavailable in this environment)', () => {
  it('is skipped — no docker daemon reachable here', () => {
    expect(dockerAvailable).toBe(false);
  });
});

// Spawn failure diagnostics — runs whether or not a docker daemon is reachable, since it only
// needs the `docker` binary to be absent from PATH.
describe('spawn failure diagnostics (status === null)', () => {
  it('streamLogs reports the real ENOENT cause, not a bare/empty message, when docker is missing from PATH', () => {
    const originalPath = process.env.PATH;
    process.env.PATH = join(tmpdir(), 'tui-back-no-bin');
    try {
      const port = createDockerPort();
      const errors: { code: string; message: string }[] = [];
      port.streamLogs('any-container', () => {}, (error) => errors.push(error));
      expect(errors).toHaveLength(1);
      expect(errors[0]?.code).toBe('docker-unavailable');
      expect(errors[0]?.message).toMatch(/ENOENT/);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('fetchLogsBefore reports the real ENOENT cause when docker is missing from PATH', async () => {
    const originalPath = process.env.PATH;
    process.env.PATH = join(tmpdir(), 'tui-back-no-bin');
    try {
      const port = createDockerPort();
      const result = await port.fetchLogsBefore('any-container', new Date().toISOString(), 10);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('docker-unavailable');
        expect(result.error.message).toMatch(/ENOENT/);
      }
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('getContainerHealth reports docker-unavailable (never a bare down) when docker is missing from PATH', async () => {
    const originalPath = process.env.PATH;
    process.env.PATH = join(tmpdir(), 'tui-back-no-bin');
    try {
      const port = createDockerPort();
      const result = await port.getContainerHealth('any-container');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('docker-unavailable');
        expect(result.error.message).toMatch(/ENOENT/);
      }
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('restartContainer reports the real ENOENT cause when docker is missing from PATH', async () => {
    const originalPath = process.env.PATH;
    process.env.PATH = join(tmpdir(), 'tui-back-no-bin');
    try {
      const port = createDockerPort();
      const result = await port.restartContainer('any-container');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('docker-unavailable');
        expect(result.error.message).toMatch(/ENOENT/);
      }
    } finally {
      process.env.PATH = originalPath;
    }
  });
});
