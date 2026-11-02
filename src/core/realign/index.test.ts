// core/realign: unit tests against fake ports — selection, per-service outcomes, lock, log, restart.
import { describe, expect, it, vi } from 'vitest';
import { err, ok, type Result } from '../result.js';
import type { EdtRegistryEntry, EdtRegistryPort } from '../ports/edt-registry.js';
import { GIT_DETACHED_HEAD, type GitPort } from '../ports/git.js';
import type { LockPort } from '../ports/lock.js';
import type { ManifestCarryPort } from '../ports/manifest-carry.js';
import type { Manifest, ManifestPort } from '../ports/manifest.js';
import type { RegistryPort } from '../ports/registry.js';
import type { StatePort } from '../ports/state.js';
import type { ServiceFinalState } from '../service-actions/index.js';
import type { DriftCandidate } from '../dashboard/drift.js';
import { realignServices, resolveRealignSelection, type RealignServicesParams } from './index.js';

// Members a (EDT branch feat/a) and b (feat/b); others c and d (sharedBranch develop).
const EDT: EdtRegistryEntry = {
  ulid: 'e1',
  topic: 'topic-a',
  createdAt: '2026-01-01T00:00:00Z',
  status: 'active',
  members: [
    { service: 'svc-a', repoPath: '/r/a', branch: 'feat/a' },
    { service: 'svc-b', repoPath: '/r/b', branch: 'feat/b' },
  ],
};

interface Setup {
  branches?: Record<string, Result<string>>;
  git?: Partial<Record<keyof GitPort, unknown>>;
  lock?: Partial<LockPort>;
  active?: string | null;
  containers?: Record<string, string | undefined>;
  logAction?: EdtRegistryPort['logAction'] | null;
}

function build(setup: Setup = {}) {
  const events: string[] = [];
  const branches: Record<string, Result<string>> = {
    '/r/a': ok('main'),
    '/r/b': ok('feat/b'),
    '/r/c': ok('hotfix'),
    '/r/d': ok('develop'),
    ...setup.branches,
  };
  const registry = {
    list: vi.fn(async () => ok(['/r/a', '/r/b', '/r/c', '/r/d'])),
    exists: vi.fn(async () => ok(true)),
  } as unknown as RegistryPort;
  const manifest: ManifestPort = {
    load: vi.fn(async (path: string): Promise<Result<Manifest>> => {
      const name = path.split('/').pop() as string;
      const container = setup.containers === undefined ? `ctr-${name}` : setup.containers[path];
      return ok({ service: `svc-${name}`, sharedBranch: 'develop', modules: {}, ...(container !== undefined ? { container } : {}) });
    }),
  };
  const git = {
    currentBranch: vi.fn(async (path: string) => branches[path] ?? ok('develop')),
    isMergeInProgress: vi.fn(async () => ok(false)),
    isRebaseInProgress: vi.fn(async () => ok(false)),
    hasUnmergedPaths: vi.fn(async () => ok(false)),
    hasUncommittedChanges: vi.fn(async () => ok(false)),
    listDirtyPaths: vi.fn(async () => ok([] as string[])),
    discardPathsToHead: vi.fn(async () => ok(undefined)),
    assertAllowedBranch: vi.fn(async () => ok(undefined)),
    branchExistsLocally: vi.fn(async () => ok(true)),
    fetch: vi.fn(async () => ok(undefined)),
    checkout: vi.fn(async (path: string, branch: string) => {
      events.push(`checkout:${path}:${branch}`);
      return ok(undefined);
    }),
    stashSave: vi.fn(async () => ok(undefined)),
    discardAll: vi.fn(async () => ok(undefined)),
    ...setup.git,
  } as unknown as GitPort;
  const manifestCarry: ManifestCarryPort = {
    capture: vi.fn(async () => ok({ kind: 'absent' } as const)),
    restore: vi.fn(async () => ok(undefined)),
  };
  const lock: LockPort = {
    acquire: vi.fn(async (key: string) => {
      events.push(`acquire:${key}`);
      return ok({
        release: vi.fn(async () => {
          events.push(`release:${key}`);
          return ok(undefined);
        }),
      });
    }),
    peek: vi.fn(async () => ok({ locked: false })),
    ...setup.lock,
  };
  const state = {
    readActiveEdt: vi.fn(async () => ok(setup.active === undefined ? 'e1' : setup.active)),
  } as unknown as StatePort;
  const logAction = setup.logAction === null ? undefined : (setup.logAction ?? vi.fn(async () => ok(undefined)));
  const edtRegistry = {
    list: vi.fn(async () => ok([EDT])),
    ...(logAction !== undefined ? { logAction } : {}),
  } as unknown as EdtRegistryPort;
  const params = (overrides: Partial<RealignServicesParams> = {}): RealignServicesParams => ({
    registry,
    manifest,
    manifestCarry,
    git,
    lock,
    state,
    edtRegistry,
    scope: 'edt',
    ...overrides,
  });
  return { params, git, lock, state, edtRegistry, logAction, manifestCarry, events };
}

