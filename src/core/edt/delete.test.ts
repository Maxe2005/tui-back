// core/edt/delete: unit tests against fake ports — active-EDT rejection, per-member
// disposition (leave/delete, merged+clean -> -d vs. unmerged/dirty -> -D), cross-EDT
// branch-collision partial failure, and the lock-held registry-entry + SQLite-file removal.
import { describe, expect, it, vi, afterEach, type Mock } from 'vitest';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok, err } from '../result.js';
import type { EdtMember, EdtRegistryEntry, EdtRegistryPort, EdtStatus } from '../ports/edt-registry.js';
import type { GitPort } from '../ports/git.js';
import type { LockPort } from '../ports/lock.js';
import type { Manifest, ManifestPort } from '../ports/manifest.js';
import type { StatePort } from '../ports/state.js';
import { deleteEdt, defaultDispositionFor, resolveMemberDeleteStatuses, type DeleteEdtParams } from './delete.js';

function calls(fn: unknown): Array<unknown[]> {
  return (fn as unknown as Mock).mock.calls;
}

const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function tempEdtsBaseDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tui-back-edt-delete-'));
  tmpDirs.push(dir);
  return dir;
}

function manifestFor(repoPath: string): Manifest {
  const name = repoPath.split('/').pop();
  return {
    service: `svc-${name}`,
    container: `ctr-${name}`,
    migrationCommand: 'npm run migration:run',
    sharedBranch: 'development',
    modules: {},
  };
}

function fakeManifest(overrides: Partial<ManifestPort> = {}): ManifestPort {
  return {
    load: vi.fn(async (path: string) => ok(manifestFor(path))),
    ...overrides,
  };
}

function fakeEdtRegistry(overrides: Partial<EdtRegistryPort> = {}): EdtRegistryPort {
  return {
    add: vi.fn(async () => ok(undefined)),
    list: vi.fn(async () => ok([])),
    setStatus: vi.fn(async () => ok(undefined)),
    update: vi.fn(async () => ok(undefined)),
    remove: vi.fn(async () => ok(undefined)),
    ...overrides,
  };
}

function fakeLock(overrides: Partial<LockPort> = {}): LockPort {
  return {
    acquire: vi.fn(async () => ok({ release: vi.fn(async () => ok(undefined)) })),
    peek: vi.fn(async () => ok({ locked: false })),
    ...overrides,
  };
}

function fakeState(overrides: Partial<StatePort> = {}): StatePort {
  return {
    readActiveEdt: vi.fn(async () => ok(null)),
    writeActiveEdt: vi.fn(async () => ok(undefined)),
    readSplitterRatios: vi.fn(async () => ok(null)),
    writeSplitterRatios: vi.fn(async () => ok(undefined)),
    readFilterHistory: vi.fn(async () => ok(null)),
    writeFilterHistory: vi.fn(async () => ok(undefined)),
    readCommandHistory: vi.fn(async () => ok(null)),
    writeCommandHistory: vi.fn(async () => ok(undefined)),
    ...overrides,
  };
}

function fakeGit(overrides: Partial<GitPort> = {}): GitPort {
  return {
    assertAllowedBranch: vi.fn(async () => ok(undefined)),
    createBranch: vi.fn(async () => ok(undefined)),
    deleteBranch: vi.fn(async () => ok(undefined)),
    currentBranch: vi.fn(async () => ok('development')),
    aheadBehind: vi.fn(async () => ok({ ahead: 0, behind: 0 })),
    checkout: vi.fn(async () => ok(undefined)),
    hasUncommittedChanges: vi.fn(async () => ok(false)),
    stashSave: vi.fn(async () => ok(undefined)),
    restoreStash: vi.fn(async () => ok(undefined)),
    branchExistsLocally: vi.fn(async () => ok(true)),
    fetch: vi.fn(async () => ok(undefined)),
    listBranches: vi.fn(async () => ok([])),
    renameBranch: vi.fn(async () => ok(undefined)),
    listRemoteBranches: vi.fn(async () => ok([])),
    createTrackingBranch: vi.fn(async () => ok(undefined)),
    stagePaths: vi.fn(async () => ok(undefined)),
    commit: vi.fn(async () => ok(undefined)),
    isBranchMerged: vi.fn(async () => ok(true)),
    hasStash: vi.fn(async () => ok(false)),
    pull: vi.fn(async () => ok(undefined)),
    isMergeInProgress: vi.fn(async () => ok(false)),
    mergeBranch: vi.fn(async () => ok(undefined)),
    abortMerge: vi.fn(async () => ok(undefined)),
    listDirtyPaths: vi.fn(async () => ok([])),
    discardPaths: vi.fn(async () => ok(undefined)),
    discardAll: vi.fn(async () => ok(undefined)),
    diffNameOnly: vi.fn(async () => ok([])),
    headRevision: vi.fn(async () => ok('head-a')),
    diffStat: vi.fn(async () => ok({ files: 0, insertions: 0, deletions: 0 })),
    discardPathsToHead: vi.fn(async () => ok(undefined)),
    isRebaseInProgress: vi.fn(async () => ok(false)),
    hasUnmergedPaths: vi.fn(async () => ok(false)),
    finalizeMerge: vi.fn(async () => ok(undefined)),
    ...overrides,
  };
}

