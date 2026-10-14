// The History side of the shared-types slice: streaming, single source, cancel-before-restart,
// no stale entries after a cancel, git failure recovery and the invalid-version guard.
import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '../../../../../core/result.js';
import type { VersionBump, VersionBumpWalkOptions } from '../../../../../core/ports/git.js';
import { createAppStore, type AppStoreDeps } from '../app-store.js';

const SOURCE = 'source-module';

type Walk = (repoPath: string, ref: string, opts: VersionBumpWalkOptions) => ReturnType<NonNullable<AppStoreDeps['git']['listVersionBumpCommits']>>;

function makeDeps(walk: Walk, members = [{ service: 'source', repoPath: '/r/source' }]) {
  const git = {
    listVersionBumpCommits: vi.fn(walk),
    listBranchesContaining: vi.fn(async () => ok(['main'])),
    listBranches: vi.fn(async () => ok(['development', 'feat/x'])),
    listRemoteBranches: vi.fn(async () => ok(['origin/development'])),
  };
  const deps = {
    git,
    restart: {},
    container: {},
    manifest: {
      load: vi.fn(async () => ok({ service: 'source', sharedBranch: 'development', modules: { [SOURCE]: { publishCommand: 'npm run v', packageName: '@ianord/shared-types' } } })),
    },
    state: { readActiveEdt: vi.fn(async () => ok('E1')) },
    edtRegistry: {
      list: vi.fn(async () => ok([{ ulid: 'E1', topic: 't', createdAt: '', status: 'active', members: members.map((member) => ({ ...member, branch: 'feat/x' })) }])),
    },
    sharedTypes: {
      port: {},
      consumerModuleId: 'consumer-module',
      parseConsumerConfig: () => ok({ dependency: '@ianord/shared-types', packageJsonPath: 'package.json' }),
      sourceModuleId: SOURCE,
      parseSourceConfig: () => ok({ publishCommand: 'npm run v', packageName: '@ianord/shared-types' }),
    },
  } as unknown as AppStoreDeps;
  return { deps, git };
}

const bump = (version: string): VersionBump => ({ version, commit: `c${version}`, date: '2026-01-01T00:00:00Z' });

