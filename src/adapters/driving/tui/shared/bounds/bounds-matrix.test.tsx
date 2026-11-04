// The bounded-rendering size matrix: every zone, plus the shell screens, rendered at four
// terminal sizes against adversarial data. No frame may exceed the terminal's rows, no line its
// columns, and the top bar and footer must stay on screen.
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import type { ServiceStatusState } from '../../../../../core/service-status/index.js';
import { AppShell } from '../../app-shell.js';
import { createAppStore, type AppStore } from '../../store/app-store.js';
import { ZONES } from '../../zones/zones.js';
import { getZoneScreen } from '../../zones/index.js';
import { ZONE_LAYOUTS } from '../../zones/zone-layouts.js';
import { renderToString } from '../components/render-to-string.js';
import { MATRIX_SIZES, frameLines } from '../test-support/matrix.js';

const LONG = 'x'.repeat(5000);
const MULTILINE = `first line of a failure\n${'\u001b[31mred\u001b[0m '.repeat(40)}\nthird line ${LONG}`;

function adversarialStore(): AppStore {
  const store = createAppStore();
  const services = Array.from({ length: 200 }, (_, i) => ({
    service: `service-with-a-very-long-name-${i}-${'n'.repeat(60)}`,
    path: `/repos/service-${i}`,
    isMember: i % 3 === 0,
    branch: `feature/${'b'.repeat(80)}-${i}`,
    ahead: i,
    behind: i,
    status: 'current' as const,
    sharedBranch: 'development',
    protectedBranches: [],
  }));
  const edts = Array.from({ length: 100 }, (_, i) => ({
    ulid: `ulid-${i}`,
    topic: `topic-${i}-${'t'.repeat(120)}`,
    createdAt: '2026-01-01T00:00:00Z',
    status: 'active' as const,
    members: services.slice(0, 40).map((s) => ({ service: s.service, repoPath: s.path, branch: s.branch })),
  }));
  store.setState({
    edts,
    edtsStatus: 'idle',
    activeEdt: 'ulid-0',
    edtsBranches: services,
    edtsBranchesStatus: 'idle',
    edtsErrors: Array.from({ length: 60 }, (_, i) => ({ path: `/repos/broken-${i}`, code: 'git-error', message: MULTILINE })),
    edtsUnreachable: Array.from({ length: 60 }, (_, i) => `/repos/unreachable-${i}-${'u'.repeat(200)}`),
    updateStatus: 'error',
    updateError: MULTILINE,
    updateErrorCode: 'boom',
    updateNotice: { code: 'x', message: MULTILINE },
    updateResults: services.map((s) => ({
      service: s.service,
      outcome: 'failed' as const,
      detail: { code: 'merge-conflict', message: MULTILINE },
    })),
    liveServiceIssues: Object.fromEntries(
      services.slice(0, 5).map((s) => [
        s.service,
        Array.from({ length: 300 }, (_, i) => ({ kind: 'conflict', detail: MULTILINE, resolved: i % 2 === 0 })),
      ]),
    ),
    resetNotice: MULTILINE,
    loadEdts: async () => {},
    loadEdtsBranches: async () => {},
    loadTabVisibility: async () => {},
    loadSettings: async () => {},
    loadSplitterRatios: async () => {},
    loadFilterHistory: async () => {},
  } as never);
  return store;
}

describe('size matrix: zones', () => {
  for (const zone of ZONES) {
    for (const size of MATRIX_SIZES) {
      it(`${zone.id} at ${size.columns}x${size.rows} stays inside the terminal`, async () => {
        const store = adversarialStore();
        store.getState().setActiveZone(zone.id);
        const frame = frameLines(await renderToString(createElement(AppShell, { useStore: store, onQuit: () => {} }), size));
        expect(frame.length).toBeLessThanOrEqual(size.rows);
        for (const line of frame) {
          expect(Array.from(line).length, line).toBeLessThanOrEqual(size.columns);
        }
        expect(frame[0]).toContain('tui-back');
        expect(frame.at(-1)?.trim()).not.toBe('');
      });
    }
  }
});

const OVERLAYS: Record<string, Record<string, unknown>> = {
  help: { helpOpen: true },
  'command bar': { commandBarOpen: true },
  settings: { settingsScreenOpen: true },
  reset: { resetScreenOpen: true, resetStatus: 'idle', resetError: MULTILINE },
  registry: {
    registryScreenOpen: true,
    registryScanResult: {
      candidates: Array.from({ length: 300 }, (_, i) => `/very/long/path/${'p'.repeat(100)}/repo-${i}`),
      skipped: [],
    },
    registryScanError: MULTILINE,
  },
};

