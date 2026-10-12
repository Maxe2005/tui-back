// core/edt/switch: unit tests against fake ports — target resolution, the no-op idempotency
// short-circuit, the outgoing-lock peek/--force gate, the target-driven destination, stash-tag
// symmetry, per-repo failure isolation, the three-state classification against the OUTGOING
// EDT, the zero-write pre-flight, the resolution seam, and the adopt/discard resolutions.
import { describe, expect, it, vi, type Mock } from 'vitest';
import { ok, err } from '../result.js';
import type { EdtMember, EdtRegistryEntry, EdtRegistryPort, EdtStatus } from '../ports/edt-registry.js';
import type { GitPort } from '../ports/git.js';
import type { LockPort } from '../ports/lock.js';
import type { Manifest, ManifestPort } from '../ports/manifest.js';
import type { ManifestCarryPort } from '../ports/manifest-carry.js';
import type { RegistryPort } from '../ports/registry.js';
import type { StatePort } from '../ports/state.js';
import { classifySwitchRepos, switchActiveEdt, type SwitchActiveEdtParams } from './switch.js';

function calls(fn: unknown): Array<unknown[]> {
  return (fn as unknown as Mock).mock.calls;
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

function fakeManifestCarry(overrides: Partial<ManifestCarryPort> = {}): ManifestCarryPort {
  return {
    capture: vi.fn(async () => ok({ kind: 'absent' } as const)),
    restore: vi.fn(async () => ok(undefined)),
    ...overrides,
  };
}

function fakeRegistry(paths: string[], overrides: Partial<RegistryPort> = {}): RegistryPort {
  return {
    list: vi.fn(async () => ok(paths)),
    add: vi.fn(async () => ok(undefined)),
    exists: vi.fn(async () => ok(true)),
    scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
    reset: vi.fn(async () => ok({ path: '/x', backupPath: null })),
    remove: vi.fn(async () => ok(undefined)),
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
    finalizeMerge: vi.fn(async () => ok(undefined)),
    listBranches: vi.fn(async () => ok([])),
    renameBranch: vi.fn(async () => ok(undefined)),
    listRemoteBranches: vi.fn(async () => ok([])),
    createTrackingBranch: vi.fn(async () => ok(undefined)),
    stagePaths: vi.fn(async () => ok(undefined)),
    commit: vi.fn(async () => ok(undefined)),
    isBranchMerged: vi.fn(async () => ok(true)),
    hasStash: vi.fn(async () => ok(false)),
    ...overrides,
  };
}

function member(service: string, repoPath: string, branch: string): EdtMember {
  return { service, repoPath, branch };
}

function edtEntry(ulid: string, topic: string, members: EdtMember[], status: EdtStatus = 'active'): EdtRegistryEntry {
  return { ulid, topic, createdAt: '2026-08-18T00:00:00.000Z', status, members };
}

const TARGET = edtEntry('target-ulid', 'target-topic', [member('svc-a', '/repo/a', 'feat/a')]);
const OUTGOING = edtEntry('outgoing-ulid', 'outgoing-topic', [member('svc-c', '/repo/c', 'feat/c')]);
const REPOS = ['/repo/a', '/repo/b', '/repo/c'];

function makeParams(overrides: Partial<SwitchActiveEdtParams> = {}): SwitchActiveEdtParams {
  return {
    edtRegistry: overrides.edtRegistry ?? fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET, OUTGOING])) }),
    registry: overrides.registry ?? fakeRegistry(REPOS),
    manifest: overrides.manifest ?? fakeManifest(),
    manifestCarry: overrides.manifestCarry ?? fakeManifestCarry(),
    git: overrides.git ?? fakeGit(),
    lock: overrides.lock ?? fakeLock(),
    state: overrides.state ?? fakeState({ readActiveEdt: vi.fn(async () => ok('outgoing-ulid')) }),
    edtRegistryResourceKey: overrides.edtRegistryResourceKey ?? '/cfg/edts.yaml',
    topic: overrides.topic ?? 'target-topic',
    force: overrides.force,
    dirtyResolutions: overrides.dirtyResolutions,
    onDirtyReposBeforeSwitch: overrides.onDirtyReposBeforeSwitch,
  };
}

