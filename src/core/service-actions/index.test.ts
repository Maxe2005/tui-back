import { describe, expect, it, vi } from 'vitest';
import type { Manifest } from '../ports/manifest.js';
import { err, ok } from '../result.js';
import { createServiceActions, NO_CLEAN_RECIPE_NOTICE, restartBlockingLocks } from './index.js';

function setup(manifest: Partial<Manifest> | 'broken', opts: { locked?: boolean; acquire?: 'busy' } = {}) {
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
  const actions = createServiceActions({ manifest: { load }, container, restart, editor, lock });
  return { actions, container, restart, editor, lock };
}

describe('service actions list', () => {
  it('lists open-in-IDE, simple and clean restart, all available for a container service', async () => {
    const { actions } = setup({ container: 'api', restartCommands: ['make'] });
    const listed = await actions.list('/repo/a');
    expect(listed.ok && listed.data.map((a) => [a.id, a.key, a.availability.available])).toEqual([
      ['open-in-ide', 'Ctrl+O', true],
      ['restart-simple', 'Ctrl+R', true],
      ['restart-clean', 'Ctrl+L', true],
    ]);
  });

  it('marks restarts unavailable with "no container" for a container-less service, never a failure', async () => {
    const { actions } = setup({});
    const listed = await actions.list('/repo/a');
    expect(listed.ok && listed.data.map((a) => a.availability)).toEqual([
      { available: true },
      { available: false, reason: 'no container' },
      { available: false, reason: 'no container' },
    ]);
  });

  it('marks restarts unavailable while the restart lock is held', async () => {
    const { actions } = setup({ container: 'api' }, { locked: true });
    const listed = await actions.list('/repo/a');
    expect(listed.ok && listed.data[1]?.availability).toEqual({ available: false, reason: 'restart in progress' });
  });

  it('marks only the clean restart unavailable when no recipe is declared', async () => {
    const { actions } = setup({ container: 'api' });
    const listed = await actions.list('/repo/a');
    expect(listed.ok && listed.data.map((a) => a.availability)).toEqual([
      { available: true },
      { available: true },
      { available: false, reason: 'no clean recipe' },
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

  it('keeps open-in-IDE available when the manifest cannot be read', async () => {
    const { actions } = setup('broken');
    const listed = await actions.list('/repo/a');
    expect(listed.ok && listed.data.map((a) => a.availability.available)).toEqual([true, false, false]);
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
  function verifySetup(manifest: Partial<Manifest>, healthSeq: ('up' | 'down' | 'restarting' | 'unavailable')[], probeSeq: { healthy: boolean; reason?: string }[] = []) {
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
      healthProbe,
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

  it('rejects a blank repoPath', async () => {
    const result = await verifySetup({ container: 'api' }, ['up']).actions.verifyService('  ');
    expect(!result.ok && result.error.code).toBe('invalid-argument');
  });
});
