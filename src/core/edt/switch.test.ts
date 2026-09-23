// core/edt/switch: unit tests against fake ports (AD-13 core layer) — every I/O-matrix row of
// story 2.4 plus the validation-ordering and per-repo-isolation guarantees. Real git/fs
// behavior lives in adapters/driven/git|lock|edt-registry|state's own tests and the black-box
// e2e; here only the use-case's orchestration is exercised: target resolution, the no-op
// idempotency short-circuit, the outgoing-lock peek/--force gate, the target-member vs.
// non-member partition, stash-tag symmetry, and per-repo failure isolation.
import { describe, expect, it, vi, type Mock } from 'vitest';
import { ok, err } from '../result.js';
import type { EdtMember, EdtRegistryEntry, EdtRegistryPort, EdtStatus } from '../ports/edt-registry.js';
import type { GitPort } from '../ports/git.js';
import type { LockPort } from '../ports/lock.js';
import type { Manifest, ManifestPort } from '../ports/manifest.js';
import type { RegistryPort } from '../ports/registry.js';
import type { StatePort } from '../ports/state.js';
import { switchActiveEdt, type SwitchActiveEdtParams } from './switch.js';

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
    isRebaseInProgress: vi.fn(async () => ok(false)),
    hasUnmergedPaths: vi.fn(async () => ok(false)),
    finalizeMerge: vi.fn(async () => ok(undefined)),
    listBranches: vi.fn(async () => ok([])),
    renameBranch: vi.fn(async () => ok(undefined)),
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
    git: overrides.git ?? fakeGit(),
    lock: overrides.lock ?? fakeLock(),
    state: overrides.state ?? fakeState({ readActiveEdt: vi.fn(async () => ok('outgoing-ulid')) }),
    edtRegistryResourceKey: overrides.edtRegistryResourceKey ?? '/cfg/edts.yaml',
    topic: overrides.topic ?? 'target-topic',
    force: overrides.force,
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
  it('stashes the dirty target member, checks out every repo correctly, and updates state + registry', async () => {
    const git = fakeGit({
      hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a')),
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

    // Target member: re-verified (cross-EDT gate) with the target's own ulid, stashed under
    // the OUTGOING's tag (the dirty state predates this switch), checked into its own
    // branch, then its own (target-tagged) stash is looked up to pop back in.
    expect(calls(git.assertAllowedBranch)).toContainEqual(['/repo/a', 'feat/a', 'target-ulid']);
    expect(calls(git.stashSave)).toContainEqual(['/repo/a', 'tui-back:outgoing-ulid']);
    expect(calls(git.checkout)).toContainEqual(['/repo/a', 'feat/a']);
    expect(calls(git.restoreStash)).toContainEqual(['/repo/a', 'tui-back:target-ulid']);

    // Non-members (b: untouched by any EDT, c: outgoing's own member, now dropped) both go
    // to the shared branch, regardless of stale membership in the now-inactive outgoing EDT.
    expect(calls(git.checkout)).toContainEqual(['/repo/b', 'development']);
    expect(calls(git.checkout)).toContainEqual(['/repo/c', 'development']);
    // Non-members report clean here, so neither is stashed — but restoreStash is still called
    // unconditionally for each of them (the fixed 'tui-back:shared' tag), mirroring the
    // member's own unconditional post-checkout restore; both are no-ops since git.hasStash
    // reports nothing to pop.
    expect(calls(git.stashSave)).toHaveLength(1);
    expect(calls(git.restoreStash)).toHaveLength(3);
    expect(calls(git.restoreStash)).toContainEqual(['/repo/b', 'tui-back:shared']);
    expect(calls(git.restoreStash)).toContainEqual(['/repo/c', 'tui-back:shared']);

    expect(calls(state.writeActiveEdt)).toEqual([['target-ulid']]);
    expect(calls(edtRegistry.setStatus)).toContainEqual(['target-ulid', 'active']);
    expect(calls(edtRegistry.setStatus)).toContainEqual(['outgoing-ulid', 'inactive']);
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
    // A checkout failure never reaches the restore step for that repo — but the two
    // non-members (b, c) checked out fine and still get their unconditional restore call.
    expect(calls(git.restoreStash)).not.toContainEqual(['/repo/a', expect.anything()]);
    expect(calls(git.restoreStash)).toHaveLength(2);
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

describe('switchActiveEdt — stash-tag symmetry on a first-ever switch (no outgoing)', () => {
  it('tags with the target\'s own ulid on both the pre-checkout stash and the post-checkout restore', async () => {
    const git = fakeGit({
      hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a')),
    });
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok(null)) });
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET])) });
    const registry = fakeRegistry(['/repo/a']);

    const result = await switchActiveEdt(makeParams({ git, state, edtRegistry, registry }));

    expect(result.ok).toBe(true);
    expect(calls(git.stashSave)).toEqual([['/repo/a', 'tui-back:target-ulid']]);
    expect(calls(git.restoreStash)).toEqual([['/repo/a', 'tui-back:target-ulid']]);
  });
});

