// EdtsZone real-keypress tests: service actions.
import { render } from 'ink';
import { describe, it, expect } from 'vitest';
import type { Result } from '../../../../../../../core/result.js';
import type { ModifyEdtData } from '../../../../../../../core/workspace/edt/lifecycle/modify.js';
import { createAppStore, type ModifyEdtParams } from '../../../../store/app-store.js';
import { KEYS } from '../../../../shared/test-support/fake-tty.js';
import { EdtsZone } from '../../edts-zone.js';
import { edt, press, type, settleBranches, mount } from '../../edts-zone.test-support.js';

describe('EdtsZone real-keypress interactions — service-actions', () => {
  it('Tab cycles edts -> edt-services -> other-services -> edts (3-way base-view cycle)', async () => {
    const active = edt({
      ulid: 'active-ulid',
      topic: 'active-edt',
      status: 'active',
      members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }],
    });
    const store = createAppStore();
    store.setState({
      edts: [active],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [
        { service: 'svc-a', path: '/repos/a', isMember: true, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] },
        { service: 'svc-b', path: '/repos/b', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      // Default focus: the EDT selector — its detail-pane hint is [Enter] Modify (row 0 is
      // the active EDT).
      expect(stdout.output).toContain('[Enter] Modify');

      await press(instance, stdin, KEYS.tab);
      expect(stdout.output).toContain('[Enter] Remove / Change branch');

      await press(instance, stdin, KEYS.tab);
      expect(stdout.output).toContain('[Enter] Add to EDT');

      await press(instance, stdin, KEYS.tab);
      expect(stdout.output).toContain('[Enter] Modify');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Enter on an EDT SERVICES row -> Remove from EDT calls modifyEdt with removeMembers and logs the outcome', async () => {
    const active = edt({
      ulid: 'active-ulid',
      topic: 'active-edt',
      status: 'active',
      members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }],
    });
    let modifyParams: ModifyEdtParams | undefined;
    let loggedOutcome: string | undefined;
    const store = createAppStore();
    store.setState({
      edts: [active],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [
        { service: 'svc-a', path: '/repos/a', isMember: true, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      modifyEdt: async (params): Promise<Result<ModifyEdtData>> => {
        modifyParams = params;
        return { ok: true, data: { ulid: 'active-ulid', topic: 'active-edt', results: [] } };
      },
      logEdtAction: async (_ulid, _actionType, outcome) => {
        loggedOutcome = outcome;
      },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edts -> edt-services
      await press(instance, stdin, KEYS.enter); // open the contextual menu on the one row
      expect(stdout.output).toContain('SERVICE ACTIONS');
      expect(stdout.output).toContain('Remove from EDT');

      await press(instance, stdin, KEYS.enter); // cursor 0 (Remove from EDT) -> confirm

      expect(modifyParams).toEqual({ topic: 'active-edt', addMembers: [], removeMembers: ['/repos/a'], setBranches: [] });
      expect(loggedOutcome).toBe('success');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Enter on an EDT SERVICES row -> Change branch for this EDT calls modifyEdt with setBranches', async () => {
    const active = edt({
      ulid: 'active-ulid',
      topic: 'active-edt',
      status: 'active',
      members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }],
    });
    let modifyParams: ModifyEdtParams | undefined;
    let loggedOutcome: string | undefined;
    const store = createAppStore();
    store.setState({
      edts: [active],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [
        { service: 'svc-a', path: '/repos/a', isMember: true, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      // Pick existing over the repo's own real branch list is the simplest path to a plain 'set'
      // outcome (no store-action pre-step, unlike Create new/Rename current).
      listBranches: async () => ({ ok: true, data: ['main-y'] }),
      modifyEdt: async (params): Promise<Result<ModifyEdtData>> => {
        modifyParams = params;
        return { ok: true, data: { ulid: 'active-ulid', topic: 'active-edt', results: [] } };
      },
      logEdtAction: async (_ulid, _actionType, outcome) => {
        loggedOutcome = outcome;
      },
    });

    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edts -> edt-services
      await press(instance, stdin, KEYS.enter); // open the contextual menu
      await press(instance, stdin, KEYS.down); // cursor -> "Change branch for this EDT"
      await press(instance, stdin, KEYS.enter); // open the branch-picker (Create new default)
      await instance.waitUntilRenderFlush(); // let listBranches resolve
      await press(instance, stdin, KEYS.tab); // Create new -> Rename current
      await press(instance, stdin, KEYS.tab); // Rename current -> Pick existing
      await type(instance, stdin, 'main-y');
      await press(instance, stdin, KEYS.enter); // select + confirm, one submit

      expect(modifyParams).toEqual({
        topic: 'active-edt',
        addMembers: [],
        removeMembers: [],
        setBranches: [{ repoPath: '/repos/a', branch: 'main-y' }],
        renameBranches: [],
      });
      expect(loggedOutcome).toBe('success');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Change branch for this EDT via Rename current reaches modifyEdt via renameBranches, not setBranches', async () => {
    const active = edt({
      ulid: 'active-ulid',
      topic: 'active-edt',
      status: 'active',
      members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }],
    });
    let modifyParams: ModifyEdtParams | undefined;
    const store = createAppStore();
    store.setState({
      edts: [active],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [
        { service: 'svc-a', path: '/repos/a', isMember: true, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      listBranches: async () => ({ ok: true, data: [] }),
      modifyEdt: async (params): Promise<Result<ModifyEdtData>> => {
        modifyParams = params;
        return { ok: true, data: { ulid: 'active-ulid', topic: 'active-edt', results: [] } };
      },
    });

    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edts -> edt-services
      await press(instance, stdin, KEYS.enter); // open the contextual menu
      await press(instance, stdin, KEYS.down); // cursor -> "Change branch for this EDT"
      await press(instance, stdin, KEYS.enter); // open the branch-picker (Create new default)
      await instance.waitUntilRenderFlush(); // let listBranches resolve
      await press(instance, stdin, KEYS.tab); // Create new -> Rename current (stays here, unlike the setBranches test above)
      for (let i = 0; i < 'main'.length; i += 1) {
        await press(instance, stdin, KEYS.backspace);
      }
      await type(instance, stdin, 'feature-renamed');
      await press(instance, stdin, KEYS.enter); // confirm the rename, one submit

      expect(modifyParams).toEqual({
        topic: 'active-edt',
        addMembers: [],
        removeMembers: [],
        setBranches: [],
        renameBranches: [{ repoPath: '/repos/a', newName: 'feature-renamed' }],
      });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Change branch, empty value -> inline rejection, never reaches modifyEdt', async () => {
    const active = edt({
      ulid: 'active-ulid',
      topic: 'active-edt',
      status: 'active',
      members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }],
    });
    let modifyCalls = 0;
    const store = createAppStore();
    store.setState({
      edts: [active],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [
        { service: 'svc-a', path: '/repos/a', isMember: true, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      modifyEdt: async (): Promise<Result<ModifyEdtData>> => {
        modifyCalls += 1;
        return { ok: true, data: { ulid: 'active-ulid', topic: 'active-edt', results: [] } };
      },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.enter); // open the contextual menu
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.enter); // open the branch-picker
      await press(instance, stdin, KEYS.tab); // Create new -> Rename current, pre-filled "main"
      for (let i = 0; i < 'main'.length; i += 1) {
        await press(instance, stdin, KEYS.backspace);
      }
      await press(instance, stdin, KEYS.enter); // submit empty

      expect(stdout.output).toContain('Branch name must not be empty');
      expect(modifyCalls).toBe(0);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('the Restart row is visibly disabled and Enter on it is a no-op — never dispatches', async () => {
    const active = edt({
      ulid: 'active-ulid',
      topic: 'active-edt',
      status: 'active',
      members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }],
    });
    let modifyCalls = 0;
    const store = createAppStore();
    store.setState({
      edts: [active],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [
        { service: 'svc-a', path: '/repos/a', isMember: true, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      modifyEdt: async (): Promise<Result<ModifyEdtData>> => {
        modifyCalls += 1;
        return { ok: true, data: { ulid: 'active-ulid', topic: 'active-edt', results: [] } };
      },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.enter); // open the contextual menu
      await press(instance, stdin, KEYS.down); // -> Change branch
      await press(instance, stdin, KEYS.down); // -> Restart (disabled)
      await press(instance, stdin, KEYS.enter); // no-op

      expect(modifyCalls).toBe(0);
      // Still the same contextual menu — never torn down by the no-op Enter.
      expect(stdout.output).toContain('SERVICE ACTIONS');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Enter on an OTHER SERVICES row -> Add to EDT (pre-filled branch, confirmed) calls modifyEdt with addMembers+setBranches in one call', async () => {
    const active = edt({ ulid: 'active-ulid', topic: 'active-edt', status: 'active', members: [] });
    let modifyParams: ModifyEdtParams | undefined;
    let loggedOutcome: string | undefined;
    const store = createAppStore();
    store.setState({
      edts: [active],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [
        { service: 'svc-b', path: '/repos/b', isMember: false, branch: 'feature-y', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      // Pick existing (one Tab away from the picker's Create-new default, since Add-to-EDT never
      // offers Rename current) over the repo's own real branch list lets this test confirm the
      // pre-filled candidate with a single select+confirm — no store-action pre-step (no
      // `createMemberBranch` mock needed) unlike Create-new's own path.
      listBranches: async () => ({ ok: true, data: ['feature-y'] }),
      modifyEdt: async (params): Promise<Result<ModifyEdtData>> => {
        modifyParams = params;
        return { ok: true, data: { ulid: 'active-ulid', topic: 'active-edt', results: [] } };
      },
      logEdtAction: async (_ulid, _actionType, outcome) => {
        loggedOutcome = outcome;
      },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edts -> edt-services
      await press(instance, stdin, KEYS.tab); // edt-services -> other-services
      await press(instance, stdin, KEYS.enter); // open Add to EDT on the one row
      await instance.waitUntilRenderFlush(); // let listBranches resolve
      expect(stdout.output).toContain('ADD TO EDT');
      expect(stdout.output).toContain('feature-y'); // pre-filled with the row's current branch

      await press(instance, stdin, KEYS.tab); // Create new -> Pick existing
      // Shared autocomplete: empty filter matches everything — first Enter inserts the
      // highlighted branch into the filter, second Enter confirms it (no branch created).
      await press(instance, stdin, KEYS.enter); // insert 'feature-y' into the filter
      await press(instance, stdin, KEYS.enter); // confirm the filled value

      expect(modifyParams).toEqual({
        topic: 'active-edt',
        addMembers: ['/repos/b'],
        removeMembers: [],
        setBranches: [{ repoPath: '/repos/b', branch: 'feature-y' }],
      });
      expect(loggedOutcome).toBe('success');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Add-to-EDT partial failure surfaces inline via summarizeFailedResults, logged failed', async () => {    const active = edt({ ulid: 'active-ulid', topic: 'active-edt', status: 'active', members: [] });
    let loggedOutcome: string | undefined;
    const store = createAppStore();
    store.setState({
      edts: [active],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [
        { service: 'svc-b', path: '/repos/b', isMember: false, branch: 'feature-y', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      listBranches: async () => ({ ok: true, data: ['feature-y'] }),
      modifyEdt: async (): Promise<Result<ModifyEdtData>> => ({
        ok: true,
        data: {
          ulid: 'active-ulid',
          topic: 'active-edt',
          results: [
            { service: 'svc-b', outcome: 'failed', detail: { code: 'shared-branch-rejected', message: 'Branch "feature-y" is shared/protected' } },
          ],
        },
      }),
      logEdtAction: async (_ulid, _actionType, outcome) => {
        loggedOutcome = outcome;
      },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.enter); // open Add to EDT
      await instance.waitUntilRenderFlush(); // let listBranches resolve
      await press(instance, stdin, KEYS.tab); // Create new -> Pick existing
      // Shared autocomplete two-step: first Enter inserts, second Enter confirms.
      await press(instance, stdin, KEYS.enter); // insert 'feature-y' into the filter
      await press(instance, stdin, KEYS.enter); // confirm -> submit -> partial failure surfaces
      await instance.waitUntilRenderFlush();

      expect(stdout.output).toContain('shared/protected');
      expect(loggedOutcome).toBe('failed');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Branch autocomplete adoption: the live `settings.edts.branchDropdownMaxRows` value caps
  // the pick-existing dropdown end to end (store -> EdtsZone -> dialog -> BranchPicker).
  // Hardcoding maxRows in the zone (or never threading the setting) fails this: with 3
  // branches and maxRows 2, only the first two rows plus the overflow line may render.
  it('pick-existing dropdown is capped live by settings.edts.branchDropdownMaxRows', async () => {
    const active = edt({ ulid: 'active-ulid', topic: 'active-edt', status: 'active', members: [] });
    const store = createAppStore();
    store.setState({
      settings: {
        ...store.getState().settings,
        edts: { ...store.getState().settings.edts, branchDropdownMaxRows: 4 },
      },
      edts: [active],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [
        { service: 'svc-b', path: '/repos/b', isMember: false, branch: 'svc-branch', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      listBranches: async () => ({ ok: true, data: ['b-one', 'b-two', 'b-three', 'b-four', 'b-five'] }),
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edts -> edt-services
      await press(instance, stdin, KEYS.tab); // edt-services -> other-services
      await press(instance, stdin, KEYS.enter); // open Add to EDT on the one row
      await instance.waitUntilRenderFlush(); // let listBranches resolve
      await press(instance, stdin, KEYS.tab); // Create new -> Pick existing
      await instance.waitUntilRenderFlush();

      expect(stdout.output).toContain('b-one');
      expect(stdout.output).toContain('b-two');
      expect(stdout.output).toContain('↓ 3 more');
      expect(stdout.output).not.toContain('b-three');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // submitRemoveFromEdt has the same per-repo partial-failure handling as submitAddToEdt above.
  it('Remove-from-EDT partial failure surfaces inline via summarizeFailedResults, logged failed', async () => {
    const active = edt({
      ulid: 'active-ulid',
      topic: 'active-edt',
      status: 'active',
      members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }],
    });
    let loggedOutcome: string | undefined;
    const store = createAppStore();
    store.setState({
      edts: [active],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [
        { service: 'svc-a', path: '/repos/a', isMember: true, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      modifyEdt: async (): Promise<Result<ModifyEdtData>> => ({
        ok: true,
        data: {
          ulid: 'active-ulid',
          topic: 'active-edt',
          results: [
            { service: 'svc-a', outcome: 'failed', detail: { code: 'git-checkout-failed', message: 'Working tree has uncommitted changes' } },
          ],
        },
      }),
      logEdtAction: async (_ulid, _actionType, outcome) => {
        loggedOutcome = outcome;
      },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edts -> edt-services
      await press(instance, stdin, KEYS.enter); // open the contextual menu
      await press(instance, stdin, KEYS.enter); // cursor 0 (Remove from EDT) -> confirm
      // A second flush: unlike a full-success confirm (one setDialog after the awaited
      // modifyEdt call), the partial-failure path runs one more microtask hop
      // (summarizeFailedResults's setDialog, then the awaited logEdtAction call) before the
      // error text actually lands in a committed render.
      await instance.waitUntilRenderFlush();

      expect(stdout.output).toContain('uncommitted changes');
      expect(loggedOutcome).toBe('failed');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // submitServiceActionsBranchChange has the same partial-failure handling too.
  it('Change-branch partial failure surfaces inline via summarizeFailedResults, logged failed', async () => {
    const active = edt({
      ulid: 'active-ulid',
      topic: 'active-edt',
      status: 'active',
      members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }],
    });
    let loggedOutcome: string | undefined;
    const store = createAppStore();
    store.setState({
      listBranches: async () => ({ ok: true, data: [] }),
      edts: [active],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [
        { service: 'svc-a', path: '/repos/a', isMember: true, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      createMemberBranch: async () => ({ ok: true, data: undefined }),
      modifyEdt: async (): Promise<Result<ModifyEdtData>> => ({
        ok: true,
        data: {
          ulid: 'active-ulid',
          topic: 'active-edt',
          results: [
            { service: 'svc-a', outcome: 'failed', detail: { code: 'shared-branch-rejected', message: 'Branch "main-y" is shared/protected' } },
          ],
        },
      }),
      logEdtAction: async (_ulid, _actionType, outcome) => {
        loggedOutcome = outcome;
      },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edts -> edt-services
      await press(instance, stdin, KEYS.enter); // open the contextual menu
      await press(instance, stdin, KEYS.down); // cursor -> "Change branch for this EDT"
      await press(instance, stdin, KEYS.enter); // open the branch-picker (Create new: base field focused first)
      await settleBranches(instance); // let the picker's own listBranches() resolve
      await press(instance, stdin, KEYS.enter); // advance base -> name (pre-filled "main")
      await type(instance, stdin, '-y');
      await press(instance, stdin, KEYS.enter); // confirm
      // A second flush — same reason as the Remove-from-EDT partial-failure test above.
      await instance.waitUntilRenderFlush();

      expect(stdout.output).toContain('shared/protected');
      expect(loggedOutcome).toBe('failed');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // The picker's "Create new" default base branch for service-actions' real git-write flow is
  // this repo's own manifest sharedBranch, never DEFAULT_BASE_BRANCH — asserts the `base`
  // argument delivered to createMemberBranch, with a sharedBranch other than 'development' so it
  // is distinguishable from the DEFAULT_BASE_BRANCH literal.
  it('service-actions Change-branch Create-new confirm-without-editing sends the manifest sharedBranch as base', async () => {
    const active = edt({
      ulid: 'active-ulid',
      topic: 'active-edt',
      status: 'active',
      members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }],
    });
    let createdBase: string | undefined;
    const store = createAppStore();
    store.setState({
      listBranches: async () => ({ ok: true, data: [] }),
      edts: [active],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [{ service: 'svc-a', path: '/repos/a', isMember: true, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'release', protectedBranches: [] }],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      createMemberBranch: async (_repoPath, _branchName, baseBranch) => {
        createdBase = baseBranch;
        return { ok: true, data: undefined };
      },
      modifyEdt: async (): Promise<Result<ModifyEdtData>> => ({
        ok: true,
        data: { ulid: 'active-ulid', topic: 'active-edt', results: [] },
      }),
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edts -> edt-services
      await press(instance, stdin, KEYS.enter); // open the contextual menu
      await press(instance, stdin, KEYS.down); // cursor -> "Change branch for this EDT"
      await press(instance, stdin, KEYS.enter); // open the branch-picker (Create new: base field
      // focused first, pre-filled from svc-a's own manifest sharedBranch, "release")

      expect(stdout.output).toContain('Base branch: release');

      await press(instance, stdin, KEYS.enter); // confirm base without editing -> advance to name (pre-filled "main")
      await press(instance, stdin, KEYS.enter); // confirm name without editing -> submit
      await instance.waitUntilRenderFlush();

      expect(createdBase).toBe('release');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Assisted resolution ---------------------------------------------------------------------
  // "Assisted resolution" for the one registered failure code, branch-owned-by-other-edt — a
  // per-repo structured line (never joined), an inline "[Enter] try a different branch"
  // affordance, and confirming the reopened branch-edit re-runs the same submit function. Staged
  // via a not-yet-member candidate (svc-b): Enter on an already-a-member row never opens the
  // branch-picker, and the retry mechanics (findRetryableFailedRow, reopen-prefilled, re-submit)
  // are identical either way.
});
