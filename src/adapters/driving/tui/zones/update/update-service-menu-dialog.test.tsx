import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { resolveMenuKey } from '../../shared/components/menu-list.js';
import { renderToString } from '../../shared/components/render-to-string.js';
import { createAppStore } from '../../store/app-store.js';
import { UpdateZone } from './update-zone.js';
import {
  UPDATE_SERVICE_MENU_ITEMS,
  UPDATE_SERVICE_MENU_TITLE,
  resolveServiceMenuChoice,
  UPDATE_SERVICE_MENU_ESCAPE,
  visibleServiceMenuItems,
  UpdateServiceMenuDialog,
} from './update-service-menu-dialog.js';

describe('UPDATE_SERVICE_MENU_ITEMS with the shared menu reducer', () => {
  it('offers Update this service, Clean restart, and Cancel in menu order', () => {
    expect(UPDATE_SERVICE_MENU_ITEMS.map((item) => item.value)).toEqual(['update', 'restart', 'cancel']);
  });

  it('moves the cursor with arrows, clamped at the ends, and ignores anything else', () => {
    expect(resolveMenuKey({}, 1, UPDATE_SERVICE_MENU_ITEMS, UPDATE_SERVICE_MENU_ESCAPE)).toEqual({ type: 'ignore' });
    expect(resolveMenuKey({ downArrow: true }, 0, UPDATE_SERVICE_MENU_ITEMS, UPDATE_SERVICE_MENU_ESCAPE)).toEqual({ type: 'move', cursor: 1 });
    expect(resolveMenuKey({ downArrow: true }, 2, UPDATE_SERVICE_MENU_ITEMS, UPDATE_SERVICE_MENU_ESCAPE)).toEqual({ type: 'move', cursor: 2 });
    expect(resolveMenuKey({ upArrow: true }, 2, UPDATE_SERVICE_MENU_ITEMS, UPDATE_SERVICE_MENU_ESCAPE)).toEqual({ type: 'move', cursor: 1 });
    expect(resolveMenuKey({ upArrow: true }, 0, UPDATE_SERVICE_MENU_ITEMS, UPDATE_SERVICE_MENU_ESCAPE)).toEqual({ type: 'move', cursor: 0 });
    expect(resolveMenuKey({}, 0, UPDATE_SERVICE_MENU_ITEMS, UPDATE_SERVICE_MENU_ESCAPE)).toEqual({ type: 'ignore' });
  });

  it('jumps with Home/End', () => {
    expect(resolveMenuKey({ home: true }, 2, UPDATE_SERVICE_MENU_ITEMS, UPDATE_SERVICE_MENU_ESCAPE)).toEqual({ type: 'move', cursor: 0 });
    expect(resolveMenuKey({ end: true }, 0, UPDATE_SERVICE_MENU_ITEMS, UPDATE_SERVICE_MENU_ESCAPE)).toEqual({ type: 'move', cursor: 2 });
  });

  it('chooses the cursor row on Enter and cancels on Escape', () => {
    expect(resolveMenuKey({ return: true }, 0, UPDATE_SERVICE_MENU_ITEMS, UPDATE_SERVICE_MENU_ESCAPE)).toEqual({ type: 'choose', choice: 'update' });
    expect(resolveMenuKey({ return: true }, 1, UPDATE_SERVICE_MENU_ITEMS, UPDATE_SERVICE_MENU_ESCAPE)).toEqual({ type: 'choose', choice: 'restart' });
    expect(resolveMenuKey({ return: true }, 2, UPDATE_SERVICE_MENU_ITEMS, UPDATE_SERVICE_MENU_ESCAPE)).toEqual({ type: 'choose', choice: 'cancel' });
    expect(resolveMenuKey({ escape: true }, 0, UPDATE_SERVICE_MENU_ITEMS, UPDATE_SERVICE_MENU_ESCAPE)).toEqual({ type: 'choose', choice: 'cancel' });
  });

  it('ignores Enter on an out-of-range cursor', () => {
    expect(resolveMenuKey({ return: true }, 9, UPDATE_SERVICE_MENU_ITEMS, UPDATE_SERVICE_MENU_ESCAPE)).toEqual({ type: 'ignore' });
  });

  it('drops the restart row when no restart is available, keeping update/cancel order', () => {
    expect(visibleServiceMenuItems(true).map((item) => item.value)).toEqual(['update', 'restart', 'cancel']);
    expect(visibleServiceMenuItems(false).map((item) => item.value)).toEqual(['update', 'cancel']);
  });

  it('navigates and chooses within the visible rows when the restart row is hidden', () => {
    const items = visibleServiceMenuItems(false);
    expect(resolveMenuKey({ downArrow: true }, 1, items, UPDATE_SERVICE_MENU_ESCAPE)).toEqual({ type: 'move', cursor: 1 });
    expect(resolveMenuKey({ end: true }, 0, items, UPDATE_SERVICE_MENU_ESCAPE)).toEqual({ type: 'move', cursor: 1 });
    expect(resolveMenuKey({ return: true }, 0, items, UPDATE_SERVICE_MENU_ESCAPE)).toEqual({ type: 'choose', choice: 'update' });
    expect(resolveMenuKey({ return: true }, 1, items, UPDATE_SERVICE_MENU_ESCAPE)).toEqual({ type: 'choose', choice: 'cancel' });
    expect(resolveMenuKey({ return: true }, 2, items, UPDATE_SERVICE_MENU_ESCAPE)).toEqual({ type: 'ignore' });
  });
});