function member(service: string, repoPath: string, branch: string): EdtMember {
  return { service, repoPath, branch };
}

function edtEntry(ulid: string, topic: string, members: EdtMember[], status: EdtStatus = 'active'): EdtRegistryEntry {
  return { ulid, topic, createdAt: '2026-08-18T00:00:00.000Z', status, members };
}

async function makeParams(overrides: Partial<DeleteEdtParams> = {}): Promise<DeleteEdtParams> {
  return {
    edtRegistry: fakeEdtRegistry(),
    manifest: fakeManifest(),
    git: fakeGit(),
    lock: fakeLock(),
    state: fakeState(),
    edtRegistryResourceKey: '/cfg/edts.yaml',
    edtsBaseDir: await tempEdtsBaseDir(),
    topic: 'demo',
    ...overrides,
  };
}

const TARGET = edtEntry('target-ulid', 'demo', [member('svc-a', '/repo/a', 'feat/a'), member('svc-b', '/repo/b', 'feat/b')]);

describe('deleteEdt', () => {
  it('rejects a missing/empty topic before any read', async () => {
    const params = await makeParams({ topic: '   ' });

    const result = await deleteEdt(params);

    expect(result).toMatchObject({ ok: false, error: { code: 'missing-argument' } });
  });

  it('fails with edt-not-found for an unregistered topic', async () => {
    const params = await makeParams({ edtRegistry: fakeEdtRegistry({ list: vi.fn(async () => ok([])) }) });

    const result = await deleteEdt(params);

    expect(result).toMatchObject({ ok: false, error: { code: 'edt-not-found' } });
  });

  // Early-return branches.
  it('propagates an edtRegistry.list() failure, without ever reaching the active-EDT check', async () => {
    const state = fakeState({ readActiveEdt: vi.fn() });
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => err('edt-registry-invalid-format', 'bad shape')) });
    const params = await makeParams({ edtRegistry, state });

    const result = await deleteEdt(params);

    expect(result).toMatchObject({ ok: false, error: { code: 'edt-registry-invalid-format' } });
    expect(calls(state.readActiveEdt)).toHaveLength(0);
  });

  it('propagates a state.readActiveEdt() failure, without ever disposing of a member branch', async () => {
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET])) });
    const state = fakeState({ readActiveEdt: vi.fn(async () => err('state-read-error', 'corrupt state.json')) });
    const git = fakeGit();
    const params = await makeParams({ edtRegistry, state, git, dispositions: { '/repo/a': 'delete' } });

    const result = await deleteEdt(params);

    expect(result).toMatchObject({ ok: false, error: { code: 'state-read-error' } });
    expect(calls(git.deleteBranch)).toHaveLength(0);
    expect(calls(edtRegistry.remove)).toHaveLength(0);
  });

  // Deleting the active EDT -> rejected before any write, edt-delete-active-rejected.
  it('rejects deleting the active EDT before any git/registry write, never auto-switching', async () => {
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET])) });
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok('target-ulid')) });
    const git = fakeGit();
    const params = await makeParams({ edtRegistry, state, git });

    const result = await deleteEdt(params);

    expect(result).toMatchObject({ ok: false, error: { code: 'edt-delete-active-rejected' } });
    expect(calls(git.deleteBranch)).toHaveLength(0);
    expect(calls(edtRegistry.remove)).toHaveLength(0);
  });

  it('deletes only the registry entry and SQLite file when every member is left as-is (default)', async () => {
    const edtsBaseDir = await tempEdtsBaseDir();
    mkdirSync(join(edtsBaseDir, TARGET.ulid), { recursive: true });
    writeFileSync(join(edtsBaseDir, `${TARGET.ulid}.db`), '');
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET])) });
    const git = fakeGit();
    const params = await makeParams({ edtRegistry, git, edtsBaseDir });

    const result = await deleteEdt(params);

    expect(result).toMatchObject({
      ok: true,
      data: {
        ulid: 'target-ulid',
        topic: 'demo',
        results: [
          { service: 'svc-a', outcome: 'left' },
          { service: 'svc-b', outcome: 'left' },
        ],
      },
    });
    expect(calls(git.deleteBranch)).toHaveLength(0);
    expect(calls(edtRegistry.remove)).toEqual([['target-ulid']]);
    expect(existsSync(join(edtsBaseDir, TARGET.ulid))).toBe(false);
    expect(existsSync(join(edtsBaseDir, `${TARGET.ulid}.db`))).toBe(false);
  });

  // Non-active EDT, member merged+clean -> git branch -d.
  it('deletes a merged+clean member branch via -d (force: false)', async () => {
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET])) });
    const git = fakeGit({ isBranchMerged: vi.fn(async () => ok(true)), hasUncommittedChanges: vi.fn(async () => ok(false)) });
    const params = await makeParams({ edtRegistry, git, dispositions: { '/repo/a': 'delete' } });

    const result = await deleteEdt(params);

    expect(result).toMatchObject({
      ok: true,
      data: { results: expect.arrayContaining([{ service: 'svc-a', outcome: 'deleted' }]) },
    });
    expect(calls(git.deleteBranch)).toContainEqual(['/repo/a', 'feat/a', false]);
  });

  // A member's branch may already be gone (deleted manually outside the tool) — isBranchMerged
  // would error on a non-existent ref; deleteMemberBranch must short-circuit to 'deleted'
  // instead of reporting a spurious failure.
  it('treats an already-gone member branch as already deleted, never calling isBranchMerged', async () => {
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET])) });
    const git = fakeGit({ branchExistsLocally: vi.fn(async () => ok(false)), isBranchMerged: vi.fn() });
    const params = await makeParams({ edtRegistry, git, dispositions: { '/repo/a': 'delete' } });

    const result = await deleteEdt(params);

    expect(result).toMatchObject({
      ok: true,
      data: { results: expect.arrayContaining([{ service: 'svc-a', outcome: 'deleted' }]) },
    });
    expect(calls(git.isBranchMerged)).toHaveLength(0);
    expect(calls(git.deleteBranch)).toHaveLength(0);
  });

  it('propagates a branchExistsLocally failure as a failed row', async () => {
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET])) });
    const git = fakeGit({ branchExistsLocally: vi.fn(async () => err('git-branch-check-error', 'nope')) });
    const params = await makeParams({ edtRegistry, git, dispositions: { '/repo/a': 'delete' } });

    const result = await deleteEdt(params);

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: expect.arrayContaining([
          expect.objectContaining({ service: 'svc-a', outcome: 'failed', detail: expect.objectContaining({ code: 'git-branch-check-error' }) }),
        ]),
      },
    });
  });

  // manifest.load() failing inside deleteMemberBranch itself.
  it("propagates a deleteMemberBranch manifest.load() failure as a failed row", async () => {
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET])) });
    const manifest = fakeManifest({ load: vi.fn(async () => err('manifest-not-found', 'no manifest')) });
    const git = fakeGit();
    const params = await makeParams({ edtRegistry, manifest, git, dispositions: { '/repo/a': 'delete' } });

    const result = await deleteEdt(params);

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: expect.arrayContaining([
          expect.objectContaining({ service: 'svc-a', outcome: 'failed', detail: expect.objectContaining({ code: 'manifest-not-found' }) }),
        ]),
      },
    });
    expect(calls(git.deleteBranch)).toHaveLength(0);
  });

  // dispositions' keys must be resolve()'d before comparing against member.repoPath.
  it('matches a disposition key against a member even when the two repoPath spellings differ (trailing slash)', async () => {
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET])) });
    const git = fakeGit();
    const params = await makeParams({ edtRegistry, git, dispositions: { '/repo/a/': 'delete' } });

    const result = await deleteEdt(params);

    expect(result).toMatchObject({
      ok: true,
      data: { results: expect.arrayContaining([{ service: 'svc-a', outcome: 'deleted' }]) },
    });
    expect(calls(git.deleteBranch)).toContainEqual(['/repo/a', 'feat/a', false]);
  });

  // Non-active EDT, member unmerged/dirty -> git branch -D (force).
  it('force-deletes an unmerged member branch via -D (force: true)', async () => {
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET])) });
    const git = fakeGit({ isBranchMerged: vi.fn(async () => ok(false)) });
    const params = await makeParams({ edtRegistry, git, dispositions: { '/repo/a': 'delete' } });

    await deleteEdt(params);

    expect(calls(git.deleteBranch)).toContainEqual(['/repo/a', 'feat/a', true]);
  });

  // Clean detection, case 2: repoPath's currently checked-out branch equals member.branch AND
  // hasUncommittedChanges is true -> genuinely this member's own dirty working tree (e.g. a
  // single-repo setup) -> force-delete via -D even though merged.
  it("force-deletes a merged branch via -D when the member's own branch is currently checked out and dirty", async () => {
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET])) });
    const git = fakeGit({
      isBranchMerged: vi.fn(async () => ok(true)),
      currentBranch: vi.fn(async () => ok('feat/a')),
      hasUncommittedChanges: vi.fn(async () => ok(true)),
    });
    const params = await makeParams({ edtRegistry, git, dispositions: { '/repo/a': 'delete' } });

    await deleteEdt(params);

    expect(calls(git.deleteBranch)).toContainEqual(['/repo/a', 'feat/a', true]);
  });

  // Clean detection, case 1: a stash tagged `tui-back:<edtUlid>` exists in repoPath (this
  // EDT's own ulid, the tag switch.ts writes switching *away* from it) -> treated as dirty
  // regardless of what (if anything) is currently checked out there -> force-delete via -D
  // even though merged.
  it('force-deletes a merged branch via -D when a tui-back:<edtUlid>-tagged stash exists, even with nothing matching checked out', async () => {
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET])) });
    const git = fakeGit({
      isBranchMerged: vi.fn(async () => ok(true)),
      currentBranch: vi.fn(async () => ok('development')),
      hasStash: vi.fn(async (repoPath: string, tag: string) => ok(repoPath === '/repo/a' && tag === 'tui-back:target-ulid')),
    });
    const params = await makeParams({ edtRegistry, git, dispositions: { '/repo/a': 'delete' } });

    await deleteEdt(params);

    expect(calls(git.deleteBranch)).toContainEqual(['/repo/a', 'feat/a', true]);
  });

  // Neither signal holds (not checked out, no matching stash) -> clean -> delete via -d even
  // though the repo is dirty by some *other* EDT's working-tree state.
  it("deletes a merged branch via -d when the member isn't checked out and has no matching stash, regardless of the repo's current working-tree state", async () => {
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET])) });
    const git = fakeGit({
      isBranchMerged: vi.fn(async () => ok(true)),
      currentBranch: vi.fn(async () => ok('some-other-edts-branch')),
      hasUncommittedChanges: vi.fn(async () => ok(true)), // some *other* EDT's own dirt
      hasStash: vi.fn(async () => ok(false)),
    });
    const params = await makeParams({ edtRegistry, git, dispositions: { '/repo/a': 'delete' } });

    await deleteEdt(params);

    expect(calls(git.deleteBranch)).toContainEqual(['/repo/a', 'feat/a', false]);
  });

  // A branch chosen for deletion but owned by another EDT -> refused per-branch,
  // record still deleted, other members' deletions proceed.
  it('reports branch-owned-by-other-edt for one member without blocking the others or the record removal', async () => {
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET])) });
    const git = fakeGit({
      assertAllowedBranch: vi.fn(async (repoPath: string) =>
        repoPath === '/repo/a'
          ? err('branch-owned-by-other-edt', 'Branch "feat/a" is already registered as a different EDT\'s own branch')
          : ok(undefined),
      ),
    });
    const params = await makeParams({ edtRegistry, git, dispositions: { '/repo/a': 'delete', '/repo/b': 'delete' } });

    const result = await deleteEdt(params);

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'failed', detail: { code: 'branch-owned-by-other-edt' } },
          { service: 'svc-b', outcome: 'deleted' },
        ],
      },
    });
    // The record is still removed even though one member's branch deletion failed.
    expect(calls(edtRegistry.remove)).toEqual([['target-ulid']]);
    // Only the allowed member's branch was actually deleted.
    expect(calls(git.deleteBranch)).toEqual([['/repo/b', 'feat/b', false]]);
  });

  it('leaves a member branch untouched when its disposition is explicitly "leave"', async () => {
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET])) });
    const git = fakeGit();
    const params = await makeParams({ edtRegistry, git, dispositions: { '/repo/a': 'leave', '/repo/b': 'delete' } });

    const result = await deleteEdt(params);

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'left' },
          { service: 'svc-b', outcome: 'deleted' },
        ],
      },
    });
    expect(calls(git.deleteBranch)).toEqual([['/repo/b', 'feat/b', false]]);
  });

  it('propagates a deleteBranch git failure as a failed row without blocking the registry removal', async () => {
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET])) });
    const git = fakeGit({ deleteBranch: vi.fn(async () => err('git-delete-branch-error', 'nope')) });
    const params = await makeParams({ edtRegistry, git, dispositions: { '/repo/a': 'delete' } });

    const result = await deleteEdt(params);

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: expect.arrayContaining([
          expect.objectContaining({ service: 'svc-a', outcome: 'failed', detail: expect.objectContaining({ code: 'git-delete-branch-error' }) }),
        ]),
      },
    });
    expect(calls(edtRegistry.remove)).toEqual([['target-ulid']]);
  });

  it('propagates a registry.remove() failure', async () => {
    const edtRegistry = fakeEdtRegistry({
      list: vi.fn(async () => ok([TARGET])),
      remove: vi.fn(async () => err('edt-registry-write-error', 'disk full')),
    });
    const params = await makeParams({ edtRegistry });

    const result = await deleteEdt(params);

    expect(result).toMatchObject({ ok: false, error: { code: 'edt-registry-write-error' } });
  });

  // A registry.remove() failure must still report the already-computed results: branch
  // deletions run outside the lock, before the registry write (AD-9).
  it('attaches the already-computed per-member results as error.details.partialResults when registry.remove() fails', async () => {
    const edtRegistry = fakeEdtRegistry({
      list: vi.fn(async () => ok([TARGET])),
      remove: vi.fn(async () => err('edt-registry-write-error', 'disk full')),
    });
    const git = fakeGit();
    const params = await makeParams({ edtRegistry, git, dispositions: { '/repo/a': 'delete', '/repo/b': 'leave' } });

    const result = await deleteEdt(params);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'edt-registry-write-error',
        details: {
          partialResults: [
            { service: 'svc-a', outcome: 'deleted' },
            { service: 'svc-b', outcome: 'left' },
          ],
        },
      },
    });
    // The branch deletion this partialResults entry reports did in fact already happen.
    expect(calls(git.deleteBranch)).toContainEqual(['/repo/a', 'feat/a', false]);
  });

  it('holds the per-resource lock only around the registry-entry removal, not the per-repo branch deletions', async () => {
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET])) });
    const git = fakeGit();
    const acquireOrder: string[] = [];
    const lock = fakeLock({
      acquire: vi.fn(async () => {
        acquireOrder.push('acquire');
        return ok({ release: vi.fn(async () => ok(undefined)) });
      }),
    });
    git.deleteBranch = vi.fn(async () => {
      acquireOrder.push('deleteBranch');
      return ok(undefined);
    });
    const params = await makeParams({ edtRegistry, git, lock, dispositions: { '/repo/a': 'delete', '/repo/b': 'delete' } });

    await deleteEdt(params);

    // Both branch deletions ran before the lock was ever acquired.
    expect(acquireOrder).toEqual(['deleteBranch', 'deleteBranch', 'acquire']);
  });
});

