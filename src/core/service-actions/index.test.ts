import { describe, expect, it, vi } from 'vitest';
import type { HealthState } from '../ports/docker.js';
import type { Manifest } from '../ports/manifest.js';
import { err, ok } from '../result.js';
import { createServiceActions, NO_CLEAN_RECIPE_NOTICE, restartBlockingLocks, TERMINAL_HEALTH_TIMEOUT_MS } from './index.js';

// `health` wires a docker fake whose container health is that state (`unavailable` = probe error);
// omitted, no docker port is wired at all.
function setup(
  manifest: Partial<Manifest> | 'broken',
  opts: { locked?: boolean; acquire?: 'busy'; health?: HealthState | 'unavailable' } = {},
) {
  const container = { restart: vi.fn(async () => ok(undefined)) };
  const restart = { run: vi.fn(async (_repoPath: string, _command: string) => ok({ output: '' })) };
  const editor = { launch: vi.fn(() => ok(undefined)) };
  const release = vi.fn(async () => ok(undefined));
  const lock = {
    acquire: vi.fn(async () => (opts.acquire === 'busy' ? err('action-in-progress', 'busy') : ok({ release }))),
    peek: vi.fn(async (_key: string) => ok({ locked: opts.locked === true })),
  };
  const load = vi.fn(async () =>
    manifest === 'broken'
      ? err('manifest-invalid', 'bad')
      : ok({ service: 'api', sharedBranch: 'development', modules: {}, ...manifest } as Manifest),
  );
  const health = opts.health;
  const docker =
    health === undefined
      ? undefined
      : {
          getContainerHealth: vi.fn(async (_container: string) =>
            health === 'unavailable' ? err('docker-unavailable', 'no docker') : ok(health),
          ),
        };
  const actions = createServiceActions({ manifest: { load }, container, restart, editor, lock, docker: docker as never });
  return { actions, container, restart, editor, lock, load, docker };
}