describe('switchActiveEdt — validation before any write', () => {
  it('rejects a missing/blank topic with missing-argument before consulting the registry', async () => {
    const edtRegistry = fakeEdtRegistry();
    const params = makeParams({ topic: '   ', edtRegistry });

    const result = await switchActiveEdt(params);

    expect(result).toMatchObject({ ok: false, error: { code: 'missing-argument' } });
    expect(calls(edtRegistry.list)).toHaveLength(0);
  });

  it('fails with edt-not-found for an unregistered topic, touching no repo', async () => {
    const registry = fakeRegistry(REPOS);
    const params = makeParams({ topic: 'no-such-topic', registry });

    const result = await switchActiveEdt(params);

    expect(result).toMatchObject({ ok: false, error: { code: 'edt-not-found' } });
    expect(calls(registry.list)).toHaveLength(0);
  });

  it('propagates an edtRegistry.list() failure', async () => {
    const edtRegistry = fakeEdtRegistry({ list: async () => err('edt-registry-invalid-format', 'bad shape') });

    const result = await switchActiveEdt(makeParams({ edtRegistry }));

    expect(result).toMatchObject({ ok: false, error: { code: 'edt-registry-invalid-format' } });
  });

  it('propagates a state.readActiveEdt() failure', async () => {
    const state = fakeState({ readActiveEdt: async () => err('state-invalid-format', 'corrupt') });

    const result = await switchActiveEdt(makeParams({ state }));

    expect(result).toMatchObject({ ok: false, error: { code: 'state-invalid-format' } });
  });
});

describe('switchActiveEdt — already-active target (FR-1 idempotency)', () => {
  it('is a no-op success with zero git calls when the target is already active', async () => {
    const registry = fakeRegistry(REPOS);
    const git = fakeGit();
    const lock = fakeLock();
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok('target-ulid')) });
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET, OUTGOING])) });

    const result = await switchActiveEdt(makeParams({ registry, git, lock, state, edtRegistry }));

    expect(result).toEqual({
      ok: true,
      data: { ulid: 'target-ulid', topic: 'target-topic', results: [], wasInterrupted: false },
    });
    expect(calls(registry.list)).toHaveLength(0);
    expect(calls(lock.peek)).toHaveLength(0);
    expect(calls(git.checkout)).toHaveLength(0);
    expect(calls(git.hasUncommittedChanges)).toHaveLength(0);
    expect(calls(state.writeActiveEdt)).toHaveLength(0);
    expect(calls(edtRegistry.setStatus)).toHaveLength(0);
  });

  it('reports wasInterrupted true even on the already-active no-op, if the entry carries it', async () => {
    const interruptedTarget = edtEntry('target-ulid', 'target-topic', [], 'interrupted');
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([interruptedTarget])) });
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok('target-ulid')) });

    const result = await switchActiveEdt(makeParams({ edtRegistry, state }));

    expect(result).toMatchObject({ ok: true, data: { wasInterrupted: true, results: [] } });
  });
});

