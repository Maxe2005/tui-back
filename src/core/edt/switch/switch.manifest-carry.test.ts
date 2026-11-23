// core/edt/switch: unit tests against fake ports — the dirty .tui-back.yaml carry-over.
import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '../../result.js';
import type { GitPort } from '../../ports/vcs/git.js';
import { switchActiveEdt } from './switch.js';
import { calls, fakeEdtRegistry } from '../../shared/core-ports.test-support.js';
import { fakeGit, callOrder, fakeManifestCarry, makeParams, OUTGOING, TARGET } from './switch.test-support.js';

describe('switchActiveEdt — dirty .tui-back.yaml is carried over', () => {
  // A git fake whose dirtiness reads honour `excludePaths`, like the real adapter.
  function gitWithDirty(dirty: Record<string, string[]>, overrides: Partial<GitPort> = {}): GitPort {
    const visible = (repoPath: string, excludePaths: string[] = []) =>
      (dirty[repoPath] ?? []).filter((path) => !excludePaths.includes(path));
    return fakeGit({
      hasUncommittedChanges: vi.fn(async (repoPath: string, opts?: { excludePaths?: string[] }) =>
        ok(visible(repoPath, opts?.excludePaths).length > 0),
      ),
      listDirtyPaths: vi.fn(async (repoPath: string, opts?: { excludePaths?: string[] }) =>
        ok(visible(repoPath, opts?.excludePaths)),
      ),
      // Clearing a path to HEAD makes it stop being dirty, as in a real tree.
      discardPathsToHead: vi.fn(async (repoPath: string, paths: string[]) => {
        dirty[repoPath] = (dirty[repoPath] ?? []).filter((path) => !paths.includes(path));
        return ok(undefined);
      }),
      ...overrides,
    });
  }

  it('asks nothing for a non-member repo dirty only through the manifest, and restores it after the checkout', async () => {
    const git = gitWithDirty({ '/repo/b': ['.tui-back.yaml'] });
    const manifestCarry = fakeManifestCarry();
    const onDirtyReposBeforeSwitch = vi.fn();

    const result = await switchActiveEdt(makeParams({ git, manifestCarry, onDirtyReposBeforeSwitch }));

    expect(result.ok).toBe(true);
    expect(onDirtyReposBeforeSwitch).not.toHaveBeenCalled();
    expect(calls(git.stashSave)).toHaveLength(0);
    expect(calls(git.discardAll)).toHaveLength(0);
    expect(calls(manifestCarry.capture)).toEqual([['/repo/b']]);
    const checkoutOrder = callOrder(git.checkout, (args) => args[0] === '/repo/b');
    expect(callOrder(manifestCarry.capture)).toBeLessThan(callOrder(git.discardPathsToHead));
    expect(callOrder(git.discardPathsToHead)).toBeLessThan(checkoutOrder);
    expect(checkoutOrder).toBeLessThan(callOrder(manifestCarry.restore));
  });

  it('stashes only the other work of a state-1 repo and restores its manifest after the checkout', async () => {
    const git = gitWithDirty({ '/repo/c': ['.tui-back.yaml', 'work.ts'] });
    const manifestCarry = fakeManifestCarry();

    const result = await switchActiveEdt(makeParams({ git, manifestCarry }));

    expect(result.ok).toBe(true);
    expect(calls(git.stashSave)).toEqual([['/repo/c', 'tui-back:outgoing-ulid']]);
    expect(callOrder(manifestCarry.capture)).toBeLessThan(callOrder(git.stashSave));
    expect(callOrder(git.checkout, (args) => args[0] === '/repo/c')).toBeLessThan(callOrder(manifestCarry.restore));
  });

  it('flags a repo with a dirty manifest in the seam row without listing it, and keeps it through a discard', async () => {
    const git = gitWithDirty({ '/repo/b': ['.tui-back.yaml', 'x.txt'] });
    const manifestCarry = fakeManifestCarry();
    const onDirtyReposBeforeSwitch = vi.fn(async () => ({ kind: 'proceed' as const, resolutions: { '/repo/b': { kind: 'discard' as const } } }));

    const result = await switchActiveEdt(makeParams({ git, manifestCarry, onDirtyReposBeforeSwitch }));

    const rows = calls(onDirtyReposBeforeSwitch)[0]![0] as Array<Record<string, unknown>>;
    expect(rows.find((row) => row.repoPath === '/repo/b')).toMatchObject({ manifestCarried: true, dirtyPaths: ['x.txt'] });
    expect(result.ok && result.data.results).toContainEqual(
      expect.objectContaining({ service: 'svc-b', outcome: 'discarded', detail: expect.objectContaining({ discardedPaths: ['x.txt'] }) }),
    );
    expect(callOrder(manifestCarry.capture)).toBeLessThan(callOrder(git.discardAll));
    expect(callOrder(git.discardAll)).toBeLessThan(callOrder(manifestCarry.restore));
  });

  it('adopts the other dirty work into the outgoing EDT while the manifest stays out of the stash', async () => {
    const git = gitWithDirty({ '/repo/b': ['.tui-back.yaml', 'x.txt'] });
    const manifestCarry = fakeManifestCarry();
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET, OUTGOING])) });
    const onDirtyReposBeforeSwitch = vi.fn(async () => ({ kind: 'proceed' as const, resolutions: { '/repo/b': { kind: 'adopt' as const, branch: 'feat/b-out' } } }));

    const result = await switchActiveEdt(makeParams({ git, manifestCarry, edtRegistry, onDirtyReposBeforeSwitch }));

    expect(result.ok && result.data.results).toContainEqual(expect.objectContaining({ service: 'svc-b', outcome: 'adopted' }));
    expect(callOrder(manifestCarry.capture)).toBeLessThan(callOrder(git.stashSave, (args) => args[0] === '/repo/b'));
    expect(callOrder(git.checkout, (args) => args[0] === '/repo/b')).toBeLessThan(callOrder(manifestCarry.restore));
    expect(calls(manifestCarry.restore)).toHaveLength(1);
  });

  it('rewrites the manifest and reports the checkout failure when the checkout fails', async () => {
    const git = gitWithDirty(
      { '/repo/b': ['.tui-back.yaml'] },
      { checkout: vi.fn(async (repoPath: string) => (repoPath === '/repo/b' ? err('git-checkout-error', 'refused') : ok(undefined))) },
    );
    const manifestCarry = fakeManifestCarry();

    const result = await switchActiveEdt(makeParams({ git, manifestCarry }));

    expect(result.ok && result.data.results).toContainEqual(
      expect.objectContaining({ service: 'svc-b', outcome: 'failed', detail: expect.objectContaining({ code: 'git-checkout-error' }) }),
    );
    expect(calls(manifestCarry.restore)).toEqual([['/repo/b', { kind: 'absent' }]]);
  });
});
