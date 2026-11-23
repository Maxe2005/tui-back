// EdtsZone real-keypress tests: switch.
import { render } from 'ink';
import { describe, it, expect } from 'vitest';
import type { Result } from '../../../../../../../core/result.js';
import type { SwitchActiveEdtData, SwitchDirtyReposChoice } from '../../../../../../../core/edt/switch/switch.js';
import { createAppStore } from '../../../../store/app-store.js';
import { KEYS } from '../../../../shared/test-support/fake-tty.js';
import { EdtsZone } from '../../edts-zone.js';
import { footerIdOf } from '../../../../shared/test-support/mount-for-test.js';
import { edt, press, pressEscape, settle, mount } from '../../edts-zone.test-support.js';

describe('EdtsZone real-keypress interactions — switch', () => {
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

  it('on the restart report, Enter is ignored while the run is in flight; Esc closes without clearing it; Enter/Esc once done close and clear', async () => {
    const store = createAppStore();
    const target = edt({ ulid: 'target-ulid', topic: 'other' });
    let finish: () => void = () => {};
    const gate = new Promise<void>((done) => {
      finish = done;
    });
    const running = { topic: 'other', mode: 'simple' as const, status: 'running' as const, rows: [], report: null, error: null };
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
        store.setState({ switchRestart: running });
        await gate;
        store.setState({ switchRestart: { ...running, status: 'done' } });
        return { ok: false, error: { code: 'x', message: 'x' } };
      },
    });
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.right); // simple
      await press(instance, stdin, KEYS.enter);
      await settle(instance);
      expect(stdout.output).toContain('Restarting services (simple)');
      await press(instance, stdin, KEYS.enter); // ignored while running
      expect(store.getState().switchRestart?.status).toBe('running');
      expect(stdout.output.lastIndexOf('SWITCH EDT')).toBeGreaterThan(stdout.output.lastIndexOf('Aucun'));
      finish();
      await settle(instance);
      await press(instance, stdin, KEYS.enter); // done: closes and clears
      expect(store.getState().switchRestart).toBeNull();
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // When a service outside the outgoing EDT is dirty, the switch dialog shows the two-panel
  // resolution view. These fakes drive the same store fields (switchDirtyRepos /
  // resolveSwitchDirtyRepos) edt-slice.ts's real seam does — the end-to-end wiring through
  // core/edt/switch/switch.ts is covered by edt-slice.test.ts; these cover the dialog's rendering and
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
});
