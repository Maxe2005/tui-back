// core/scripts/reset-tool: unit tests against fake ports and a real tmp edtsBaseDir — the
// all-categories, history-only, empty-state and lock-held cases, plus the services ⇒ edts rule.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { err, ok, type Result } from '../result.js';
import type { EdtRegistryEntry, EdtRegistryPort } from '../ports/edt-registry.js';
import type { LockHandle, LockPort } from '../ports/lock.js';
import type { RegistryPort } from '../ports/registry.js';
import type { StatePort } from '../ports/state.js';
import { resetTool, resolveResetCategories } from './reset-tool.js';

const KEYS = { edtRegistry: '/cfg/edts.yaml', registry: '/cfg/registry.yaml' };

function edt(ulid: string, topic: string, members: Array<[string, string, string]>): EdtRegistryEntry {
  return {
    ulid,
    topic,
    createdAt: '2026-09-29T00:00:00.000Z',
    status: 'inactive',
    members: members.map(([service, repoPath, branch]) => ({ service, repoPath, branch })),
  };
}

function fakeEdtRegistry(initial: EdtRegistryEntry[]): EdtRegistryPort & { entries: EdtRegistryEntry[] } {
  const port = {
    entries: [...initial],
    add: vi.fn(async () => ok(undefined)),
    list: vi.fn(async () => ok([...port.entries])),
    setStatus: vi.fn(async () => ok(undefined)),
    update: vi.fn(async () => ok(undefined)),
    remove: vi.fn(async (ulid: string): Promise<Result<void>> => {
      if (!port.entries.some((e) => e.ulid === ulid)) {
        return err('edt-not-found', `No EDT registered with ulid ${ulid}`);
      }
      port.entries = port.entries.filter((e) => e.ulid !== ulid);
      return ok(undefined);
    }),
  };
  return port;
}

function fakeRegistry(initial: string[]): RegistryPort & { paths: string[] } {
  const port = {
    paths: [...initial],
    list: vi.fn(async () => ok([...port.paths])),
    add: vi.fn(async () => ok(undefined)),
    exists: vi.fn(async () => ok(true)),
    scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
    reset: vi.fn(async () => ok({ path: '/x', backupPath: null })),
    remove: vi.fn(async (path: string) => {
      port.paths = port.paths.filter((p) => p !== path);
      return ok(undefined);
    }),
  };
  return port;
}

type StateData = {
  activeEdt: string | null;
  splitterRatios: Record<string, number[]> | null;
  filterHistory: Record<string, string[]> | null;
};

function fakeState(initial: StateData): StatePort & { data: StateData } {
  const port = {
    data: { ...initial },
    readActiveEdt: vi.fn(async () => ok(port.data.activeEdt)),
    writeActiveEdt: vi.fn(async (ulid: string | null) => {
      port.data.activeEdt = ulid;
      return ok(undefined);
    }),
    readSplitterRatios: vi.fn(async () => ok(port.data.splitterRatios)),
    writeSplitterRatios: vi.fn(async (ratios: Record<string, number[]>) => {
      port.data.splitterRatios = ratios;
      return ok(undefined);
    }),
    readFilterHistory: vi.fn(async () => ok(port.data.filterHistory)),
    writeFilterHistory: vi.fn(async (history: Record<string, string[]>) => {
      port.data.filterHistory = history;
      return ok(undefined);
    }),
  };
  return port;
}

function fakeLock(heldKeys: string[] = []): LockPort {
  return {
    acquire: vi.fn(async (key: string): Promise<Result<LockHandle>> =>
      heldKeys.includes(key)
        ? err('action-in-progress', `Another action is in progress on ${key}`)
        : ok({ release: vi.fn(async () => ok(undefined)) })),
    peek: vi.fn(async () => ok({ locked: false })),
  };
}

