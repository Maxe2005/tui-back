// EdtsZone real-keypress tests: the read-only system "Shared branches" EDT (Enter / f / refusal notice).
import { describe, it, expect, vi } from 'vitest';
import { createAppStore } from '../../../../store/app-store.js';
import { KEYS } from '../../../../shared/test-support/fake-tty.js';
import { SHARED_EDT_ULID, SHARED_EDT_TOPIC } from '../../../../../../../core/workspace/edt/shared-edt/shared-edt.js';
import { CREATE_WIZARD_TITLE as WIZARD_TITLE } from '../../dialogs/create-wizard/create-wizard.js';
import { footerIdOf } from '../../../../shared/test-support/mount-for-test.js';
import { edt, press, pressEscape, mount } from '../../edts-zone.test-support.js';

describe('EdtsZone system EDT interactions', () => {
  function systemStore(withUser: boolean) {
    const store = createAppStore();
    const system = edt({ ulid: SHARED_EDT_ULID, topic: SHARED_EDT_TOPIC, kind: 'system-shared', members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }] });
    store.setState({
      edts: withUser ? [system, edt({ ulid: 'user-ulid', topic: 'mine' })] : [system],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [
        { service: 'svc-a', path: '/repos/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'main', protectedBranches: [] },
        { service: 'svc-b', path: '/repos/b', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'main', protectedBranches: [] },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });
    return store;
  }

  it.each(['modify', 'delete'] as const)('the %s command on the system EDT shows the readonly notice and opens no dialog', async (type) => {
    const store = systemStore(true);
    store.setState({ currentEdtAction: { type, target: SHARED_EDT_TOPIC, startedAt: new Date().toISOString() } });
    const { instance, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await instance.waitUntilRenderFlush();
      expect(stdout.output).not.toContain('DELETE EDT');
      expect(stdout.output).not.toContain('MODIFY EDT');
      expect(footerIdOf(store)).not.toBe('menu');
      expect(stdout.output).toContain('edt-system-readonly');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('create-from on the system EDT opens the quick-pick with the notice, never a seeded wizard', async () => {
    const store = systemStore(true);
    store.setState({ currentEdtAction: { type: 'create-from', target: SHARED_EDT_TOPIC, startedAt: new Date().toISOString() } });
    const { instance, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('SELECT EDT TO COPY');
      expect(stdout.output).toContain('edt-system-readonly');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Enter on the EDT SERVICES and OTHER SERVICES panes of the system EDT shows the notice, no dialog', async () => {
    const store = systemStore(false);
    // Only the system EDT: the wizard auto-opens (no user EDT); Esc closes it.
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain(WIZARD_TITLE);
      await pressEscape(instance, stdin);
      for (const _pane of ['edt-services', 'other-services']) {
        await press(instance, stdin, KEYS.tab);
        const before = stdout.output.length;
        await press(instance, stdin, KEYS.enter);
        const added = stdout.output.slice(before);
        expect(added).toContain('edt-system-readonly');
        expect(added).not.toContain('SERVICE ACTIONS');
        await press(instance, stdin, KEYS.down);
      }
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('system "Shared branches" EDT: Enter switches when inactive; when active it explains the read-only rule and opens no dialog', async () => {
    const store = createAppStore();
    const system = edt({ ulid: SHARED_EDT_ULID, topic: SHARED_EDT_TOPIC, kind: 'system-shared' });
    store.setState({
      edts: [system, edt({ ulid: 'user-ulid', topic: 'mine' })],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('[shared]');
      expect(footerIdOf(store)).toBe('edts-system-switch');
      await press(instance, stdin, KEYS.enter);
      expect(stdout.output).toContain('SWITCH EDT');
      await pressEscape(instance, stdin);

      store.setState({ activeEdt: SHARED_EDT_ULID });
      await instance.waitUntilRenderFlush();
      expect(footerIdOf(store)).toBe('edts-system-fast-forward');
      await press(instance, stdin, KEYS.enter);
      expect(stdout.output).toContain('edt-system-readonly');
      expect(footerIdOf(store)).toBe('edts-system-fast-forward');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('system "Shared branches" EDT: `f` runs the fast-forward quick action and lists a row per service in a closable dialog', async () => {
    const store = createAppStore();
    const system = edt({ ulid: SHARED_EDT_ULID, topic: SHARED_EDT_TOPIC, kind: 'system-shared' });
    const fastForwardShared = vi.fn(async () => ({
      ok: true as const,
      data: {
        rows: [
          { service: 'svc-ok', repoPath: '/r/a', branch: 'development', outcome: 'fast-forwarded' as const },
          { service: 'svc-dirty', repoPath: '/r/b', branch: 'development', outcome: 'skipped' as const, reason: 'dirty' as const },
          { service: 'svc-down', repoPath: '/r/c', branch: 'development', outcome: 'failed' as const, detail: 'origin unreachable' },
        ],
      },
    }));
    const switchEdt = vi.fn();
    store.setState({
      edts: [system, edt({ ulid: 'user-ulid', topic: 'mine' })],
      edtsStatus: 'idle',
      activeEdt: 'user-ulid',
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      fastForwardShared,
      switchEdt,
    } as never);
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'f');
      await instance.waitUntilRenderFlush();
      expect(fastForwardShared).toHaveBeenCalledTimes(1);
      expect(switchEdt).not.toHaveBeenCalled();
      expect(stdout.output).toContain('FAST-FORWARD SHARED BRANCHES');
      expect(stdout.output).toContain('✔ svc-ok — fast-forwarded');
      expect(stdout.output).toContain('– svc-dirty — skipped (dirty)');
      expect(stdout.output).toContain('✖ svc-down — failed: origin unreachable');
      expect(footerIdOf(store)).toBe('close');
      await pressEscape(instance, stdin);
      expect(footerIdOf(store)).toBe('edts-system-switch');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('`f` turns a rejected fast-forward into an error dialog instead of staying stuck running', async () => {
    const store = createAppStore();
    const system = edt({ ulid: SHARED_EDT_ULID, topic: SHARED_EDT_TOPIC, kind: 'system-shared' });
    store.setState({
      edts: [system, edt({ ulid: 'user-ulid', topic: 'mine' })],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      fastForwardShared: async () => {
        throw new Error('boom');
      },
    } as never);
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'f');
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('fast-forward-failed: boom');
      expect(footerIdOf(store)).toBe('close');
      await pressEscape(instance, stdin);
      expect(footerIdOf(store)).not.toBe('close');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('`f` does nothing on a user EDT row (the action is unavailable there)', async () => {
    const store = createAppStore();
    const fastForwardShared = vi.fn();
    store.setState({
      edts: [edt({ ulid: 'user-ulid', topic: 'mine' })],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      fastForwardShared,
    } as never);
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'f');
      expect(fastForwardShared).not.toHaveBeenCalled();
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});
