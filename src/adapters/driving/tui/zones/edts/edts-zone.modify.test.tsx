// EdtsZone real-keypress tests: modify.
import { describe, it, expect } from 'vitest';
import type { Result } from '../../../../../core/result.js';
import type { ModifyEdtData } from '../../../../../core/edt/modify.js';
import { createAppStore, type ModifyEdtParams } from '../../store/app-store.js';
import { KEYS } from '../../shared/test-support/fake-tty.js';
import { EdtsZone } from './edts-zone.js';
import { edt, press, pressEscape, type, settle, settleBranches, mount } from './edts-zone.test-support.js';

describe('EdtsZone real-keypress interactions — modify', () => {
  it('drops a staged branch-edit for a member unchecked before submit — never sent to modifyEdt', async () => {
    const store = createAppStore();
    const active = edt({
      ulid: 'active-ulid',
      topic: 'active-edt',
      status: 'active',
      members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }],
    });
    let modifyParams: ModifyEdtParams | undefined;
    store.setState({
      listBranches: async () => ({ ok: true, data: [] }),
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
      // Create new's pre-step for a brand-new name — mocked to succeed so the picker's staging
      // actually commits (default "store not wired" would leave the picker open on a synthesized
      // error instead).
      createMemberBranch: async () => ({ ok: true, data: undefined }),
      modifyEdt: async (params): Promise<Result<ModifyEdtData>> => {
        modifyParams = params;
        return { ok: true, data: { ulid: 'active-ulid', topic: 'active-edt', results: [] } };
      },
    });

    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      // Row 0 is the active EDT -> Enter opens the modify form (not switch-confirm).
      await press(instance, stdin, KEYS.enter);
      // Tab: topic-input -> member-checklist.
      await press(instance, stdin, KEYS.tab);
      // Cursor -> row 1 (not-yet-member svc-b). Checking it auto-stages a suggested branch
      // ('main', the sole existing member's own branch); Enter then reopens the shared
      // branch-picker on that freshly-checked row (Create new, no "current
      // branch" to rename) so a custom value can be staged instead of the auto-suggestion.
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.space);
      await press(instance, stdin, KEYS.enter);
      await settleBranches(instance); // let the picker's own listBranches() resolve
      await press(instance, stdin, KEYS.enter); // advance base -> name (pre-filled "main")
      for (let i = 0; i < 'main'.length; i += 1) {
        await press(instance, stdin, KEYS.backspace);
      }
      await type(instance, stdin, 'feature-y');
      await press(instance, stdin, KEYS.enter); // commit the create-new stage, back to the form
      await settle(instance);

      // Space unchecks that same not-yet-member row — the branch just staged for it must be
      // dropped before it ever reaches modifyEdt (a real `git checkout` on a repo the
      // developer just told the form to drop).
      await press(instance, stdin, KEYS.space);
      await press(instance, stdin, KEYS.tab); // members -> topic, so this Enter submits
      await press(instance, stdin, KEYS.enter); // submit

      expect(modifyParams).toBeDefined();
      expect(modifyParams?.addMembers).toEqual([]);
      expect(modifyParams?.setBranches).toEqual([]);
      expect(modifyParams?.renameBranches).toEqual([]);
      expect(modifyParams?.removeMembers).toEqual([]);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // An already-a-member row is never branch-editable via checklist Enter — checked or not, the
  // whole membership snapshot at dialog-open time is excluded (canEditMemberBranch's
  // originalMemberPaths guard), so Enter submits the form directly. (An existing member's branch
  // is changed through the EDT SERVICES row's "Change branch for this EDT" action instead.)
  it('Enter on an existing-member checklist row submits the form instead of opening the branch-picker', async () => {
    const store = createAppStore();
    const active = edt({
      ulid: 'active-ulid',
      topic: 'active-edt',
      status: 'active',
      members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }],
    });
    let modifyParams: ModifyEdtParams | undefined;
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
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter); // open modify
      await press(instance, stdin, KEYS.tab); // topic -> members; cursor defaults onto svc-a, already checked
      await press(instance, stdin, KEYS.enter); // submits directly — never opens the branch-picker
      await instance.waitUntilRenderFlush();

      expect(modifyParams).toBeDefined();
      expect(modifyParams?.setBranches).toEqual([]);
      expect(modifyParams?.renameBranches).toEqual([]);
      expect(modifyParams?.removeMembers).toEqual([]);
      // The branch-picker's own chrome never rendered — proves this really took the
      // submit path, not edit-branch followed by an immediate auto-submit.
      expect(stdout.output).not.toContain('Create new');
      expect(stdout.output).not.toContain('Rename current');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // The dialog title names the service a branch-picker session is open for, reverting to the
  // plain title once the session closes — covering both ways a session opens in Modify: a
  // freshly-checked not-yet-member row (direct checklist Enter), and an existing member (only via
  // the retry action — see the test above).
  it('Shift+Tab moves the modify form from topic to members (reverse of Tab), so Enter on a member row submits', async () => {
    const store = createAppStore();
    const active = edt({
      ulid: 'active-ulid',
      topic: 'active-edt',
      status: 'active',
      members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }],
    });
    let modifyParams: ModifyEdtParams | undefined;
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
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter); // open modify
      await press(instance, stdin, KEYS.shiftTab); // topic -> members; cursor defaults onto svc-a, already checked
      await press(instance, stdin, KEYS.enter); // submits directly — never opens the branch-picker
      await instance.waitUntilRenderFlush();

      expect(modifyParams).toBeDefined();
      expect(modifyParams?.setBranches).toEqual([]);
      expect(modifyParams?.renameBranches).toEqual([]);
      expect(modifyParams?.removeMembers).toEqual([]);
      // The branch-picker's own chrome never rendered — proves this really took the
      // submit path, not edit-branch followed by an immediate auto-submit.
      expect(stdout.output).not.toContain('Create new');
      expect(stdout.output).not.toContain('Rename current');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // The dialog title names the service a branch-picker session is open for, reverting to the
  // plain title once the session closes — covering both ways a session opens in Modify: a
  // freshly-checked not-yet-member row (direct checklist Enter), and an existing member (only via
  // the retry action — see the test above).
  it('Shift+Tab on the base view reverses pane focus, wrapping EDTS -> OTHER SERVICES', async () => {
    const store = createAppStore();
    store.setState({
      edts: [edt({ status: 'active' })],
      edtsStatus: 'idle',
      activeEdt: '01JXXXXX1AAAAAAAAAAAAAAAAA',
      edtsBranches: [
        { service: 'svc-z', path: '/repos/z', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.shiftTab);
      // Focus now sits on OTHER SERVICES, so Enter opens that service's actions dialog.
      await press(instance, stdin, KEYS.enter);
      expect(stdout.output).toContain('ADD TO EDT');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('branch-picker title names the service for a freshly-checked candidate, reverting to MODIFY EDT on close', async () => {
    const store = createAppStore();
    const active = edt({
      ulid: 'active-ulid',
      topic: 'active-edt',
      status: 'active',
      members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }],
    });
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
      await press(instance, stdin, KEYS.enter); // open modify
      await press(instance, stdin, KEYS.tab); // topic -> members
      await press(instance, stdin, KEYS.down); // cursor -> row 1 (not-yet-member svc-b)
      await press(instance, stdin, KEYS.space); // check it
      await press(instance, stdin, KEYS.enter); // open the branch-picker for svc-b

      const lastFrameWhileOpen = stdout.output.slice(stdout.output.lastIndexOf('EDTS'));
      expect(lastFrameWhileOpen).toContain('MODIFY EDT — branch for svc-b');

      await pressEscape(instance, stdin); // cancel the picker, back to the form

      const lastFrameAfterClose = stdout.output.slice(stdout.output.lastIndexOf('EDTS'));
      expect(lastFrameAfterClose).toContain('MODIFY EDT');
      expect(lastFrameAfterClose).not.toContain('branch for');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('branch-picker title names the service for an existing member reopened via retry, reverting to MODIFY EDT on close', async () => {
    const store = createAppStore();
    const active = edt({
      ulid: 'active-ulid',
      topic: 'active-edt',
      status: 'active',
      members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }],
    });
    let modifyCalls = 0;
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
        if (modifyCalls === 1) {
          return {
            ok: true,
            data: {
              ulid: 'active-ulid',
              topic: 'active-edt',
              results: [
                {
                  service: 'svc-a',
                  outcome: 'failed',
                  detail: {
                    code: 'branch-owned-by-other-edt',
                    message: 'Branch "main" is already registered as a different EDT\'s own branch',
                  },
                },
              ],
            },
          };
        }
        return { ok: true, data: { ulid: 'active-ulid', topic: 'active-edt', results: [] } };
      },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter); // open modify
      await press(instance, stdin, KEYS.tab); // topic -> members; cursor defaults onto svc-a, already checked
      await press(instance, stdin, KEYS.enter); // submits directly -> fails with a retryable code
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('[Enter] try a different branch');

      await press(instance, stdin, KEYS.enter); // retry -> reopens the picker for the existing member svc-a

      const lastFrameWhileOpen = stdout.output.slice(stdout.output.lastIndexOf('EDTS'));
      expect(lastFrameWhileOpen).toContain('MODIFY EDT — branch for svc-a');

      await pressEscape(instance, stdin); // cancel the picker, back to the form

      const lastFrameAfterClose = stdout.output.slice(stdout.output.lastIndexOf('EDTS'));
      expect(lastFrameAfterClose).toContain('MODIFY EDT');
      expect(lastFrameAfterClose).not.toContain('branch for');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // The title's service lookup must fall through to `dialog.target.members.find(...)` when the
  // branch-picker's repoPath belongs to an existing member absent from `candidates` (e.g. its
  // repo became unreachable, or its manifest failed to load) — never silently reverting to plain
  // "MODIFY EDT". Like the "reopened via retry" test above, with svc-a missing from edtsBranches.
  it('branch-picker title still names the service via the target.members fallback when the existing member is absent from candidates', async () => {
    const store = createAppStore();
    const active = edt({
      ulid: 'active-ulid',
      topic: 'active-edt',
      status: 'active',
      members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }],
    });
    let modifyCalls = 0;
    store.setState({
      edts: [active],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      // svc-a/repos/a is deliberately absent here — the whole point of this test — so it never
      // appears in `candidates` even though it's a real EDT member.
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      modifyEdt: async (): Promise<Result<ModifyEdtData>> => {
        modifyCalls += 1;
        if (modifyCalls === 1) {
          return {
            ok: true,
            data: {
              ulid: 'active-ulid',
              topic: 'active-edt',
              results: [
                {
                  service: 'svc-a',
                  outcome: 'failed',
                  detail: {
                    code: 'branch-owned-by-other-edt',
                    message: 'Branch "main" is already registered as a different EDT\'s own branch',
                  },
                },
              ],
            },
          };
        }
        return { ok: true, data: { ulid: 'active-ulid', topic: 'active-edt', results: [] } };
      },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter); // open modify
      await press(instance, stdin, KEYS.tab); // topic -> members (empty checklist: svc-a absent from candidates)
      await press(instance, stdin, KEYS.enter); // submits directly (no focused row) -> fails with a retryable code
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('[Enter] try a different branch');

      await press(instance, stdin, KEYS.enter); // retry -> reopens the picker for the existing member svc-a via the target.members fallback

      const lastFrameWhileOpen = stdout.output.slice(stdout.output.lastIndexOf('EDTS'));
      expect(lastFrameWhileOpen).toContain('MODIFY EDT — branch for svc-a');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Uses a not-yet-member candidate (svc-b): Enter on the existing member (svc-a) never opens
  // the branch-picker, so the empty-value validation runs through the freshly-checked-row path
  // (Create-new's name field validates identically).
  it('rejects an empty branch-edit value inline and keeps the dialog open — never reaches modifyEdt unvalidated', async () => {
    const store = createAppStore();
    const active = edt({
      ulid: 'active-ulid',
      topic: 'active-edt',
      status: 'active',
      members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }],
    });
    let modifyCalls = 0;
    store.setState({
      listBranches: async () => ({ ok: true, data: [] }),
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
      // Create new's pre-step for a brand-new name — mocked to succeed so the valid retry value
      // actually commits (default "store not wired" would leave the picker open on a synthesized
      // error instead).
      createMemberBranch: async () => ({ ok: true, data: undefined }),
      modifyEdt: async (): Promise<Result<ModifyEdtData>> => {
        modifyCalls += 1;
        return { ok: true, data: { ulid: 'active-ulid', topic: 'active-edt', results: [] } };
      },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter); // open modify
      await press(instance, stdin, KEYS.tab); // topic -> members
      await press(instance, stdin, KEYS.down); // cursor -> row 1 (not-yet-member svc-b)
      await press(instance, stdin, KEYS.space); // check it -> auto-stages branchEdits['/repos/b'] = 'main' (svc-a's unanimous branch)
      await press(instance, stdin, KEYS.enter); // open the branch-picker for svc-b (Create new: base field focused first)
      await settleBranches(instance); // let the picker's own listBranches() resolve
      await press(instance, stdin, KEYS.enter); // advance base -> name (pre-filled "main")
      // Clear the pre-filled value down to empty.
      for (let i = 0; i < 'main'.length; i += 1) {
        await press(instance, stdin, KEYS.backspace);
      }
      await press(instance, stdin, KEYS.enter); // submit the empty name

      expect(stdout.output).toContain('Branch name must not be empty');
      // Still in the branch-picker sub-view, not back at the form and not submitted.
      expect(modifyCalls).toBe(0);

      // Typing a valid value now and confirming still works — the rejection didn't wedge
      // the dialog: the same Enter that failed on an empty value now commits successfully.
      const outputLengthBeforeRetry = stdout.output.length;
      await type(instance, stdin, 'feature-z');
      await press(instance, stdin, KEYS.enter); // commit the create-new stage, back to the form
      expect(stdout.output.slice(outputLengthBeforeRetry)).not.toContain('Branch name must not be empty');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Checking a not-yet-member candidate in Modify auto-stages a suggested branch (the shared
  // branch when every existing member agrees on one) — it flows straight through to modifyEdt's
  // addMembers+setBranches without opening the picker by hand.
  it('auto-stages a suggested branch when checking a not-yet-member candidate', async () => {
    const store = createAppStore();
    const active = edt({
      ulid: 'active-ulid',
      topic: 'active-edt',
      status: 'active',
      members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'feature-shared' }],
    });
    let modifyParams: ModifyEdtParams | undefined;
    store.setState({
      edts: [active],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [
        { service: 'svc-a', path: '/repos/a', isMember: true, branch: 'feature-shared', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] },
        { service: 'svc-b', path: '/repos/b', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      modifyEdt: async (params): Promise<Result<ModifyEdtData>> => {
        modifyParams = params;
        return { ok: true, data: { ulid: 'active-ulid', topic: 'active-edt', results: [] } };
      },
    });

    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter); // open modify
      await press(instance, stdin, KEYS.tab); // topic -> members
      await press(instance, stdin, KEYS.down); // move cursor onto row 1 (not-yet-member svc-b)
      await press(instance, stdin, KEYS.space); // check it -> auto-stages branchEdits['/repos/b']
      await press(instance, stdin, KEYS.tab); // members -> topic
      await press(instance, stdin, KEYS.enter); // submit (never opened the branch-edit sub-dialog)

      expect(modifyParams).toBeDefined();
      expect(modifyParams?.addMembers).toEqual(['/repos/b']);
      // The unanimous existing member's branch ('feature-shared') is the suggestion — never
      // a silent currentBranch default.
      expect(modifyParams?.setBranches).toEqual([{ repoPath: '/repos/b', branch: 'feature-shared' }]);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // A newly-checked member's staged branch can still end up empty (e.g. an all-punctuation topic
  // slugifies to '' and there are zero existing members to fall back to) — confirm must block
  // inline, never reaching modifyEdt.
  it('blocks confirm inline when a newly-checked member\'s auto-staged branch is empty', async () => {
    const store = createAppStore();
    const active = edt({
      ulid: 'active-ulid',
      topic: '!!!',
      status: 'active',
      members: [],
    });
    let modifyCalls = 0;
    store.setState({
      edts: [active],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [
        { service: 'svc-b', path: '/repos/b', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      modifyEdt: async (): Promise<Result<ModifyEdtData>> => {
        modifyCalls += 1;
        return { ok: true, data: { ulid: 'active-ulid', topic: '!!!', results: [] } };
      },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter); // open modify
      await press(instance, stdin, KEYS.tab); // topic -> members
      await press(instance, stdin, KEYS.space); // check the only (not-yet-member) candidate
      await press(instance, stdin, KEYS.tab); // members -> topic
      await press(instance, stdin, KEYS.enter); // attempt submit -> blocked inline

      expect(stdout.output).toContain('Branch name must not be empty');
      expect(modifyCalls).toBe(0);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});
