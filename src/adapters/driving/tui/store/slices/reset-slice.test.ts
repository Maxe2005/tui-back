// tui/store/slices/reset-slice: the `:reset` overlay's store wiring — BUSY guard, preview
// load, runReset calling the real core resetTool against fake ports (AD-2 in-process), and
// the post-reset rehydration of edts/activeEdt/registryEmpty/filterHistory.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '../../../../../core/result.js';
import type { DockerPort } from '../../../../../core/ports/docker.js';
import type { EdtRegistryEntry, EdtRegistryPort } from '../../../../../core/ports/edt-registry.js';
import type { GitPort } from '../../../../../core/ports/git.js';
import type { LockPort } from '../../../../../core/ports/lock.js';
import type { ManifestPort } from '../../../../../core/ports/manifest.js';
import type { RegistryPort } from '../../../../../core/ports/registry.js';
import type { SettingsPort } from '../../../../../core/ports/settings.js';
import type { StatePort } from '../../../../../core/ports/state.js';
import { DEFAULT_SETTINGS } from '../../../../../core/ports/settings.js';
import { createAppStore, type AppStoreDeps } from '../app-store.js';
import { RESET_NOTICE_TIMEOUT_MS, resolveResetBusyReason } from './reset-slice.js';

type Disk = {
  edts: EdtRegistryEntry[];
  repos: string[];
  activeEdt: string | null;
  filterHistory: Record<string, string[]> | null;
  commandHistory: string[] | null;
};

let baseDir: string;

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'tui-back-reset-slice-'));
});

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

function fakeDeps(disk: Disk, overrides: { lock?: LockPort } = {}): AppStoreDeps {
  const edtRegistry: EdtRegistryPort = {
    add: vi.fn(async () => ok(undefined)),
    list: vi.fn(async () => ok([...disk.edts])),
    setStatus: vi.fn(async () => ok(undefined)),
    update: vi.fn(async () => ok(undefined)),
    remove: vi.fn(async (ulid: string) => {
      disk.edts = disk.edts.filter((e) => e.ulid !== ulid);
      return ok(undefined);
    }),
  };
  const registry: RegistryPort = {
    list: vi.fn(async () => ok([...disk.repos])),
    add: vi.fn(async () => ok(undefined)),
    exists: vi.fn(async () => ok(true)),
    scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
    reset: vi.fn(async () => ok({ path: '/x', backupPath: null })),
    remove: vi.fn(async (path: string) => {
      disk.repos = disk.repos.filter((p) => p !== path);
      return ok(undefined);
    }),
  };
  const state: StatePort = {
    readActiveEdt: vi.fn(async () => ok(disk.activeEdt)),
    writeActiveEdt: vi.fn(async (ulid: string | null) => {
      disk.activeEdt = ulid;
      return ok(undefined);
    }),
    readSplitterRatios: vi.fn(async () => ok(null)),
    writeSplitterRatios: vi.fn(async () => ok(undefined)),
    readFilterHistory: vi.fn(async () => ok(disk.filterHistory)),
    writeFilterHistory: vi.fn(async (history: Record<string, string[]>) => {
      disk.filterHistory = history;
      return ok(undefined);
    }),
    readCommandHistory: vi.fn(async () => ok(disk.commandHistory)),
    writeCommandHistory: vi.fn(async (history: string[]) => {
      disk.commandHistory = history;
      return ok(undefined);
    }),
  };
  const manifest: ManifestPort = {
    load: vi.fn(async (repoPath: string) =>
      ok({ service: `svc-${repoPath}`, container: `ctr-${repoPath}`, sharedBranch: 'development', modules: {} }),
    ),
  };
  const lock: LockPort = overrides.lock ?? {
    acquire: vi.fn(async () => ok({ release: vi.fn(async () => ok(undefined)) })),
    peek: vi.fn(async () => ok({ locked: false })),
  };
  const settings: SettingsPort = {
    load: vi.fn(async () => ok({ settings: DEFAULT_SETTINGS, warning: null })),
    save: vi.fn(async () => ok(undefined)),
  };
  return {
    registry,
    manifest,
    manifestCarry: { capture: async () => ({ ok: true, data: { kind: 'absent' } }), restore: async () => ({ ok: true, data: undefined }) },
    git: {} as GitPort,
    edtRegistry,
    state,
    lock,
    edtRegistryResourceKey: '/cfg/edts.yaml',
    edtsBaseDir: join(baseDir, 'edts'),
    registryResourceKey: '/cfg/registry.yaml',
    settings,
    docker: {} as DockerPort,
  };
}

