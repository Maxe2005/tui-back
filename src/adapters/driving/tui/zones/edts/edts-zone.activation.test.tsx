// EdtsZone real-keypress tests: activation.
import { render } from 'ink';
import { describe, it, expect, vi } from 'vitest';
import type { Result } from '../../../../../core/result.js';
import type { ActivateEdtData } from '../../../../../core/edt/activate.js';
import type { CreateEdtData } from '../../../../../core/edt/create.js';
import type { SwitchActiveEdtData, SwitchDirtyReposChoice } from '../../../../../core/edt/switch.js';
import { createAppStore } from '../../store/app-store.js';
import { FakeTtyStdout, KEYS } from '../../shared/test-support/fake-tty.js';
import { EdtsZone } from './edts-zone.js';
import { CREATE_WIZARD_TITLE as WIZARD_TITLE } from './dialogs/create-wizard/create-wizard.js';
import { footerIdOf } from '../../shared/test-support/mount-for-test.js';
import { edt, press, pressEscape, settle, lastWizardFrame, step3Store, reachStep3, mount } from './edts-zone.test-support.js';

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
