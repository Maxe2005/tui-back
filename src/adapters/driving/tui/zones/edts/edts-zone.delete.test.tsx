// EdtsZone real-keypress tests: delete.
import { describe, it, expect } from 'vitest';
import { createAppStore } from '../../store/app-store.js';
import { KEYS } from '../../shared/test-support/fake-tty.js';
import { EdtsZone } from './edts-zone.js';
import { edt, press, pressEscape, mount } from './edts-zone.test-support.js';

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