const OVERLAY_TITLES: Record<string, string> = { 'command bar': 'COMMAND', settings: 'SETTINGS', registry: 'REPO REGISTRY' };

describe('size matrix: overlays', () => {
  for (const [name, state] of Object.entries(OVERLAYS)) {
    for (const size of MATRIX_SIZES) {
      it(`${name} over the EDTs zone at ${size.columns}x${size.rows} stays inside the terminal`, async () => {
        const store = adversarialStore();
        store.getState().setActiveZone('edts');
        store.setState(state as never);
        const frame = frameLines(await renderToString(createElement(AppShell, { useStore: store, onQuit: () => {} }), size));
        expect(frame.length).toBeLessThanOrEqual(size.rows);
        for (const line of frame) {
          expect(Array.from(line).length, line).toBeLessThanOrEqual(size.columns);
        }
        expect(frame[0]).toContain('tui-back');
        expect(frame.at(-1)?.trim()).not.toBe('');
        const title = OVERLAY_TITLES[name];
        if (title !== undefined && size.rows >= 24) expect(frame.join('\n')).toContain(title);
      });
    }
  }
});

describe('zone registries', () => {
  it('has a screen and a layout for every zone', () => {
    for (const zone of ZONES) {
      expect(getZoneScreen(zone.id), zone.id).toBeDefined();
      expect(ZONE_LAYOUTS[zone.id], zone.id).toBeDefined();
    }
    expect(Object.keys(ZONE_LAYOUTS).sort()).toEqual(ZONES.map((zone) => zone.id).sort());
  });
});

describe('size matrix: Logs with many selected services', () => {
  for (const size of MATRIX_SIZES) {
    it(`logs with 60 streaming panes at ${size.columns}x${size.rows} stays inside the terminal`, async () => {
      const store = adversarialStore();
      const services = (store.getState().edtsBranches ?? []).slice(0, 60);
      store.setState({
        logsEdtSelected: services.filter((s) => s.isMember).map((s) => s.path),
        logsOtherSelected: services.filter((s) => !s.isMember).map((s) => s.path),
        // Health-first states on the badges: unhealthy / inconsistent panes and rows.
        logsListedHealth: Object.fromEntries(services.map((s, i) => [s.path, i % 2 === 0 ? 'unhealthy' : 'inconsistent'])),
        logsPanes: Object.fromEntries(
          services.map((s, i) => [
            s.path,
            {
              repoPath: s.path,
              service: s.service,
              lines: Array.from({ length: 80 }, (_, i) => ({ stream: 'stdout', text: `line ${i} ${'w'.repeat(300)}`, timestamp: '2026-01-01T00:00:00Z' })),
              streamError: { code: 'stream-failed', message: MULTILINE },
              noMoreHistory: false,
              scrollOffset: 0,
              health: i % 2 === 0 ? 'unhealthy' : 'inconsistent',
              restarting: i % 3 === 0,
            },
          ]),
        ),
      } as never);
      store.getState().setActiveZone('logs');
      const frame = frameLines(await renderToString(createElement(AppShell, { useStore: store, onQuit: () => {} }), size));
      expect(frame.length).toBeLessThanOrEqual(size.rows);
      for (const line of frame) {
        expect(Array.from(line).length, line).toBeLessThanOrEqual(size.columns);
      }
      expect(frame[0]).toContain('tui-back');
      expect(frame.at(-1)?.trim()).not.toBe('');
    });
  }
});

describe('size matrix: Update zone with health-first states', () => {
  for (const size of MATRIX_SIZES) {
    it(`update list of unhealthy / inconsistent services at ${size.columns}x${size.rows} stays inside the terminal`, async () => {
      const store = adversarialStore();
      const services = store.getState().edtsBranches ?? [];
      const updateServiceHealth: Record<string, ServiceStatusState> = Object.fromEntries(
        services.map((s, i) => [s.path, i % 2 === 0 ? 'unhealthy' : 'inconsistent']),
      );
      store.setState({ updateStatus: 'idle', updateResults: [], updateServiceHealth });
      store.getState().setActiveZone('update');
      const frame = frameLines(await renderToString(createElement(AppShell, { useStore: store, onQuit: () => {} }), size));
      expect(frame.length).toBeLessThanOrEqual(size.rows);
      for (const line of frame) {
        expect(Array.from(line).length, line).toBeLessThanOrEqual(size.columns);
      }
      expect(frame[0]).toContain('tui-back');
    });
  }
});

