import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok, err } from '../../../../core/result.js';
import type { EdtRegistryEntry, EdtRegistryPort } from '../../../../core/ports/edt-registry.js';
import type { GitPort } from '../../../../core/ports/git.js';
import type { LockPort } from '../../../../core/ports/lock.js';
import type { Manifest, ManifestPort } from '../../../../core/ports/manifest.js';
import type { RegistryPort } from '../../../../core/ports/registry.js';
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
    acquire: vi.fn(async () => ok({ release: async () => ok(undefined) })),
    peek: vi.fn(async () => ok({ locked: false })),
  };
  return {
    registry,
    manifest,
    git,
    edtRegistry,
    state,
    lock,
    edtRegistryResourceKey: '/tmp/edts.yaml',
    edtsBaseDir: '/tmp/edts',
    ...overrides,
  };
}

const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function makeEdtsBaseDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tui-back-app-store-createedt-'));
  tmpDirs.push(dir);
  return dir;
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

  // Review patch (story 2.9): the composition-root wiring this story added — the actual
  // glue between the store and createEdt/switchActiveEdt/modifyEdt/loadEdts — had zero
  // direct coverage; every zone test substituted its own fakes for these four fields
  // instead of exercising the real implementations against fakeDeps().
  describe('loadEdts (story 2.9)', () => {
    it('populates edts and activeEdt from the core ports on success', async () => {
      const edts: EdtRegistryEntry[] = [{ ulid: '01JXXXX1', topic: 'demo', createdAt: '2026-01-01T00:00:00.000Z', status: 'active', members: [] }];
      const edtRegistry: EdtRegistryPort = {
        add: vi.fn(async () => ok(undefined)),
        list: vi.fn(async () => ok(edts)),
        setStatus: vi.fn(async () => ok(undefined)),
        update: vi.fn(async () => ok(undefined)),
      };
      const state: StatePort = {
        readActiveEdt: vi.fn(async () => ok('01JXXXX1')),
        writeActiveEdt: vi.fn(async () => ok(undefined)),
      };
      const store = createAppStore(fakeDeps({ edtRegistry, state }));

      await store.getState().loadEdts();

      expect(store.getState().edtsStatus).toBe('idle');
      expect(store.getState().edts).toEqual(edts);
      expect(store.getState().activeEdt).toBe('01JXXXX1');
    });

    it('clears edts to empty (never a stale list) when the registry read itself fails', async () => {
      const edtRegistry: EdtRegistryPort = {
        add: vi.fn(async () => ok(undefined)),
        list: vi.fn(async () => err('edt-registry-invalid-format', 'bad yaml')),
        setStatus: vi.fn(async () => ok(undefined)),
        update: vi.fn(async () => ok(undefined)),
      };
      const store = createAppStore(fakeDeps({ edtRegistry }));

      await store.getState().loadEdts();

      expect(store.getState().edtsStatus).toBe('error');
      expect(store.getState().edtsError).toBe('bad yaml');
      expect(store.getState().edts).toEqual([]);
    });

    // Review patch: readActiveEdt failing used to be treated the same as the registry
    // list itself failing — discarding a perfectly good, already-loaded `edts` list (and
    // with it, AC1's ability to tell "genuinely empty" from "failed to load").
    it('keeps a successfully-loaded edts list even when the separate active-EDT read fails', async () => {
      const edts: EdtRegistryEntry[] = [];
      const edtRegistry: EdtRegistryPort = {
        add: vi.fn(async () => ok(undefined)),
        list: vi.fn(async () => ok(edts)),
        setStatus: vi.fn(async () => ok(undefined)),
        update: vi.fn(async () => ok(undefined)),
      };
      const state: StatePort = {
        readActiveEdt: vi.fn(async () => err('state-read-failed', 'corrupt state.json')),
        writeActiveEdt: vi.fn(async () => ok(undefined)),
      };
      const store = createAppStore(fakeDeps({ edtRegistry, state }));

      await store.getState().loadEdts();

      expect(store.getState().edtsStatus).toBe('idle');
      expect(store.getState().edtsError).toBeNull();
      expect(store.getState().edts).toEqual(edts);
      expect(store.getState().activeEdt).toBeNull();
    });
  });

  describe('createEdt / switchEdt / modifyEdt (story 2.9)', () => {
    it('createEdt forwards deps to the core use-case and, on success, writes and caches the new EDT as active', async () => {
      const edtsBaseDir = await makeEdtsBaseDir();
      let addedUlid: string | undefined;
      const edtRegistry: EdtRegistryPort = {
        add: vi.fn(async (entry) => {
          addedUlid = entry.ulid;
          return ok(undefined);
        }),
        list: vi.fn(async () => ok([])),
        setStatus: vi.fn(async () => ok(undefined)),
        update: vi.fn(async () => ok(undefined)),
      };
      const state: StatePort = {
        readActiveEdt: vi.fn(async () => ok(null)),
        writeActiveEdt: vi.fn(async () => ok(undefined)),
      };
      const store = createAppStore(fakeDeps({ edtRegistry, state, edtsBaseDir }));

      const result = await store.getState().createEdt({ topic: 'demo', members: ['/repo/a'] });

      expect(result.ok).toBe(true);
      expect(addedUlid).toBeDefined();
      expect(state.writeActiveEdt).toHaveBeenCalledWith(addedUlid);
      expect(store.getState().activeEdt).toBe(addedUlid);
    });

    it('createEdt leaves activeEdt untouched when the state.json write itself fails, without failing the overall result', async () => {
      const edtsBaseDir = await makeEdtsBaseDir();
      const edtRegistry: EdtRegistryPort = {
        add: vi.fn(async () => ok(undefined)),
        list: vi.fn(async () => ok([])),
        setStatus: vi.fn(async () => ok(undefined)),
        update: vi.fn(async () => ok(undefined)),
      };
      const state: StatePort = {
        readActiveEdt: vi.fn(async () => ok(null)),
        writeActiveEdt: vi.fn(async () => err('state-write-failed', 'disk full')),
      };
      const store = createAppStore(fakeDeps({ edtRegistry, state, edtsBaseDir }));

      const result = await store.getState().createEdt({ topic: 'demo', members: ['/repo/a'] });

      expect(result.ok).toBe(true);
      expect(store.getState().activeEdt).toBeNull();
    });

    it('returns an explicit store-not-wired error, never a throw, when no ports are wired', async () => {
      const store = createAppStore();
      expect(await store.getState().createEdt({ topic: 'demo', members: [] })).toEqual({
        ok: false,
        error: { code: 'store-not-wired', message: 'No ports wired into the TUI store' },
      });
      expect(await store.getState().switchEdt({ topic: 'demo' })).toEqual({
        ok: false,
        error: { code: 'store-not-wired', message: 'No ports wired into the TUI store' },
      });
      expect(await store.getState().modifyEdt({ topic: 'demo', addMembers: [], removeMembers: [], setBranches: [] })).toEqual({
        ok: false,
        error: { code: 'store-not-wired', message: 'No ports wired into the TUI store' },
      });
    });

    it('switchEdt updates the cached activeEdt pointer on success', async () => {
      const targetEntry: EdtRegistryEntry = { ulid: '01JTARGET', topic: 'target', createdAt: '2026-01-01T00:00:00.000Z', status: 'active', members: [] };
      const edtRegistry: EdtRegistryPort = {
        add: vi.fn(async () => ok(undefined)),
        list: vi.fn(async () => ok([targetEntry])),
        setStatus: vi.fn(async () => ok(undefined)),
        update: vi.fn(async () => ok(undefined)),
      };
      const state: StatePort = {
        readActiveEdt: vi.fn(async () => ok(null)),
        writeActiveEdt: vi.fn(async () => ok(undefined)),
      };
      const store = createAppStore(fakeDeps({ edtRegistry, state }));

      const result = await store.getState().switchEdt({ topic: 'target' });

      expect(result.ok).toBe(true);
      expect(store.getState().activeEdt).toBe('01JTARGET');
    });

    it('modifyEdt forwards params through to the core use-case', async () => {
      const targetEntry: EdtRegistryEntry = { ulid: '01JMOD', topic: 'demo', createdAt: '2026-01-01T00:00:00.000Z', status: 'active', members: [] };
      const edtRegistry: EdtRegistryPort = {
        add: vi.fn(async () => ok(undefined)),
        list: vi.fn(async () => ok([targetEntry])),
        setStatus: vi.fn(async () => ok(undefined)),
        update: vi.fn(async () => ok(undefined)),
      };
      const store = createAppStore(fakeDeps({ edtRegistry }));

      const result = await store.getState().modifyEdt({ topic: 'demo', addMembers: ['/repo/a'], removeMembers: [], setBranches: [] });

      expect(result.ok).toBe(true);
      expect(edtRegistry.update).toHaveBeenCalled();
    });
  });

  describe('requestQuit (story 2.9)', () => {
    it('flips quitRequested — AppShell observes it to call onQuit when a zone has no other way to reach it', () => {
      const store = createAppStore();
      expect(store.getState().quitRequested).toBe(false);
      store.getState().requestQuit();
      expect(store.getState().quitRequested).toBe(true);
    });
  });
});