describe('defaultDispositionFor', () => {
  it('defaults to delete only when both merged and clean', () => {
    expect(defaultDispositionFor({ merged: true, clean: true })).toBe('delete');
  });

  it('defaults to leave when merged but not clean', () => {
    expect(defaultDispositionFor({ merged: true, clean: false })).toBe('leave');
  });

  it('defaults to leave when clean but not merged', () => {
    expect(defaultDispositionFor({ merged: false, clean: true })).toBe('leave');
  });

  it('defaults to leave when a status read failed, regardless of merged/clean', () => {
    expect(defaultDispositionFor({ merged: true, clean: true, statusError: 'boom' })).toBe('leave');
  });
});

describe('resolveMemberDeleteStatuses', () => {
  it('computes merged/clean per member via the manifest-declared sharedBranch and each member\'s own tui-back:<edtUlid> stash', async () => {
    const manifest = fakeManifest();
    const git = fakeGit({
      isBranchMerged: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a')),
      hasStash: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/b')),
    });

    const result = await resolveMemberDeleteStatuses(git, manifest, TARGET.ulid, TARGET.members);

    expect(result).toEqual([
      { repoPath: '/repo/a', service: 'svc-a', branch: 'feat/a', merged: true, clean: true },
      { repoPath: '/repo/b', service: 'svc-b', branch: 'feat/b', merged: false, clean: false },
    ]);
    expect(calls(git.isBranchMerged)).toContainEqual(['/repo/a', 'feat/a', 'development']);
    expect(calls(git.hasStash)).toContainEqual(['/repo/a', 'tui-back:target-ulid']);
  });

  it('surfaces a statusError and defaults merged/clean to false when the manifest fails to load', async () => {
    const manifest = fakeManifest({ load: vi.fn(async () => err('manifest-not-found', 'no manifest')) });
    const git = fakeGit();

    const result = await resolveMemberDeleteStatuses(git, manifest, TARGET.ulid, [member('svc-a', '/repo/a', 'feat/a')]);

    expect(result).toEqual([
      { repoPath: '/repo/a', service: 'svc-a', branch: 'feat/a', merged: false, clean: false, statusError: 'no manifest' },
    ]);
  });

  it('surfaces a statusError when isBranchMerged fails, without throwing', async () => {
    const manifest = fakeManifest();
    const git = fakeGit({ isBranchMerged: vi.fn(async () => err('git-merge-base-error', 'bad ref')) });

    const result = await resolveMemberDeleteStatuses(git, manifest, TARGET.ulid, [member('svc-a', '/repo/a', 'feat/a')]);

    expect(result).toEqual([
      { repoPath: '/repo/a', service: 'svc-a', branch: 'feat/a', merged: false, clean: true, statusError: 'bad ref' },
    ]);
  });

  // The clean-detection algorithm's three cases, spelled out against the `clean` field the
  // delete-confirm dialog renders.
  describe('clean-detection', () => {
    it('a member with a tui-back:<edtUlid>-tagged stash and nothing checked out is treated as dirty', async () => {
      const manifest = fakeManifest();
      const git = fakeGit({
        currentBranch: vi.fn(async () => ok('development')), // nothing checked out matches feat/a
        hasUncommittedChanges: vi.fn(async () => ok(false)),
        hasStash: vi.fn(async (repoPath: string, tag: string) => ok(repoPath === '/repo/a' && tag === 'tui-back:target-ulid')),
      });

      const result = await resolveMemberDeleteStatuses(git, manifest, TARGET.ulid, [member('svc-a', '/repo/a', 'feat/a')]);

      expect(result).toEqual([{ repoPath: '/repo/a', service: 'svc-a', branch: 'feat/a', merged: true, clean: false }]);
    });

    it('a member not checked out and with no matching stash is treated as clean', async () => {
      const manifest = fakeManifest();
      const git = fakeGit({
        currentBranch: vi.fn(async () => ok('development')),
        hasStash: vi.fn(async () => ok(false)),
      });

      const result = await resolveMemberDeleteStatuses(git, manifest, TARGET.ulid, [member('svc-a', '/repo/a', 'feat/a')]);

      expect(result).toEqual([{ repoPath: '/repo/a', service: 'svc-a', branch: 'feat/a', merged: true, clean: true }]);
    });

    it("a member whose branch happens to be currently checked out and dirty is treated as dirty", async () => {
      const manifest = fakeManifest();
      const git = fakeGit({
        currentBranch: vi.fn(async () => ok('feat/a')),
        hasUncommittedChanges: vi.fn(async () => ok(true)),
        hasStash: vi.fn(async () => ok(false)),
      });

      const result = await resolveMemberDeleteStatuses(git, manifest, TARGET.ulid, [member('svc-a', '/repo/a', 'feat/a')]);

      expect(result).toEqual([{ repoPath: '/repo/a', service: 'svc-a', branch: 'feat/a', merged: true, clean: false }]);
    });
  });
});
