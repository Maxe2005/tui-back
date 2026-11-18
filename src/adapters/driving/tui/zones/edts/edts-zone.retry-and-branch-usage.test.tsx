// EdtsZone real-keypress tests: retry and branch usage.
import { describe, it, expect, vi } from 'vitest';
import type { Result } from '../../../../../core/result.js';
import type { ModifyEdtData } from '../../../../../core/edt/modify.js';
import { createAppStore, type ModifyEdtParams } from '../../store/app-store.js';
import { KEYS } from '../../shared/test-support/fake-tty.js';
import { EdtsZone } from './edts-zone.js';
import { edt, press, type, mount } from './edts-zone.test-support.js';

describe('EdtsZone R retry (real keypress)', () => {
  function errorStore(overrides: Record<string, unknown>) {
    const store = createAppStore();
    store.setState({
      edts: null,
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: null,
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      ...overrides,
    });
    return store;
  }

  it('R reloads only the source that failed', async () => {
    const loadEdts = vi.fn(async () => {});
    const loadEdtsBranches = vi.fn(async () => {});
    const store = errorStore({ edtsStatus: 'error', edtsBranchesStatus: 'idle', loadEdts, loadEdtsBranches });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      const edtCalls = loadEdts.mock.calls.length;
      const branchCalls = loadEdtsBranches.mock.calls.length;
      await press(instance, stdin, 'R');
      expect(loadEdts.mock.calls.length).toBe(edtCalls + 1);
      expect(loadEdtsBranches.mock.calls.length).toBe(branchCalls);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('R is ignored while a load is in flight', async () => {
    const loadEdts = vi.fn(async () => {});
    const loadEdtsBranches = vi.fn(async () => {});
    const store = errorStore({ edtsStatus: 'error', edtsBranchesStatus: 'loading', loadEdts, loadEdtsBranches });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      const edtCalls = loadEdts.mock.calls.length;
      const branchCalls = loadEdtsBranches.mock.calls.length;
      await press(instance, stdin, 'R');
      expect(loadEdts.mock.calls.length).toBe(edtCalls);
      expect(loadEdtsBranches.mock.calls.length).toBe(branchCalls);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});

describe('EdtsZone cross-EDT branch usage host wiring', () => {
  // The dialog wraps long lines, so only the first wrapped segment is asserted.
  const REFUSAL = "utilisée par l'EDT « B » — la reprendre ou la";

  it('Add-to-EDT: an owned branch is annotated and refused; renaming passes the edited EDT ulid as edtId', async () => {
    const edtA = edt({ ulid: 'A-ulid', topic: 'A', status: 'active', members: [] });
    const edtB = edt({ ulid: 'B-ulid', topic: 'B', members: [{ service: 'svc-b', repoPath: '/repos/b', branch: 'feat/owned' }] });
    let modifyCalls = 0;
    const renameCalls: unknown[][] = [];
    const store = createAppStore();
    store.setState({
      edts: [edtA, edtB],
      edtsStatus: 'idle',
      activeEdt: 'A-ulid',
      edtsBranches: [
        { service: 'svc-b', path: '/repos/b', isMember: false, branch: 'feat/owned', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      listBranches: async () => ({ ok: true, data: ['feat/owned', 'feat/free'] }),
      renameBranch: async (...args: unknown[]) => {
        renameCalls.push(args);
        return { ok: true, data: undefined };
      },
      modifyEdt: async (): Promise<Result<ModifyEdtData>> => {
        modifyCalls += 1;
        return { ok: true, data: { ulid: 'A-ulid', topic: 'A', results: [] } };
      },
      logEdtAction: async () => {},
    } as never);

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.enter); // Add to EDT
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // Pick existing
      expect(stdout.output).toContain('⚠ EDT « B »');

      await press(instance, stdin, KEYS.enter); // insert feat/owned
      await press(instance, stdin, KEYS.enter); // confirm -> refused
      expect(stdout.output).toContain(REFUSAL);
      expect(modifyCalls).toBe(0);

      for (let i = 0; i < 'feat/owned'.length; i += 1) {
        await press(instance, stdin, KEYS.backspace);
      }
      await type(instance, stdin, 'feat/free');
      await press(instance, stdin, KEYS.ctrlT); // row-rename sub-view
      for (let i = 0; i < 'free'.length; i += 1) {
        await press(instance, stdin, KEYS.backspace);
      }
      await type(instance, stdin, 'ren');
      await press(instance, stdin, KEYS.enter);
      await instance.waitUntilRenderFlush();
      expect(renameCalls).toEqual([['/repos/b', 'feat/free', 'feat/ren', 'A-ulid']]);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Change branch: another EDT\'s branch is refused, the edited EDT\'s own branch is not', async () => {
    const edtA = edt({ ulid: 'A-ulid', topic: 'A', status: 'active', members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }] });
    const edtB = edt({ ulid: 'B-ulid', topic: 'B', members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'feat/theirs' }] });
    let modifyParams: ModifyEdtParams | undefined;
    const store = createAppStore();
    store.setState({
      edts: [edtA, edtB],
      edtsStatus: 'idle',
      activeEdt: 'A-ulid',
      edtsBranches: [
        { service: 'svc-a', path: '/repos/a', isMember: true, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      listBranches: async () => ({ ok: true, data: ['main', 'feat/theirs'] }),
      modifyEdt: async (params): Promise<Result<ModifyEdtData>> => {
        modifyParams = params;
        return { ok: true, data: { ulid: 'A-ulid', topic: 'A', results: [] } };
      },
      logEdtAction: async () => {},
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.enter); // picker (Create new)
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // Rename current
      await press(instance, stdin, KEYS.tab); // Pick existing
      expect(stdout.output).toContain('⚠ EDT « B »');
      await type(instance, stdin, 'feat/theirs');
      await press(instance, stdin, KEYS.enter);
      expect(stdout.output).toContain(REFUSAL);
      expect(modifyParams).toBeUndefined();

      for (let i = 0; i < 'feat/theirs'.length; i += 1) {
        await press(instance, stdin, KEYS.backspace);
      }
      await type(instance, stdin, 'main');
      await press(instance, stdin, KEYS.enter); // own branch: accepted
      await instance.waitUntilRenderFlush();
      expect(modifyParams?.setBranches).toEqual([{ repoPath: '/repos/a', branch: 'main' }]);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});