describe('resolveServiceMenuChoice', () => {
  const target = { service: 'svc-a', repoPath: '/repo/a' };

  it('routes update to the pre-scoped config with that row’s exact service and repoPath', () => {
    expect(resolveServiceMenuChoice('update', target)).toEqual({
      type: 'open-config',
      service: 'svc-a',
      repoPath: '/repo/a',
    });
  });

  it('routes restart to the standalone use-case with that row’s repoPath', () => {
    expect(resolveServiceMenuChoice('restart', target)).toEqual({ type: 'restart', repoPath: '/repo/a' });
  });

  it('routes cancel (and Esc’s cancel) to dismiss — no store call', () => {
    expect(resolveServiceMenuChoice('cancel', target)).toEqual({ type: 'dismiss' });
  });

  it('never mixes the rows: a different target’s identity flows through untouched', () => {
    expect(resolveServiceMenuChoice('update', { service: 'svc-b', repoPath: '/repo/b' })).toEqual({
      type: 'open-config',
      service: 'svc-b',
      repoPath: '/repo/b',
    });
    expect(resolveServiceMenuChoice('restart', { service: 'svc-b', repoPath: '/repo/b' })).toEqual({
      type: 'restart',
      repoPath: '/repo/b',
    });
  });
});

describe('UpdateServiceMenuDialog rendering', () => {  it('renders the modal title, the service name, and all three choices', async () => {
    const output = await renderToString(createElement(UpdateServiceMenuDialog, { service: 'svc-a', cursor: 0 }));

    expect(output).toContain(UPDATE_SERVICE_MENU_TITLE);
    expect(output).toContain('svc-a');
    for (const item of UPDATE_SERVICE_MENU_ITEMS) {
      expect(output).toContain(item.label);
    }
  });

  it('renders only update/cancel for a container-less service without a recipe', async () => {
    const output = await renderToString(
      createElement(UpdateServiceMenuDialog, { service: 'svc-lib', cursor: 0, items: visibleServiceMenuItems(false) }),
    );

    expect(output).toContain('Update this service');
    expect(output).toContain('Cancel');
    expect(output).not.toContain('Clean restart');
  });
});

const SERVICE_A = {
  service: 'svc-a',
  path: '/repo/a',
  isMember: true,
  sharedBranch: 'development',
  protectedBranches: [] as string[],
  branch: 'feat/a',
  ahead: 0,
  behind: 0,
  status: 'current' as const,
};

const noopLoad = async () => {};

describe('UpdateZone restarting row', () => {
  it('a service with a standalone restart in flight shows the restarting glyph, never updating or down', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranches: [SERVICE_A],
      edtsBranchesStatus: 'idle',
      edts: [
        {
          ulid: 'edt-1',
          topic: 'demo',
          createdAt: '2026-09-17T00:00:00.000Z',
          status: 'active' as const,
          members: [{ service: 'svc-a', repoPath: '/repo/a', branch: 'feat/a' }],
        },
      ],
      activeEdt: 'edt-1',
      serviceRestartInFlight: { '/repo/a': 'restart' },
      loadEdtsBranches: noopLoad,
      loadEdts: noopLoad,
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));
    const lines = output.split('\n');
    const row = lines.find((line) => line.includes('svc-a') && line.includes('+0/-0'));
    expect(row).toBeDefined();
    expect(row).toContain('↻');
    expect(row).not.toContain('⇄');
  });

  it('a failed last outcome still outranks raw health once the restart lands, via the merged outcome', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranches: [SERVICE_A],
      edtsBranchesStatus: 'idle',
      edts: null,
      activeEdt: null,
      lastServiceOutcomes: {
        'svc-a': {
          service: 'svc-a',
          outcome: 'failed',
          detail: { code: 'restart-failed', message: 'Repo /repo/a restart "npm ci" failed: boom' },
        },
      },
      loadEdtsBranches: noopLoad,
      loadEdts: noopLoad,
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).toContain('✖');
    expect(output).toContain('restart-failed');
  });
});