describe('switchActiveEdt — happy path (target member + non-members)', () => {
  it('auto-stashes a dirty outgoing member (state 1), checks out every repo correctly, and updates state + registry', async () => {
    const git = fakeGit({
      hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/c')),
    });
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok('outgoing-ulid')) });
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET, OUTGOING])) });

    const result = await switchActiveEdt(makeParams({ git, state, edtRegistry }));

    expect(result).toEqual({
      ok: true,
      data: {
        ulid: 'target-ulid',
        topic: 'target-topic',
        wasInterrupted: false,
        results: [
          { service: 'svc-a', outcome: 'switched' },
          { service: 'svc-b', outcome: 'switched' },
          { service: 'svc-c', outcome: 'switched' },
        ],
      },
    });

    // Target member: re-verified (cross-EDT gate) with the target's own ulid, checked into
    // its own branch, then its own (target-tagged) stash is looked up to pop back in.
    expect(calls(git.assertAllowedBranch)).toContainEqual(['/repo/a', 'feat/a', 'target-ulid']);
    expect(calls(git.checkout)).toContainEqual(['/repo/a', 'feat/a']);
    expect(calls(git.restoreStash)).toEqual([['/repo/a', 'tui-back:target-ulid']]);

    // c (state 1, not a target member): stashed under the OUTGOING tag for its return, landed
    // on its shared branch, and never popped here. b (clean non-member) likewise lands on the
    // shared branch.
    expect(calls(git.stashSave)).toEqual([['/repo/c', 'tui-back:outgoing-ulid']]);
    expect(calls(git.checkout)).toContainEqual(['/repo/b', 'development']);
    expect(calls(git.checkout)).toContainEqual(['/repo/c', 'development']);

    expect(calls(state.writeActiveEdt)).toEqual([['target-ulid']]);
    expect(calls(edtRegistry.setStatus)).toContainEqual(['target-ulid', 'active']);
    expect(calls(edtRegistry.setStatus)).toContainEqual(['outgoing-ulid', 'inactive']);
  });

  it('a dirty repo in both the outgoing EDT and the target: stash <out>, checkout own branch, pop <target>', async () => {
    const outgoing = edtEntry('outgoing-ulid', 'outgoing-topic', [member('svc-a', '/repo/a', 'feat/a-out'), member('svc-c', '/repo/c', 'feat/c')]);
    const git = fakeGit({ hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a')) });
    const onDirtyReposBeforeSwitch = vi.fn(async () => ({ kind: 'cancel' as const }));
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET, outgoing])) });

    const result = await switchActiveEdt(makeParams({ git, edtRegistry, onDirtyReposBeforeSwitch }));

    expect(result).toMatchObject({ ok: true });
    // Only state-1 repos dirty: the seam is never invoked.
    expect(calls(onDirtyReposBeforeSwitch)).toHaveLength(0);
    expect(calls(git.stashSave)).toEqual([['/repo/a', 'tui-back:outgoing-ulid']]);
    expect(calls(git.checkout)).toContainEqual(['/repo/a', 'feat/a']);
    expect(calls(git.restoreStash)).toEqual([['/repo/a', 'tui-back:target-ulid']]);
    const order = (fn: unknown) => (fn as Mock).mock.invocationCallOrder[0] as number;
    expect(order(git.stashSave)).toBeLessThan(order(git.checkout));
    expect(order(git.checkout)).toBeLessThan(order(git.restoreStash));
  });

  it('fetches a non-member repo\'s shared branch first when missing locally', async () => {
    const git = fakeGit({
      branchExistsLocally: vi.fn(async (repoPath: string) => ok(repoPath !== '/repo/b')),
    });

    const result = await switchActiveEdt(makeParams({ git }));

    expect(result.ok).toBe(true);
    expect(calls(git.fetch)).toEqual([['/repo/b', 'development']]);
    expect(calls(git.checkout)).toContainEqual(['/repo/b', 'development']);
  });

  it('never fetches a target member\'s own branch — a missing one just fails that repo', async () => {
    const git = fakeGit({
      checkout: vi.fn(async (repoPath: string, branch: string) =>
        repoPath === '/repo/a' ? err('git-checkout-error', 'branch missing') : ok(undefined),
      ),
    });

    const result = await switchActiveEdt(makeParams({ git }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toContainEqual({
        service: 'svc-a',
        outcome: 'failed',
        detail: { code: 'git-checkout-error', message: 'branch missing' },
      });
    }
    expect(calls(git.fetch)).toHaveLength(0);
    // A checkout failure never reaches the pop step for that repo, and non-members never pop.
    expect(calls(git.restoreStash)).toHaveLength(0);
    // state.json still gets written despite the per-repo failure (createEdt's philosophy).
  });
});

