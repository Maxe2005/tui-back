import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '../result.js';
import type { GitPort, VersionBump, VersionBumpWalkOptions } from '../ports/git.js';
import { isValidHistoryVersion, searchByBranch, searchByVersion } from './version-history.js';

function fakeGit(
  bumps: VersionBump[],
  endedBy: 'limit' | 'scanned' | 'exhausted' | 'aborted' = 'exhausted',
  containing: Record<string, string[]> = {},
): { git: GitPort; walk: ReturnType<typeof vi.fn>; contain: ReturnType<typeof vi.fn> } {
  const walk = vi.fn(async (_repo: string, _ref: string, opts: VersionBumpWalkOptions) => {
    for (const bump of bumps) {
      opts.onEntry(bump);
    }
    return ok({ endedBy, scanned: bumps.length });
  });
  const contain = vi.fn(async (_repo: string, commit: string) => ok(containing[commit] ?? []));
  return { git: { listVersionBumpCommits: walk, listBranchesContaining: contain } as unknown as GitPort, walk, contain };
}

const bump = (version: string, commit: string, date: string): VersionBump => ({ version, commit, date });

describe('isValidHistoryVersion', () => {
  it.each([['0.1.3770', true], ['0.1', false], ['a.b.c', false], ['1.2.3-beta', false], ['', false], ['v1.2.3', false]])('%s -> %s', (value, expected) => {
    expect(isValidHistoryVersion(value)).toBe(expected);
  });
});

describe('searchByBranch', () => {
  it('streams entries tagged with the branch and maps a limit stop to depth', async () => {
    const { git, walk } = fakeGit([bump('0.1.3', 'c3', '2026-01-03'), bump('0.1.2', 'c2', '2026-01-02')], 'limit');
    const seen: string[] = [];
    const result = await searchByBranch({ git, repoPath: '/r', branch: ' feat/x ', depth: 2, maxScanned: 1000, onEntry: (e) => seen.push(e.version) });
    expect(seen).toEqual(['0.1.3', '0.1.2']);
    expect(result).toEqual({
      ok: true,
      data: {
        endedBy: 'depth',
        scanned: 2,
        entries: [
          { version: '0.1.3', commit: 'c3', date: '2026-01-03', branch: 'feat/x' },
          { version: '0.1.2', commit: 'c2', date: '2026-01-02', branch: 'feat/x' },
        ],
      },
    });
    expect(walk).toHaveBeenCalledWith('/r', 'feat/x', expect.objectContaining({ limit: 2, maxScanned: 1000 }));
  });

  it.each([['scanned'], ['exhausted']] as const)('reports %s', async (endedBy) => {
    const { git } = fakeGit([bump('0.1.1', 'c1', 'd')], endedBy);
    const result = await searchByBranch({ git, repoPath: '/r', branch: 'b', depth: 20, maxScanned: 100 });
    expect(result.ok && result.data.endedBy).toBe(endedBy);
  });

  it('surfaces a git failure as an error result', async () => {
    const git = { listVersionBumpCommits: vi.fn(async () => err('git-history-error', 'unknown ref')) } as unknown as GitPort;
    const result = await searchByBranch({ git, repoPath: '/r', branch: 'nope', depth: 20, maxScanned: 100 });
    expect(result).toEqual({ ok: false, error: { code: 'git-history-error', message: 'unknown ref' } });
  });

  it('reports no stale entry once aborted', async () => {
    const controller = new AbortController();
    const git = {
      listVersionBumpCommits: vi.fn(async (_r: string, _ref: string, opts: VersionBumpWalkOptions) => {
        opts.onEntry(bump('0.1.2', 'c2', 'd'));
        controller.abort();
        opts.onEntry(bump('0.1.1', 'c1', 'd'));
        return ok({ endedBy: 'aborted' as const, scanned: 2 });
      }),
    } as unknown as GitPort;
    const seen: string[] = [];
    const result = await searchByBranch({ git, repoPath: '/r', branch: 'b', depth: 20, maxScanned: 100, signal: controller.signal, onEntry: (e) => seen.push(e.version) });
    expect(seen).toEqual(['0.1.2']);
    expect(result.ok && result.data.endedBy).toBe('aborted');
  });

  it.each(['--all', '-x', '--output=/tmp/x'])('rejects the option-like branch %s without any git call', async (branch) => {
    const { git, walk } = fakeGit([]);
    const result = await searchByBranch({ git, repoPath: '/r', branch, depth: 20, maxScanned: 100 });
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-branch' } });
    expect(walk).not.toHaveBeenCalled();
  });

  it('rejects an empty branch without any git call', async () => {
    const { git, walk } = fakeGit([]);
    const result = await searchByBranch({ git, repoPath: '/r', branch: '  ', depth: 20, maxScanned: 100 });
    expect(result.ok).toBe(false);
    expect(walk).not.toHaveBeenCalled();
  });
});

