// core/edt: switchActiveEdt — the `unchanged` outcome and the shared-branches system EDT guards.
import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '../../result.js';
import { buildSharedBranchesEdt, SHARED_EDT_ULID } from '../shared-edt/shared-edt.js';
import { classifySwitchRepos, switchActiveEdt, type SwitchActiveEdtParams } from './switch.js';
import { calls, edtEntry, fakeEdtRegistry, fakeState, member } from '../../shared/core-ports.test-support.js';
import { fakeGit, makeParams, manifestFor, OUTGOING, REPOS, TARGET } from './switch.test-support.js';

describe('switchActiveEdt — unchanged outcome', () => {
  const branches: Record<string, string> = { '/repo/a': 'feat/a', '/repo/b': 'development', '/repo/c': 'development' };
  const onTarget = () => vi.fn(async (repoPath: string) => ok(branches[repoPath] ?? 'x'));

  it('reports every clean repo already on its target as `unchanged`, running no checkout', async () => {
    const git = fakeGit({ currentBranch: onTarget() });
    const result = await switchActiveEdt(makeParams({ git }));
    expect(result.ok && result.data.results).toEqual([
      { service: 'svc-a', outcome: 'unchanged', detail: { code: 'unchanged', message: 'already on `feat/a`' } },
      { service: 'svc-b', outcome: 'unchanged', detail: { code: 'unchanged', message: 'already on `development`' } },
      { service: 'svc-c', outcome: 'unchanged', detail: { code: 'unchanged', message: 'already on `development`' } },
    ]);
    expect(calls(git.checkout)).toHaveLength(0);
    expect(calls(git.restoreStash)).toHaveLength(0);
  });

  it('keeps `switched` for a repo on another branch', async () => {
    const git = fakeGit();
    const result = await switchActiveEdt(makeParams({ git }));
    expect(result.ok && result.data.results.map((r) => r.outcome)).toEqual(['switched', 'switched', 'switched']);
  });

  it('keeps `switched` and pops the stash when a target-tagged stash exists on an already-there member', async () => {
    const git = fakeGit({ currentBranch: onTarget(), hasStash: vi.fn(async () => ok(true)) });
    const result = await switchActiveEdt(makeParams({ git }));
    expect(result.ok && result.data.results.find((r) => r.service === 'svc-a')?.outcome).toBe('switched');
    expect(calls(git.restoreStash)).toContainEqual(['/repo/a', 'tui-back:target-ulid']);
  });

  it('keeps `switched` (stash-on-dirty) for an already-there dirty state-1 repo', async () => {
    const outgoing = edtEntry('outgoing-ulid', 'outgoing-topic', [member('svc-a', '/repo/a', 'feat/a-out')]);
    const git = fakeGit({
      currentBranch: onTarget(),
      hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a')),
    });
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET, outgoing])) });
    const result = await switchActiveEdt(makeParams({ git, edtRegistry }));
    expect(result.ok && result.data.results.find((r) => r.service === 'svc-a')?.outcome).toBe('switched');
    expect(calls(git.stashSave)).toHaveLength(1);
  });

  it('keeps `discarded` for an already-there dirty repo with a discard resolution', async () => {
    const git = fakeGit({
      currentBranch: onTarget(),
      hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/b')),
      listDirtyPaths: vi.fn(async () => ok(['x.txt'])),
    });
    const result = await switchActiveEdt(makeParams({ git, dirtyResolutions: { '/repo/b': { kind: 'discard' } } }));
    expect(result.ok && result.data.results.find((r) => r.service === 'svc-b')?.outcome).toBe('discarded');
  });

  it('falls back to `switched` when currentBranch fails (or HEAD is detached)', async () => {
    const git = fakeGit({ currentBranch: vi.fn(async () => err('detached-head', 'detached')) });
    const result = await switchActiveEdt(makeParams({ git }));
    expect(result.ok && result.data.results.map((r) => r.outcome)).toEqual(['switched', 'switched', 'switched']);
  });

  it('still resolves the destination first: a missing member branch fails even when "already there"', async () => {
    const git = fakeGit({ currentBranch: onTarget(), branchExistsLocally: vi.fn(async (_p: string, b: string) => ok(b !== 'feat/a')) });
    const result = await switchActiveEdt(makeParams({ git }));
    expect(result.ok && result.data.results.find((r) => r.service === 'svc-a')?.outcome).toBe('failed');
  });

  it('treats a detached HEAD reading as not already there', async () => {
    const git = fakeGit({ currentBranch: vi.fn(async () => ok('HEAD')) });
    const result = await switchActiveEdt(makeParams({ git }));
    expect(result.ok && result.data.results.map((r) => r.outcome)).toEqual(['switched', 'switched', 'switched']);
  });

  it('falls back to `switched` (checkout and pop run) when hasStash fails on an already-there member', async () => {
    const git = fakeGit({ currentBranch: onTarget(), hasStash: vi.fn(async () => err('git-error', 'boom')) });
    const result = await switchActiveEdt(makeParams({ git }));
    expect(result.ok && result.data.results.find((r) => r.service === 'svc-a')?.outcome).toBe('switched');
    expect(calls(git.checkout)).toContainEqual(['/repo/a', 'feat/a']);
    expect(calls(git.restoreStash)).toContainEqual(['/repo/a', 'tui-back:target-ulid']);
  });

  it('keeps `switched` and checks out for an already-there dirty non-member (stash plan)', async () => {
    const outgoing = edtEntry('outgoing-ulid', 'outgoing-topic', [member('svc-b', '/repo/b', 'feat/b')]);
    const git = fakeGit({
      currentBranch: onTarget(),
      hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/b')),
    });
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET, outgoing])) });
    const result = await switchActiveEdt(makeParams({ git, edtRegistry }));
    expect(result.ok && result.data.results.find((r) => r.service === 'svc-b')?.outcome).toBe('switched');
    expect(calls(git.stashSave)).toContainEqual(['/repo/b', 'tui-back:outgoing-ulid']);
    expect(calls(git.checkout)).toContainEqual(['/repo/b', 'development']);
  });
});

