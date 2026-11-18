// core/edt/switch: unit tests against fake ports (remaining topics).
import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '../result.js';
import type { EdtRegistryPort } from '../ports/edt-registry.js';
import type { GitPort } from '../ports/git.js';
import { switchActiveEdt, type SwitchActiveEdtParams } from './switch.js';
import { calls, edtEntry, fakeEdtRegistry, fakeGit, fakeLock, fakeState, member } from '../shared/core-ports.test-support.js';
import { callOrder, expectZeroWrites, fakeManifestCarry, makeParams, OUTGOING, TARGET, WRITE_METHODS } from './switch.test-support.js';

describe('switchActiveEdt — adopt resolution', () => {
  function adoptSetup(gitOverrides: Partial<GitPort> = {}, registryOverrides: Partial<EdtRegistryPort> = {}) {
    const git = fakeGit({
      hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/b')),
      currentBranch: vi.fn(async () => ok('development')),
      ...gitOverrides,
    });
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET, OUTGOING])), ...registryOverrides });
    const lock = fakeLock();
    const params = makeParams({ git, edtRegistry, lock, dirtyResolutions: { '/repo/b': { kind: 'adopt', branch: 'feat/b' } } });
    return { git, edtRegistry, lock, params };
  }

  it('runs gate → stash <out> → createBranch from current → add to outgoing → checkout, outcome adopted', async () => {
    const { git, edtRegistry, lock, params } = adoptSetup();

    const result = await switchActiveEdt(params);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toContainEqual({
        service: 'svc-b',
        outcome: 'adopted',
        detail: { code: 'adopted', message: expect.stringContaining('feat/b'), adoptedBranch: 'feat/b' },
      });
    }
    const isB = (args: unknown[]) => args[0] === '/repo/b';
    expect(calls(git.assertAllowedBranch)).toContainEqual(['/repo/b', 'feat/b', 'outgoing-ulid']);
    expect(calls(git.stashSave)).toEqual([['/repo/b', 'tui-back:outgoing-ulid']]);
    expect(calls(git.createBranch)).toEqual([['/repo/b', 'feat/b', 'development']]);
    expect(calls(edtRegistry.update)).toEqual([
      ['outgoing-ulid', { topic: 'outgoing-topic', members: [...OUTGOING.members, member('svc-b', '/repo/b', 'feat/b')] }],
    ]);
    expect(calls(git.checkout)).toContainEqual(['/repo/b', 'development']);
    // The membership write happens under the edts.yaml lock (then the final status write), all
    // while the outgoing EDT's action lock is held.
    expect(calls(lock.acquire)).toEqual([['edt:outgoing-ulid'], ['/cfg/edts.yaml'], ['/cfg/edts.yaml']]);

    const gate = callOrder(git.assertAllowedBranch, (args) => args[1] === 'feat/b');
    const stash = callOrder(git.stashSave, isB);
    const create = callOrder(git.createBranch, isB);
    const update = callOrder(edtRegistry.update);
    const checkout = callOrder(git.checkout, isB);
    expect(gate).toBeLessThan(stash);
    expect(stash).toBeLessThan(create);
    expect(create).toBeLessThan(update);
    expect(update).toBeLessThan(checkout);
    // The adopted work stays stashed for the outgoing EDT's return — never popped here.
    expect(calls(git.restoreStash).filter(isB)).toHaveLength(0);
  });

  it('adopting the current branch itself creates no branch', async () => {
    const { git, params } = adoptSetup({ currentBranch: vi.fn(async () => ok('feat/b')) });

    const result = await switchActiveEdt(params);

    expect(result.ok).toBe(true);
    expect(calls(git.createBranch)).toHaveLength(0);
    expect(calls(git.stashSave)).toEqual([['/repo/b', 'tui-back:outgoing-ulid']]);
  });

  it('a protected or other-EDT-claimed branch is rejected by the gate: `failed`, nothing stashed', async () => {
    const { git, edtRegistry, params } = adoptSetup({
      assertAllowedBranch: vi.fn(async (_repoPath: string, branch: string) =>
        branch === 'feat/b' ? err('shared-branch-rejected', 'protected') : ok(undefined),
      ),
    });

    const result = await switchActiveEdt(params);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toContainEqual({ service: 'svc-b', outcome: 'failed', detail: { code: 'shared-branch-rejected', message: 'protected' } });
    }
    expect(calls(git.stashSave)).toHaveLength(0);
    expect(calls(git.checkout)).not.toContainEqual(['/repo/b', 'development']);
    expect(calls(edtRegistry.update)).toHaveLength(0);
  });

  it('a createBranch failure restores the stash and reports `failed`', async () => {
    const { git, edtRegistry, params } = adoptSetup({ createBranch: vi.fn(async () => err('branch-exists', 'exists')) });

    const result = await switchActiveEdt(params);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toContainEqual({ service: 'svc-b', outcome: 'failed', detail: { code: 'branch-exists', message: expect.stringContaining('restored') } });
    }
    expect(calls(git.restoreStash)).toContainEqual(['/repo/b', 'tui-back:outgoing-ulid']);
    expect(calls(edtRegistry.update)).toHaveLength(0);
    expect(calls(git.checkout)).not.toContainEqual(['/repo/b', 'development']);
  });

  it('a membership-write failure restores the stash and reports `failed`', async () => {
    const { git, params } = adoptSetup({}, { update: vi.fn(async () => err('edt-registry-write-error', 'disk full')) });

    const result = await switchActiveEdt(params);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toContainEqual({ service: 'svc-b', outcome: 'failed', detail: { code: 'edt-registry-write-error', message: expect.stringContaining('restored') } });
    }
    expect(calls(git.restoreStash)).toContainEqual(['/repo/b', 'tui-back:outgoing-ulid']);
    expect(calls(git.checkout)).not.toContainEqual(['/repo/b', 'development']);
  });

  it('a checkout failure after the membership write restores the stash and keeps the membership', async () => {
    const { git, edtRegistry, params } = adoptSetup({
      checkout: vi.fn(async (repoPath: string) => (repoPath === '/repo/b' ? err('git-checkout-error', 'nope') : ok(undefined))),
    });

    const result = await switchActiveEdt(params);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toContainEqual({
        service: 'svc-b',
        outcome: 'failed',
        detail: { code: 'git-checkout-error', message: expect.stringContaining('is kept') },
      });
    }
    expect(calls(git.restoreStash)).toContainEqual(['/repo/b', 'tui-back:outgoing-ulid']);
    expect(calls(edtRegistry.update)).toHaveLength(1);
  });

  it('a stash failure leaves nothing to restore and reports `failed`', async () => {
    const { git, edtRegistry, params } = adoptSetup({ stashSave: vi.fn(async () => err('git-stash-error', 'no')) });

    const result = await switchActiveEdt(params);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toContainEqual({ service: 'svc-b', outcome: 'failed', detail: { code: 'git-stash-error', message: 'no' } });
    }
    expect(calls(git.restoreStash).filter((args) => args[0] === '/repo/b')).toHaveLength(0);
    expect(calls(git.createBranch)).toHaveLength(0);
    expect(calls(edtRegistry.update)).toHaveLength(0);
  });
});

