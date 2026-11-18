// core/edt/switch: unit tests against fake ports — target resolution, idempotency, lock gates, per-repo isolation and registry writes.
import { describe, expect, it, type Mock, vi } from 'vitest';
import { err, ok } from '../result.js';
import { switchActiveEdt } from './switch.js';
import { calls, edtEntry, fakeEdtRegistry, fakeGit, fakeLock, fakeRegistry, fakeState, member } from '../shared/core-ports.test-support.js';
import { expectZeroWrites, fakeManifest, makeParams, manifestFor, OUTGOING, REPOS, TARGET } from './switch.test-support.js';

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
    expect(calls(lock.acquire)).toEqual([['edt:outgoing-ulid'], ['/cfg/edts.yaml']]);
  });

  it('propagates a lock-acquire failure without writing state.json or the registry', async () => {
    const lock = fakeLock({
      acquire: async (key: string) =>
        key === '/cfg/edts.yaml' ? err('action-in-progress', 'another switch is running') : ok({ release: async () => ok(undefined) }),
    });
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok('outgoing-ulid')) });
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET, OUTGOING])) });

    const result = await switchActiveEdt(makeParams({ lock, state, edtRegistry }));

    expect(result).toMatchObject({ ok: false, error: { code: 'action-in-progress' } });
    expect(calls(state.writeActiveEdt)).toHaveLength(0);
    expect(calls(edtRegistry.setStatus)).toHaveLength(0);
  });
});

describe('switchActiveEdt — outgoing action lock held across the per-repo work', () => {
  it('holds edt:<outgoing ulid> from the first checkout until the state.json and edts.yaml writes are done', async () => {
    const events: string[] = [];
    const lock = fakeLock({
      acquire: vi.fn(async (key: string) => {
        events.push(`acquire:${key}`);
        return ok({
          release: vi.fn(async () => {
            events.push(`release:${key}`);
            return ok(undefined);
          }),
        });
      }),
    });
    const git = fakeGit({
      checkout: vi.fn(async (repoPath: string) => {
        events.push(`checkout:${repoPath}`);
        return ok(undefined);
      }),
    });
    const state = fakeState({
      readActiveEdt: vi.fn(async () => ok('outgoing-ulid')),
      writeActiveEdt: vi.fn(async () => {
        events.push('writeActiveEdt');
        return ok(undefined);
      }),
    });

    const result = await switchActiveEdt(makeParams({ lock, git, state }));

    expect(result).toMatchObject({ ok: true });
    expect(events).toEqual([
      'acquire:edt:outgoing-ulid',
      'checkout:/repo/a',
      'checkout:/repo/b',
      'checkout:/repo/c',
      'acquire:/cfg/edts.yaml',
      'writeActiveEdt',
      'release:/cfg/edts.yaml',
      'release:edt:outgoing-ulid',
    ]);
  });

  it('touches nothing when the outgoing lock is taken between the peek and the acquire', async () => {
    const lock = fakeLock({
      acquire: vi.fn(async (key: string) =>
        key === 'edt:outgoing-ulid' ? err('action-in-progress', 'realign running') : ok({ release: vi.fn(async () => ok(undefined)) }),
      ),
    });
    const git = fakeGit();
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok('outgoing-ulid')) });

    const result = await switchActiveEdt(makeParams({ lock, git, state }));

    // Same error as the peek path, so the TUI's force/cancel prompt still applies.
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'switch-blocked-action-in-progress', message: expect.stringContaining('Pass --force') },
    });
    expect(calls(git.checkout)).toHaveLength(0);
    expect(calls(state.writeActiveEdt)).toHaveLength(0);
  });

  it('does not take the outgoing lock under --force past a held one', async () => {
    const lock = fakeLock({ peek: vi.fn(async () => ok({ locked: true })) });

    const result = await switchActiveEdt(makeParams({ lock, force: true }));

    expect(result).toMatchObject({ ok: true });
    expect(calls(lock.acquire)).toEqual([['/cfg/edts.yaml']]);
  });

  it('takes no EDT lock when there is no outgoing EDT', async () => {
    const lock = fakeLock();

    const result = await switchActiveEdt(makeParams({ lock, state: fakeState() }));

    expect(result).toMatchObject({ ok: true });
    expect(calls(lock.acquire)).toEqual([['/cfg/edts.yaml']]);
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
