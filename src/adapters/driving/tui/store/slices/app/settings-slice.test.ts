// tui/store/slices/settings-slice: the shared-branches switch's side effects — a persisted flip
// reloads the EDT list once (system EDT first), an unchanged or refused update does not.
import { describe, expect, it, vi } from 'vitest';
import { ok } from '../../../../../../core/result.js';
import { SHARED_EDT_ULID } from '../../../../../../core/edt/shared-edt.js';
import type { EdtRegistryEntry } from '../../../../../../core/ports/edt-registry.js';
import { createAppStore, type AppStoreDeps } from '../../app-store.js';

function entry(ulid: string, topic: string, kind?: 'system-shared'): EdtRegistryEntry {
  return { ulid, topic, createdAt: '', status: 'inactive', members: [], ...(kind ? { kind } : {}) };
}

function build(active: string | null = null) {
  const list = vi.fn(async () => ok([entry('u1', 'mine'), entry(SHARED_EDT_ULID, 'Shared branches', 'system-shared'), entry('u2', 'other')]));
  const deps = {
    settings: { load: vi.fn(async () => ok({ settings: undefined, warning: null })), save: vi.fn(async () => ok(undefined)) },
    state: { readActiveEdt: vi.fn(async () => ok(active)) },
    edtRegistry: { list },
  } as unknown as AppStoreDeps;
  return { store: createAppStore(deps), list };
}

describe('updateSettings: shared-branches switch', () => {
  it('reloads the EDTs once per real flip, never when unchanged', async () => {
    const { store, list } = build();
    await store.getState().updateSettings({ edts: { sharedBranchesEdtEnabled: true } });
    expect(list).toHaveBeenCalledTimes(1);
    await store.getState().updateSettings({ edts: { sharedBranchesEdtEnabled: true } });
    expect(list).toHaveBeenCalledTimes(1);
    await store.getState().updateSettings({ edts: { sharedBranchesEdtEnabled: false } });
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('rapid toggles each reload (compared against the live value)', async () => {
    const { store, list } = build();
    await Promise.all([
      store.getState().updateSettings({ edts: { sharedBranchesEdtEnabled: true } }),
      store.getState().updateSettings({ edts: { sharedBranchesEdtEnabled: false } }),
    ]);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('a refused disable (system EDT active) persists and reloads nothing', async () => {
    const { store, list } = build(SHARED_EDT_ULID);
    await store.getState().updateSettings({ edts: { sharedBranchesEdtEnabled: true } });
    list.mockClear();
    await store.getState().updateSettings({ edts: { sharedBranchesEdtEnabled: false } });
    expect(list).not.toHaveBeenCalled();
    expect(store.getState().settings.edts.sharedBranchesEdtEnabled).toBe(true);
    expect(store.getState().settingsWarning).toContain('switch to another EDT first');
  });
});

describe('loadEdts ordering', () => {
  it('puts the system EDT first and keeps the user order', async () => {
    const { store } = build();
    await store.getState().loadEdts();
    expect(store.getState().edts?.map((e) => e.ulid)).toEqual([SHARED_EDT_ULID, 'u1', 'u2']);
  });
});
