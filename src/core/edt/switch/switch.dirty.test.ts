// core/edt/switch: unit tests against fake ports — dirty-repo classification, pre-flight, resolution seam and state-1 stash safety.
import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '../../result.js';
import { classifySwitchRepos, switchActiveEdt } from './switch.js';
import { calls, edtEntry, fakeEdtRegistry, fakeLock, fakeState, member } from '../../shared/core-ports.test-support.js';
import { fakeGit, expectZeroWrites, fakeManifest, makeParams, manifestFor, OTHER, OUTGOING, TARGET, WRITE_METHODS } from './switch.test-support.js';

describe('classifySwitchRepos', () => {
  it('classifies against the OUTGOING EDT, destination still target-driven', () => {
    const outgoing = edtEntry('outgoing-ulid', 'outgoing-topic', [member('svc-a', '/repo/a', 'feat/a-out'), member('svc-c', '/repo/c/', 'feat/c')]);
    const target = edtEntry('target-ulid', 'target-topic', [member('svc-a', '/repo/a', 'feat/a'), member('svc-d', '/repo/d', 'feat/d')]);

    const classified = classifySwitchRepos(['/repo/a', '/repo/b', '/repo/c', '/repo/d', '/repo/e'], outgoing, target, [outgoing, target, OTHER]);

    expect(classified).toEqual([
      { repoPath: '/repo/a', state: 1, targetMember: member('svc-a', '/repo/a', 'feat/a'), owningTopics: ['target-topic'] },
      { repoPath: '/repo/b', state: 2, owningTopics: ['other-topic'] },
      { repoPath: '/repo/c', state: 1, owningTopics: [] },
      { repoPath: '/repo/d', state: 2, targetMember: member('svc-d', '/repo/d', 'feat/d'), owningTopics: ['target-topic'] },
      { repoPath: '/repo/e', state: 3, owningTopics: [] },
    ]);
  });

  it('with no outgoing EDT, nothing is state 1 — a target member is state 2', () => {
    const classified = classifySwitchRepos(['/repo/a', '/repo/b'], undefined, TARGET, [TARGET]);

    expect(classified.map((repo) => repo.state)).toEqual([2, 3]);
  });

  it('counts the target as an owner even when it is missing from allEdts', () => {
    const classified = classifySwitchRepos(['/repo/a'], undefined, TARGET, []);

    expect(classified[0]).toMatchObject({ state: 2, owningTopics: ['target-topic'] });
  });
});