let baseDir: string;
let edtsBaseDir: string;

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'tui-back-reset-tool-'));
  edtsBaseDir = join(baseDir, 'edts');
  await mkdir(join(edtsBaseDir, 'ULID1'), { recursive: true });
  await writeFile(join(edtsBaseDir, 'ULID1', 'file.txt'), 'x');
  await writeFile(join(edtsBaseDir, 'ULID1.db'), 'db');
  await writeFile(join(edtsBaseDir, 'ULID2.db'), 'db');
});

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

function fullSetup() {
  return {
    edtRegistry: fakeEdtRegistry([
      edt('ULID1', 'feature-a', [['api', '/repos/api', 'feat/a'], ['web', '/repos/web', 'feat/a']]),
      edt('ULID2', 'feature-b', [['api', '/repos/api', 'feat/b']]),
    ]),
    registry: fakeRegistry(['/repos/api', '/repos/web', '/repos/db', '/repos/auth']),
    state: fakeState({
      activeEdt: 'ULID1',
      splitterRatios: { edts: [0.4, 0.5, 0.6] },
      filterHistory: { 'global:text': ['error'] },
    }),
  };
}

describe('resolveResetCategories', () => {
  it('forces edts when services is requested and keeps execution order', () => {
    expect(resolveResetCategories(['services'])).toEqual(['edts', 'services']);
    expect(resolveResetCategories(['services', 'histories', 'edts'])).toEqual(['edts', 'histories', 'services']);
    expect(resolveResetCategories(['histories'])).toEqual(['histories']);
  });
});

