// The bounded-rendering size matrix: every zone, plus the shell screens, rendered at four
// terminal sizes against adversarial data. No frame may exceed the terminal's rows, no line its
// columns, and the top bar and footer must stay on screen.
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { AppShell } from '../../app-shell.js';
import { createAppStore, type AppStore } from '../../store/app-store.js';
import { ZONES } from '../../zones/zones.js';
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