describe('switchActiveEdt — per-repo failure isolation', () => {
  it('one non-member\'s fetch failure is `failed`; others and state.json still succeed', async () => {
    const git = fakeGit({
      branchExistsLocally: vi.fn(async (repoPath: string) => ok(repoPath !== '/repo/b')),
      fetch: vi.fn(async () => err('git-fetch-error', 'no route to origin')),
    });
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok('outgoing-ulid')) });

    const result = await switchActiveEdt(makeParams({ git, state }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toContainEqual({
        service: 'svc-b',
        outcome: 'failed',
        detail: { code: 'git-fetch-error', message: 'no route to origin' },
      });
      expect(result.data.results).toContainEqual({ service: 'svc-a', outcome: 'switched' });
      expect(result.data.results).toContainEqual({ service: 'svc-c', outcome: 'switched' });
    }
    expect(calls(state.writeActiveEdt)).toEqual([['target-ulid']]);
  });

  it('a manifest load failure for a non-member repo is `failed`, service label falls back to repoPath', async () => {
    const manifest = fakeManifest({
      load: vi.fn(async (path: string) =>
        path === '/repo/b' ? err('manifest-not-found', 'no manifest') : ok(manifestFor(path)),
      ),
    });

    const result = await switchActiveEdt(makeParams({ manifest }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toContainEqual({
        service: '/repo/b',
        outcome: 'failed',
        detail: { code: 'manifest-not-found', message: 'no manifest' },
      });
    }
  });

  it('a cross-EDT gate rejection on a target member is `failed`, never thrown', async () => {
    const git = fakeGit({
      assertAllowedBranch: vi.fn(async (repoPath: string) =>
        repoPath === '/repo/a'
          ? err('branch-owned-by-other-edt', 'claimed elsewhere')
          : ok(undefined),
      ),
    });

    const result = await switchActiveEdt(makeParams({ git }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toContainEqual({
        service: 'svc-a',
        outcome: 'failed',
        detail: { code: 'branch-owned-by-other-edt', message: 'claimed elsewhere' },
      });
    }
    // Never stashed/checked out once the gate rejects it.
    expect(calls(git.checkout)).not.toContainEqual(['/repo/a', 'feat/a']);
  });
});

describe('switchActiveEdt — outgoing lock gate', () => {
  it('blocks before touching any repo when the outgoing EDT\'s lock is held, no --force', async () => {
    const lock = fakeLock({ peek: vi.fn(async () => ok({ locked: true })) });
    const registry = fakeRegistry(REPOS);
    const git = fakeGit();
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok('outgoing-ulid')) });
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET, OUTGOING])) });

    const result = await switchActiveEdt(makeParams({ lock, registry, git, state, edtRegistry }));

    expect(result).toMatchObject({ ok: false, error: { code: 'switch-blocked-action-in-progress' } });
    expect(calls(lock.peek)).toEqual([['edt:outgoing-ulid']]);
    expect(calls(registry.list)).toHaveLength(0);
    expect(calls(git.checkout)).toHaveLength(0);
    expect(calls(state.writeActiveEdt)).toHaveLength(0);
    expect(calls(edtRegistry.setStatus)).toHaveLength(0);
  });

  it('--force proceeds past a held lock and marks the outgoing EDT interrupted (never inactive)', async () => {
    const lock = fakeLock({ peek: vi.fn(async () => ok({ locked: true })) });
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET, OUTGOING])) });
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok('outgoing-ulid')) });

    const result = await switchActiveEdt(makeParams({ lock, edtRegistry, state, force: true }));

    expect(result.ok).toBe(true);
    expect(calls(edtRegistry.setStatus)).toContainEqual(['outgoing-ulid', 'interrupted']);
    expect(calls(edtRegistry.setStatus)).not.toContainEqual(['outgoing-ulid', 'inactive']);
    expect(calls(edtRegistry.setStatus)).toContainEqual(['target-ulid', 'active']);
  });

  it('a free lock proceeds normally regardless of --force, marking outgoing inactive', async () => {
    const lock = fakeLock({ peek: vi.fn(async () => ok({ locked: false })) });
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET, OUTGOING])) });
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok('outgoing-ulid')) });

    const result = await switchActiveEdt(makeParams({ lock, edtRegistry, state, force: true }));

    expect(result.ok).toBe(true);
    expect(calls(edtRegistry.setStatus)).toContainEqual(['outgoing-ulid', 'inactive']);
  });

  it('propagates a lock.peek() failure', async () => {
    const lock = fakeLock({ peek: async () => err('invalid-argument', 'bad key') });

    const result = await switchActiveEdt(makeParams({ lock }));

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
  });

  it('never peeks the lock when there is no outgoing EDT (first-ever switch)', async () => {
    const lock = fakeLock();
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok(null)) });
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET])) });

    const result = await switchActiveEdt(makeParams({ lock, state, edtRegistry }));

    expect(result.ok).toBe(true);
    expect(calls(lock.peek)).toHaveLength(0);
    // No outgoing to deactivate — setStatus is only called once, for the target.
    expect(calls(edtRegistry.setStatus)).toEqual([['target-ulid', 'active']]);
  });
});

