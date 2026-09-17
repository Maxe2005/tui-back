// tui/zones/edts: render tests (AD-13 — Ink smoke coverage) for story 2.6's real EDTs zone
// content, covering every I/O-matrix row reachable from the TUI: upstream, no-upstream,
// offline, member vs. non-member (incl. kept-on-development), and long-branch-name
// truncation with the full name available in the detail pane once focused.
import { describe, it, expect } from 'vitest';
import type { ServiceBranchDivergence } from '../../../../../core/edt/list.js';
import type { EdtRegistryEntry } from '../../../../../core/ports/edt-registry.js';
import type { NavigationKey } from '../../keybindings/index.js';
import { createAppStore } from '../../store/app-store.js';
import { renderToString } from '../../shared/components/render-to-string.js';
import { resolveSplitFlex } from '../../shared/components/list-detail-split.js';
import { NO_BRANCH_CREATION } from '../../store/app-store.js';
import { EdtsZone } from './edts-zone.js';
import {
  advanceCreateFormFocus,
  appendHint,
  buildCreateBranchOptions,
  canEditMemberBranch,
  cycleFormFocus,
  cyclePaneFocus,
  formatAvailableActionsHint,
  formatEdtActionHistory,
  formatEdtDetail,
  formatEdtRowMeta,
  formatIssuesSummary,
  formatServiceDetail,
  formatServiceMeta,
  isBranchStepFocus,
  isSwitchBlockedError,
  jumpSelection,
  moveSelection,
  nextTextInputValue,
  partitionServicesByEdtMembership,
  prefillBranchNames,
  prefillBaseBranches,
  resolveBaseBranchMode,
  resolveCandidateListState,
  resolveActionHint,
  resolveModifyEnterAction,
  resolveModifyOps,
  resolveSelectionDirection,
  resolveSelectionJump,
  suggestBaseBranchFor,
  suggestBranchForNewMember,
  suggestBranchNameFromTopic,
  summarizeFailedResults,
  toggleMemberSelection,
  truncateBranchLabel,
  validateBranchEditValue,
  validateCreateBranchFields,
  BRANCH_MAX_WIDTH,
} from './edts-zone.logic.js';

function edtEntry(overrides: Partial<EdtRegistryEntry> = {}): EdtRegistryEntry {
  return {
    ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
    topic: 'demo',
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'inactive',
    members: [],
    ...overrides,
  };
}

