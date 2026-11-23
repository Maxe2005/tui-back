// core/workspace/scripts/group-update: unit tests against fake ports — the conflict auto-resolution seam.
import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '../../../result.js';
import type { GitPort } from '../../../ports/vcs/git.js';
import { type AutoResolveConflict, groupUpdate, type OnUpdateBlocker, type UpdateBlocker, type UpdateBlockerChoice } from './group-update.js';
import { calls, edtEntry, fakeEdtRegistry, fakeState, member } from '../../../shared/core-ports.test-support.js';
import { fakeGit, makeParams } from './group-update.test-support.js';

describe('groupUpdate — conflict auto-resolution seam', () => {
  function seamOf(choices: UpdateBlockerChoice[]): { seam: OnUpdateBlocker; blockers: UpdateBlocker[] } {
    const blockers: UpdateBlocker[] = [];
    let index = 0;
    const seam: OnUpdateBlocker = async (blocker) => {
      blockers.push(blocker);
      const choice = choices[index];
      index += 1;
      if (choice === undefined) {
        throw new Error('seam script exhausted');
      }
      return choice;
    };
    return { seam, blockers };
  }

  // Merge of /repo/a conflicts once (pull path: when `pulling`), leaving it mid-merge until finalized.
  function conflictGit(overrides: Partial<GitPort> = {}): GitPort {
    const merging = new Set<string>();
    return fakeGit({
      mergeBranch: vi.fn(async (repoPath: string) => {
        if (repoPath === '/repo/a' && !merging.has('done')) {
          merging.add(repoPath);
          return err('merge-conflict', 'Automatic merge failed');
        }
        return ok(undefined);
      }),
      isMergeInProgress: vi.fn(async (repoPath: string) => ok(merging.has(repoPath))),
      finalizeMerge: vi.fn(async (repoPath: string) => {
        merging.delete(repoPath);
        merging.add('done');
        return ok(undefined);
      }),
      ...overrides,
    });
  }

  it('settling everything finalizes the merge with no menu and marks the row auto-resolved', async () => {
    const { seam, blockers } = seamOf([]);
    const git = conflictGit();
    const autoResolveConflict: AutoResolveConflict = vi.fn(async () => ({ touched: true }));

    const result = await groupUpdate(makeParams({ git, onUpdateBlocker: seam, autoResolveConflict }));

    expect(result).toMatchObject({
      ok: true,
      data: { results: [{ service: 'svc-a', outcome: 'updated', run: { conflict: 'auto-resolved' } }, { service: 'svc-b', outcome: 'updated' }] },
    });
    expect(blockers).toEqual([]);
    expect(calls(git.finalizeMerge)).toEqual([['/repo/a']]);
    expect(autoResolveConflict).toHaveBeenCalledWith({ service: 'svc-a', repoPath: '/repo/a' });
    const rows = (result as { ok: true; data: { results: { run?: { conflict?: string } }[] } }).data.results;
    expect(rows[1]?.run?.conflict).toBeUndefined();
  });

  it('presents only the rest when unmerged paths remain, reruns after edited, and marks the row partial', async () => {
    const { seam, blockers } = seamOf(['edited']);
    const hasUnmergedPaths = vi.fn().mockResolvedValueOnce(ok(true)).mockResolvedValue(ok(false));
    const git = conflictGit({ hasUnmergedPaths: hasUnmergedPaths as unknown as GitPort['hasUnmergedPaths'] });
    const autoResolveConflict: AutoResolveConflict = vi.fn(async () => ({ touched: true }));

    const result = await groupUpdate(makeParams({ git, onUpdateBlocker: seam, autoResolveConflict }));

    expect(result).toMatchObject({ ok: true, data: { results: [{ service: 'svc-a', outcome: 'updated', run: { conflict: 'partial' } }, { service: 'svc-b' }] } });
    expect(blockers).toEqual([{ service: 'svc-a', repoPath: '/repo/a', kind: 'merge-conflict' }]);
    // Before the menu, then once more after the developer's `edited`.
    expect(autoResolveConflict).toHaveBeenCalledTimes(2);
    expect(calls(git.finalizeMerge)).toEqual([['/repo/a']]);
  });

  it('runs the seam again after edited so the lockfile is regenerated before finalization', async () => {
    const { seam } = seamOf(['edited']);
    const events: string[] = [];
    const git = conflictGit({
      hasUnmergedPaths: vi.fn(async () => ok(events.includes('npm-i') ? false : true)),
      finalizeMerge: vi.fn(async () => {
        events.push('finalize');
        return ok(undefined);
      }),
    });
    let pass = 0;
    const autoResolveConflict: AutoResolveConflict = async () => {
      pass += 1;
      if (pass === 2) {
        events.push('npm-i');
      }
      return { touched: pass === 2 };
    };

    await groupUpdate(makeParams({ git, onUpdateBlocker: seam, autoResolveConflict }));

    expect(events).toEqual(['npm-i', 'finalize']);
  });

  it('carries the resolver issue note on the incident and marks the row left-to-user', async () => {
    const { seam, blockers } = seamOf(['edited']);
    const git = conflictGit();
    const autoResolveConflict: AutoResolveConflict = vi.fn(async () => ({ touched: false, issue: 'the line sits in a mixed block' }));

    const result = await groupUpdate(makeParams({ git, onUpdateBlocker: seam, autoResolveConflict }));

    expect(blockers[0]).toMatchObject({ kind: 'merge-conflict', autoResolveNote: 'the line sits in a mixed block' });
    expect(result).toMatchObject({ ok: true, data: { results: [{ service: 'svc-a', run: { conflict: 'left-to-user' } }, { service: 'svc-b' }] } });
  });

  it('a throwing seam becomes an issue note, never a failed run', async () => {
    const { seam, blockers } = seamOf(['edited']);
    const git = conflictGit();
    const autoResolveConflict: AutoResolveConflict = async () => {
      throw new Error('boom');
    };

    const result = await groupUpdate(makeParams({ git, onUpdateBlocker: seam, autoResolveConflict }));

    expect(blockers[0]?.autoResolveNote).toContain('boom');
    expect(result).toMatchObject({ ok: true, data: { results: [{ service: 'svc-a', outcome: 'updated' }, { service: 'svc-b' }] } });
  });

  it('applies to a conflicting pull as well, finalizing via the same path', async () => {
    const onShared = edtEntry('edt-shared', 'shared', [member('svc-a', '/repo/a', 'development')]);
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([onShared])) });
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok('edt-shared')) });
    const { seam, blockers } = seamOf([]);
    let pulled = false;
    const git = fakeGit({
      currentBranch: vi.fn(async () => ok('development')),
      pull: vi.fn(async () => {
        pulled = true;
        return err('git-pull-error', 'pull conflicts');
      }),
      isMergeInProgress: vi.fn(async () => ok(pulled)),
    });
    const autoResolveConflict: AutoResolveConflict = vi.fn(async () => ({ touched: true }));

    const result = await groupUpdate(makeParams({ edtRegistry, state, git, onUpdateBlocker: seam, autoResolveConflict }));

    expect(result).toMatchObject({ ok: true, data: { results: [{ service: 'svc-a', outcome: 'updated', run: { conflict: 'auto-resolved' } }] } });
    expect(blockers).toEqual([]);
    expect(calls(git.mergeBranch)).toHaveLength(0);
    expect(calls(git.finalizeMerge)).toEqual([['/repo/a']]);
  });

  it('never runs without the blocker seam: the conflicting merge is aborted as before', async () => {
    const git = conflictGit({ abortMerge: vi.fn(async () => ok(undefined)) });
    const autoResolveConflict: AutoResolveConflict = vi.fn(async () => ({ touched: true }));

    const result = await groupUpdate(makeParams({ git, autoResolveConflict }));

    expect(result).toMatchObject({ ok: true, data: { results: [{ service: 'svc-a', outcome: 'failed', detail: { code: 'merge-conflict' } }, { service: 'svc-b' }] } });
    expect(autoResolveConflict).not.toHaveBeenCalled();
  });

  it('a finalize read failing after a touching pre-menu pass ends the repo as a failed row', async () => {
    const { seam, blockers } = seamOf([]);
    const git = conflictGit({ hasUnmergedPaths: vi.fn(async () => err('git-unmerged-check-error', 'cannot check')) });
    const autoResolveConflict: AutoResolveConflict = async () => ({ touched: true });

    const result = await groupUpdate(makeParams({ git, onUpdateBlocker: seam, autoResolveConflict }));

    expect(result).toMatchObject({
      ok: true,
      data: { results: [{ service: 'svc-a', outcome: 'failed', detail: { code: 'git-unmerged-check-error' }, run: { conflict: 'partial' } }, { service: 'svc-b' }] },
    });
    expect(blockers).toEqual([]);
  });

  it('never labels a row auto-resolved when the last pass carried an issue (npm i failure)', async () => {
    const { seam } = seamOf([]);
    const git = conflictGit();
    const autoResolveConflict: AutoResolveConflict = async () => ({ touched: true, issue: 'npm i failed while regenerating package-lock.json' });

    const result = await groupUpdate(makeParams({ git, onUpdateBlocker: seam, autoResolveConflict }));

    expect(result).toMatchObject({ ok: true, data: { results: [{ service: 'svc-a', outcome: 'updated', run: { conflict: 'partial' } }, { service: 'svc-b' }] } });
  });

  it('attaches the conflict value to a cancelled (skipped) row', async () => {
    const { seam } = seamOf(['cancel-repo']);
    const git = conflictGit({ hasUnmergedPaths: vi.fn(async () => ok(true)), abortMerge: vi.fn(async () => ok(undefined)) });
    const autoResolveConflict: AutoResolveConflict = async () => ({ touched: true });

    const result = await groupUpdate(makeParams({ git, onUpdateBlocker: seam, autoResolveConflict }));

    expect(result).toMatchObject({ ok: true, data: { results: [{ service: 'svc-a', outcome: 'skipped', run: { conflict: 'partial' } }, { service: 'svc-b' }] } });
  });

  it('keeps an earlier issue note when a later pass has none while the conflict is unresolved', async () => {
    const { seam, blockers } = seamOf(['stash', 'edited']);
    const git = conflictGit();
    let pass = 0;
    const autoResolveConflict: AutoResolveConflict = async () => {
      pass += 1;
      return pass === 1 ? { touched: false, issue: 'first issue' } : { touched: false };
    };

    await groupUpdate(makeParams({ git, onUpdateBlocker: seam, autoResolveConflict }));

    expect(blockers[0]?.autoResolveNote).toBe('first issue');
    expect(blockers[1]).toMatchObject({ retry: 1, autoResolveNote: 'first issue' });
  });

  it('never starts a pass once the run is stopped', async () => {
    let releaseA: (choice: UpdateBlockerChoice) => void = () => undefined;
    const aAnswer = new Promise<UpdateBlockerChoice>((resolveChoice) => {
      releaseA = resolveChoice;
    });
    const seam: OnUpdateBlocker = async (blocker) => (blocker.service === 'svc-a' ? aAnswer : 'cancel-run');
    const merging = new Set<string>();
    const git = fakeGit({
      mergeBranch: vi.fn(async (repoPath: string) => {
        merging.add(repoPath);
        return err('merge-conflict', 'Automatic merge failed');
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
    });
    const autoResolveConflict = vi.fn<AutoResolveConflict>(async () => ({ touched: false }));

    const result = await groupUpdate(
      makeParams({
        git,
        concurrency: 2,
        onUpdateBlocker: seam,
        autoResolveConflict,
        onServiceResult: (row) => {
          if (row.service === 'svc-b') {
            releaseA('edited');
          }
        },
      }),
    );

    expect(result.ok).toBe(true);
    const forA = autoResolveConflict.mock.calls.filter(([target]) => target.service === 'svc-a');
    expect(forA).toHaveLength(1);
  });
});
