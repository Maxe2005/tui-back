import { describe, it, expect, vi } from 'vitest';
import { ok, err } from '../../../../core/result.js';
import type { EdtRegistryEntry, EdtRegistryPort } from '../../../../core/ports/edt-registry.js';
import type { GitPort } from '../../../../core/ports/git.js';
import type { LockPort } from '../../../../core/ports/lock.js';
import type { Manifest, ManifestPort } from '../../../../core/ports/manifest.js';
import type { RegistryPort, ScanResult } from '../../../../core/ports/registry.js';
import type { StatePort } from '../../../../core/ports/state.js';
import { ZONES } from '../zones/zones.js';
import { DEFAULT_LIST_RATIO } from '../shared/components/list-detail-split.js';
import { createAppStore, type AppStoreDeps } from './app-store.js';

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

function fakeDeps(overrides: Partial<AppStoreDeps> = {}): AppStoreDeps {
  const registry: RegistryPort = {
    list: vi.fn(async () => ok(['/repo/a'])),
    add: vi.fn(async () => ok(undefined)),
    exists: vi.fn(async () => ok(true)),
    scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
    reset: vi.fn(async () => ok({ path: '/x', backupPath: null })),
  };
  const manifest: ManifestPort = { load: vi.fn(async (path: string) => ok(manifestFor(path))) };
  const git: GitPort = {
    assertAllowedBranch: vi.fn(async () => ok(undefined)),
    createBranch: vi.fn(async () => ok(undefined)),
    deleteBranch: vi.fn(async () => ok(undefined)),
    currentBranch: vi.fn(async () => ok('feat/a')),
    aheadBehind: vi.fn(async () => ok({ ahead: 2, behind: 0 })),
    checkout: vi.fn(async () => ok(undefined)),
    hasUncommittedChanges: vi.fn(async () => ok(false)),
    stashSave: vi.fn(async () => ok(undefined)),
    restoreStash: vi.fn(async () => ok(undefined)),
    branchExistsLocally: vi.fn(async () => ok(true)),
    fetch: vi.fn(async () => ok(undefined)),
  };
  const edtRegistry: EdtRegistryPort = {
    add: vi.fn(async () => ok(undefined)),
    list: vi.fn(async () => ok([] as EdtRegistryEntry[])),
    setStatus: vi.fn(async () => ok(undefined)),
    update: vi.fn(async () => ok(undefined)),
  };
  const state: StatePort = {
    readActiveEdt: vi.fn(async () => ok(null)),
    writeActiveEdt: vi.fn(async () => ok(undefined)),
  };
  const lock: LockPort = {
    acquire: vi.fn(async () => ok({ release: vi.fn(async () => ok(undefined)) })),
    peek: vi.fn(async () => ok({ locked: false })),
  };
  return { registry, manifest, git, edtRegistry, state, lock, registryResourceKey: '/config/registry.yaml', ...overrides };
}

