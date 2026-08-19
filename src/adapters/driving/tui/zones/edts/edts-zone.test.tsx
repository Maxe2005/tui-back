// tui/zones/edts: render tests (AD-13 — Ink smoke coverage) for story 2.6's real EDTs zone
// content, covering every I/O-matrix row reachable from the TUI: upstream, no-upstream,
// offline, member vs. non-member (incl. kept-on-development), and long-branch-name
// truncation with the full name available in the detail pane once focused.
import { describe, it, expect } from 'vitest';
import type { ServiceBranchDivergence } from '../../../../../core/edt/list.js';
import type { NavigationKey } from '../../keybindings/index.js';
import { createAppStore } from '../../store/app-store.js';
import { renderToString } from '../../shared/components/render-to-string.js';
import {
  EdtsZone,
  formatIssuesSummary,
  formatServiceDetail,
  formatServiceMeta,
  jumpSelection,
  moveSelection,
  resolveSelectionDirection,
  resolveSelectionJump,
  truncateBranchLabel,
  BRANCH_MAX_WIDTH,
} from './edts-zone.js';

function service(overrides: Partial<ServiceBranchDivergence> = {}): ServiceBranchDivergence {
  return {
    service: 'route-explorer',
    path: '/repos/route-explorer',
    isMember: false,
    branch: 'main',
    ahead: 0,
    behind: 0,
    status: 'current',
    ...overrides,
  };
}

describe('truncateBranchLabel', () => {
  it('returns the branch unchanged when it fits within maxWidth', () => {
    expect(truncateBranchLabel('main', 24)).toBe('main');
  });

  it('ellipsizes past a fixed max width (matrix: "Branch name very long")', () => {
    const long = 'feature/a-very-long-branch-name-that-exceeds-the-display-width';
    const truncated = truncateBranchLabel(long, BRANCH_MAX_WIDTH);
    expect(truncated.length).toBe(BRANCH_MAX_WIDTH);
    expect(truncated.endsWith('…')).toBe(true);
    expect(long.startsWith(truncated.slice(0, -1))).toBe(true);
  });

  it('degrades gracefully at the edges (maxWidth 1 and 0)', () => {
    expect(truncateBranchLabel('main', 1)).toBe('…');
    expect(truncateBranchLabel('main', 0)).toBe('');
  });
});

describe('formatServiceMeta', () => {
  it('shows branch + both ahead/behind counts for a service with a configured upstream (AC1)', () => {
    expect(formatServiceMeta(service({ branch: 'main', ahead: 2, behind: 0, status: 'current' }))).toBe('main +2/-0');
  });

  it('shows an explicit "no upstream" state, not a numeric value (AC2)', () => {
    const meta = formatServiceMeta(service({ branch: 'main', ahead: null, behind: null, status: 'no-upstream' }));
    expect(meta).toContain('no upstream');
    expect(meta).not.toMatch(/\d/);
  });

  it('shows an explicit "unknown (offline)" state, not a stale/zero value (AC3)', () => {
    const meta = formatServiceMeta(service({ branch: 'main', ahead: null, behind: null, status: 'unknown-offline' }));
    expect(meta).toContain('unknown (offline)');
    expect(meta).not.toMatch(/\d/);
  });

  it('truncates a long branch name in the row meta', () => {
    const long = 'feature/a-very-long-branch-name-that-exceeds-the-display-width';
    const meta = formatServiceMeta(service({ branch: long }));
    expect(meta).toContain('…');
    expect(meta).not.toContain(long);
  });

  it('degrades to a placeholder when the branch itself is unknown (offline, branch: null)', () => {
    const meta = formatServiceMeta(service({ branch: null, status: 'unknown-offline' }));
    expect(meta).toContain('(unknown)');
  });
});

describe('formatServiceDetail', () => {
  it('always shows the full, untruncated branch name (matrix: full name available on focus)', () => {
    const long = 'feature/a-very-long-branch-name-that-exceeds-the-display-width';
    const detail = formatServiceDetail(service({ branch: long }));
    expect(detail).toContain(long);
  });
});

