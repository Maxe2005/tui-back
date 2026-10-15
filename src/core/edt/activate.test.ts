// core/edt/activate: unit tests against fake ports — clean first activation, harmless dirt,
// at-risk pause with zero checkouts, retry, confirmed overwrite (and a new at-risk path
// re-blocking), per-repo failure isolation, and the refusal when an active EDT already exists.
import { describe, expect, it, vi, type Mock } from 'vitest';
import { err, ok } from '../result.js';
import type { EdtMember, EdtRegistryEntry, EdtRegistryPort } from '../ports/edt-registry.js';
import type { GitPort } from '../ports/git.js';
import type { LockPort } from '../ports/lock.js';
import type { ManifestPort } from '../ports/manifest.js';
import type { RegistryPort } from '../ports/registry.js';
import type { StatePort } from '../ports/state.js';
import { activateEdt, type ActivateEdtParams } from './activate.js';

function calls(fn: unknown): Array<unknown[]> {
  return (fn as unknown as Mock).mock.calls;
}

function fakeManifest(): ManifestPort {
  return {
    load: vi.fn(async (path: string) =>
      ok({
        service: `svc-${path.split('/').pop()}`,
        container: 'c',
        migrationCommand: 'm',
        sharedBranch: 'development',
        modules: {},
      }),
    ),
  };
}

function fakeRegistry(paths: string[]): RegistryPort {
  return {
    list: vi.fn(async () => ok(paths)),
    add: vi.fn(async () => ok(undefined)),
    exists: vi.fn(async () => ok(true)),
    scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
    reset: vi.fn(async () => ok({ path: '/x', backupPath: null })),
    remove: vi.fn(async () => ok(undefined)),
  };
}

function fakeEdtRegistry(entries: EdtRegistryEntry[], overrides: Partial<EdtRegistryPort> = {}): EdtRegistryPort {
  return {
    add: vi.fn(async () => ok(undefined)),
    list: vi.fn(async () => ok(entries)),
    setStatus: vi.fn(async () => ok(undefined)),
    update: vi.fn(async () => ok(undefined)),
    remove: vi.fn(async () => ok(undefined)),
    ...overrides,
  };
}

function fakeLock(): LockPort {
  return {
    acquire: vi.fn(async () => ok({ release: vi.fn(async () => ok(undefined)) })),
    peek: vi.fn(async () => ok({ locked: false })),
  };
}

function fakeState(active: string | null = null, overrides: Partial<StatePort> = {}): StatePort {
  return {
    readActiveEdt: vi.fn(async () => ok(active)),
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
    currentBranch: vi.fn(async () => ok('main')),
    aheadBehind: vi.fn(async () => ok({ ahead: 0, behind: 0 })),
    checkout: vi.fn(async () => ok(undefined)),
    hasUncommittedChanges: vi.fn(async () => ok(false)),
    stashSave: vi.fn(async () => ok(undefined)),
    restoreStash: vi.fn(async () => ok(undefined)),
    branchExistsLocally: vi.fn(async () => ok(true)),
    fetch: vi.fn(async () => ok(undefined)),
    pull: vi.fn(async () => ok(undefined)),
    mergeBranch: vi.fn(async () => ok(undefined)),
    abortMerge: vi.fn(async () => ok(undefined)),
    isMergeInProgress: vi.fn(async () => ok(false)),
    listDirtyPaths: vi.fn(async () => ok([])),
    discardPaths: vi.fn(async () => ok(undefined)),
    discardAll: vi.fn(async () => ok(undefined)),
    diffNameOnly: vi.fn(async () => ok([])),
    headRevision: vi.fn(async () => ok('head-a')),
    diffStat: vi.fn(async () => ok({ files: 0, insertions: 0, deletions: 0 })),
    discardPathsToHead: vi.fn(async () => ok(undefined)),
    isRebaseInProgress: vi.fn(async () => ok(false)),
    hasUnmergedPaths: vi.fn(async () => ok(false)),
    listUnmergedPaths: vi.fn(async () => ok([] as string[])),
    readWorktreeFile: vi.fn(async () => ok("")),
    writeResolvedFile: vi.fn(async () => ok(undefined)),
    checkoutSide: vi.fn(async () => ok(undefined)),
    finalizeMerge: vi.fn(async () => ok(undefined)),
    listBranches: vi.fn(async () => ok([])),
    renameBranch: vi.fn(async () => ok(undefined)),
    listRemoteBranches: vi.fn(async () => ok([])),
    createTrackingBranch: vi.fn(async () => ok(undefined)),
    stagePaths: vi.fn(async () => ok(undefined)),
    commit: vi.fn(async () => ok(undefined)),
    isBranchMerged: vi.fn(async () => ok(true)),
    hasStash: vi.fn(async () => ok(false)),
    fetchRemote: vi.fn(async () => ok(undefined)),
    listUnpushedCommits: vi.fn(async () => ok([] as string[])),
    listVersionBumpCommits: vi.fn(async () => ok({ endedBy: "exhausted" as const, scanned: 0 })),
    listBranchesContaining: vi.fn(async () => ok([] as string[])),
    ...overrides,
  };
}

