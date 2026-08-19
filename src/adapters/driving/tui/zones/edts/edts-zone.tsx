// tui/zones/edts: story 2.6 (FR-9) — the EDTs zone's real content, replacing the
// ZonePlaceholder stub. Calls the store's loadEdtsBranches action on mount (which runs
// core/edt/list.ts's listEdtBranchesDivergence in-process, AD-2), then renders every managed
// service's branch + ahead/behind uniformly for EDT members and non-members alike (AC4).
//
// Component boundary note (UX-DR17): DetailPane wraps its `children` in a single Ink <Text>
// internally, so only Text-safe content (a joined string, not nested <Box>) goes through it;
// a per-service git-error `detail.message` is rendered as a DimAnnotation *sibling* of
// DetailPane, never nested inside it and never inlined into the ListRow itself.
import { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ServiceBranchDivergence } from '../../../../../core/edt/list.js';
import type { NavigationKey } from '../../keybindings/index.js';
import { useAppStore, type AppStore } from '../../store/app-store.js';
import { DetailPane } from '../../shared/components/detail-pane.js';
import { DimAnnotation } from '../../shared/components/dim-annotation.js';
import { ListDetailSplit } from '../../shared/components/list-detail-split.js';
import { ListRow } from '../../shared/components/list-row.js';
import { colors, spacing } from '../../shared/theme/theme.js';

// A fixed max width (the spec's "ellipsizes past a fixed max width") — generous enough for
// most feature-branch naming conventions while keeping the list column narrow. The full,
// untruncated name is always shown in the detail pane for the focused row.
export const BRANCH_MAX_WIDTH = 24;

export function truncateBranchLabel(branch: string, maxWidth: number): string {
  if (maxWidth <= 0) {
    return '';
  }
  if (branch.length <= maxWidth) {
    return branch;
  }
  if (maxWidth === 1) {
    return '…';
  }
  return `${branch.slice(0, maxWidth - 1)}…`;
}

// The row's trailing meta — always includes a branch (truncated) plus the divergence state,
// per status. 'current' matches the matrix's literal example format (`main +2/-0`);
// 'no-upstream'/'unknown-offline' are explicit words, never a numeric value (the spec's
// Never clause), and a branch: null (e.g. detached HEAD) degrades to a placeholder rather
// than crashing the row.
export function formatServiceMeta(service: ServiceBranchDivergence): string {
  const branch = service.branch !== null ? truncateBranchLabel(service.branch, BRANCH_MAX_WIDTH) : '(unknown)';
  switch (service.status) {
    case 'current':
      return `${branch} +${service.ahead ?? 0}/-${service.behind ?? 0}`;
    case 'no-upstream':
      return `${branch} — no upstream`;
    case 'unknown-offline':
    default:
      return `${branch} — unknown (offline)`;
  }
}

// The detail pane's body for the focused service — always the *untruncated* branch name
// (the spec's "full name available on hover/focus"), joined into one string since
// DetailPane's children render inside a single Ink <Text>.
export function formatServiceDetail(service: ServiceBranchDivergence): string {
  const lines = [
    `Path: ${service.path}`,
    `Membership: ${service.isMember ? 'EDT member' : 'Not an EDT member'}`,
    `Branch: ${service.branch ?? 'unknown'}`,
  ];
  if (service.status === 'current') {
    lines.push(`Divergence: +${service.ahead ?? 0} ahead / -${service.behind ?? 0} behind`);
  } else if (service.status === 'no-upstream') {
    lines.push('Divergence: no upstream configured');
  } else {
    lines.push('Divergence: unknown (offline)');
  }
  return lines.join('\n');
}

// Review patch: listEdtBranchesDivergence's `unreachable`/`errors` were computed but never
// surfaced by the TUI — only `services` made it into view, silently dropping a real listing
// problem the CLI's `tui-back edts` already shows. A brief, pure-testable summary line —
// null when there is nothing to report, so callers can render it conditionally without
// duplicating the "both empty" check.
export function formatIssuesSummary(unreachableCount: number, errorCount: number): string | null {
  if (unreachableCount === 0 && errorCount === 0) {
    return null;
  }
  const parts: string[] = [];
  if (unreachableCount > 0) {
    parts.push(`${unreachableCount} unreachable`);
  }
  if (errorCount > 0) {
    parts.push(`${errorCount} error${errorCount === 1 ? '' : 's'}`);
  }
  return parts.join(', ');
}

// Review patch: extracted so the arrow-key row-focus transition is unit-testable directly —
// the shared renderToString test harness's fake stdin never emits data, so a useInput
// callback itself is registered but never invoked by any test in the repo (mirrors
// app-shell.tsx's shouldSwitchZone/shouldQuit pattern: interpret the key as a pure function,
// dispatch the interpreted value from the hook).
// Story 2.7: canonical navigation contract retires j/k/g/G in favor of arrows/Home/End —
// arrow/Home/End keys produce an empty `input` string in Ink, only `key` flags are set.
export type SelectionDirection = 'up' | 'down';