// Review patch: listEdtBranchesDivergence's unreachable/errors were computed but never
// surfaced by the TUI.
describe('formatIssuesSummary', () => {
  it('returns null when there is nothing to report', () => {
    expect(formatIssuesSummary(0, 0)).toBeNull();
  });

  it('reports unreachable count only', () => {
    expect(formatIssuesSummary(3, 0)).toBe('3 unreachable');
  });

  it('reports error count only, pluralized', () => {
    expect(formatIssuesSummary(0, 1)).toBe('1 error');
    expect(formatIssuesSummary(0, 2)).toBe('2 errors');
  });

  it('combines both counts', () => {
    expect(formatIssuesSummary(3, 2)).toBe('3 unreachable, 2 errors');
  });
});

// Review patch: the arrow-key row-focus transition, extracted to a pure function so it's
// unit-testable directly (the shared renderToString harness's fake stdin never emits data,
// so a useInput callback itself is registered but never invoked by any test in the repo).
// Story 2.7: canonical navigation contract — j/k/g/G retired in favor of arrows/Home/End.
// `noKey`: a fully-populated NavigationKey with every flag false, spread and overridden per
// case — mirrors the pattern already used in keybinding-help.test.tsx for the same type.
const noKey: NavigationKey = { upArrow: false, downArrow: false, home: false, end: false };

describe('resolveSelectionDirection', () => {
  it('maps downArrow to down and upArrow to up', () => {
    expect(resolveSelectionDirection({ ...noKey, downArrow: true })).toBe('down');
    expect(resolveSelectionDirection({ ...noKey, upArrow: true })).toBe('up');
  });

  // Also covers "retired keys (j/k/g/G) are inert": those characters produce a non-empty
  // `input` string in Ink but leave every `key` flag false — resolveSelectionDirection no
  // longer accepts `input` at all, so this is the only reachable state for j/k/g/G too.
  it('returns null when neither arrow key is pressed', () => {
    expect(resolveSelectionDirection(noKey)).toBeNull();
  });
});

describe('moveSelection', () => {
  it('moves down by one', () => {
    expect(moveSelection(0, 'down', 3)).toBe(1);
    expect(moveSelection(1, 'down', 3)).toBe(2);
  });

  it('moves up by one', () => {
    expect(moveSelection(2, 'up', 3)).toBe(1);
    expect(moveSelection(1, 'up', 3)).toBe(0);
  });

  it('clamps at the bottom bound — does not run past the last row', () => {
    expect(moveSelection(2, 'down', 3)).toBe(2);
  });

  it('clamps at the top bound — does not run before the first row', () => {
    expect(moveSelection(0, 'up', 3)).toBe(0);
  });

  it('always returns 0 for an empty list, either direction', () => {
    expect(moveSelection(0, 'down', 0)).toBe(0);
    expect(moveSelection(0, 'up', 0)).toBe(0);
  });
});

// Story 2.7: Home/End jump-to-top/bottom (matrix: "Jump to top" / "Jump to bottom" in the
// EDTs zone) — extracted as a pure function for the same testability reason as
// resolveSelectionDirection/moveSelection above.
describe('resolveSelectionJump', () => {
  it('maps Home to top and End to bottom', () => {
    expect(resolveSelectionJump({ ...noKey, home: true })).toBe('top');
    expect(resolveSelectionJump({ ...noKey, end: true })).toBe('bottom');
  });

  it('returns null when neither Home nor End is pressed (including j/k/g/G, which set no key flag)', () => {
    expect(resolveSelectionJump(noKey)).toBeNull();
  });
});

describe('jumpSelection', () => {
  it('jumps to the first row on top', () => {
    expect(jumpSelection('top', 5)).toBe(0);
  });

  it('jumps to the last row on bottom', () => {
    expect(jumpSelection('bottom', 5)).toBe(4);
  });

  it('always returns 0 for an empty list, either direction', () => {
    expect(jumpSelection('top', 0)).toBe(0);
    expect(jumpSelection('bottom', 0)).toBe(0);
  });
});