function candidate(service: string, kind: 'member' | 'other', drift: DriftCandidate['drift']): DriftCandidate {
  return { kind, service, path: `/r/${service}`, branch: 'x', expectedBranch: 'y', drift };
}

describe('resolveRealignSelection', () => {
  const candidates = {
    members: [candidate('a', 'member', 'drifted'), candidate('b', 'member', 'aligned')],
    others: [candidate('c', 'other', 'drifted'), candidate('d', 'other', 'unknown')],
  };
  const names = (result: Result<DriftCandidate[]>) => (result.ok ? result.data.map((entry) => entry.service) : result.error.code);

  it('maps none / edt / all to nothing / drifted members / every drifted service', () => {
    expect(names(resolveRealignSelection(candidates, 'none'))).toEqual([]);
    expect(names(resolveRealignSelection(candidates, 'edt'))).toEqual(['a']);
    expect(names(resolveRealignSelection(candidates, 'all'))).toEqual(['a', 'c']);
  });

  it('adds named services whatever their drift, once, members first', () => {
    expect(names(resolveRealignSelection(candidates, 'edt', ['d', 'b', 'a']))).toEqual(['a', 'b', 'd']);
    expect(names(resolveRealignSelection(candidates, 'none', ['c']))).toEqual(['c']);
  });

  it('rejects an unknown scope or service name', () => {
    expect(names(resolveRealignSelection(candidates, 'foo'))).toBe('invalid-argument');
    expect(names(resolveRealignSelection(candidates, 'edt', ['nope']))).toBe('invalid-argument');
  });
});