export function resolveSelectionDirection(key: NavigationKey): SelectionDirection | null {
  if (key.downArrow) {
    return 'down';
  }
  if (key.upArrow) {
    return 'up';
  }
  return null;
}

export function moveSelection(current: number, direction: SelectionDirection, length: number): number {
  if (length === 0) {
    return 0;
  }
  const next = direction === 'down' ? current + 1 : current - 1;
  return Math.min(Math.max(next, 0), length - 1);
}

// Story 2.7: Home/End jump-to-top/bottom, extracted as a pure function for the same reason
// resolveSelectionDirection is — the useInput callback itself is never invoked by any test
// in this repo (fake stdin never emits data), so the matrix's two jump rows are only
// verifiable by testing the interpretation logic directly.
export type SelectionJump = 'top' | 'bottom';

export function resolveSelectionJump(key: NavigationKey): SelectionJump | null {
  if (key.home) {
    return 'top';
  }
  if (key.end) {
    return 'bottom';
  }
  return null;
}

export function jumpSelection(jump: SelectionJump, length: number): number {
  if (length === 0) {
    return 0;
  }
  return jump === 'top' ? 0 : length - 1;
}

export function EdtsZone({ useStore = useAppStore }: { useStore?: AppStore }) {
  const ratio = useStore((state) => state.splitterRatios.edts);
  const services = useStore((state) => state.edtsBranches);
  const status = useStore((state) => state.edtsBranchesStatus);
  const error = useStore((state) => state.edtsBranchesError);
  const unreachable = useStore((state) => state.edtsUnreachable);
  const errors = useStore((state) => state.edtsErrors);
  const loadEdtsBranches = useStore((state) => state.loadEdtsBranches);

  useEffect(() => {
    void loadEdtsBranches();
    // Deliberately fires once on mount only — a re-render never re-triggers a fetch of its
    // own; an explicit refresh action is a later story's concern (Design Notes: "refreshed
    // on-demand ... not cached indefinitely").
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Review patch: a reload that fails *after* a successful load previously left `services`
  // (now stale) in place while `edtsBranchesStatus` flipped to 'error' — the zone rendered
  // the stale row list and the "Failed to load services" banner at once, which is
  // misleading and breaks the "never a stale value" principle this story applies everywhere
  // else (no-upstream/unknown-offline). An error state now shows only the error — never the
  // rows or the detail pane content that would otherwise still reference them.
  const rows = status === 'error' ? [] : (services ?? []);
  // Same "never a stale value on error" gating as `rows` above.
  const issuesSummary = status === 'error' ? null : formatIssuesSummary(unreachable.length, errors.length);
  const [selected, setSelected] = useState(0);
  const clampedSelected = rows.length === 0 ? 0 : Math.min(selected, rows.length - 1);

  useInput((_input, key) => {
    const jump = resolveSelectionJump(key);
    if (jump !== null) {
      setSelected(jumpSelection(jump, rows.length));
      return;
    }
    const direction = resolveSelectionDirection(key);
    if (direction === null) {
      return;
    }
    setSelected((current) => moveSelection(current, direction, rows.length));
  });

  const focused: ServiceBranchDivergence | undefined = rows[clampedSelected];
  const loading = status === 'loading' && rows.length === 0;

  return (
    <Box flexDirection="column" flexGrow={1} backgroundColor={colors.surface}>
      <ListDetailSplit
        ratio={ratio}
        list={
          <Box flexDirection="column" paddingX={spacing['pane-padding-x']}>
            <Text color={colors['text-dim']}>EDTS</Text>
            {loading ? <Text color={colors['text-dim']}>Loading services…</Text> : null}
            {status === 'error' ? <Text color={colors.error}>Failed to load services</Text> : null}
            {!loading && status !== 'error' && rows.length === 0 ? (
              <Text color={colors['text-dim']}>No managed services found.</Text>
            ) : null}
            {issuesSummary ? <DimAnnotation text={issuesSummary} /> : null}
            {rows.map((service, index) => (
              <ListRow
                key={service.path}
                label={service.service}
                meta={formatServiceMeta(service)}
                selected={index === clampedSelected}
              />
            ))}
          </Box>
        }
        detail={
          <Box flexDirection="column" paddingX={spacing['pane-padding-x']}>
            <DetailPane title={focused ? focused.service : 'Service'}>
              {focused ? formatServiceDetail(focused) : 'No service selected.'}
            </DetailPane>
            {focused?.detail ? <DimAnnotation text={focused.detail.message} /> : null}
            {status === 'error' && error ? <DimAnnotation text={error} /> : null}
          </Box>
        }
      />
    </Box>
  );
}