describe('switchActiveEdt — interrupted-EDT return', () => {
  it('reports wasInterrupted true and resets the target back to active', async () => {
    const interruptedTarget = edtEntry(
      'target-ulid',
      'target-topic',
      [member('svc-a', '/repo/a', 'feat/a')],
      'interrupted',
    );
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([interruptedTarget, OUTGOING])) });
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok('outgoing-ulid')) });

    const result = await switchActiveEdt(makeParams({ edtRegistry, state }));

    expect(result).toMatchObject({ ok: true, data: { wasInterrupted: true } });
    expect(calls(edtRegistry.setStatus)).toContainEqual(['target-ulid', 'active']);
  });
});

describe('switchActiveEdt — first-ever switch (no outgoing)', () => {
  it('a dirty target member is state 2 there: it needs a resolution, never an auto-stash', async () => {
    const git = fakeGit({ hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a')) });
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok(null)) });
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET])) });

    const result = await switchActiveEdt(makeParams({ git, state, edtRegistry, registry: fakeRegistry(['/repo/a']) }));

    expect(result).toMatchObject({ ok: false, error: { code: 'switch-dirty-services-unresolved' } });
    expect(calls(git.stashSave)).toHaveLength(0);
    expect(calls(git.checkout)).toHaveLength(0);
  });

  it('rejects an adopt resolution with switch-adopt-without-outgoing, zero writes', async () => {
    const git = fakeGit({ hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/b')) });
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok(null)) });
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET])) });

    const result = await switchActiveEdt(
      makeParams({ git, state, edtRegistry, dirtyResolutions: { '/repo/b': { kind: 'adopt', branch: 'feat/b' } } }),
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'switch-adopt-without-outgoing' } });
    expectZeroWrites(git);
    expect(calls(state.writeActiveEdt)).toHaveLength(0);
    expect(calls(edtRegistry.update)).toHaveLength(0);
  });

  it('a discard resolution applies, and the target member still pops its own target-tagged stash', async () => {
    const git = fakeGit({
      hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a')),
      listDirtyPaths: vi.fn(async () => ok(['x.txt'])),
    });
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok(null)) });
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET])) });

    const result = await switchActiveEdt(
      makeParams({ git, state, edtRegistry, registry: fakeRegistry(['/repo/a']), dirtyResolutions: { '/repo/a': { kind: 'discard' } } }),
    );

    expect(result).toMatchObject({ ok: true, data: { results: [{ service: 'svc-a', outcome: 'discarded' }] } });
    expect(calls(git.stashSave)).toHaveLength(0);
    expect(calls(git.restoreStash)).toEqual([['/repo/a', 'tui-back:target-ulid']]);
  });
});

describe('switchActiveEdt — state.json write failure', () => {
  it('surfaces a writeActiveEdt failure as the overall result, keeping the per-repo results as error details', async () => {
    const state = fakeState({
      readActiveEdt: vi.fn(async () => ok('outgoing-ulid')),
      writeActiveEdt: vi.fn(async () => err('state-write-error', 'disk full')),
    });

    const result = await switchActiveEdt(makeParams({ state }));

    expect(result).toMatchObject({ ok: false, error: { code: 'state-write-error' } });
    if (!result.ok) {
      // The per-repo checkouts already ran by this point — their outcomes aren't discarded
      // just because the pointer write failed afterward.
      const details = result.error.details as { results: unknown[] };
      expect(details.results).toContainEqual({ service: 'svc-a', outcome: 'switched' });
      expect(details.results).toContainEqual({ service: 'svc-b', outcome: 'switched' });
      expect(details.results).toContainEqual({ service: 'svc-c', outcome: 'switched' });
    }
  });
});