// A no-op stub for every render test below: `createAppStore()` (no deps, the same default
// every other zone test uses) still owns a *real* loadEdtsBranches action that early-returns
// an 'error' status when unwired (app-store.test.ts covers that path directly) — and
// EdtsZone calls it on mount. Left un-stubbed, that real call would race the state this test
// deliberately seeds and clobber edtsBranchesStatus/edtsBranchesError out from under it.
const noopLoad = async () => {};

describe('EdtsZone (story 2.6)', () => {
  it('shows a loading state before the first load resolves', async () => {
    const store = createAppStore();
    store.setState({ edtsBranchesStatus: 'loading', edtsBranches: null, loadEdtsBranches: noopLoad });
    const output = await renderToString(<EdtsZone useStore={store} />);
    expect(output).toContain('Loading services');
  });

  it('shows an explicit "no managed services" state, not a bare empty list', async () => {
    const store = createAppStore();
    store.setState({ edtsBranchesStatus: 'idle', edtsBranches: [], loadEdtsBranches: noopLoad });
    const output = await renderToString(<EdtsZone useStore={store} />);
    expect(output).toContain('No managed services found');
  });

  it('surfaces the store error state without exposing it as a per-row value', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranchesStatus: 'error',
      edtsBranchesError: 'registry-invalid-yaml: bad yaml',
      edtsBranches: null,
      loadEdtsBranches: noopLoad,
    });
    const output = await renderToString(<EdtsZone useStore={store} />);
    expect(output).toContain('Failed to load services');
    expect(output).toContain('registry-invalid-yaml');
  });

  it('renders a service with a configured upstream: branch + both ahead/behind counts (AC1)', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranchesStatus: 'idle',
      edtsBranches: [service({ service: 'api-gateway', branch: 'main', ahead: 2, behind: 1, status: 'current' })],
      loadEdtsBranches: noopLoad,
    });
    const output = await renderToString(<EdtsZone useStore={store} />);
    expect(output).toContain('api-gateway');
    expect(output).toContain('main +2/-1');
  });

  it('renders an explicit "no upstream" state for a service with none configured (AC2)', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranchesStatus: 'idle',
      edtsBranches: [service({ service: 'no-remote-svc', branch: 'main', ahead: null, behind: null, status: 'no-upstream' })],
      loadEdtsBranches: noopLoad,
    });
    const output = await renderToString(<EdtsZone useStore={store} />);
    expect(output).toContain('no-remote-svc');
    expect(output).toContain('no upstream');
  });

  it('renders an explicit "unknown (offline)" state, never stale/zero values (AC3)', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranchesStatus: 'idle',
      edtsBranches: [service({ service: 'offline-svc', branch: 'main', ahead: null, behind: null, status: 'unknown-offline' })],
      loadEdtsBranches: noopLoad,
    });
    const output = await renderToString(<EdtsZone useStore={store} />);
    expect(output).toContain('offline-svc');
    expect(output).toContain('unknown (offline)');
  });

  it('shows a member and a non-member (incl. one kept on development) uniformly, side by side (AC4)', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranchesStatus: 'idle',
      edtsBranches: [
        service({ service: 'member-svc', path: '/repos/member', isMember: true, branch: 'feat/x', ahead: 1, behind: 0 }),
        service({ service: 'kept-on-development', path: '/repos/kept', isMember: false, branch: 'development', ahead: 0, behind: 0 }),
      ],
      loadEdtsBranches: noopLoad,
    });
    const output = await renderToString(<EdtsZone useStore={store} />);
    expect(output).toContain('member-svc');
    expect(output).toContain('feat/x +1/-0');
    expect(output).toContain('kept-on-development');
    expect(output).toContain('development +0/-0');
  });

  it('truncates a long branch name in the row, and shows the full name in the detail pane for the focused (default first) row', async () => {
    const long = 'feature/a-very-long-branch-name-that-exceeds-the-display-width';
    const store = createAppStore();
    store.setState({
      edtsBranchesStatus: 'idle',
      edtsBranches: [service({ service: 'long-branch-svc', branch: long })],
      loadEdtsBranches: noopLoad,
    });
    const output = await renderToString(<EdtsZone useStore={store} />);
    expect(output).toContain(truncateBranchLabel(long, BRANCH_MAX_WIDTH));
    expect(output).toContain(long);
  });

  it('surfaces a per-row git-error detail via DimAnnotation in the detail pane, never inlined into the row (UX-DR17)', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranchesStatus: 'idle',
      edtsBranches: [
        service({
          service: 'detached-head-svc',
          branch: null,
          ahead: null,
          behind: null,
          status: 'unknown-offline',
          detail: { code: 'git-current-branch-error', message: 'HEAD is detached' },
        }),
      ],
      loadEdtsBranches: noopLoad,
    });
    const output = await renderToString(<EdtsZone useStore={store} />);
    expect(output).toContain('detached-head-svc');
    expect(output).toContain('(unknown)');
    expect(output).toContain('HEAD is detached');
  });

  it('never renders stale rows or a stale detail pane once a reload fails after a prior successful load (review patch)', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranchesStatus: 'error',
      edtsBranchesError: 'registry-invalid-yaml: bad yaml',
      // Deliberately still populated — simulates a *reload* that failed after an earlier
      // successful load had already put rows in the store (edtsBranches is never cleared on
      // error, mirroring how the store itself behaves — see app-store.test.ts).
      edtsBranches: [service({ service: 'stale-svc', branch: 'feat/stale' })],
      loadEdtsBranches: noopLoad,
    });
    const output = await renderToString(<EdtsZone useStore={store} />);
    expect(output).toContain('Failed to load services');
    expect(output).not.toContain('stale-svc');
    expect(output).not.toContain('feat/stale');
    expect(output).toContain('No service selected');
  });

  it('shows a brief unreachable/errors summary when either is non-empty (review patch)', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranchesStatus: 'idle',
      edtsBranches: [service({ service: 'api-gateway' })],
      edtsUnreachable: ['/repos/gone-a', '/repos/gone-b'],
      edtsErrors: [{ path: '/repos/bad', code: 'manifest-validation-failed', message: 'Invalid .tui-back.yaml' }],
      loadEdtsBranches: noopLoad,
    });
    const output = await renderToString(<EdtsZone useStore={store} />);
    expect(output).toContain('2 unreachable');
    expect(output).toContain('1 error');
  });

  it('shows no summary line when unreachable/errors are both empty', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranchesStatus: 'idle',
      edtsBranches: [service({ service: 'api-gateway' })],
      edtsUnreachable: [],
      edtsErrors: [],
      loadEdtsBranches: noopLoad,
    });
    const output = await renderToString(<EdtsZone useStore={store} />);
    expect(output).not.toContain('unreachable');
    expect(output).not.toContain('error');
  });

  it('hides a stale unreachable/errors summary once a reload fails, same as the row list (review patch)', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranchesStatus: 'error',
      edtsBranchesError: 'registry-invalid-yaml: bad yaml',
      edtsBranches: [service({ service: 'stale-svc' })],
      edtsUnreachable: ['/repos/gone-a'],
      edtsErrors: [{ path: '/repos/bad', code: 'manifest-validation-failed', message: 'Invalid .tui-back.yaml' }],
      loadEdtsBranches: noopLoad,
    });
    const output = await renderToString(<EdtsZone useStore={store} />);
    expect(output).not.toContain('unreachable');
    expect(output).not.toContain('manifest-validation-failed');
  });

  it('calls loadEdtsBranches on mount', async () => {
    let called = false;
    const store = createAppStore();
    store.setState({
      loadEdtsBranches: async () => {
        called = true;
      },
    });
    await renderToString(<EdtsZone useStore={store} />);
    expect(called).toBe(true);
  });
});