describe('service actions list', () => {
  it('lists open-in-IDE, simple and clean restart, then both terminals, all available for a running container service', async () => {
    const { actions, docker, load } = setup({ container: 'api', restartCommands: ['make'] }, { health: 'up' });
    const listed = await actions.list('/repo/a');
    expect(listed.ok && listed.data.map((a) => [a.id, a.label, a.key, a.availability.available])).toEqual([
      ['open-in-ide', 'Open in IDE', 'Ctrl+O', true],
      ['restart-simple', 'Restart', 'Ctrl+R', true],
      ['restart-clean', 'Clean restart', 'Ctrl+L', true],
      ['terminal-service', 'Terminal', 'Ctrl+T', true],
      ['terminal-container', 'Container terminal', 'Ctrl+X', true],
    ]);
    expect(docker?.getContainerHealth).toHaveBeenCalledWith('api');
    // The manifest is read once per list, whatever the number of rules derived from it.
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('marks restarts and the container terminal unavailable with "no container" for a container-less service, never a failure', async () => {
    const { actions, docker } = setup({}, { health: 'up' });
    const listed = await actions.list('/repo/a');
    expect(listed.ok && listed.data.map((a) => a.availability)).toEqual([
      { available: true },
      { available: false, reason: 'no container' },
      { available: false, reason: 'no container' },
      { available: true },
      { available: false, reason: 'no container' },
    ]);
    expect(docker?.getContainerHealth).not.toHaveBeenCalled();
  });

  it('treats a blank container name as no container, without querying health', async () => {
    const { actions, docker } = setup({ container: '  ' }, { health: 'up' });
    const listed = await actions.list('/repo/a');
    expect(listed.ok && listed.data[4]?.availability).toEqual({ available: false, reason: 'no container' });
    expect(docker?.getContainerHealth).not.toHaveBeenCalled();
  });

  it.each(['down', 'restarting'] as const)('marks the container terminal "container not running" when health is %s', async (health) => {
    const { actions } = setup({ container: 'api' }, { health });
    const listed = await actions.list('/repo/a');
    expect(listed.ok && listed.data.map((a) => [a.id, a.availability])).toEqual(
      expect.arrayContaining([
        ['terminal-service', { available: true }],
        ['terminal-container', { available: false, reason: 'container not running' }],
      ]),
    );
  });

  it('reads "container state unknown" when Docker cannot be reached, never a list failure', async () => {
    const { actions } = setup({ container: 'api' }, { health: 'unavailable' });
    const listed = await actions.list('/repo/a');
    expect(listed.ok).toBe(true);
    expect(listed.ok && listed.data[4]?.availability).toEqual({ available: false, reason: 'container state unknown' });
  });

  it('reads "container state unknown" when the health probe rejects', async () => {
    const { actions, docker } = setup({ container: 'api' }, { health: 'up' });
    docker?.getContainerHealth.mockRejectedValueOnce(new Error('boom'));
    const listed = await actions.list('/repo/a');
    expect(listed.ok && listed.data[4]?.availability).toEqual({ available: false, reason: 'container state unknown' });
  });

  it('reads "container state unknown" when no Docker port is wired', async () => {
    const { actions } = setup({ container: 'api' });
    const listed = await actions.list('/repo/a');
    expect(listed.ok && listed.data[4]?.availability).toEqual({ available: false, reason: 'container state unknown' });
  });

  it('reads "container state unknown" when the health probe hangs past the timeout, without stalling the list', async () => {
    const getContainerHealth = vi.fn(() => new Promise<never>(() => {}));
    const sleep = vi.fn(async (_ms: number) => {});
    const actions = createServiceActions({
      manifest: { load: async () => ok({ service: 'api', sharedBranch: 'development', modules: {}, container: 'api' } as Manifest) },
      container: { restart: async () => ok(undefined) },
      restart: { run: async () => ok({ output: '' }) },
      editor: { launch: () => ok(undefined) },
      lock: { acquire: async () => err('action-in-progress', 'busy'), peek: async () => ok({ locked: false }) },
      docker: { getContainerHealth } as never,
      clock: { now: () => 0, sleep },
    });
    const listed = await actions.list('/repo/a');
    expect(sleep).toHaveBeenCalledWith(TERMINAL_HEALTH_TIMEOUT_MS);
    expect(listed.ok && listed.data.map((a) => a.availability)).toEqual([
      { available: true },
      { available: true },
      { available: false, reason: 'no clean recipe' },
      { available: true },
      { available: false, reason: 'container state unknown' },
    ]);
  });

  it('reads "no container" rather than "container state unknown" for a container-less service with no Docker port', async () => {
    const { actions } = setup({});
    const listed = await actions.list('/repo/a');
    expect(listed.ok && listed.data[4]?.availability).toEqual({ available: false, reason: 'no container' });
  });

  it('leaves both terminals unaffected by held restart and group-update locks', async () => {
    const { actions, lock } = setup({ container: 'api', restartCommands: ['x'] }, { health: 'up', locked: true });
    lock.peek.mockImplementation(async () => ok({ locked: true }));
    const listed = await actions.list('/repo/a', { blockingLocks: restartBlockingLocks('01ABC') });
    expect(listed.ok && listed.data.map((a) => a.availability.available)).toEqual([true, false, false, true, true]);
  });

  it('marks restarts unavailable while the restart lock is held', async () => {
    const { actions } = setup({ container: 'api' }, { locked: true });
    const listed = await actions.list('/repo/a');
    expect(listed.ok && listed.data[1]?.availability).toEqual({ available: false, reason: 'restart in progress' });
  });

  it('marks only the clean restart unavailable when no recipe is declared', async () => {
    const { actions } = setup({ container: 'api' }, { health: 'up' });
    const listed = await actions.list('/repo/a');
    expect(listed.ok && listed.data.map((a) => a.availability)).toEqual([
      { available: true },
      { available: true },
      { available: false, reason: 'no clean recipe' },
      { available: true },
      { available: true },
    ]);
  });

  it('counts a recipe of blank commands as no clean recipe', async () => {
    const { actions, restart } = setup({ container: 'api', restartCommands: ['', '  '] });
    const listed = await actions.list('/repo/a');
    expect(listed.ok && listed.data[2]?.availability).toEqual({ available: false, reason: 'no clean recipe' });
    expect(await actions.restart('/repo/a', 'clean')).toEqual(ok({ notice: NO_CLEAN_RECIPE_NOTICE }));
    expect(restart.run).not.toHaveBeenCalled();
  });

  it('names the held blocking lock as the reason', async () => {
    const { actions, lock } = setup({ container: 'api', restartCommands: ['x'] });
    lock.peek.mockImplementation(async (key: string) => ok({ locked: key === 'group-update' }));
    const listed = await actions.list('/repo/a', { blockingLocks: restartBlockingLocks('01ABC') });
    expect(listed.ok && listed.data[1]?.availability).toEqual({ available: false, reason: 'group update' });
    expect(listed.ok && listed.data[0]?.availability).toEqual({ available: true });
  });

  it('keeps open-in-IDE and the service terminal available when the manifest cannot be read', async () => {
    const { actions, docker } = setup('broken', { health: 'up' });
    const listed = await actions.list('/repo/a');
    expect(listed.ok && listed.data.map((a) => a.availability)).toEqual([
      { available: true },
      { available: false, reason: 'manifest unreadable' },
      { available: false, reason: 'manifest unreadable' },
      { available: true },
      { available: false, reason: 'manifest unreadable' },
    ]);
    expect(docker?.getContainerHealth).not.toHaveBeenCalled();
  });
});

describe('service actions restart progress', () => {
  it('reports each recipe step of a clean restart, and 1/1 for a simple one', async () => {
    const { actions } = setup({ container: 'api', restartCommands: ['a', 'b', 'c'] });
    const steps: Array<[number, number]> = [];
    await actions.restart('/repo/a', 'clean', (p) => steps.push([p.step, p.total]));
    expect(steps).toEqual([[1, 3], [2, 3], [3, 3]]);
    const simple: Array<[number, number]> = [];
    await actions.restart('/repo/a', 'simple', (p) => simple.push([p.step, p.total]));
    expect(simple).toEqual([[1, 1]]);
  });
});

describe('service actions restart', () => {
  it('simple restarts the container', async () => {
    const { actions, container } = setup({ container: 'api' });
    expect(await actions.restart('/repo/a', 'simple')).toEqual(ok({}));
    expect(container.restart).toHaveBeenCalledWith('api');
  });

  it('propagates a simple restart adapter error', async () => {
    const { actions, container } = setup({ container: 'api' });
    container.restart.mockResolvedValueOnce(err('container-restart-error', 'boom') as never);
    expect(await actions.restart('/repo/a', 'simple')).toEqual(err('container-restart-error', 'boom'));
  });

  it('clean runs the recipe in order', async () => {
    const { actions, restart, container } = setup({ container: 'api', restartCommands: ['a', 'b'] });
    expect(await actions.restart('/repo/a', 'clean')).toEqual(ok({}));
    expect(restart.run.mock.calls.map((c) => c[1])).toEqual(['a', 'b']);
    expect(container.restart).not.toHaveBeenCalled();
  });

  it('clean stops at the first failing recipe command with restart-failed', async () => {
    const { actions, restart } = setup({ container: 'api', restartCommands: ['a', 'b'] });
    restart.run.mockResolvedValueOnce(err('restart-failed', 'x') as never);
    const result = await actions.restart('/repo/a', 'clean');
    expect(!result.ok && result.error.code).toBe('restart-failed');
    expect(restart.run).toHaveBeenCalledTimes(1);
  });

  it('clean without a recipe restarts simply and says so', async () => {
    const { actions, container } = setup({ container: 'api' });
    expect(await actions.restart('/repo/a', 'clean')).toEqual(ok({ notice: NO_CLEAN_RECIPE_NOTICE }));
    expect(container.restart).toHaveBeenCalledWith('api');
  });

  it('a container-less service answers no-container', async () => {
    const { actions } = setup({ restartCommands: ['a'] });
    for (const mode of ['simple', 'clean'] as const) {
      const result = await actions.restart('/repo/a', mode);
      expect(!result.ok && result.error.code).toBe('no-container');
    }
  });

  it('answers update-already-running when the lock is held', async () => {
    const { actions, container } = setup({ container: 'api' }, { acquire: 'busy' });
    const result = await actions.restart('/repo/a', 'simple');
    expect(!result.ok && result.error.code).toBe('update-already-running');
    expect(container.restart).not.toHaveBeenCalled();
  });
});

describe('service actions restart validation', () => {
  it('rejects a blank repoPath and an unknown mode without touching any port', async () => {
    const { actions, container, lock } = setup({ container: 'api' });
    const blank = await actions.restart(' ', 'simple');
    const unknown = await actions.restart('/repo/a', 'bogus' as never);
    expect(!blank.ok && blank.error.code).toBe('invalid-argument');
    expect(!unknown.ok && unknown.error.code).toBe('invalid-argument');
    expect(container.restart).not.toHaveBeenCalled();
    expect(lock.acquire).not.toHaveBeenCalled();
  });
});

describe('service actions openInIde', () => {
  it('rejects a blank repoPath without launching', () => {
    const { actions, editor } = setup({});
    const result = actions.openInIde('  ', { editorCommand: '' });
    expect(!result.ok && result.error.code).toBe('invalid-argument');
    expect(editor.launch).not.toHaveBeenCalled();
  });

  it('delegates to the editor port with the configured command', () => {
    const { actions, editor } = setup({});
    expect(actions.openInIde('/repo/a', { editorCommand: 'code <repo>' })).toEqual(ok(undefined));
    expect(editor.launch).toHaveBeenCalledWith('/repo/a', 'code <repo>');
  });

  it('propagates editor-launch-failed', () => {
    const { actions, editor } = setup({});
    editor.launch.mockReturnValueOnce(err('editor-launch-failed', 'Could not launch "x": nope') as never);
    const result = actions.openInIde('/repo/a', { editorCommand: '' });
    expect(!result.ok && result.error.code).toBe('editor-launch-failed');
  });
});

describe('service actions verifyService', () => {
  function verifySetup(
    manifest: Partial<Manifest>,
    healthSeq: ('up' | 'down' | 'restarting' | 'unavailable')[],
    probeSeq: { healthy: boolean; reason?: string }[] = [],
    extra: { isHealthCheckEnabled?: (m: Manifest) => boolean; noProbe?: boolean } = {},
  ) {
    let t = 0;
    const clock = { now: () => t, sleep: vi.fn(async (ms: number) => { t += ms; }) };
    let h = 0;
    const docker = {
      getContainerHealth: vi.fn(async () => {
        const next = healthSeq[Math.min(h++, healthSeq.length - 1)];
        return next === 'unavailable' ? err('docker-unavailable', 'no docker') : ok(next);
      }),
    };
    let p = 0;
    const healthProbe = { probe: vi.fn(async () => ok(probeSeq[Math.min(p++, probeSeq.length - 1)] ?? { healthy: false })) };
    const base = setup(manifest);
    const actions = createServiceActions({
      manifest: { load: async () => ok({ service: 'api', sharedBranch: 'development', modules: {}, ...manifest } as Manifest) },
      container: { restart: vi.fn() } as never,
      restart: base.restart,
      editor: base.editor,
      lock: base.lock,
      docker: docker as never,
      ...(extra.noProbe === true ? {} : { healthProbe }),
      ...(extra.isHealthCheckEnabled === undefined ? {} : { isHealthCheckEnabled: extra.isHealthCheckEnabled }),
      clock,
    });
    return { actions, docker, healthProbe, clock };
  }

  it('is functional when the container is up and healthUrl answers 2xx', async () => {
    const { actions, healthProbe } = verifySetup({ container: 'api', healthUrl: 'http://x/h' }, ['up'], [{ healthy: true }]);
    expect(await actions.verifyService('/r')).toEqual({ ok: true, data: { state: 'functional' } });
    expect(healthProbe.probe).toHaveBeenCalledWith('http://x/h', expect.any(Number));
  });

  it('keeps polling until healthUrl answers', async () => {
    const { actions, clock } = verifySetup({ container: 'api', healthUrl: 'http://x/h' }, ['up'], [{ healthy: false }, { healthy: false }, { healthy: true }]);
    expect(await actions.verifyService('/r')).toEqual({ ok: true, data: { state: 'functional' } });
    expect(clock.sleep).toHaveBeenCalledTimes(2);
  });

  it('is up-unverified when up without a healthUrl, with no probe', async () => {
    const { actions, healthProbe } = verifySetup({ container: 'api' }, ['up']);
    expect(await actions.verifyService('/r')).toEqual({ ok: true, data: { state: 'up-unverified' } });
    expect(healthProbe.probe).not.toHaveBeenCalled();
  });

  it('is unhealthy when healthUrl never answers 2xx before the timeout', async () => {
    const { actions, clock } = verifySetup({ container: 'api', healthUrl: 'http://x/h' }, ['up'], [{ healthy: false, reason: 'HTTP 503' }]);
    expect(await actions.verifyService('/r')).toEqual({ ok: true, data: { state: 'unhealthy', detail: 'HTTP 503' } });
    expect(clock.now()).toBeLessThanOrEqual(30_000);
  });

  it('is restarting when still restarting at the timeout', async () => {
    const { actions } = verifySetup({ container: 'api' }, ['restarting']);
    const result = await actions.verifyService('/r');
    expect(result.ok && result.data.state).toBe('restarting');
  });

  it('settles on down immediately', async () => {
    const { actions, clock } = verifySetup({ container: 'api' }, ['restarting', 'down']);
    const result = await actions.verifyService('/r');
    expect(result.ok && result.data.state).toBe('down');
    expect(clock.sleep).toHaveBeenCalledTimes(1);
  });

  it('errors when docker never answers, and for a container-less service', async () => {
    const unavailable = await verifySetup({ container: 'api' }, ['unavailable']).actions.verifyService('/r');
    expect(!unavailable.ok && unavailable.error.code).toBe('docker-unavailable');
    const none = await verifySetup({}, ['up']).actions.verifyService('/r');
    expect(!none.ok && none.error.code).toBe('no-container');
  });

  it('keeps polling an inconsistent service and reports the container state at the timeout', async () => {
    const { actions, clock } = verifySetup({ container: 'api', healthUrl: 'http://x/h' }, ['restarting'], [{ healthy: true }]);
    expect(await actions.verifyService('/r')).toEqual({
      ok: true,
      data: { state: 'restarting', detail: 'health route answers but container is restarting' },
    });
    expect(clock.sleep.mock.calls.length).toBeGreaterThan(1);
  });

  it('is functional when the route answers even though Docker errors (AD-23)', async () => {
    const { actions } = verifySetup({ container: 'api', healthUrl: 'http://x/h' }, ['unavailable'], [{ healthy: true }]);
    expect(await actions.verifyService('/r')).toEqual({ ok: true, data: { state: 'functional' } });
  });

  it('keeps polling while the route answers but the container is down, then reports the container', async () => {
    const { actions, clock } = verifySetup({ container: 'api', healthUrl: 'http://x/h' }, ['down'], [{ healthy: true }]);
    expect(await actions.verifyService('/r')).toEqual({
      ok: true,
      data: { state: 'down', detail: 'health route answers but container is down' },
    });
    expect(clock.sleep.mock.calls.length).toBeGreaterThan(1);
  });

  it('settles on down with the container detail, not the probe reason', async () => {
    const { actions, clock } = verifySetup({ container: 'api', healthUrl: 'http://x/h' }, ['down'], [{ healthy: false, reason: 'HTTP 503' }]);
    expect(await actions.verifyService('/r')).toEqual({ ok: true, data: { state: 'down', detail: 'container is not running' } });
    expect(clock.sleep).not.toHaveBeenCalled();
  });

  it('reports the Docker error when Docker errors and the probe fails until the timeout', async () => {
    const { actions } = verifySetup({ container: 'api', healthUrl: 'http://x/h' }, ['unavailable'], [{ healthy: false, reason: 'HTTP 503' }]);
    const result = await actions.verifyService('/r');
    expect(!result.ok && result.error.code).toBe('docker-unavailable');
    expect(!result.ok && result.error.details).toEqual({ probeReason: 'HTTP 503' });
  });

  it('reports the latest observation at the timeout, not an earlier restarting read', async () => {
    const { actions } = verifySetup({ container: 'api' }, ['restarting', 'restarting', 'unavailable']);
    const result = await actions.verifyService('/r');
    expect(!result.ok && result.error.code).toBe('docker-unavailable');
  });

  it('never probes a service whose health check is disabled: a started container is up-unverified (story 9.11)', async () => {
    const off = { isHealthCheckEnabled: (m: Manifest) => m.service !== 'api' };
    const { actions, healthProbe } = verifySetup({ container: 'api', healthUrl: 'http://x/h' }, ['up'], [{ healthy: false, reason: 'HTTP 503' }], off);
    expect(await actions.verifyService('/r')).toEqual({ ok: true, data: { state: 'up-unverified' } });
    expect(healthProbe.probe).not.toHaveBeenCalled();
  });

  it('a disabled health check needs no wired probe: no verification-unavailable (story 9.11)', async () => {
    const off = { isHealthCheckEnabled: () => false, noProbe: true };
    const { actions } = verifySetup({ container: 'api', healthUrl: 'http://x/h' }, ['up'], [], off);
    expect(await actions.verifyService('/r')).toEqual({ ok: true, data: { state: 'up-unverified' } });
    const enabledNoProbe = verifySetup({ container: 'api', healthUrl: 'http://x/h' }, ['up'], [], { noProbe: true });
    const result = await enabledNoProbe.actions.verifyService('/r');
    expect(!result.ok && result.error.code).toBe('verification-unavailable');
  });

  it('rejects a blank repoPath', async () => {
    const result = await verifySetup({ container: 'api' }, ['up']).actions.verifyService('  ');
    expect(!result.ok && result.error.code).toBe('invalid-argument');
  });
});