function member(service: string, repoPath: string, branch: string): EdtMember {
  return { service, repoPath, branch };
}

const NEW_EDT: EdtRegistryEntry = {
  ulid: 'new-ulid',
  topic: 'new-topic',
  createdAt: '2026-09-29T00:00:00.000Z',
  status: 'active',
  members: [member('svc-a', '/repo/a', 'feat/a')],
};
const REPOS = ['/repo/a', '/repo/b'];

function makeParams(overrides: Partial<ActivateEdtParams> = {}): ActivateEdtParams {
  return {
    edtRegistry: fakeEdtRegistry([NEW_EDT]),
    registry: fakeRegistry(REPOS),
    manifest: fakeManifest(),
    manifestCarry: { capture: async () => ({ ok: true, data: { kind: 'absent' } }), restore: async () => ({ ok: true, data: undefined }) },
    git: fakeGit(),
    lock: fakeLock(),
    state: fakeState(),
    edtRegistryResourceKey: '/cfg/edts.yaml',
    topic: 'new-topic',
    ...overrides,
  };
}

// `a.ts` is dirty in /repo/a and differs between main and feat/a.
function atRiskGit(overrides: Partial<GitPort> = {}): GitPort {
  return fakeGit({
    listDirtyPaths: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a' ? ['a.ts', 'notes.md'] : [])),
    diffNameOnly: vi.fn(async () => ok(['a.ts', 'other.ts'])),
    ...overrides,
  });
}

describe('activateEdt — refusals', () => {
  it('refuses with activate-has-outgoing when an EDT is already active, touching nothing', async () => {
    const git = fakeGit();
    const state = fakeState('old-ulid');

    const result = await activateEdt(makeParams({ git, state }));

    expect(result).toMatchObject({ ok: false, error: { code: 'activate-has-outgoing' } });
    expect(calls(git.checkout)).toHaveLength(0);
    expect(calls(git.fetch)).toHaveLength(0);
    expect(calls(state.writeActiveEdt)).toHaveLength(0);
  });

  it('fails edt-not-found for an unknown topic', async () => {
    expect(await activateEdt(makeParams({ topic: 'nope' }))).toMatchObject({ ok: false, error: { code: 'edt-not-found' } });
  });

  it('fails missing-argument for a blank topic', async () => {
    expect(await activateEdt(makeParams({ topic: '  ' }))).toMatchObject({ ok: false, error: { code: 'missing-argument' } });
  });
});