describe('shared-types history slice', () => {
  it('streams a by-branch search with the configured bounds and records why it stopped', async () => {
    const { deps, git } = makeDeps(async (_repo, _ref, opts) => {
      opts.onEntry(bump('0.1.3'));
      opts.onEntry(bump('0.1.2'));
      return ok({ endedBy: 'limit' as const, scanned: 2 });
    });
    const store = createAppStore(deps);
    store.setState({ settings: { ...store.getState().settings, sharedTypes: { ...store.getState().settings.sharedTypes, historyDepth: 2, maxCommitsScanned: 300 } } });
    await store.getState().startSharedTypesHistorySearch({ mode: 'branch', query: 'feat/x' });
    expect(git.listVersionBumpCommits).toHaveBeenCalledWith('/r/source', 'feat/x', expect.objectContaining({ limit: 2, maxScanned: 300 }));
    expect(store.getState().sharedTypesHistory).toMatchObject({ status: 'done', endedBy: 'depth', depth: 2, query: 'feat/x' });
    expect(store.getState().sharedTypesHistory.entries.map((entry) => entry.version)).toEqual(['0.1.3', '0.1.2']);
  });

  it('shows entries while the walk is still running', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { deps } = makeDeps(async (_repo, _ref, opts) => {
      opts.onEntry(bump('0.1.9'));
      await gate;
      return ok({ endedBy: 'exhausted' as const, scanned: 1 });
    });
    const store = createAppStore(deps);
    const running = store.getState().startSharedTypesHistorySearch({ mode: 'branch', query: 'b' });
    await vi.waitFor(() => expect(store.getState().sharedTypesHistory.entries).toHaveLength(1));
    expect(store.getState().sharedTypesHistory.status).toBe('searching');
    release();
    await running;
    expect(store.getState().sharedTypesHistory).toMatchObject({ status: 'done', endedBy: 'exhausted' });
  });

  it('aborts the previous walk before a new search and never appends its stale entries', async () => {
    const signals: AbortSignal[] = [];
    let first: (() => void) | undefined;
    const { deps } = makeDeps(async (_repo, ref, opts) => {
      signals.push(opts.signal as AbortSignal);
      if (ref === 'old') {
        await new Promise<void>((resolve) => { first = resolve; });
        opts.onEntry(bump('0.0.1'));
        return ok({ endedBy: 'aborted' as const, scanned: 1 });
      }
      opts.onEntry(bump('0.2.0'));
      return ok({ endedBy: 'exhausted' as const, scanned: 1 });
    });
    const store = createAppStore(deps);
    const oldRun = store.getState().startSharedTypesHistorySearch({ mode: 'branch', query: 'old' });
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    await store.getState().startSharedTypesHistorySearch({ mode: 'branch', query: 'new' });
    expect(signals[0]?.aborted).toBe(true);
    first?.();
    await oldRun;
    expect(store.getState().sharedTypesHistory.entries.map((entry) => entry.version)).toEqual(['0.2.0']);
    expect(store.getState().sharedTypesHistory.query).toBe('new');
  });

  it('cancels a running walk and keeps what was found', async () => {
    let finish: (() => void) | undefined;
    const { deps } = makeDeps(async (_repo, _ref, opts) => {
      opts.onEntry(bump('0.1.5'));
      await new Promise<void>((resolve) => { finish = resolve; });
      opts.onEntry(bump('0.1.4'));
      return ok({ endedBy: 'aborted' as const, scanned: 2 });
    });
    const store = createAppStore(deps);
    const running = store.getState().startSharedTypesHistorySearch({ mode: 'branch', query: 'b' });
    await vi.waitFor(() => expect(store.getState().sharedTypesHistory.entries).toHaveLength(1));
    store.getState().cancelSharedTypesHistorySearch();
    expect(store.getState().sharedTypesHistory).toMatchObject({ status: 'done', endedBy: 'aborted' });
    finish?.();
    await running;
    expect(store.getState().sharedTypesHistory.entries.map((entry) => entry.version)).toEqual(['0.1.5']);
  });

  it('shows a git failure and lets the next search work', async () => {
    let calls = 0;
    const { deps } = makeDeps(async (_repo, _ref, opts) => {
      calls += 1;
      if (calls === 1) {
        return err('git-history-error', 'unknown revision');
      }
      opts.onEntry(bump('0.1.1'));
      return ok({ endedBy: 'exhausted' as const, scanned: 1 });
    });
    const store = createAppStore(deps);
    await store.getState().startSharedTypesHistorySearch({ mode: 'branch', query: 'nope' });
    expect(store.getState().sharedTypesHistory).toMatchObject({ status: 'error', error: { code: 'git-history-error' } });
    await store.getState().startSharedTypesHistorySearch({ mode: 'branch', query: 'dev' });
    expect(store.getState().sharedTypesHistory).toMatchObject({ status: 'done', error: null });
    expect(store.getState().sharedTypesHistory.entries).toHaveLength(1);
  });

  it('finds a version with its containing branches and flags the earliest', async () => {
    const { deps } = makeDeps(async (_repo, ref, opts) => {
      expect(ref).toBe('--all');
      opts.onEntry(bump('0.1.3770'));
      return ok({ endedBy: 'exhausted' as const, scanned: 1 });
    });
    const store = createAppStore(deps);
    await store.getState().startSharedTypesHistorySearch({ mode: 'version', query: '0.1.3770' });
    expect(store.getState().sharedTypesHistory).toMatchObject({ status: 'done', found: true, earliestBranch: 'main' });
    expect(store.getState().sharedTypesHistory.hits).toMatchObject([{ branches: ['main'], earliest: true }]);
  });

  it('reports a never-set version as not found', async () => {
    const { deps } = makeDeps(async () => ok({ endedBy: 'exhausted' as const, scanned: 0 }));
    const store = createAppStore(deps);
    await store.getState().startSharedTypesHistorySearch({ mode: 'version', query: '9.9.9' });
    expect(store.getState().sharedTypesHistory).toMatchObject({ status: 'done', found: false });
  });

  it('rejects an invalid version without touching git', async () => {
    const { deps, git } = makeDeps(async () => ok({ endedBy: 'exhausted' as const, scanned: 0 }));
    const store = createAppStore(deps);
    await store.getState().startSharedTypesHistorySearch({ mode: 'version', query: '0.1' });
    expect(store.getState().sharedTypesHistory).toMatchObject({ status: 'error', error: { code: 'invalid-version' } });
    expect(git.listVersionBumpCommits).not.toHaveBeenCalled();
  });

  it('errors without a single source repo and without wiring', async () => {
    const { deps } = makeDeps(async () => ok({ endedBy: 'exhausted' as const, scanned: 0 }), []);
    const store = createAppStore(deps);
    await store.getState().startSharedTypesHistorySearch({ mode: 'branch', query: 'b' });
    expect(store.getState().sharedTypesHistory.status).toBe('error');
    const bare = createAppStore();
    await bare.getState().startSharedTypesHistorySearch({ mode: 'branch', query: 'b' });
    expect(bare.getState().sharedTypesHistory).toMatchObject({ status: 'error', error: { code: 'not-wired' } });
  });

  it('loads local and remote branches of the source repo for the autocomplete', async () => {
    const { deps } = makeDeps(async () => ok({ endedBy: 'exhausted' as const, scanned: 0 }));
    const store = createAppStore(deps);
    await store.getState().loadSharedTypesHistoryBranches();
    expect(store.getState().sharedTypesHistoryBranchesStatus).toBe('ready');
    expect(store.getState().sharedTypesHistoryBranches).toEqual(['development', 'feat/x', 'origin/development']);
  });
});