function service(overrides: Partial<ServiceBranchDivergence> = {}): ServiceBranchDivergence {
  return {
    service: 'route-explorer',
    path: '/repos/route-explorer',
    isMember: false,
    branch: 'main',
    ahead: 0,
    behind: 0,
    status: 'current',
    sharedBranch: 'development',
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
const noKey: NavigationKey = { upArrow: false, downArrow: false, home: false, end: false, tab: false };

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
    // Story 2.9: the SERVICES detail pane (where this error surfaces) is only rendered
    // while the SERVICES pane is focused — the EDT selector is focused by default now.
    const output = await renderToString(<EdtsZone useStore={store} initialPaneFocus="other-services" />);
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
    const output = await renderToString(<EdtsZone useStore={store} initialPaneFocus="other-services" />);
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
    const output = await renderToString(<EdtsZone useStore={store} initialPaneFocus="other-services" />);
    // Bugfix (story 2.21 follow-up #2): the list pane's width is now genuinely ratio-bound
    // (list-detail-split.tsx), so this row's label — combined with its long "unknown (offline)"
    // meta — no longer fits the column and cleanly truncates with an ellipsis (list-row.tsx).
    // The detail pane's own title (never truncated — full name is DetailPane's whole point)
    // still carries the untruncated, upper-cased name, so this assertion is case-insensitive
    // rather than tied to the row's own (now-truncated) rendering.
    expect(output.toLowerCase()).toContain('detached-head-svc');
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
    const output = await renderToString(<EdtsZone useStore={store} initialPaneFocus="other-services" />);
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

// ==========================================================================================
// Story 2.9 — EDTs zone: create, switch, and modify
// ==========================================================================================

describe('cyclePaneFocus', () => {
  it('cycles edts -> edt-services -> other-services -> edts (story 2.18: 3-way)', () => {
    expect(cyclePaneFocus('edts')).toBe('edt-services');
    expect(cyclePaneFocus('edt-services')).toBe('other-services');
    expect(cyclePaneFocus('other-services')).toBe('edts');
  });
});

describe('cycleFormFocus', () => {
  it('cycles topic <-> members', () => {
    expect(cycleFormFocus('topic')).toBe('members');
    expect(cycleFormFocus('members')).toBe('topic');
  });
});

describe('nextTextInputValue (story 2.32: {value, cursor} shape, real cursor navigation)', () => {
  it('appends a typed character at the end when cursor trails the value', () => {
    expect(nextTextInputValue({ value: 'ab', cursor: 2 }, 'c', {})).toEqual({ value: 'abc', cursor: 3 });
  });

  it('inserts a typed character mid-string at cursor (I/O matrix: "Mid-string insert")', () => {
    expect(nextTextInputValue({ value: 'abd', cursor: 2 }, 'c', {})).toEqual({ value: 'abcd', cursor: 3 });
  });

  it('backspaces the character before cursor (I/O matrix: "Backspace")', () => {
    expect(nextTextInputValue({ value: 'abcd', cursor: 2 }, '', { backspace: true })).toEqual({ value: 'acd', cursor: 1 });
  });

  it('backspace at cursor 0 is a no-op (I/O matrix: "cursor:0 -> no-op")', () => {
    expect(nextTextInputValue({ value: 'abcd', cursor: 0 }, '', { backspace: true })).toEqual({ value: 'abcd', cursor: 0 });
  });

  it('leaves an empty value unchanged on backspace', () => {
    expect(nextTextInputValue({ value: '', cursor: 0 }, '', { backspace: true })).toEqual({ value: '', cursor: 0 });
  });

  it('deletes the character after cursor, cursor unchanged (I/O matrix: "Delete")', () => {
    expect(nextTextInputValue({ value: 'abcd', cursor: 2 }, '', { delete: true })).toEqual({ value: 'abd', cursor: 2 });
  });

  it('delete at cursor:len is a no-op (I/O matrix: "cursor:len -> no-op")', () => {
    expect(nextTextInputValue({ value: 'abcd', cursor: 4 }, '', { delete: true })).toEqual({ value: 'abcd', cursor: 4 });
  });

  it('Left/Right move cursor, clamped to [0, value.length] (I/O matrix: "Left/Right clamp")', () => {
    expect(nextTextInputValue({ value: 'ab', cursor: 0 }, '', { leftArrow: true })).toEqual({ value: 'ab', cursor: 0 });
    expect(nextTextInputValue({ value: 'ab', cursor: 2 }, '', { rightArrow: true })).toEqual({ value: 'ab', cursor: 2 });
    expect(nextTextInputValue({ value: 'ab', cursor: 1 }, '', { leftArrow: true })).toEqual({ value: 'ab', cursor: 0 });
    expect(nextTextInputValue({ value: 'ab', cursor: 1 }, '', { rightArrow: true })).toEqual({ value: 'ab', cursor: 2 });
  });

  it('Home/End jump to the start/end (I/O matrix: "Home/End")', () => {
    expect(nextTextInputValue({ value: 'abcd', cursor: 2 }, '', { home: true })).toEqual({ value: 'abcd', cursor: 0 });
    expect(nextTextInputValue({ value: 'abcd', cursor: 2 }, '', { end: true })).toEqual({ value: 'abcd', cursor: 4 });
  });

  it('ignores return/escape/tab/up/down/ctrl/meta — never appended as text, cursor unchanged', () => {
    expect(nextTextInputValue({ value: 'ab', cursor: 1 }, '\r', { return: true })).toEqual({ value: 'ab', cursor: 1 });
    expect(nextTextInputValue({ value: 'ab', cursor: 1 }, '\x1b', { escape: true })).toEqual({ value: 'ab', cursor: 1 });
    expect(nextTextInputValue({ value: 'ab', cursor: 1 }, '', { tab: true })).toEqual({ value: 'ab', cursor: 1 });
    expect(nextTextInputValue({ value: 'ab', cursor: 1 }, '', { upArrow: true })).toEqual({ value: 'ab', cursor: 1 });
    expect(nextTextInputValue({ value: 'ab', cursor: 1 }, '', { downArrow: true })).toEqual({ value: 'ab', cursor: 1 });
    expect(nextTextInputValue({ value: 'ab', cursor: 1 }, 'c', { ctrl: true })).toEqual({ value: 'ab', cursor: 1 });
    expect(nextTextInputValue({ value: 'ab', cursor: 1 }, 'c', { meta: true })).toEqual({ value: 'ab', cursor: 1 });
  });

  it('ignores an empty input with no matching key flag (defensive no-op)', () => {
    expect(nextTextInputValue({ value: 'ab', cursor: 2 }, '', {})).toEqual({ value: 'ab', cursor: 2 });
  });

  it('appends a space character (Space is a valid topic character, not a checkbox toggle here)', () => {
    expect(nextTextInputValue({ value: 'ab', cursor: 2 }, ' ', {})).toEqual({ value: 'ab ', cursor: 3 });
  });
});

describe('toggleMemberSelection', () => {
  it('adds an unselected path', () => {
    expect(toggleMemberSelection(['/a'], '/b')).toEqual(['/a', '/b']);
  });

  it('removes an already-selected path', () => {
    expect(toggleMemberSelection(['/a', '/b'], '/a')).toEqual(['/b']);
  });
});

describe('validateBranchEditValue', () => {
  it('rejects an empty or whitespace-only value', () => {
    expect(validateBranchEditValue('')).toBe('Branch name must not be empty');
    expect(validateBranchEditValue('   ')).toBe('Branch name must not be empty');
  });

  it('accepts a non-empty value', () => {
    expect(validateBranchEditValue('feature/x')).toBeNull();
  });
});

describe('suggestBranchNameFromTopic (story 2.22)', () => {
  it('slugifies: lowercase, non-alphanumeric runs -> single "-", trimmed of leading/trailing "-"', () => {
    expect(suggestBranchNameFromTopic('Fix Auth Bug!!')).toBe('fix-auth-bug');
  });

  it('collapses multiple separators and mixed case', () => {
    expect(suggestBranchNameFromTopic('  Hello___World  ')).toBe('hello-world');
  });

  it('slugifies an all-punctuation topic down to an empty string', () => {
    expect(suggestBranchNameFromTopic('!!!')).toBe('');
  });

  it('leaves an already-slug-shaped topic unchanged', () => {
    expect(suggestBranchNameFromTopic('already-a-slug')).toBe('already-a-slug');
  });
});

describe('isBranchStepFocus (story 2.22)', () => {
  it('is true for every branch-step field, false for topic/members', () => {
    expect(isBranchStepFocus('branch-base')).toBe(true);
    expect(isBranchStepFocus('branch-mode')).toBe(true);
    expect(isBranchStepFocus('branch-name')).toBe(true);
    expect(isBranchStepFocus('topic')).toBe(false);
    expect(isBranchStepFocus('members')).toBe(false);
  });
});

describe('advanceCreateFormFocus (story 2.22)', () => {
  it('topic -> members unconditionally', () => {
    expect(advanceCreateFormFocus('topic', false, 'grouped', 0, 1)).toEqual({ focus: 'members', nameIndex: 0 });
  });

  it('members -> branch-base once >=1 member is selected', () => {
    expect(advanceCreateFormFocus('members', true, 'grouped', 0, 1)).toEqual({ focus: 'branch-base', nameIndex: 0 });
  });

  it('members -> topic when zero members are selected (Boundaries: no branch step)', () => {
    expect(advanceCreateFormFocus('members', false, 'grouped', 0, 0)).toEqual({ focus: 'topic', nameIndex: 0 });
  });

  it('branch-base -> branch-mode -> branch-name', () => {
    expect(advanceCreateFormFocus('branch-base', true, 'grouped', 0, 1)).toEqual({ focus: 'branch-mode', nameIndex: 0 });
    expect(advanceCreateFormFocus('branch-mode', true, 'grouped', 0, 1)).toEqual({ focus: 'branch-name', nameIndex: 0 });
  });

  it('grouped mode has exactly one name field: branch-name wraps straight back to topic', () => {
    expect(advanceCreateFormFocus('branch-name', true, 'grouped', 0, 1)).toEqual({ focus: 'topic', nameIndex: 0 });
  });

  it('individual mode advances through each per-member name field before wrapping to topic', () => {
    expect(advanceCreateFormFocus('branch-name', true, 'individual', 0, 3)).toEqual({ focus: 'branch-name', nameIndex: 1 });
    expect(advanceCreateFormFocus('branch-name', true, 'individual', 1, 3)).toEqual({ focus: 'branch-name', nameIndex: 2 });
    expect(advanceCreateFormFocus('branch-name', true, 'individual', 2, 3)).toEqual({ focus: 'topic', nameIndex: 0 });
  });
});

describe('prefillBranchNames (story 2.22)', () => {
  it('grouped mode fills the shared field from the topic slug when untouched', () => {
    expect(prefillBranchNames('grouped', 'Fix Auth Bug', ['/a'], '', {}, false, {})).toEqual({
      branchName: 'fix-auth-bug',
      branchNames: {},
    });
  });

  it('grouped mode never overwrites a value the developer already typed (touched)', () => {
    expect(prefillBranchNames('grouped', 'Fix Auth Bug', ['/a'], 'my-custom-name', {}, true, {})).toEqual({
      branchName: 'my-custom-name',
      branchNames: {},
    });
  });

  it('individual mode fills every untouched selected member, leaves touched entries untouched', () => {
    expect(prefillBranchNames('individual', 'Fix Auth Bug', ['/a', '/b'], '', { '/a': 'kept' }, false, { '/a': true })).toEqual({
      branchName: '',
      branchNames: { '/a': 'kept', '/b': 'fix-auth-bug' },
    });
  });

  // Review fix (story 2.22): the original version gated on "is the value currently empty",
  // which conflated "never touched" with "touched, then deliberately cleared" — a developer
  // who backspaced a field to '' (to exercise the empty-value rejection) would see the very
  // next prefill call (a further member toggled, or the naming mode switched) silently
  // resurrect the old suggestion. Gating on the explicit touched flag instead of the value
  // fixes this: once touched, a field's '' stays '' no matter how many more prefill calls
  // follow.
  it('never re-fills a field the developer deliberately cleared back to empty, even on a later prefill call', () => {
    // Simulates: the field was filled once, then the developer backspaced it to '' — the
    // touched flag flips true at that point (handleCreateBranchStepInput), so a second
    // prefill call (e.g. a further member toggled) must leave it exactly as the developer
    // left it: ''.
    expect(prefillBranchNames('grouped', 'Fix Auth Bug', ['/a'], '', {}, true, {})).toEqual({ branchName: '', branchNames: {} });
  });

  it('individual mode: a member field cleared and touched stays empty on a later prefill call', () => {
    expect(prefillBranchNames('individual', 'Fix Auth Bug', ['/a', '/b'], '', { '/a': '' }, false, { '/a': true })).toEqual({
      branchName: '',
      branchNames: { '/a': '', '/b': 'fix-auth-bug' },
    });
  });
});

describe('buildCreateBranchOptions (story 2.22, signature updated story 2.27)', () => {
  it('zero members -> the exact NO_BRANCH_CREATION value (core param is mandatory)', () => {
    expect(buildCreateBranchOptions([], 'grouped', 'unused', {}, {}, NO_BRANCH_CREATION)).toBe(NO_BRANCH_CREATION);
  });

  it('grouped mode: the identical name for every selected member, per-member bases threaded through', () => {
    expect(
      buildCreateBranchOptions(['/a', '/b'], 'grouped', 'feature-x', {}, { '/a': 'development', '/b': 'development' }, NO_BRANCH_CREATION),
    ).toEqual({
      create: true,
      base: 'development',
      bases: { '/a': 'development', '/b': 'development' },
      mode: 'grouped',
      names: { '/a': 'feature-x', '/b': 'feature-x' },
    });
  });

  it('individual mode: a per-repoPath name map, and a per-repoPath base map (diverging sharedBranch)', () => {
    expect(
      buildCreateBranchOptions(
        ['/a', '/b'],
        'individual',
        'unused',
        { '/a': 'feature-a', '/b': 'feature-b' },
        { '/a': 'main', '/b': 'master' },
        NO_BRANCH_CREATION,
      ),
    ).toEqual({
      create: true,
      base: 'main',
      bases: { '/a': 'main', '/b': 'master' },
      mode: 'individual',
      names: { '/a': 'feature-a', '/b': 'feature-b' },
    });
  });
});

describe('validateCreateBranchFields (story 2.22, base-branch validation added story 2.27)', () => {
  it('zero members: nothing to validate', () => {
    expect(validateCreateBranchFields('grouped', [], '', {}, {})).toBeNull();
  });

  it('grouped mode: rejects an empty shared name field', () => {
    expect(validateCreateBranchFields('grouped', ['/a'], '', {}, { '/a': 'development' })).toBe('Branch name must not be empty');
    expect(validateCreateBranchFields('grouped', ['/a'], 'feature-x', {}, { '/a': 'development' })).toBeNull();
  });

  it('individual mode: rejects if any selected member is missing a name', () => {
    expect(validateCreateBranchFields('individual', ['/a', '/b'], '', { '/a': 'feature-a' }, { '/a': 'development', '/b': 'development' })).toBe(
      'Branch name must not be empty',
    );
    expect(
      validateCreateBranchFields('individual', ['/a', '/b'], '', { '/a': 'feature-a', '/b': 'feature-b' }, { '/a': 'development', '/b': 'development' }),
    ).toBeNull();
  });

  it('rejects an empty base-branch field before ever checking the name field(s)', () => {
    expect(validateCreateBranchFields('grouped', ['/a'], 'feature-x', {}, { '/a': '' })).toBe('Base branch: Branch name must not be empty');
  });
});

describe('resolveBaseBranchMode (story 2.27)', () => {
  it('a single selected member is always "shared"', () => {
    const candidates = [service({ path: '/a', sharedBranch: 'main' })];
    expect(resolveBaseBranchMode(['/a'], candidates)).toBe('shared');
  });

  it('>=2 members with a unanimous sharedBranch stay "shared"', () => {
    const candidates = [service({ path: '/a', sharedBranch: 'main' }), service({ path: '/b', sharedBranch: 'main' })];
    expect(resolveBaseBranchMode(['/a', '/b'], candidates)).toBe('shared');
  });

  it('>=2 members with a diverging sharedBranch are forced "per-member"', () => {
    const candidates = [service({ path: '/a', sharedBranch: 'main' }), service({ path: '/b', sharedBranch: 'master' })];
    expect(resolveBaseBranchMode(['/a', '/b'], candidates)).toBe('per-member');
  });
});

describe('suggestBaseBranchFor (story 2.27)', () => {
  it("suggests the repo's own manifest-declared sharedBranch, never a hardcoded literal", () => {
    const candidates = [service({ path: '/a', sharedBranch: 'main' })];
    expect(suggestBaseBranchFor('/a', candidates)).toBe('main');
  });

  it('falls back to an empty string when the path is not among the known candidates', () => {
    expect(suggestBaseBranchFor('/unknown', [])).toBe('');
  });
});

describe('prefillBaseBranches (story 2.27)', () => {
  it('single repo: fills the shared field from that repo\'s own sharedBranch when untouched', () => {
    const candidates = [service({ path: '/a', sharedBranch: 'main' })];
    expect(prefillBaseBranches(['/a'], candidates, '', {}, false, {})).toEqual({
      baseBranch: 'main',
      baseBranches: { '/a': 'main' },
    });
  });

  it('never overwrites a value the developer already typed (touched)', () => {
    const candidates = [service({ path: '/a', sharedBranch: 'main' })];
    expect(prefillBaseBranches(['/a'], candidates, 'my-custom-base', {}, true, {})).toEqual({
      baseBranch: 'my-custom-base',
      baseBranches: { '/a': 'main' },
    });
  });

  it('fills every untouched selected member from its own sharedBranch, leaves touched entries untouched', () => {
    const candidates = [service({ path: '/a', sharedBranch: 'main' }), service({ path: '/b', sharedBranch: 'master' })];
    expect(prefillBaseBranches(['/a', '/b'], candidates, '', { '/a': 'kept' }, false, { '/a': true })).toEqual({
      baseBranch: 'main',
      baseBranches: { '/a': 'kept', '/b': 'master' },
    });
  });
});

describe('isSwitchBlockedError', () => {
  it('matches only the lock-block error code', () => {
    expect(isSwitchBlockedError('switch-blocked-action-in-progress')).toBe(true);
    expect(isSwitchBlockedError('edt-not-found')).toBe(false);
  });
});

// Amended 2026-08-27 (Sprint Change Proposal): no longer takes an `isActive` flag — the
// "— active" suffix moved to `ListRow`'s own `active` prop (list-row.test.tsx covers it).
describe('formatEdtRowMeta', () => {
  it('pluralizes the member count', () => {
    expect(formatEdtRowMeta(edtEntry({ members: [] }))).toBe('0 members');
    expect(formatEdtRowMeta(edtEntry({ members: [{ service: 'a', repoPath: '/a', branch: 'main' }] }))).toBe('1 member');
    expect(
      formatEdtRowMeta(
        edtEntry({ members: [{ service: 'a', repoPath: '/a', branch: 'main' }, { service: 'b', repoPath: '/b', branch: 'main' }] }),
      ),
    ).toBe('2 members');
  });
});

describe('formatEdtDetail', () => {
  it('shows topic, status (active overrides the raw status field), and each member', () => {
    const detail = formatEdtDetail(
      edtEntry({ topic: 'my-topic', status: 'inactive', members: [{ service: 'api-gateway', repoPath: '/repos/a', branch: 'feat/x' }] }),
      true,
    );
    expect(detail).toContain('Topic: my-topic');
    expect(detail).toContain('Status: active');
    expect(detail).toContain('api-gateway (feat/x)');
  });

  it('shows a zero-member EDT as valid, not an error (matrix: "Modify to zero members")', () => {
    expect(formatEdtDetail(edtEntry({ members: [] }), false)).toContain('Members: none');
  });
});

describe('resolveCandidateListState', () => {
  it('is "loading" while the services fetch is in flight, regardless of count', () => {
    expect(resolveCandidateListState('loading', 0)).toBe('loading');
    expect(resolveCandidateListState('loading', 5)).toBe('loading');
  });

  it('is "empty" once resolved with zero candidates', () => {
    expect(resolveCandidateListState('idle', 0)).toBe('empty');
  });

  it('is "ready" once resolved with at least one candidate', () => {
    expect(resolveCandidateListState('idle', 1)).toBe('ready');
  });

  // Review patch (story 2.9): 'error' used to fall through to the same branch as 'idle',
  // reporting a genuine services-load failure as "no registered services available."
  it('is "error" when the services fetch itself failed, never conflated with "empty"', () => {
    expect(resolveCandidateListState('error', 0)).toBe('error');
    expect(resolveCandidateListState('error', 5)).toBe('error');
  });
});

describe('summarizeFailedResults', () => {
  // Story 2.25: returns a structured FailedResultRow[] now — never a `; `-joined string.
  it('returns an empty array when every row succeeded', () => {
    expect(summarizeFailedResults([{ service: 'a', outcome: 'added' }])).toEqual([]);
    expect(summarizeFailedResults([])).toEqual([]);
  });

  it('returns one row per failed result, carrying the code and message through as-is', () => {
    const rows = summarizeFailedResults([
      { service: 'a', outcome: 'added' },
      { service: 'b', outcome: 'failed', detail: { code: 'shared-branch-rejected', message: 'Branch "development" is shared/protected' } },
      { service: 'c', outcome: 'failed' },
    ]);
    expect(rows).toEqual([
      { service: 'b', code: 'shared-branch-rejected', message: 'Branch "development" is shared/protected' },
      { service: 'c', message: 'Failed' },
    ]);
  });

  it('surfaces the real branch-owned-by-other-edt code as-is, for resolveAssistedAction to key off', () => {
    const rows = summarizeFailedResults([
      {
        service: 'svc-a',
        outcome: 'failed',
        detail: { code: 'branch-owned-by-other-edt', message: 'Branch "feature-x" is already registered as a different EDT\'s own branch' },
      },
    ]);
    expect(rows[0]?.code).toBe('branch-owned-by-other-edt');
  });
});

describe('canEditMemberBranch', () => {
  // Story 2.26 amendment: re-adds membership awareness via `originalMemberPaths` (dialog-open-
  // time membership snapshot) — dropped by 2.24's own code review, but needed so an
  // already-a-member row's checklist Enter submits the form instead of reopening the picker.
  it('is false for an existing member that is still checked (story 2.26 amendment)', () => {
    expect(canEditMemberBranch('/repos/a', ['/repos/a'], new Set(['/repos/a']))).toBe(false);
  });

  it('is false for an existing member that was unchecked', () => {
    expect(canEditMemberBranch('/repos/a', [], new Set(['/repos/a']))).toBe(false);
  });

  // Story 2.24: widened to also cover a not-yet-member candidate — checking it now
  // auto-stages a branch (suggestBranchForNewMember), so Enter on it opens the same
  // branch-edit sub-dialog an existing member's row already uses.
  it('is true for a freshly-checked path that is not yet an existing member (story 2.24)', () => {
    expect(canEditMemberBranch('/repos/new', ['/repos/new'], new Set(['/repos/a']))).toBe(true);
  });

  it('is false for a not-yet-existing member that is not checked', () => {
    expect(canEditMemberBranch('/repos/new', [], new Set(['/repos/a']))).toBe(false);
  });

  // Brand-new EDT case: the dialog opens with zero pre-existing members, so every checked row
  // is branch-editable via Enter — none of them can collide with an empty originalMemberPaths.
  it('is true for a checked row when originalMemberPaths is empty (brand-new EDT)', () => {
    expect(canEditMemberBranch('/repos/a', ['/repos/a'], new Set())).toBe(true);
  });
});

describe('resolveModifyEnterAction', () => {
  // Story 2.26 amendment: an already-a-member row that's still checked now submits — its
  // checklist Enter is no longer branch-editable (canEditMemberBranch above).
  it('submits on an already-a-member members-focus row, even when checked (story 2.26 amendment)', () => {
    expect(resolveModifyEnterAction('members', ['/repos/a'], '/repos/a', new Set(['/repos/a']))).toEqual({ type: 'submit' });
  });

  it('submits when topic-focused, regardless of the focused member row', () => {
    expect(resolveModifyEnterAction('topic', ['/repos/a'], '/repos/a', new Set(['/repos/a']))).toEqual({ type: 'submit' });
  });

  it('submits when members-focused but the row is unchecked', () => {
    expect(resolveModifyEnterAction('members', [], '/repos/a', new Set(['/repos/a']))).toEqual({ type: 'submit' });
  });

  // Story 2.24: a freshly-checked not-yet-member row is now branch-editable too — Enter
  // opens the same branch-edit sub-dialog (its staged branch auto-fills via
  // suggestBranchForNewMember on check). Story 2.26 amendment: this is exactly the case
  // `originalMemberPaths` must still allow through.
  it('opens branch-edit on a freshly-checked not-yet-member row (story 2.24)', () => {
    expect(resolveModifyEnterAction('members', ['/repos/new'], '/repos/new', new Set(['/repos/a']))).toEqual({
      type: 'edit-branch',
      repoPath: '/repos/new',
    });
  });

  it('submits when there is no focused row at all (empty candidate list)', () => {
    expect(resolveModifyEnterAction('members', [], undefined, new Set(['/repos/a']))).toEqual({ type: 'submit' });
  });

  // Brand-new EDT case: originalMemberPaths is empty, so a checked row is always
  // branch-editable via Enter.
  it('opens branch-edit on a checked row when originalMemberPaths is empty (brand-new EDT)', () => {
    expect(resolveModifyEnterAction('members', ['/repos/a'], '/repos/a', new Set())).toEqual({
      type: 'edit-branch',
      repoPath: '/repos/a',
    });
  });
});

describe('resolveModifyOps', () => {
  it('derives addMembers/removeMembers from the selection diff against the original members', () => {
    const target = edtEntry({ members: [{ service: 'a', repoPath: '/repos/a', branch: 'main' }] });
    const ops = resolveModifyOps(target, target.topic, ['/repos/a', '/repos/b'], {});
    expect(ops.addMembers).toEqual(['/repos/b']);
    expect(ops.removeMembers).toEqual([]);
  });

  it('reports a removal when an original member is no longer selected', () => {
    const target = edtEntry({ members: [{ service: 'a', repoPath: '/repos/a', branch: 'main' }] });
    const ops = resolveModifyOps(target, target.topic, [], {});
    expect(ops.removeMembers).toEqual(['/repos/a']);
  });

  it('includes a staged branch edit for a still-selected member', () => {
    const target = edtEntry({ members: [{ service: 'a', repoPath: '/repos/a', branch: 'main' }] });
    const ops = resolveModifyOps(target, target.topic, ['/repos/a'], { '/repos/a': 'feature-y' });
    expect(ops.setBranches).toEqual([{ repoPath: '/repos/a', branch: 'feature-y' }]);
  });

  it('drops a staged branch edit for a member no longer selected (boundary rule)', () => {
    const target = edtEntry({ members: [{ service: 'a', repoPath: '/repos/a', branch: 'main' }] });
    const ops = resolveModifyOps(target, target.topic, [], { '/repos/a': 'feature-y' });
    expect(ops.setBranches).toEqual([]);
    expect(ops.removeMembers).toEqual(['/repos/a']);
  });

  it('sets renameTo only when the topic actually changed to a non-empty value', () => {
    const target = edtEntry({ topic: 'original', members: [] });
    expect(resolveModifyOps(target, 'renamed', [], {}).renameTo).toBe('renamed');
    expect(resolveModifyOps(target, 'original', [], {}).renameTo).toBeUndefined();
    expect(resolveModifyOps(target, '   ', [], {}).renameTo).toBeUndefined();
  });

  // Story 2.24: a checked non-member always carries a setBranches entry, staged or not —
  // never silently omitted, so modify.ts's step 1 always finds a match to defer to instead
  // of falling back to its branch-required failure.
  it('includes a setBranches entry for every checked non-member, staged or not (story 2.24)', () => {
    const target = edtEntry({ members: [] });
    const ops = resolveModifyOps(target, target.topic, ['/repos/b'], { '/repos/b': 'feature-y' });
    expect(ops.setBranches).toEqual([{ repoPath: '/repos/b', branch: 'feature-y' }]);
  });

  it('falls back to an empty setBranches entry for a checked non-member with no staged branch (story 2.24)', () => {
    const target = edtEntry({ members: [] });
    const ops = resolveModifyOps(target, target.topic, ['/repos/b'], {});
    expect(ops.setBranches).toEqual([{ repoPath: '/repos/b', branch: '' }]);
  });
});

describe('suggestBranchForNewMember (story 2.24)', () => {
  it('suggests the shared branch when every existing member agrees on one', () => {
    const members = [
      { service: 'a', repoPath: '/repos/a', branch: 'feature-shared' },
      { service: 'b', repoPath: '/repos/b', branch: 'feature-shared' },
    ];
    expect(suggestBranchForNewMember(members, 'Some Topic')).toBe('feature-shared');
  });

  it('falls back to the topic slug when members diverge on branch', () => {
    const members = [
      { service: 'a', repoPath: '/repos/a', branch: 'feature-a' },
      { service: 'b', repoPath: '/repos/b', branch: 'feature-b' },
    ];
    expect(suggestBranchForNewMember(members, 'Fix Auth Bug!!')).toBe('fix-auth-bug');
  });

  it('falls back to the topic slug when there are zero existing members', () => {
    expect(suggestBranchForNewMember([], 'Fix Auth Bug!!')).toBe('fix-auth-bug');
  });
});

// ==========================================================================================
// Story 2.18 — EDT zone: active highlight, EDT SERVICES / OTHER SERVICES panes, per-service
// actions, and the context-derived detail-pane hint.
// ==========================================================================================

describe('partitionServicesByEdtMembership', () => {
  const focusedEdt = edtEntry({
    members: [
      { service: 'a', repoPath: '/repos/a', branch: 'main' },
      { service: 'b', repoPath: '/repos/b', branch: 'feature-x' },
    ],
  });

  it('splits rows into EDT SERVICES (member of the *selected* EDT) and OTHER SERVICES', () => {
    const rows = [
      service({ service: 'a', path: '/repos/a' }),
      service({ service: 'b', path: '/repos/b' }),
      service({ service: 'c', path: '/repos/c' }),
    ];
    const { edtServices, otherServices } = partitionServicesByEdtMembership(rows, focusedEdt);
    expect(edtServices.map((row) => row.path)).toEqual(['/repos/a', '/repos/b']);
    expect(otherServices.map((row) => row.path)).toEqual(['/repos/c']);
  });

  // Boundary: partitioning is against the *selected* EDT's member list, never `row.isMember`
  // (which stays tied to the *active* EDT for the divergence badge). A row can be a member of
  // the active EDT (isMember: true) yet land in OTHER SERVICES here because the *selected*
  // (focused) EDT is a different one.
  it('partitions by the selected EDT\'s membership, never by row.isMember', () => {
    const rows = [service({ service: 'c', path: '/repos/c', isMember: true })];
    const { edtServices, otherServices } = partitionServicesByEdtMembership(rows, focusedEdt);
    expect(edtServices).toEqual([]);
    expect(otherServices.map((row) => row.path)).toEqual(['/repos/c']);
  });

  it('puts every row under OTHER SERVICES when no EDT is focused/selected — never an empty EDT SERVICES group', () => {
    const rows = [service({ service: 'a', path: '/repos/a' }), service({ service: 'b', path: '/repos/b' })];
    const { edtServices, otherServices } = partitionServicesByEdtMembership(rows, undefined);
    expect(edtServices).toEqual([]);
    expect(otherServices).toEqual(rows);
  });
});

describe('formatAvailableActionsHint', () => {
  it('shows [Enter] Modify on the EDT selector when the focused row is the active EDT', () => {
    expect(formatAvailableActionsHint('edts', true)).toBe('[Enter] Modify');
  });

  it('shows [Enter] Switch on the EDT selector when the focused row is not the active EDT', () => {
    expect(formatAvailableActionsHint('edts', false)).toBe('[Enter] Switch');
  });

  it('shows Remove / Change branch on EDT SERVICES, regardless of the active-EDT flag', () => {
    expect(formatAvailableActionsHint('edt-services', true)).toBe('[Enter] Remove / Change branch');
    expect(formatAvailableActionsHint('edt-services', false)).toBe('[Enter] Remove / Change branch');
  });

  it('shows Add to EDT on OTHER SERVICES, regardless of the active-EDT flag', () => {
    expect(formatAvailableActionsHint('other-services', true)).toBe('[Enter] Add to EDT');
    expect(formatAvailableActionsHint('other-services', false)).toBe('[Enter] Add to EDT');
  });

  // Boundary: never c/m — they were never wired as direct keys.
  it('never mentions the c/m mnemonics', () => {
    for (const isActive of [true, false]) {
      expect(formatAvailableActionsHint('edts', isActive)).not.toMatch(/\[c\]|\[m\]/);
      expect(formatAvailableActionsHint('edt-services', isActive)).not.toMatch(/\[c\]|\[m\]/);
      expect(formatAvailableActionsHint('other-services', isActive)).not.toMatch(/\[c\]|\[m\]/);
    }
  });
});

describe('resolveActionHint (story 2.19, I/O matrix "Toggle hidden hint")', () => {
  it('returns the same string formatAvailableActionsHint would when nothing is hidden', () => {
    expect(resolveActionHint('edts', true, [])).toBe('[Enter] Modify');
    expect(resolveActionHint('edt-services', false, [])).toBe('[Enter] Remove / Change branch');
    expect(resolveActionHint('other-services', false, [])).toBe('[Enter] Add to EDT');
  });

  it('returns an empty string once that context\'s token is in hiddenActionHints', () => {
    expect(resolveActionHint('edts', true, ['edts'])).toBe('');
    expect(resolveActionHint('edt-services', false, ['edt-services'])).toBe('');
    expect(resolveActionHint('other-services', false, ['other-services'])).toBe('');
  });

  it('only hides the matching token, leaving the other two contexts unaffected', () => {
    expect(resolveActionHint('edts', true, ['edt-services'])).toBe('[Enter] Modify');
    expect(resolveActionHint('other-services', false, ['edt-services'])).toBe('[Enter] Add to EDT');
  });
});

describe('appendHint', () => {
  it('prefixes a non-empty hint with a blank-line separator', () => {
    expect(appendHint('[Enter] Modify')).toBe('\n\n[Enter] Modify');
  });

  it('renders nothing (no dangling separator) for a hidden hint', () => {
    expect(appendHint('')).toBe('');
  });
});

describe('formatEdtActionHistory (story 2.18 regression)', () => {
  it('no longer bakes the static "Available: ..." hint line into the action history (extracted to formatAvailableActionsHint)', () => {
    const history = formatEdtActionHistory([], null);
    expect(history).not.toContain('Available:');
  });
});

describe('formatEdtActionHistory hiddenActionTypes filter (story 2.19 amended, AC5)', () => {
  const log = [
    { id: 'a1', timestamp: '2026-01-01T00:00:00.000Z', actionType: 'create', outcome: 'success' as const, detail: 'Created EDT "demo"' },
    { id: 'a2', timestamp: '2026-01-01T00:01:00.000Z', actionType: 'switch', outcome: 'success' as const, detail: 'Switched to EDT "demo"' },
    { id: 'a3', timestamp: '2026-01-01T00:02:00.000Z', actionType: 'modify', outcome: 'success' as const, detail: 'Added api-gateway' },
  ];

  it('includes every entry when hiddenActionTypes is empty (or omitted, defaulting to [])', () => {
    const history = formatEdtActionHistory(log, null, []);
    expect(history).toContain('Created EDT "demo"');
    expect(history).toContain('Switched to EDT "demo"');
    expect(history).toContain('Added api-gateway');

    expect(formatEdtActionHistory(log, null)).toBe(history);
  });

  it('drops only the entries whose actionType is hidden', () => {
    const history = formatEdtActionHistory(log, null, ['modify']);
    expect(history).toContain('Created EDT "demo"');
    expect(history).toContain('Switched to EDT "demo"');
    expect(history).not.toContain('Added api-gateway');
  });

  it('falls back to "No actions yet" once every entry is filtered out, same as a genuinely empty log', () => {
    const history = formatEdtActionHistory(log, null, ['create', 'switch', 'modify']);
    expect(history).toContain('No actions yet');
    expect(history).not.toContain('Recent actions:');
  });
});

// ---- renderToString smoke tests: one per new zone state -------------------------------

const noopAsync = async () => {};

describe('EdtsZone (story 2.9 zone states)', () => {
  it('AC1: no EDT exists -> the create prompt auto-opens with topic input + member checklist, never a bare empty list', async () => {
    const store = createAppStore();
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      edtsBranches: [service({ service: 'api-gateway', path: '/repos/api-gateway' })],
      edtsBranchesStatus: 'idle',
      loadEdts: noopAsync,
      loadEdtsBranches: noopAsync,
    });
    const output = await renderToString(<EdtsZone useStore={store} initialDialogKind="create" />);
    expect(output).toContain('CREATE EDT');
    expect(output).toContain('Topic:');
    expect(output).toContain('api-gateway');
  });

  it('AC1: the create prompt shows a distinct "loading services" state, not "no registered services" (boundary rule)', async () => {
    const store = createAppStore();
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      edtsBranches: null,
      edtsBranchesStatus: 'loading',
      loadEdts: noopAsync,
      loadEdtsBranches: noopAsync,
    });
    const output = await renderToString(<EdtsZone useStore={store} initialDialogKind="create" />);
    expect(output).toContain('CREATE EDT');
    expect(output).toContain('Loading services');
    expect(output).not.toContain('No registered services available');
  });

  it('AC1: the create prompt shows a genuinely-empty registry distinctly from loading', async () => {
    const store = createAppStore();
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: noopAsync,
      loadEdtsBranches: noopAsync,
    });
    const output = await renderToString(<EdtsZone useStore={store} initialDialogKind="create" />);
    expect(output).toContain('CREATE EDT');
    expect(output).toContain('No registered services available.');
  });

  it('shows the EDT selector above the flat SERVICES list once EDTs exist — the flat list is never replaced (AC5)', async () => {
    const store = createAppStore();
    store.setState({
      edts: [edtEntry({ topic: 'my-work', members: [] })],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [service({ service: 'api-gateway' })],
      edtsBranchesStatus: 'idle',
      loadEdts: noopAsync,
      loadEdtsBranches: noopAsync,
    });
    const output = await renderToString(<EdtsZone useStore={store} />);
    expect(output).toContain('EDTS');
    expect(output).toContain('my-work');
    expect(output).toContain('SERVICES');
    expect(output).toContain('api-gateway');
  });

  it('shows a loading state for the EDT selector before the first load resolves', async () => {
    const store = createAppStore();
    store.setState({
      edts: null,
      edtsStatus: 'loading',
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: noopAsync,
      loadEdtsBranches: noopAsync,
    });
    const output = await renderToString(<EdtsZone useStore={store} />);
    expect(output).toContain('Loading EDTs');
  });

  it('mirrors the flat list\'s "never show stale rows under an error banner" rule for the EDT selector', async () => {
    const store = createAppStore();
    store.setState({
      edts: [],
      edtsStatus: 'error',
      edtsError: 'edt-registry-invalid-format: bad yaml',
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: noopAsync,
      loadEdtsBranches: noopAsync,
    });
    const output = await renderToString(<EdtsZone useStore={store} />);
    expect(output).toContain('Failed to load EDTs');
    // The create-prompt auto-open effect must never fire on an error status (only a
    // genuinely-resolved-empty list) — the empty-array shown here is the error's stale-row
    // clearing, not "zero EDTs".
    expect(output).not.toContain('CREATE EDT');
  });

  it('calls loadEdts on mount', async () => {
    let called = false;
    const store = createAppStore();
    store.setState({
      edts: [edtEntry()],
      edtsStatus: 'idle',
      loadEdts: async () => {
        called = true;
      },
      loadEdtsBranches: noopAsync,
    });
    await renderToString(<EdtsZone useStore={store} />);
    expect(called).toBe(true);
  });

  it('hides the EDT-list keybinding hint line while the create dialog is open (boundary rule)', async () => {
    const store = createAppStore();
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: noopAsync,
      loadEdtsBranches: noopAsync,
    });
    const output = await renderToString(<EdtsZone useStore={store} initialDialogKind="create" />);
    expect(output).not.toContain('[Enter] switch/modify');
  });

  it('shows the EDT-list keybinding hint line when no dialog is open', async () => {
    const store = createAppStore();
    store.setState({
      edts: [edtEntry({ topic: 'my-work' })],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: noopAsync,
      loadEdtsBranches: noopAsync,
    });
    const output = await renderToString(<EdtsZone useStore={store} />);
    expect(output).toContain('[Enter] switch/modify');
  });

  it('shows the EDT detail pane (not the services detail pane) by default — the EDT selector is focused by default (Design Notes)', async () => {
    const store = createAppStore();
    store.setState({
      edts: [edtEntry({ topic: 'my-work', members: [{ service: 'api-gateway', repoPath: '/repos/a', branch: 'feat/x' }] })],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: noopAsync,
      loadEdtsBranches: noopAsync,
    });
    const output = await renderToString(<EdtsZone useStore={store} />);
    expect(output).toContain('MY-WORK');
    expect(output).toContain('api-gateway (feat/x)');
  });

  it('AC2: the switch-confirm dialog asks to confirm switching to the selected (non-active) EDT', async () => {
    const store = createAppStore();
    store.setState({
      edts: [edtEntry({ topic: 'other-work' })],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: noopAsync,
      loadEdtsBranches: noopAsync,
    });
    const output = await renderToString(<EdtsZone useStore={store} initialDialogKind="switch-confirm" />);
    expect(output).toContain('SWITCH EDT');
    expect(output).toContain('other-work');
  });

  it('AC2: switch-blocked-action-in-progress surfaces an explicit force-or-cancel prompt', async () => {
    const store = createAppStore();
    store.setState({
      edts: [edtEntry({ topic: 'other-work' })],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: noopAsync,
      loadEdtsBranches: noopAsync,
    });
    const output = await renderToString(<EdtsZone useStore={store} initialDialogKind="switch-blocked" />);
    expect(output).toContain('SWITCH EDT');
    expect(output).toContain('force switch');
    expect(output).toContain('cancel');
  });

  it('AC3: the modify form shows the topic, and every candidate service checked/unchecked per current membership', async () => {
    const store = createAppStore();
    store.setState({
      edts: [
        edtEntry({
          ulid: 'active-ulid',
          topic: 'active-edt',
          status: 'active',
          members: [{ service: 'api-gateway', repoPath: '/repos/api-gateway', branch: 'feat/x' }],
        }),
      ],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [
        service({ service: 'api-gateway', path: '/repos/api-gateway' }),
        service({ service: 'route-explorer', path: '/repos/route-explorer' }),
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: noopAsync,
      loadEdtsBranches: noopAsync,
    });
    const output = await renderToString(<EdtsZone useStore={store} initialDialogKind="modify" />);
    expect(output).toContain('MODIFY EDT');
    expect(output).toContain('Topic: active-edt');
    expect(output).toContain('[x]');
    expect(output).toContain('api-gateway');
    expect(output).toContain('[ ]');
    expect(output).toContain('route-explorer');
  });

  it('hides the EDT-list keybinding hint line while the switch-confirm dialog is open', async () => {
    const store = createAppStore();
    store.setState({
      edts: [edtEntry({ topic: 'other-work' })],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: noopAsync,
      loadEdtsBranches: noopAsync,
    });
    const output = await renderToString(<EdtsZone useStore={store} initialDialogKind="switch-confirm" />);
    expect(output).not.toContain('[Enter] switch/modify');
  });

  it('hides the EDT-list keybinding hint line while the modify dialog is open', async () => {
    const store = createAppStore();
    store.setState({
      edts: [edtEntry({ ulid: 'active-ulid', topic: 'active-edt', status: 'active' })],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: noopAsync,
      loadEdtsBranches: noopAsync,
    });
    const output = await renderToString(<EdtsZone useStore={store} initialDialogKind="modify" />);
    expect(output).not.toContain('[Enter] switch/modify');
  });
});