describe('activateEdt — clean first activation', () => {
  it('checks out members on their branch and non-members on their shared branch, then writes state + status', async () => {
    const git = fakeGit();
    const state = fakeState();
    const edtRegistry = fakeEdtRegistry([NEW_EDT]);

    const result = await activateEdt(makeParams({ git, state, edtRegistry }));

    expect(result).toEqual({
      ok: true,
      data: {
        status: 'activated',
        ulid: 'new-ulid',
        topic: 'new-topic',
        results: [
          { service: 'svc-a', outcome: 'switched' },
          { service: 'svc-b', outcome: 'switched' },
        ],
      },
    });
    expect(calls(git.assertAllowedBranch)).toEqual([['/repo/a', 'feat/a', 'new-ulid']]);
    expect(calls(git.checkout)).toEqual([
      ['/repo/a', 'feat/a'],
      ['/repo/b', 'development'],
    ]);
    expect(calls(state.writeActiveEdt)).toEqual([['new-ulid']]);
    expect(calls(edtRegistry.setStatus)).toEqual([['new-ulid', 'active']]);
    expect(calls(git.stashSave)).toHaveLength(0);
    expect(calls(git.discardAll)).toHaveLength(0);
  });

  it('fetches a missing shared branch during the pre-flight (FR-8)', async () => {
    const git = fakeGit({ branchExistsLocally: vi.fn(async (_repo: string, branch: string) => ok(branch !== 'development')) });

    await activateEdt(makeParams({ git }));

    expect(calls(git.fetch)).toEqual([['/repo/b', 'development']]);
  });

  it('skips the checkout of a repo already on its target', async () => {
    const git = fakeGit({ currentBranch: vi.fn(async () => ok('development')) });

    const result = await activateEdt(makeParams({ git }));

    expect(result.ok && result.data.status).toBe('activated');
    expect(calls(git.checkout)).toEqual([['/repo/a', 'feat/a']]);
    // Only /repo/a is read by the pre-flight (b is already on its target); the bare read is the
    // manifest-carry check run just before its checkout.
    const preflightReads = calls(git.listDirtyPaths).filter((call) => call[1] !== undefined);
    expect(preflightReads.map((call) => call[0])).toEqual(['/repo/a']);
  });

  it('does not block on dirt that is not in the branch diff', async () => {
    const git = fakeGit({
      listDirtyPaths: vi.fn(async () => ok(['notes.md'])),
      diffNameOnly: vi.fn(async () => ok(['a.ts'])),
    });

    const result = await activateEdt(makeParams({ git }));

    expect(result.ok && result.data.status).toBe('activated');
    expect(calls(git.discardPathsToHead)).toHaveLength(0);
    expect(calls(git.diffNameOnly)[0]).toEqual(['/repo/a', 'main', 'feat/a']);
  });

  it('diffs from HEAD when the current branch is unreadable', async () => {
    const git = fakeGit({
      currentBranch: vi.fn(async () => err('git-current-branch-error', 'detached')),
      listDirtyPaths: vi.fn(async () => ok(['x'])),
    });

    await activateEdt(makeParams({ git }));

    expect(calls(git.diffNameOnly)[0]).toEqual(['/repo/a', 'HEAD', 'feat/a']);
  });
});

describe('activateEdt — at-risk files', () => {
  it('returns blocked with the exact file list and runs zero checkouts or writes', async () => {
    const git = atRiskGit();
    const state = fakeState();

    const result = await activateEdt(makeParams({ git, state }));

    expect(result).toEqual({
      ok: true,
      data: { status: 'blocked', blocked: [{ service: 'svc-a', repoPath: '/repo/a', paths: ['a.ts'] }] },
    });
    expect(calls(git.checkout)).toHaveLength(0);
    expect(calls(git.discardPathsToHead)).toHaveLength(0);
    expect(calls(state.writeActiveEdt)).toHaveLength(0);
  });

  it('proceeds on a retry once the files were fixed by hand', async () => {
    const dirty = vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a' ? ['a.ts'] : []));
    const git = atRiskGit({ listDirtyPaths: dirty });
    expect((await activateEdt(makeParams({ git }))).ok).toBe(true);

    dirty.mockImplementation(async () => ok([]));
    const retried = await activateEdt(makeParams({ git }));

    expect(retried.ok && retried.data.status).toBe('activated');
    expect(calls(git.checkout)).toHaveLength(2);
  });

  it('discards exactly the confirmed at-risk paths, then checks out', async () => {
    const git = atRiskGit();

    const result = await activateEdt(makeParams({ git, overwrite: { '/repo/a': ['a.ts'] } }));

    expect(result.ok && result.data.status).toBe('activated');
    expect(calls(git.discardPathsToHead)).toEqual([['/repo/a', ['a.ts']]]);
    expect(calls(git.checkout)).toHaveLength(2);
    expect(result.ok && result.data.status === 'activated' && result.data.results[0]).toMatchObject({
      service: 'svc-a',
      outcome: 'discarded',
      detail: { discardedPaths: ['a.ts'] },
    });
  });

  it('blocks again, writing nothing, when a fresh at-risk path is outside the confirmed set', async () => {
    const git = atRiskGit({ listDirtyPaths: vi.fn(async () => ok(['a.ts', 'other.ts'])) });
    const state = fakeState();

    const result = await activateEdt(makeParams({ git, state, overwrite: { '/repo/a': ['a.ts'] } }));

    expect(result).toMatchObject({ ok: true, data: { status: 'blocked' } });
    expect(result.ok && result.data.status === 'blocked' && result.data.blocked[0]?.paths).toEqual(['a.ts', 'other.ts']);
    expect(calls(git.discardPathsToHead)).toHaveLength(0);
    expect(calls(git.checkout)).toHaveLength(0);
    expect(calls(state.writeActiveEdt)).toHaveLength(0);
  });
});