describe('switchActiveEdt — discard confirmedPaths', () => {
  function discardWith(captured: string[], confirmedPaths?: string[]) {
    const git = fakeGit({
      hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/b')),
      listDirtyPaths: vi.fn(async () => ok(captured)),
    });
    const resolution = confirmedPaths !== undefined ? { kind: 'discard' as const, confirmedPaths } : { kind: 'discard' as const };
    return { git, params: makeParams({ git, dirtyResolutions: { '/repo/b': resolution } }) };
  }

  it('a fresh capture holding a path outside confirmedPaths fails the row, nothing discarded or checked out', async () => {
    const { git, params } = discardWith(['a.txt', 'late.txt'], ['a.txt']);

    const result = await switchActiveEdt(params);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toContainEqual({
        service: 'svc-b',
        outcome: 'failed',
        detail: { code: 'switch-discard-paths-changed', message: expect.stringContaining('late.txt') },
      });
    }
    expect(calls(git.discardAll)).toHaveLength(0);
    expect(calls(git.checkout)).not.toContainEqual(['/repo/b', 'development']);
    expect(calls(git.stashSave)).toHaveLength(0);
  });

  it('a capture equal to (or a subset of) confirmedPaths discards as usual', async () => {
    for (const captured of [['a.txt', 'b.txt'], ['a.txt']]) {
      const { git, params } = discardWith(captured, ['a.txt', 'b.txt']);

      const result = await switchActiveEdt(params);

      expect(result.ok && result.data.results.find((row) => row.service === 'svc-b')?.outcome).toBe('discarded');
      expect(calls(git.discardAll)).toEqual([['/repo/b']]);
    }
  });

  it('without confirmedPaths (the CLI) the discard is unchanged', async () => {
    const { git, params } = discardWith(['a.txt', 'late.txt']);

    const result = await switchActiveEdt(params);

    expect(result.ok && result.data.results.find((row) => row.service === 'svc-b')?.outcome).toBe('discarded');
    expect(calls(git.discardAll)).toEqual([['/repo/b']]);
  });
});

