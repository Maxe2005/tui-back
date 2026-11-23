// core/workspace/scripts/group-update: unit tests against fake ports — assisted resolution of update blockers.
import { describe, expect, it, type Mock, vi } from 'vitest';
import { err, ok } from '../../../result.js';
import type { GitPort } from '../../../ports/vcs/git.js';
import { groupUpdate, type GroupUpdateParams, type OnUpdateBlocker, type UpdateBlocker, type UpdateBlockerChoice } from './group-update.js';
import { calls, edtEntry, fakeContainer, fakeEdtRegistry, fakeMigration, fakeRegistry, fakeState, member } from '../../../shared/core-ports.test-support.js';
import { fakeGit, makeParams } from './group-update.test-support.js';

describe('groupUpdate — assisted resolution', () => {
  // A scripted seam: answers each blocker with the next scripted choice, recording every
  // blocker raised.
  function scriptedSeam(choices: UpdateBlockerChoice[]): { seam: OnUpdateBlocker; blockers: UpdateBlocker[] } {
    const blockers: UpdateBlocker[] = [];
    let index = 0;
    const seam: OnUpdateBlocker = async (blocker) => {
      blockers.push(blocker);
      const choice = choices[index];
      index += 1;
      if (choice === undefined) {
        throw new Error(`seam script exhausted after ${String(index - 1)} prompts`);
      }
      return choice;
    };
    return { seam, blockers };
  }

  // A git fake that models the mid-merge state a real conflicting merge leaves behind:
  // `conflicts(repoPath, attempt)` decides whether the n-th merge of a repo conflicts; a
  // conflict sets the repo mid-merge, `abortMerge`/`finalizeMerge` clear it.
  function midMergeGit(
    conflicts: (repoPath: string, attempt: number) => boolean,
    overrides: Partial<GitPort> = {},
  ): { git: GitPort; merging: Set<string> } {
    const merging = new Set<string>();
    const attempts = new Map<string, number>();
    const git = fakeGit({
      mergeBranch: vi.fn(async (repoPath: string) => {
        const attempt = (attempts.get(repoPath) ?? 0) + 1;
        attempts.set(repoPath, attempt);
        if (conflicts(repoPath, attempt)) {
          merging.add(repoPath);
          return err('merge-conflict', 'Automatic merge failed');
        }
        return ok(undefined);
      }),
      isMergeInProgress: vi.fn(async (repoPath: string) => ok(merging.has(repoPath))),
      abortMerge: vi.fn(async (repoPath: string) => {
        merging.delete(repoPath);
        return ok(undefined);
      }),
      finalizeMerge: vi.fn(async (repoPath: string) => {
        merging.delete(repoPath);
        return ok(undefined);
      }),
      ...overrides,
    });
    return { git, merging };
  }

  it('auto-discards lockfile-only dirt silently and proceeds through merge → migrate → restart', async () => {
    const git = fakeGit();
    // Dirty at the gate, clean after the discard lands.
    (git.listDirtyPaths as unknown as Mock).mockResolvedValueOnce(ok(['package.json'])).mockResolvedValue(ok([]));
    const migration = fakeMigration();
    const container = fakeContainer();

    const result = await groupUpdate(makeParams({ git, migration, container }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [{ service: 'svc-a', outcome: 'updated' }, { service: 'svc-b', outcome: 'updated' }],
      },
    });
    expect(calls(git.discardPaths)).toContainEqual(['/repo/a', ['package.json']]);
    expect(calls(git.mergeBranch).filter(([path]) => path === '/repo/a')).toHaveLength(1);
    expect(calls(migration.run).filter(([path]) => path === '/repo/a')).toHaveLength(1);
    expect(calls(container.restart).filter(([ctr]) => ctr === 'ctr-a')).toHaveLength(1);
  });

  it('auto-discards nested lockfile paths (any depth) without prompting', async () => {
    const git = fakeGit();
    (git.listDirtyPaths as unknown as Mock)
      .mockResolvedValueOnce(ok(['services/a/package-lock.json', 'package.json']))
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValue(ok([]));

    const result = await groupUpdate(makeParams({ git, onUpdateBlocker: scriptedSeam([]).seam }));

    expect(result).toMatchObject({
      ok: true,
      data: { results: [{ service: 'svc-a', outcome: 'updated' }, { service: 'svc-b', outcome: 'updated' }] },
    });
    expect(calls(git.discardPaths)).toContainEqual(['/repo/a', ['services/a/package-lock.json', 'package.json']]);
  });

  it('treats mixed lockfile + real dirt as ordinary dirt (no silent discard)', async () => {
    const git = fakeGit({
      listDirtyPaths: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a' ? ['package.json', 'src/index.ts'] : [])),
    });

    const result = await groupUpdate(makeParams({ git }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'skipped', detail: { code: 'dirty-worktree' } },
          { service: 'svc-b', outcome: 'updated' },
        ],
      },
    });
    expect(calls(git.discardPaths)).toHaveLength(0);
  });

  it('dirty with seam: stash stashes via the git port, re-verifies clean, and resumes', async () => {
    const { seam, blockers } = scriptedSeam(['stash']);
    const git = fakeGit();
    // Dirty at the gate, clean after the stash.
    (git.listDirtyPaths as unknown as Mock).mockResolvedValueOnce(ok(['wip.txt'])).mockResolvedValue(ok([]));

    const result = await groupUpdate(makeParams({ git, onUpdateBlocker: seam }));

    expect(result).toMatchObject({
      ok: true,
      data: { results: [{ service: 'svc-a', outcome: 'updated' }, { service: 'svc-b', outcome: 'updated' }] },
    });
    expect(blockers).toEqual([{ service: 'svc-a', repoPath: '/repo/a', kind: 'dirty-worktree' }]);
    expect(calls(git.stashSave)).toContainEqual(['/repo/a', 'tui-back:update']);
    expect(calls(git.mergeBranch).filter(([path]) => path === '/repo/a')).toHaveLength(1);
  });

  // A rejected `fetch origin <b>:<b>` caused by local-only commits: the fake fails the strict
  // fetch of svc-a, then lists the commits the plain-fetch-refreshed origin ref lacks.
  function unpushedGit(strictFetchFailures: number): GitPort {
    let strictFetches = 0;
    return fakeGit({
      fetch: vi.fn(async (repoPath: string) => {
        if (repoPath === '/repo/a') {
          strictFetches += 1;
        }
        if (repoPath === '/repo/a' && strictFetches <= strictFetchFailures) {
          return err('git-fetch-error', 'rejected (non-fast-forward)');
        }
        return ok(undefined);
      }),
      listUnpushedCommits: vi.fn(async (repoPath: string) =>
        ok(repoPath === '/repo/a' && strictFetches <= strictFetchFailures ? ['45ce145 chore(deps): bump shared-types'] : []),
      ),
    });
  }

  it('unpushed commits without seam: stops the service with an explicit message naming the commits', async () => {
    const git = unpushedGit(1);

    const result = await groupUpdate(makeParams({ git }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          {
            service: 'svc-a',
            outcome: 'failed',
            detail: { code: 'unpushed-commits', message: expect.stringContaining('45ce145 chore(deps): bump shared-types') },
          },
          { service: 'svc-b', outcome: 'updated' },
        ],
      },
    });
    expect(calls(git.fetchRemote)).toContainEqual(['/repo/a', expect.any(String)]);
    expect(calls(git.mergeBranch).filter(([path]) => path === '/repo/a')).toHaveLength(0);
  });

  it('unpushed commits with seam: raises the blocker with branch and commits, `fetch` resumes the merge', async () => {
    const { seam, blockers } = scriptedSeam(['fetch']);
    const git = unpushedGit(1);

    const result = await groupUpdate(makeParams({ git, onUpdateBlocker: seam }));

    expect(result).toMatchObject({
      ok: true,
      data: { results: [{ service: 'svc-a', outcome: 'updated' }, { service: 'svc-b', outcome: 'updated' }] },
    });
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatchObject({
      service: 'svc-a',
      kind: 'unpushed-commits',
      commits: ['45ce145 chore(deps): bump shared-types'],
    });
    expect(calls(git.mergeBranch).filter(([path]) => path === '/repo/a')).toHaveLength(1);
  });

  it('unpushed commits with seam: edited retries the strict fetch, re-presenting while still blocked', async () => {
    const { seam, blockers } = scriptedSeam(['edited', 'edited']);
    const git = unpushedGit(2);

    const result = await groupUpdate(makeParams({ git, onUpdateBlocker: seam }));

    expect(result).toMatchObject({ ok: true, data: { results: [{ service: 'svc-a', outcome: 'updated' }, { service: 'svc-b' }] } });
    expect(blockers).toHaveLength(2);
    expect(blockers[1]).toMatchObject({ kind: 'unpushed-commits', retry: 1 });
  });

  it('unpushed commits with seam: cancel-repo skips the service, cancel-run stops the run', async () => {
    const skipRepo = await groupUpdate(makeParams({ git: unpushedGit(1), onUpdateBlocker: scriptedSeam(['cancel-repo']).seam }));
    expect(skipRepo).toMatchObject({
      ok: true,
      data: { results: [{ service: 'svc-a', outcome: 'skipped', detail: { code: 'unpushed-commits' } }, { service: 'svc-b', outcome: 'updated' }] },
    });

    const git = unpushedGit(1);
    const stopRun = await groupUpdate(makeParams({ git, onUpdateBlocker: scriptedSeam(['cancel-run']).seam }));
    expect(stopRun).toMatchObject({ ok: true, data: { results: [{ service: 'svc-a', outcome: 'skipped' }, { service: 'svc-b', outcome: 'skipped' }] } });
  });

  it('a fetch failure with no unpushed commits stays a plain git-fetch-error', async () => {
    const { seam, blockers } = scriptedSeam([]);
    const git = fakeGit({
      fetch: vi.fn(async (repoPath: string) => (repoPath === '/repo/a' ? err('git-fetch-error', 'offline') : ok(undefined))),
    });

    const result = await groupUpdate(makeParams({ git, onUpdateBlocker: seam }));

    expect(result).toMatchObject({ ok: true, data: { results: [{ service: 'svc-a', outcome: 'failed', detail: { code: 'git-fetch-error' } }, { service: 'svc-b' }] } });
    expect(blockers).toHaveLength(0);
  });

  it('dirty with seam: edited re-verifies before resuming', async () => {
    const { seam, blockers } = scriptedSeam(['edited']);
    const git = fakeGit();
    (git.listDirtyPaths as unknown as Mock)
      .mockResolvedValueOnce(ok(['wip.txt']))
      .mockResolvedValue(ok([]));

    const result = await groupUpdate(makeParams({ git, onUpdateBlocker: seam }));

    expect(result).toMatchObject({
      ok: true,
      data: { results: [{ service: 'svc-a', outcome: 'updated' }, { service: 'svc-b', outcome: 'updated' }] },
    });
    expect(blockers).toEqual([{ service: 'svc-a', repoPath: '/repo/a', kind: 'dirty-worktree' }]);
    // `edited` never writes through git itself — no stash, the menu only re-verifies.
    expect(calls(git.stashSave)).toHaveLength(0);
  });

  it('dirty with seam: still dirty after stash re-presents the menu', async () => {
    const { seam, blockers } = scriptedSeam(['stash', 'cancel-repo']);
    const git = fakeGit({
      listDirtyPaths: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a' ? ['wip.txt'] : [])),
    });

    const result = await groupUpdate(makeParams({ git, onUpdateBlocker: seam }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'skipped', detail: { code: 'dirty-worktree' } },
          { service: 'svc-b', outcome: 'updated' },
        ],
      },
    });
    expect(blockers).toHaveLength(2);
    expect(blockers.every((blocker) => blocker.kind === 'dirty-worktree')).toBe(true);
    expect(calls(git.mergeBranch).filter(([path]) => path === '/repo/a')).toHaveLength(0);
  });

  it('dirty with seam: cancel-repo skips only that repo without aborting anything', async () => {
    const { seam } = scriptedSeam(['cancel-repo']);
    const git = fakeGit({
      listDirtyPaths: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a' ? ['wip.txt'] : [])),
    });

    const result = await groupUpdate(makeParams({ git, onUpdateBlocker: seam }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'skipped', detail: { code: 'dirty-worktree' } },
          { service: 'svc-b', outcome: 'updated' },
        ],
      },
    });
    expect(calls(git.abortMerge)).toHaveLength(0);
  });

  it('dirty with seam: cancel-run stops the loop with rows so far, all skipped-never-failed', async () => {
    const { seam } = scriptedSeam(['cancel-run']);
    const git = fakeGit({
      listDirtyPaths: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a' ? ['wip.txt'] : [])),
    });

    const result = await groupUpdate(makeParams({ git, onUpdateBlocker: seam }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'skipped', detail: { code: 'dirty-worktree' } },
          { service: 'svc-b', outcome: 'skipped', detail: { code: 'run-cancelled' } },
        ],
      },
    });
    if (result.ok) {
      expect(result.data.results).toHaveLength(2);
    }
    // The run stopped: the second repo was never even read.
    expect(calls(git.currentBranch).filter(([path]) => path === '/repo/b')).toHaveLength(0);
  });

  it('mid-run conflict with seam: cancel-repo aborts the own-started merge into a skipped row', async () => {
    const { seam } = scriptedSeam(['cancel-repo']);
    const git = fakeGit({
      mergeBranch: vi.fn(async (repoPath: string) =>
        repoPath === '/repo/a' ? err('merge-conflict', 'Automatic merge failed') : ok(undefined),
      ),
    });

    const result = await groupUpdate(makeParams({ git, onUpdateBlocker: seam }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'skipped', detail: { code: 'merge-conflict' } },
          { service: 'svc-b', outcome: 'updated' },
        ],
      },
    });
    expect(calls(git.abortMerge)).toEqual([['/repo/a']]);
  });

  it('mid-run conflict with seam: a stash answer never stashes — it re-presents the menu', async () => {
    const { seam, blockers } = scriptedSeam(['stash', 'edited']);
    const { git } = midMergeGit((repoPath) => repoPath === '/repo/a');

    const result = await groupUpdate(makeParams({ git, onUpdateBlocker: seam }));

    expect(result).toMatchObject({
      ok: true,
      data: { results: [{ service: 'svc-a', outcome: 'updated' }, { service: 'svc-b', outcome: 'updated' }] },
    });
    expect(blockers.map((blocker) => blocker.retry)).toEqual([undefined, 1]);
    expect(blockers[1]?.retryReason).toMatch(/stash is not available/i);
    expect(calls(git.stashSave)).toHaveLength(0);
    expect(calls(git.abortMerge)).toHaveLength(0);
  });

  it('mid-run conflict with seam: edited with zero unmerged paths finalizes the merge and continues', async () => {
    const { seam, blockers } = scriptedSeam(['edited']);
    const migration = fakeMigration();
    const container = fakeContainer();
    const { git } = midMergeGit((repoPath) => repoPath === '/repo/a');

    const result = await groupUpdate(makeParams({ git, migration, container, onUpdateBlocker: seam }));

    expect(result).toMatchObject({
      ok: true,
      data: { results: [{ service: 'svc-a', outcome: 'updated' }, { service: 'svc-b', outcome: 'updated' }] },
    });
    expect(blockers).toEqual([{ service: 'svc-a', repoPath: '/repo/a', kind: 'merge-conflict' }]);
    expect(calls(git.finalizeMerge)).toEqual([['/repo/a']]);
    // Finalized, not aborted — and the pipeline continued through migrate + restart.
    expect(calls(git.abortMerge)).toHaveLength(0);
    expect(calls(migration.run).filter(([path]) => path === '/repo/a')).toHaveLength(1);
    expect(calls(container.restart).filter(([ctr]) => ctr === 'ctr-a')).toHaveLength(1);
  });

  it('mid-run conflict with seam: a still-conflicted edited re-presents the menu with a growing retry counter until cancel-repo', async () => {
    const { seam, blockers } = scriptedSeam(['edited', 'edited', 'edited', 'cancel-repo']);
    const migration = fakeMigration();
    const { git } = midMergeGit((repoPath) => repoPath === '/repo/a', { hasUnmergedPaths: vi.fn(async () => ok(true)) });

    const result = await groupUpdate(makeParams({ git, migration, onUpdateBlocker: seam }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'skipped', detail: { code: 'merge-conflict' } },
          { service: 'svc-b', outcome: 'updated' },
        ],
      },
    });
    expect(blockers.map((blocker) => blocker.retry)).toEqual([undefined, 1, 2, 3]);
    expect(blockers[1]?.retryReason).toMatch(/unmerged paths remain/i);
    // Never a re-merge on top of a live merge, never finalized, aborted only by the cancel.
    expect(calls(git.mergeBranch).filter(([path]) => path === '/repo/a')).toHaveLength(1);
    expect(calls(git.finalizeMerge)).toHaveLength(0);
    expect(calls(git.abortMerge)).toEqual([['/repo/a']]);
    expect(calls(migration.run).filter(([path]) => path === '/repo/a')).toHaveLength(0);
  });

  it('mid-run conflict with seam: cancel-run after retries aborts the merge and stops the run', async () => {
    const { seam, blockers } = scriptedSeam(['edited', 'cancel-run']);
    const { git } = midMergeGit((repoPath) => repoPath === '/repo/a', { hasUnmergedPaths: vi.fn(async () => ok(true)) });

    const result = await groupUpdate(makeParams({ git, onUpdateBlocker: seam }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'skipped', detail: { code: 'merge-conflict' } },
          { service: 'svc-b', outcome: 'skipped', detail: { code: 'run-cancelled' } },
        ],
      },
    });
    expect(blockers.map((blocker) => blocker.retry)).toEqual([undefined, 1]);
    expect(calls(git.abortMerge)).toEqual([['/repo/a']]);
    expect(calls(git.currentBranch).filter(([path]) => path === '/repo/b')).toHaveLength(0);
  });

  it('mid-run conflict with seam: a merge aborted from the editor is retried, and a fresh conflict re-presents', async () => {
    const { git, merging } = midMergeGit((repoPath, attempt) => repoPath === '/repo/a' && attempt <= 2);
    const blockers: UpdateBlocker[] = [];
    const seam: OnUpdateBlocker = async (blocker) => {
      blockers.push(blocker);
      // Each prompt: the developer runs `git merge --abort` from the editor.
      merging.delete(blocker.repoPath);
      return 'edited';
    };

    const result = await groupUpdate(makeParams({ git, onUpdateBlocker: seam }));

    expect(result).toMatchObject({
      ok: true,
      data: { results: [{ service: 'svc-a', outcome: 'updated' }, { service: 'svc-b', outcome: 'updated' }] },
    });
    // Merge 1 conflicts, retry merge 2 conflicts again (prompt #2, retry 1), retry merge 3 lands.
    expect(calls(git.mergeBranch).filter(([path]) => path === '/repo/a')).toHaveLength(3);
    expect(blockers.map((blocker) => blocker.retry)).toEqual([undefined, 1]);
    expect(blockers[1]?.retryReason).toMatch(/conflicted again/i);
  });

  it('a failing merge finalization re-presents the menu with its reason, never aborted', async () => {
    let finalizes = 0;
    const { seam, blockers } = scriptedSeam(['edited', 'edited']);
    const migration = fakeMigration();
    const container = fakeContainer();
    const { git } = midMergeGit((repoPath) => repoPath === '/repo/a');
    const finalizeMerge = vi.fn(async () => {
      finalizes += 1;
      return finalizes <= 1 ? err('git-commit-error', 'pre-commit hook failed') : ok(undefined);
    });
    git.finalizeMerge = finalizeMerge;

    const result = await groupUpdate(makeParams({ git, migration, container, onUpdateBlocker: seam }));

    expect(result).toMatchObject({
      ok: true,
      data: { results: [{ service: 'svc-a', outcome: 'updated' }, { service: 'svc-b', outcome: 'updated' }] },
    });
    expect(blockers.map((blocker) => blocker.retry)).toEqual([undefined, 1]);
    expect(blockers[1]?.retryReason).toBe('pre-commit hook failed');
    // The tree carries the developer's own resolution — aborting it away is forbidden.
    expect(calls(git.abortMerge)).toHaveLength(0);
    expect(calls(finalizeMerge)).toHaveLength(2);
  });

  it('pre-existing mid-merge without a seam is a distinct skipped row, never aborted', async () => {
    const git = fakeGit({
      isMergeInProgress: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a')),
    });

    const result = await groupUpdate(makeParams({ git }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'skipped', detail: { code: 'mid-merge' } },
          { service: 'svc-b', outcome: 'updated' },
        ],
      },
    });
    expect(calls(git.abortMerge)).toHaveLength(0);
    expect(calls(git.mergeBranch).filter(([path]) => path === '/repo/a')).toHaveLength(0);
  });

  it('pre-existing mid-rebase without a seam is a distinct skipped row, rebase never touched', async () => {
    const git = fakeGit({
      isRebaseInProgress: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a')),
    });

    const result = await groupUpdate(makeParams({ git }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'skipped', detail: { code: 'mid-rebase' } },
          { service: 'svc-b', outcome: 'updated' },
        ],
      },
    });
    expect(calls(git.abortMerge)).toHaveLength(0);
    expect(calls(git.mergeBranch).filter(([path]) => path === '/repo/a')).toHaveLength(0);
  });

  it('pre-existing mid-merge with seam: menu applies after the report, edited resumes when cleared', async () => {
    const { seam, blockers } = scriptedSeam(['edited']);
    const git = fakeGit();
    // Mid-merge at arrival, cleared by the hand resolution the `edited` choice reports.
    (git.isMergeInProgress as unknown as Mock)
      .mockResolvedValueOnce(ok(true))
      .mockResolvedValueOnce(ok(false))
      .mockResolvedValue(ok(false));

    const result = await groupUpdate(makeParams({ git, onUpdateBlocker: seam }));

    expect(result).toMatchObject({
      ok: true,
      data: { results: [{ service: 'svc-a', outcome: 'updated' }, { service: 'svc-b', outcome: 'updated' }] },
    });
    expect(blockers).toEqual([{ service: 'svc-a', repoPath: '/repo/a', kind: 'mid-merge' }]);
    expect(calls(git.abortMerge)).toHaveLength(0);
    expect(calls(git.mergeBranch).filter(([path]) => path === '/repo/a')).toHaveLength(1);
  });

  it('pre-existing mid-merge with seam: cancel-repo never aborts it', async () => {
    const { seam, blockers } = scriptedSeam(['cancel-repo']);
    const git = fakeGit({
      isMergeInProgress: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a')),
    });

    const result = await groupUpdate(makeParams({ git, onUpdateBlocker: seam }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'skipped', detail: { code: 'mid-merge' } },
          { service: 'svc-b', outcome: 'updated' },
        ],
      },
    });
    expect(blockers).toEqual([{ service: 'svc-a', repoPath: '/repo/a', kind: 'mid-merge' }]);
    expect(calls(git.abortMerge)).toHaveLength(0);
  });

  it('a throwing seam folds into a per-service failed row, others continue', async () => {
    const git = fakeGit({
      listDirtyPaths: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a' ? ['wip.txt'] : [])),
    });
    const exploding: OnUpdateBlocker = async () => {
      throw new Error('menu crashed');
    };

    const result = await groupUpdate(makeParams({ git, onUpdateBlocker: exploding }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'failed', detail: { code: 'internal-error' } },
          { service: 'svc-b', outcome: 'updated' },
        ],
      },
    });
  });

  it('lockfile auto-fix applies in the all-repos scope too', async () => {
    const git = fakeGit();
    (git.listDirtyPaths as unknown as Mock)
      .mockResolvedValueOnce(ok(['package.json']))
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValue(ok([]));
    const params: GroupUpdateParams = {
      ...makeParams({ git }),
      registry: fakeRegistry(['/repo/a']),
      scope: 'all',
    };

    const result = await groupUpdate(params);

    expect(result).toMatchObject({
      ok: true,
      data: { ulid: 'all', scope: 'all', results: [{ service: 'a', outcome: 'updated' }] },
    });
    expect(calls(git.discardPaths)).toContainEqual(['/repo/a', ['package.json']]);
  });

  it('a failing lockfile discard is a failed row with its code, touching no pull/merge/migration/restart', async () => {
    const git = fakeGit({
      listDirtyPaths: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a' ? ['package.json'] : [])),
      discardPaths: vi.fn(async () => err('git-discard-error', 'git checkout -- failed')),
    });
    const migration = fakeMigration();
    const container = fakeContainer();

    const result = await groupUpdate(makeParams({ git, migration, container }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'failed', detail: { code: 'git-discard-error' } },
          { service: 'svc-b', outcome: 'updated' },
        ],
      },
    });
    expect(calls(git.mergeBranch).filter(([path]) => path === '/repo/a')).toHaveLength(0);
    expect(calls(git.pull).filter(([path]) => path === '/repo/a')).toHaveLength(0);
    expect(calls(migration.run).filter(([path]) => path === '/repo/a')).toHaveLength(0);
    expect(calls(container.restart).filter(([ctr]) => ctr === 'ctr-a')).toHaveLength(0);
  });

  it('pull-path conflict with seam: edited finalizes via pull, never mergeBranch', async () => {
    const onShared = edtEntry('edt-shared', 'shared', [member('svc-a', '/repo/a', 'development')]);
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([onShared])) });
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok('edt-shared')) });
    const { seam, blockers } = scriptedSeam(['edited']);
    // No mid-merge before the pull (pre-existing check passes); the failed pull leaves one.
    let pullCalled = false;
    const migration = fakeMigration();
    const container = fakeContainer();
    const git = fakeGit({
      currentBranch: vi.fn(async () => ok('development')),
      pull: vi.fn(async () => {
        pullCalled = true;
        return err('git-pull-error', 'pull conflicts');
      }),
      isMergeInProgress: vi.fn(async () => ok(pullCalled)),
      hasUnmergedPaths: vi.fn(async () => ok(false)),
      listUnmergedPaths: vi.fn(async () => ok([] as string[])),
      readWorktreeFile: vi.fn(async () => ok("")),
      writeResolvedFile: vi.fn(async () => ok(undefined)),
      checkoutSide: vi.fn(async () => ok(undefined)),
    });

    const result = await groupUpdate(makeParams({ edtRegistry, state, git, migration, container, onUpdateBlocker: seam }));

    expect(result).toMatchObject({
      ok: true,
      data: { results: [{ service: 'svc-a', outcome: 'updated' }] },
    });
    expect(blockers).toEqual([{ service: 'svc-a', repoPath: '/repo/a', kind: 'merge-conflict' }]);
    expect(calls(git.finalizeMerge)).toEqual([['/repo/a']]);
    expect(calls(git.pull)).toHaveLength(1);
    expect(calls(git.mergeBranch)).toHaveLength(0);
    expect(calls(git.abortMerge)).toHaveLength(0);
    expect(calls(migration.run)).toEqual([['/repo/a', 'npm run migration:run']]);
    expect(calls(container.restart)).toEqual([['ctr-a']]);
  });


  it('pull-path conflict with seam: a still-conflicted edited re-presents, never re-pulls on a live merge', async () => {
    const onShared = edtEntry('edt-shared', 'shared', [member('svc-a', '/repo/a', 'development')]);
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([onShared])) });
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok('edt-shared')) });
    const { seam, blockers } = scriptedSeam(['edited', 'cancel-repo']);
    let pullCalled = false;
    const git = fakeGit({
      currentBranch: vi.fn(async () => ok('development')),
      pull: vi.fn(async () => {
        pullCalled = true;
        return err('git-pull-error', 'pull conflicts');
      }),
      isMergeInProgress: vi.fn(async () => ok(pullCalled)),
      hasUnmergedPaths: vi.fn(async () => ok(true)),
    });

    const result = await groupUpdate(makeParams({ edtRegistry, state, git, onUpdateBlocker: seam }));

    expect(result).toMatchObject({
      ok: true,
      data: { results: [{ service: 'svc-a', outcome: 'skipped', detail: { code: 'merge-conflict' } }] },
    });
    expect(blockers.map((blocker) => blocker.retry)).toEqual([undefined, 1]);
    expect(calls(git.pull)).toHaveLength(1);
    expect(calls(git.mergeBranch)).toHaveLength(0);
  });
});