describe('switchActiveEdt — edts.yaml write under lock (AD-9)', () => {
  it('writes the target/outgoing status flips inside the per-resource action lock', async () => {
    const lock = fakeLock();
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET, OUTGOING])) });

    const result = await switchActiveEdt(makeParams({ lock, edtRegistry, edtRegistryResourceKey: '/cfg/edts.yaml' }));

    expect(result).toMatchObject({ ok: true });
    expect(calls(lock.acquire)).toEqual([['/cfg/edts.yaml']]);
  });

  it('propagates a lock-acquire failure without writing state.json or the registry', async () => {
    const lock = fakeLock({ acquire: async () => err('action-in-progress', 'another switch is running') });
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok('outgoing-ulid')) });
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET, OUTGOING])) });

    const result = await switchActiveEdt(makeParams({ lock, state, edtRegistry }));

    expect(result).toMatchObject({ ok: false, error: { code: 'action-in-progress' } });
    expect(calls(state.writeActiveEdt)).toHaveLength(0);
    expect(calls(edtRegistry.setStatus)).toHaveLength(0);
  });
});

describe('switchActiveEdt — setStatus failure is surfaced, not swallowed', () => {
  it('reports a failed setStatus(target, active) as a `results` row while state.json still succeeded', async () => {
    const edtRegistry = fakeEdtRegistry({
      list: vi.fn(async () => ok([TARGET, OUTGOING])),
      setStatus: vi.fn(async (ulid: string) =>
        ulid === 'target-ulid' ? err('edt-registry-write-error', 'disk full') : ok(undefined),
      ),
    });
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok('outgoing-ulid')) });

    const result = await switchActiveEdt(makeParams({ edtRegistry, state }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toContainEqual({
        service: 'edt-registry:activate-target',
        outcome: 'failed',
        detail: { code: 'edt-registry-write-error', message: 'disk full' },
      });
    }
    // state.json was still written despite the registry-status failure.
    expect(calls(state.writeActiveEdt)).toEqual([['target-ulid']]);
  });

  it('reports a failed setStatus(outgoing, inactive) as a `results` row too', async () => {
    const edtRegistry = fakeEdtRegistry({
      list: vi.fn(async () => ok([TARGET, OUTGOING])),
      setStatus: vi.fn(async (ulid: string) =>
        ulid === 'outgoing-ulid' ? err('edt-registry-write-error', 'disk full') : ok(undefined),
      ),
    });

    const result = await switchActiveEdt(makeParams({ edtRegistry }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toContainEqual({
        service: 'edt-registry:deactivate-outgoing',
        outcome: 'failed',
        detail: { code: 'edt-registry-write-error', message: 'disk full' },
      });
    }
  });
});

describe('switchActiveEdt — target member deregistered from RegistryPort', () => {
  it('reports a target member no longer in the managed-repo registry as `failed`, never silently skipped', async () => {
    // '/repo/a' is a target member but registry.list() no longer includes it.
    const registry = fakeRegistry(['/repo/b', '/repo/c']);
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET, OUTGOING])) });

    const result = await switchActiveEdt(makeParams({ registry, edtRegistry }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toContainEqual({
        service: 'svc-a',
        outcome: 'failed',
        detail: { code: 'repo-not-registered', message: 'Target member /repo/a is no longer in the managed-repo registry' },
      });
    }
  });
});


// ---- Dirty-repo classification and resolutions --------------------------------------------

const WRITE_METHODS = ['stashSave', 'restoreStash', 'checkout', 'createBranch', 'deleteBranch', 'discardAll', 'discardPaths', 'fetch', 'renameBranch'] as const;

function expectZeroWrites(git: GitPort): void {
  for (const method of WRITE_METHODS) {
    expect(calls(git[method]), `git.${method}`).toHaveLength(0);
  }
}

function callOrder(fn: unknown, predicate: (args: unknown[]) => boolean = () => true): number {
  const mock = fn as Mock;
  const index = mock.mock.calls.findIndex((args) => predicate(args));
  return mock.mock.invocationCallOrder[index] as number;
}

const OTHER = edtEntry('other-ulid', 'other-topic', [member('svc-b', '/repo/b', 'feat/b-other')], 'inactive');

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
    // The membership write happens under the edts.yaml lock (then the final status write).
    expect(calls(lock.acquire)).toEqual([['/cfg/edts.yaml'], ['/cfg/edts.yaml']]);

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
