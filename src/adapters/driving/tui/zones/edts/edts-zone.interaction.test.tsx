// tui/zones/edts: real-keypress coverage (shared/test-support/fake-tty.ts) for what renderToString
// cannot drive — async submit/confirm/force-switch paths, the zoneInputCaptured gate, the dialogs'
// keystroke routing and the create wizard — through Ink's own keypress parser, no pty required.
import { createElement } from 'react';
import { render } from 'ink';
import { describe, it, expect, vi } from 'vitest';
import type { EdtRegistryEntry } from '../../../../../core/ports/edt-registry.js';
import type { Result } from '../../../../../core/result.js';
import type { ActivateEdtData } from '../../../../../core/edt/activate.js';
import type { CreateCandidateBranches, CreateEdtData } from '../../../../../core/edt/create.js';
import type { SwitchActiveEdtData, SwitchDirtyReposChoice } from '../../../../../core/edt/switch.js';
import type { ModifyEdtData } from '../../../../../core/edt/modify.js';
import { createAppStore, type CreateEdtParams, type ModifyEdtParams } from '../../store/app-store.js';
import { fakeInteractiveTtyStdin, FakeTtyStdout, KEYS } from '../../shared/test-support/fake-tty.js';
import { EdtsZone } from './edts-zone.js';
import { CREATE_WIZARD_TITLE as WIZARD_TITLE } from './dialogs/create-wizard/create-wizard.js';
import { footerIdOf } from '../../shared/test-support/mount-for-test.js';

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

// Step 3 loads each selected service's branch lists on entry (never fetching).
type ListsResult = Result<CreateCandidateBranches>;
const readyBranches = async (): Promise<ListsResult> => ({ ok: true, data: { local: ['main', 'development'], remote: [] } });

// Lets the async list loads settle (a resolved promise, then React's commit).
async function settle(instance: ReturnType<typeof render>): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await instance.waitUntilRenderFlush();
}