// ==========================================================================================
// Story 2.18 — active highlight, EDT SERVICES / OTHER SERVICES panes, per-service actions
// ==========================================================================================

describe('EdtsZone (story 2.18 zone states)', () => {
  it('AC1: the active EDT\'s row renders accent+bold regardless of cursor position, distinct from the cursor row', async () => {
    const store = createAppStore();
    store.setState({
      edts: [
        edtEntry({ ulid: 'active-ulid', topic: 'active-edt', status: 'active' }),
        edtEntry({ ulid: 'other-ulid', topic: 'other-edt', status: 'inactive' }),
      ],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: noopAsync,
      loadEdtsBranches: noopAsync,
    });
    // Plain-text presence only — both rows render regardless of which one the cursor sits
    // on. The actual accent+bold *styling* assertion (this test's real subject) needs
    // FORCE_COLOR=1 to produce ANSI codes at all; see edts-zone.styles.test.tsx, which
    // renders this same active-vs-cursor distinction and asserts the raw escape sequences.
    const output = await renderToString(<EdtsZone useStore={store} />);
    expect(output).toContain('active-edt');
    expect(output).toContain('other-edt');
  });

  it('AC3: no EDT selected -> every service renders under OTHER SERVICES with a "No EDT selected" note, never an empty EDT SERVICES group', async () => {
    const store = createAppStore();
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [service({ service: 'api-gateway', path: '/repos/api-gateway' })],
      edtsBranchesStatus: 'idle',
      loadEdts: noopAsync,
      loadEdtsBranches: noopAsync,
    });
    // No initialDialogKind: renderToString's single synchronous pass never observes the
    // effect-triggered "zero EDTs auto-opens the create dialog" behavior (AC1), so the base
    // view renders deterministically here (same precedent as the story 2.9 smoke tests above).
    const output = await renderToString(<EdtsZone useStore={store} />);
    expect(output).toContain('No EDT selected');
    expect(output).not.toContain('EDT SERVICES');
    expect(output).toContain('OTHER SERVICES');
    expect(output).toContain('api-gateway');
  });

  it('AC4: the EDT SERVICES contextual menu shows Remove / Change branch / a disabled Restart annotated "Available with Epic 5"', async () => {
    const store = createAppStore();
    const target = edtEntry({
      ulid: 'active-ulid',
      topic: 'active-edt',
      status: 'active',
      members: [{ service: 'api-gateway', repoPath: '/repos/api-gateway', branch: 'main' }],
    });
    store.setState({
      edts: [target],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [service({ service: 'api-gateway', path: '/repos/api-gateway', isMember: true })],
      edtsBranchesStatus: 'idle',
      loadEdts: noopAsync,
      loadEdtsBranches: noopAsync,
    });
    const output = await renderToString(<EdtsZone useStore={store} initialDialogKind="service-actions" />);
    expect(output).toContain('SERVICE ACTIONS');
    expect(output).toContain('Remove from EDT');
    expect(output).toContain('Change branch for this EDT');
    expect(output).toContain('Restart');
    expect(output).toContain('Available with Epic 5');
  });

  it('AC9: the Add-to-EDT dialog opens a branch text input pre-filled with the service\'s current branch', async () => {
    const store = createAppStore();
    const target = edtEntry({ ulid: 'active-ulid', topic: 'active-edt', status: 'active', members: [] });
    store.setState({
      edts: [target],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [service({ service: 'route-explorer', path: '/repos/route-explorer', branch: 'feature-y', isMember: false })],
      edtsBranchesStatus: 'idle',
      loadEdts: noopAsync,
      loadEdtsBranches: noopAsync,
    });
    const output = await renderToString(<EdtsZone useStore={store} initialDialogKind="add-to-edt" />);
    expect(output).toContain('ADD TO EDT');
    expect(output).toContain('route-explorer');
    expect(output).toContain('feature-y');
  });

  it('story 2.23: Add-to-EDT branch field shows a visible cursor hint [Enter] confirm [Esc] cancel (closes affordance gap)', async () => {
    const store = createAppStore();
    const target = edtEntry({ ulid: 'active-ulid', topic: 'active-edt', status: 'active', members: [] });
    store.setState({
      edts: [target],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [service({ service: 'route-explorer', path: '/repos/route-explorer', branch: 'feature-y', isMember: false })],
      edtsBranchesStatus: 'idle',
      loadEdts: noopAsync,
      loadEdtsBranches: noopAsync,
    });
    const output = await renderToString(<EdtsZone useStore={store} initialDialogKind="add-to-edt" />);
    expect(output).toContain('[Enter] confirm');
    expect(output).toContain('[Esc] cancel');
  });

  it('AC7: the detail-pane hint for EDT SERVICES/OTHER SERVICES matches Enter\'s actual behavior', async () => {
    const store = createAppStore();
    const target = edtEntry({
      ulid: 'active-ulid',
      topic: 'active-edt',
      status: 'active',
      members: [{ service: 'api-gateway', repoPath: '/repos/api-gateway', branch: 'main' }],
    });
    store.setState({
      edts: [target],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [
        service({ service: 'api-gateway', path: '/repos/api-gateway', isMember: true }),
        service({ service: 'route-explorer', path: '/repos/route-explorer', isMember: false }),
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: noopAsync,
      loadEdtsBranches: noopAsync,
    });
    const edtServicesOutput = await renderToString(<EdtsZone useStore={store} initialPaneFocus="edt-services" />);
    expect(edtServicesOutput).toContain('[Enter] Remove / Change branch');

    const otherServicesOutput = await renderToString(<EdtsZone useStore={store} initialPaneFocus="other-services" />);
    expect(otherServicesOutput).toContain('[Enter] Add to EDT');
  });

  it('story 2.19: a hint hidden via settings.edts.hiddenActionHints disappears from the detail pane', async () => {
    const store = createAppStore();
    const target = edtEntry({
      ulid: 'active-ulid',
      topic: 'active-edt',
      status: 'active',
      members: [{ service: 'api-gateway', repoPath: '/repos/api-gateway', branch: 'main' }],
    });
    store.setState({
      edts: [target],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [
        service({ service: 'api-gateway', path: '/repos/api-gateway', isMember: true }),
        service({ service: 'route-explorer', path: '/repos/route-explorer', isMember: false }),
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: noopAsync,
      loadEdtsBranches: noopAsync,
      settings: {
        commandPalette: { gridMaxRows: 8 },
        edts: { hiddenActionHints: ['edt-services', 'other-services'], hiddenActionTypes: [] },
      },
    });

    const edtServicesOutput = await renderToString(<EdtsZone useStore={store} initialPaneFocus="edt-services" />);
    expect(edtServicesOutput).not.toContain('[Enter] Remove / Change branch');

    const otherServicesOutput = await renderToString(<EdtsZone useStore={store} initialPaneFocus="other-services" />);
    expect(otherServicesOutput).not.toContain('[Enter] Add to EDT');
  });

  it('story 2.19 amended (AC5): an action type hidden via settings.edts.hiddenActionTypes disappears from the "Recent actions" log', async () => {
    const store = createAppStore();
    const target = edtEntry({
      ulid: 'active-ulid',
      topic: 'active-edt',
      status: 'active',
      members: [{ service: 'api-gateway', repoPath: '/repos/api-gateway', branch: 'main' }],
    });
    store.setState({
      edts: [target],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [service({ service: 'api-gateway', path: '/repos/api-gateway', isMember: true })],
      edtsBranchesStatus: 'idle',
      loadEdts: noopAsync,
      loadEdtsBranches: noopAsync,
      edtActionLog: [
        {
          id: 'a1',
          timestamp: '2026-01-01T00:00:00.000Z',
          actionType: 'modify',
          outcome: 'success',
          detail: 'Added api-gateway to EDT "active-edt"',
        },
        {
          id: 'a2',
          timestamp: '2026-01-01T00:01:00.000Z',
          actionType: 'switch',
          outcome: 'success',
          detail: 'Switched to EDT "active-edt"',
        },
      ],
      settings: {
        commandPalette: { gridMaxRows: 8 },
        edts: { hiddenActionHints: [], hiddenActionTypes: ['modify'] },
      },
    });

    const output = await renderToString(<EdtsZone useStore={store} initialPaneFocus="edts" />);
    expect(output).not.toContain('Added api-gateway to EDT "active-edt"');
    expect(output).toContain('Switched to EDT "active-edt"');
  });

  // AC2: the detail pane's horizontal position/width is derived once from ListDetailSplit's
  // flexGrow ratio (resolveSplitFlex), independent of content (list-detail-split.tsx) — this
  // regression test proves the split stays stable across the new, longer detail content this
  // story adds (longer action history + the new hint line), never a layout change.
  it('AC2: the detail pane\'s split ratio is unchanged whether the content is short or long (regression)', async () => {
    const shortStore = createAppStore();
    shortStore.setState({
      edts: [edtEntry({ ulid: 'active-ulid', topic: 'active-edt', status: 'active' })],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: noopAsync,
      loadEdtsBranches: noopAsync,
    });
    // Boundary 0 is the list<->detail split ListDetailSplit itself reads (edts-zone.tsx).
    const shortRatio = shortStore.getState().splitterRatios.edts[0];

    const longStore = createAppStore();
    longStore.setState({
      edts: [edtEntry({ ulid: 'active-ulid', topic: 'active-edt', status: 'active' })],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: noopAsync,
      loadEdtsBranches: noopAsync,
      edtActionLog: Array.from({ length: 5 }, (_, index) => ({
        id: `action-${index}`,
        timestamp: '2026-01-01T00:00:00.000Z',
        actionType: 'modify',
        outcome: 'success' as const,
        detail: `A much longer action detail line, number ${index}, describing exactly what changed in this modification`,
      })),
    });
    const longRatio = longStore.getState().splitterRatios.edts[0];

    // Same ratio input -> resolveSplitFlex (the sole width driver, confirmed content-blind by
    // reading list-detail-split.tsx) returns identical flexGrow values regardless of how much
    // text the detail pane's children happen to render.
    expect(resolveSplitFlex(longRatio)).toEqual(resolveSplitFlex(shortRatio));

    const shortOutput = await renderToString(<EdtsZone useStore={shortStore} />);
    const longOutput = await renderToString(<EdtsZone useStore={longStore} />);
    // The longer action history actually renders (proves the test exercises real growth)...
    expect(longOutput).toContain('A much longer action detail line, number 4');
    expect(shortOutput).not.toContain('A much longer action detail line');
    // ...while the ratio driving the split's own layout never changed.
    expect(longStore.getState().splitterRatios.edts).toEqual(shortStore.getState().splitterRatios.edts);
  });
});

