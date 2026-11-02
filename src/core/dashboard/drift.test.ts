// core/dashboard/drift: unit tests against fake ports — the realign candidate list.
import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '../result.js';
import type { EdtRegistryEntry, EdtRegistryPort } from '../ports/edt-registry.js';
import { GIT_DETACHED_HEAD, type GitPort } from '../ports/git.js';
import type { ManifestPort } from '../ports/manifest.js';
import type { RegistryPort } from '../ports/registry.js';
import type { StatePort } from '../ports/state.js';
import { driftOf, listDriftCandidates } from './drift.js';

const EDT: EdtRegistryEntry = {
  ulid: 'e1',
  topic: 'topic-a',
  createdAt: '2026-01-01T00:00:00Z',
  status: 'active',
  members: [
    { service: 'svc-a', repoPath: '/r/a', branch: 'feat/x' },
    { service: 'svc-b', repoPath: '/r/b/', branch: 'feat/x' },
  ],
};

function build(opts: { active?: string | null; branches?: Record<string, ReturnType<typeof ok<string>> | ReturnType<typeof err>> } = {}) {
  const registry = {
    list: vi.fn(async () => ok(['/r/a', '/r/b', '/r/c', '/r/gone'])),
    exists: vi.fn(async (path: string) => ok(path !== '/r/gone')),
  } as unknown as RegistryPort;
  const manifest: ManifestPort = {
    load: vi.fn(async (path: string) => ok({ service: `svc-${path.split('/').pop()}`, sharedBranch: 'develop', modules: {} })),
  };
  const currentBranch = vi.fn(async (path: string) => opts.branches?.[path] ?? ok('feat/x'));
  const git = { currentBranch } as unknown as GitPort;
  const edtRegistry = { list: vi.fn(async () => ok([EDT])) } as unknown as EdtRegistryPort;
  const state = { readActiveEdt: vi.fn(async () => ok(opts.active === undefined ? 'e1' : opts.active)) } as unknown as StatePort;
  return { deps: { registry, manifest, git, edtRegistry, state }, currentBranch };
}

describe('driftOf', () => {
  it('judges a read branch, counts a detached HEAD as drifted and any other failure as unknown', () => {
    expect(driftOf('main', 'main', null)).toBe('aligned');
    expect(driftOf('hotfix', 'main', null)).toBe('drifted');
    expect(driftOf(null, 'main', GIT_DETACHED_HEAD)).toBe('drifted');
    expect(driftOf(null, 'main', 'git-error')).toBe('unknown');
  });
});

describe('listDriftCandidates', () => {
  it('lists members against their EDT branch and managed others against their sharedBranch', async () => {
    const { deps, currentBranch } = build({ branches: { '/r/b': ok('main'), '/r/c': ok('hotfix') } });

    const result = await listDriftCandidates(deps);

    expect(result).toEqual({
      ok: true,
      data: {
        active: { ulid: 'e1', topic: 'topic-a' },
        members: [
          { kind: 'member', service: 'svc-a', path: '/r/a', branch: 'feat/x', expectedBranch: 'feat/x', drift: 'aligned' },
          { kind: 'member', service: 'svc-b', path: '/r/b', branch: 'main', expectedBranch: 'feat/x', drift: 'drifted' },
        ],
        others: [{ kind: 'other', service: 'svc-c', path: '/r/c', branch: 'hotfix', expectedBranch: 'develop', drift: 'drifted' }],
      },
    });
    // One current-branch read per repo, nothing else.
    expect(currentBranch).toHaveBeenCalledTimes(3);
  });

  it('reports a detached member as drifted and an unreadable one as unknown with its detail', async () => {
    const { deps } = build({
      branches: { '/r/a': err(GIT_DETACHED_HEAD, 'detached'), '/r/b': err('git-error', 'boom') },
    });

    const result = await listDriftCandidates(deps);

    expect(result.ok && result.data.members).toEqual([
      expect.objectContaining({ service: 'svc-a', branch: null, drift: 'drifted' }),
      expect.objectContaining({ service: 'svc-b', branch: null, drift: 'unknown', detail: { code: 'git-error', message: 'boom' } }),
    ]);
  });

  it('turns a throwing member probe into an unknown row', async () => {
    const { deps, currentBranch } = build();
    currentBranch.mockImplementation(async (path: string) => {
      if (path === '/r/a') throw new Error('spawn failed');
      return ok('feat/x');
    });

    const result = await listDriftCandidates(deps);

    expect(result.ok && result.data.members[0]).toMatchObject({ service: 'svc-a', drift: 'unknown', detail: { message: 'spawn failed' } });
  });

  it('has no drift data without an active EDT', async () => {
    const { deps, currentBranch } = build({ active: null });

    expect(await listDriftCandidates(deps)).toEqual({ ok: true, data: { active: null, members: [], others: [] } });
    expect(currentBranch).not.toHaveBeenCalled();
  });

  it('propagates a failed state read', async () => {
    const { deps } = build();
    deps.state.readActiveEdt = vi.fn(async () => err('state-read-error', 'unreadable'));

    expect(await listDriftCandidates(deps)).toMatchObject({ ok: false, error: { code: 'state-read-error' } });
  });
});