describe('realignServices', () => {
  it('checks out a drifted member onto its EDT branch through the AD-8 gate', async () => {
    const { params, git } = build();

    const result = await realignServices(params());

    expect(result).toMatchObject({ ok: true, data: { edt: { ulid: 'e1' }, selection: ['svc-a'], rows: [{ service: 'svc-a', outcome: 'realigned' }] } });
    expect(git.assertAllowedBranch).toHaveBeenCalledWith('/r/a', 'feat/a', 'e1');
    expect(git.checkout).toHaveBeenCalledWith('/r/a', 'feat/a');
    expect(git.checkout).toHaveBeenCalledTimes(1);
  });

  it('fails a member when the gate or the checkout fails, the others still proceed', async () => {
    const { params } = build({
      branches: { '/r/b': ok('main') },
      git: {
        assertAllowedBranch: vi.fn(async (path: string) => (path === '/r/a' ? err('branch-not-allowed', 'gate refused') : ok(undefined))),
        checkout: vi.fn(async () => err('git-checkout-error', 'checkout refused')),
      },
    });

    const result = await realignServices(params());

    expect(result.ok && result.data.rows).toEqual([
      { service: 'svc-a', outcome: 'failed', detail: { code: 'branch-not-allowed', message: 'gate refused' } },
      { service: 'svc-b', outcome: 'failed', detail: { code: 'git-checkout-error', message: 'checkout refused' } },
    ]);
  });

  it('fetches an other service sharedBranch when absent, and fails it when the fetch fails', async () => {
    const fetched = build({ git: { branchExistsLocally: vi.fn(async () => ok(false)) } });
    const result = await realignServices(fetched.params({ scope: 'none', services: ['svc-c'] }));
    expect(result.ok && result.data.rows).toEqual([expect.objectContaining({ service: 'svc-c', outcome: 'realigned' })]);
    expect(fetched.git.fetch).toHaveBeenCalledWith('/r/c', 'develop');
    expect(fetched.git.assertAllowedBranch).not.toHaveBeenCalled();
    expect(fetched.git.checkout).toHaveBeenCalledWith('/r/c', 'develop');

    const failing = build({ git: { branchExistsLocally: vi.fn(async () => ok(false)), fetch: vi.fn(async () => err('git-fetch-error', 'offline')) } });
    const failed = await realignServices(failing.params({ scope: 'all' }));
    expect(failed.ok && failed.data.rows).toEqual([
      expect.objectContaining({ service: 'svc-a', outcome: 'failed', detail: { code: 'member-branch-missing', message: expect.any(String) } }),
      { service: 'svc-c', outcome: 'failed', detail: { code: 'git-fetch-error', message: 'offline' } },
    ]);
    expect(failing.git.checkout).not.toHaveBeenCalled();
  });

  it('reports a named aligned service unchanged with no git write', async () => {
    const { params, git } = build({ branches: { '/r/a': ok('feat/a') } });

    const result = await realignServices(params({ scope: 'none', services: ['svc-b'] }));

    expect(result.ok && result.data.rows).toEqual([{ service: 'svc-b', outcome: 'unchanged' }]);
    expect(git.checkout).not.toHaveBeenCalled();
    expect(git.hasUncommittedChanges).not.toHaveBeenCalled();
  });

  it.each([
    ['isMergeInProgress', 'realign-merge-in-progress'],
    ['isRebaseInProgress', 'realign-rebase-in-progress'],
    ['hasUnmergedPaths', 'realign-unmerged-paths'],
    ['hasUncommittedChanges', 'realign-dirty-work'],
  ])('skips a drifted service when %s reports true (%s), others proceed', async (probe, code) => {
    const { params, git } = build({
      git: { [probe]: vi.fn(async (path: string) => ok(path === '/r/a')) },
    });

    const result = await realignServices(params({ scope: 'all' }));

    expect(result.ok && result.data.rows).toEqual([
      { service: 'svc-a', outcome: 'skipped', detail: { code, message: expect.any(String) } },
      expect.objectContaining({ service: 'svc-c', outcome: 'realigned' }),
    ]);
    expect(git.checkout).toHaveBeenCalledTimes(1);
    expect(git.stashSave).not.toHaveBeenCalled();
    expect(git.discardAll).not.toHaveBeenCalled();
  });

  it('judges dirtiness without the manifest and carries a dirty .tui-back.yaml across the checkout', async () => {
    const { params, git, manifestCarry } = build({
      git: { listDirtyPaths: vi.fn(async () => ok(['.tui-back.yaml'])) },
    });

    const result = await realignServices(params());

    expect(result.ok && result.data.rows).toEqual([expect.objectContaining({ service: 'svc-a', outcome: 'realigned' })]);
    expect(git.hasUncommittedChanges).toHaveBeenCalledWith('/r/a', { excludePaths: ['.tui-back.yaml'] });
    expect(manifestCarry.capture).toHaveBeenCalledWith('/r/a');
    expect(manifestCarry.restore).toHaveBeenCalledTimes(1);
  });

  it('skips an unknown-drift service and realigns a detached one', async () => {
    const { params, git } = build({
      branches: { '/r/a': err('git-error', 'boom'), '/r/c': err(GIT_DETACHED_HEAD, 'detached') },
    });

    const result = await realignServices(params({ scope: 'all', services: ['svc-a'] }));

    expect(result.ok && result.data.rows).toEqual([
      { service: 'svc-a', outcome: 'skipped', detail: { code: 'realign-drift-unknown', message: expect.stringContaining('boom') } },
      expect.objectContaining({ service: 'svc-c', outcome: 'realigned' }),
    ]);
    expect(git.checkout).toHaveBeenCalledWith('/r/c', 'develop');
  });

  it('turns a throwing worker into its failed row and still resolves', async () => {
    const { params } = build({
      git: {
        isMergeInProgress: vi.fn(async (path: string) => {
          if (path === '/r/a') throw new Error('spawn exploded');
          return ok(false);
        }),
      },
    });

    const result = await realignServices(params({ scope: 'all' }));

    expect(result.ok && result.data.rows).toEqual([
      { service: 'svc-a', outcome: 'failed', detail: { code: 'realign-failed', message: 'spawn exploded' } },
      expect.objectContaining({ service: 'svc-c', outcome: 'realigned' }),
    ]);
  });

  it('rejects unknown names and scopes before locking or touching anything', async () => {
    const { params, lock, git } = build();

    expect(await realignServices(params({ services: ['nope'] }))).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    expect(await realignServices(params({ scope: 'foo' as never }))).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    expect(lock.acquire).not.toHaveBeenCalled();
    expect(git.checkout).not.toHaveBeenCalled();
  });

  it('errors with no-active-edt and touches nothing', async () => {
    const { params, lock } = build({ active: null });

    expect(await realignServices(params())).toMatchObject({ ok: false, error: { code: 'no-active-edt' } });
    expect(lock.acquire).not.toHaveBeenCalled();
  });

  it('holds group-update then edt:<active ulid> around the whole run', async () => {
    const { params, events } = build();

    await realignServices(params());

    expect(events).toEqual(['acquire:group-update', 'acquire:edt:e1', 'checkout:/r/a:feat/a', 'release:edt:e1', 'release:group-update']);
  });

  it.each(['group-update', 'edt:e1'])('is rejected while %s is held, nothing touched', async (held) => {
    const { params, git, logAction } = build({
      lock: {
        acquire: vi.fn(async (key: string) =>
          key === held ? err('action-in-progress', 'busy') : ok({ release: vi.fn(async () => ok(undefined)) }),
        ),
      },
    });

    const result = await realignServices(params());

    expect(result).toMatchObject({ ok: false, error: { code: 'realign-blocked-action-in-progress' } });
    expect(git.checkout).not.toHaveBeenCalled();
    expect(logAction).not.toHaveBeenCalled();
  });

  it('refuses when the active EDT changed before the locks were taken', async () => {
    const { params, state, git } = build();
    (state.readActiveEdt as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok('e1')).mockResolvedValueOnce(ok('e2'));

    expect(await realignServices(params())).toMatchObject({ ok: false, error: { code: 'realign-active-edt-changed' } });
    expect(git.checkout).not.toHaveBeenCalled();
  });

  it('re-judges the selection on a fresh read under the locks', async () => {
    const { params, git, events } = build();
    // Before the locks: svc-a drifted (main), svc-c drifted (hotfix). Under the locks: svc-a was
    // fixed meanwhile, svc-c moved again.
    const reads: Record<string, string[]> = { '/r/a': ['main', 'feat/a'], '/r/b': ['feat/b'], '/r/c': ['hotfix', 'other'] };
    (git.currentBranch as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
      const queue = reads[path];
      return ok(queue !== undefined && queue.length > 1 ? (queue.shift() as string) : (queue?.[0] ?? 'develop'));
    });

    const result = await realignServices(params({ scope: 'all' }));

    expect(result.ok && result.data.rows).toEqual([{ service: 'svc-a', outcome: 'unchanged' }, expect.objectContaining({ service: 'svc-c', outcome: 'realigned' })]);
    expect(events.filter((event) => event.startsWith('checkout'))).toEqual(['checkout:/r/c:develop']);
  });

  it('skips a selected repo that left the candidates before the locks were taken', async () => {
    const { params, git } = build();
    const registry = params().registry;
    (registry.list as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(ok(['/r/a', '/r/b', '/r/c', '/r/d']))
      .mockResolvedValue(ok(['/r/a', '/r/b', '/r/d']));

    const result = await realignServices(params({ scope: 'all' }));

    expect(result.ok && result.data.rows).toEqual([
      expect.objectContaining({ service: 'svc-a', outcome: 'realigned' }),
      { service: 'svc-c', outcome: 'skipped', detail: { code: 'realign-candidate-gone', message: expect.stringContaining('/r/c') } },
    ]);
    expect(git.checkout).not.toHaveBeenCalledWith('/r/c', expect.anything());
  });

  it('resolves with an error when the candidate read or the still-active read throws', async () => {
    const listing = build();
    (listing.params().edtRegistry.list as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('yaml exploded'));
    await expect(realignServices(listing.params())).resolves.toMatchObject({ ok: false, error: { code: 'realign-failed', message: 'yaml exploded' } });

    const stillActive = build();
    (stillActive.state.readActiveEdt as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok('e1')).mockRejectedValueOnce(new Error('state gone'));
    await expect(realignServices(stillActive.params())).resolves.toMatchObject({ ok: false, error: { code: 'realign-failed', message: 'state gone' } });
    expect(stillActive.git.checkout).not.toHaveBeenCalled();
  });

  it('writes one realign log entry naming the selection and every outcome', async () => {
    const { params, logAction } = build({ git: { hasUncommittedChanges: vi.fn(async (path: string) => ok(path === '/r/c')) } });

    await realignServices(params({ scope: 'all', services: ['svc-b'] }));

    expect(logAction).toHaveBeenCalledTimes(1);
    const [ulid, type, outcome, detail] = (logAction as ReturnType<typeof vi.fn>).mock.calls[0] as string[];
    expect([ulid, type, outcome]).toEqual(['e1', 'realign', 'success']);
    expect(detail).toBe('Selection: svc-a, svc-b, svc-c — svc-a realigned; svc-b unchanged; svc-c skipped (realign-dirty-work)');
  });

  it('logs a failed run as failed, and a log failure never fails the run', async () => {
    const throwing = vi.fn(async () => {
      throw new Error('sqlite locked');
    });
    const { params } = build({ logAction: throwing, git: { checkout: vi.fn(async () => err('git-checkout-error', 'no')) } });

    const result = await realignServices(params());

    expect(result).toMatchObject({ ok: true, data: { rows: [{ service: 'svc-a', outcome: 'failed' }] } });
    expect(throwing).toHaveBeenCalledWith('e1', 'realign', 'failed', expect.any(String));
  });

  it('returns ok with no rows for an empty selection', async () => {
    const { params, git, logAction } = build();

    const result = await realignServices(params({ scope: 'none' }));

    expect(result).toEqual({ ok: true, data: { edt: { ulid: 'e1', topic: 'topic-a' }, selection: [], rows: [] } });
    expect(git.checkout).not.toHaveBeenCalled();
    expect(logAction).toHaveBeenCalledWith('e1', 'realign', 'success', 'Selection: (none) — nothing to realign');
  });

  it('restarts only realigned services with a container and skips the rest of the selection', async () => {
    const { params } = build({ containers: { '/r/a': 'ctr-a', '/r/b': 'ctr-b', '/r/c': undefined, '/r/d': 'ctr-d' } });
    const serviceActions = {
      restart: vi.fn(async () => ok({})),
      verifyService: vi.fn(async () => ok({ state: 'functional' as ServiceFinalState })),
    };

    const result = await realignServices(
      params({ scope: 'all', services: ['svc-b'], restart: { mode: 'clean', concurrency: 1, serviceActions: serviceActions as never } }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.rows.map((row) => row.outcome)).toEqual(['realigned', 'unchanged', 'realigned']);
    const byService = Object.fromEntries((result.data.restart?.rows ?? []).map((row) => [row.service, row]));
    expect(Object.keys(byService).sort()).toEqual(['svc-a', 'svc-b', 'svc-c']);
    expect(byService['svc-a']).toMatchObject({ phase: 'functional' });
    expect(byService['svc-b']).toMatchObject({ phase: 'skipped', skipReason: 'unchanged' });
    expect(byService['svc-c']).toMatchObject({ phase: 'skipped', skipReason: 'no container' });
    expect(serviceActions.restart).toHaveBeenCalledTimes(1);
    expect(serviceActions.restart).toHaveBeenCalledWith('/r/a', 'clean');
  });

  it('keeps the realign when a restart ends down', async () => {
    const { params } = build();
    const serviceActions = {
      restart: vi.fn(async () => ok({})),
      verifyService: vi.fn(async () => ok({ state: 'down' as ServiceFinalState })),
    };

    const result = await realignServices(params({ restart: { mode: 'simple', concurrency: 1, serviceActions: serviceActions as never } }));

    expect(result).toMatchObject({ ok: true, data: { rows: [{ service: 'svc-a', outcome: 'realigned' }], restart: { summary: { down: 1 } } } });
  });
});
