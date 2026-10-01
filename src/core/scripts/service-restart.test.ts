import { describe, expect, it, vi, type Mock } from 'vitest';
import { err, ok } from '../result.js';
import type { ContainerPort } from '../ports/container.js';
import type { LockPort } from '../ports/lock.js';
import type { Manifest, ManifestPort } from '../ports/manifest.js';
import type { RestartPort } from '../ports/restart.js';
import { serviceRestart, serviceRestartLockKey, type ServiceRestartParams } from './service-restart.js';
import type { UpdatePhase } from './group-update.js';

function calls(fn: unknown): Array<unknown[]> {
  return (fn as unknown as Mock).mock.calls;
}

function manifestFor(service: string, restartCommands?: string[]): Manifest {
  return {
    service,
    container: `ctr-${service}`,
    migrationCommand: 'npm run migration:run',
    ...(restartCommands !== undefined ? { restartCommands } : {}),
    sharedBranch: 'development',
    modules: {},
  };
}

function fakeManifest(loaded: Manifest | null, code = 'manifest-not-found'): ManifestPort {
  return {
    load: vi.fn(async (repoPath: string) =>
      loaded !== null ? ok(loaded) : err(code, `No manifest at ${repoPath}`),
    ),
  };
}

function fakeContainer(overrides: Partial<ContainerPort> = {}): ContainerPort {
  return {
    restart: vi.fn(async () => ok(undefined)),
    ...overrides,
  };
}

function fakeRestart(overrides: Partial<RestartPort> = {}): RestartPort {
  return {
    run: vi.fn(async () => ok({ output: '' })),
    ...overrides,
  };
}

function fakeLock(overrides: Partial<LockPort> = {}): LockPort {
  return {
    acquire: vi.fn(async () => ok({ release: vi.fn(async () => ok(undefined)) })),
    peek: vi.fn(async () => ok({ locked: false })),
    ...overrides,
  };
}

function makeParams(overrides: Partial<ServiceRestartParams> = {}): ServiceRestartParams {
  return {
    manifest: fakeManifest(manifestFor('svc-a', ['npm ci', 'docker compose up -d --build'])),
    container: fakeContainer(),
    restart: fakeRestart(),
    lock: fakeLock(),
    repoPath: '/repo/a',
    ...overrides,
  };
}