// The picker fetches its branch list in an effect after it opens; Enter on the base field waits for it.
async function settleBranches(instance: ReturnType<typeof render>): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await settle(instance);
  }
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
    // Manifest fixtures — each service's manifest lists its own protected branches.
    edtsBranches: [
      { service: 'svc-a', path: '/repos/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'main', protectedBranches: ['development', 'preprod', 'prod'] },
      { service: 'svc-b', path: '/repos/b', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: ['preprod', 'prod'] },
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

describe('EdtsZone real-keypress interactions', () => {
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
  it('←/→ changes the post-switch restart mode for this switch only; Enter switches, then runs the restart phase with it', async () => {
    const store = createAppStore();
    const target = edt({ ulid: 'target-ulid', topic: 'other' });
    const restartCalls: Array<{ topic: string; mode: string }> = [];
    const logged: string[] = [];
    store.setState({
      edts: [target],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      logEdtAction: async (_ulid, _type, _outcome, detail) => {
        logged.push(detail);
      },
      switchEdt: async (): Promise<Result<SwitchActiveEdtData>> => ({
        ok: true,
        data: { ulid: target.ulid, topic: target.topic, results: [{ service: 'svc-a', outcome: 'switched' }], wasInterrupted: false },
      }),
      runSwitchRestart: async ({ topic, mode }) => {
        restartCalls.push({ topic, mode });
        const report = {
          mode,
          rows: [{ service: 'svc-a', repoPath: '/repo/a', phase: 'unhealthy' as const, detail: 'HTTP 503' }],
          summary: { functional: 0, 'up-unverified': 0, unhealthy: 1, restarting: 0, down: 0, failed: 0, skipped: 0 },
        };
        return { ok: true, data: report };
      },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter);
      expect(stdout.output).toContain('(•) Aucun');

      await press(instance, stdin, KEYS.right);
      expect(stdout.output).toContain('(•) Redémarrage simple');
      await press(instance, stdin, KEYS.right);
      expect(stdout.output).toContain('(•) Clean restart');
      await press(instance, stdin, KEYS.left);

      await press(instance, stdin, KEYS.enter);
      await settle(instance);
      expect(restartCalls).toEqual([{ topic: 'other', mode: 'simple' }]);
      // Never written back to the setting.
      expect(store.getState().settings.switch.restartMode).toBe('none');
      // The action log records the mode and every service's final state.
      expect(logged.some((line) => line.includes('restart simple: svc-a=unhealthy'))).toBe(true);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('with the default mode none the switch runs no restart phase and shows no restart UI', async () => {
    const store = createAppStore();
    const target = edt({ ulid: 'target-ulid', topic: 'other' });
    let restartCalls = 0;
    store.setState({
      edts: [target],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      logEdtAction: async () => {},
      switchEdt: async (): Promise<Result<SwitchActiveEdtData>> => ({
        ok: true,
        data: { ulid: target.ulid, topic: target.topic, results: [{ service: 'svc-a', outcome: 'switched' }], wasInterrupted: false },
      }),
      runSwitchRestart: async () => {
        restartCalls += 1;
        return { ok: false, error: { code: 'x', message: 'x' } };
      },
    });
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.enter);
      await settle(instance);
      expect(restartCalls).toBe(0);
      expect(stdout.output).not.toContain('Restarting services');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // When a service outside the outgoing EDT is dirty, the switch dialog shows the two-panel
  // resolution view. These fakes drive the same store fields (switchDirtyRepos /
  // resolveSwitchDirtyRepos) edt-slice.ts's real seam does — the end-to-end wiring through
  // core/edt/switch.ts is covered by edt-slice.test.ts; these cover the dialog's rendering and
  // keystroke routing.
  function resolutionStore(options: {
    activeTopic?: string | null;
    localBranches?: Record<string, string[]>;
    results?: SwitchActiveEdtData['results'];
  } = {}) {
    const store = createAppStore();
    const target = edt({ ulid: 'target-ulid', topic: 'other' });
    const outgoing = edt({ ulid: 'outgoing-ulid', topic: 'Mon Topic', status: 'active' });
    const hasOutgoing = options.activeTopic !== null;
    const log: Array<{ ulid: string; outcome: string; detail: string }> = [];
    const probe = { switchCalls: 0, resolvedWith: null as SwitchDirtyReposChoice | null, resolutions: [] as SwitchDirtyReposChoice[], log };
    store.setState({
      edts: hasOutgoing ? [target, outgoing] : [target],
      edtsStatus: 'idle',
      activeEdt: hasOutgoing ? outgoing.ulid : null,
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      loadEdtActionLog: async () => {},
      logEdtAction: async (ulid, _actionType, outcome, detail) => {
        log.push({ ulid, outcome, detail });
      },
      listBranches: async (repoPath) => ({ ok: true, data: options.localBranches?.[repoPath] ?? ['development'] }),
      switchEdt: async (): Promise<Result<SwitchActiveEdtData>> => {
        probe.switchCalls += 1;
        store.setState({
          switchDirtyRepos: [
            { service: 'svc-payments', repoPath: '/repo/payments', scope: 'non-member', currentBranch: 'development', currentBranchShared: true, sharedBranch: 'development', protectedBranches: [], owningEdtTopics: [], dirtyPaths: ['pay.ts', 'tmp/new.txt'] },
            { service: 'svc-billing', repoPath: '/repo/billing', scope: 'member-of-other-edt', currentBranch: 'feat/x', currentBranchShared: false, sharedBranch: 'development', protectedBranches: [], owningEdtTopics: ['third'], dirtyPaths: ['bill.ts'] },
            { service: 'svc-orders', repoPath: '/repo/orders', scope: 'outgoing-member', currentBranch: 'feat/o', currentBranchShared: false, sharedBranch: 'development', protectedBranches: [], owningEdtTopics: [], resolution: 'auto-stash' },
          ],
        });
        const choice = await new Promise<SwitchDirtyReposChoice>((resolve) => {
          store.setState({
            resolveSwitchDirtyRepos: (c) => {
              probe.resolvedWith = c;
              probe.resolutions.push(c);
              store.setState({ switchDirtyRepos: null });
              resolve(c);
            },
          });
        });
        if (choice.kind === 'cancel') {
          return { ok: false, error: { code: 'switch-cancelled-by-user', message: 'Switch to "other" cancelled: uncommitted changes were present' } };
        }
        return { ok: true, data: { ulid: target.ulid, topic: target.topic, results: options.results ?? [], wasInterrupted: false } };
      },
    });
    return { store, probe };
  }

  async function openResolution(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream): Promise<void> {
    await instance.waitUntilRenderFlush();
    await press(instance, stdin, KEYS.enter); // open switch-confirm on the focused (non-active) EDT
    await press(instance, stdin, KEYS.enter); // confirm switch -> raises the seam
    await settle(instance); // the view initializes and the local branch lists load
    await settle(instance);
  }

  it('the resolution view shows the intro, both panels and the footer; a global adopt proceeds with 2 adopt resolutions and shows the results', async () => {
    const { store, probe } = resolutionStore({
      results: [
        { service: 'svc-payments', outcome: 'adopted', detail: { code: 'adopted', message: 'ok', adoptedBranch: 'mon-topic' } },
        { service: 'svc-billing', outcome: 'adopted', detail: { code: 'adopted', message: 'ok', adoptedBranch: 'feat/x' } },
        { service: 'svc-orders', outcome: 'switched' },
      ],
    });
    const { instance, stdout, stdin } = mount(store);
    try {
      await openResolution(instance, stdin);

      expect(stdout.output).toContain("You are leaving the EDT “Mon Topic”");
      expect(stdout.output).toContain('GLOBAL STRATEGY');
      expect(stdout.output).toContain('AFFECTED SERVICES');
      expect(stdout.output).toContain('Default action: (•) Adopt into Mon Topic  ( ) Discard');
      expect(stdout.output).toContain('Global branch name');
      expect(stdout.output).toContain('mon-topic');
      expect(footerIdOf(store)).toBe('switch-resolution');
      expect(stdout.output).toContain('outside any EDT');
      expect(stdout.output).toContain('member of third');
      expect(stdout.output).toContain('[Adopt (Global)]');
      expect(stdout.output).toContain('svc-orders — will be stashed for Mon Topic (restored on return)');

      await press(instance, stdin, KEYS.ctrlN);
      await settle(instance);
      await settle(instance);

      expect(probe.switchCalls).toBe(1);
      expect(probe.resolvedWith).toEqual({
        kind: 'proceed',
        resolutions: { '/repo/payments': { kind: 'adopt', branch: 'mon-topic' }, '/repo/billing': { kind: 'adopt', branch: 'feat/x' } },
      });
      // Results stay on screen; the log goes to the NEW active EDT with the adopted branches.
      expect(stdout.output).toContain('svc-payments — adopted on mon-topic');
      expect(probe.log).toEqual([{ ulid: 'target-ulid', outcome: 'success', detail: expect.stringContaining('svc-payments → mon-topic') }]);

      expect(store.getState().zoneInputCaptured).toBe(true);
      await press(instance, stdin, KEYS.enter); // Enter closes the results
      await settle(instance);
      expect(store.getState().zoneInputCaptured).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a Discard strategy asks a second confirmation listing the files; Enter goes back, Ctrl+E proceeds with discards', async () => {
    const { store, probe } = resolutionStore();
    const { instance, stdout, stdin } = mount(store);
    try {
      await openResolution(instance, stdin);
      await press(instance, stdin, KEYS.space); // Panel A: Adopt -> Discard
      await press(instance, stdin, KEYS.ctrlN);

      expect(stdout.output).toContain("CONFIRM OVERWRITE");
      expect(stdout.output).toContain('svc-payments (2 file(s))');
      expect(stdout.output).toContain('tmp/new.txt');
      expect(stdout.output).toContain('bill.ts');
      expect(stdout.output).toContain('cannot be undone');
      expect(stdout.output).toContain('ignored by git');
      expect(stdout.output).toContain('kept');

      await press(instance, stdin, KEYS.enter); // default: back
      await settle(instance);
      expect(probe.resolvedWith).toBeNull();

      await press(instance, stdin, KEYS.ctrlN);
      await press(instance, stdin, KEYS.ctrlE);
      await settle(instance);
      await settle(instance);

      expect(probe.resolvedWith).toEqual({
        kind: 'proceed',
        resolutions: {
          '/repo/payments': { kind: 'discard', confirmedPaths: ['pay.ts', 'tmp/new.txt'] },
          '/repo/billing': { kind: 'discard', confirmedPaths: ['bill.ts'] },
        },
      });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Esc on the resolution view cancels the switch, touching nothing, and says so', async () => {
    const { store, probe } = resolutionStore();
    const { instance, stdout, stdin } = mount(store);
    try {
      await openResolution(instance, stdin);
      await pressEscape(instance, stdin);
      await settle(instance);

      expect(probe.switchCalls).toBe(1);
      expect(probe.resolvedWith).toEqual({ kind: 'cancel' });
      expect(store.getState().switchDirtyRepos).toBeNull();
      expect(stdout.output).toContain('cancelled');
      // Still in switch-confirm (not a fresh dialog) — a second Enter re-invokes switchEdt,
      // which raises a fresh resolution view that Esc cancels again.
      await press(instance, stdin, KEYS.enter);
      expect(probe.switchCalls).toBe(2);
      await settle(instance);
      await settle(instance);
      const retryFrame = stdout.output.slice(stdout.output.lastIndexOf('cancelled'));
      expect(retryFrame).toContain('GLOBAL STRATEGY');
      expect(retryFrame).toContain('AFFECTED SERVICES');
      await pressEscape(instance, stdin);
      await settle(instance);
      expect(probe.resolutions).toEqual([{ kind: 'cancel' }, { kind: 'cancel' }]);
      expect(store.getState().switchDirtyRepos).toBeNull();
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('an invalid adopt target (already exists locally) is shown inline and blocks Ctrl+N', async () => {
    const { store, probe } = resolutionStore({ localBranches: { '/repo/payments': ['development', 'mon-topic'] } });
    const { instance, stdout, stdin } = mount(store);
    try {
      await openResolution(instance, stdin);

      expect(stdout.output).toContain('The branch “mon-topic” already exists in this service');

      await press(instance, stdin, KEYS.ctrlN);
      await settle(instance);

      expect(probe.resolvedWith).toBeNull();
      expect(stdout.output).toContain('Fix the invalid rows before confirming');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('with no outgoing EDT only Discard is offered, with an explanation', async () => {
    const { store } = resolutionStore({ activeTopic: null });
    const { instance, stdout, stdin } = mount(store);
    try {
      await openResolution(instance, stdin);

      expect(stdout.output).toContain('Default action: (•) Discard');
      expect(stdout.output).toContain('No outgoing EDT');
      expect(stdout.output).toContain('[Discard]');
      expect(stdout.output).not.toContain('[Adopt (Global)]');
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
      expect(stdout.output).toContain('Cannot switch away');
      await settle(instance);
      expect(footerIdOf(store)).toBe('force-confirm');

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

  // Uses a not-yet-member candidate (svc-b), which stays branch-editable via Enter when freshly
  // checked (an existing member's row submits instead) — the "drop a staged edit on uncheck"
  // rule applies identically either way.
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

  it('guards the create form submit against re-entrancy — a second Enter before the first resolves never double-calls createEdt', async () => {
    const store = createAppStore();
    let createCalls = 0;
    let release: (() => void) | undefined;
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      edtsBranches: [{ service: 'svc-a', path: '/repos/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] }],
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
      // Zero EDTs -> the create wizard auto-opens on Step 1, name-focused by default.
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

      // Every key is inert while the submit is in flight — Esc would otherwise request a quit
      // here (zero EDTs), and Ctrl+P would step back mid-submit.
      await pressEscape(instance, stdin);
      await press(instance, stdin, KEYS.ctrlP);
      await press(instance, stdin, KEYS.ctrlLeft);
      expect(store.getState().quitRequested).toBe(false);
      const lastFrame = stdout.output.slice(stdout.output.lastIndexOf(WIZARD_TITLE));
      expect(lastFrame).toContain('▶ 4. Activation ◀');
      expect(lastFrame).toContain('Creating…');

      release?.();
      await instance.waitUntilRenderFlush();
      await instance.waitUntilRenderFlush();
      expect(createCalls).toBe(1);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Left/Backspace edit the topic field at the caret through a real keypress round-trip, not always at the end', async () => {
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
      // Zero EDTs -> the create wizard auto-opens on Step 1, name-focused by default.
      await type(instance, stdin, 'abd'); // cursor trails at 3
      await press(instance, stdin, KEYS.left); // cursor -> 2
      // Mid-string insert: typing 'c' at cursor 2 in "abd" must produce "abcd" — a no-op Left
      // would append at the end instead, producing "abdc".
      await type(instance, stdin, 'c');
      expect(stdout.output).toContain('Name: abcd');
      expect(stdout.output).not.toContain('Name: abdc');

      await press(instance, stdin, KEYS.home); // cursor -> 0
      await press(instance, stdin, KEYS.backspace); // cursor:0 -> no-op
      expect(stdout.output).toContain('Name: abcd');

      await press(instance, stdin, KEYS.end); // cursor -> 4 (value.length)
      await press(instance, stdin, KEYS.backspace); // removes 'd' before cursor
      expect(stdout.output).toContain('Name: abc');
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

  it('create with a duplicate topic — createEdt\'s rejection is surfaced inline, form stays open', async () => {
    const store = createAppStore();
    const createCalls: CreateEdtParams[] = [];
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      edtsBranches: [{ service: 'svc-a', path: '/repos/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] }],
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
      // Zero EDTs -> the create wizard auto-opens on Step 1, name-focused by default.
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

  it('zero services checked blocks leaving Step 2 — inline message, no createEdt call', async () => {
    const store = createAppStore();
    const createCalls: CreateEdtParams[] = [];
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      edtsBranches: [{ service: 'svc-a', path: '/repos/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] }],
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

      expect(stdout.output).toContain('Select at least one service');
      const lastFrame = stdout.output.slice(stdout.output.lastIndexOf(WIZARD_TITLE));
      expect(lastFrame).toContain('▶ 2. Services ◀');
      expect(stdout.output).not.toContain('▶ 3. Branches ◀');
      expect(createCalls).toHaveLength(0);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // createEdt/switchEdt/modifyEdt are per-repo/per-member isolated — an overall ok:true result
  // can still carry `results` rows with `outcome: 'failed'` (e.g. a candidate on a
  // shared/protected branch). Every submit handler must look at `results` rather than treat
  // `result.ok` as full success and close the dialog.
  it('surfaces a per-member failure inline even though createEdt returned ok:true, instead of silently closing', async () => {
    const store = createAppStore();
    let loadCalls = 0;
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      edtsBranches: [
        { service: 'svc-a', path: '/repos/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] },
        { service: 'svc-b', path: '/repos/b', isMember: false, branch: 'development', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] },
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
      // Zero EDTs -> the create wizard auto-opens. Select both candidates.
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

      // The EDT already exists — nothing may re-submit or navigate away; the failure rows stay
      // until acknowledged, and Enter closes the wizard.
      await settle(instance);
      expect(footerIdOf(store)).toBe('close');
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

  // Step 3 — global branch strategy & per-service overrides -------------------------------
  it('Step 3 opens on Panel A (placeholder base, slug name, every row global); the default submit sends memberPlans only', async () => {
    const { store, createCalls, listCalls } = step3Store();
    const { instance, stdout, stdin } = mount(store);
    try {
      await reachStep3(instance, stdin, 'Auth Flow', 2);
      const frame = lastWizardFrame(stdout);
      expect(frame).toContain('▶ GLOBAL STRATEGY');
      expect(frame).toContain('› Default source branch: <shared-branch>');
      expect(frame).toContain('Global branch name: auth-flow');
      expect(frame).toContain('SUMMARY AND PER-SERVICE EXCEPTIONS');
      expect(frame).toContain('Service │ Mode');
      expect(frame).toMatch(/svc-a +│ \[Create \(Global\)\] │ main +│ auth-flow/);
      expect(frame).toMatch(/svc-b +│ \[Create \(Global\)\] │ development +│ auth-flow/);
      expect(footerIdOf(store)).toBe('wizard-branches-first');
      // Each service's lists are loaded exactly once for this entry.
      expect([...listCalls].sort()).toEqual(['/repos/a', '/repos/b']);

      await press(instance, stdin, KEYS.enter); // Panel A: Enter edits the base line — never advances
      expect(lastWizardFrame(stdout)).toContain('▶ 3. Branches ◀');
      await pressEscape(instance, stdin); // leaves edit mode only
      await press(instance, stdin, KEYS.ctrlN); // Step 3 -> Step 4
      const recap = lastWizardFrame(stdout);
      expect(recap).toContain('▶ 4. Activation ◀');
      expect(recap).toContain('3. Branches: auth-flow');
      expect(recap).toContain('svc-a : [Create (Global)] main → auth-flow');
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

  it('a global base resolves live per service (local preferred, else origin/<x>); "not found" blocks Ctrl+N', async () => {
    const { store, createCalls } = step3Store({
      lists: { '/repos/a': { local: ['main', 'rel'], remote: ['origin/rel'] }, '/repos/b': { local: ['development'], remote: ['origin/rel'] } },
    });
    const { instance, stdout, stdin } = mount(store);
    try {
      await reachStep3(instance, stdin, 'demo', 2);
      await type(instance, stdin, 'nope'); // a printable key enters edit mode with that character typed
      let frame = lastWizardFrame(stdout);
      expect(frame).toContain('Default source branch: nope');
      expect(frame).toMatch(/svc-a +│ \[Create \(Global\)\] │ ✖ branch not found/);
      await press(instance, stdin, KEYS.ctrlN); // blocked
      frame = lastWizardFrame(stdout);
      expect(frame).toContain('▶ 3. Branches ◀');
      expect(frame).toContain('svc-a : branch not found');

      for (let i = 0; i < 4; i += 1) {
        await press(instance, stdin, KEYS.backspace);
      }
      expect(lastWizardFrame(stdout)).toContain('Default source branch: <shared-branch>'); // placeholder restored
      await type(instance, stdin, 'rel');
      frame = lastWizardFrame(stdout);
      expect(frame).toMatch(/svc-a +│ \[Create \(Global\)\] │ rel +│ demo/);
      expect(frame).toMatch(/svc-b +│ \[Create \(Global\)\] │ origin\/rel +│ demo/);

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

  it('the global name tracks Step 1 until edited; Ctrl+← keeps every decision', async () => {
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
      expect(lastWizardFrame(stdout)).toContain('Global branch name: demo-x-y'); // untouched: tracks the slug

      await press(instance, stdin, KEYS.down); // Panel A: base -> name line
      await press(instance, stdin, KEYS.enter); // edit the name
      await type(instance, stdin, '-q');
      await press(instance, stdin, KEYS.enter); // commit
      expect(lastWizardFrame(stdout)).toMatch(/svc-a +│ \[Create \(Global\)\] │ main +│ demo-x-y-q/);

      await press(instance, stdin, KEYS.ctrlLeft);
      await press(instance, stdin, KEYS.ctrlLeft);
      await type(instance, stdin, 'Z');
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.enter);
      await settle(instance);
      expect(lastWizardFrame(stdout)).toContain('Global branch name: demo-x-y-q'); // touched: kept

      await press(instance, stdin, KEYS.ctrlN);
      await press(instance, stdin, KEYS.enter);
      expect(createCalls[0]?.members).toEqual(['/repos/a']);
      expect(createCalls[0]?.memberPlans).toEqual({ '/repos/a': { kind: 'create', base: 'main', name: 'demo-x-y-q' } });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('"Configure" box — a Custom row ignores Panel A; Ctrl+R reverts it to the global rule', async () => {
    const { store, createCalls } = step3Store({ lists: { '/repos/a': { local: ['main'], remote: ['origin/dev'] }, '/repos/b': { local: ['development'], remote: [] } } });
    const { instance, stdout, stdin } = mount(store);
    try {
      await reachStep3(instance, stdin, 'demo', 2);
      await press(instance, stdin, KEYS.tab); // Panel A -> Panel B
      expect(lastWizardFrame(stdout)).toContain('▶ SUMMARY AND PER-SERVICE EXCEPTIONS');
      await press(instance, stdin, KEYS.enter); // open the box on svc-a
      let frame = lastWizardFrame(stdout);
      expect(frame).toContain('Configure svc-a');
      expect(frame).toContain('Mode: (•) Create new ( ) Choose existing');
      expect(frame).toContain('Base branch (source): main');
      expect(frame).toContain('Branch name: demo');

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
      await press(instance, stdin, KEYS.enter); // commit -> [ Apply ]
      await press(instance, stdin, KEYS.enter); // apply
      frame = lastWizardFrame(stdout);
      expect(frame).not.toContain('Configure svc-a');
      expect(frame).toMatch(/svc-a +│ \[Create \(Custom\)\] +│ origin\/dev +│ q/);

      // Custom ignores Panel A: an unresolvable global base only blocks the global row.
      await press(instance, stdin, KEYS.tab);
      await type(instance, stdin, 'zzz');
      frame = lastWizardFrame(stdout);
      expect(frame).toMatch(/svc-a +│ \[Create \(Custom\)\] +│ origin\/dev +│ q/);
      expect(frame).toMatch(/svc-b +│ \[Create \(Global\)\] +│ ✖ branch not found/);
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

  it('Ctrl+R in the box puts the row back to [Create (Global)] and closes the box', async () => {
    const { store } = step3Store({ lists: { '/repos/a': { local: ['main', 'feat/z'], remote: [] } } });
    const { instance, stdout, stdin } = mount(store);
    try {
      await reachStep3(instance, stdin, 'demo', 1);
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.enter); // open the box
      await press(instance, stdin, KEYS.space); // Mode -> Choose existing
      await press(instance, stdin, KEYS.down); // "Existing branch"
      await press(instance, stdin, KEYS.enter);
      await type(instance, stdin, 'feat/z');
      await press(instance, stdin, KEYS.enter); // commit -> rename checkbox
      await press(instance, stdin, KEYS.down); // [ Apply ]
      await press(instance, stdin, KEYS.enter); // apply
      expect(lastWizardFrame(stdout)).toMatch(/svc-a +│ \[Existing\] +│ feat\/z +│ feat\/z/);

      await press(instance, stdin, KEYS.enter); // reopen: loaded back as "Choose existing"
      expect(lastWizardFrame(stdout)).toContain('Mode: ( ) Create new (•) Choose existing');
      await press(instance, stdin, KEYS.ctrlR);
      const frame = lastWizardFrame(stdout);
      expect(frame).not.toContain('Configure svc-a');
      expect(frame).toMatch(/svc-a +│ \[Create \(Global\)\] │ main +│ demo/);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Existante / Renommer via the box — a remote pick with a rename reaches memberPlans as-is; protected names are refused inline', async () => {
    const { store, createCalls } = step3Store({ lists: { '/repos/a': { local: ['main', 'prod'], remote: ['origin/w'] } } });
    const { instance, stdout, stdin } = mount(store);
    try {
      await reachStep3(instance, stdin, 'demo', 1);
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.enter); // open the box
      await press(instance, stdin, KEYS.space); // Space on the Mode line toggles
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.enter);
      await type(instance, stdin, 'prod');
      await press(instance, stdin, KEYS.enter); // commit -> rename checkbox
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.enter); // apply -> refused (protected, no rename)
      let frame = lastWizardFrame(stdout);
      expect(frame).toContain('Configure svc-a');
      expect(frame).toContain('“prod” is a local branch protected by the manifest of svc-a');

      await press(instance, stdin, KEYS.up); // rename checkbox
      await press(instance, stdin, KEYS.up); // "Existing branch"
      await press(instance, stdin, KEYS.enter);
      for (let i = 0; i < 4; i += 1) {
        await press(instance, stdin, KEYS.backspace);
      }
      await type(instance, stdin, 'origin/w');
      await press(instance, stdin, KEYS.enter); // commit -> rename checkbox
      await press(instance, stdin, KEYS.space); // check it: "New name" appears
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.enter);
      await type(instance, stdin, 'w2');
      await press(instance, stdin, KEYS.enter); // commit -> [ Apply ]
      await press(instance, stdin, KEYS.enter); // apply
      frame = lastWizardFrame(stdout);
      expect(frame).toMatch(/svc-a +│ \[Rename\] +│ origin\/w +│ -> w2/);

      await press(instance, stdin, KEYS.ctrlN);
      await press(instance, stdin, KEYS.enter);
      expect(createCalls[0]?.memberPlans).toEqual({ '/repos/a': { kind: 'existing', branch: 'origin/w', renameTo: 'w2' } });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Esc closes the innermost element first — box field, box, Panel A edit mode — then the wizard', async () => {
    const { store, createCalls } = step3Store({ edts: [edt({ ulid: 'other-ulid', topic: 'other' })] });
    const { instance, stdout, stdin } = mount(store, { initialDialogKind: 'create' });
    try {
      await reachStep3(instance, stdin, 'demo', 1);
      await press(instance, stdin, KEYS.tab); // Panel B
      await press(instance, stdin, KEYS.enter); // box
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.enter); // a field in edit
      await pressEscape(instance, stdin); // leaves the field
      expect(lastWizardFrame(stdout)).toContain('Configure svc-a');
      await pressEscape(instance, stdin); // closes the box
      let frame = lastWizardFrame(stdout);
      expect(frame).not.toContain('Configure svc-a');
      expect(frame).toContain('▶ SUMMARY AND PER-SERVICE EXCEPTIONS');

      await press(instance, stdin, KEYS.tab); // Panel A
      await press(instance, stdin, KEYS.enter); // edit mode
      await pressEscape(instance, stdin); // leaves edit mode — the wizard stays
      frame = lastWizardFrame(stdout);
      expect(frame).toContain('▶ 3. Branches ◀');

      const beforeCancel = stdout.output.length;
      await pressEscape(instance, stdin); // nothing left open -> cancels the whole creation
      // The cancel's side effect runs from an effect one commit after the Esc updater raised
      // `cancelRequested` — wait for that extra render instead of racing it under load.
      await vi.waitFor(() => {
        const afterCancel = stdout.output.slice(beforeCancel);
        expect(afterCancel).toContain('other');
        expect(afterCancel).not.toContain(WIZARD_TITLE);
      });
      expect(createCalls).toHaveLength(0);
      expect(store.getState().quitRequested).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('step navigation is inert while the box is open or a field is in edit — nothing unapplied is lost', async () => {
    const { store, createCalls } = step3Store();
    const { instance, stdout, stdin } = mount(store);
    try {
      await reachStep3(instance, stdin, 'demo', 1);
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.enter); // open the box
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.down); // name line
      await press(instance, stdin, KEYS.enter); // edit
      await type(instance, stdin, '-x');
      for (const key of [KEYS.ctrlN, KEYS.ctrlRight, KEYS.ctrlP, KEYS.ctrlLeft]) {
        await press(instance, stdin, key); // inert inside a box field
      }
      let frame = lastWizardFrame(stdout);
      expect(frame).toContain('▶ 3. Branches ◀');
      expect(frame).toContain('Configure svc-a');
      expect(frame).toContain('Branch name: demo-x');

      await pressEscape(instance, stdin); // leave the field — the box is still open
      await press(instance, stdin, KEYS.ctrlN); // inert with the box open
      await press(instance, stdin, KEYS.ctrlP);
      frame = lastWizardFrame(stdout);
      expect(frame).toContain('Configure svc-a');
      expect(frame).toContain('Branch name: demo-x');

      await pressEscape(instance, stdin); // close the box
      await press(instance, stdin, KEYS.tab); // Panel A
      await press(instance, stdin, KEYS.enter); // edit the base line
      await press(instance, stdin, KEYS.ctrlN); // inert while Panel A edits
      expect(lastWizardFrame(stdout)).toContain('▶ 3. Branches ◀');
      await pressEscape(instance, stdin);
      await press(instance, stdin, KEYS.ctrlN); // nothing open now: advances
      expect(lastWizardFrame(stdout)).toContain('▶ 4. Activation ◀');
      expect(createCalls).toHaveLength(0);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a Step 3 Esc-cancel decided in the state updater still reaches the zone — zero EDTs requests a quit', async () => {
    const { store } = step3Store();
    const { instance, stdout, stdin } = mount(store);
    try {
      await reachStep3(instance, stdin, 'demo', 1);
      await press(instance, stdin, KEYS.enter); // edit the base line
      await pressEscape(instance, stdin); // leaves edit mode only
      expect(store.getState().quitRequested).toBe(false);
      expect(lastWizardFrame(stdout)).toContain('▶ 3. Branches ◀');

      await pressEscape(instance, stdin); // nothing open: the zero-EDT wizard requests a quit
      // The quit runs from an effect one commit after the Esc updater (cancelRequested).
      await vi.waitFor(() => expect(store.getState().quitRequested).toBe(true));
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('after a blocked Ctrl+N, editing the base clears the wizard message while the row keeps its own', async () => {
    const { store } = step3Store();
    const { instance, stdout, stdin } = mount(store);
    try {
      await reachStep3(instance, stdin, 'demo', 1);
      await type(instance, stdin, 'nope');
      await press(instance, stdin, KEYS.enter); // commit the field
      await press(instance, stdin, KEYS.ctrlN); // blocked
      const count = (frame: string) => frame.split('svc-a : branch not found').length - 1;
      expect(count(lastWizardFrame(stdout))).toBe(2); // the detail line + the wizard's message
      await press(instance, stdin, KEYS.enter); // edit again
      await press(instance, stdin, KEYS.backspace); // 'nop': still not found
      const frame = lastWizardFrame(stdout);
      expect(frame).toContain('▶ 3. Branches ◀');
      expect(count(frame)).toBe(1); // only the row's own detail line is left
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a list landing clears a stale "branches are loading" message', async () => {
    let release: (() => void) | undefined;
    const { store } = step3Store({
      listCreateBranches: () =>
        new Promise<ListsResult>((resolve) => {
          release = () => resolve({ ok: true, data: { local: ['main'], remote: [] } });
        }),
    });
    const { instance, stdout, stdin } = mount(store);
    try {
      await reachStep3(instance, stdin, 'demo', 1);
      await press(instance, stdin, KEYS.ctrlN); // blocked while loading
      const count = (frame: string) => frame.split('branches are loading').length - 1;
      expect(count(lastWizardFrame(stdout))).toBe(2); // the row's detail line + the wizard's message
      release?.();
      await settle(instance);
      const frame = lastWizardFrame(stdout);
      expect(count(frame)).toBe(0);
      expect(frame).toMatch(/svc-a +│ \[Create \(Global\)\] │ main +│ demo/);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a rejected list load becomes a row error instead of loading forever', async () => {
    const { store } = step3Store({
      listCreateBranches: async () => {
        throw new Error('spawn git ENOENT');
      },
    });
    const { instance, stdout, stdin } = mount(store);
    try {
      await reachStep3(instance, stdin, 'demo', 1);
      expect(lastWizardFrame(stdout)).toContain('✖ svc-a : failed to load branches: spawn git ENOENT');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a failed list load shows on the row, blocks Ctrl+N, and is retried on the next entry', async () => {
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
      let frame = lastWizardFrame(stdout);
      expect(frame).toMatch(/svc-a +│ \[Create \(Global\)\] │ ✖ failed to/);
      // The real cause, spelled out on the detail line under the table.
      expect(frame).toContain('✖ svc-a : failed to load branches: boom');
      await press(instance, stdin, KEYS.ctrlN);
      frame = lastWizardFrame(stdout);
      expect(frame).toContain('▶ 3. Branches ◀');
      expect(attempts).toBe(1);

      await press(instance, stdin, KEYS.ctrlLeft); // Step 2
      await press(instance, stdin, KEYS.ctrlN); // Step 3 again: retried
      await settle(instance);
      expect(attempts).toBe(2);
      expect(lastWizardFrame(stdout)).toMatch(/svc-a +│ \[Create \(Global\)\] │ main +│ demo/);
      await press(instance, stdin, KEYS.ctrlN);
      await press(instance, stdin, KEYS.enter);
      expect(createCalls).toHaveLength(1);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a name taken by a loaded EDT (trimmed) shows "already taken" live and blocks Step 1; a case variant stays available', async () => {
    const store = createAppStore();
    let createCalls = 0;
    store.setState({
      edts: [edt({ ulid: 'demo-ulid', topic: 'demo' })],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [{ service: 'svc-a', path: '/repos/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] }],
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
      expect(stdout.output).toContain('✖ already taken');
      await press(instance, stdin, KEYS.enter); // blocked
      await press(instance, stdin, KEYS.ctrlRight); // blocked too
      expect(stdout.output).toContain('This name is already taken by another EDT');
      expect(stdout.output).not.toContain('▶ 2. Services ◀');

      // Rewrite it as "Demo": case-sensitive, so available — checked on every keystroke.
      for (let i = 0; i < ' demo '.length; i += 1) {
        await press(instance, stdin, KEYS.backspace);
      }
      const beforeAvailable = stdout.output.length;
      await type(instance, stdin, 'Demo');
      expect(stdout.output.slice(beforeAvailable)).toContain('✔ available');
      await press(instance, stdin, KEYS.enter);
      expect(stdout.output).toContain('▶ 2. Services ◀');
      expect(createCalls).toBe(0);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Step 4 re-checks the name — a clash appearing after Step 1 blocks the submit with the wizard message', async () => {
    const store = createAppStore();
    let createCalls = 0;
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      edtsBranches: [{ service: 'svc-a', path: '/repos/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] }],
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
      expect(stdout.output).toContain('This name is already taken by another EDT');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('an empty (or blank) name blocks Step 1 with an inline message', async () => {
    const store = createAppStore();
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      edtsBranches: [{ service: 'svc-a', path: '/repos/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] }],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await type(instance, stdin, '   ');
      await press(instance, stdin, KEYS.enter);
      expect(stdout.output).toContain('The name must not be empty');
      expect(stdout.output).not.toContain('▶ 2. Services ◀');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // The forced zero-EDT create prompt has nothing to cancel back to, and `q` is blocked by
  // zoneInputCaptured — so Escape requests a quit, never leaving the user trapped short of
  // Ctrl+C (which skips onQuit's lock release).
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

      // The quit runs from an effect one commit after the Esc updater (cancelRequested).
      await vi.waitFor(() => expect(store.getState().quitRequested).toBe(true));
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
      edtsBranches: [{ service: 'svc-a', path: '/repos/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] }],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });

    // `initialDialogKind: 'create'` (a test-only injection point, like the smoke tests' use of
    // it) forces the dialog open despite `edts` being non-empty — the only way to reach this
    // branch outside the partial-failure-after-create path above, since the populated view lacks
    // a "new EDT" affordance in this context.
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
// Delete an EDT (real-keypress coverage: toggling a member's disposition and confirming/
// cancelling are only exercisable through a real Ink useInput round-trip).
// ==========================================================================================

describe('EdtsZone real-keypress interactions', () => {
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

  // Deleting the active EDT -> rejected before any write, never auto-switched — only Escape is
  // ever offered, Enter/Space are inert.
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
      // Never even fetches member statuses — there is nothing to disposition (rejected before any
      // git/file write).
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
// Active highlight, 3-way pane cycle, EDT SERVICES/OTHER SERVICES contextual actions
// (real-keypress coverage: the Tab cycle, dialog opens, and async submits below are only
// exercisable through a real Ink useInput round-trip — see the file header).
// ==========================================================================================

describe('EdtsZone real-keypress interactions', () => {
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

// ==========================================================================================
// EDT quick-pick: edt-switch/edt-modify/edt-delete with no argument open a shared filterable,
// arrow-navigable list instead of guessing a target. Driven like the real command bar drives it —
// setting `currentEdtAction` with the `target: 'select EDT'` sentinel the store's openEdt*Dialog
// actions produce — so the zone's own `currentEdtAction` effect is the thing under test, not a
// seeded dialog state.
// ==========================================================================================

describe('EdtsZone quick-pick dialog', () => {
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
      // The quick-pick dialog's own title ("SELECT EDT TO SWITCH") legitimately contains the
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
      // The existing delete rejection message, reached via the picker.
      expect(rejectedFrame).toContain('active EDT');
      expect(footerIdOf(store)).toBe('dismiss');
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
      expect(outputSinceEscape).not.toContain('SELECT EDT TO SWITCH');
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

  it('the filter matches by substring, not prefix: typing the end of a topic still finds it', async () => {
    const billing = edt({ ulid: 'billing-ulid', topic: 'billing-api' });
    const front = edt({ ulid: 'front-ulid', topic: 'storefront' });
    const store = createAppStore();
    store.setState({
      edts: [front, billing],
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

      await type(instance, stdin, 'api');
      const dialogFrame = stdout.output.slice(stdout.output.lastIndexOf('╔'));
      expect(dialogFrame).toContain('billing-api');
      expect(dialogFrame).not.toContain('storefront');

      // Decisive proof: 'storefront' sorts first in the pool, so Enter landing on
      // 'billing-api' means the substring filter narrowed the navigable list.
      await press(instance, stdin, KEYS.enter);

      expect(stdout.output).toContain('MODIFY EDT');
      expect(stdout.output).toContain('Topic: billing-api');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a filter matching zero EDTs shows an explicit "No matching EDT" state, never a silently-empty list', async () => {
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

describe('EdtsZone edt-create-from', () => {
  const ROOT = edt({
    ulid: 'root-ulid',
    topic: 'feat-a',
    status: 'active',
    members: [
      { service: 'svc-a', repoPath: '/repos/a', branch: 'feat/a-api' },
      { service: 'svc-gone', repoPath: '/repos/gone', branch: 'feat/x' },
    ],
  });
  const OTHER = edt({ ulid: 'other-ulid', topic: 'other-work' });
  const PICK_TITLE = 'SELECT EDT TO COPY';

  function createFromStore(target: string) {
    const { store, createCalls } = step3Store({ edts: [ROOT, OTHER] });
    const logged: string[] = [];
    store.setState({
      activeEdt: 'root-ulid',
      currentEdtAction: { type: 'create-from', target, startedAt: new Date().toISOString() },
      logEdtAction: async (_ulid, _actionType, _outcome, detail) => {
        logged.push(detail);
      },
    });
    return { store, createCalls, logged };
  }

  function lastPickFrame(stdout: FakeTtyStdout): string {
    return stdout.output.slice(stdout.output.lastIndexOf(PICK_TITLE));
  }

  it('no argument: opens quick-pick(create-from) over every EDT (active included); Enter opens the seeded wizard', async () => {
    const { store } = createFromStore('select EDT');
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain(PICK_TITLE);
      expect(lastPickFrame(stdout)).toContain('feat-a');
      expect(lastPickFrame(stdout)).toContain('other-work');

      await press(instance, stdin, KEYS.enter); // the active root, first in the pool
      const frame = lastWizardFrame(stdout);
      expect(frame).toContain("From EDT: feat-a");
      // The topic is never derived from the root: Step 1 starts empty, so Enter is blocked.
      await press(instance, stdin, KEYS.enter);
      expect(lastWizardFrame(stdout)).toContain('The name must not be empty');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('no argument: Esc closes the quick-pick with nothing opened', async () => {
    const { store } = createFromStore('select EDT');
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await pressEscape(instance, stdin);
      expect(stdout.output).not.toContain(WIZARD_TITLE);
      expect(store.getState().currentEdtAction).toBeNull();
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('unknown topic: opens quick-pick(create-from) with an inline not-found error, cleared on the first filter edit', async () => {
    const { store } = createFromStore('nope');
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(lastPickFrame(stdout)).toContain('EDT not found: "nope"');

      await press(instance, stdin, KEYS.down); // not a filter edit: the error stays
      expect(lastPickFrame(stdout)).toContain('EDT not found: "nope"');

      await type(instance, stdin, 'o');
      expect(lastPickFrame(stdout)).not.toContain('EDT not found');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('known topic: seeded wizard — inherited row Custom on the root branch, added row Global; submit sends the root bases', async () => {
    const { store, createCalls, logged } = createFromStore('feat-a');
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(lastWizardFrame(stdout)).toContain("From EDT: feat-a");

      await type(instance, stdin, 'next');
      await press(instance, stdin, KEYS.enter); // Step 1 -> Step 2
      // svc-gone is no longer a registered service: named in a dim note.
      expect(lastWizardFrame(stdout)).toContain('svc-gone');

      // svc-a is pre-checked (root member); also check svc-b (not in the root).
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.space);
      await press(instance, stdin, KEYS.enter); // Step 2 -> Step 3
      await settle(instance);

      const step3 = lastWizardFrame(stdout);
      expect(step3).toContain('[Create (Custom)]');
      expect(step3).toContain('feat/a-api');
      expect(step3).toContain('[Create (Global)]');

      await press(instance, stdin, KEYS.ctrlN); // Step 3 -> Step 4
      await press(instance, stdin, KEYS.space); // "Create without switching"
      await press(instance, stdin, KEYS.enter);
      await settle(instance);

      expect(createCalls).toHaveLength(1);
      expect(createCalls[0]).toMatchObject({
        topic: 'next',
        members: ['/repos/a', '/repos/b'],
        memberPlans: {
          '/repos/a': { kind: 'create', base: 'feat/a-api', name: 'next' },
          '/repos/b': { kind: 'create', base: 'development', name: 'next' },
        },
      });
      expect(logged[0]).toContain('Created EDT "next" from "feat-a" with 2 member(s)');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Steps 1-3 of a seeded create (svc-a inherited, nothing added), landing on Step 4.
  async function reachSeededStep4(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream): Promise<void> {
    await instance.waitUntilRenderFlush();
    await type(instance, stdin, 'next');
    await press(instance, stdin, KEYS.enter); // Step 1 -> Step 2
    await press(instance, stdin, KEYS.enter); // Step 2 -> Step 3
    await settle(instance);
    await press(instance, stdin, KEYS.ctrlN); // Step 3 -> Step 4
  }

  it('switch choice: the logged create detail names the root EDT', async () => {
    const { store, createCalls, logged } = createFromStore('feat-a');
    store.setState({
      switchEdt: async (params): Promise<Result<SwitchActiveEdtData>> => ({
        ok: true,
        data: { ulid: 'new-ulid', topic: params.topic, results: [], wasInterrupted: false },
      }),
    });
    const { instance, stdin } = mount(store);
    try {
      await reachSeededStep4(instance, stdin);
      await press(instance, stdin, KEYS.enter); // default choice: switch now
      await settle(instance);
      expect(createCalls).toHaveLength(1);
      expect(logged[0]).toContain('Created EDT "next" from "feat-a" with 1 member(s) (switch requested)');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('partial create: the not-activated log detail names the root EDT', async () => {
    const { store, logged } = createFromStore('feat-a');
    store.setState({
      createEdt: async (params): Promise<Result<CreateEdtData>> => ({
        ok: true,
        data: { ulid: 'new-ulid', topic: params.topic, results: [{ service: 'svc-a', outcome: 'failed', detail: { code: 'git-error', message: 'boom' } }] },
      }),
    });
    const { instance, stdin } = mount(store);
    try {
      await reachSeededStep4(instance, stdin);
      await press(instance, stdin, KEYS.enter);
      await settle(instance);
      expect(logged[0]).toContain('Created EDT "next" from "feat-a" with 1 member(s) — not activated');
      expect(logged[0]).toContain('boom');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('editing the global name in Step 3 carries the untouched inherited row along', async () => {
    const { store, createCalls } = createFromStore('feat-a');
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await type(instance, stdin, 'next');
      await press(instance, stdin, KEYS.enter); // Step 1 -> Step 2
      await press(instance, stdin, KEYS.enter); // Step 2 -> Step 3
      await settle(instance);
      await press(instance, stdin, KEYS.down); // Panel A: base -> name line
      await press(instance, stdin, KEYS.enter); // edit the global name
      await type(instance, stdin, '-2');
      await press(instance, stdin, KEYS.enter); // leave edit mode
      await press(instance, stdin, KEYS.ctrlN); // Step 3 -> Step 4
      await press(instance, stdin, KEYS.space); // "Create without switching"
      await press(instance, stdin, KEYS.enter);
      await settle(instance);
      expect(createCalls[0]?.memberPlans).toEqual({ '/repos/a': { kind: 'create', base: 'feat/a-api', name: 'next-2' } });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});

// The wizard's Step 4 — explicit activation. Two services (svc-a, svc-b); svc-a is the new EDT's
// only member. Every log entry must go to the NEW EDT's ulid ('new-ulid').
describe('EdtsZone create wizard Step 4 — activation & switch choice', () => {
  const EXISTING = edt({ ulid: 'old-ulid', topic: 'old', members: [] });
  const NEW_ENTRY = edt({ ulid: 'new-ulid', topic: 'feat', members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'feat' }] });
  const BLOCKED: ActivateEdtData = { status: 'blocked', blocked: [{ service: 'svc-a', repoPath: '/repos/a', paths: ['a.ts', 'lib/b.ts'] }] };
  const ACTIVATED: ActivateEdtData = {
    status: 'activated',
    ulid: 'new-ulid',
    topic: 'feat',
    results: [
      { service: 'svc-a', outcome: 'switched' },
      { service: 'svc-b', outcome: 'switched' },
    ],
  };

  function step4Store(options: {
    existing: boolean;
    activations?: Array<Result<ActivateEdtData>>;
    createResult?: Result<CreateEdtData>;
  }) {
    const { store, createCalls } = step3Store({ edts: options.existing ? [EXISTING] : [] });
    const activateCalls: Array<{ topic: string; overwrite?: Record<string, string[]> }> = [];
    const switchCalls: string[] = [];
    const logged: Array<{ ulid: string; actionType: string; outcome: string; detail: string }> = [];
    const queue = [...(options.activations ?? [{ ok: true as const, data: ACTIVATED }])];
    let created = false;
    store.setState({
      activeEdt: options.existing ? 'old-ulid' : null,
      // The reload after a create sees the new EDT (the switch handoff resolves it from here).
      loadEdts: async () => {
        if (created) {
          store.setState({ edts: options.existing ? [EXISTING, NEW_ENTRY] : [NEW_ENTRY] });
        }
      },
      createEdt: async (params): Promise<Result<CreateEdtData>> => {
        createCalls.push(params);
        created = options.createResult?.ok !== false;
        return options.createResult ?? { ok: true, data: { ulid: 'new-ulid', topic: params.topic, results: [] } };
      },
      activateEdt: async (params) => {
        activateCalls.push(params);
        return queue.shift() ?? { ok: true, data: ACTIVATED };
      },
      switchEdt: async (params): Promise<Result<SwitchActiveEdtData>> => {
        switchCalls.push(params.topic);
        return { ok: true, data: { ulid: 'new-ulid', topic: params.topic, results: [], wasInterrupted: false } };
      },
      logEdtAction: async (ulid, actionType, outcome, detail) => {
        logged.push({ ulid, actionType, outcome, detail });
      },
    });
    return { store, createCalls, activateCalls, switchCalls, logged };
  }

  async function reachStep4(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream): Promise<void> {
    await reachStep3(instance, stdin, 'feat', 1);
    await press(instance, stdin, KEYS.ctrlN); // Step 3 -> Step 4
  }

  async function mountWizard(store: ReturnType<typeof createAppStore>, existing: boolean) {
    // With EDTs already present the wizard is opened explicitly (the zero-EDT auto-open
    // covers the first-EDT case).
    return mount(store, existing ? { initialDialogKind: 'create' } : {});
  }

  it('first EDT, clean: Step 4 is locked on "Oui"; Enter creates then activates, closes, logs to the new EDT', async () => {
    const { store, createCalls, activateCalls, switchCalls, logged } = step4Store({ existing: false });
    const { instance, stdout, stdin } = await mountWizard(store, false);
    try {
      await reachStep4(instance, stdin);
      const frame = lastWizardFrame(stdout);
      expect(frame).toContain('Make this EDT the active workspace immediately');
      expect(frame).toContain('Yes (locked)');
      expect(frame).toContain("no outgoing EDT");

      await press(instance, stdin, KEYS.space); // the radio is locked: inert
      await press(instance, stdin, KEYS.enter);
      await settle(instance);

      expect(createCalls).toHaveLength(1);
      expect(activateCalls).toEqual([{ topic: 'feat' }]);
      expect(switchCalls).toHaveLength(0);
      expect(logged).toEqual([expect.objectContaining({ ulid: 'new-ulid', actionType: 'create', outcome: 'success' })]);
      expect(logged[0]?.detail).toContain('activated');
      expect(stdout.output.slice(stdout.output.lastIndexOf(WIZARD_TITLE))).not.toContain('Activating…');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('first EDT, at risk: pauses listing the files; R retries activateEdt only (never createEdt again)', async () => {
    const { store, createCalls, activateCalls, logged } = step4Store({
      existing: false,
      activations: [
        { ok: true, data: BLOCKED },
        { ok: true, data: BLOCKED },
        { ok: true, data: ACTIVATED },
      ],
    });
    const { instance, stdout, stdin } = await mountWizard(store, false);
    try {
      await reachStep4(instance, stdin);
      await press(instance, stdin, KEYS.enter);
      await settle(instance);

      let frame = lastWizardFrame(stdout);
      expect(frame).toContain('ACTIVATION PAUSED');
      expect(frame).toContain('svc-a (2 file(s))');
      expect(frame).toContain('a.ts');
      expect(frame).toContain('lib/b.ts');
      expect(footerIdOf(store)).toBe('wizard-pause');
      expect(logged).toHaveLength(0);

      await press(instance, stdin, 'r'); // still blocked -> panel refreshed
      await settle(instance);
      frame = lastWizardFrame(stdout);
      expect(frame).toContain('ACTIVATION PAUSED');

      await press(instance, stdin, 'R'); // fixed by hand -> proceeds
      await settle(instance);

      expect(createCalls).toHaveLength(1);
      expect(activateCalls).toEqual([{ topic: 'feat' }, { topic: 'feat' }, { topic: 'feat' }]);
      expect(logged).toEqual([expect.objectContaining({ ulid: 'new-ulid', outcome: 'success' })]);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('first EDT, overwrite: E opens the confirmation listing every file; Enter is back; Ctrl+E activates with exactly those paths', async () => {
    const { store, activateCalls, logged } = step4Store({
      existing: false,
      activations: [
        { ok: true, data: BLOCKED },
        {
          ok: true,
          data: {
            ...ACTIVATED,
            results: [
              { service: 'svc-a', outcome: 'discarded', detail: { code: 'discarded', message: 'Discarded 2', discardedPaths: ['a.ts', 'lib/b.ts'] } },
              { service: 'svc-b', outcome: 'switched' },
            ],
          },
        },
      ],
    });
    const { instance, stdout, stdin } = await mountWizard(store, false);
    try {
      await reachStep4(instance, stdin);
      await press(instance, stdin, KEYS.enter);
      await settle(instance);

      await press(instance, stdin, 'e');
      let frame = lastWizardFrame(stdout);
      expect(frame).toContain("CONFIRM OVERWRITE");
      expect(frame).toContain('lib/b.ts');
      expect(footerIdOf(store)).toBe('overwrite-confirm');

      await press(instance, stdin, KEYS.enter); // back
      frame = lastWizardFrame(stdout);
      expect(frame).toContain('ACTIVATION PAUSED');
      expect(activateCalls).toHaveLength(1);

      await press(instance, stdin, 'e');
      await press(instance, stdin, KEYS.ctrlE);
      await settle(instance);

      expect(activateCalls[1]).toEqual({ topic: 'feat', overwrite: { '/repos/a': ['a.ts', 'lib/b.ts'] } });
      expect(logged).toHaveLength(1);
      expect(logged[0]).toMatchObject({ ulid: 'new-ulid', outcome: 'success' });
      expect(logged[0]?.detail).toContain('discarded: svc-a (a.ts, lib/b.ts)');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('first EDT, stop: Esc on the pause panel leaves the EDT created but inactive, logged to the new EDT; Enter closes', async () => {
    const { store, activateCalls, logged } = step4Store({ existing: false, activations: [{ ok: true, data: BLOCKED }] });
    const { instance, stdout, stdin } = await mountWizard(store, false);
    try {
      await reachStep4(instance, stdin);
      await press(instance, stdin, KEYS.enter);
      await settle(instance);

      await pressEscape(instance, stdin);
      await settle(instance);

      const frame = lastWizardFrame(stdout);
      expect(frame).toContain('EDT created but not active');
      expect(activateCalls).toHaveLength(1);
      expect(store.getState().quitRequested).toBe(false);
      expect(logged).toEqual([expect.objectContaining({ ulid: 'new-ulid', outcome: 'success' })]);
      expect(logged[0]?.detail).toContain('not activated');

      expect(frame).toContain('Activate it later with :edt-switch feat');

      const beforeClose = stdout.output.length;
      await press(instance, stdin, KEYS.enter);
      await settle(instance);
      await vi.waitFor(() => {
        const afterClose = stdout.output.slice(beforeClose);
        expect(afterClose).not.toBe('');
        expect(afterClose).not.toContain(WIZARD_TITLE);
      });
      expect(store.getState().activeEdt).toBeNull();
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('later EDT, switch (default): radio + info block with non-member shared branches; Enter creates then runs the switch on the new EDT', async () => {
    const { store, createCalls, activateCalls, switchCalls, logged } = step4Store({ existing: true });
    const { instance, stdout, stdin } = await mountWizard(store, true);
    try {
      await reachStep4(instance, stdin);
      const frame = lastWizardFrame(stdout);
      expect(frame).toContain('(•) Switch to this new EDT immediately');
      expect(frame).toContain("( ) Create without switching (stay on the current EDT)");
      expect(frame).toContain('automatically (stash)');
      expect(frame).toContain('adopt it into the outgoing EDT');
      expect(frame).toContain('svc-b → development');
      expect(frame).toContain('configured branches');

      await press(instance, stdin, KEYS.enter);
      await settle(instance);

      expect(createCalls).toHaveLength(1);
      expect(activateCalls).toHaveLength(0);
      expect(switchCalls).toEqual(['feat']);
      // The create entry and the switch's own entry both land on the new EDT.
      expect(logged.map((entry) => [entry.ulid, entry.actionType])).toEqual([
        ['new-ulid', 'create'],
        ['new-ulid', 'switch'],
      ]);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('later EDT, switch handoff: a dirty state-2/3 repo opens the 2.41 resolution view for the new EDT; cancel leaves it inactive', async () => {
    const { store } = step4Store({ existing: true });
    let settleSwitch: ((result: Result<SwitchActiveEdtData>) => void) | undefined;
    store.setState({
      switchEdt: async () => {
        store.setState({
          switchDirtyRepos: [
            {
              service: 'svc-b',
              repoPath: '/repos/b',
              scope: 'non-member',
              currentBranch: 'wip',
              currentBranchShared: false,
              sharedBranch: 'development',
              protectedBranches: [],
              owningEdtTopics: [],
              dirtyPaths: ['x.ts'],
            },
          ],
        });
        return new Promise<Result<SwitchActiveEdtData>>((resolve) => {
          settleSwitch = resolve;
        });
      },
      resolveSwitchDirtyRepos: (choice: SwitchDirtyReposChoice) => {
        store.setState({ switchDirtyRepos: null });
        if (choice.kind === 'cancel') {
          settleSwitch?.({ ok: false, error: { code: 'switch-cancelled-by-user', message: 'Switch to "feat" cancelled' } });
        }
      },
      listBranches: async () => ({ ok: true, data: [] }),
    });
    const { instance, stdout, stdin } = await mountWizard(store, true);
    try {
      await reachStep4(instance, stdin);
      await press(instance, stdin, KEYS.enter);
      await settle(instance);
      await settle(instance);

      expect(stdout.output).toContain('AFFECTED SERVICES');
      expect(stdout.output.slice(stdout.output.lastIndexOf('SWITCH EDT'))).toContain('svc-b');

      await pressEscape(instance, stdin); // cancel the whole switch
      await settle(instance);
      expect(store.getState().activeEdt).toBe('old-ulid');
      expect(stdout.output.slice(stdout.output.lastIndexOf('SWITCH EDT'))).toContain('cancelled');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('later EDT, stay: Space selects "Create without switching"; Enter creates only, active unchanged, logged to the new EDT', async () => {
    const { store, createCalls, activateCalls, switchCalls, logged } = step4Store({ existing: true });
    const { instance, stdout, stdin } = await mountWizard(store, true);
    try {
      await reachStep4(instance, stdin);
      await press(instance, stdin, KEYS.space);
      expect(lastWizardFrame(stdout)).toContain("(•) Create without switching (stay on the current EDT)");
      await press(instance, stdin, KEYS.up); // ↑ back to switch
      expect(lastWizardFrame(stdout)).toContain('(•) Switch to this new EDT immediately');
      await press(instance, stdin, KEYS.down); // ↓ stay
      await press(instance, stdin, KEYS.enter);
      await settle(instance);

      expect(createCalls).toHaveLength(1);
      expect(activateCalls).toHaveLength(0);
      expect(switchCalls).toHaveLength(0);
      expect(store.getState().activeEdt).toBe('old-ulid');
      expect(logged).toEqual([expect.objectContaining({ ulid: 'new-ulid', actionType: 'create', outcome: 'success' })]);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('partial create: failed rows + "not activated", never switched, logged failed to the new EDT', async () => {
    const { store, switchCalls, activateCalls, logged } = step4Store({
      existing: true,
      createResult: {
        ok: true,
        data: { ulid: 'new-ulid', topic: 'feat', results: [{ service: 'svc-a', outcome: 'failed', detail: { code: 'git-error', message: 'boom' } }] },
      },
    });
    const { instance, stdout, stdin } = await mountWizard(store, true);
    try {
      await reachStep4(instance, stdin);
      await press(instance, stdin, KEYS.enter);
      await settle(instance);

      const frame = lastWizardFrame(stdout);
      expect(frame).toContain('EDT created but not activated');
      expect(frame).toContain('boom');
      expect(switchCalls).toHaveLength(0);
      expect(activateCalls).toHaveLength(0);
      expect(logged).toEqual([expect.objectContaining({ ulid: 'new-ulid', outcome: 'failed' })]);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('total create failure: shown inline, nothing logged (there is no new EDT)', async () => {
    const { store, logged, switchCalls } = step4Store({
      existing: true,
      createResult: { ok: false, error: { code: 'edt-create-error', message: 'disk full' } },
    });
    const { instance, stdout, stdin } = await mountWizard(store, true);
    try {
      await reachStep4(instance, stdin);
      await press(instance, stdin, KEYS.enter);
      await settle(instance);

      expect(lastWizardFrame(stdout)).toContain('disk full');
      expect(logged).toHaveLength(0);
      expect(switchCalls).toHaveLength(0);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  async function expectClosedAfter(instance: ReturnType<typeof render>, stdout: FakeTtyStdout, act: () => Promise<void>): Promise<void> {
    const before = stdout.output.length;
    await act();
    await settle(instance);
    await vi.waitFor(() => {
      const after = stdout.output.slice(before);
      expect(after).not.toBe('');
      expect(after).not.toContain(WIZARD_TITLE);
    });
  }

  it('activation error: "not activated" with the message and the per-repo rows, logged failed once to the new EDT; Enter closes', async () => {
    const { store, logged } = step4Store({
      existing: false,
      activations: [
        {
          ok: false,
          error: {
            code: 'state-write-error',
            message: 'disk full',
            details: { results: [{ service: 'svc-a', outcome: 'switched' }, { service: 'svc-b', outcome: 'failed', detail: { code: 'x', message: 'checkout boom' } }] },
          },
        },
      ],
    });
    const { instance, stdout, stdin } = await mountWizard(store, false);
    try {
      await reachStep4(instance, stdin);
      await press(instance, stdin, KEYS.enter);
      await settle(instance);

      const frame = lastWizardFrame(stdout);
      expect(frame).toContain('EDT created but not activated');
      expect(frame).toContain('disk full');
      expect(frame).toContain('checkout boom');
      expect(frame).toContain('switched to its target branch');
      expect(frame).toContain('Activate it later with :edt-switch feat');
      expect(logged).toEqual([expect.objectContaining({ ulid: 'new-ulid', actionType: 'create', outcome: 'failed' })]);

      await expectClosedAfter(instance, stdout, () => press(instance, stdin, KEYS.enter));
      expect(logged).toHaveLength(1);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('activation error: Esc closes the "not activated" state too', async () => {
    const { store } = step4Store({ existing: false, activations: [{ ok: false, error: { code: 'state-write-error', message: 'disk full' } }] });
    const { instance, stdout, stdin } = await mountWizard(store, false);
    try {
      await reachStep4(instance, stdin);
      await press(instance, stdin, KEYS.enter);
      await settle(instance);
      expect(lastWizardFrame(stdout)).toContain('EDT created but not activated');

      await expectClosedAfter(instance, stdout, () => pressEscape(instance, stdin));
      expect(store.getState().quitRequested).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('activation with a failed row: stays open on the row and the "created and activated, with per-service failures" footer; Enter closes; logged failed', async () => {
    const { store, logged } = step4Store({
      existing: false,
      activations: [
        {
          ok: true,
          data: {
            ...ACTIVATED,
            results: [
              { service: 'svc-a', outcome: 'switched' },
              { service: 'svc-b', outcome: 'failed', detail: { code: 'git-checkout-error', message: 'checkout boom' } },
            ],
          },
        },
      ],
    });
    const { instance, stdout, stdin } = await mountWizard(store, false);
    try {
      await reachStep4(instance, stdin);
      await press(instance, stdin, KEYS.enter);
      await settle(instance);

      const frame = lastWizardFrame(stdout);
      expect(frame).toContain('checkout boom');
      expect(frame).toContain('EDT created and activated, with per-service failures');
      expect(logged).toEqual([expect.objectContaining({ ulid: 'new-ulid', outcome: 'failed' })]);

      await expectClosedAfter(instance, stdout, () => press(instance, stdin, KEYS.enter));
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('switch now, new EDT not found after reload: not found + not activated, no switch, logged failed to the new EDT; Enter closes', async () => {
    const { store, switchCalls, logged } = step4Store({ existing: true });
    store.setState({ loadEdts: async () => {} }); // the reload never brings the new entry
    const { instance, stdout, stdin } = await mountWizard(store, true);
    try {
      await reachStep4(instance, stdin);
      await press(instance, stdin, KEYS.enter);
      await settle(instance);

      const frame = lastWizardFrame(stdout);
      expect(frame).toContain('could not be found');
      expect(frame).toContain('EDT created but not activated');
      expect(switchCalls).toHaveLength(0);
      expect(logged.map((entry) => [entry.ulid, entry.outcome])).toEqual([
        ['new-ulid', 'success'],
        ['new-ulid', 'failed'],
      ]);
      expect(logged[0]?.detail).toContain('(switch requested)');

      await expectClosedAfter(instance, stdout, () => press(instance, stdin, KEYS.enter));
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});

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