describe('switchActiveEdt — discard resolution', () => {
  it('captures the expanded dirty paths, discards, checks out: outcome discarded with detail.discardedPaths', async () => {
    const git = fakeGit({
      hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/b')),
      listDirtyPaths: vi.fn(async () => ok(['a.txt', 'newdir/b.txt'])),
    });

    const result = await switchActiveEdt(makeParams({ git, dirtyResolutions: { '/repo/b': { kind: 'discard' } } }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toContainEqual({
        service: 'svc-b',
        outcome: 'discarded',
        detail: { code: 'discarded', message: 'Discarded 2 uncommitted path(s)', discardedPaths: ['a.txt', 'newdir/b.txt'] },
      });
    }
    // Once read-only by the pre-flight (`dirtyPaths`, manifest excluded), once to capture before the discard.
    expect(calls(git.listDirtyPaths).filter((call) => call[1] !== undefined)).toEqual([
      ['/repo/b', { expandUntracked: true, excludePaths: ['.tui-back.yaml'] }],
      ['/repo/b', { expandUntracked: true }],
    ]);
    expect(calls(git.discardAll)).toEqual([['/repo/b']]);
    expect(calls(git.stashSave)).toHaveLength(0);
    expect(callOrder(git.discardAll)).toBeLessThan(callOrder(git.checkout, (args) => args[0] === '/repo/b'));
  });

  it('a discardAll failure is `failed` and never checked out', async () => {
    const git = fakeGit({
      hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/b')),
      listDirtyPaths: vi.fn(async () => ok(['a.txt'])),
      discardAll: vi.fn(async () => err('git-discard-error', 'reset failed')),
    });

    const result = await switchActiveEdt(makeParams({ git, dirtyResolutions: { '/repo/b': { kind: 'discard' } } }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toContainEqual({
        service: 'svc-b',
        outcome: 'failed',
        detail: { code: 'git-discard-error', message: expect.stringContaining('reset failed'), discardedPaths: ['a.txt'] },
      });
    }
    expect(calls(git.checkout)).not.toContainEqual(['/repo/b', 'development']);
  });

  it('a discard on a repo already clean at execution time discards nothing and is `switched`', async () => {
    let bReads = 0;
    const git = fakeGit({
      hasUncommittedChanges: vi.fn(async (repoPath: string) => {
        if (repoPath !== '/repo/b') {
          return ok(false);
        }
        bReads += 1;
        return ok(bReads === 1);
      }),
    });

    const result = await switchActiveEdt(makeParams({ git, dirtyResolutions: { '/repo/b': { kind: 'discard' } } }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toContainEqual({ service: 'svc-b', outcome: 'switched' });
    }
    expect(calls(git.discardAll)).toHaveLength(0);
    expect(calls(git.checkout)).toContainEqual(['/repo/b', 'development']);
  });

  it('a missing shared branch that fails to fetch never follows a discard', async () => {
    const git = fakeGit({
      hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/b')),
      listDirtyPaths: vi.fn(async () => ok(['a.txt'])),
      branchExistsLocally: vi.fn(async () => ok(false)),
      fetch: vi.fn(async () => err('git-fetch-error', 'offline')),
    });

    const result = await switchActiveEdt(makeParams({ git, dirtyResolutions: { '/repo/b': { kind: 'discard' } } }));

    expect(result.ok).toBe(true);
    expect(calls(git.discardAll)).toHaveLength(0);
  });
});

describe('switchActiveEdt — failure reporting and resolution edge cases', () => {
  it('a discard on a target member whose own branch is missing fails before touching the repo', async () => {
    const git = fakeGit({
      hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a')),
      listDirtyPaths: vi.fn(async () => ok(['x.txt'])),
      branchExistsLocally: vi.fn(async (repoPath: string) => ok(repoPath !== '/repo/a')),
    });

    const result = await switchActiveEdt(makeParams({ git, dirtyResolutions: { '/repo/a': { kind: 'discard' } } }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toContainEqual({
        service: 'svc-a',
        outcome: 'failed',
        detail: { code: 'member-branch-missing', message: expect.stringContaining('feat/a') },
      });
    }
    expect(calls(git.discardAll)).toHaveLength(0);
    expect(calls(git.fetch)).toHaveLength(0);
    for (const method of WRITE_METHODS) {
      expect(calls(git[method]).filter((args) => args[0] === '/repo/a'), `git.${method}`).toHaveLength(0);
    }
  });

  it('a target-stash pop failure after a discard keeps discardedPaths and says the changes were already discarded', async () => {
    const git = fakeGit({
      hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a')),
      listDirtyPaths: vi.fn(async () => ok(['x.txt'])),
      restoreStash: vi.fn(async () => err('git-stash-pop-error', 'conflict')),
    });

    const result = await switchActiveEdt(makeParams({ git, dirtyResolutions: { '/repo/a': { kind: 'discard' } } }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toContainEqual({
        service: 'svc-a',
        outcome: 'failed',
        detail: { code: 'git-stash-pop-error', message: expect.stringContaining('already been discarded'), discardedPaths: ['x.txt'] },
      });
    }
  });

  it('a target-stash pop failure after an adopt says the adoption succeeded and where the work sits', async () => {
    const git = fakeGit({
      hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a')),
      currentBranch: vi.fn(async () => ok('development')),
      restoreStash: vi.fn(async (_repoPath: string, tag: string) =>
        tag === 'tui-back:target-ulid' ? err('git-stash-pop-error', 'conflict') : ok(undefined),
      ),
    });

    const result = await switchActiveEdt(makeParams({ git, dirtyResolutions: { '/repo/a': { kind: 'adopt', branch: 'feat/a-out' } } }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toContainEqual({
        service: 'svc-a',
        outcome: 'failed',
        detail: {
          code: 'git-stash-pop-error',
          message: expect.stringMatching(/adoption into "outgoing-topic" on "feat\/a-out" succeeded.*tui-back:outgoing-ulid/),
        },
      });
    }
  });

  it('a discardAll failure keeps the captured paths and says they may be partially discarded', async () => {
    const git = fakeGit({
      hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/b')),
      listDirtyPaths: vi.fn(async () => ok(['a.txt', 'dir/b.txt'])),
      discardAll: vi.fn(async () => err('git-discard-error', 'git clean -fd failed')),
    });

    const result = await switchActiveEdt(makeParams({ git, dirtyResolutions: { '/repo/b': { kind: 'discard' } } }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toContainEqual({
        service: 'svc-b',
        outcome: 'failed',
        detail: { code: 'git-discard-error', message: expect.stringContaining('partially discarded'), discardedPaths: ['a.txt', 'dir/b.txt'] },
      });
    }
    expect(calls(git.checkout)).not.toContainEqual(['/repo/b', 'development']);
  });

  it('a checkout failure on a repo in both outgoing and target restores the outgoing-tagged stash', async () => {
    const outgoing = edtEntry('outgoing-ulid', 'outgoing-topic', [member('svc-a', '/repo/a', 'feat/a-out'), member('svc-c', '/repo/c', 'feat/c')]);
    const git = fakeGit({
      hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a')),
      checkout: vi.fn(async (repoPath: string) => (repoPath === '/repo/a' ? err('git-checkout-error', 'blocked') : ok(undefined))),
    });
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET, outgoing])) });

    const result = await switchActiveEdt(makeParams({ git, edtRegistry }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toContainEqual({
        service: 'svc-a',
        outcome: 'failed',
        detail: { code: 'git-checkout-error', message: expect.stringContaining('restored') },
      });
    }
    expect(calls(git.restoreStash)).toEqual([['/repo/a', 'tui-back:outgoing-ulid']]);
  });

  it('a checkout failure after a successful discard (non-member) keeps discardedPaths and says already discarded', async () => {
    const git = fakeGit({
      hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/b')),
      listDirtyPaths: vi.fn(async () => ok(['a.txt'])),
      checkout: vi.fn(async (repoPath: string) => (repoPath === '/repo/b' ? err('git-checkout-error', 'blocked') : ok(undefined))),
    });

    const result = await switchActiveEdt(makeParams({ git, dirtyResolutions: { '/repo/b': { kind: 'discard' } } }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toContainEqual({
        service: 'svc-b',
        outcome: 'failed',
        detail: { code: 'git-checkout-error', message: expect.stringContaining('already been discarded'), discardedPaths: ['a.txt'] },
      });
    }
  });

  it('a first-ever switch ignores a stale adopt resolution for a clean repo and proceeds', async () => {
    const git = fakeGit();
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok(null)) });
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET])) });

    const result = await switchActiveEdt(
      makeParams({ git, state, edtRegistry, dirtyResolutions: { '/repo/b': { kind: 'adopt', branch: 'feat/b' } } }),
    );

    expect(result.ok).toBe(true);
    expect(calls(state.writeActiveEdt)).toEqual([['target-ulid']]);
    expect(calls(git.createBranch)).toHaveLength(0);
  });

  it('trims the adopt branch everywhere downstream (gate, createBranch, membership)', async () => {
    const git = fakeGit({
      hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/b')),
      currentBranch: vi.fn(async () => ok('development')),
    });
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET, OUTGOING])) });

    const result = await switchActiveEdt(makeParams({ git, edtRegistry, dirtyResolutions: { '/repo/b': { kind: 'adopt', branch: ' feat/b ' } } }));

    expect(result.ok).toBe(true);
    expect(calls(git.assertAllowedBranch)).toContainEqual(['/repo/b', 'feat/b', 'outgoing-ulid']);
    expect(calls(git.createBranch)).toEqual([['/repo/b', 'feat/b', 'development']]);
    expect(calls(edtRegistry.update)).toEqual([
      ['outgoing-ulid', { topic: 'outgoing-topic', members: [...OUTGOING.members, member('svc-b', '/repo/b', 'feat/b')] }],
    ]);
  });

  it('an adopt with a blank branch is invalid-argument with zero git writes', async () => {
    const git = fakeGit({ hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/b')) });
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok('outgoing-ulid')) });

    const result = await switchActiveEdt(makeParams({ git, state, dirtyResolutions: { '/repo/b': { kind: 'adopt', branch: '  ' } } }));

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    expectZeroWrites(git);
    expect(calls(state.writeActiveEdt)).toHaveLength(0);
  });
});

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