describe('switchActiveEdt — state.json write failure', () => {
  it('surfaces a writeActiveEdt failure as the overall result, keeping the per-repo results as error details (review)', async () => {
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

describe('switchActiveEdt — edts.yaml write under lock (AD-9, review)', () => {
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

describe('switchActiveEdt — setStatus failure is surfaced, not swallowed (review)', () => {
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

describe('switchActiveEdt — target member deregistered from RegistryPort (review)', () => {
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

// Bug fix: a dirty non-member's work used to be stashed under the outgoing EDT's ulid and
// never restored by any code path (an invisible, permanently orphaned stash). It's now
// tagged with a fixed, repo-scoped tag and popped back unconditionally, right after checkout,
// in this same call.
describe('switchActiveEdt — non-member stash round-trip (bug fix)', () => {
  it('stashes a dirty non-member under the fixed shared tag and restores it after checkout, in call order', async () => {
    const git = fakeGit({
      hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/b')),
    });

    const result = await switchActiveEdt(makeParams({ git }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toContainEqual({ service: 'svc-b', outcome: 'switched' });
    }
    expect(calls(git.stashSave)).toContainEqual(['/repo/b', 'tui-back:shared']);
    expect(calls(git.checkout)).toContainEqual(['/repo/b', 'development']);
    expect(calls(git.restoreStash)).toContainEqual(['/repo/b', 'tui-back:shared']);

    const stashCall = (git.stashSave as unknown as Mock).mock.invocationCallOrder[0];
    const checkoutCall = (git.checkout as unknown as Mock).mock.invocationCallOrder.find(
      (_order: number, index: number) => (git.checkout as unknown as Mock).mock.calls[index]?.[0] === '/repo/b',
    );
    const restoreCall = (git.restoreStash as unknown as Mock).mock.invocationCallOrder.find(
      (_order: number, index: number) => (git.restoreStash as unknown as Mock).mock.calls[index]?.[0] === '/repo/b',
    );
    expect(stashCall).toBeLessThan(checkoutCall as number);
    expect(checkoutCall as number).toBeLessThan(restoreCall as number);
  });

  it('still restores a clean non-member unconditionally (heals a pre-existing orphaned stash left by the old code path)', async () => {
    const git = fakeGit(); // every repo reports clean by default

    const result = await switchActiveEdt(makeParams({ git }));

    expect(result.ok).toBe(true);
    expect(calls(git.stashSave)).toHaveLength(0);
    expect(calls(git.restoreStash)).toContainEqual(['/repo/b', 'tui-back:shared']);
    expect(calls(git.restoreStash)).toContainEqual(['/repo/c', 'tui-back:shared']);
  });

  it('a stash-pop failure on a non-member is `failed`, never thrown, and leaves the stash recoverable via git itself', async () => {
    const git = fakeGit({
      hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/b')),
      restoreStash: vi.fn(async (repoPath: string) =>
        repoPath === '/repo/b' ? err('git-stash-pop-error', 'conflict popping stash') : ok(undefined),
      ),
    });

    const result = await switchActiveEdt(makeParams({ git }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toContainEqual({
        service: 'svc-b',
        outcome: 'failed',
        detail: { code: 'git-stash-pop-error', message: 'conflict popping stash' },
      });
    }
  });
});

// Bug fix: the preview/confirm seam. Only exercised when the caller opts in via
// onDirtyReposBeforeSwitch — the CLI path never passes it and gets today's unchanged behavior.
describe('switchActiveEdt — dirty-repo preview/confirm seam (bug fix)', () => {
  it('does not run the preview scan at all when no callback is supplied (CLI parity)', async () => {
    const git = fakeGit();

    const result = await switchActiveEdt(makeParams({ git }));

    expect(result.ok).toBe(true);
    // One hasUncommittedChanges read per registered repo (3), not doubled by a preview pass.
    expect(calls(git.hasUncommittedChanges)).toHaveLength(REPOS.length);
  });

  it('never invokes the callback when every repo is clean', async () => {
    const git = fakeGit();
    const onDirtyReposBeforeSwitch = vi.fn(async () => 'proceed' as const);

    const result = await switchActiveEdt(makeParams({ git, onDirtyReposBeforeSwitch }));

    expect(result.ok).toBe(true);
    expect(calls(onDirtyReposBeforeSwitch)).toHaveLength(0);
  });

  it('passes one row per dirty repo (member and non-member), before any checkout, when the target and a non-member are both dirty', async () => {
    const git = fakeGit({
      hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a' || repoPath === '/repo/b')),
    });
    let checkoutCallsWhenAsked = -1;
    const onDirtyReposBeforeSwitch = vi.fn(async () => {
      checkoutCallsWhenAsked = calls(git.checkout).length;
      return 'proceed' as const;
    });

    const result = await switchActiveEdt(makeParams({ git, onDirtyReposBeforeSwitch }));

    expect(result.ok).toBe(true);
    expect(calls(onDirtyReposBeforeSwitch)).toEqual([
      [
        expect.arrayContaining([
          { service: 'svc-a', repoPath: '/repo/a', scope: 'member' },
          { service: 'svc-b', repoPath: '/repo/b', scope: 'non-member' },
        ]),
      ],
    ]);
    expect(calls(onDirtyReposBeforeSwitch)[0]?.[0]).toHaveLength(2);
    // Called before any repo is touched.
    expect(checkoutCallsWhenAsked).toBe(0);
  });

  it('a "cancel" answer aborts before any repo is touched and leaves state.json/edts.yaml untouched', async () => {
    const git = fakeGit({
      hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/b')),
    });
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok('outgoing-ulid')) });
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET, OUTGOING])) });
    const onDirtyReposBeforeSwitch = vi.fn(async () => 'cancel' as const);

    const result = await switchActiveEdt(makeParams({ git, state, edtRegistry, onDirtyReposBeforeSwitch }));

    expect(result).toMatchObject({ ok: false, error: { code: 'switch-cancelled-by-user' } });
    expect(calls(git.stashSave)).toHaveLength(0);
    expect(calls(git.checkout)).toHaveLength(0);
    expect(calls(state.writeActiveEdt)).toHaveLength(0);
    expect(calls(edtRegistry.setStatus)).toHaveLength(0);
  });

  it('a "proceed" answer lets the switch continue exactly as usual', async () => {
    const git = fakeGit({
      hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/b')),
    });
    const onDirtyReposBeforeSwitch = vi.fn(async () => 'proceed' as const);

    const result = await switchActiveEdt(makeParams({ git, onDirtyReposBeforeSwitch }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toContainEqual({ service: 'svc-b', outcome: 'switched' });
    }
    expect(calls(git.checkout)).toContainEqual(['/repo/b', 'development']);
  });
});
