// tui/store/slices/update-slice: unit tests for the Update zone's run state — the slice
// calls the real core/scripts/group-update.ts use-case against fake ports (AD-2
// in-process), so these verify the wiring (status transitions, runInProgress guard,
// interrupted marking + edts refresh) rather than re-testing the use-case matrix.
import { describe, expect, it, vi } from 'vitest';
import { ok, err } from '../../../../../core/result.js';
import type { EdtRegistryPort } from '../../../../../core/ports/edt-registry.js';
import type { GitPort } from '../../../../../core/ports/git.js';
import type { ManifestPort } from '../../../../../core/ports/manifest.js';
import type { StatePort } from '../../../../../core/ports/state.js';
import { DEFAULT_SETTINGS } from '../../../../../core/ports/settings.js';
import { createAppStore } from '../app-store.js';
import { MEMBERS, fakeDeps } from './update-slice.test-support.js';

describe('update slice', () => {
  it('starts idle with no results, note, error, or raised blocker', () => {
    const store = createAppStore(fakeDeps());

    expect(store.getState().updateStatus).toBe('idle');
    expect(store.getState().updateResults).toEqual([]);
    expect(store.getState().updateNote).toBeNull();
    expect(store.getState().updateError).toBeNull();
    expect(store.getState().updateUlid).toBeNull();
    expect(store.getState().incidents).toEqual([]);
  });

  it('runGroupUpdate runs the core use-case in-process and lands done with per-service rows', async () => {
    const store = createAppStore(fakeDeps());

    await store.getState().runGroupUpdate();

    expect(store.getState().updateStatus).toBe('done');
    expect(store.getState().updateTopic).toBe('demo');
    expect(store.getState().updateUlid).toBe('edt-1');
    expect(store.getState().updateResults).toEqual([
      { service: 'svc-a', outcome: 'updated', run: expect.anything() },
      { service: 'svc-b', outcome: 'updated', run: expect.anything() },
    ]);
    expect(store.getState().runInProgress).toBe(false);
  });

  // Exercises the real `lastServiceOutcomes: mergeLastServiceOutcomes(...)` wiring through the
  // actual runGroupUpdate flow — pure merge unit tests and hand-seeded zone render tests don't
  // catch a bug in that wiring itself (e.g. the merge call dropped, or given wrong arguments).
  it('runGroupUpdate populates lastServiceOutcomes with the run\'s own per-service outcomes', async () => {
    const store = createAppStore(fakeDeps());
    expect(store.getState().lastServiceOutcomes).toEqual({});

    await store.getState().runGroupUpdate();

    expect(store.getState().lastServiceOutcomes).toEqual({
      'svc-a': { service: 'svc-a', outcome: 'updated', run: expect.anything() },
      'svc-b': { service: 'svc-b', outcome: 'updated', run: expect.anything() },
    });
  });

  it('runGroupUpdate merges lastServiceOutcomes across runs — a service outside a later scoped run\'s scope keeps its earlier outcome', async () => {
    // The active EDT has only svc-a as a member — the second (default-scoped, 'edt') run
    // below targets svc-a alone, never svc-b.
    const edtRegistry: EdtRegistryPort = {
      add: vi.fn(async () => ok(undefined)),
      list: vi.fn(async () =>
        ok([
          {
            ulid: 'edt-1',
            topic: 'demo',
            createdAt: '2026-09-17T00:00:00.000Z',
            status: 'active' as const,
            members: [MEMBERS[0]!],
          },
        ]),
      ),
      setStatus: vi.fn(async () => ok(undefined)),
      update: vi.fn(async () => ok(undefined)),
      remove: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ edtRegistry }));

    // First run: scope 'all' targets every registered repo (svc-a and svc-b both succeed) —
    // 'all' never reads edtRegistry, so this run is unaffected by the EDT override above.
    await store.getState().runGroupUpdate('all');
    expect(store.getState().lastServiceOutcomes).toEqual({
      'svc-a': { service: 'svc-a', outcome: 'updated', run: expect.anything() },
      'svc-b': { service: 'svc-b', outcome: 'updated', run: expect.anything() },
    });

    // Second run: the default EDT-scoped run, targeting only svc-a (the sole member above).
    await store.getState().runGroupUpdate();
    expect(store.getState().updateResults).toEqual([{ service: 'svc-a', outcome: 'updated', run: expect.anything() }]);

    // svc-b sat outside this second run's scope entirely — its earlier outcome must survive
    // the merge, never be dropped by a wholesale replace.
    expect(store.getState().lastServiceOutcomes).toEqual({
      'svc-a': { service: 'svc-a', outcome: 'updated', run: expect.anything() },
      'svc-b': { service: 'svc-b', outcome: 'updated', run: expect.anything() },
    });
  });

  it('a run ending off the Update zone badges its tab, cleared on visiting it', async () => {
    const store = createAppStore(fakeDeps());
    store.getState().setActiveZone('dashboard');

    await store.getState().runGroupUpdate();

    expect(store.getState().zoneEvents.update).toBe(1);
    store.getState().setActiveZone('update');
    expect(store.getState().zoneEvents.update).toBe(0);

    await store.getState().runGroupUpdate();
    expect(store.getState().zoneEvents.update).toBe(0);
  });

  it('runGroupUpdate threads the scope: runGroupUpdate(all) lands done on the all-repos outcome', async () => {
    const store = createAppStore(fakeDeps());

    await store.getState().runGroupUpdate('all');

    expect(store.getState().updateStatus).toBe('done');
    expect(store.getState().updateTopic).toBe('all-repos');
    expect(store.getState().updateUlid).toBe('all');
    expect(store.getState().updateScope).toBe('all');
    expect(store.getState().updateResults).toEqual([
      { service: 'svc-a', outcome: 'updated', run: expect.anything() },
      { service: 'svc-b', outcome: 'updated', run: expect.anything() },
    ]);
    expect(store.getState().runInProgress).toBe(false);
  });

  it('runGroupUpdate surfaces a top-level use-case failure as error with its code', async () => {
    const state: StatePort = {
      readActiveEdt: vi.fn(async () => ok(null)),
      writeActiveEdt: vi.fn(async () => ok(undefined)),
      readSplitterRatios: vi.fn(async () => ok(null)),
      writeSplitterRatios: vi.fn(async () => ok(undefined)),
      readFilterHistory: vi.fn(async () => ok(null)),
      writeFilterHistory: vi.fn(async () => ok(undefined)),
      readCommandHistory: vi.fn(async () => ok(null)),
      writeCommandHistory: vi.fn(async () => ok(undefined)),
      readLogRules: vi.fn(async () => ok(null)),
      writeLogRules: vi.fn(async () => ok(undefined)),
      readLogRuleSets: vi.fn(async () => ok(null)),
      writeLogRuleSets: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ state }));

    await store.getState().runGroupUpdate();

    expect(store.getState().updateStatus).toBe('error');
    expect(store.getState().updateErrorCode).toBe('no-active-edt');
    expect(store.getState().updateError).toContain('No active EDT');
    expect(store.getState().runInProgress).toBe(false);
  });

  it('runGroupUpdate degrades to an explicit error, never a throw, when the store is unwired', async () => {
    const store = createAppStore();

    await store.getState().runGroupUpdate();

    expect(store.getState().updateStatus).toBe('error');
    expect(store.getState().updateErrorCode).toBe('store-not-wired');
  });

  it('runGroupUpdate degrades to an explicit error when the container port is missing', async () => {
    const deps = fakeDeps();
    const { container: _dropped, ...withoutContainer } = deps;
    const store = createAppStore(withoutContainer);

    await store.getState().runGroupUpdate();

    expect(store.getState().updateStatus).toBe('error');
    expect(store.getState().updateErrorCode).toBe('store-not-wired');
  });

  it('runGroupUpdate degrades to an explicit error when the migration port is missing', async () => {
    const deps = fakeDeps();
    const { migration: _dropped, ...withoutMigration } = deps;
    const store = createAppStore(withoutMigration);

    await store.getState().runGroupUpdate();

    expect(store.getState().updateStatus).toBe('error');
    expect(store.getState().updateErrorCode).toBe('store-not-wired');
  });

  it('runGroupUpdate degrades to an explicit error when the restart port is missing', async () => {
    const deps = fakeDeps();
    const { restart: _dropped, ...withoutRestart } = deps;
    const store = createAppStore(withoutRestart);

    await store.getState().runGroupUpdate();

    expect(store.getState().updateStatus).toBe('error');
    expect(store.getState().updateErrorCode).toBe('store-not-wired');
  });

  it('a second call while running reports update-already-running, and the in-flight run still lands done', async () => {
    let resolveFetch: (() => void) | undefined;
    const fetchGate = new Promise<void>((resolve) => {
      resolveFetch = resolve;
    });
    const git: GitPort = {
      ...(fakeDeps().git as GitPort),
      fetch: vi.fn(async () => {
        await fetchGate;
        return ok(undefined);
      }),
    };
    const store = createAppStore(fakeDeps({ git }));

    const first = store.getState().runGroupUpdate();
    expect(store.getState().updateStatus).toBe('running');
    expect(store.getState().runInProgress).toBe(true);

    // Double-Enter feedback instead of silence: the second call is rejected with the
    // run-in-flight code while the first run continues underneath.
    await store.getState().runGroupUpdate();
    expect(store.getState().updateStatus).toBe('running');
    expect(store.getState().updateNotice?.code).toBe('update-already-running');

    resolveFetch?.();
    await first;
    expect(store.getState().updateStatus).toBe('done');
    expect(store.getState().runInProgress).toBe(false);
    // Exactly one run processed both members — the second call never started another.
    expect(git.fetch).toHaveBeenCalledTimes(2);
  });

  it('runGroupUpdate turns a throwing worker into failed rows and always clears runInProgress', async () => {
    const manifest: ManifestPort = {
      load: vi.fn(async () => {
        throw new Error('boom');
      }),
    };
    const store = createAppStore(fakeDeps({ manifest }));

    await store.getState().runGroupUpdate();

    expect(store.getState().updateStatus).toBe('done');
    expect(store.getState().updateResults).toEqual([
      { service: 'svc-a', outcome: 'failed', detail: { code: 'internal-error', message: expect.stringContaining('boom') } },
      { service: 'svc-b', outcome: 'failed', detail: { code: 'internal-error', message: expect.stringContaining('boom') } },
    ]);
    expect(store.getState().runInProgress).toBe(false);
  });

  it('markUpdateInterrupted marks the run EDT interrupted and refreshes edts back to idle', async () => {
    const deps = fakeDeps();
    const store = createAppStore(deps);

    await store.getState().runGroupUpdate();
    // The quit-confirm races real completion in production too — the mark path only runs
    // while the status is still `running`.
    store.setState({ updateStatus: 'running' });
    await store.getState().markUpdateInterrupted();

    expect(deps.edtRegistry.setStatus).toHaveBeenCalledWith('edt-1', 'interrupted');
    expect(store.getState().updateStatus).toBe('idle');
    expect(store.getState().runInProgress).toBe(false);
    expect(store.getState().edts).toHaveLength(1);
  });

  it('markUpdateInterrupted after an all-repos run resets to idle without touching the EDT registry', async () => {
    const deps = fakeDeps();
    const store = createAppStore(deps);

    await store.getState().runGroupUpdate('all');
    expect(store.getState().updateScope).toBe('all');
    // The quit-confirm races real completion — the bypass only runs while still `running`.
    store.setState({ updateStatus: 'running' });
    await store.getState().markUpdateInterrupted();

    expect(deps.edtRegistry.setStatus).not.toHaveBeenCalled();
    expect(store.getState().updateStatus).toBe('idle');
    expect(store.getState().runInProgress).toBe(false);
  });

  it('markUpdateInterrupted never marks a finished run — a quit-confirm racing completion leaves the healthy EDT alone', async () => {
    const deps = fakeDeps();
    const store = createAppStore(deps);

    await store.getState().runGroupUpdate();
    expect(store.getState().updateStatus).toBe('done');
    await store.getState().markUpdateInterrupted();

    expect(deps.edtRegistry.setStatus).not.toHaveBeenCalled();
    expect(store.getState().updateStatus).toBe('done');
    expect(store.getState().updateResults).toHaveLength(2);
  });

  it('markUpdateInterrupted falls back to the active pointer when a run is in flight but targeted no EDT yet', async () => {
    const deps = fakeDeps();
    const store = createAppStore(deps);
    store.setState({ activeEdt: 'edt-1', updateStatus: 'running' });

    await store.getState().markUpdateInterrupted();

    expect(deps.edtRegistry.setStatus).toHaveBeenCalledWith('edt-1', 'interrupted');
  });

  it('markUpdateInterrupted is a no-op (never a throw) when unwired and pointerless', async () => {
    const store = createAppStore();

    await store.getState().markUpdateInterrupted();

    expect(store.getState().updateStatus).toBe('idle');
  });

  it('markUpdateInterrupted surfaces a setStatus failure as error state instead of silently returning to idle', async () => {
    const edtRegistry: EdtRegistryPort = {
      add: vi.fn(async () => ok(undefined)),
      list: vi.fn(async () => ok([])),
      setStatus: vi.fn(async () => err('edt-not-found', 'gone')),
      update: vi.fn(async () => ok(undefined)),
      remove: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ edtRegistry }));
    store.setState({ activeEdt: 'edt-gone', updateStatus: 'running' });

    await store.getState().markUpdateInterrupted();

    expect(store.getState().updateStatus).toBe('error');
    expect(store.getState().updateErrorCode).toBe('edt-not-found');
    expect(store.getState().updateError).toContain('gone');
    expect(store.getState().runInProgress).toBe(false);
  });

  it('markUpdateInterrupted surfaces a throwing setStatus as internal-error', async () => {
    const edtRegistry: EdtRegistryPort = {
      add: vi.fn(async () => ok(undefined)),
      list: vi.fn(async () => ok([])),
      setStatus: vi.fn(async () => {
        throw new Error('disk on fire');
      }),
      update: vi.fn(async () => ok(undefined)),
      remove: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ edtRegistry }));
    store.setState({ activeEdt: 'edt-1', updateStatus: 'running' });

    await store.getState().markUpdateInterrupted();

    expect(store.getState().updateStatus).toBe('error');
    expect(store.getState().updateErrorCode).toBe('internal-error');
    expect(store.getState().runInProgress).toBe(false);
  });

  it('clearUpdate resets every run field to the idle baseline', async () => {
    const store = createAppStore(fakeDeps());

    await store.getState().runGroupUpdate();
    expect(store.getState().updateStatus).toBe('done');
    store.setState({ incidents: [{ id: 'i1', blocker: { service: 'svc-a', repoPath: '/repo/a', kind: 'dirty-worktree' }, raisedAt: 0 }] });
    store.getState().clearUpdate();

    expect(store.getState().updateStatus).toBe('idle');
    expect(store.getState().updateResults).toEqual([]);
    expect(store.getState().updateNote).toBeNull();
    expect(store.getState().updateTopic).toBeNull();
    expect(store.getState().updateError).toBeNull();
    expect(store.getState().updateUlid).toBeNull();
    expect(store.getState().updateScope).toBeNull();
    expect(store.getState().incidents).toEqual([]);
  });

  it('runGroupUpdate raises an incident on a dirty repo and resumes on resolveUpdateIncident', async () => {
    const git: GitPort = {
      ...(fakeDeps().git as GitPort),
      listDirtyPaths: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a' ? ['wip.txt'] : [])),
    };
    const store = createAppStore(fakeDeps({ git }));

    const run = store.getState().runGroupUpdate();
    await vi.waitFor(() => {
      expect(store.getState().incidents[0]?.blocker).toEqual({
        service: 'svc-a',
        repoPath: '/repo/a',
        kind: 'dirty-worktree',
      });
    });
    expect(store.getState().updateStatus).toBe('running');

    store.getState().resolveUpdateIncident(store.getState().incidents[0]?.id ?? 'none', 'cancel-repo');
    await run;

    expect(store.getState().updateStatus).toBe('done');
    expect(store.getState().incidents).toEqual([]);
    expect(store.getState().updateResults).toEqual([
      { service: 'svc-a', outcome: 'skipped', detail: expect.objectContaining({ code: 'dirty-worktree' }) },
      { service: 'svc-b', outcome: 'updated', run: expect.anything() },
    ]);
    expect(store.getState().runInProgress).toBe(false);
  });

  it('runs services in parallel up to update.concurrency read from the settings', async () => {
    let inFlight = 0;
    let peak = 0;
    const migration = {
      run: vi.fn(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolveWait) => setTimeout(resolveWait, 5));
        inFlight -= 1;
        return ok({ output: '' });
      }),
    };
    const store = createAppStore(fakeDeps({ migration } as never));
    store.setState({ settings: { ...store.getState().settings, update: { concurrency: 2, runMigrations: true, cleanRestart: false, mergeSource: 'shared' as const } } });

    await store.getState().runGroupUpdate();

    expect(peak).toBe(2);
    expect(store.getState().updateResults.map((row) => row.service)).toEqual(['svc-a', 'svc-b']);
  });

  function dirtyGit(): GitPort {
    return {
      ...(fakeDeps().git as GitPort),
      listDirtyPaths: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a' ? ['wip.txt'] : [])),
    };
  }

  it('the first incident opens the popup in the Update zone; esc-close keeps the incident queued', async () => {
    const store = createAppStore(fakeDeps({ git: dirtyGit() }));
    store.setState({ activeZone: 'update' });

    const run = store.getState().runGroupUpdate();
    await vi.waitFor(() => expect(store.getState().incidents).toHaveLength(1));
    expect(store.getState().incidentPopupOpen).toBe(true);
    expect(store.getState().incidentToast).toBeNull();

    store.getState().closeIncidentPopup();
    expect(store.getState().incidentPopupOpen).toBe(false);
    expect(store.getState().incidents).toHaveLength(1);
    store.getState().openIncidentPopup();
    expect(store.getState().incidentPopupOpen).toBe(true);

    store.getState().resolveUpdateIncident(store.getState().incidents[0]?.id ?? 'none', 'cancel-repo');
    await run;
    expect(store.getState().incidents).toEqual([]);
    expect(store.getState().incidentPopupOpen).toBe(false);
  });

  it('an incident raised outside the Update zone never opens the popup and raises a toast', async () => {
    const store = createAppStore(fakeDeps({ git: dirtyGit() }));
    store.setState({ activeZone: 'dashboard' });

    const run = store.getState().runGroupUpdate();
    await vi.waitFor(() => expect(store.getState().incidents).toHaveLength(1));
    expect(store.getState().incidentPopupOpen).toBe(false);
    expect(store.getState().incidentToast).toContain('svc-a');

    store.getState().resolveUpdateIncident(store.getState().incidents[0]?.id ?? 'none', 'cancel-repo');
    await run;
  });

  it('cancel-run from one incident answers every other pending incident and the run settles', async () => {
    const git: GitPort = {
      ...(fakeDeps().git as GitPort),
      listDirtyPaths: vi.fn(async () => ok(['wip.txt'])),
    };
    const store = createAppStore(fakeDeps({ git }));
    store.setState({ activeZone: 'update', settings: { ...store.getState().settings, update: { concurrency: 2, runMigrations: true, cleanRestart: false, mergeSource: 'shared' as const } } });

    const run = store.getState().runGroupUpdate();
    await vi.waitFor(() => expect(store.getState().incidents).toHaveLength(2));

    store.getState().resolveUpdateIncident(store.getState().incidents[0]?.id ?? 'none', 'cancel-run');
    expect(store.getState().incidents).toEqual([]);
    expect(store.getState().incidentPopupOpen).toBe(false);
    await run;

    expect(store.getState().updateStatus).toBe('done');
    expect(store.getState().updateResults.map((row) => row.outcome)).toEqual(['skipped', 'skipped']);
    expect(store.getState().runInProgress).toBe(false);
  });

  it('an incident re-raised after a failed re-verification is marked still blocked', async () => {
    const store = createAppStore(fakeDeps({ git: dirtyGit() }));

    const run = store.getState().runGroupUpdate();
    await vi.waitFor(() => expect(store.getState().incidents).toHaveLength(1));
    expect(store.getState().incidents[0]?.stillBlocked).toBeUndefined();
    store.getState().resolveUpdateIncident(store.getState().incidents[0]?.id ?? 'none', 'edited');
    await vi.waitFor(() => expect(store.getState().incidents[0]?.stillBlocked).toBeDefined());
    store.getState().resolveUpdateIncident(store.getState().incidents[0]?.id ?? 'none', 'cancel-repo');
    await run;
  });

  it('resolveUpdateIncident with no raised incident is a no-op, never a throw', () => {
    const store = createAppStore(fakeDeps());

    store.getState().resolveUpdateIncident(store.getState().incidents[0]?.id ?? 'none', 'cancel-repo');

    expect(store.getState().incidents).toEqual([]);
    expect(store.getState().updateStatus).toBe('idle');
  });

  it('a throwing git write under a raised incident fails that service with the queue cleared', async () => {
    const git: GitPort = {
      ...(fakeDeps().git as GitPort),
      listDirtyPaths: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a' ? ['wip.txt'] : [])),
      stashSave: vi.fn(async () => {
        throw new Error('stash exploded');
      }),
    };
    const store = createAppStore(fakeDeps({ git }));

    const run = store.getState().runGroupUpdate();
    await vi.waitFor(() => {
      expect(store.getState().incidents).not.toEqual([]);
    });
    store.getState().resolveUpdateIncident(store.getState().incidents[0]?.id ?? 'none', 'stash');
    await run;

    expect(store.getState().updateStatus).toBe('done');
    expect(store.getState().updateResults[0]).toMatchObject({
      service: 'svc-a',
      outcome: 'failed',
      detail: { code: 'internal-error', message: expect.stringContaining('stash exploded') },
    });
    expect(store.getState().incidents).toEqual([]);
    expect(store.getState().runInProgress).toBe(false);
  });
});

describe('openInIde', () => {
  it('launches the editor port with the repo path and the configured editor command', () => {
    const editor = { launch: vi.fn(() => ok(undefined)) };
    const store = createAppStore(fakeDeps({ editor }));
    store.setState({ settings: { ...DEFAULT_SETTINGS, general: { ...DEFAULT_SETTINGS.general, editorCommand: 'code <repo>' } } });

    expect(store.getState().openInIde('/repo/a')).toEqual(ok(undefined));
    expect(editor.launch).toHaveBeenCalledWith('/repo/a', 'code <repo>');
  });

  it('reports editor-unavailable when no editor port is wired', () => {
    const store = createAppStore(fakeDeps());

    const result = store.getState().openInIde('/repo/a');

    expect(!result.ok && result.error.code).toBe('editor-unavailable');
  });
});