describe('size matrix: Update zone mid-run', () => {
  for (const size of MATRIX_SIZES) {
    it(`update running with 200 members at ${size.columns}x${size.rows} stays inside the terminal`, async () => {
      const store = adversarialStore();
      const services = store.getState().edtsBranches ?? [];
      const edts = store.getState().edts ?? [];
      store.setState({
        updateStatus: 'running',
        updateTopic: 'ulid-0',
        edts: edts.map((entry, index) =>
          index === 0 ? { ...entry, members: services.map((s) => ({ service: s.service, repoPath: s.path, branch: s.branch ?? 'main' })) } : entry,
        ),
      } as never);
      store.getState().setActiveZone('update');
      const frame = frameLines(await renderToString(createElement(AppShell, { useStore: store, onQuit: () => {} }), size));
      expect(frame.length).toBeLessThanOrEqual(size.rows);
      for (const line of frame) {
        expect(Array.from(line).length, line).toBeLessThanOrEqual(size.columns);
      }
      expect(frame[0]).toContain('tui-back');
      expect(frame.at(-1)?.trim()).not.toBe('');
    });
  }
});

describe('size matrix: Shared types zone', () => {
  const states = ['form', 'running', 'done', 'blocked', 'publish-done', 'publish-blocked'] as const;
  for (const state of states) {
    for (const size of MATRIX_SIZES) {
      it(`${state} with 200 consumers at ${size.columns}x${size.rows} stays inside the terminal`, async () => {
        const store = adversarialStore();
        const consumers = Array.from({ length: 200 }, (_, i) => ({
          service: `consumer-with-a-long-name-${i}-${'c'.repeat(60)}`,
          repoPath: `/repos/consumer-${i}`,
          dependency: `@scope/${'d'.repeat(60)}`,
          branch: `feature/${'b'.repeat(80)}`,
        }));
        store.setState({
          tabVisibility: { routes: { status: 'omitted', carryingServices: [] }, sharedTypes: { status: 'enabled', carryingServices: [] } },
          sharedTypesConsumers: consumers,
          sharedTypesConsumersStatus: 'ready',
          sharedTypesIssues: consumers.slice(0, 30).map((c) => ({ repoPath: c.repoPath, service: c.service, message: MULTILINE })),
          // Keep the seeded state: the zone's mount effects would otherwise reload (and fail) it.
          loadSharedTypesConsumers: async () => {},
          loadSharedTypesSource: async () => {},
          sharedTypesSources: [{ service: `source-${'s'.repeat(80)}`, repoPath: '/repos/source', branch: 'main', publishCommand: 'npm run v', packageName: '@scope/types' }],
          sharedTypesSourcesStatus: 'ready',
          sharedTypesSourceIssues: [],
          sharedTypesSourcesError: null,
          sharedTypesPublish:
            state === 'publish-done'
              ? { status: 'done', version: `0.1.${'9'.repeat(80)}`, output: MULTILINE, error: null, notice: MULTILINE }
              : state === 'publish-blocked'
                ? { status: 'blocked', version: null, output: MULTILINE, error: { code: 'publish-failed', message: MULTILINE }, notice: MULTILINE }
                : { status: 'idle', version: null, output: null, error: null, notice: null },
          sharedTypesRun: {
            status: state === 'form' || state === 'publish-done' || state === 'publish-blocked' ? 'idle' : state,
            version: '0.1.0',
            options: {},
            blocked: state === 'blocked' ? { code: 'boom', message: MULTILINE } : null,
            results:
              state === 'done' ? consumers.map((c) => ({ repoPath: c.repoPath, service: c.service, outcome: 'failed', detail: MULTILINE })) : [],
            live: null,
            notice: state === 'done' ? MULTILINE : null,
          },
        } as never);
        store.getState().setActiveZone('shared-types');
        const frame = frameLines(await renderToString(createElement(AppShell, { useStore: store, onQuit: () => {} }), size));
        expect(frame.length).toBeLessThanOrEqual(size.rows);
        for (const line of frame) {
          expect(Array.from(line).length, line).toBeLessThanOrEqual(size.columns);
        }
        expect(frame[0]).toContain('tui-back');
        expect(frame.at(-1)?.trim()).not.toBe('');
        // The highlighted choice is on screen at every size: the menu sits above output/notice.
        if (state === 'publish-done') {
          expect(frame.some((line) => line.includes('›') && line.includes('Propagate')), frame.join('\n')).toBe(true);
        }
        if (state === 'publish-blocked') {
          expect(frame.some((line) => line.includes('›') && line.includes('Relaunch')), frame.join('\n')).toBe(true);
        }
      });
    }
  }
});