describe('resetTool', () => {
  it('ALL: wipes every category and lists every left-behind branch', async () => {
    const { edtRegistry, registry, state } = fullSetup();

    const result = await resetTool({
      categories: ['edts', 'histories', 'services'],
      edtRegistry,
      registry,
      state,
      lock: fakeLock(),
      keys: KEYS,
      edtsBaseDir,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.outcomes).toEqual({ edts: { outcome: 'ok' }, histories: { outcome: 'ok' }, services: { outcome: 'ok' } });
    expect(edtRegistry.entries).toEqual([]);
    expect(await readdir(edtsBaseDir)).toEqual([]);
    expect(state.data.activeEdt).toBeNull();
    expect(state.data.filterHistory).toEqual({});
    expect(state.data.splitterRatios).toEqual({ edts: [0.4, 0.5, 0.6] });
    expect(registry.paths).toEqual([]);
    expect(result.data.leftBranches).toEqual([
      { topic: 'feature-a', service: 'api', repoPath: '/repos/api', branch: 'feat/a' },
      { topic: 'feature-a', service: 'web', repoPath: '/repos/web', branch: 'feat/a' },
      { topic: 'feature-b', service: 'api', repoPath: '/repos/api', branch: 'feat/b' },
    ]);
  });

  it('HISTORY_ONLY: clears only filterHistory', async () => {
    const { edtRegistry, registry, state } = fullSetup();

    const result = await resetTool({
      categories: ['histories'],
      edtRegistry,
      registry,
      state,
      lock: fakeLock(),
      keys: KEYS,
      edtsBaseDir,
    });

    expect(result).toEqual({ ok: true, data: { outcomes: { histories: { outcome: 'ok' } }, leftBranches: [] } });
    expect(state.data).toEqual({
      activeEdt: 'ULID1',
      splitterRatios: { edts: [0.4, 0.5, 0.6] },
      filterHistory: {},
    });
    expect(edtRegistry.entries).toHaveLength(2);
    expect(registry.paths).toHaveLength(4);
    expect((await readdir(edtsBaseDir)).sort()).toEqual(['ULID1', 'ULID1.db', 'ULID2.db']);
    expect(state.writeActiveEdt).not.toHaveBeenCalled();
  });

  it('services alone also resets EDTs', async () => {
    const { edtRegistry, registry, state } = fullSetup();

    const result = await resetTool({
      categories: ['services'],
      edtRegistry,
      registry,
      state,
      lock: fakeLock(),
      keys: KEYS,
      edtsBaseDir,
    });

    expect(result.ok && result.data.outcomes).toEqual({ edts: { outcome: 'ok' }, services: { outcome: 'ok' } });
    expect(edtRegistry.entries).toEqual([]);
    expect(registry.paths).toEqual([]);
    expect(state.data.filterHistory).toEqual({ 'global:text': ['error'] });
  });

  it('EMPTY_STATE: every category succeeds as a no-op without writing', async () => {
    const edtRegistry = fakeEdtRegistry([]);
    const registry = fakeRegistry([]);
    const state = fakeState({ activeEdt: null, splitterRatios: null, filterHistory: null });
    const missingDir = join(baseDir, 'does-not-exist');

    const result = await resetTool({
      categories: ['edts', 'histories', 'services'],
      edtRegistry,
      registry,
      state,
      lock: fakeLock(),
      keys: KEYS,
      edtsBaseDir: missingDir,
    });

    expect(result).toEqual({
      ok: true,
      data: {
        outcomes: { edts: { outcome: 'ok' }, histories: { outcome: 'ok' }, services: { outcome: 'ok' } },
        leftBranches: [],
      },
    });
    expect(state.writeActiveEdt).not.toHaveBeenCalled();
    expect(state.writeFilterHistory).not.toHaveBeenCalled();
    expect(existsSync(missingDir)).toBe(false);
  });

  it('LOCK_HELD: a held EDT lock fails EDTs (and the dependent services) but histories still run', async () => {
    const { edtRegistry, registry, state } = fullSetup();

    const result = await resetTool({
      categories: ['edts', 'histories', 'services'],
      edtRegistry,
      registry,
      state,
      lock: fakeLock([KEYS.edtRegistry]),
      keys: KEYS,
      edtsBaseDir,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.outcomes.edts).toEqual({
      outcome: 'failed',
      error: { code: 'action-in-progress', message: `Another action is in progress on ${KEYS.edtRegistry}` },
    });
    expect(result.data.outcomes.histories).toEqual({ outcome: 'ok' });
    expect(result.data.leftBranches).toEqual([]);
    expect(edtRegistry.entries).toHaveLength(2);
    expect(state.data.activeEdt).toBe('ULID1');
    expect((await readdir(edtsBaseDir)).length).toBe(3);
    // services ⇒ edts at execution time: the EDT failure skips services, registry untouched.
    expect(result.data.outcomes.services).toEqual({
      outcome: 'failed',
      error: { code: 'reset-skipped-edts-failed', message: 'Skipped because the EDT reset failed' },
    });
    expect(registry.paths).toHaveLength(4);
    expect(registry.remove).not.toHaveBeenCalled();
    expect(state.data.filterHistory).toEqual({});
  });

  it('clears activeEdt even when an EDT removal fails partway', async () => {
    const { edtRegistry, registry, state } = fullSetup();
    const originalRemove = edtRegistry.remove;
    edtRegistry.remove = vi.fn(async (ulid: string) =>
      ulid === 'ULID2' ? err('edt-registry-write-error', 'disk full') : originalRemove(ulid));

    const result = await resetTool({ categories: ['edts'], edtRegistry, registry, state, lock: fakeLock(), keys: KEYS, edtsBaseDir });

    expect(result.ok && result.data.outcomes.edts).toEqual({
      outcome: 'failed',
      error: { code: 'edt-registry-write-error', message: 'disk full' },
    });
    expect(state.data.activeEdt).toBeNull();
    expect(result.ok && result.data.leftBranches.map((b) => b.topic)).toEqual(['feature-a', 'feature-a']);
  });

  it.skipIf(process.getuid?.() === 0)('clears activeEdt even when the directory wipe fails partway', async () => {
    const { edtRegistry, registry, state } = fullSetup();
    // A read-only base dir: readdir works, deleting its children fails with EACCES.
    await chmod(edtsBaseDir, 0o500);
    try {
      const result = await resetTool({ categories: ['edts'], edtRegistry, registry, state, lock: fakeLock(), keys: KEYS, edtsBaseDir });

      expect(result.ok && result.data.outcomes.edts?.outcome).toBe('failed');
      expect(result.ok && result.data.outcomes.edts?.outcome === 'failed' && result.data.outcomes.edts.error.code).toBe('reset-fs-error');
      expect(edtRegistry.entries).toEqual([]);
      expect(state.data.activeEdt).toBeNull();
    } finally {
      await chmod(edtsBaseDir, 0o700);
    }
  });

  it('a failed readActiveEdt fails the EDT category before anything is removed', async () => {
    const { edtRegistry, registry, state } = fullSetup();
    state.readActiveEdt = vi.fn(async () => err('state-read-error', 'EIO'));

    const result = await resetTool({ categories: ['edts'], edtRegistry, registry, state, lock: fakeLock(), keys: KEYS, edtsBaseDir });

    expect(result.ok && result.data.outcomes.edts).toEqual({ outcome: 'failed', error: { code: 'state-read-error', message: 'EIO' } });
    expect(state.writeActiveEdt).not.toHaveBeenCalled();
    expect(edtRegistry.entries).toHaveLength(2);
    expect((await readdir(edtsBaseDir)).length).toBe(3);
  });

  it('a failed readFilterHistory fails the histories category without writing', async () => {
    const { edtRegistry, registry, state } = fullSetup();
    state.readFilterHistory = vi.fn(async () => err('state-read-error', 'EIO'));

    const result = await resetTool({ categories: ['histories'], edtRegistry, registry, state, lock: fakeLock(), keys: KEYS, edtsBaseDir });

    expect(result.ok && result.data.outcomes.histories).toEqual({ outcome: 'failed', error: { code: 'state-read-error', message: 'EIO' } });
    expect(state.writeFilterHistory).not.toHaveBeenCalled();
  });

  it.each(['', 'relative/edts'])('refuses to wipe a non-absolute edtsBaseDir (%j)', async (dir) => {
    const { edtRegistry, registry, state } = fullSetup();

    const result = await resetTool({ categories: ['edts'], edtRegistry, registry, state, lock: fakeLock(), keys: KEYS, edtsBaseDir: dir });

    expect(result.ok && result.data.outcomes.edts?.outcome).toBe('failed');
    expect(edtRegistry.remove).not.toHaveBeenCalled();
    expect(state.writeActiveEdt).not.toHaveBeenCalled();
  });

  it('LOCK_HELD: a held registry lock fails only services', async () => {
    const { edtRegistry, registry, state } = fullSetup();

    const result = await resetTool({
      categories: ['edts', 'services'],
      edtRegistry,
      registry,
      state,
      lock: fakeLock([KEYS.registry]),
      keys: KEYS,
      edtsBaseDir,
    });

    expect(result.ok && result.data.outcomes.edts).toEqual({ outcome: 'ok' });
    expect(result.ok && result.data.outcomes.services?.outcome).toBe('failed');
    expect(registry.paths).toHaveLength(4);
    expect(edtRegistry.entries).toEqual([]);
  });

  it('reports a port failure per category without rolling back others', async () => {
    const { edtRegistry, registry, state } = fullSetup();
    state.writeFilterHistory = vi.fn(async () => err('state-write-error', 'disk full'));

    const result = await resetTool({
      categories: ['edts', 'histories'],
      edtRegistry,
      registry,
      state,
      lock: fakeLock(),
      keys: KEYS,
      edtsBaseDir,
    });

    expect(result.ok && result.data.outcomes).toEqual({
      edts: { outcome: 'ok' },
      histories: { outcome: 'failed', error: { code: 'state-write-error', message: 'disk full' } },
    });
    expect(edtRegistry.entries).toEqual([]);
  });

  it('rejects an empty selection', async () => {
    const { edtRegistry, registry, state } = fullSetup();

    const result = await resetTool({ categories: [], edtRegistry, registry, state, lock: fakeLock(), keys: KEYS, edtsBaseDir });

    expect(result.ok).toBe(false);
    expect(edtRegistry.remove).not.toHaveBeenCalled();
  });
});