describe('app store', () => {
  it('scaffolds placeholder cross-zone state: dashboard active, empty events, 2:3 splitter ratios, no active EDT (AD-10)', () => {
    const store = createAppStore();
    const state = store.getState();
    expect(state.activeZone).toBe('dashboard');
    expect(state.activeEdt).toBeNull();
    for (const zone of ZONES) {
      expect(state.zoneEvents[zone.id]).toBe(0);
      expect(state.splitterRatios[zone.id]).toBe(DEFAULT_LIST_RATIO);
    }
  });

  it('covers exactly the six compiled-in zones — no duplicate copy per zone (AC5)', () => {
    const store = createAppStore();
    const state = store.getState();
    expect(ZONES).toHaveLength(6);
    const zoneIds = ZONES.map((zone) => zone.id);
    expect(Object.keys(state.zoneEvents).sort()).toEqual(
      [...zoneIds].sort(),
    );
    expect(Object.keys(state.splitterRatios).sort()).toEqual(
      [...zoneIds].sort(),
    );
  });

  it('switches the active zone and clears pending events for the visited zone (AC3)', () => {
    const store = createAppStore();
    store.getState().addZoneEvent('logs');
    store.getState().addZoneEvent('logs');
    expect(store.getState().zoneEvents.logs).toBe(2);
    store.getState().setActiveZone('logs');
    expect(store.getState().activeZone).toBe('logs');
    expect(store.getState().zoneEvents.logs).toBe(0);
  });

  it('adds pending background-event counts per zone independently (AC3)', () => {
    const store = createAppStore();
    store.getState().addZoneEvent('routes');
    store.getState().addZoneEvent('routes');
    store.getState().addZoneEvent('dashboard');
    expect(store.getState().zoneEvents.routes).toBe(2);
    expect(store.getState().zoneEvents.dashboard).toBe(1);
  });

  it('stores the splitter ratio per zone, clamped to keep both panes usable (AC4)', () => {
    const store = createAppStore();
    store.getState().setSplitterRatio('edts', 0.5);
    expect(store.getState().splitterRatios.edts).toBe(0.5);
    store.getState().setSplitterRatio('edts', 1);
    expect(store.getState().splitterRatios.edts).toBe(0.8);
    store.getState().setSplitterRatio('edts', 0);
    expect(store.getState().splitterRatios.edts).toBe(0.2);
    expect(store.getState().splitterRatios.dashboard).toBe(
      DEFAULT_LIST_RATIO,
    );
  });

  it('tracks the active EDT placeholder field (AD-10)', () => {
    const store = createAppStore();
    store.getState().setActiveEdt('edt-01hx2');
    expect(store.getState().activeEdt).toBe('edt-01hx2');
    store.getState().setActiveEdt(null);
    expect(store.getState().activeEdt).toBeNull();
  });

  it('opens and closes the cross-zone help modal (AD-10)', () => {
    const store = createAppStore();
    expect(store.getState().helpOpen).toBe(false);
    store.getState().openHelp();
    expect(store.getState().helpOpen).toBe(true);
    store.getState().closeHelp();
    expect(store.getState().helpOpen).toBe(false);
  });

  it('marks the launch banner shown once, in-memory only, and it stays set (AC1)', () => {
    const store = createAppStore();
    expect(store.getState().launchBannerShown).toBe(false);
    store.getState().markLaunchBannerShown();
    expect(store.getState().launchBannerShown).toBe(true);
    store.getState().markLaunchBannerShown();
    expect(store.getState().launchBannerShown).toBe(true);
  });

  describe('loadEdtsBranches (story 2.6, FR-9)', () => {
    it('starts idle with no data before the first load', () => {
      const store = createAppStore(fakeDeps());
      expect(store.getState().edtsBranches).toBeNull();
      expect(store.getState().edtsBranchesStatus).toBe('idle');
      expect(store.getState().edtsBranchesError).toBeNull();
    });

    it('flips to loading synchronously, then populates edtsBranches from the core use-case and returns to idle', async () => {
      const store = createAppStore(fakeDeps());

      const pending = store.getState().loadEdtsBranches();
      expect(store.getState().edtsBranchesStatus).toBe('loading');

      await pending;

      expect(store.getState().edtsBranchesStatus).toBe('idle');
      expect(store.getState().edtsBranchesError).toBeNull();
      expect(store.getState().edtsBranches).toEqual([
        { service: 'svc-a', path: '/repo/a', isMember: false, branch: 'feat/a', ahead: 2, behind: 0, status: 'current' },
      ]);
    });

    it('sets an explicit error state (never a stale value) when the underlying use-case fails', async () => {
      const registry: RegistryPort = {
        list: vi.fn(async () => err('registry-invalid-yaml', 'bad yaml')),
        add: vi.fn(async () => ok(undefined)),
        exists: vi.fn(async () => ok(true)),
        scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
        reset: vi.fn(async () => ok({ path: '/x', backupPath: null })),
      };
      const store = createAppStore(fakeDeps({ registry }));

      await store.getState().loadEdtsBranches();

      expect(store.getState().edtsBranchesStatus).toBe('error');
      expect(store.getState().edtsBranchesError).toBe('bad yaml');
      expect(store.getState().edtsBranches).toBeNull();
    });

    it('degrades to an explicit error, never a throw, when the store was created with no ports wired', async () => {
      const store = createAppStore();

      await store.getState().loadEdtsBranches();

      expect(store.getState().edtsBranchesStatus).toBe('error');
      expect(store.getState().edtsBranchesError).toBeTruthy();
      expect(store.getState().edtsBranches).toBeNull();
    });

    it('populates edtsUnreachable/edtsErrors from the core use-case alongside edtsBranches (review patch)', async () => {
      const registry: RegistryPort = {
        list: vi.fn(async () => ok(['/repo/a', '/repo/gone', '/repo/bad'])),
        add: vi.fn(async () => ok(undefined)),
        exists: vi.fn(async (path: string) => ok(path !== '/repo/gone')),
        scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
        reset: vi.fn(async () => ok({ path: '/x', backupPath: null })),
      };
      const manifest: ManifestPort = {
        load: vi.fn(async (path: string) =>
          path === '/repo/bad' ? err('manifest-validation-failed', 'Invalid .tui-back.yaml') : ok(manifestFor(path)),
        ),
      };
      const store = createAppStore(fakeDeps({ registry, manifest }));

      await store.getState().loadEdtsBranches();

      expect(store.getState().edtsBranchesStatus).toBe('idle');
      expect(store.getState().edtsUnreachable).toEqual(['/repo/gone']);
      expect(store.getState().edtsErrors).toEqual([
        { path: '/repo/bad', code: 'manifest-validation-failed', message: 'Invalid .tui-back.yaml' },
      ]);
    });

    it('starts with empty edtsUnreachable/edtsErrors before the first load', () => {
      const store = createAppStore(fakeDeps());
      expect(store.getState().edtsUnreachable).toEqual([]);
      expect(store.getState().edtsErrors).toEqual([]);
    });

    it('never starts a second concurrent fetch while one is already in flight', async () => {
      let resolveList: (() => void) | undefined;
      const registry: RegistryPort = {
        list: vi.fn(
          () =>
            new Promise<ReturnType<typeof ok<string[]>>>((resolveFn) => {
              resolveList = () => resolveFn(ok(['/repo/a']));
            }),
        ),
        add: vi.fn(async () => ok(undefined)),
        exists: vi.fn(async () => ok(true)),
        scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
        reset: vi.fn(async () => ok({ path: '/x', backupPath: null })),
      };
      const store = createAppStore(fakeDeps({ registry }));

      const first = store.getState().loadEdtsBranches();
      const second = store.getState().loadEdtsBranches();
      expect(registry.list).toHaveBeenCalledTimes(1);

      resolveList?.();
      await Promise.all([first, second]);
      expect(store.getState().edtsBranchesStatus).toBe('idle');
    });
  });

  describe('repo registry screen (story 2.11)', () => {
    it('opens and closes the registry screen flag (store-level, reachable from both the command palette and Dashboard)', () => {
      const store = createAppStore();
      expect(store.getState().registryScreenOpen).toBe(false);
      store.getState().openRegistryScreen();
      expect(store.getState().registryScreenOpen).toBe(true);
      store.getState().closeRegistryScreen();
      expect(store.getState().registryScreenOpen).toBe(false);
    });

    it('opening the screen resets any stale scan/register state from a prior session, atomically with becoming open', () => {
      const store = createAppStore();
      store.setState({
        registryScanStatus: 'error',
        registryScanError: 'stale error',
        registryScanResult: { candidates: ['/repos/stale'], skipped: [] },
        registryRegisterStatus: 'idle',
        registryRegisterResults: [{ path: '/repos/stale', outcome: 'registered' }],
      });

      store.getState().openRegistryScreen();

      expect(store.getState().registryScreenOpen).toBe(true);
      expect(store.getState().registryScanStatus).toBe('idle');
      expect(store.getState().registryScanError).toBeNull();
      expect(store.getState().registryScanResult).toBeNull();
      expect(store.getState().registryRegisterResults).toBeNull();
    });

    describe('checkRegistryEmpty (Dashboard prompt)', () => {
      it('starts unchecked (null) before the first check', () => {
        const store = createAppStore(fakeDeps());
        expect(store.getState().registryEmpty).toBeNull();
        expect(store.getState().registryEmptyStatus).toBe('idle');
      });

      it('reports true when registry.list() is empty', async () => {
        const registry: RegistryPort = {
          list: vi.fn(async () => ok([])),
          add: vi.fn(async () => ok(undefined)),
          exists: vi.fn(async () => ok(true)),
          scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
          reset: vi.fn(async () => ok({ path: '/x', backupPath: null })),
        };
        const store = createAppStore(fakeDeps({ registry }));
        await store.getState().checkRegistryEmpty();
        expect(store.getState().registryEmpty).toBe(true);
        expect(store.getState().registryEmptyStatus).toBe('idle');
      });

      it('reports false when registry.list() has entries', async () => {
        const store = createAppStore(fakeDeps());
        await store.getState().checkRegistryEmpty();
        expect(store.getState().registryEmpty).toBe(false);
      });

      it('sets an explicit error status, never a stale/guessed emptiness, on a listing failure', async () => {
        const registry: RegistryPort = {
          list: vi.fn(async () => err('registry-invalid-yaml', 'bad yaml')),
          add: vi.fn(async () => ok(undefined)),
          exists: vi.fn(async () => ok(true)),
          scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
          reset: vi.fn(async () => ok({ path: '/x', backupPath: null })),
        };
        const store = createAppStore(fakeDeps({ registry }));
        await store.getState().checkRegistryEmpty();
        expect(store.getState().registryEmptyStatus).toBe('error');
        expect(store.getState().registryEmpty).toBeNull();
      });

      it('is a true no-op (never a throw, never a bogus error status) when the store was created with no ports wired — Dashboard is the always-mounted default zone, so unlike the other registry actions this must never paint a permanent false-failure banner over incidental, registry-unrelated tests (review patch)', async () => {
        const store = createAppStore();
        await store.getState().checkRegistryEmpty();
        expect(store.getState().registryEmptyStatus).toBe('idle');
        expect(store.getState().registryEmpty).toBeNull();
      });

      it('resets a previously-resolved emptiness back to null on a later failure — never keeps a stale value invisibly (review patch)', async () => {
        let shouldFail = false;
        const registry: RegistryPort = {
          list: vi.fn(async () => (shouldFail ? err('registry-invalid-yaml', 'bad yaml') : ok([]))),
          add: vi.fn(async () => ok(undefined)),
          exists: vi.fn(async () => ok(true)),
          scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
          reset: vi.fn(async () => ok({ path: '/x', backupPath: null })),
        };
        const store = createAppStore(fakeDeps({ registry }));

        await store.getState().checkRegistryEmpty();
        expect(store.getState().registryEmpty).toBe(true);

        shouldFail = true;
        await store.getState().checkRegistryEmpty();

        expect(store.getState().registryEmptyStatus).toBe('error');
        expect(store.getState().registryEmpty).toBeNull();
      });

      it('never lets a stale in-flight check overwrite state from a session superseded by a reset (review patch)', async () => {
        let resolveList: ((value: ReturnType<typeof ok<string[]>>) => void) | undefined;
        const registry: RegistryPort = {
          list: vi.fn(
            () =>
              new Promise<ReturnType<typeof ok<string[]>>>((resolveFn) => {
                resolveList = resolveFn;
              }),
          ),
          add: vi.fn(async () => ok(undefined)),
          exists: vi.fn(async () => ok(true)),
          scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
          reset: vi.fn(async () => ok({ path: '/x', backupPath: null })),
        };
        const store = createAppStore(fakeDeps({ registry }));

        const pending = store.getState().checkRegistryEmpty();
        // The registry screen closes and reopens (bumping registrySessionId) while the stale
        // check above is still in flight.
        store.getState().resetRegistryScreen();
        resolveList?.(ok([]));
        await pending;

        // The stale call's result (registryEmpty: true) must never land — registryEmpty
        // stays whatever the current (post-reset) session already has, here still null.
        expect(store.getState().registryEmpty).toBeNull();
      });
    });

    describe('scanRegistryRoot', () => {
      it('flips to loading synchronously, then populates the scan result and returns to idle', async () => {
        const registry: RegistryPort = {
          list: vi.fn(async () => ok([])),
          add: vi.fn(async () => ok(undefined)),
          exists: vi.fn(async () => ok(true)),
          scan: vi.fn(async () => ok({ candidates: ['/repos/a', '/repos/b'], skipped: ['/repos/unreadable'] })),
          reset: vi.fn(async () => ok({ path: '/x', backupPath: null })),
        };
        const store = createAppStore(fakeDeps({ registry }));

        const pending = store.getState().scanRegistryRoot('/repos');
        expect(store.getState().registryScanStatus).toBe('loading');

        await pending;

        expect(store.getState().registryScanStatus).toBe('idle');
        expect(store.getState().registryScanResult).toEqual({
          candidates: ['/repos/a', '/repos/b'],
          skipped: ['/repos/unreadable'],
        });
        expect(registry.scan).toHaveBeenCalledWith('/repos');
      });

      it('surfaces an empty candidates result distinctly from an error (matrix: never conflated)', async () => {
        const registry: RegistryPort = {
          list: vi.fn(async () => ok([])),
          add: vi.fn(async () => ok(undefined)),
          exists: vi.fn(async () => ok(true)),
          scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
          reset: vi.fn(async () => ok({ path: '/x', backupPath: null })),
        };
        const store = createAppStore(fakeDeps({ registry }));

        await store.getState().scanRegistryRoot('/empty-root');

        expect(store.getState().registryScanStatus).toBe('idle');
        expect(store.getState().registryScanResult).toEqual({ candidates: [], skipped: [] });
      });

      it('sets an explicit error state (never a stale value) when the scan use-case fails', async () => {
        const registry: RegistryPort = {
          list: vi.fn(async () => ok([])),
          add: vi.fn(async () => ok(undefined)),
          exists: vi.fn(async () => ok(true)),
          scan: vi.fn(async () => err('scan-root-not-found', 'Scan root not found: /nope')),
          reset: vi.fn(async () => ok({ path: '/x', backupPath: null })),
        };
        const store = createAppStore(fakeDeps({ registry }));

        await store.getState().scanRegistryRoot('/nope');

        expect(store.getState().registryScanStatus).toBe('error');
        expect(store.getState().registryScanError).toBe('Scan root not found: /nope');
        expect(store.getState().registryScanResult).toBeNull();
      });

      it('degrades to an explicit error, never a throw, when the store was created with no ports wired', async () => {
        const store = createAppStore();
        await store.getState().scanRegistryRoot('/repos');
        expect(store.getState().registryScanStatus).toBe('error');
        expect(store.getState().registryScanError).toBeTruthy();
      });

      it('never lets a stale in-flight scan overwrite state from a session superseded by a reset (review patch)', async () => {
        let resolveScan: ((value: ReturnType<typeof ok<ScanResult>>) => void) | undefined;
        const registry: RegistryPort = {
          list: vi.fn(async () => ok([])),
          add: vi.fn(async () => ok(undefined)),
          exists: vi.fn(async () => ok(true)),
          scan: vi.fn(
            () =>
              new Promise<ReturnType<typeof ok<ScanResult>>>((resolveFn) => {
                resolveScan = resolveFn;
              }),
          ),
          reset: vi.fn(async () => ok({ path: '/x', backupPath: null })),
        };
        const store = createAppStore(fakeDeps({ registry }));

        const pending = store.getState().scanRegistryRoot('/stale-root');
        // The screen closes and reopens (bumping registrySessionId) while the stale scan
        // above is still in flight — its eventual candidates must never land.
        store.getState().resetRegistryScreen();
        resolveScan?.(ok({ candidates: ['/repos/stale'], skipped: [] }));
        await pending;

        expect(store.getState().registryScanResult).toBeNull();
      });
    });

    describe('registerRegistryCandidates', () => {
      it('classifies a brand-new path as "registered" and an already-listed path as "already-registered" via the pre-register snapshot diff (Design Notes)', async () => {
        const registry: RegistryPort = {
          list: vi.fn(async () => ok(['/repos/already'])),
          add: vi.fn(async () => ok(undefined)),
          exists: vi.fn(async () => ok(true)),
          scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
          reset: vi.fn(async () => ok({ path: '/x', backupPath: null })),
        };
        const store = createAppStore(fakeDeps({ registry }));

        await store.getState().registerRegistryCandidates(['/repos/already', '/repos/new']);

        expect(store.getState().registryRegisterStatus).toBe('idle');
        expect(store.getState().registryRegisterResults).toEqual([
          { path: '/repos/already', outcome: 'already-registered' },
          { path: '/repos/new', outcome: 'registered' },
        ]);
      });

      it('classifies a failed path as "failed" with its error detail, without blocking the remaining paths', async () => {
        const registry: RegistryPort = {
          list: vi.fn(async () => ok([])),
          add: vi.fn(async (path: string) =>
            path === '/repos/bad' ? err('action-in-progress', 'Action already in progress') : ok(undefined),
          ),
          exists: vi.fn(async () => ok(true)),
          scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
          reset: vi.fn(async () => ok({ path: '/x', backupPath: null })),
        };
        const store = createAppStore(fakeDeps({ registry }));

        await store.getState().registerRegistryCandidates(['/repos/bad', '/repos/ok']);

        expect(store.getState().registryRegisterResults).toEqual([
          { path: '/repos/bad', outcome: 'failed', detail: 'Action already in progress' },
          { path: '/repos/ok', outcome: 'registered' },
        ]);
      });

      it('flips to loading synchronously while registering', async () => {
        const store = createAppStore(fakeDeps());
        const pending = store.getState().registerRegistryCandidates(['/repos/new']);
        expect(store.getState().registryRegisterStatus).toBe('loading');
        await pending;
        expect(store.getState().registryRegisterStatus).toBe('idle');
      });

      it('degrades to a failed result per path, never a throw, when the store was created with no ports wired', async () => {
        const store = createAppStore();
        await store.getState().registerRegistryCandidates(['/repos/new']);
        expect(store.getState().registryRegisterResults).toEqual([
          { path: '/repos/new', outcome: 'failed', detail: 'No ports wired into the TUI store' },
        ]);
      });

      it('short-circuits to a failed outcome for every selected path when the pre-register snapshot read itself fails, instead of silently treating it as an empty registry (review patch)', async () => {
        const registry: RegistryPort = {
          list: vi.fn(async () => err('registry-invalid-yaml', 'bad yaml')),
          add: vi.fn(async () => ok(undefined)),
          exists: vi.fn(async () => ok(true)),
          scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
          reset: vi.fn(async () => ok({ path: '/x', backupPath: null })),
        };
        const store = createAppStore(fakeDeps({ registry }));

        await store.getState().registerRegistryCandidates(['/repos/a', '/repos/b']);

        expect(store.getState().registryRegisterStatus).toBe('idle');
        expect(store.getState().registryRegisterResults).toEqual([
          { path: '/repos/a', outcome: 'failed', detail: 'bad yaml' },
          { path: '/repos/b', outcome: 'failed', detail: 'bad yaml' },
        ]);
        // The snapshot failing must never fall through to actually registering anything.
        expect(registry.add).not.toHaveBeenCalled();
      });

      it('never lets a stale in-flight register run overwrite state from a session superseded by a reset (review patch)', async () => {
        let resolveList: ((value: ReturnType<typeof ok<string[]>>) => void) | undefined;
        const registry: RegistryPort = {
          list: vi.fn(
            () =>
              new Promise<ReturnType<typeof ok<string[]>>>((resolveFn) => {
                resolveList = resolveFn;
              }),
          ),
          add: vi.fn(async () => ok(undefined)),
          exists: vi.fn(async () => ok(true)),
          scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
          reset: vi.fn(async () => ok({ path: '/x', backupPath: null })),
        };
        const store = createAppStore(fakeDeps({ registry }));

        const pending = store.getState().registerRegistryCandidates(['/repos/stale']);
        // The screen closes and reopens (bumping registrySessionId) while the stale register
        // run above is still in flight — its eventual results must never land.
        store.getState().resetRegistryScreen();
        resolveList?.(ok([]));
        await pending;

        expect(store.getState().registryRegisterResults).toBeNull();
      });
    });

    describe('resetRegistryScreen', () => {
      it('clears scan and register state back to a fresh root-input session', async () => {
        const store = createAppStore(fakeDeps());
        await store.getState().scanRegistryRoot('/repos');
        await store.getState().registerRegistryCandidates(['/repos/a']);

        store.getState().resetRegistryScreen();

        expect(store.getState().registryScanStatus).toBe('idle');
        expect(store.getState().registryScanResult).toBeNull();
        expect(store.getState().registryRegisterStatus).toBe('idle');
        expect(store.getState().registryRegisterResults).toBeNull();
      });
    });
  });
});

