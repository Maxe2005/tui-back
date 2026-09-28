// tui/zones/edts: story 2.9's async submit/confirm/force-switch paths and the
// zoneInputCaptured gate are behavior only a real keypress can exercise — `renderToString`'s
// fake stdin never emits data (see edts-zone.test.tsx and Design Notes). This file reuses
// app-shell.alternate-screen.test.tsx's real-Ink-input technique (via
// shared/test-support/fake-tty.ts) to drive genuine `useInput` round-trips through Ink's own
// keypress parser — no pty required.
import { createElement } from 'react';
import { render } from 'ink';
import { describe, it, expect } from 'vitest';
import type { EdtRegistryEntry } from '../../../../../core/ports/edt-registry.js';
import type { Result } from '../../../../../core/result.js';
import type { CreateCandidateBranches, CreateEdtData } from '../../../../../core/edt/create.js';
import type { SwitchActiveEdtData } from '../../../../../core/edt/switch.js';
import type { ModifyEdtData } from '../../../../../core/edt/modify.js';
import { createAppStore, type CreateEdtParams, type ModifyEdtParams } from '../../store/app-store.js';
import { fakeInteractiveTtyStdin, FakeTtyStdout, KEYS } from '../../shared/test-support/fake-tty.js';
import { EdtsZone } from './edts-zone.js';
import { CREATE_WIZARD_TITLE as WIZARD_TITLE } from './dialogs/create-wizard/create-wizard.js';

function edt(overrides: Partial<EdtRegistryEntry> = {}): EdtRegistryEntry {
  return {
    ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
    topic: 'demo',
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'inactive',
    members: [],
    ...overrides,
  };
}

async function press(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream, sequence: string): Promise<void> {
  (stdin as unknown as { write: (chunk: string) => void }).write(sequence);
  await instance.waitUntilRenderFlush();
}

// A lone ESC byte is ambiguous on the wire — Ink's input parser can't tell it apart from the
// first byte of a CSI sequence (e.g. an arrow key) until either more bytes arrive or its own
// internal `pendingInputFlushDelayMilliseconds` (20ms, ink/build/components/App.js) real
// timer fires to flush it as a standalone Escape keypress. `waitUntilRenderFlush()` only
// waits for React's own commit, not that timer, so a bare `press(..., KEYS.escape)` can
// resolve before Ink has actually delivered `key.escape: true` to `useInput` at all —
// asserting immediately after risks a vacuous pass (nothing ran, but the assertion happened
// to hold anyway). Every Escape press in this file goes through this instead.
async function pressEscape(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream): Promise<void> {
  await press(instance, stdin, KEYS.escape);
  await new Promise((resolve) => setTimeout(resolve, 30));
  await instance.waitUntilRenderFlush();
}

async function type(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream, text: string): Promise<void> {
  for (const char of text) {
    await press(instance, stdin, char);
  }
}

// Story 2.37: Step 3 loads each selected service's branch lists on entry (never fetching).
type ListsResult = Result<CreateCandidateBranches>;
const readyBranches = async (): Promise<ListsResult> => ({ ok: true, data: { local: ['main', 'development'], remote: [] } });

// Lets the async list loads settle (a resolved promise, then React's commit).
async function settle(instance: ReturnType<typeof render>): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await instance.waitUntilRenderFlush();
}

function lastWizardFrame(stdout: FakeTtyStdout): string {
  return stdout.output.slice(stdout.output.lastIndexOf(WIZARD_TITLE));
}