describe('searchByVersion', () => {
  it('flags the earliest-introducing branch and hit', async () => {
    const { git } = fakeGit(
      [bump('0.1.3770', 'late', '2026-03-01T00:00:00Z'), bump('0.1.3770', 'early', '2026-02-01T00:00:00Z')],
      'exhausted',
      { late: ['release', 'main'], early: ['feat/y', 'main'] },
    );
    const result = await searchByVersion({ git, repoPath: '/r', version: '0.1.3770' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.found).toBe(true);
      expect(result.data.branches).toEqual(['release', 'main', 'feat/y']);
      expect(result.data.earliestBranch).toBe('main');
      expect(result.data.hits.map((hit) => [hit.commit, hit.earliest])).toEqual([['late', false], ['early', true]]);
    }
  });

  it('answers explicitly when the version was never set', async () => {
    const { git } = fakeGit([]);
    const result = await searchByVersion({ git, repoPath: '/r', version: '9.9.9' });
    expect(result).toMatchObject({ ok: true, data: { found: false, hits: [], branches: [], earliestBranch: null } });
  });

  it('rejects an invalid version before any git call', async () => {
    const { git, walk, contain } = fakeGit([]);
    for (const version of ['0.1', 'a.b.c']) {
      const result = await searchByVersion({ git, repoPath: '/r', version });
      expect(result).toMatchObject({ ok: false, error: { code: 'invalid-version' } });
    }
    expect(walk).not.toHaveBeenCalled();
    expect(contain).not.toHaveBeenCalled();
  });

  it('surfaces a failure listing the containing branches', async () => {
    const git = {
      listVersionBumpCommits: vi.fn(async (_r: string, _ref: string, opts: VersionBumpWalkOptions) => {
        opts.onEntry(bump('0.1.5', 'c', '2026-01-01T00:00:00Z'));
        return ok({ endedBy: 'exhausted' as const, scanned: 1 });
      }),
      listBranchesContaining: vi.fn(async () => err('git-history-error', 'boom')),
    } as unknown as GitPort;
    const result = await searchByVersion({ git, repoPath: '/r', version: '0.1.5' });
    expect(result).toMatchObject({ ok: false, error: { code: 'git-history-error' } });
  });

  it('walks every branch through allRefs, never the --all sentinel', async () => {
    const { git, walk } = fakeGit([]);
    await searchByVersion({ git, repoPath: '/r', version: '1.2.3' });
    expect(walk).toHaveBeenCalledWith('/r', '', expect.objectContaining({ allRefs: true, pickaxeVersion: '1.2.3' }));
  });

  it('streams each hit before the walk has ended', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const git = {
      listVersionBumpCommits: vi.fn(async (_r: string, _ref: string, opts: VersionBumpWalkOptions) => {
        opts.onEntry(bump('0.1.5', 'a', '2026-01-02T00:00:00Z'));
        await gate;
        return ok({ endedBy: 'exhausted' as const, scanned: 1 });
      }),
      listBranchesContaining: vi.fn(async () => ok(['main'])),
    } as unknown as GitPort;
    const hits: string[] = [];
    const running = searchByVersion({ git, repoPath: '/r', version: '0.1.5', onHit: (hit) => hits.push(hit.commit) });
    await vi.waitFor(() => expect(hits).toEqual(['a']));
    release();
    expect(await running).toMatchObject({ ok: true, data: { found: true, truncated: false } });
  });

  it.each(['limit', 'scanned'] as const)('flags a miss as truncated, not "not found", when the walk ended on %s', async (endedBy) => {
    const { git } = fakeGit([], endedBy);
    const result = await searchByVersion({ git, repoPath: '/r', version: '9.9.9' });
    expect(result).toMatchObject({ ok: true, data: { found: false, truncated: true } });
  });

  it('never flags a branchless hit or a NaN-dated hit as the earliest', async () => {
    const { git } = fakeGit(
      [bump('0.1.5', 'orphan', '2020-01-01T00:00:00Z'), bump('0.1.5', 'garbled', 'not-a-date'), bump('0.1.5', 'good', '2026-01-01T00:00:00Z')],
      'exhausted',
      { orphan: [], garbled: ['x'], good: ['main'] },
    );
    const result = await searchByVersion({ git, repoPath: '/r', version: '0.1.5' });
    expect(result.ok && result.data.hits.map((hit) => [hit.commit, hit.earliest])).toEqual([['orphan', false], ['garbled', false], ['good', true]]);
    expect(result.ok && result.data.earliestBranch).toBe('main');
  });

  it('stops listing hits once aborted', async () => {
    const controller = new AbortController();
    const git = {
      listVersionBumpCommits: vi.fn(async (_r: string, _ref: string, opts: VersionBumpWalkOptions) => {
        opts.onEntry(bump('0.1.5', 'a', '2026-01-02T00:00:00Z'));
        opts.onEntry(bump('0.1.5', 'b', '2026-01-01T00:00:00Z'));
        return ok({ endedBy: 'exhausted' as const, scanned: 2 });
      }),
      listBranchesContaining: vi.fn(async () => {
        controller.abort();
        return ok(['main']);
      }),
    } as unknown as GitPort;
    const hits: string[] = [];
    const result = await searchByVersion({ git, repoPath: '/r', version: '0.1.5', signal: controller.signal, onHit: (hit) => hits.push(hit.commit) });
    expect(hits).toEqual([]);
    expect(result.ok && result.data.aborted).toBe(true);
  });
});
