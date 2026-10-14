import { describe, expect, it, vi } from 'vitest';
import type { Manifest } from '../ports/manifest.js';
import { err, ok } from '../result.js';
import { createServiceActions, NO_CLEAN_RECIPE_NOTICE } from './index.js';

function setup(manifest: Partial<Manifest> | 'broken', opts: { locked?: boolean; acquire?: 'busy' } = {}) {
  const container = { restart: vi.fn(async () => ok(undefined)) };
  const restart = { run: vi.fn(async (_repoPath: string, _command: string) => ok({ output: '' })) };
  const editor = { launch: vi.fn(() => ok(undefined)) };
  const release = vi.fn(async () => ok(undefined));
  const lock = {
    acquire: vi.fn(async () => (opts.acquire === 'busy' ? err('action-in-progress', 'busy') : ok({ release }))),
    peek: vi.fn(async () => ok({ locked: opts.locked === true })),
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
    const { actions } = setup({ container: 'api' });
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

  it('keeps open-in-IDE available when the manifest cannot be read', async () => {
    const { actions } = setup('broken');
    const listed = await actions.list('/repo/a');
    expect(listed.ok && listed.data.map((a) => a.availability.available)).toEqual([true, false, false]);
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

describe('service actions openInIde', () => {
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