describe('activateEdt — per-repo isolation', () => {
  it('reports a failed checkout without blocking the others, and still sets the active pointer', async () => {
    const git = fakeGit({
      checkout: vi.fn(async (repoPath: string) => (repoPath === '/repo/b' ? err('git-checkout-error', 'boom') : ok(undefined))),
    });
    const state = fakeState();

    const result = await activateEdt(makeParams({ git, state }));

    expect(result.ok && result.data.status === 'activated' && result.data.results).toEqual([
      { service: 'svc-a', outcome: 'switched' },
      { service: 'svc-b', outcome: 'failed', detail: { code: 'git-checkout-error', message: 'boom' } },
    ]);
    expect(calls(state.writeActiveEdt)).toEqual([['new-ulid']]);
  });

  it('reports a pre-flight failure (missing member branch) as failed, never checking that repo out', async () => {
    const git = fakeGit({ branchExistsLocally: vi.fn(async (_repo: string, branch: string) => ok(branch !== 'feat/a')) });

    const result = await activateEdt(makeParams({ git }));

    expect(result.ok && result.data.status === 'activated' && result.data.results[0]).toMatchObject({
      service: 'svc-a',
      outcome: 'failed',
      detail: { code: 'member-branch-missing' },
    });
    expect(calls(git.checkout)).toEqual([['/repo/b', 'development']]);
  });

  it('reports a member missing from the managed-repo registry', async () => {
    const result = await activateEdt(makeParams({ registry: fakeRegistry(['/repo/b']) }));

    expect(result.ok && result.data.status === 'activated' && result.data.results).toContainEqual(
      expect.objectContaining({ service: 'svc-a', outcome: 'failed', detail: expect.objectContaining({ code: 'repo-not-registered' }) }),
    );
  });

  it('surfaces a state write failure with the per-repo results', async () => {
    const state = fakeState(null, { writeActiveEdt: vi.fn(async () => err('state-write-error', 'disk full')) });

    const result = await activateEdt(makeParams({ state }));

    expect(result).toMatchObject({ ok: false, error: { code: 'state-write-error', details: { results: expect.any(Array) } } });
  });

  it('reports a setStatus failure as an edt-registry:activate-target row, the pointer still written', async () => {
    const edtRegistry = fakeEdtRegistry([NEW_EDT], { setStatus: vi.fn(async () => err('edt-registry-write-error', 'readonly')) });
    const state = fakeState();

    const result = await activateEdt(makeParams({ edtRegistry, state }));

    expect(result.ok && result.data.status === 'activated' && result.data.results).toContainEqual({
      service: 'edt-registry:activate-target',
      outcome: 'failed',
      detail: { code: 'edt-registry-write-error', message: 'readonly' },
    });
    expect(calls(state.writeActiveEdt)).toEqual([['new-ulid']]);
  });

  it('refuses, keeping the other pointer, when another EDT became active during the checkouts', async () => {
    const readActiveEdt = vi.fn(async () => ok<string | null>(null));
    readActiveEdt.mockImplementationOnce(async () => ok(null)).mockImplementationOnce(async () => ok('winner-ulid'));
    const state = fakeState(null, { readActiveEdt });
    const edtRegistry = fakeEdtRegistry([NEW_EDT]);

    const result = await activateEdt(makeParams({ state, edtRegistry }));

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'activate-has-outgoing', details: { results: [expect.objectContaining({ service: 'svc-a', outcome: 'switched' }), expect.anything()] } },
    });
    expect(calls(state.writeActiveEdt)).toHaveLength(0);
    expect(calls(edtRegistry.setStatus)).toHaveLength(0);
  });
});

describe('activateEdt — dirty .tui-back.yaml', () => {
  it('never counts the manifest as at risk and carries it across the checkout', async () => {
    const dirty = vi.fn(async (_repoPath: string, opts?: { excludePaths?: string[] }) =>
      ok(opts?.excludePaths?.includes('.tui-back.yaml') === true ? [] : ['.tui-back.yaml']),
    );
    const git = atRiskGit({ listDirtyPaths: dirty, diffNameOnly: vi.fn(async () => ok(['.tui-back.yaml'])) });
    const manifestCarry = {
      capture: vi.fn(async () => ok({ kind: 'absent' } as const)),
      restore: vi.fn(async () => ok(undefined)),
    };

    const result = await activateEdt(makeParams({ git, manifestCarry }));

    expect(result.ok && result.data.status).toBe('activated');
    expect(calls(manifestCarry.capture)).toEqual([['/repo/a'], ['/repo/b']]);
    expect(calls(git.discardPathsToHead)).toEqual([['/repo/a', ['.tui-back.yaml']], ['/repo/b', ['.tui-back.yaml']]]);
    expect(calls(manifestCarry.restore)).toHaveLength(2);
  });
});