describe('serviceRestart — standalone single-service clean restart (story 3.9)', () => {
  it('with a declared recipe runs each command in order in the repo cwd, never the plain restart', async () => {
    const container = fakeContainer();
    const restart = fakeRestart();
    const lock = fakeLock();

    const result = await serviceRestart(
      makeParams({ manifest: fakeManifest(manifestFor('svc-a', ['npm ci', 'docker compose up -d --build'])), container, restart, lock }),
    );

    expect(result).toMatchObject({ ok: true, data: { service: 'svc-a', outcome: 'updated' } });
    expect(calls(restart.run)).toEqual([
      ['/repo/a', 'npm ci'],
      ['/repo/a', 'docker compose up -d --build'],
    ]);
    expect(calls(container.restart)).toHaveLength(0);
    expect(calls(lock.acquire)).toEqual([[serviceRestartLockKey('/repo/a')]]);
  });

  it('a failing recipe command stops the recipe and reports failed with service, command, and output', async () => {
    const restart = fakeRestart({
      run: vi.fn(async (repoPath: string, command: string) =>
        command === 'npm ci' ? err('restart-failed', 'compose up blew up') : ok({ output: '' }),
      ),
    });
    const container = fakeContainer();

    const result = await serviceRestart(
      makeParams({ manifest: fakeManifest(manifestFor('svc-a', ['npm ci', 'docker compose up -d --build'])), restart, container }),
    );

    expect(result).toMatchObject({
      ok: true,
      data: { service: 'svc-a', outcome: 'failed', detail: { code: 'restart-failed' } },
    });
    if (result.ok) {
      expect(result.data.detail?.message).toContain('/repo/a');
      expect(result.data.detail?.message).toContain('npm ci');
      expect(result.data.detail?.message).toContain('compose up blew up');
    }
    expect(calls(restart.run).filter(([path]) => path === '/repo/a')).toEqual([['/repo/a', 'npm ci']]);
    expect(calls(container.restart)).toHaveLength(0);
  });

  it('with no declared recipe falls back to the plain container restart without error', async () => {
    const manifest = fakeManifest({ ...manifestFor('svc-a'), restartCommands: undefined });
    const restart = fakeRestart();
    const container = fakeContainer();

    const result = await serviceRestart(makeParams({ manifest, restart, container }));

    expect(result).toMatchObject({ ok: true, data: { service: 'svc-a', outcome: 'updated' } });
    expect(calls(restart.run)).toHaveLength(0);
    expect(calls(container.restart)).toEqual([['ctr-svc-a']]);
  });

  it('with an empty recipe array falls back to the plain container restart', async () => {
    const restart = fakeRestart();
    const container = fakeContainer();

    const result = await serviceRestart(makeParams({ manifest: fakeManifest(manifestFor('svc-a', [])), restart, container }));

    expect(result).toMatchObject({ ok: true, data: { service: 'svc-a', outcome: 'updated' } });
    expect(calls(restart.run)).toHaveLength(0);
    expect(calls(container.restart)).toHaveLength(1);
  });

  it('a container fallback failure reports the container code with repo, container, and output', async () => {
    const container = fakeContainer({
      restart: vi.fn(async () => err('container-restart-error', 'daemon down')),
    });

    const result = await serviceRestart(
      makeParams({ manifest: fakeManifest({ ...manifestFor('svc-a'), restartCommands: undefined }), container }),
    );

    expect(result).toMatchObject({
      ok: true,
      data: { service: 'svc-a', outcome: 'failed', detail: { code: 'container-restart-error' } },
    });
    if (result.ok) {
      expect(result.data.detail?.message).toContain('/repo/a');
      expect(result.data.detail?.message).toContain('ctr-svc-a');
      expect(result.data.detail?.message).toContain('daemon down');
    }
  });

  it('normalizes a non-restart-failed adapter code to the restart-failed row detail', async () => {
    const restart = fakeRestart({
      run: vi.fn(async () => err('sh-spawn-error', 'ENOENT')),
    });

    const result = await serviceRestart(makeParams({ restart }));

    expect(result).toMatchObject({
      ok: true,
      data: { service: 'svc-a', outcome: 'failed', detail: { code: 'restart-failed' } },
    });
    if (result.ok) {
      expect(result.data.detail?.message).toContain('ENOENT');
    }
  });

  it('only that service restarts — no other repo is touched', async () => {
    const restart = fakeRestart();
    const container = fakeContainer();

    const result = await serviceRestart(makeParams({ restart, container, repoPath: '/repo/a' }));

    expect(result).toMatchObject({ ok: true, data: { service: 'svc-a', outcome: 'updated' } });
    for (const [repoPath] of calls(restart.run)) {
      expect(repoPath).toBe('/repo/a');
    }
    expect(calls(container.restart)).toHaveLength(0);
  });

  it('a manifest load failure lands as a failed row qualified with the full path, never a throw', async () => {
    const manifest = fakeManifest(null, 'manifest-invalid');

    const result = await serviceRestart(makeParams({ manifest, repoPath: '/repo/a' }));

    expect(result).toMatchObject({
      ok: true,
      data: { service: 'a (/repo/a)', outcome: 'failed', detail: { code: 'manifest-invalid' } },
    });
  });

  it('a blank repoPath is rejected invalid-argument before anything starts', async () => {
    const manifest = fakeManifest(null);
    const container = fakeContainer();
    const restart = fakeRestart();
    const lock = fakeLock();

    const result = await serviceRestart(makeParams({ manifest, container, restart, lock, repoPath: '   ' }));

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    expect(calls(lock.acquire)).toHaveLength(0);
    expect(calls(restart.run)).toHaveLength(0);
    expect(calls(container.restart)).toHaveLength(0);
  });

  it('lock contention on the same service maps to update-already-running and starts nothing', async () => {
    const lock: LockPort = {
      acquire: vi.fn(async () => err('action-in-progress', 'held')),
      peek: vi.fn(async () => ok({ locked: true })),
    };
    const restart = fakeRestart();
    const container = fakeContainer();

    const result = await serviceRestart(makeParams({ lock, restart, container }));

    expect(result).toMatchObject({ ok: false, error: { code: 'update-already-running' } });
    expect(calls(restart.run)).toHaveLength(0);
    expect(calls(container.restart)).toHaveLength(0);
  });

  it('the per-service key is the resolved repoPath — trailing-slash variants serialize together', async () => {
    expect(serviceRestartLockKey('/repo/a/')).toBe(serviceRestartLockKey('/repo/a'));
    expect(serviceRestartLockKey('/repo/a')).toBe('service:/repo/a');
  });

  it('emits the restarting phase once through the shared channel (story 3.10)', async () => {
    const seen: Array<[string, UpdatePhase]> = [];
    const onPhase = vi.fn((service: string, phase: UpdatePhase) => {
      seen.push([service, phase]);
    });

    const result = await serviceRestart(makeParams({ onPhase }));

    expect(result).toMatchObject({ ok: true, data: { service: 'svc-a', outcome: 'updated' } });
    expect(seen).toEqual([['svc-a', 'restarting']]);
  });

  it('emits restarting once for the plain fallback too', async () => {
    const seen: Array<[string, UpdatePhase]> = [];
    const onPhase = vi.fn((service: string, phase: UpdatePhase) => {
      seen.push([service, phase]);
    });
    const manifest = fakeManifest({ ...manifestFor('svc-a'), restartCommands: undefined });

    const result = await serviceRestart(makeParams({ manifest, onPhase }));

    expect(result).toMatchObject({ ok: true, data: { service: 'svc-a', outcome: 'updated' } });
    expect(seen).toEqual([['svc-a', 'restarting']]);
  });

  it('a throwing observer never breaks the standalone restart', async () => {
    const onPhase = vi.fn(() => {
      throw new Error('driving-side bug');
    });

    const result = await serviceRestart(makeParams({ onPhase }));

    expect(result).toMatchObject({ ok: true, data: { service: 'svc-a', outcome: 'updated' } });
  });
});