describe('switchActiveEdt — shared-branches system EDT', () => {
  const SYSTEM = buildSharedBranchesEdt(REPOS.map((repoPath) => ({ repoPath, manifest: manifestFor(repoPath) })));

  it('the system EDT only counts as an owner of a repo when it is the switch target', () => {
    const asOwner = classifySwitchRepos(['/repo/b'], OUTGOING, TARGET, [TARGET, OUTGOING, SYSTEM]);
    expect(asOwner[0]).toMatchObject({ state: 3, owningTopics: [] });
    const asTarget = classifySwitchRepos(['/repo/b'], OUTGOING, SYSTEM, [TARGET, OUTGOING, SYSTEM]);
    expect(asTarget[0]).toMatchObject({ state: 2, owningTopics: ['Shared branches'] });
  });

  it('switching INTO the system EDT checks every repo out to its shared branch, ungated, fetching an absent one', async () => {
    const assertAllowedBranch = vi.fn(async () => err('shared-branch-rejected', 'protected'));
    const branchExistsLocally = vi.fn(async (_repo: string) => ok(_repo !== '/repo/b'));
    const git = fakeGit({ assertAllowedBranch, branchExistsLocally });
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET, OUTGOING, SYSTEM])) });

    const result = await switchActiveEdt(makeParams({ git, edtRegistry, topic: 'Shared branches' }));

    expect(result.ok && result.data.results.map((row) => row.outcome)).toEqual(['switched', 'switched', 'switched']);
    expect(calls(assertAllowedBranch)).toHaveLength(0);
    expect(calls(git.checkout).map(([repo, branch]) => [repo, branch])).toEqual([
      ['/repo/a', 'development'], ['/repo/b', 'development'], ['/repo/c', 'development'],
    ]);
    expect(calls(git.fetch)).toEqual([['/repo/b', 'development']]);
  });

  it('an ordinary EDT member on a shared branch is still gated and rejected', async () => {
    const ordinary = edtEntry('ord-ulid', 'ord', [member('svc-a', '/repo/a', 'development')]);
    const git = fakeGit({ assertAllowedBranch: vi.fn(async () => err('shared-branch-rejected', 'protected')) });
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([ordinary])) });

    const result = await switchActiveEdt(makeParams({ git, edtRegistry, topic: 'ord', state: fakeState() }));

    expect(result.ok && result.data.results[0]).toMatchObject({ service: 'svc-a', outcome: 'failed', detail: { code: 'shared-branch-rejected' } });
    expect(calls(git.checkout).some(([repo]) => repo === '/repo/a')).toBe(false);
  });

  function outgoingSystem(overrides: Partial<SwitchActiveEdtParams> = {}): SwitchActiveEdtParams {
    return makeParams({
      edtRegistry: fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET, SYSTEM])) }),
      state: fakeState({ readActiveEdt: vi.fn(async () => ok(SHARED_EDT_ULID)) }),
      git: fakeGit({ hasUncommittedChanges: vi.fn(async () => ok(true)), listDirtyPaths: vi.fn(async () => ok(['f.ts'])) }),
      ...overrides,
    });
  }

  it.each([
    ['--adopt-dirty', { dirtyPolicy: { kind: 'adopt' as const } }],
    ['--adopt-branch', { dirtyPolicy: { kind: 'adopt' as const, branch: 'feat/x' } }],
    ['an explicit adopt resolution', { dirtyResolutions: { '/repo/a': { kind: 'adopt' as const, branch: 'feat/x' } } }],
  ])('rejects %s with switch-adopt-unavailable before touching anything', async (_label, extra) => {
    const params = outgoingSystem(extra);

    const result = await switchActiveEdt(params);

    expect(result).toMatchObject({ ok: false, error: { code: 'switch-adopt-unavailable' } });
    expect(calls(params.git.stashSave)).toHaveLength(0);
    expect(calls(params.git.checkout)).toHaveLength(0);
    expect(calls(params.state.writeActiveEdt)).toHaveLength(0);
  });

  it('stashes dirty repos (state 1) and marks the dialog rows adoptUnavailable', async () => {
    let seen: Array<{ adoptUnavailable?: boolean }> = [];
    // /repo/b and /repo/c are non-members here, so the dialog seam is reached with all three rows.
    const partial = buildSharedBranchesEdt([{ repoPath: '/repo/a', manifest: manifestFor('/repo/a') }]);
    const params = outgoingSystem({
      edtRegistry: fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET, partial])) }),
      onDirtyReposBeforeSwitch: async (rows) => {
        seen = rows;
        return { kind: 'proceed', resolutions: { '/repo/b': { kind: 'discard' }, '/repo/c': { kind: 'discard' } } };
      },
    });

    const result = await switchActiveEdt(params);

    expect(result.ok).toBe(true);
    expect(calls(params.git.stashSave).map(([, tag]) => tag)).toEqual([`tui-back:${SHARED_EDT_ULID}`]);
    expect(seen.length).toBe(3);
    expect(seen.every((row) => row.adoptUnavailable === true)).toBe(true);
  });

  it('rejects an adopt resolution returned by the dialog callback with switch-adopt-unavailable, before any git write', async () => {
    const partial = buildSharedBranchesEdt([{ repoPath: '/repo/a', manifest: manifestFor('/repo/a') }]);
    const params = outgoingSystem({
      edtRegistry: fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET, partial])) }),
      onDirtyReposBeforeSwitch: async () => ({
        kind: 'proceed',
        resolutions: { '/repo/b': { kind: 'adopt', branch: 'feat/x' }, '/repo/c': { kind: 'discard' } },
      }),
    });

    const result = await switchActiveEdt(params);

    expect(result).toMatchObject({ ok: false, error: { code: 'switch-adopt-unavailable' } });
    for (const write of [params.git.stashSave, params.git.discardAll, params.git.checkout, params.git.createBranch]) {
      expect(calls(write)).toHaveLength(0);
    }
  });

  it('allows discard when the system EDT is outgoing and a repo is a non-member', async () => {
    const partial = buildSharedBranchesEdt([{ repoPath: '/repo/a', manifest: manifestFor('/repo/a') }]);
    const params = outgoingSystem({
      edtRegistry: fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET, partial])) }),
      dirtyPolicy: { kind: 'discard' },
    });

    const result = await switchActiveEdt(params);

    expect(result.ok).toBe(true);
    expect(calls(params.git.discardAll).map(([repo]) => repo)).toEqual(['/repo/b', '/repo/c']);
  });
});
