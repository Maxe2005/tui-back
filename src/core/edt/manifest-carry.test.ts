// core/edt/manifest-carry: the capture → clear → run → restore ordering and its failure paths.
import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '../result.js';
import type { GitPort } from '../ports/git.js';
import type { ManifestCarryPort } from '../ports/manifest-carry.js';
import { MANIFEST_FILE, withCarriedManifest } from './manifest-carry.js';
import type { SwitchEdtRepoResult } from './switch.js';

const SNAPSHOT = { kind: 'present', content: new Uint8Array([1, 2]) } as const;

function setup(opts: { dirty?: string[]; git?: Partial<GitPort>; carry?: Partial<ManifestCarryPort> } = {}) {
  const order: string[] = [];
  const git = {
    listDirtyPaths: vi.fn(async () => ok(opts.dirty ?? [MANIFEST_FILE])),
    discardPathsToHead: vi.fn(async () => {
      order.push('clear');
      return ok(undefined);
    }),
    ...opts.git,
  } as unknown as GitPort;
  const carry: ManifestCarryPort = {
    capture: vi.fn(async () => {
      order.push('capture');
      return ok(SNAPSHOT);
    }),
    restore: vi.fn(async () => {
      order.push('restore');
      return ok(undefined);
    }),
    ...opts.carry,
  };
  return { git, carry, order };
}

const row = (): SwitchEdtRepoResult => ({ service: 'svc', outcome: 'switched' });

describe('withCarriedManifest', () => {
  it('captures, clears, runs, then restores — in that order', async () => {
    const { git, carry, order } = setup();
    const run = vi.fn(async () => {
      order.push('run');
      return row();
    });

    const result = await withCarriedManifest({ git, carry }, '/r', 'svc', run);

    expect(result).toEqual(row());
    expect(order).toEqual(['capture', 'clear', 'run', 'restore']);
    expect(git.discardPathsToHead).toHaveBeenCalledWith('/r', [MANIFEST_FILE]);
    expect(carry.restore).toHaveBeenCalledWith('/r', SNAPSHOT);
  });

  it('runs untouched when the manifest is not dirty', async () => {
    const { git, carry } = setup({ dirty: ['other.ts'] });

    const result = await withCarriedManifest({ git, carry }, '/r', 'svc', async () => row());

    expect(result).toEqual(row());
    expect(carry.capture).not.toHaveBeenCalled();
    expect(git.discardPathsToHead).not.toHaveBeenCalled();
  });

  it('still restores when the run failed, and keeps its failure row', async () => {
    const { git, carry } = setup();
    const failedRow: SwitchEdtRepoResult = { service: 'svc', outcome: 'failed', detail: { code: 'git-checkout-error', message: 'boom' } };

    const result = await withCarriedManifest({ git, carry }, '/r', 'svc', async () => failedRow);

    expect(result).toEqual(failedRow);
    expect(carry.restore).toHaveBeenCalledTimes(1);
  });

  it('reports a failed restore on a successful row, naming the error', async () => {
    const { git, carry } = setup({ carry: { restore: vi.fn(async () => err('manifest-carry-restore-error', 'kept in /r/.git/copy')) } });

    const result = await withCarriedManifest({ git, carry }, '/r', 'svc', async () => row());

    expect(result).toMatchObject({ outcome: 'failed', detail: { code: 'manifest-carry-restore-error' } });
    expect(result.detail?.message).toContain('/r/.git/copy');
  });

  it('fails the row without touching the repo when the capture fails', async () => {
    const { git, carry } = setup({ carry: { capture: vi.fn(async () => err('manifest-carry-read-error', 'nope')) } });
    const run = vi.fn(async () => row());

    const result = await withCarriedManifest({ git, carry }, '/r', 'svc', run);

    expect(result).toMatchObject({ outcome: 'failed', detail: { code: 'manifest-carry-read-error' } });
    expect(run).not.toHaveBeenCalled();
    expect(git.discardPathsToHead).not.toHaveBeenCalled();
  });

  it('restores the manifest and skips the run when the clear fails', async () => {
    const { git, carry } = setup({ git: { discardPathsToHead: vi.fn(async () => err('git-discard-error', 'denied')) } });
    const run = vi.fn(async () => row());

    const result = await withCarriedManifest({ git, carry }, '/r', 'svc', run);

    expect(result).toMatchObject({ outcome: 'failed', detail: { code: 'git-discard-error' } });
    expect(run).not.toHaveBeenCalled();
    expect(carry.restore).toHaveBeenCalledTimes(1);
  });

  it('fails the row, touching nothing, when the dirtiness cannot be read', async () => {
    const { git, carry } = setup({ git: { listDirtyPaths: vi.fn(async () => err('git-status-error', 'no repo')) } });
    const run = vi.fn(async () => row());

    const result = await withCarriedManifest({ git, carry }, '/r', 'svc', run);

    expect(result).toMatchObject({ outcome: 'failed', detail: { code: 'git-status-error' } });
    expect(run).not.toHaveBeenCalled();
    expect(carry.capture).not.toHaveBeenCalled();
  });

  it('restores the manifest then rethrows when the run throws', async () => {
    const { git, carry } = setup();

    await expect(
      withCarriedManifest({ git, carry }, '/r', 'svc', async () => {
        throw new Error('kaboom');
      }),
    ).rejects.toThrow('kaboom');
    expect(carry.restore).toHaveBeenCalledWith('/r', SNAPSHOT);
  });
});
