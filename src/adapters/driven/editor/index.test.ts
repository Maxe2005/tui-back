import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createEditorPort } from './index.js';

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return { ...original, spawnSync: vi.fn(() => ({ status: 0 })) };
});

const launch = (repoPath: string, configured = '') => createEditorPort().launch(repoPath, configured);

describe('createEditorPort.launch', () => {
  const originalEditor = process.env.EDITOR;

  afterEach(() => {
    if (originalEditor === undefined) {
      delete process.env.EDITOR;
    } else {
      process.env.EDITOR = originalEditor;
    }
    vi.mocked(spawnSync).mockClear();
  });

  it('splits $EDITOR flags: first token is the binary, repo path appended last', () => {
    process.env.EDITOR = 'code --wait';

    launch('/repo/a');

    expect(vi.mocked(spawnSync)).toHaveBeenCalledWith('code', ['--wait', '/repo/a'], { stdio: 'inherit' });
  });

  it('passes a bare $EDITOR binary with only the repo path', () => {
    process.env.EDITOR = 'hx';

    launch('/repo/a');

    expect(vi.mocked(spawnSync)).toHaveBeenCalledWith('hx', ['/repo/a'], { stdio: 'inherit' });
  });

  it('falls back to vi when $EDITOR is unset or blank', () => {
    delete process.env.EDITOR;

    launch('/repo/a');

    expect(vi.mocked(spawnSync)).toHaveBeenCalledWith('vi', ['/repo/a'], { stdio: 'inherit' });

    process.env.EDITOR = '   ';
    vi.mocked(spawnSync).mockClear();

    launch('/repo/b');

    expect(vi.mocked(spawnSync)).toHaveBeenCalledWith('vi', ['/repo/b'], { stdio: 'inherit' });
  });

  it('the configured command wins over $EDITOR, with <repo> replaced by the blocked repo path', () => {
    process.env.EDITOR = 'hx';

    expect(launch('/repo/a', 'code <repo>')).toEqual({ ok: true, data: undefined });

    expect(vi.mocked(spawnSync)).toHaveBeenCalledWith('code', ['/repo/a'], { stdio: 'inherit' });
  });

  it('a blank configured command falls through to $EDITOR', () => {
    process.env.EDITOR = 'hx';

    launch('/repo/a', '   ');

    expect(vi.mocked(spawnSync)).toHaveBeenCalledWith('hx', ['/repo/a'], { stdio: 'inherit' });
  });

  it('reports a command that could not be started instead of failing silently', () => {
    vi.mocked(spawnSync).mockReturnValueOnce({ error: new Error('spawnSync nope ENOENT') } as ReturnType<typeof spawnSync>);

    expect(launch('/repo/a', 'nope <repo>')).toEqual({ ok: false, error: { code: 'editor-launch-failed', message: 'Could not launch "nope": spawnSync nope ENOENT' } });
  });

  it('turns a synchronous spawn throw into editor-launch-failed instead of throwing', () => {
    vi.mocked(spawnSync).mockImplementationOnce(() => {
      throw new Error('invalid argument');
    });

    expect(launch('/repo/a', 'nope <repo>')).toEqual({
      ok: false,
      error: { code: 'editor-launch-failed', message: 'Could not launch "nope": invalid argument' },
    });
  });
});