// Two services with diverging manifest sharedBranch values (svc-a: main, svc-b: development).
function step3Store(
  options: {
    lists?: Record<string, CreateCandidateBranches>;
    listCreateBranches?: (repoPath: string) => Promise<ListsResult>;
    edts?: EdtRegistryEntry[];
  } = {},
) {
  const store = createAppStore();
  const createCalls: CreateEdtParams[] = [];
  const listCalls: string[] = [];
  store.setState({
    edts: options.edts ?? [],
    edtsStatus: 'idle',
    activeEdt: null,
    edtsBranches: [
      { service: 'svc-a', path: '/repos/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'main' },
      { service: 'svc-b', path: '/repos/b', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' },
    ],
    edtsBranchesStatus: 'idle',
    loadEdts: async () => {},
    loadEdtsBranches: async () => {},
    listCreateBranches:
      options.listCreateBranches ??
      (async (repoPath: string): Promise<ListsResult> => {
        listCalls.push(repoPath);
        const lists = options.lists?.[repoPath] ?? { local: ['main', 'development'], remote: [] };
        return { ok: true, data: lists };
      }),
    createEdt: async (params): Promise<Result<CreateEdtData>> => {
      createCalls.push(params);
      return { ok: true, data: { ulid: 'new-ulid', topic: params.topic, results: [] } };
    },
  });
  return { store, createCalls, listCalls };
}

// Name -> the first `services` candidates checked -> Step 3, lists loaded.
async function reachStep3(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream, name: string, services: number): Promise<void> {
  await instance.waitUntilRenderFlush();
  await type(instance, stdin, name);
  await press(instance, stdin, KEYS.enter); // Step 1 -> Step 2
  for (let index = 0; index < services; index += 1) {
    if (index > 0) {
      await press(instance, stdin, KEYS.down);
    }
    await press(instance, stdin, KEYS.space);
  }
  await press(instance, stdin, KEYS.enter); // Step 2 -> Step 3
  await settle(instance);
}

function mount(
  store: ReturnType<typeof createAppStore>,
  extraProps: {
    initialDialogKind?: 'create' | 'switch-confirm' | 'switch-blocked' | 'modify' | 'service-actions' | 'add-to-edt' | 'delete-confirm' | 'delete-confirm-rejected';
  } = {},
) {
  const stdout = new FakeTtyStdout();
  const stdin = fakeInteractiveTtyStdin();
  const instance = render(createElement(EdtsZone, { useStore: store, ...extraProps }), {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin,
    interactive: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  return { instance, stdout, stdin };
}

describe('EdtsZone real-keypress interactions (story 2.9)', () => {
  it('a switch failure that is not the lock-block code stays in switch-confirm — never a silent return to the list', async () => {
    const store = createAppStore();
    const target = edt({ ulid: 'target-ulid', topic: 'other' });
    let switchCalls = 0;
    store.setState({
      edts: [target],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      switchEdt: async (): Promise<Result<SwitchActiveEdtData>> => {
        switchCalls += 1;
        return { ok: false, error: { code: 'some-other-failure', message: 'Disk is full' } };
      },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      // Base view, default pane focus 'edts', default row 0 (the only EDT, not active) —
      // Enter opens the switch-confirm dialog.
      await press(instance, stdin, KEYS.enter);
      expect(stdout.output).toContain('SWITCH EDT');

      // Enter again confirms the switch — it fails with a non-block error.
      await press(instance, stdin, KEYS.enter);
      expect(switchCalls).toBe(1);
      expect(stdout.output).toContain('Disk is full');

      // The decisive check: if the dialog had silently reverted to the base EDT list, this
      // third Enter would call openEdtAction() (opening a *fresh* dialog) instead of
      // re-invoking switchEdt directly — so switchCalls would stay at 1 here, only reaching
      // 2 after a *fourth* press. Reaching 2 here proves the dialog never left
      // switch-confirm.
      await press(instance, stdin, KEYS.enter);
      expect(switchCalls).toBe(2);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Bug fix: a dirty repo (member or non-member) about to be auto-stashed is previewed,
  // by service, before the switch actually touches anything — the developer confirms or
  // cancels. This fakes switchEdt driving the exact same store fields (switchDirtyRepos /
  // resolveSwitchDirtyRepos) edt-slice.ts's real onDirtyReposBeforeSwitch seam does — the
  // real end-to-end wiring through core/edt/switch.ts is covered by edt-slice.test.ts; this
  // test is about the dialog's own rendering and keystroke routing.
  it('a dirty-repo preview raised mid-switch renders per-service rows and resumes on Enter (bug fix)', async () => {
    const store = createAppStore();
    const target = edt({ ulid: 'target-ulid', topic: 'other' });
    let switchCalls = 0;
    store.setState({
      edts: [target],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      switchEdt: async (): Promise<Result<SwitchActiveEdtData>> => {
        switchCalls += 1;
        store.setState({ switchDirtyRepos: [{ service: 'svc-payments', repoPath: '/repo/payments', scope: 'non-member' }] });
        const choice = await new Promise<'proceed' | 'cancel'>((resolve) => {
          store.setState({
            resolveSwitchDirtyRepos: (c) => {
              store.setState({ switchDirtyRepos: null });
              resolve(c);
            },
          });
        });
        if (choice === 'cancel') {
          return { ok: false, error: { code: 'switch-cancelled-by-user', message: 'Switch cancelled' } };
        }
        return { ok: true, data: { ulid: target.ulid, topic: target.topic, results: [], wasInterrupted: false } };
      },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter); // open switch-confirm
      await press(instance, stdin, KEYS.enter); // confirm switch -> raises the preview
      await instance.waitUntilRenderFlush();

      expect(stdout.output).toContain('svc-payments');
      expect(stdout.output).toContain('outside this EDT');
      expect(stdout.output).toContain('[Enter] continue anyway');

      await press(instance, stdin, KEYS.enter); // proceed past the preview
      await instance.waitUntilRenderFlush();

      expect(switchCalls).toBe(1);
      // Success closes the dialog entirely (and clears the preview along the way).
      expect(store.getState().switchDirtyRepos).toBeNull();
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Esc on a dirty-repo preview cancels the switch, touching nothing — the base confirm prompt is not re-shown as a fresh dialog', async () => {
    const store = createAppStore();
    const target = edt({ ulid: 'target-ulid', topic: 'other' });
    let switchCalls = 0;
    store.setState({
      edts: [target],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      switchEdt: async (): Promise<Result<SwitchActiveEdtData>> => {
        switchCalls += 1;
        store.setState({ switchDirtyRepos: [{ service: 'svc-payments', repoPath: '/repo/payments', scope: 'non-member' }] });
        const choice = await new Promise<'proceed' | 'cancel'>((resolve) => {
          store.setState({
            resolveSwitchDirtyRepos: (c) => {
              store.setState({ switchDirtyRepos: null });
              resolve(c);
            },
          });
        });
        if (choice === 'cancel') {
          return { ok: false, error: { code: 'switch-cancelled-by-user', message: 'Switch cancelled: uncommitted changes were present' } };
        }
        return { ok: true, data: { ulid: target.ulid, topic: target.topic, results: [], wasInterrupted: false } };
      },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter); // open switch-confirm
      await press(instance, stdin, KEYS.enter); // confirm switch -> raises the preview
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('[Enter] continue anyway');

      await pressEscape(instance, stdin); // cancel the preview, not the whole dialog
      await instance.waitUntilRenderFlush();

      expect(switchCalls).toBe(1);
      expect(store.getState().switchDirtyRepos).toBeNull();
      expect(stdout.output).toContain('Switch cancelled');
      // Still in switch-confirm (not a fresh dialog) — a second Enter re-invokes switchEdt
      // directly rather than opening a brand-new dialog.
      await press(instance, stdin, KEYS.enter);
      expect(switchCalls).toBe(2);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('switch-blocked-action-in-progress surfaces an explicit force-or-cancel prompt, and Escape cancels without forcing', async () => {
    const store = createAppStore();
    const target = edt({ ulid: 'target-ulid', topic: 'other' });
    let switchCalls: Array<{ force?: boolean }> = [];
    store.setState({
      edts: [target],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      switchEdt: async (params): Promise<Result<SwitchActiveEdtData>> => {
        switchCalls.push({ force: params.force });
        return { ok: false, error: { code: 'switch-blocked-action-in-progress', message: 'An action is in progress' } };
      },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter); // open switch-confirm
      await press(instance, stdin, KEYS.enter); // attempt switch -> blocked
      expect(switchCalls).toEqual([{ force: false }]);
      expect(stdout.output).toContain('force switch');

      // Escape cancels the blocked prompt without ever forcing.
      await pressEscape(instance, stdin);
      expect(switchCalls).toHaveLength(1);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a second Enter on the blocked prompt forces the switch (force: true) and succeeds', async () => {
    const store = createAppStore();
    const target = edt({ ulid: 'target-ulid', topic: 'other' });
    const switchCalls: Array<{ force?: boolean }> = [];
    store.setState({
      edts: [target],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      switchEdt: async (params): Promise<Result<SwitchActiveEdtData>> => {
        switchCalls.push({ force: params.force });
        if (!params.force) {
          return { ok: false, error: { code: 'switch-blocked-action-in-progress', message: 'An action is in progress' } };
        }
        return { ok: true, data: { ulid: target.ulid, topic: target.topic, results: [], wasInterrupted: false } };
      },
    });

    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter); // open switch-confirm
      await press(instance, stdin, KEYS.enter); // attempt switch -> blocked
      expect(switchCalls).toEqual([{ force: false }]);

      await press(instance, stdin, KEYS.enter); // second Enter on the blocked prompt -> force
      expect(switchCalls).toEqual([{ force: false }, { force: true }]);

      // Success closes the dialog — a third Enter now falls through to the base view's
      // openEdtAction() (a fresh dialog), not another direct switchEdt call.
      await press(instance, stdin, KEYS.enter);
      expect(switchCalls).toHaveLength(2);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Story 2.26 amendment: this scenario used to reach the branch-picker via Enter on the
  // one *existing* member's still-checked row — no longer possible (that row now submits
  // instead, see the dedicated amendment test below). Adapted to a not-yet-member candidate
  // (svc-b), which stays branch-editable via Enter when freshly checked — the "drop a staged
  // edit on uncheck" rule under test applies identically either way.
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
      edts: [active],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [
        { service: 'svc-a', path: '/repos/a', isMember: true, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' },
        { service: 'svc-b', path: '/repos/b', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      // Story 2.26: Create new's pre-step for a brand-new name — mocked to succeed so the
      // picker's staging actually commits (default "store not wired" would leave the picker
      // open on a synthesized error instead).
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
      // branch-picker (story 2.26) on that freshly-checked row (Create new, no "current
      // branch" to rename) so a custom value can be staged instead of the auto-suggestion.
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.space);
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.enter); // advance base -> name (pre-filled "main")
      for (let i = 0; i < 'main'.length; i += 1) {
        await press(instance, stdin, KEYS.backspace);
      }
      await type(instance, stdin, 'feature-y');
      await press(instance, stdin, KEYS.enter); // commit the create-new stage, back to the form

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

  // Story 2.26 amendment: an already-a-member row is never branch-editable via checklist
  // Enter any more — checked or not, the whole membership snapshot at dialog-open time is
  // excluded (canEditMemberBranch's new originalMemberPaths guard). Enter on it must submit
  // the form directly instead, closing the "practically unreachable submitModify" bug this
  // amendment fixes. (Changing an existing member's own branch is still reachable — through
  // the EDT SERVICES row's own "Change branch for this EDT" action, covered separately.)
  it('Enter on an existing-member checklist row submits the form instead of opening the branch-picker (story 2.26 amendment)', async () => {
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
        { service: 'svc-a', path: '/repos/a', isMember: true, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' },
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

  // Story 2.26 amendment: the dialog title names the service a branch-picker session is open
  // for, reverting to the plain title once the session closes — covers both ways a session
  // can now open in Modify: a freshly-checked not-yet-member row (direct checklist Enter),
  // and an existing member (the retry escape hatch, the only way left to reach one — see the
  // amendment test above).
  it('branch-picker title names the service for a freshly-checked candidate, reverting to MODIFY EDT on close (story 2.26 amendment)', async () => {
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
        { service: 'svc-a', path: '/repos/a', isMember: true, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' },
        { service: 'svc-b', path: '/repos/b', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' },
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

  it('branch-picker title names the service for an existing member reopened via retry, reverting to MODIFY EDT on close (story 2.26 amendment)', async () => {
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
        { service: 'svc-a', path: '/repos/a', isMember: true, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' },
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

  // Story 2.26 amendment code review: the title's service lookup must fall through to
  // `dialog.target.members.find(...)` when the branch-picker's repoPath belongs to an existing
  // member that's absent from `candidates` (e.g. its repo became unreachable, or its manifest
  // failed to load, so the current edtsBranches fetch never produced an entry for it) — never
  // silently reverting to plain "MODIFY EDT" just because the `candidates.find(...)` branch
  // came up empty. Modeled on the "reopened via retry" test above, but with svc-a deliberately
  // missing from edtsBranches.
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

  // Story 2.26 amendment: adapted to a not-yet-member candidate (svc-b) — Enter on the
  // existing member (svc-a) no longer opens the branch-picker at all (see the dedicated
  // amendment test above), so the empty-value validation is exercised via the still-reachable
  // freshly-checked-row path instead (Create-new's own name field validates identically).
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
      edts: [active],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [
        { service: 'svc-a', path: '/repos/a', isMember: true, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' },
        { service: 'svc-b', path: '/repos/b', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      // Story 2.26: Create new's pre-step for a brand-new name — mocked to succeed so the
      // valid retry value actually commits (default "store not wired" would leave the picker
      // open on a synthesized error instead).
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

  // Story 2.24: checking a not-yet-member candidate in Modify auto-stages a suggested branch
  // (the shared branch when every existing member agrees on one) — it flows straight through
  // to modifyEdt's addMembers+setBranches without ever having to open the branch-edit
  // sub-dialog by hand.
  it('auto-stages a suggested branch when checking a not-yet-member candidate (story 2.24)', async () => {
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
        { service: 'svc-a', path: '/repos/a', isMember: true, branch: 'feature-shared', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' },
        { service: 'svc-b', path: '/repos/b', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' },
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

  // Story 2.24: a newly-checked member's staged branch can still end up empty (e.g. an
  // all-punctuation topic slugifies to '' and there are zero existing members to fall back
  // to) — confirm must block inline, never reaching modifyEdt.
  it('blocks confirm inline when a newly-checked member\'s auto-staged branch is empty (story 2.24)', async () => {
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
        { service: 'svc-b', path: '/repos/b', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' },
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

  it('guards the create form submit against re-entrancy — a second Enter before the first resolves never double-calls createEdt', async () => {
    const store = createAppStore();
    let createCalls = 0;
    let release: (() => void) | undefined;
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      edtsBranches: [{ service: 'svc-a', path: '/repos/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' }],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      listCreateBranches: readyBranches,
      createEdt: async (): Promise<Result<CreateEdtData>> => {
        createCalls += 1;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { ok: true, data: { ulid: 'new-ulid', topic: 'demo', results: [] } };
      },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      // AC1: zero EDTs -> the create wizard auto-opens on Step 1, name-focused by default.
      await type(instance, stdin, 'demo');
      await press(instance, stdin, KEYS.enter); // Step 1 -> Step 2 (services)
      await press(instance, stdin, KEYS.space); // select svc-a
      await press(instance, stdin, KEYS.enter); // Step 2 -> Step 3 (branch lists load)
      await settle(instance);
      await press(instance, stdin, KEYS.ctrlN); // Step 3 -> Step 4 (Enter never advances Step 3)
      await press(instance, stdin, KEYS.enter); // submit #1 — starts, awaits the pending promise
      expect(createCalls).toBe(1);

      await press(instance, stdin, KEYS.enter); // submit #2 — guarded by `submitting`
      expect(createCalls).toBe(1);

      // Story 2.36: every key is inert while the submit is in flight — Esc would otherwise
      // request a quit here (zero EDTs), and Ctrl+P would step back mid-submit.
      await pressEscape(instance, stdin);
      await press(instance, stdin, KEYS.ctrlP);
      await press(instance, stdin, KEYS.ctrlLeft);
      expect(store.getState().quitRequested).toBe(false);
      const lastFrame = stdout.output.slice(stdout.output.lastIndexOf(WIZARD_TITLE));
      expect(lastFrame).toContain('▶ 4. Activation ◀');
      expect(lastFrame).toContain('Création…');

      release?.();
      await instance.waitUntilRenderFlush();
      await instance.waitUntilRenderFlush();
      expect(createCalls).toBe(1);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('story 2.32: Left/Backspace edit the topic field at the caret through a real keypress round-trip, not always at the end', async () => {
    const store = createAppStore();
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      // AC1: zero EDTs -> the create wizard auto-opens on Step 1, name-focused by default.
      await type(instance, stdin, 'abd'); // cursor trails at 3
      await press(instance, stdin, KEYS.left); // cursor -> 2
      // Mid-string insert (I/O matrix): typing 'c' at cursor 2 in "abd" must produce "abcd" —
      // if Left had stayed a no-op (pre-story behavior), this would append at the end instead,
      // producing "abdc".
      await type(instance, stdin, 'c');
      expect(stdout.output).toContain('Nom: abcd');
      expect(stdout.output).not.toContain('Nom: abdc');

      await press(instance, stdin, KEYS.home); // cursor -> 0
      await press(instance, stdin, KEYS.backspace); // cursor:0 -> no-op (I/O matrix)
      expect(stdout.output).toContain('Nom: abcd');

      await press(instance, stdin, KEYS.end); // cursor -> 4 (value.length)
      await press(instance, stdin, KEYS.backspace); // removes 'd' before cursor
      expect(stdout.output).toContain('Nom: abc');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a zone dialog sets zoneInputCaptured so a typed "?" never opens global help while it is open', async () => {
    const store = createAppStore();
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });

    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      // The create-prompt-auto-open effect and the zoneInputCaptured-sync effect both fire
      // as passive effects after the first commit — a second flush lets both settle before
      // asserting.
      await instance.waitUntilRenderFlush();
      // The create prompt auto-opened (zero EDTs) — zoneInputCaptured must already be true.
      expect(store.getState().zoneInputCaptured).toBe(true);

      // Typing "?" inside the captured topic field must not be swallowed as a global
      // shortcut anywhere else — it's appended to the topic like any other character.
      await press(instance, stdin, '?');
      // Still captured, dialog still open (no crash, no stray global dispatch).
      expect(store.getState().zoneInputCaptured).toBe(true);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('matrix: create with a duplicate topic — createEdt\'s rejection is surfaced inline, form stays open', async () => {
    const store = createAppStore();
    const createCalls: CreateEdtParams[] = [];
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      edtsBranches: [{ service: 'svc-a', path: '/repos/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' }],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      listCreateBranches: readyBranches,
      createEdt: async (params): Promise<Result<CreateEdtData>> => {
        createCalls.push(params);
        return { ok: false, error: { code: 'edt-topic-exists', message: 'An EDT with topic "demo" already exists' } };
      },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      // AC1: zero EDTs -> the create wizard auto-opens on Step 1, name-focused by default.
      await type(instance, stdin, 'demo');
      await press(instance, stdin, KEYS.enter); // Step 1 -> Step 2 (services)
      await press(instance, stdin, KEYS.space); // select the one candidate member
      await press(instance, stdin, KEYS.enter); // Step 2 -> Step 3 (branch lists load)
      await settle(instance);
      await press(instance, stdin, KEYS.ctrlN); // Step 3 -> Step 4 (Enter never advances Step 3)
      // The loaded EDT list is empty, so Step 1's live check passed — only the core can still
      // reject the topic (e.g. an EDT created concurrently from the CLI).
      await press(instance, stdin, KEYS.enter); // submit -> rejected

      expect(createCalls).toHaveLength(1);
      expect(stdout.output).toContain('An EDT with topic "demo" already exists');
      // Still the create dialog, not silently torn down to a bare/empty list.
      expect(stdout.output).toContain(WIZARD_TITLE);

      // The rejection didn't wedge the form: a further submit attempt calls createEdt again.
      await press(instance, stdin, KEYS.enter);
      expect(createCalls).toHaveLength(2);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('story 2.36 matrix: zero services checked blocks leaving Step 2 — inline message, no createEdt call', async () => {
    const store = createAppStore();
    const createCalls: CreateEdtParams[] = [];
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      edtsBranches: [{ service: 'svc-a', path: '/repos/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' }],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      createEdt: async (params): Promise<Result<CreateEdtData>> => {
        createCalls.push(params);
        return { ok: true, data: { ulid: 'new-ulid', topic: 'demo', results: [] } };
      },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await type(instance, stdin, 'demo');
      await press(instance, stdin, KEYS.enter); // Step 1 -> Step 2 (services)
      await press(instance, stdin, KEYS.enter); // no service checked -> blocked
      await press(instance, stdin, KEYS.ctrlN); // Ctrl+N is gated by the same check
      await press(instance, stdin, KEYS.ctrlRight); // and so is Ctrl+→

      expect(stdout.output).toContain('Sélectionnez au moins un service');
      const lastFrame = stdout.output.slice(stdout.output.lastIndexOf(WIZARD_TITLE));
      expect(lastFrame).toContain('▶ 2. Services ◀');
      expect(stdout.output).not.toContain('▶ 3. Branches ◀');
      expect(createCalls).toHaveLength(0);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Review patch (story 2.9): createEdt/switchEdt/modifyEdt are per-repo/per-member
  // isolated — an overall ok:true result can still carry `results` rows with
  // `outcome: 'failed'` (e.g. a candidate on a shared/protected branch). Every submit
  // handler used to treat `result.ok` as unconditional full success and silently close the
  // dialog without ever looking at `results`.
  it('surfaces a per-member failure inline even though createEdt returned ok:true, instead of silently closing', async () => {
    const store = createAppStore();
    let loadCalls = 0;
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      edtsBranches: [
        { service: 'svc-a', path: '/repos/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' },
        { service: 'svc-b', path: '/repos/b', isMember: false, branch: 'development', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {
        loadCalls += 1;
      },
      loadEdtsBranches: async () => {},
      listCreateBranches: readyBranches,
      createEdt: async (): Promise<Result<CreateEdtData>> => ({
        ok: true,
        data: {
          ulid: 'new-ulid',
          topic: 'demo',
          results: [
            { service: 'svc-a', outcome: 'created' },
            { service: 'svc-b', outcome: 'failed', detail: { code: 'shared-branch-rejected', message: 'Branch "development" is shared/protected' } },
          ],
        },
      }),
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      // AC1: zero EDTs -> the create wizard auto-opens. Select both candidates.
      await type(instance, stdin, 'demo');
      await press(instance, stdin, KEYS.enter); // Step 1 -> Step 2 (services)
      await press(instance, stdin, KEYS.space);
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.space);
      await press(instance, stdin, KEYS.enter); // Step 2 -> Step 3 (branch lists load)
      await settle(instance);
      await press(instance, stdin, KEYS.ctrlN); // Step 3 -> Step 4 (Enter never advances Step 3)
      await press(instance, stdin, KEYS.enter); // submit

      // The EDT was created (loadEdts ran) but the dialog stays open with the per-member
      // failure surfaced inline — it must never silently close as if every requested
      // member had actually been added.
      expect(loadCalls).toBeGreaterThan(0);
      expect(stdout.output).toContain(WIZARD_TITLE);
      expect(stdout.output).toContain('svc-b');
      expect(stdout.output).toContain('shared/protected');

      // Story 2.36 (review): the EDT already exists — nothing may re-submit or navigate away;
      // the failure rows stay until acknowledged, and Enter closes the wizard.
      expect(stdout.output).toContain('[Entrée/Esc] Fermer');
      await press(instance, stdin, KEYS.ctrlLeft);
      expect(stdout.output.slice(stdout.output.lastIndexOf(WIZARD_TITLE))).toContain('shared/protected');
      const beforeClose = stdout.output.length;
      await press(instance, stdin, KEYS.enter);
      const afterClose = stdout.output.slice(beforeClose);
      expect(afterClose.length).toBeGreaterThan(0);
      expect(afterClose).not.toContain(WIZARD_TITLE);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Story 2.37: Step 3 — global branch strategy & per-service overrides -------------------
  it('story 2.37: Step 3 opens on Panel A (placeholder base, slug name, every row global); the default submit sends memberPlans only', async () => {
    const { store, createCalls, listCalls } = step3Store();
    const { instance, stdout, stdin } = mount(store);
    try {
      await reachStep3(instance, stdin, 'Auth Flow', 2);
      const frame = lastWizardFrame(stdout);
      expect(frame).toContain('▶ STRATÉGIE GLOBALE');
      expect(frame).toContain('› Branche source par défaut: <shared-branch>');
      expect(frame).toContain('Nom global de la branche: auth-flow');
      expect(frame).toContain('RÉSUMÉ ET EXCEPTIONS PAR SERVICE');
      expect(frame).toContain('Service │ Mode');
      expect(frame).toMatch(/svc-a +│ \[Créer \(Global\)\] │ main +│ auth-flow/);
      expect(frame).toMatch(/svc-b +│ \[Créer \(Global\)\] │ development +│ auth-flow/);
      // The Step 3 footer (wrapped at the 80-column fake terminal).
      expect(frame).toContain('[Tab] Changer de zone • [Entrée] Configurer la ligne • [Ctrl+N] Étape');
      // Each service's lists are loaded exactly once for this entry.
      expect([...listCalls].sort()).toEqual(['/repos/a', '/repos/b']);

      await press(instance, stdin, KEYS.enter); // Panel A: Enter edits the base line — never advances
      expect(lastWizardFrame(stdout)).toContain('▶ 3. Branches ◀');
      await pressEscape(instance, stdin); // leaves edit mode only
      await press(instance, stdin, KEYS.ctrlN); // Step 3 -> Step 4
      const recap = lastWizardFrame(stdout);
      expect(recap).toContain('▶ 4. Activation ◀');
      expect(recap).toContain('3. Branches: auth-flow');
      expect(recap).toContain('svc-a : [Créer (Global)] main → auth-flow');
      await press(instance, stdin, KEYS.enter); // submit

      expect(createCalls).toHaveLength(1);
      expect(createCalls[0]?.branchOptions).toBeUndefined();
      expect(createCalls[0]?.memberPlans).toEqual({
        '/repos/a': { kind: 'create', base: 'main', name: 'auth-flow' },
        '/repos/b': { kind: 'create', base: 'development', name: 'auth-flow' },
      });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('story 2.37 matrix: a global base resolves live per service (local preferred, else origin/<x>); "introuvable" blocks Ctrl+N', async () => {
    const { store, createCalls } = step3Store({
      lists: { '/repos/a': { local: ['main', 'rel'], remote: ['origin/rel'] }, '/repos/b': { local: ['development'], remote: ['origin/rel'] } },
    });
    const { instance, stdout, stdin } = mount(store);
    try {
      await reachStep3(instance, stdin, 'demo', 2);
      await type(instance, stdin, 'nope'); // a printable key enters edit mode with that character typed
      let frame = lastWizardFrame(stdout);
      expect(frame).toContain('Branche source par défaut: nope');
      expect(frame).toMatch(/svc-a +│ \[Créer \(Global\)\] │ ✖ branche introuvable/);
      await press(instance, stdin, KEYS.ctrlN); // blocked
      frame = lastWizardFrame(stdout);
      expect(frame).toContain('▶ 3. Branches ◀');
      expect(frame).toContain('svc-a : branche introuvable');

      for (let i = 0; i < 4; i += 1) {
        await press(instance, stdin, KEYS.backspace);
      }
      expect(lastWizardFrame(stdout)).toContain('Branche source par défaut: <shared-branch>'); // placeholder restored
      await type(instance, stdin, 'rel');
      frame = lastWizardFrame(stdout);
      expect(frame).toMatch(/svc-a +│ \[Créer \(Global\)\] │ rel +│ demo/);
      expect(frame).toMatch(/svc-b +│ \[Créer \(Global\)\] │ origin\/rel +│ demo/);

      await press(instance, stdin, KEYS.enter); // commit the field
      await press(instance, stdin, KEYS.ctrlN);
      await press(instance, stdin, KEYS.enter);
      expect(createCalls[0]?.memberPlans).toEqual({
        '/repos/a': { kind: 'create', base: 'rel', name: 'demo' },
        '/repos/b': { kind: 'create', base: 'origin/rel', name: 'demo' },
      });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('story 2.37 matrix: the global name tracks Step 1 until edited; Ctrl+← keeps every decision', async () => {
    const { store, createCalls } = step3Store();
    const { instance, stdout, stdin } = mount(store);
    try {
      await reachStep3(instance, stdin, 'demo', 1);
      await press(instance, stdin, KEYS.ctrlLeft); // Step 3 -> Step 2
      await press(instance, stdin, KEYS.ctrlLeft); // Step 2 -> Step 1
      await type(instance, stdin, ' X Y');
      await press(instance, stdin, KEYS.enter); // Step 1 -> Step 2
      await press(instance, stdin, KEYS.enter); // Step 2 -> Step 3 (svc-a still checked)
      await settle(instance);
      expect(lastWizardFrame(stdout)).toContain('Nom global de la branche: demo-x-y'); // untouched: tracks the slug

      await press(instance, stdin, KEYS.down); // Panel A: base -> name line
      await press(instance, stdin, KEYS.enter); // edit the name
      await type(instance, stdin, '-q');
      await press(instance, stdin, KEYS.enter); // commit
      expect(lastWizardFrame(stdout)).toMatch(/svc-a +│ \[Créer \(Global\)\] │ main +│ demo-x-y-q/);

      await press(instance, stdin, KEYS.ctrlLeft);
      await press(instance, stdin, KEYS.ctrlLeft);
      await type(instance, stdin, 'Z');
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.enter);
      await settle(instance);
      expect(lastWizardFrame(stdout)).toContain('Nom global de la branche: demo-x-y-q'); // touched: kept

      await press(instance, stdin, KEYS.ctrlN);
      await press(instance, stdin, KEYS.enter);
      expect(createCalls[0]?.members).toEqual(['/repos/a']);
      expect(createCalls[0]?.memberPlans).toEqual({ '/repos/a': { kind: 'create', base: 'main', name: 'demo-x-y-q' } });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('story 2.37 matrix: "Configurer" box — a Perso row ignores Panel A; Ctrl+R reverts it to the global rule', async () => {
    const { store, createCalls } = step3Store({ lists: { '/repos/a': { local: ['main'], remote: ['origin/dev'] }, '/repos/b': { local: ['development'], remote: [] } } });
    const { instance, stdout, stdin } = mount(store);
    try {
      await reachStep3(instance, stdin, 'demo', 2);
      await press(instance, stdin, KEYS.tab); // Panel A -> Panel B
      expect(lastWizardFrame(stdout)).toContain('▶ RÉSUMÉ ET EXCEPTIONS PAR SERVICE');
      await press(instance, stdin, KEYS.enter); // open the box on svc-a
      let frame = lastWizardFrame(stdout);
      expect(frame).toContain('Configurer svc-a');
      expect(frame).toContain('Mode : (•) Créer nouvelle ( ) Choisir existante');
      expect(frame).toContain('Branche de base (source): main');
      expect(frame).toContain('Nom de la branche: demo');

      await press(instance, stdin, KEYS.down); // base line
      await press(instance, stdin, KEYS.enter); // edit
      for (let i = 0; i < 4; i += 1) {
        await press(instance, stdin, KEYS.backspace);
      }
      await type(instance, stdin, 'origin/dev');
      await press(instance, stdin, KEYS.enter); // exact match: commits, focuses the name line
      await press(instance, stdin, KEYS.enter); // edit the name
      for (let i = 0; i < 4; i += 1) {
        await press(instance, stdin, KEYS.backspace);
      }
      await type(instance, stdin, 'q');
      await press(instance, stdin, KEYS.enter); // commit -> [ Appliquer ]
      await press(instance, stdin, KEYS.enter); // apply
      frame = lastWizardFrame(stdout);
      expect(frame).not.toContain('Configurer svc-a');
      expect(frame).toMatch(/svc-a +│ \[Créer \(Perso\)\] +│ origin\/dev +│ q/);

      // Perso ignores Panel A: an unresolvable global base only blocks the global row.
      await press(instance, stdin, KEYS.tab);
      await type(instance, stdin, 'zzz');
      frame = lastWizardFrame(stdout);
      expect(frame).toMatch(/svc-a +│ \[Créer \(Perso\)\] +│ origin\/dev +│ q/);
      expect(frame).toMatch(/svc-b +│ \[Créer \(Global\)\] +│ ✖ branche introuvable/);
      for (let i = 0; i < 3; i += 1) {
        await press(instance, stdin, KEYS.backspace);
      }
      await pressEscape(instance, stdin); // leave Panel A's edit mode

      await press(instance, stdin, KEYS.ctrlN);
      await press(instance, stdin, KEYS.enter);
      expect(createCalls[0]?.memberPlans).toEqual({
        '/repos/a': { kind: 'create', base: 'origin/dev', name: 'q' },
        '/repos/b': { kind: 'create', base: 'development', name: 'demo' },
      });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('story 2.37 matrix: Ctrl+R in the box puts the row back to [Créer (Global)] and closes the box', async () => {
    const { store } = step3Store({ lists: { '/repos/a': { local: ['main', 'feat/z'], remote: [] } } });
    const { instance, stdout, stdin } = mount(store);
    try {
      await reachStep3(instance, stdin, 'demo', 1);
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.enter); // open the box
      await press(instance, stdin, KEYS.space); // Mode -> Choisir existante
      await press(instance, stdin, KEYS.down); // "Branche existante"
      await press(instance, stdin, KEYS.enter);
      await type(instance, stdin, 'feat/z');
      await press(instance, stdin, KEYS.enter); // commit -> rename checkbox
      await press(instance, stdin, KEYS.down); // [ Appliquer ]
      await press(instance, stdin, KEYS.enter); // apply
      expect(lastWizardFrame(stdout)).toMatch(/svc-a +│ \[Existante\] +│ feat\/z +│ feat\/z/);

      await press(instance, stdin, KEYS.enter); // reopen: loaded back as "Choisir existante"
      expect(lastWizardFrame(stdout)).toContain('Mode : ( ) Créer nouvelle (•) Choisir existante');
      await press(instance, stdin, KEYS.ctrlR);
      const frame = lastWizardFrame(stdout);
      expect(frame).not.toContain('Configurer svc-a');
      expect(frame).toMatch(/svc-a +│ \[Créer \(Global\)\] │ main +│ demo/);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('story 2.37 matrix: Existante / Renommer via the box — a remote pick with a rename reaches memberPlans as-is; protected names are refused inline', async () => {
    const { store, createCalls } = step3Store({ lists: { '/repos/a': { local: ['main', 'prod'], remote: ['origin/w'] } } });
    const { instance, stdout, stdin } = mount(store);
    try {
      await reachStep3(instance, stdin, 'demo', 1);
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.enter); // open the box
      await press(instance, stdin, KEYS.tab); // Tab on the Mode line toggles too
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.enter);
      await type(instance, stdin, 'prod');
      await press(instance, stdin, KEYS.enter); // commit -> rename checkbox
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.enter); // apply -> refused (protected, no rename)
      let frame = lastWizardFrame(stdout);
      expect(frame).toContain('Configurer svc-a');
      expect(frame).toContain('« prod » est une branche protégée (FR-7)');

      await press(instance, stdin, KEYS.up); // rename checkbox
      await press(instance, stdin, KEYS.up); // "Branche existante"
      await press(instance, stdin, KEYS.enter);
      for (let i = 0; i < 4; i += 1) {
        await press(instance, stdin, KEYS.backspace);
      }
      await type(instance, stdin, 'origin/w');
      await press(instance, stdin, KEYS.enter); // commit -> rename checkbox
      await press(instance, stdin, KEYS.space); // check it: "Nouveau nom" appears
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.enter);
      await type(instance, stdin, 'w2');
      await press(instance, stdin, KEYS.enter); // commit -> [ Appliquer ]
      await press(instance, stdin, KEYS.enter); // apply
      frame = lastWizardFrame(stdout);
      expect(frame).toMatch(/svc-a +│ \[Renommer\] +│ origin\/w +│ -> w2/);

      await press(instance, stdin, KEYS.ctrlN);
      await press(instance, stdin, KEYS.enter);
      expect(createCalls[0]?.memberPlans).toEqual({ '/repos/a': { kind: 'existing', branch: 'origin/w', renameTo: 'w2' } });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('story 2.37: Esc closes the innermost element first — box field, box, Panel A edit mode — then the wizard', async () => {
    const { store, createCalls } = step3Store({ edts: [edt({ ulid: 'other-ulid', topic: 'other' })] });
    const { instance, stdout, stdin } = mount(store, { initialDialogKind: 'create' });
    try {
      await reachStep3(instance, stdin, 'demo', 1);
      await press(instance, stdin, KEYS.tab); // Panel B
      await press(instance, stdin, KEYS.enter); // box
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.enter); // a field in edit
      await pressEscape(instance, stdin); // leaves the field
      expect(lastWizardFrame(stdout)).toContain('Configurer svc-a');
      await pressEscape(instance, stdin); // closes the box
      let frame = lastWizardFrame(stdout);
      expect(frame).not.toContain('Configurer svc-a');
      expect(frame).toContain('▶ RÉSUMÉ ET EXCEPTIONS PAR SERVICE');

      await press(instance, stdin, KEYS.tab); // Panel A
      await press(instance, stdin, KEYS.enter); // edit mode
      await pressEscape(instance, stdin); // leaves edit mode — the wizard stays
      frame = lastWizardFrame(stdout);
      expect(frame).toContain('▶ 3. Branches ◀');

      const beforeCancel = stdout.output.length;
      await pressEscape(instance, stdin); // nothing left open -> cancels the whole creation
      const afterCancel = stdout.output.slice(beforeCancel);
      expect(afterCancel).toContain('other');
      expect(afterCancel).not.toContain(WIZARD_TITLE);
      expect(createCalls).toHaveLength(0);
      expect(store.getState().quitRequested).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('story 2.37 matrix: a failed list load shows on the row, blocks Ctrl+N, and is retried on the next entry', async () => {
    let attempts = 0;
    const { store, createCalls } = step3Store({
      listCreateBranches: async () => {
        attempts += 1;
        return attempts === 1 ? { ok: false, error: { code: 'git-error', message: 'boom' } } : { ok: true, data: { local: ['main'], remote: [] } };
      },
    });
    const { instance, stdout, stdin } = mount(store);
    try {
      await reachStep3(instance, stdin, 'demo', 1);
      expect(lastWizardFrame(stdout)).toMatch(/svc-a +│ \[Créer \(Global\)\] │ ✖ échec du chargement des branches/);
      await press(instance, stdin, KEYS.ctrlN);
      expect(lastWizardFrame(stdout)).toContain('svc-a : échec du chargement des branches');
      expect(attempts).toBe(1);

      await press(instance, stdin, KEYS.ctrlLeft); // Step 2
      await press(instance, stdin, KEYS.ctrlN); // Step 3 again: retried
      await settle(instance);
      expect(attempts).toBe(2);
      expect(lastWizardFrame(stdout)).toMatch(/svc-a +│ \[Créer \(Global\)\] │ main +│ demo/);
      await press(instance, stdin, KEYS.ctrlN);
      await press(instance, stdin, KEYS.enter);
      expect(createCalls).toHaveLength(1);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('story 2.36 matrix: a name taken by a loaded EDT (trimmed) shows "déjà pris" live and blocks Step 1; a case variant stays available', async () => {
    const store = createAppStore();
    let createCalls = 0;
    store.setState({
      edts: [edt({ ulid: 'demo-ulid', topic: 'demo' })],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [{ service: 'svc-a', path: '/repos/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' }],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      createEdt: async (): Promise<Result<CreateEdtData>> => {
        createCalls += 1;
        return { ok: true, data: { ulid: 'new-ulid', topic: 'Demo', results: [] } };
      },
    });

    const { instance, stdout, stdin } = mount(store, { initialDialogKind: 'create' });
    try {
      await instance.waitUntilRenderFlush();
      await type(instance, stdin, ' demo ');
      expect(stdout.output).toContain('✖ déjà pris');
      await press(instance, stdin, KEYS.enter); // blocked
      await press(instance, stdin, KEYS.ctrlRight); // blocked too
      expect(stdout.output).toContain('Ce nom est déjà pris par un autre EDT');
      expect(stdout.output).not.toContain('▶ 2. Services ◀');

      // Rewrite it as "Demo": case-sensitive, so available — checked on every keystroke.
      for (let i = 0; i < ' demo '.length; i += 1) {
        await press(instance, stdin, KEYS.backspace);
      }
      const beforeAvailable = stdout.output.length;
      await type(instance, stdin, 'Demo');
      expect(stdout.output.slice(beforeAvailable)).toContain('✔ disponible');
      await press(instance, stdin, KEYS.enter);
      expect(stdout.output).toContain('▶ 2. Services ◀');
      expect(createCalls).toBe(0);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('story 2.36 (review): Step 4 re-checks the name — a clash appearing after Step 1 blocks the submit with the wizard message', async () => {
    const store = createAppStore();
    let createCalls = 0;
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      edtsBranches: [{ service: 'svc-a', path: '/repos/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' }],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      listCreateBranches: readyBranches,
      createEdt: async (): Promise<Result<CreateEdtData>> => {
        createCalls += 1;
        return { ok: true, data: { ulid: 'new-ulid', topic: 'demo', results: [] } };
      },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await type(instance, stdin, 'demo');
      await press(instance, stdin, KEYS.enter); // Step 1 -> Step 2
      await press(instance, stdin, KEYS.space);
      await press(instance, stdin, KEYS.enter); // Step 2 -> Step 3 (branch lists load)
      await settle(instance);
      await press(instance, stdin, KEYS.ctrlN); // Step 3 -> Step 4 (Enter never advances Step 3)
      // Meanwhile an EDT named "demo" appears (e.g. created from the CLI).
      store.setState({ edts: [edt({ ulid: 'cli-ulid', topic: 'demo' })] });
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter); // submit attempt

      expect(createCalls).toBe(0);
      expect(stdout.output).toContain('Ce nom est déjà pris par un autre EDT');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('story 2.36 matrix: an empty (or blank) name blocks Step 1 with an inline message', async () => {
    const store = createAppStore();
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      edtsBranches: [{ service: 'svc-a', path: '/repos/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' }],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await type(instance, stdin, '   ');
      await press(instance, stdin, KEYS.enter);
      expect(stdout.output).toContain('Le nom ne doit pas être vide');
      expect(stdout.output).not.toContain('▶ 2. Services ◀');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Review patch (story 2.9): the create prompt's Escape used to be unconditionally inert,
  // reasoning the forced zero-EDT state has nothing to cancel to — but that also meant `q`
  // (blocked by zoneInputCaptured) and Escape both did nothing, trapping the user with no
  // way to quit short of Ctrl+C (which skips onQuit's lock release).
  it('Escape requests a quit when the create prompt is the forced, genuinely-empty-registry state', async () => {
    const store = createAppStore();
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });

    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      // The create-prompt-auto-open effect fires as a passive effect after the first
      // commit — a second flush lets it settle (same precedent as the zoneInputCaptured
      // test above) before Escape is meant to land inside the create dialog.
      await instance.waitUntilRenderFlush();
      expect(store.getState().quitRequested).toBe(false);

      await pressEscape(instance, stdin);

      expect(store.getState().quitRequested).toBe(true);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Escape cancels back to the list (never requests a quit) once an EDT list actually exists', async () => {
    const store = createAppStore();
    const target = edt({ ulid: 'target-ulid', topic: 'other' });
    store.setState({
      edts: [target],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [{ service: 'svc-a', path: '/repos/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' }],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });

    // `initialDialogKind: 'create'` (a test-only injection point, mirroring the smoke tests'
    // own use of it) forces the dialog open despite `edts` being non-empty — the only way to
    // reach this branch outside the partial-failure-after-create path covered above, since
    // production never gives the populated view its own "new EDT" affordance yet
    // (deferred-work.md).
    const { instance, stdin } = mount(store, { initialDialogKind: 'create' });
    try {
      await instance.waitUntilRenderFlush();
      expect(store.getState().quitRequested).toBe(false);

      await pressEscape(instance, stdin);

      expect(store.getState().quitRequested).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});

// ==========================================================================================
// Story 2.29 — delete an EDT (real-keypress coverage: toggling a member's disposition and
// confirming/cancelling are only exercisable through a real Ink useInput round-trip).
// ==========================================================================================

describe('EdtsZone real-keypress interactions (story 2.29, delete an EDT)', () => {
  it('confirms deletion with the default (all "leave") dispositions when nothing is toggled', async () => {
    const store = createAppStore();
    const target = edt({
      ulid: 'target-ulid',
      topic: 'demo',
      members: [{ service: 'svc-a', repoPath: '/repo/a', branch: 'feat/a' }],
    });
    const deleteCalls: Array<{ topic: string; dispositions: Record<string, 'leave' | 'delete'> }> = [];
    store.setState({
      edts: [target],
      edtsStatus: 'idle',
      activeEdt: null,
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      resolveMemberDeleteStatuses: async () => [{ repoPath: '/repo/a', service: 'svc-a', branch: 'feat/a', merged: false, clean: true }],
      deleteEdt: async (params) => {
        deleteCalls.push(params);
        return { ok: true, data: { ulid: target.ulid, topic: target.topic, results: [{ service: 'svc-a', outcome: 'left' }] } };
      },
    });

    const { instance, stdout, stdin } = mount(store, { initialDialogKind: 'delete-confirm' });
    try {
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('DELETE EDT');
      expect(stdout.output).toContain('svc-a');

      await press(instance, stdin, KEYS.enter); // confirm
      await instance.waitUntilRenderFlush();

      expect(deleteCalls).toEqual([{ topic: 'demo', dispositions: { '/repo/a': 'leave' } }]);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Space toggles a member row to "delete" before confirming', async () => {
    const store = createAppStore();
    const target = edt({
      ulid: 'target-ulid',
      topic: 'demo',
      members: [{ service: 'svc-a', repoPath: '/repo/a', branch: 'feat/a' }],
    });
    const deleteCalls: Array<{ topic: string; dispositions: Record<string, 'leave' | 'delete'> }> = [];
    store.setState({
      edts: [target],
      edtsStatus: 'idle',
      activeEdt: null,
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      resolveMemberDeleteStatuses: async () => [{ repoPath: '/repo/a', service: 'svc-a', branch: 'feat/a', merged: false, clean: true }],
      deleteEdt: async (params) => {
        deleteCalls.push(params);
        return { ok: true, data: { ulid: target.ulid, topic: target.topic, results: [{ service: 'svc-a', outcome: 'deleted' }] } };
      },
    });

    const { instance, stdin } = mount(store, { initialDialogKind: 'delete-confirm' });
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, KEYS.space); // toggle svc-a to "delete"
      await press(instance, stdin, KEYS.enter); // confirm
      await instance.waitUntilRenderFlush();

      expect(deleteCalls).toEqual([{ topic: 'demo', dispositions: { '/repo/a': 'delete' } }]);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a per-branch collision (branch-owned-by-other-edt) renders as a plain line, never a "try a different branch" retry action', async () => {
    const store = createAppStore();
    const target = edt({
      ulid: 'target-ulid',
      topic: 'demo',
      members: [{ service: 'svc-a', repoPath: '/repo/a', branch: 'feat/a' }],
    });
    store.setState({
      edts: [target],
      edtsStatus: 'idle',
      activeEdt: null,
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      resolveMemberDeleteStatuses: async () => [{ repoPath: '/repo/a', service: 'svc-a', branch: 'feat/a', merged: true, clean: true }],
      deleteEdt: async () => ({
        ok: true,
        data: {
          ulid: target.ulid,
          topic: target.topic,
          results: [{ service: 'svc-a', outcome: 'failed', detail: { code: 'branch-owned-by-other-edt', message: 'Branch already claimed' } }],
        },
      }),
    });

    const { instance, stdout, stdin } = mount(store, { initialDialogKind: 'delete-confirm' });
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, KEYS.enter); // confirm (default: merged+clean -> "delete")
      await instance.waitUntilRenderFlush();

      expect(stdout.output).toContain('Branch already claimed');
      expect(stdout.output).not.toContain('try a different branch');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Escape cancels the delete-confirm dialog without ever calling deleteEdt', async () => {
    const store = createAppStore();
    const target = edt({ ulid: 'target-ulid', topic: 'demo' });
    let deleteCalls = 0;
    store.setState({
      edts: [target],
      edtsStatus: 'idle',
      activeEdt: null,
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      resolveMemberDeleteStatuses: async () => [],
      deleteEdt: async () => {
        deleteCalls += 1;
        return { ok: true, data: { ulid: target.ulid, topic: target.topic, results: [] } };
      },
    });

    const { instance, stdin } = mount(store, { initialDialogKind: 'delete-confirm' });
    try {
      await instance.waitUntilRenderFlush();

      await pressEscape(instance, stdin);

      expect(deleteCalls).toBe(0);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // I/O matrix: "Delete the active EDT" -> rejected before any write, never auto-switched —
  // only Escape is ever offered, Enter/Space are inert.
  it('rejects the active EDT: Enter/Space are inert, only Escape closes the dialog', async () => {
    const store = createAppStore();
    const target = edt({ ulid: 'active-ulid', topic: 'demo' });
    let deleteCalls = 0;
    let statusCalls = 0;
    store.setState({
      edts: [target],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      resolveMemberDeleteStatuses: async () => {
        statusCalls += 1;
        return [];
      },
      deleteEdt: async () => {
        deleteCalls += 1;
        return { ok: true, data: { ulid: target.ulid, topic: target.topic, results: [] } };
      },
    });

    const { instance, stdout, stdin } = mount(store, { initialDialogKind: 'delete-confirm-rejected' });
    try {
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('active EDT');

      await press(instance, stdin, KEYS.space);
      await press(instance, stdin, KEYS.enter);
      await instance.waitUntilRenderFlush();

      expect(deleteCalls).toBe(0);
      // Never even fetches member statuses — there is nothing to disposition (Boundaries:
      // "reject before any git/file write").
      expect(statusCalls).toBe(0);

      await pressEscape(instance, stdin);
      expect(store.getState().currentEdtAction).toBeNull();
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});

// ==========================================================================================
// Story 2.18 — active highlight, 3-way pane cycle, EDT SERVICES/OTHER SERVICES contextual
// actions (real-keypress coverage: the Tab cycle, dialog opens, and async submits below are
// only exercisable through a real Ink useInput round-trip — see the file header).
// ==========================================================================================

describe('EdtsZone real-keypress interactions (story 2.18)', () => {
  it('Tab cycles edts -> edt-services -> other-services -> edts (AC: 3-way base-view cycle)', async () => {
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
        { service: 'svc-a', path: '/repos/a', isMember: true, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' },
        { service: 'svc-b', path: '/repos/b', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' },
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
        { service: 'svc-a', path: '/repos/a', isMember: true, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' },
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
        { service: 'svc-a', path: '/repos/a', isMember: true, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      // Story 2.26: Pick existing over the repo's own real branch list is the simplest path
      // to a plain 'set' outcome (no store-action pre-step, unlike Create new/Rename current).
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

  it('Change branch for this EDT via Rename current reaches modifyEdt via renameBranches, not setBranches (story 2.26 verification gap)', async () => {
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
        { service: 'svc-a', path: '/repos/a', isMember: true, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' },
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

  it('matrix: Change branch, empty value -> inline rejection, never reaches modifyEdt', async () => {
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
        { service: 'svc-a', path: '/repos/a', isMember: true, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' },
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
        { service: 'svc-a', path: '/repos/a', isMember: true, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' },
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
        { service: 'svc-b', path: '/repos/b', isMember: false, branch: 'feature-y', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      // Story 2.26: Pick existing (one Tab away from the picker's Create-new default, since
      // Add-to-EDT never offers Rename current) over the repo's own real branch list lets this
      // test confirm the pre-filled candidate with a single select+confirm — no store-action
      // pre-step (no `createMemberBranch` mock needed) unlike Create-new's own path.
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

  it('matrix: Add-to-EDT partial failure surfaces inline via summarizeFailedResults, logged failed', async () => {    const active = edt({ ulid: 'active-ulid', topic: 'active-edt', status: 'active', members: [] });
    let loggedOutcome: string | undefined;
    const store = createAppStore();
    store.setState({
      edts: [active],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [
        { service: 'svc-b', path: '/repos/b', isMember: false, branch: 'feature-y', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' },
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
        edts: { ...store.getState().settings.edts, branchDropdownMaxRows: 2 },
      },
      edts: [active],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [
        { service: 'svc-b', path: '/repos/b', isMember: false, branch: 'svc-branch', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      listBranches: async () => ({ ok: true, data: ['b-one', 'b-two', 'b-three'] }),
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
      expect(stdout.output).toContain('… 1 more');
      expect(stdout.output).not.toContain('b-three');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Review fix: submitRemoveFromEdt implements the same per-repo summarizeFailedResults
  // partial-failure handling as submitAddToEdt above — this was previously only covered for
  // Add-to-EDT.
  it('matrix: Remove-from-EDT partial failure surfaces inline via summarizeFailedResults, logged failed', async () => {
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
        { service: 'svc-a', path: '/repos/a', isMember: true, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' },
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

  // Review fix: submitServiceActionsBranchChange implements the same partial-failure
  // handling too — previously only covered for Add-to-EDT.
  it('matrix: Change-branch partial failure surfaces inline via summarizeFailedResults, logged failed', async () => {
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
        { service: 'svc-a', path: '/repos/a', isMember: true, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' },
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

  // Story 2.27 code review (patch): the picker's "Create new" default base branch for
  // service-actions' real git-write flow is this repo's own manifest-declared sharedBranch,
  // never DEFAULT_BASE_BRANCH — asserts the actual `base` argument delivered to
  // createMemberBranch, using a sharedBranch that differs from 'development' so this is
  // distinguishable from the old hardcoded literal (every pre-existing fixture used
  // 'development', identical to the literal, so a regression there wouldn't have failed any
  // test).
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
      edts: [active],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [{ service: 'svc-a', path: '/repos/a', isMember: true, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'release' }],
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

  // Story 2.25 -----------------------------------------------------------------------------
  // "Assisted resolution" for the one registered failure code, branch-owned-by-other-edt —
  // a per-repo structured line (never joined), an inline "[Enter] try a different branch"
  // affordance, and confirming the reopened branch-edit re-runs the same submit function.
  // Story 2.26 amendment: staged via a not-yet-member candidate (svc-b) rather than the
  // existing svc-a — Enter on an already-a-member row no longer opens the branch-picker at
  // all (see the dedicated amendment test above), but the retry mechanics under test here
  // (findRetryableFailedRow, reopen-prefilled, re-submit) are identical either way.
  it('matrix: branch-owned-by-other-edt in Modify shows "try a different branch"; retry reopens pre-filled and re-submits', async () => {
    const active = edt({
      ulid: 'active-ulid',
      topic: 'active-edt',
      status: 'active',
      members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }],
    });
    const modifyCalls: ModifyEdtParams[] = [];
    const store = createAppStore();
    store.setState({
      edts: [active],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [
        { service: 'svc-a', path: '/repos/a', isMember: true, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' },
        { service: 'svc-b', path: '/repos/b', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      // Story 2.26: Create new's pre-step for a brand-new name — mocked to succeed so the
      // picker's staging (and the retry's own re-staging) reaches modifyEdt at all.
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
      await press(instance, stdin, KEYS.enter); // advance base -> name (pre-filled "main")
      for (let i = 0; i < 'main'.length; i += 1) {
        await press(instance, stdin, KEYS.backspace);
      }
      await type(instance, stdin, 'feature-y');
      await press(instance, stdin, KEYS.enter); // commit (create pre-step + stage), back to the form
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

  // Story 2.26 amendment: staged via a not-yet-member candidate (svc-b) rather than the
  // existing svc-a — see the comment on the branch-owned-by-other-edt matrix test above for
  // why.
  it('matrix: branch-exists in Modify shows "try a different name"; retry reopens pre-filled and re-submits (story 2.26, no prior end-to-end coverage)', async () => {
    const active = edt({
      ulid: 'active-ulid',
      topic: 'active-edt',
      status: 'active',
      members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }],
    });
    const modifyCalls: ModifyEdtParams[] = [];
    const store = createAppStore();
    store.setState({
      edts: [active],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [
        { service: 'svc-a', path: '/repos/a', isMember: true, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' },
        { service: 'svc-b', path: '/repos/b', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' },
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
      await press(instance, stdin, KEYS.enter); // advance base -> name (pre-filled "main")
      for (let i = 0; i < 'main'.length; i += 1) {
        await press(instance, stdin, KEYS.backspace);
      }
      await type(instance, stdin, 'feature-y');
      await press(instance, stdin, KEYS.enter); // commit (create pre-step + stage), back to the form
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

  it('matrix: branch-owned-by-other-edt in service-actions "Change branch" shows the retry affordance; retry reopens pre-filled and re-submits', async () => {
    const active = edt({
      ulid: 'active-ulid',
      topic: 'active-edt',
      status: 'active',
      members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }],
    });
    const modifyCalls: ModifyEdtParams[] = [];
    const store = createAppStore();
    store.setState({
      edts: [active],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [
        { service: 'svc-a', path: '/repos/a', isMember: true, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      // Story 2.26: Create new's pre-step for a brand-new name — mocked to succeed so the
      // picker's staging (and the retry's own re-staging) reaches modifyEdt at all.
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

  it('matrix: branch-owned-by-other-edt in Add-to-EDT shows the retry affordance; the already-focused field re-submits on Enter', async () => {
    const active = edt({ ulid: 'active-ulid', topic: 'active-edt', status: 'active', members: [] });
    const modifyCalls: ModifyEdtParams[] = [];
    const store = createAppStore();
    store.setState({
      edts: [active],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [
        { service: 'svc-b', path: '/repos/b', isMember: false, branch: 'feature-y', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      // Story 2.26: Create new's pre-step for the picker's default suggestion — mocked to
      // succeed so the flow reaches modifyEdt, which is what actually rejects the name here.
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

  // Never boundary: Create/Switch never wire the retry action, even for this exact code —
  // resolveMemberBranch never passes edtId to assertAllowedBranch at create time, and
  // switchActiveEdt carries no per-member branch override to retry into. Both still get the
  // plain structured line, matching the "no registered action" treatment for an unregistered
  // code (AC2).
  it('matrix: branch-owned-by-other-edt inside a Create result renders a plain line — no retry affordance', async () => {
    const store = createAppStore();
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      edtsBranches: [{ service: 'svc-a', path: '/repos/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' }],
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

  it('matrix: branch-owned-by-other-edt inside a Switch result renders a plain line — no retry affordance', async () => {
    const store = createAppStore();
    const target = edt({ ulid: 'target-ulid', topic: 'other' });
    store.setState({
      edts: [target],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
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
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Review fix: no test previously exercised Escape/cancel for either new dialog, or backing
  // out of the branch-edit sub-view via Escape.
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
        { service: 'svc-a', path: '/repos/a', isMember: true, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' },
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
      // "rejects an empty branch-edit value inline" test in the story 2.9 suite above).
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
        { service: 'svc-a', path: '/repos/a', isMember: true, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' },
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
      expect(stdout.output).toContain('[Tab] switch mode');

      // Only the output *written since* Escape proves the menu is back in the *current*
      // render, not merely present somewhere earlier in the accumulated log (same technique
      // as the story 2.9 suite's "rejects an empty branch-edit value inline" test above).
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
        { service: 'svc-b', path: '/repos/b', isMember: false, branch: 'feature-y', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' },
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
      // Story 2.26: the picker's own async branches-fetch settling can still land a render
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

  // Review fix: the `undefined` guards in the base-view Enter dispatch for EDT
  // SERVICES/OTHER SERVICES (protecting against opening a dialog for a row that doesn't
  // exist) were previously unverified — Enter on an empty pane must be a no-op.
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
        { service: 'svc-b', path: '/repos/b', isMember: false, branch: 'feature-y', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' },
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
        { service: 'svc-a', path: '/repos/a', isMember: true, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' },
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

// ==========================================================================================
// Story 2.30 — EDT quick-pick: edt-switch/edt-modify/edt-delete run with no argument now open
// a shared filterable, arrow-navigable list instead of guessing a target (the old "first
// non-active EDT" / focused-row fallbacks). Driven here exactly like the real command bar
// drives it — setting `currentEdtAction` with the `target: 'select EDT'` sentinel the store's
// openEdt*Dialog actions already produce (edt-slice.ts, untouched by this story) — so the
// zone's own `currentEdtAction` effect is the thing under test, not a seeded dialog state.
// ==========================================================================================

describe('EdtsZone quick-pick dialog (story 2.30)', () => {
  it('edt-switch with no argument opens quick-pick(switch), excluding the active EDT from the candidate pool', async () => {
    const active = edt({ ulid: 'active-ulid', topic: 'active-work', status: 'active' });
    const other = edt({ ulid: 'other-ulid', topic: 'other-work' });
    const store = createAppStore();
    store.setState({
      edts: [active, other],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      currentEdtAction: { type: 'switch', target: 'select EDT', startedAt: new Date().toISOString() },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('Filter');
      // The quick-pick dialog's own title ("SWITCH EDT — SELECT") legitimately contains the
      // substring "SWITCH EDT" — assert against the switch-confirm dialog's distinguishing
      // confirm prompt instead, which only switch-dialog.tsx itself ever renders.
      expect(stdout.output).not.toContain('Switch to "');

      // Boundary regression: `active` sorts first in `edts`, so a default row cursor of 0
      // landing on it here would prove the active EDT was wrongly left in the pool.
      // `other-work` is the only reachable row instead.
      await press(instance, stdin, KEYS.enter);
      expect(stdout.output).toContain('Switch to "other-work"');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('edt-modify with no argument opens quick-pick(modify), filtering over every EDT (active included)', async () => {
    const active = edt({ ulid: 'active-ulid', topic: 'active-work', status: 'active' });
    const other = edt({ ulid: 'other-ulid', topic: 'other-work' });
    const store = createAppStore();
    store.setState({
      edts: [active, other],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      currentEdtAction: { type: 'modify', target: 'select EDT', startedAt: new Date().toISOString() },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('Filter');
      expect(stdout.output).toContain('active-work');
      expect(stdout.output).toContain('other-work');

      // Unlike switch, the active EDT is a reachable row here — the default cursor (0, the
      // pool's first entry) lands on it.
      await press(instance, stdin, KEYS.enter);
      expect(stdout.output).toContain('MODIFY EDT');
      expect(stdout.output).toContain('Topic: active-work');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('edt-delete with no argument opens quick-pick(delete); selecting the active EDT surfaces the existing rejection message', async () => {
    const active = edt({ ulid: 'active-ulid', topic: 'active-work', status: 'active' });
    const store = createAppStore();
    store.setState({
      edts: [active],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      currentEdtAction: { type: 'delete', target: 'select EDT', startedAt: new Date().toISOString() },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('Filter');

      await press(instance, stdin, KEYS.enter);
      // `stdout.output` accumulates every frame ever written, including the quick-pick's own
      // filter field (whose focused TextInputLine always renders a "[Enter] confirm" hint) —
      // scope the "no confirm affordance" assertion to the last-rendered frame (found from the
      // last occurrence of the DELETE EDT title, which the rejected dialog's own frame is the
      // most recent one to render), the same technique this file's other real-keypress tests
      // already use for a "this chrome is gone now" assertion.
      const rejectedFrame = stdout.output.slice(stdout.output.lastIndexOf('DELETE EDT'));
      expect(rejectedFrame).toContain('DELETE EDT');
      // The existing story 2.29 rejection message — unchanged, just reached via the picker.
      expect(rejectedFrame).toContain('active EDT');
      expect(rejectedFrame).toContain('cancel');
      expect(rejectedFrame).not.toContain('confirm');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Esc closes the quick-pick from any mode with no dialog opened', async () => {
    const other = edt({ ulid: 'other-ulid', topic: 'other-work' });
    const store = createAppStore();
    store.setState({
      edts: [other],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      currentEdtAction: { type: 'switch', target: 'select EDT', startedAt: new Date().toISOString() },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('Filter');

      // `stdout.output` accumulates every frame ever written, so a `.not.toContain` against
      // the whole log would vacuously pass even if Escape did nothing — only the output
      // *written since* Escape proves the dialog is actually gone from the current render.
      const outputLengthBeforeEscape = stdout.output.length;
      await pressEscape(instance, stdin);
      const outputSinceEscape = stdout.output.slice(outputLengthBeforeEscape);

      expect(outputSinceEscape).not.toContain('Filter');
      expect(outputSinceEscape).not.toContain('SWITCH EDT — SELECT');
      // The base EDT-list hint line — hidden while any dialog is open — is back.
      expect(outputSinceEscape).toContain('[Enter] switch/modify');
      expect(store.getState().currentEdtAction).toBeNull();
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a real-keypress filter narrows the matches and Enter opens the exact pre-targeted dialog the topic-supplied path would', async () => {
    const alpha = edt({ ulid: 'alpha-ulid', topic: 'alpha' });
    const alphabet = edt({ ulid: 'alphabet-ulid', topic: 'alphabet' });
    const beta = edt({ ulid: 'beta-ulid', topic: 'beta' });
    const store = createAppStore();
    store.setState({
      edts: [alpha, alphabet, beta],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      currentEdtAction: { type: 'modify', target: 'select EDT', startedAt: new Date().toISOString() },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await type(instance, stdin, 'alpha');
      // The base EDTS list (always rendered underneath the dialog, regardless of quick-pick
      // filtering) also lists 'beta' by topic — a whole-output `.not.toContain('beta')` would
      // therefore be meaningless. Scope the "filtered out of the picker's own row list"
      // assertion to the dialog box's own last-rendered frame (from its most recent "╔"
      // border onward) instead.
      const dialogFrame = stdout.output.slice(stdout.output.lastIndexOf('╔'));
      expect(dialogFrame).toContain('alpha');
      expect(dialogFrame).toContain('alphabet');
      expect(dialogFrame).not.toContain('beta');

      // Down moves the row cursor onto 'alphabet' (the filtered pool's second match) — the
      // decisive proof the filter actually narrowed the *navigable* pool, not just the text
      // shown: if 'beta' had stayed in the pool ahead of 'alphabet', or filtering hadn't
      // applied at all, this Enter would target a different EDT than 'alphabet'.
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.enter);

      expect(stdout.output).toContain('MODIFY EDT');
      expect(stdout.output).toContain('Topic: alphabet');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('AC: a filter matching zero EDTs shows an explicit "No matching EDT" state, never a silently-empty list', async () => {
    const other = edt({ ulid: 'other-ulid', topic: 'other-work' });
    const store = createAppStore();
    store.setState({
      edts: [other],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      currentEdtAction: { type: 'switch', target: 'select EDT', startedAt: new Date().toISOString() },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await type(instance, stdin, 'zzz');

      expect(stdout.output).toContain('No matching EDT');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a pure caret move on the filter field leaves the row cursor unchanged, even after it was moved off the top match', async () => {
    const alpha = edt({ ulid: 'alpha-ulid', topic: 'alpha' });
    const alphabet = edt({ ulid: 'alphabet-ulid', topic: 'alphabet' });
    const store = createAppStore();
    store.setState({
      edts: [alpha, alphabet],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      currentEdtAction: { type: 'modify', target: 'select EDT', startedAt: new Date().toISOString() },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      // Narrow to 2 matches, then move the row cursor off the top match onto 'alphabet'.
      await type(instance, stdin, 'alpha');
      await press(instance, stdin, KEYS.down);

      // A pure caret move (Left, then Home) on the filter text: `edited.value` stays
      // 'alpha' throughout, so per the `nextCursor = edited.value === current.query ?
      // current.cursor : 0` branch, the row cursor must survive both — never reset to 0.
      await press(instance, stdin, KEYS.left);
      await press(instance, stdin, KEYS.home);

      // Decisive proof: Enter still targets 'alphabet' (the row the cursor was moved to),
      // not 'alpha' (what a wrongly-reset cursor of 0 would target).
      await press(instance, stdin, KEYS.enter);

      expect(stdout.output).toContain('MODIFY EDT');
      expect(stdout.output).toContain('Topic: alphabet');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Enter while the filter matches zero EDTs is a safe no-op: dialog stays open on "No matching EDT"', async () => {
    const other = edt({ ulid: 'other-ulid', topic: 'other-work' });
    const store = createAppStore();
    store.setState({
      edts: [other],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      currentEdtAction: { type: 'switch', target: 'select EDT', startedAt: new Date().toISOString() },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await type(instance, stdin, 'zzz');
      expect(stdout.output).toContain('No matching EDT');

      await press(instance, stdin, KEYS.enter);

      // No dialog transition, no crash: the quick-pick stays open on its own "No matching
      // EDT" state — the switch-confirm dialog's distinguishing prompt never appears, and
      // the picker's own filter field ("Filter") is still what's rendered.
      expect(stdout.output).not.toContain('Switch to "');
      expect(stdout.output).toContain('No matching EDT');
      expect(stdout.output).toContain('Filter');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('edt-switch/modify/delete with a topic supplied stay unchanged: pre-targeted dialog opens directly, no quick-pick', async () => {
    const target = edt({ ulid: 'target-ulid', topic: 'demo' });
    const store = createAppStore();
    store.setState({
      edts: [target],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      currentEdtAction: { type: 'switch', target: 'demo', startedAt: new Date().toISOString() },
    });

    const { instance, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('SWITCH EDT');
      expect(stdout.output).not.toContain('Filter');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});
