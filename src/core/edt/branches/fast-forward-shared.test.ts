import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '../../result.js';
import type { GitPort } from '../../ports/vcs/git.js';
import type { EdtRegistryEntry, EdtRegistryPort } from '../../ports/storage/edt-registry.js';
import { anyFastForwardFailed, fastForwardShared } from './fast-forward-shared.js';
import { buildSharedBranchesEdt } from '../shared-edt/shared-edt.js';

const system = buildSharedBranchesEdt([
  { repoPath: '/r/a', manifest: { service: 'a', sharedBranch: 'development' } },
  { repoPath: '/r/b', manifest: { service: 'b', sharedBranch: 'main' } },
]);
const registryOf = (entries: EdtRegistryEntry[]): EdtRegistryPort => ({ list: async () => ok(entries) }) as unknown as EdtRegistryPort;

// A git double where every forbidden method throws.
function fakeGit(overrides: Partial<Record<keyof GitPort, unknown>> = {}) {
  const forbidden = ['checkout', 'stashSave', 'restoreStash', 'mergeBranch', 'createBranch', 'deleteBranch', 'commit', 'discardAll'];
  const base: Record<string, unknown> = {
    branchExistsLocally: vi.fn(async () => ok(true)),
    fetchRemote: vi.fn(async () => ok(undefined)),
    listUnpushedCommits: vi.fn(async () => ok([])),
    isBranchMerged: vi.fn(async () => ok(false)),
    currentBranch: vi.fn(async () => ok('feat/x')),
    hasUncommittedChanges: vi.fn(async () => ok(false)),
    pull: vi.fn(async () => ok(undefined)),
    fetch: vi.fn(async () => ok(undefined)),
    ...overrides,
  };
  for (const name of forbidden) base[name] = vi.fn(async () => { throw new Error(`forbidden git call: ${name}`); });
  return base as unknown as GitPort & Record<string, ReturnType<typeof vi.fn>>;
}

const run = (git: GitPort, entries: EdtRegistryEntry[] = [system]) => fastForwardShared({ edtRegistry: registryOf(entries), git });
const outcomes = async (git: GitPort) => {
  const result = await run(git);
  if (!result.ok) throw new Error(result.error.code);
  return result.data.rows.map((row) => [row.service, row.outcome, row.reason]);
};

describe('fastForwardShared', () => {
  it('fast-forwards a behind, not-checked-out branch via fetch', async () => {
    const git = fakeGit();
    expect(await outcomes(git)).toEqual([['a', 'fast-forwarded', undefined], ['b', 'fast-forwarded', undefined]]);
    expect(git.fetch).toHaveBeenCalledWith('/r/a', 'development');
    expect(git.pull).not.toHaveBeenCalled();
  });

  it('pulls a clean checked-out branch', async () => {
    const git = fakeGit({ currentBranch: vi.fn(async (p: string) => ok(p === '/r/a' ? 'development' : 'other')) });
    expect(await outcomes(git)).toEqual([['a', 'fast-forwarded', undefined], ['b', 'fast-forwarded', undefined]]);
    expect(git.pull).toHaveBeenCalledTimes(1);
    expect(git.pull).toHaveBeenCalledWith('/r/a');
  });

  it('uses pull as the only update path of a checked-out branch (never fetch b:b, merge or checkout)', async () => {
    const git = fakeGit({ currentBranch: vi.fn(async () => ok('development')) });
    const only = buildSharedBranchesEdt([{ repoPath: '/r/a', manifest: { service: 'a', sharedBranch: 'development' } }]);
    await run(git, [only]);
    expect(git.pull).toHaveBeenCalledTimes(1);
    expect(git.fetch).not.toHaveBeenCalled();
    expect(git.mergeBranch).not.toHaveBeenCalled();
    expect(git.checkout).not.toHaveBeenCalled();
  });

  it('a failing pull is a failed row, never retried through another path', async () => {
    const git = fakeGit({ currentBranch: vi.fn(async () => ok('development')), pull: vi.fn(async () => err('git-pull-error', 'not ff')) });
    const only = buildSharedBranchesEdt([{ repoPath: '/r/a', manifest: { service: 'a', sharedBranch: 'development' } }]);
    expect(await run(git, [only])).toMatchObject({ ok: true, data: { rows: [{ outcome: 'failed', detail: 'not ff' }] } });
    expect(git.fetch).not.toHaveBeenCalled();
  });

  it('skips a dirty checked-out branch (never stashed)', async () => {
    const git = fakeGit({ currentBranch: vi.fn(async () => ok('development')), hasUncommittedChanges: vi.fn(async () => ok(true)) });
    const result = await run(git, [buildSharedBranchesEdt([{ repoPath: '/r/a', manifest: { service: 'a', sharedBranch: 'development' } }])]);
    expect(result).toMatchObject({ ok: true, data: { rows: [{ outcome: 'skipped', reason: 'dirty' }] } });
    expect(git.pull).not.toHaveBeenCalled();
  });

  it('skips a diverged branch', async () => {
    const git = fakeGit({ listUnpushedCommits: vi.fn(async () => ok(['abc1234 local work'])) });
    expect(await outcomes(git)).toEqual([['a', 'skipped', 'diverged'], ['b', 'skipped', 'diverged']]);
    expect(git.fetch).not.toHaveBeenCalled();
    expect(git.pull).not.toHaveBeenCalled();
  });

  it('reports up-to-date when origin has nothing new', async () => {
    const git = fakeGit({ isBranchMerged: vi.fn(async () => ok(true)) });
    expect(await outcomes(git)).toEqual([['a', 'up-to-date', undefined], ['b', 'up-to-date', undefined]]);
    expect(git.fetch).not.toHaveBeenCalled();
  });

  it('fetches an absent local branch into a new one', async () => {
    const git = fakeGit({ branchExistsLocally: vi.fn(async () => ok(false)) });
    expect(await outcomes(git)).toEqual([['a', 'fast-forwarded', undefined], ['b', 'fast-forwarded', undefined]]);
    expect(git.fetchRemote).not.toHaveBeenCalled();
  });

  it('marks only the unreachable service failed and continues', async () => {
    const git = fakeGit({
      fetchRemote: vi.fn(async (p: string) => (p === '/r/a' ? err('git-fetch-error', 'unreachable') : ok(undefined))),
    });
    const result = await run(git);
    expect(result).toMatchObject({
      ok: true,
      data: { rows: [{ service: 'a', outcome: 'failed', detail: 'unreachable' }, { service: 'b', outcome: 'fast-forwarded' }] },
    });
    if (result.ok) expect(anyFastForwardFailed(result.data.rows)).toBe(true);
  });

  it('refuses with edt-not-found when the system EDT is absent', async () => {
    const git = fakeGit();
    const user: EdtRegistryEntry = { ulid: '01USER', topic: 'mine', createdAt: 'x', status: 'inactive', members: [] };
    expect(await run(git, [user])).toMatchObject({ ok: false, error: { code: 'edt-not-found' } });
    expect(git.fetchRemote).not.toHaveBeenCalled();
  });
});
