// EdtsZone real-keypress tests: branch conflicts.
import { render } from 'ink';
import { describe, it, expect } from 'vitest';
import type { Result } from '../../../../../../../core/result.js';
import type { CreateEdtData } from '../../../../../../../core/edt/lifecycle/create.js';
import type { SwitchActiveEdtData } from '../../../../../../../core/edt/switch.js';
import type { ModifyEdtData } from '../../../../../../../core/edt/lifecycle/modify.js';
import { createAppStore, type ModifyEdtParams } from '../../../../store/app-store.js';
import { KEYS } from '../../../../shared/test-support/fake-tty.js';
import { EdtsZone } from '../../edts-zone.js';
import { footerIdOf } from '../../../../shared/test-support/mount-for-test.js';
import { edt, press, pressEscape, type, readyBranches, settle, settleBranches, mount } from '../../edts-zone.test-support.js';

describe('EdtsZone real-keypress interactions — branch-conflicts', () => {
  it('branch-owned-by-other-edt in Modify shows "try a different branch"; retry reopens pre-filled and re-submits', async () => {
    const active = edt({
      ulid: 'active-ulid',
      topic: 'active-edt',
      status: 'active',
      members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }],
    });
    const modifyCalls: ModifyEdtParams[] = [];
    const store = createAppStore();
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
      // (and the retry's own re-staging) reaches modifyEdt at all.
      createMemberBranch: async () => ({ ok: true, data: undefined }),
      modifyEdt: async (params): Promise<Result<ModifyEdtData>> => {
        modifyCalls.push(params);
        if (modifyCalls.length === 1) {
          return {
            ok: true,
            data: {
              ulid: 'active-ulid',
              topic: 'active-edt',
              results: [
                {
                  service: 'svc-b',
                  outcome: 'failed',
                  detail: {
                    code: 'branch-owned-by-other-edt',
                    message: 'Branch "feature-y" is already registered as a different EDT\'s own branch',
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
      await press(instance, stdin, KEYS.tab); // topic -> members
      await press(instance, stdin, KEYS.down); // cursor -> row 1 (not-yet-member svc-b)
      await press(instance, stdin, KEYS.space); // check it -> auto-stages branchEdits['/repos/b'] = 'main'
      await press(instance, stdin, KEYS.enter); // open the branch-picker for svc-b (Create new: base field focused first)
      await settleBranches(instance); // let the picker's own listBranches() resolve
      await press(instance, stdin, KEYS.enter); // advance base -> name (pre-filled "main")
      for (let i = 0; i < 'main'.length; i += 1) {
        await press(instance, stdin, KEYS.backspace);
      }
      await type(instance, stdin, 'feature-y');
      await press(instance, stdin, KEYS.enter); // commit (create pre-step + stage), back to the form
      await settle(instance);
      // Still members-focus, cursor still on svc-b's (still checked+editable) row — Tab back
      // to topic-focus first so this next Enter submits rather than reopening the picker.
      await press(instance, stdin, KEYS.tab); // members -> topic
      await press(instance, stdin, KEYS.enter); // submit (topic-focus Enter) -> collision
      await instance.waitUntilRenderFlush();

      expect(modifyCalls).toHaveLength(1);
      expect(modifyCalls[0]?.setBranches).toEqual([{ repoPath: '/repos/b', branch: 'feature-y' }]);
      // Per-repo line, never a `; `-joined string — svc-b is the only failed row here so a
      // joined-vs-structured distinction isn't directly observable, but the affordance text
      // proves the structured path (a joined string never carried a `[Enter]` hint).
      expect(stdout.output).toContain('svc-b');
      expect(stdout.output).toContain('already registered as a different EDT');
      expect(stdout.output).toContain('[Enter] try a different branch');

      // Choosing it reopens the shared branch-picker directly onto its Create-new name field,
      // pre-filled with the value that just got rejected — not a blank field, not the
      // original "main".
      await press(instance, stdin, KEYS.enter);
      expect(stdout.output).toContain('Name: feature-y');
      const outputAfterReopen = stdout.output;
      expect(outputAfterReopen.slice(outputAfterReopen.lastIndexOf('Name:'))).toContain('feature-y');

      // Edit to a different branch and confirm — re-runs submitModify directly (the same
      // submit function), not a full-dialog restart back through topic/members.
      for (let i = 0; i < 'feature-y'.length; i += 1) {
        await press(instance, stdin, KEYS.backspace);
      }
      await type(instance, stdin, 'feature-z');
      await press(instance, stdin, KEYS.enter);
      await instance.waitUntilRenderFlush();

      expect(modifyCalls).toHaveLength(2);
      expect(modifyCalls[1]?.setBranches).toEqual([{ repoPath: '/repos/b', branch: 'feature-z' }]);
      // Second submit succeeded — dialog closed, no leftover MODIFY EDT chrome. `output`
      // accumulates every frame ever written (including the dialog's own earlier frames), so
      // only the *last* rendered frame (sliced from the base view's always-present "EDTS"
      // header, the same technique app-shell.interaction.test.tsx's own lastFrame() uses) can
      // tell whether the dialog is still showing right now.
      const lastFrame = stdout.output.slice(stdout.output.lastIndexOf('EDTS'));
      expect(lastFrame).not.toContain('MODIFY EDT');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Staged via a not-yet-member candidate (svc-b) rather than the existing svc-a — see the
  // comment on the branch-owned-by-other-edt test above for why.
  it('branch-exists in Modify shows "try a different name"; retry reopens pre-filled and re-submits', async () => {
    const active = edt({
      ulid: 'active-ulid',
      topic: 'active-edt',
      status: 'active',
      members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }],
    });
    const modifyCalls: ModifyEdtParams[] = [];
    const store = createAppStore();
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
      createMemberBranch: async () => ({ ok: true, data: undefined }),
      modifyEdt: async (params): Promise<Result<ModifyEdtData>> => {
        modifyCalls.push(params);
        if (modifyCalls.length === 1) {
          return {
            ok: true,
            data: {
              ulid: 'active-ulid',
              topic: 'active-edt',
              results: [
                {
                  service: 'svc-b',
                  outcome: 'failed',
                  detail: { code: 'branch-exists', message: 'Branch "feature-y" already exists in /repos/b' },
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
      await press(instance, stdin, KEYS.tab); // topic -> members
      await press(instance, stdin, KEYS.down); // cursor -> row 1 (not-yet-member svc-b)
      await press(instance, stdin, KEYS.space); // check it -> auto-stages branchEdits['/repos/b'] = 'main'
      await press(instance, stdin, KEYS.enter); // open the branch-picker for svc-b (Create new: base field focused first)
      await settleBranches(instance); // let the picker's own listBranches() resolve
      await press(instance, stdin, KEYS.enter); // advance base -> name (pre-filled "main")
      for (let i = 0; i < 'main'.length; i += 1) {
        await press(instance, stdin, KEYS.backspace);
      }
      await type(instance, stdin, 'feature-y');
      await press(instance, stdin, KEYS.enter); // commit (create pre-step + stage), back to the form
      await settle(instance);
      await press(instance, stdin, KEYS.tab); // members -> topic
      await press(instance, stdin, KEYS.enter); // submit (topic-focus Enter) -> collision
      await instance.waitUntilRenderFlush();

      expect(modifyCalls).toHaveLength(1);
      expect(stdout.output).toContain('svc-b');
      expect(stdout.output).toContain('already exists');
      // The affordance can line-wrap inside the fixed-width dialog box in the fake TTY (unlike
      // the shorter "try a different branch" text elsewhere in this file) — strip box-drawing
      // borders and collapse whitespace/newlines before matching the phrase.
      const flattened = stdout.output.replace(/[─-╿]/g, ' ').replace(/\s+/g, ' ');
      expect(flattened).toContain('[Enter] try a different name');

      // Retry reopens the shared branch-picker directly onto its Create-new name field,
      // pre-filled with the value that just collided — proving the second registry entry's
      // affordance actually drives the picker in context, not just the isolated label unit
      // test in failed-result-list.test.tsx.
      await press(instance, stdin, KEYS.enter);
      const outputAfterReopen = stdout.output;
      expect(outputAfterReopen.slice(outputAfterReopen.lastIndexOf('Name:'))).toContain('feature-y');

      for (let i = 0; i < 'feature-y'.length; i += 1) {
        await press(instance, stdin, KEYS.backspace);
      }
      await type(instance, stdin, 'feature-z');
      await press(instance, stdin, KEYS.enter);
      await instance.waitUntilRenderFlush();

      expect(modifyCalls).toHaveLength(2);
      expect(modifyCalls[1]?.setBranches).toEqual([{ repoPath: '/repos/b', branch: 'feature-z' }]);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('branch-owned-by-other-edt in service-actions "Change branch" shows the retry affordance; retry reopens pre-filled and re-submits', async () => {
    const active = edt({
      ulid: 'active-ulid',
      topic: 'active-edt',
      status: 'active',
      members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }],
    });
    const modifyCalls: ModifyEdtParams[] = [];
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
      // Create new's pre-step for a brand-new name — mocked to succeed so the picker's staging
      // (and the retry's own re-staging) reaches modifyEdt at all.
      createMemberBranch: async () => ({ ok: true, data: undefined }),
      modifyEdt: async (params): Promise<Result<ModifyEdtData>> => {
        modifyCalls.push(params);
        if (modifyCalls.length === 1) {
          return {
            ok: true,
            data: {
              ulid: 'active-ulid',
              topic: 'active-edt',
              results: [
                {
                  service: 'svc-a',
                  outcome: 'failed',
                  detail: { code: 'branch-owned-by-other-edt', message: 'Branch "main-y" is already registered as a different EDT\'s own branch' },
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
      await press(instance, stdin, KEYS.tab); // edts -> edt-services
      await press(instance, stdin, KEYS.enter); // open the contextual menu
      await press(instance, stdin, KEYS.down); // cursor -> "Change branch for this EDT"
      await press(instance, stdin, KEYS.enter); // open the branch-picker (Create new: base field focused first)
      await settleBranches(instance); // let the picker's own listBranches() resolve
      await press(instance, stdin, KEYS.enter); // advance base -> name (pre-filled "main")
      await type(instance, stdin, '-y');
      await press(instance, stdin, KEYS.enter); // confirm -> collision
      await instance.waitUntilRenderFlush();

      expect(modifyCalls).toHaveLength(1);
      expect(stdout.output).toContain('svc-a');
      expect(stdout.output).toContain('[Enter] try a different branch');

      // Retry reopens the shared branch-picker directly onto its Create-new name field,
      // pre-filled with the rejected value.
      await press(instance, stdin, KEYS.enter);
      const outputAfterReopen = stdout.output;
      expect(outputAfterReopen.slice(outputAfterReopen.lastIndexOf('Name:'))).toContain('main-y');

      for (let i = 0; i < 'main-y'.length; i += 1) {
        await press(instance, stdin, KEYS.backspace);
      }
      await type(instance, stdin, 'main-z');
      await press(instance, stdin, KEYS.enter); // confirm -> re-runs submitServiceActionsBranchOutcome
      await instance.waitUntilRenderFlush();

      expect(modifyCalls).toHaveLength(2);
      expect(modifyCalls[1]?.setBranches).toEqual([{ repoPath: '/repos/a', branch: 'main-z' }]);
      // See the Modify retry test above for why this reads the last frame, not the whole
      // accumulated `output`.
      const lastFrame = stdout.output.slice(stdout.output.lastIndexOf('EDTS'));
      expect(lastFrame).not.toContain('SERVICE ACTIONS');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('branch-owned-by-other-edt in Add-to-EDT shows the retry affordance; the already-focused field re-submits on Enter', async () => {
    const active = edt({ ulid: 'active-ulid', topic: 'active-edt', status: 'active', members: [] });
    const modifyCalls: ModifyEdtParams[] = [];
    const store = createAppStore();
    store.setState({
      listBranches: async () => ({ ok: true, data: [] }),
      edts: [active],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [
        { service: 'svc-b', path: '/repos/b', isMember: false, branch: 'feature-y', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      // Create new's pre-step for the picker's default suggestion — mocked to succeed so the flow
      // reaches modifyEdt, which is what actually rejects the name here.
      createMemberBranch: async () => ({ ok: true, data: undefined }),
      modifyEdt: async (params): Promise<Result<ModifyEdtData>> => {
        modifyCalls.push(params);
        if (modifyCalls.length === 1) {
          return {
            ok: true,
            data: {
              ulid: 'active-ulid',
              topic: 'active-edt',
              results: [
                {
                  service: 'svc-b',
                  outcome: 'failed',
                  detail: { code: 'branch-owned-by-other-edt', message: 'Branch "feature-y" is already registered as a different EDT\'s own branch' },
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
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.tab); // edts -> edt-services -> other-services
      await press(instance, stdin, KEYS.enter); // open Add to EDT (Create new: base field focused, name pre-filled "feature-y")
      await settleBranches(instance); // let the picker's own listBranches() resolve
      await press(instance, stdin, KEYS.enter); // advance base -> name
      await press(instance, stdin, KEYS.enter); // confirm -> collision
      await instance.waitUntilRenderFlush();

      expect(modifyCalls).toHaveLength(1);
      expect(stdout.output).toContain('[Enter] try a different branch');
      // The field already shows the rejected value — no separate "reopen" step needed.
      expect(stdout.output).toContain('feature-y');

      for (let i = 0; i < 'feature-y'.length; i += 1) {
        await press(instance, stdin, KEYS.backspace);
      }
      await type(instance, stdin, 'feature-z');
      await press(instance, stdin, KEYS.enter); // re-runs submitAddToEdt with the new value
      await instance.waitUntilRenderFlush();

      expect(modifyCalls).toHaveLength(2);
      expect(modifyCalls[1]?.setBranches).toEqual([{ repoPath: '/repos/b', branch: 'feature-z' }]);
      // See the Modify retry test above for why this reads the last frame, not the whole
      // accumulated `output`.
      const lastFrame = stdout.output.slice(stdout.output.lastIndexOf('EDTS'));
      expect(lastFrame).not.toContain('ADD TO EDT');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Create/Switch never wire the retry action, even for this exact code — resolveMemberBranch
  // never passes edtId to assertAllowedBranch at create time, and switchActiveEdt carries no
  // per-member branch override to retry into. Both still get the plain structured line, the
  // same "no registered action" treatment as an unregistered code.
  it('branch-owned-by-other-edt inside a Create result renders a plain line — no retry affordance', async () => {
    const store = createAppStore();
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      edtsBranches: [{ service: 'svc-a', path: '/repos/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] }],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      listCreateBranches: readyBranches,
      createEdt: async (): Promise<Result<CreateEdtData>> => ({
        ok: true,
        data: {
          ulid: 'new-ulid',
          topic: 'demo',
          results: [
            {
              service: 'svc-a',
              outcome: 'failed',
              detail: { code: 'branch-owned-by-other-edt', message: 'Branch "demo" is already registered as a different EDT\'s own branch' },
            },
          ],
        },
      }),
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await type(instance, stdin, 'demo');
      await press(instance, stdin, KEYS.enter); // Step 1 -> Step 2 (services)
      await press(instance, stdin, KEYS.space); // select svc-a
      await press(instance, stdin, KEYS.enter); // Step 2 -> Step 3 (branch lists load)
      await settle(instance);
      await press(instance, stdin, KEYS.ctrlN); // Step 3 -> Step 4 (Enter never advances Step 3)
      await press(instance, stdin, KEYS.enter); // confirm Step 4
      await instance.waitUntilRenderFlush();

      expect(stdout.output).toContain('svc-a');
      expect(stdout.output).toContain('already registered as a different EDT');
      expect(stdout.output).not.toContain('[Enter] try a different branch');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('branch-owned-by-other-edt inside a Switch result renders a plain line — no retry affordance', async () => {
    const store = createAppStore();
    const target = edt({ ulid: 'target-ulid', topic: 'other' });
    const logged: Array<{ ulid: string; outcome: string; detail: string }> = [];
    store.setState({
      edts: [target],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      loadEdtActionLog: async () => {},
      logEdtAction: async (ulid, _actionType, outcome, detail) => {
        logged.push({ ulid, outcome, detail });
      },
      switchEdt: async (): Promise<Result<SwitchActiveEdtData>> => ({
        ok: true,
        data: {
          ulid: 'target-ulid',
          topic: 'other',
          wasInterrupted: false,
          results: [
            {
              service: 'svc-a',
              outcome: 'failed',
              detail: { code: 'branch-owned-by-other-edt', message: 'Branch "other" is already registered as a different EDT\'s own branch' },
            },
          ],
        },
      }),
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter); // open switch-confirm
      await press(instance, stdin, KEYS.enter); // confirm switch
      await instance.waitUntilRenderFlush();

      expect(stdout.output).toContain('svc-a');
      expect(stdout.output).toContain('already registered as a different EDT');
      expect(stdout.output).not.toContain('[Enter] try a different branch');
      // The heading says failures happened, and the entry goes to the NEW active EDT's log as
      // `failed`, carrying the failure.
      expect(stdout.output).toContain('finished with failures');
      await settle(instance);
      expect(logged).toEqual([{ ulid: 'target-ulid', outcome: 'failed', detail: expect.stringContaining('svc-a: Branch "other" is already registered') }]);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Escape/cancel for both dialogs, and backing out of the branch-edit sub-view via Escape.
  it('Escape cancels the EDT SERVICES contextual menu without calling modifyEdt', async () => {
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
      expect(stdout.output).toContain('SERVICE ACTIONS');

      // `stdout.output` accumulates every frame ever written, so a `.not.toContain` against
      // the whole log would vacuously pass even if Escape did nothing — the menu's own
      // now-stale frame is still in there. Only the output *written since* Escape proves the
      // dialog is actually gone from the current render (same technique as the
      // "rejects an empty branch-edit value inline" test in the real-keypress suite above).
      const outputLengthBeforeEscape = stdout.output.length;
      await pressEscape(instance, stdin);
      const outputSinceEscape = stdout.output.slice(outputLengthBeforeEscape);

      expect(modifyCalls).toBe(0);
      expect(outputSinceEscape).not.toContain('SERVICE ACTIONS');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Escape backs out of the branch-edit sub-view to the contextual menu, without closing it entirely', async () => {
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
      await press(instance, stdin, KEYS.enter); // open the shared branch-picker
      expect(footerIdOf(store)).toBe('branch-picker-base');

      // Only the output *written since* Escape proves the menu is back in the *current*
      // render, not merely present somewhere earlier in the accumulated log (same technique
      // as the real-keypress suite's "rejects an empty branch-edit value inline" test above).
      const outputLengthBeforeEscape = stdout.output.length;
      await pressEscape(instance, stdin);
      const outputSinceEscape = stdout.output.slice(outputLengthBeforeEscape);

      // Back at the contextual menu (still open), never fully torn down, never submitted.
      expect(modifyCalls).toBe(0);
      expect(outputSinceEscape).toContain('SERVICE ACTIONS');
      expect(outputSinceEscape).toContain('Remove from EDT');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Escape cancels the Add-to-EDT dialog without calling modifyEdt', async () => {
    const active = edt({ ulid: 'active-ulid', topic: 'active-edt', status: 'active', members: [] });
    let modifyCalls = 0;
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
      modifyEdt: async (): Promise<Result<ModifyEdtData>> => {
        modifyCalls += 1;
        return { ok: true, data: { ulid: 'active-ulid', topic: 'active-edt', results: [] } };
      },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.enter); // open Add to EDT
      await instance.waitUntilRenderFlush(); // let the picker's own listBranches() settle first
      expect(stdout.output).toContain('ADD TO EDT');

      await pressEscape(instance, stdin);

      expect(modifyCalls).toBe(0);
      // The picker's own async branches-fetch settling can still land a render
      // shortly around the same time as Escape's, so — same technique as the Modify/
      // service-actions retry tests above — only the *last* rendered frame (not every write
      // since a captured point in time) can reliably tell whether the dialog is still showing.
      const lastFrame = stdout.output.slice(stdout.output.lastIndexOf('EDTS'));
      expect(lastFrame).not.toContain('ADD TO EDT');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // The `undefined` guards in the base-view Enter dispatch for EDT SERVICES/OTHER SERVICES
  // (protecting against opening a dialog for a row that doesn't exist) — Enter on an empty pane
  // must be a no-op.
  it('Enter on an empty EDT SERVICES pane is a no-op — never opens the contextual menu', async () => {
    const active = edt({ ulid: 'active-ulid', topic: 'active-edt', status: 'active', members: [] });
    const store = createAppStore();
    store.setState({
      edts: [active],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      // No members -> EDT SERVICES is empty; the one service is a non-member, so it lands in
      // OTHER SERVICES instead.
      edtsBranches: [
        { service: 'svc-b', path: '/repos/b', isMember: false, branch: 'feature-y', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edts -> edt-services (empty)
      expect(stdout.output).toContain('No services in this EDT.');

      await press(instance, stdin, KEYS.enter); // no-op: nothing to open a menu for

      expect(stdout.output).not.toContain('SERVICE ACTIONS');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Enter on an empty OTHER SERVICES pane is a no-op — never opens Add to EDT', async () => {
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
      // The one service is a member of the selected EDT -> OTHER SERVICES is empty.
      edtsBranches: [
        { service: 'svc-a', path: '/repos/a', isMember: true, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edts -> edt-services
      await press(instance, stdin, KEYS.tab); // edt-services -> other-services (empty)
      expect(stdout.output).toContain('No managed services found.');

      await press(instance, stdin, KEYS.enter); // no-op: nothing to open Add to EDT for

      expect(stdout.output).not.toContain('ADD TO EDT');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});