describe('switchActiveEdt — pre-flight for dirty state-2/3 repos', () => {
  it('an unresolved dirty non-member refuses the switch with details, zero git writes, state untouched', async () => {
    const git = fakeGit({
      hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/b' || repoPath === '/repo/c')),
      currentBranch: vi.fn(async () => ok('wip/b')),
    });
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok('outgoing-ulid')) });
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET, OUTGOING])) });
    const lock = fakeLock();

    const result = await switchActiveEdt(makeParams({ git, state, edtRegistry, lock }));

    expect(result).toMatchObject({ ok: false, error: { code: 'switch-dirty-services-unresolved' } });
    if (!result.ok) {
      // Only the state-3 repo blocks; c (state 1) would have been auto-stashed.
      expect(result.error.details).toEqual([{ service: 'svc-b', repoPath: '/repo/b', scope: 'non-member', currentBranch: 'wip/b' }]);
    }
    expectZeroWrites(git);
    expect(calls(state.writeActiveEdt)).toHaveLength(0);
    expect(calls(edtRegistry.setStatus)).toHaveLength(0);
    expect(calls(edtRegistry.update)).toHaveLength(0);
    expect(calls(lock.acquire)).toHaveLength(0);
  });

  it('a dirty target-only member is state 2 and needs a resolution (D2 gone)', async () => {
    const git = fakeGit({ hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a')) });

    const result = await switchActiveEdt(makeParams({ git }));

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'switch-dirty-services-unresolved', details: [{ service: 'svc-a', repoPath: '/repo/a', scope: 'member-of-other-edt' }] },
    });
    expectZeroWrites(git);
  });

  it('a failed dirty read is left out of the pre-flight and reported `failed` by the main loop', async () => {
    const git = fakeGit({
      hasUncommittedChanges: vi.fn(async (repoPath: string) => (repoPath === '/repo/b' ? err('git-status-error', 'boom') : ok(false))),
    });

    const result = await switchActiveEdt(makeParams({ git }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toContainEqual({ service: 'svc-b', outcome: 'failed', detail: { code: 'git-status-error', message: 'boom' } });
    }
    expect(calls(git.checkout)).not.toContainEqual(['/repo/b', 'development']);
  });

  it('a repo clean in the pre-flight but dirty in the main loop, unresolved, is a `failed` row left untouched', async () => {
    let bReads = 0;
    const git = fakeGit({
      hasUncommittedChanges: vi.fn(async (repoPath: string) => {
        if (repoPath !== '/repo/b') {
          return ok(false);
        }
        bReads += 1;
        return ok(bReads > 1);
      }),
    });

    const result = await switchActiveEdt(makeParams({ git }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toContainEqual({
        service: 'svc-b',
        outcome: 'failed',
        detail: { code: 'switch-dirty-unresolved', message: expect.stringContaining('/repo/b') },
      });
      expect(result.data.results).toContainEqual({ service: 'svc-a', outcome: 'switched' });
    }
    for (const method of WRITE_METHODS) {
      expect(calls(git[method]).filter((args) => args[0] === '/repo/b'), `git.${method}`).toHaveLength(0);
    }
  });

  it('never runs a destructive discard without an explicit resolution for that repo', async () => {
    const git = fakeGit({ hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/b')) });

    await switchActiveEdt(makeParams({ git, dirtyResolutions: { '/repo/other': { kind: 'discard' } } }));

    expect(calls(git.discardAll)).toHaveLength(0);
  });
});

describe('switchActiveEdt — the dirty-repo resolution seam', () => {
  it('is never invoked when every repo is clean', async () => {
    const onDirtyReposBeforeSwitch = vi.fn(async () => ({ kind: 'cancel' as const }));

    const result = await switchActiveEdt(makeParams({ onDirtyReposBeforeSwitch }));

    expect(result.ok).toBe(true);
    expect(calls(onDirtyReposBeforeSwitch)).toHaveLength(0);
  });

  it('is invoked once, before any write, with every dirty repo — state-1 rows flagged auto-stash', async () => {
    const git = fakeGit({
      hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath !== '/repo/a')),
      currentBranch: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/b' ? 'development' : 'feat/c')),
    });
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET, OUTGOING, OTHER])) });
    let writesWhenAsked = -1;
    const onDirtyReposBeforeSwitch = vi.fn(async () => {
      writesWhenAsked = WRITE_METHODS.reduce((total, method) => total + calls(git[method]).length, 0);
      return { kind: 'cancel' as const };
    });

    const result = await switchActiveEdt(makeParams({ git, edtRegistry, onDirtyReposBeforeSwitch }));

    expect(result).toMatchObject({ ok: false, error: { code: 'switch-cancelled-by-user' } });
    expect(calls(onDirtyReposBeforeSwitch)).toEqual([
      [
        [
          {
            service: 'svc-b',
            repoPath: '/repo/b',
            scope: 'member-of-other-edt',
            currentBranch: 'development',
            currentBranchShared: true,
            sharedBranch: 'development',
            protectedBranches: [],
            owningEdtTopics: ['other-topic'],
            dirtyPaths: [],
          },
          {
            service: 'svc-c',
            repoPath: '/repo/c',
            scope: 'outgoing-member',
            currentBranch: 'feat/c',
            currentBranchShared: false,
            sharedBranch: 'development',
            protectedBranches: [],
            owningEdtTopics: [],
            resolution: 'auto-stash',
          },
        ],
      ],
    ]);
    expect(writesWhenAsked).toBe(0);
    expectZeroWrites(git);
    expect(calls(edtRegistry.setStatus)).toHaveLength(0);
  });

  it('is not invoked when only state-1 repos are dirty', async () => {
    const git = fakeGit({ hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/c')) });
    const onDirtyReposBeforeSwitch = vi.fn(async () => ({ kind: 'cancel' as const }));

    const result = await switchActiveEdt(makeParams({ git, onDirtyReposBeforeSwitch }));

    expect(result.ok).toBe(true);
    expect(calls(onDirtyReposBeforeSwitch)).toHaveLength(0);
    expect(calls(git.stashSave)).toEqual([['/repo/c', 'tui-back:outgoing-ulid']]);
  });

  it('a proceed choice supplies the resolutions', async () => {
    const git = fakeGit({
      hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/b')),
      listDirtyPaths: vi.fn(async () => ok(['junk.txt'])),
    });
    const onDirtyReposBeforeSwitch = vi.fn(async () => ({ kind: 'proceed' as const, resolutions: { '/repo/b': { kind: 'discard' as const } } }));

    const result = await switchActiveEdt(makeParams({ git, onDirtyReposBeforeSwitch }));

    expect(result.ok).toBe(true);
    expect(calls(git.discardAll)).toEqual([['/repo/b']]);
  });

  it('a proceed choice that leaves a dirty repo unresolved still refuses, zero writes', async () => {
    const git = fakeGit({ hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/b')) });
    const onDirtyReposBeforeSwitch = vi.fn(async () => ({ kind: 'proceed' as const, resolutions: {} }));

    const result = await switchActiveEdt(makeParams({ git, onDirtyReposBeforeSwitch }));

    expect(result).toMatchObject({ ok: false, error: { code: 'switch-dirty-services-unresolved' } });
    expectZeroWrites(git);
  });

  it('explicit dirtyResolutions take precedence and skip the seam', async () => {
    const git = fakeGit({
      hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/b')),
      listDirtyPaths: vi.fn(async () => ok(['junk.txt'])),
    });
    const onDirtyReposBeforeSwitch = vi.fn(async () => ({ kind: 'cancel' as const }));

    const result = await switchActiveEdt(
      makeParams({ git, onDirtyReposBeforeSwitch, dirtyResolutions: { '/repo/b/': { kind: 'discard' } } }),
    );

    expect(result.ok).toBe(true);
    expect(calls(onDirtyReposBeforeSwitch)).toHaveLength(0);
    expect(calls(git.discardAll)).toEqual([['/repo/b']]);
  });
});

describe('switchActiveEdt — seam row facts for the TUI dialog', () => {
  it('carries the manifest sharedBranch and a read-only expanded dirtyPaths snapshot on state-2/3 rows only', async () => {
    const git = fakeGit({
      hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath !== '/repo/a')),
      listDirtyPaths: vi.fn(async () => ok(['x.txt', 'dir/y.txt'])),
    });
    const onDirtyReposBeforeSwitch = vi.fn(async () => ({ kind: 'cancel' as const }));

    await switchActiveEdt(makeParams({ git, onDirtyReposBeforeSwitch }));

    const rows = calls(onDirtyReposBeforeSwitch)[0]![0] as Array<Record<string, unknown>>;
    expect(rows.find((row) => row.repoPath === '/repo/b')).toMatchObject({ sharedBranch: 'development', dirtyPaths: ['x.txt', 'dir/y.txt'] });
    const stateOne = rows.find((row) => row.repoPath === '/repo/c');
    expect(stateOne).toMatchObject({ sharedBranch: 'development', resolution: 'auto-stash' });
    expect(stateOne).not.toHaveProperty('dirtyPaths');
    expect(calls(git.listDirtyPaths).filter((call) => call[1] !== undefined)).toEqual([
      ['/repo/b', { expandUntracked: true, excludePaths: ['.tui-back.yaml'] }],
    ]);
    expectZeroWrites(git);
  });

  it("carries the manifest's protectedBranches and flags a current branch it lists as shared", async () => {
    const git = fakeGit({
      hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/b')),
      currentBranch: vi.fn(async () => ok('preprod')),
      listDirtyPaths: vi.fn(async () => ok(['x.txt'])),
    });
    const manifest = fakeManifest({
      load: vi.fn(async (path: string) => ok({ ...manifestFor(path), protectedBranches: ['preprod'] })),
    });
    const onDirtyReposBeforeSwitch = vi.fn(async () => ({ kind: 'cancel' as const }));

    await switchActiveEdt(makeParams({ git, manifest, onDirtyReposBeforeSwitch }));

    const [row] = calls(onDirtyReposBeforeSwitch)[0]![0] as Array<Record<string, unknown>>;
    expect(row).toMatchObject({ repoPath: '/repo/b', protectedBranches: ['preprod'], currentBranchShared: true });
  });

  it('does not flag a formerly implicit branch the manifest does not list', async () => {
    const git = fakeGit({
      hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/b')),
      currentBranch: vi.fn(async () => ok('prod')),
      listDirtyPaths: vi.fn(async () => ok(['x.txt'])),
    });
    const onDirtyReposBeforeSwitch = vi.fn(async () => ({ kind: 'cancel' as const }));

    await switchActiveEdt(makeParams({ git, onDirtyReposBeforeSwitch }));

    const [row] = calls(onDirtyReposBeforeSwitch)[0]![0] as Array<Record<string, unknown>>;
    expect(row).toMatchObject({ repoPath: '/repo/b', protectedBranches: [], currentBranchShared: false });
  });

  it('a failed dirtyPaths read leaves the field unset; a failed manifest load yields sharedBranch null', async () => {
    const git = fakeGit({
      hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/b')),
      listDirtyPaths: vi.fn(async () => err('git-status-error', 'boom')),
    });
    const manifest = fakeManifest({ load: vi.fn(async () => err('manifest-not-found', 'missing')) });
    const onDirtyReposBeforeSwitch = vi.fn(async () => ({ kind: 'cancel' as const }));

    await switchActiveEdt(makeParams({ git, manifest, onDirtyReposBeforeSwitch }));

    const [row] = calls(onDirtyReposBeforeSwitch)[0]![0] as Array<Record<string, unknown>>;
    expect(row).toMatchObject({ repoPath: '/repo/b', sharedBranch: null });
    expect(row).not.toHaveProperty('dirtyPaths');
  });
});