function populatedDisk(): Disk {
  return {
    edts: [
      {
        ulid: 'ULID1',
        topic: 'feature-a',
        createdAt: '2026-09-29T00:00:00.000Z',
        status: 'active',
        members: [{ service: 'api', repoPath: '/repos/api', branch: 'feat/a' }],
      },
    ],
    repos: ['/repos/api', '/repos/web'],
    activeEdt: 'ULID1',
    filterHistory: { 'global:text': ['error'] },
    commandHistory: ['update-service api'],
  };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('resolveResetBusyReason', () => {
  it('is null when idle and names the reason otherwise', () => {
    expect(resolveResetBusyReason({ runInProgress: false, currentEdtAction: null })).toBeNull();
    expect(resolveResetBusyReason({ runInProgress: true, currentEdtAction: null })).toMatch(/group update/);
    expect(
      resolveResetBusyReason({
        runInProgress: false,
        currentEdtAction: { type: 'switch', target: 'x', startedAt: '2026-09-29T00:00:00.000Z' },
      }),
    ).toMatch(/EDT action \(switch\)/);
  });
});

describe('reset slice', () => {
  it('opens with a preview of the EDT topics and service count', async () => {
    const store = createAppStore(fakeDeps(populatedDisk()));

    expect(store.getState().openResetScreen()).toBe(true);
    expect(store.getState().resetScreenOpen).toBe(true);
    await flush();

    expect(store.getState().resetPreview).toMatchObject({
      status: 'ready',
      edtTopics: ['feature-a'],
      serviceCount: 2,
      edtRegistryFile: '/cfg/edts.yaml',
      registryFile: '/cfg/registry.yaml',
    });
  });

  it('BUSY: refuses to open while a run is in progress, with a reason', () => {
    const store = createAppStore(fakeDeps(populatedDisk()));
    store.getState().setRunInProgress(true);

    expect(store.getState().openResetScreen()).toBe(false);
    expect(store.getState().resetScreenOpen).toBe(false);
    expect(store.getState().resetNotice).toMatch(/group update/);

    store.getState().dismissResetNotice();
    expect(store.getState().resetNotice).toBeNull();
  });

  it('BUSY: the refusal notice auto-dismisses', () => {
    vi.useFakeTimers();
    try {
      const store = createAppStore(fakeDeps(populatedDisk()));
      store.getState().setRunInProgress(true);
      store.getState().openResetScreen();
      expect(store.getState().resetNotice).not.toBeNull();

      vi.advanceTimersByTime(RESET_NOTICE_TIMEOUT_MS);

      expect(store.getState().resetNotice).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('BUSY: an older notice timer never clears a newer notice', () => {
    vi.useFakeTimers();
    try {
      const store = createAppStore(fakeDeps(populatedDisk()));
      store.getState().setRunInProgress(true);
      store.getState().openResetScreen();
      vi.advanceTimersByTime(RESET_NOTICE_TIMEOUT_MS - 1000);
      // Same text again: a string comparison could not tell the two notices apart.
      store.getState().openResetScreen();

      vi.advanceTimersByTime(1000);
      expect(store.getState().resetNotice).not.toBeNull();

      vi.advanceTimersByTime(RESET_NOTICE_TIMEOUT_MS);
      expect(store.getState().resetNotice).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('BUSY: refuses to open while an EDT action is in progress', () => {
    const store = createAppStore(fakeDeps(populatedDisk()));
    store.getState().setCurrentEdtAction({ type: 'create', target: 'new EDT', startedAt: '2026-09-29T00:00:00.000Z' });

    expect(store.getState().openResetScreen()).toBe(false);
    expect(store.getState().resetScreenOpen).toBe(false);
    expect(store.getState().resetNotice).toMatch(/EDT action/);
  });

  it('closing writes nothing', async () => {
    const deps = fakeDeps(populatedDisk());
    const store = createAppStore(deps);
    store.getState().openResetScreen();
    store.getState().closeResetScreen();
    await flush();

    expect(store.getState().resetScreenOpen).toBe(false);
    expect(deps.edtRegistry.remove).not.toHaveBeenCalled();
    expect(deps.registry.remove).not.toHaveBeenCalled();
    expect(deps.state.writeActiveEdt).not.toHaveBeenCalled();
    expect(deps.state.writeFilterHistory).not.toHaveBeenCalled();
  });

  it('runReset executes then rehydrates edts, activeEdt, registryEmpty and filterHistory', async () => {
    const disk = populatedDisk();
    const store = createAppStore(fakeDeps(disk));
    await store.getState().loadEdts();
    await store.getState().loadFilterHistory();
    await store.getState().checkRegistryEmpty();
    expect(store.getState().activeEdt).toBe('ULID1');
    expect(store.getState().registryEmpty).toBe(false);

    store.getState().openResetScreen();
    await store.getState().runReset(['services', 'histories']);

    const state = store.getState();
    expect(state.resetStatus).toBe('done');
    expect(state.resetResult?.outcomes).toEqual({
      edts: { outcome: 'ok' },
      histories: { outcome: 'ok' },
      services: { outcome: 'ok' },
    });
    expect(state.resetResult?.leftBranches).toEqual([
      { topic: 'feature-a', service: 'api', repoPath: '/repos/api', branch: 'feat/a' },
    ]);
    expect(state.edts).toEqual([]);
    expect(state.activeEdt).toBeNull();
    expect(state.registryEmpty).toBe(true);
    expect(state.filterHistory).toEqual({});
    expect(disk.repos).toEqual([]);
  });

  it('runReset surfaces a per-category lock failure in the result', async () => {
    const lock: LockPort = {
      acquire: vi.fn(async (key: string) =>
        key === '/cfg/edts.yaml' ? err('action-in-progress', 'busy') : ok({ release: vi.fn(async () => ok(undefined)) }),
      ),
      peek: vi.fn(async () => ok({ locked: false })),
    };
    const store = createAppStore(fakeDeps(populatedDisk(), { lock }));
    store.getState().openResetScreen();
    await store.getState().runReset(['edts', 'histories']);

    expect(store.getState().resetResult?.outcomes).toEqual({
      edts: { outcome: 'failed', error: { code: 'action-in-progress', message: 'busy' } },
      histories: { outcome: 'ok' },
    });
    expect(store.getState().edts).toHaveLength(1);
  });

  it('runReset re-resolves tab visibility', async () => {
    const deps = fakeDeps(populatedDisk());
    const store = createAppStore(deps);
    // A sentinel no real resolution can produce (a 'disabled' tab carried by a fake service).
    const sentinel = {
      routes: { status: 'disabled' as const, carryingServices: ['sentinel'] },
      sharedTypes: { status: 'disabled' as const, carryingServices: ['sentinel'] },
    };
    store.setState({ tabVisibility: sentinel });

    store.getState().openResetScreen();
    await store.getState().runReset(['services']);

    expect(store.getState().tabVisibilityStatus).toBe('idle');
    expect(store.getState().tabVisibility).not.toEqual(sentinel);
    // No registered service carries a gated module any more.
    expect(store.getState().tabVisibility).toEqual({
      routes: { status: 'omitted', carryingServices: [] },
      sharedTypes: { status: 'omitted', carryingServices: [] },
    });
  });

  it('runReset surfaces an err result from the use-case and leaves running', async () => {
    const store = createAppStore(fakeDeps(populatedDisk()));
    store.getState().openResetScreen();
    await store.getState().runReset([]);

    expect(store.getState().resetStatus).toBe('done');
    expect(store.getState().resetResult).toBeNull();
    expect(store.getState().resetError).toMatch(/at least one category/);
  });

  it('runReset never stays running when the use-case throws, and still rehydrates', async () => {
    const deps = fakeDeps(populatedDisk());
    deps.edtRegistry.list = vi.fn(async () => {
      throw new Error('kaboom');
    });
    const store = createAppStore(deps);
    store.getState().openResetScreen();
    await store.getState().runReset(['edts']);

    expect(store.getState().resetStatus).toBe('done');
    // withActionLock turns a throw inside the locked work into an internal-error outcome.
    expect(store.getState().resetResult?.outcomes.edts?.outcome).toBe('failed');
  });

  it('runReset never stays running when something outside the use-case throws', async () => {
    const deps = fakeDeps(populatedDisk());
    deps.state.readFilterHistory = vi.fn(async () => {
      throw new Error('state exploded');
    });
    const store = createAppStore(deps);
    store.getState().openResetScreen();
    await store.getState().runReset(['histories']);

    expect(store.getState().resetStatus).toBe('done');
    expect(store.getState().resetError).toBe('state exploded');
  });

  it('runReset reports a failing rehydration loader without hiding the result', async () => {
    const store = createAppStore(fakeDeps(populatedDisk()));
    store.setState({
      checkRegistryEmpty: async () => {
        throw new Error('reload failed');
      },
    });
    store.getState().openResetScreen();
    await store.getState().runReset(['histories']);

    expect(store.getState().resetStatus).toBe('done');
    expect(store.getState().resetResult?.outcomes.histories).toEqual({ outcome: 'ok' });
    expect(store.getState().resetError).toMatch(/reload failed/);
  });

  it('a pending filter-history save cannot overwrite the histories reset', async () => {
    const disk = populatedDisk();
    const deps = fakeDeps(disk);
    let releaseSave: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    const writes: Array<Record<string, string[]>> = [];
    deps.state.writeFilterHistory = vi.fn(async (history: Record<string, string[]>) => {
      if (writes.length === 0) {
        // The first write is the logs slice's commit: held until after runReset has started.
        writes.push(history);
        await gate;
      } else {
        writes.push(history);
      }
      disk.filterHistory = history;
      return ok(undefined);
    });
    const store = createAppStore(deps);
    await store.getState().loadFilterHistory();
    store.getState().commitFilterHistoryEntry({ scope: 'global', repoPath: null, mode: 'text' }, 'pending');
    await flush();

    store.getState().openResetScreen();
    const running = store.getState().runReset(['histories']);
    await flush();
    releaseSave();
    await running;

    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual({});
    expect(disk.filterHistory).toEqual({});
    expect(store.getState().filterHistory).toEqual({});
  });

  it('preview: a rejecting port sets an error preview instead of loading forever', async () => {
    const deps = fakeDeps(populatedDisk());
    deps.registry.list = vi.fn(async () => {
      throw new Error('registry exploded');
    });
    const store = createAppStore(deps);
    store.getState().openResetScreen();
    await flush();

    expect(store.getState().resetPreview).toMatchObject({ status: 'error', error: 'registry exploded' });
  });

  it('closeResetScreen clears the result so a reopen starts fresh', async () => {
    const store = createAppStore(fakeDeps(populatedDisk()));
    store.getState().openResetScreen();
    await store.getState().runReset(['histories']);
    store.getState().closeResetScreen();

    expect(store.getState().resetResult).toBeNull();
    expect(store.getState().resetStatus).toBe('idle');
  });
});
