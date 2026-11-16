// tui/zones/dashboard: the data-filled Dashboard across the size matrix — no frame exceeds the
// terminal and both banner lines stay intact wherever the shell does not show its too-small screen.
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { AppShell } from '../../app-shell.js';
import { createAppStore, type AppStore } from '../../store/app-store.js';
import { renderToString } from '../../shared/components/render-to-string.js';
import { MATRIX_SIZES, frameLines } from '../../shared/test-support/matrix.js';
import { BANNER_LINES } from './launch-banner.js';

const LONG = 'x'.repeat(300);

// Anomalous rows cycle through the health-first states, with an unbounded probe reason and
// container error, so the unhealthy / inconsistent rendering is covered across the matrix.
function statusFor(i: number) {
  switch (i % 3) {
    case 0:
      return { ok: true as const, value: { state: 'unhealthy' as const, verified: true, container: 'up' as const, probeReason: `HTTP 503 ${LONG}` } };
    case 1:
      return { ok: true as const, value: { state: 'inconsistent' as const, verified: true, container: 'restarting' as const } };
    default:
      return { ok: true as const, value: { state: 'up' as const, verified: true, container: null, containerError: { code: 'docker-unavailable', message: LONG } } };
  }
}

function row(i: number, overrides: Record<string, unknown> = {}) {
  return {
    service: `service-${i}-${LONG}`,
    path: `/r/service-${i}`,
    manifest: { ok: true as const, value: { sharedBranch: 'development', protectedBranches: [] } },
    status: { ok: true as const, value: { state: 'up' as const, verified: false, container: 'up' as const } },
    branch: `feature/${LONG}`,
    divergence: { status: 'current' as const, ahead: 1, behind: 3 },
    workingTree: { ok: true as const, value: { uncommitted: true, mergeInProgress: false, rebaseInProgress: false } },
    protectedBranch: i % 2 === 0,
    usedByEdts: [`other-${LONG}`],
    expectedBranch: `expected/${LONG}`,
    drift: 'drifted' as const,
    ...overrides,
  };
}

const REGISTRY = { repoCount: 40, invalidManifests: 2, unreachable: 1, listingIssues: 3 };
const CLEAR_REGISTRY = { repoCount: 40, invalidManifests: 0, unreachable: 0, listingIssues: 0 };

type State = 'anomalies' | 'all-clear' | 'no-edt';

function storeFor(state: State): AppStore {
  const store = createAppStore();
  const calm = (i: number) => row(i, { protectedBranch: false, usedByEdts: [], branch: 'feat/x', expectedBranch: 'feat/x', drift: 'aligned', divergence: { status: 'current', ahead: 0, behind: 0 }, workingTree: { ok: true, value: { uncommitted: false, mergeInProgress: false, rebaseInProgress: false } } });
  const others = Array.from({ length: 10 }, (_, i) => ({
    service: `other-${i}-${LONG}`,
    path: `/r/other-${i}`,
    branch: i % 2 === 0 ? null : `hotfix/${LONG}`,
    expectedBranch: `develop-${LONG}`,
    drift: 'drifted' as const,
  }));
  const services = Array.from({ length: 30 }, (_, i) => (state === 'anomalies' ? row(i, { status: statusFor(i) }) : calm(i)));
  store.setState({
    registryEmpty: false,
    checkRegistryEmpty: async () => {},
    loadDashboard: async () => {},
    loadEdts: async () => {},
    loadEdtsBranches: async () => {},
    loadTabVisibility: async () => {},
    loadSettings: async () => {},
    loadSplitterRatios: async () => {},
    loadFilterHistory: async () => {},
    loadLogsRules: async () => {},
    edts: state === 'no-edt' ? [] : [{ ulid: 'e', topic: LONG } as never],
    dashboardServicesStatus: 'ready',
    dashboardRegistryStatus: 'ready',
    dashboardRegistry: state === 'anomalies' ? REGISTRY : CLEAR_REGISTRY,
    dashboardUpdatedAt: Date.now(),
    dashboardServices:
      state === 'no-edt'
        ? { status: 'no-active-edt', edt: null, services: [], others: [] }
        : { status: 'active', edt: { ulid: 'e', topic: LONG, serviceCount: services.length }, services, others: state === 'anomalies' ? others : [] },
    dashboardActionState:
      state === 'all-clear' ? { '/r/service-0': { running: { text: `Restarting ${LONG}` }, result: null } } : {},
  } as never);
  store.getState().setActiveZone('dashboard');
  return store;
}

describe('Dashboard size matrix', () => {
  for (const state of ['anomalies', 'all-clear', 'no-edt'] as const) {
    for (const size of MATRIX_SIZES) {
      it(`${state} at ${size.columns}x${size.rows} stays inside the terminal with the banner intact`, async () => {
        const frame = frameLines(await renderToString(createElement(AppShell, { useStore: storeFor(state), onQuit: () => {} }), size));
        expect(frame.length).toBeLessThanOrEqual(size.rows);
        for (const line of frame) {
          expect(Array.from(line).length, line).toBeLessThanOrEqual(size.columns);
        }
        const text = frame.join('\n');
        for (const line of BANNER_LINES) {
          expect(text).toContain(line);
        }
        if (size.rows >= 24) {
          expect(text).toContain(state === 'no-edt' ? '[e] ▸ Create a first EDT' : '[e] ▸');
        }
      });
    }
  }
});