describe('switchActiveEdt — dirtyPolicy flag sugar', () => {
  function policySetup(currentBranch: string, dirtyPolicy: SwitchActiveEdtParams['dirtyPolicy'], withOutgoing = true) {
    const git = fakeGit({
      hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/b')),
      currentBranch: vi.fn(async () => ok(currentBranch)),
      listDirtyPaths: vi.fn(async () => ok(['a.txt'])),
    });
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok(withOutgoing ? 'outgoing-ulid' : null)) });
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok(withOutgoing ? [TARGET, OUTGOING] : [TARGET])) });
    const onDirtyReposBeforeSwitch = vi.fn();
    return { git, edtRegistry, onDirtyReposBeforeSwitch, params: makeParams({ git, state, edtRegistry, dirtyPolicy, onDirtyReposBeforeSwitch }) };
  }

  it('discard policy discards every dirty state-2/3 repo and skips the seam', async () => {
    const { git, onDirtyReposBeforeSwitch, params } = policySetup('wip/b', { kind: 'discard' });

    const result = await switchActiveEdt(params);

    expect(result.ok).toBe(true);
    expect(calls(git.discardAll)).toEqual([['/repo/b']]);
    expect(onDirtyReposBeforeSwitch).not.toHaveBeenCalled();
  });

  it('adopt policy keeps a non-shared current branch and needs no branch name', async () => {
    const { git, params } = policySetup('wip/b', { kind: 'adopt' });

    const result = await switchActiveEdt(params);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toContainEqual(
        expect.objectContaining({ service: 'svc-b', outcome: 'adopted', detail: expect.objectContaining({ adoptedBranch: 'wip/b' }) }),
      );
    }
    expect(calls(git.createBranch)).toHaveLength(0);
    expect(calls(git.stashSave)).toEqual([['/repo/b', 'tui-back:outgoing-ulid']]);
  });

  it('adopt policy moves a shared-branch repo onto the given branch', async () => {
    const { git, params } = policySetup('development', { kind: 'adopt', branch: 'feat/rescue' });

    const result = await switchActiveEdt(params);

    expect(result.ok).toBe(true);
    expect(calls(git.createBranch)).toEqual([['/repo/b', 'feat/rescue', 'development']]);
  });

  it('adopt policy without a branch on a shared-branch repo fails up front with missing-argument', async () => {
    const { git, params } = policySetup('development', { kind: 'adopt' });

    const result = await switchActiveEdt(params);

    expect(result).toMatchObject({ ok: false, error: { code: 'missing-argument' } });
    expectZeroWrites(git);
  });

  it('adopt policy with no outgoing EDT fails with switch-adopt-without-outgoing', async () => {
    const { git, params } = policySetup('wip/b', { kind: 'adopt', branch: 'x' }, false);

    const result = await switchActiveEdt(params);

    expect(result).toMatchObject({ ok: false, error: { code: 'switch-adopt-without-outgoing' } });
    expectZeroWrites(git);
  });

  it('adopt policy with no outgoing EDT and a shared-branch repo reports switch-adopt-without-outgoing first', async () => {
    const { git, params } = policySetup('development', { kind: 'adopt' }, false);

    const result = await switchActiveEdt(params);

    expect(result).toMatchObject({ ok: false, error: { code: 'switch-adopt-without-outgoing' } });
    expectZeroWrites(git);
  });

  it('an explicit dirtyResolutions entry wins over the policy for that repo', async () => {
    const { git, edtRegistry, onDirtyReposBeforeSwitch } = policySetup('wip/b', { kind: 'discard' });
    const params = makeParams({
      git,
      edtRegistry,
      dirtyPolicy: { kind: 'discard' },
      dirtyResolutions: { '/repo/b': { kind: 'adopt', branch: 'wip/b' } },
      onDirtyReposBeforeSwitch,
    });

    await switchActiveEdt(params);

    expect(calls(git.discardAll)).toHaveLength(0);
  });
});