describe('switchActiveEdt — state-1 stash safety', () => {
  it('a checkout failure after an auto-stash restores the stash before reporting `failed`', async () => {
    const git = fakeGit({
      hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/c')),
      checkout: vi.fn(async (repoPath: string) => (repoPath === '/repo/c' ? err('git-checkout-error', 'blocked') : ok(undefined))),
    });

    const result = await switchActiveEdt(makeParams({ git }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toContainEqual({ service: 'svc-c', outcome: 'failed', detail: { code: 'git-checkout-error', message: expect.stringContaining('restored') } });
    }
    expect(calls(git.restoreStash)).toContainEqual(['/repo/c', 'tui-back:outgoing-ulid']);
  });

  it('says where the work is when that restore itself fails', async () => {
    const git = fakeGit({
      hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/c')),
      checkout: vi.fn(async (repoPath: string) => (repoPath === '/repo/c' ? err('git-checkout-error', 'blocked') : ok(undefined))),
      restoreStash: vi.fn(async () => err('git-stash-pop-error', 'conflict')),
    });

    const result = await switchActiveEdt(makeParams({ git }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toContainEqual({
        service: 'svc-c',
        outcome: 'failed',
        detail: { code: 'git-checkout-error', message: expect.stringContaining('still stashed under "tui-back:outgoing-ulid"') },
      });
    }
  });
});
