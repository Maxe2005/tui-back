// tui/zones/edts: pure formatters (branch, service, issues, EDT rows/details, action hints) for the EdtsZone.
import { EDT_SYSTEM_READONLY_CODE, EDT_SYSTEM_READONLY_MESSAGE, isSystemEdt } from '../../../../../../core/workspace/edt/shared-edt/shared-edt.js';
import type { ServiceBranchDivergence } from '../../../../../../core/workspace/edt/lifecycle/list.js';
import type { EdtRegistryEntry } from '../../../../../../core/ports/storage/edt-registry.js';
import { resolveAssistedAction } from '../../../shared/components/lists/failed-result-list.js';
import { formatHint, formatHints } from '../../../shared/components/dialogs/hints.js';
import type { PaneFocus } from './edts-zone.focus.logic.js';

// A fixed max width past which branch names ellipsize — generous enough for most feature-branch
// naming conventions while keeping the list column narrow. The full, untruncated name is always
// shown in the detail pane for the focused row.
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

// The row's trailing meta — always a branch (truncated) plus the divergence state. 'current'
// reads like `main +2/-0`; 'no-upstream'/'unknown-offline' are explicit words, never a numeric
// value, and a branch: null (e.g. detached HEAD) degrades to a placeholder rather than crashing.
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

// The detail pane's body for the focused service — always the *untruncated* branch name, joined
// into one string since DetailPane's children render inside a single Ink <Text>.
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

// listEdtBranchesDivergence's `unreachable`/`errors`, so a real listing problem shows in the TUI
// as it does in `tui-back edts`. A brief, pure-testable summary line — null when there is
// nothing to report, so callers can render it conditionally.
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

// Picks which of the theme's two "something's wrong" colors the summary above renders with, so
// it reads as worth stopping for. `errors` (a genuine read failure) outranks `unreachable` (a path
// just not found) when both are present, the same ranking as `formatIssuesSummary`'s part order.
export type IssuesSeverity = 'error' | 'warning';

export function resolveIssuesSeverity(unreachableCount: number, errorCount: number): IssuesSeverity | null {
  if (errorCount > 0) {
    return 'error';
  }
  if (unreachableCount > 0) {
    return 'warning';
  }
  return null;
}

export type IssueExplanation = {
  reason: string;
  suggestion: string;
};

// A small extensible registry mapping a BranchDivergenceEntryError.code to a plain-language reason
// + suggested next step — like failed-result-list.tsx's resolveAssistedAction (a new code gets a
// new entry, never a renderer change). Codes come from registry.exists()/manifest.load() failures
// surfaced by listEdtBranchesDivergence; manifest-not-found never reaches here (silently skipped
// upstream as a genuinely unmanaged repo).
const ISSUE_EXPLANATIONS: Record<string, IssueExplanation> = {
  'manifest-invalid-yaml': {
    reason: '.tui-back.yaml is not valid YAML',
    suggestion: 'fix the file’s syntax, then reload this zone',
  },
  'manifest-validation-failed': {
    reason: '.tui-back.yaml fails schema validation',
    suggestion: 'check its fields against the manifest schema, then reload',
  },
  'unknown-module': {
    reason: '.tui-back.yaml declares a module this tool does not recognize',
    suggestion: 'fix the module name in the manifest, then reload',
  },
  'registry-stat-error': {
    reason: 'this path could not be checked on disk',
    suggestion: 'check filesystem permissions for this path',
  },
};

export function explainIssueErrorCode(code: string): IssueExplanation {
  // hasOwnProperty guard (mirrors resolveAssistedAction): a plain lookup would resolve an
  // inherited Object.prototype key (e.g. a hypothetical code literally named "constructor")
  // to a truthy non-IssueExplanation value.
  if (!Object.prototype.hasOwnProperty.call(ISSUE_EXPLANATIONS, code)) {
    return { reason: 'an unexpected error occurred', suggestion: 'check the message above, then reload this zone' };
  }
  return ISSUE_EXPLANATIONS[code] ?? { reason: 'an unexpected error occurred', suggestion: 'check the message above, then reload this zone' };
}

export function explainUnreachable(): IssueExplanation {
  return {
    reason: 'no longer found at this path (moved or deleted)',
    suggestion: 'open Repo Registry → Clean stale entries to deregister it',
  };
}

// ---- Base-view focus and forms -----------------------------------------------------------

// Takes no `isActive` — the "— active" suffix is `ListRow`'s own `active` prop (a discreet,
// independently-colored suffix), so this stays a pure member-count formatter.
export function formatEdtRowMeta(entry: EdtRegistryEntry): string {
  const count = entry.members.length;
  const members = `${count} member${count === 1 ? '' : 's'}`;
  // A text badge, never colour alone, marks the system EDT.
  return isSystemEdt(entry) ? `[${SHARED_EDT_BADGE}] ${members}` : members;
}

// The topic of the EDT being left, for the dirty-work resolution view; null when there is none or
// it is the system EDT (nothing to adopt dirty work into: stash or discard only).
export function resolveOutgoingTopic(edts: readonly EdtRegistryEntry[], activeUlid: string | null): string | null {
  const outgoing = activeUlid === null ? undefined : edts.find((entry) => entry.ulid === activeUlid);
  return outgoing === undefined || isSystemEdt(outgoing) ? null : outgoing.topic;
}

export const SHARED_EDT_BADGE = 'shared';

// What Enter / a mutating key says on the system EDT: the 2.46 refusal, with its code.
export const SYSTEM_EDT_NOTICE = `${EDT_SYSTEM_READONLY_CODE}: ${EDT_SYSTEM_READONLY_MESSAGE}`;

export function formatEdtDetail(entry: EdtRegistryEntry, isActive: boolean): string {
  const system = isSystemEdt(entry);
  const lines = [
    `Topic: ${entry.topic}`,
    ...(system ? [`Kind: ${SHARED_EDT_BADGE} (system, read-only: switch and update only)`] : []),
    `Status: ${isActive ? 'active' : entry.status}`,
    entry.members.length === 0 ? 'Members: none' : system ? 'Members (every service on its shared branch):' : 'Members:',
    ...entry.members.map((member) => `  - ${member.service} (${member.branch})`),
  ];
  return lines.join('\n');
}

// Formats the EDT action history for the detail pane: a joined string with timestamps (dim),
// outcome glyphs, and action details. `hiddenActionTypes` filters `actionLog` first — a live read
// of `settings.edts.hiddenActionTypes`, never a cached copy, like `resolveActionHint`'s read of
// `hiddenActionHints`. Defaults to `[]` (nothing hidden).
export function formatEdtActionHistory(
  actionLog: Array<{ id: string; timestamp: string; actionType: string; outcome: 'success' | 'failed'; detail: string }>,
  inProgressAction: { type: 'create' | 'create-from' | 'switch' | 'modify' | 'delete'; target: string; startedAt: string } | null,
  hiddenActionTypes: readonly string[] = [],
): string {
  const lines: string[] = [];

  // In-progress action
  if (inProgressAction) {
    const typeLabel = inProgressAction.type.charAt(0).toUpperCase() + inProgressAction.type.slice(1);
    lines.push(`⣾ ${typeLabel} "${inProgressAction.target}"…`);
    lines.push(''); // blank line separator
  }

  // Recent actions — filtered by hiddenActionTypes first, so a fully-hidden log (every entry
  // is a hidden type) reads the same as a genuinely-empty one ("No actions yet"), never a
  // dangling "Recent actions:" header with nothing under it.
  const visibleActionLog = actionLog.filter((entry) => !hiddenActionTypes.includes(entry.actionType));
  if (visibleActionLog.length === 0) {
    lines.push('No actions yet');
  } else {
    lines.push('Recent actions:');
    for (const entry of visibleActionLog) {
      const time = new Date(entry.timestamp).toLocaleTimeString();
      const glyph = entry.outcome === 'success' ? '✔' : '✖';
      const typeLabel = entry.actionType.charAt(0).toUpperCase() + entry.actionType.slice(1);
      lines.push(`  ${glyph} [${time}] ${typeLabel}: ${entry.detail}`);
    }
  }

  return lines.join('\n');
}

// The context-derived "Available:" hint line — what Enter actually does in the focused pane.
// Never lists `c`/`m`: they are not direct keys. The zone's render joins it with
// formatEdtDetail/formatEdtActionHistory using the same '\n\n' separator.
export function formatAvailableActionsHint(paneFocus: PaneFocus, focusedIsActiveEdt: boolean, focusedIsSystemEdt = false): string {
  if (focusedIsSystemEdt) {
    // Read-only: a switch (not to itself when already active) and the fast-forward quick action.
    if (paneFocus !== 'edts') {
      return '';
    }
    return focusedIsActiveEdt ? formatHint(['f', 'Fast-forward']) : formatHints([['Enter', 'Switch'], ['f', 'Fast-forward']]);
  }
  switch (paneFocus) {
    case 'edts':
      return formatHint(['Enter', focusedIsActiveEdt ? 'Modify' : 'Switch']);
    case 'edt-services':
      return formatHint(['Enter', 'Remove / Change branch']);
    case 'other-services':
      return formatHint(['Enter', 'Add to EDT']);
    default:
      return '';
  }
}

// Each `PaneFocus` value is exactly the hint token id the settings screen's EDTs tab offers to
// hide (HIDEABLE_ACTION_HINTS). A pure read of the live `settings.edts.hiddenActionHints`, never
// a cached copy, so a toggle reflects on the very next render. Returns '' (never null) so call
// sites can join unconditionally when non-empty.
export function resolveActionHint(
  paneFocus: PaneFocus,
  focusedIsActiveEdt: boolean,
  hiddenActionHints: readonly string[],
  focusedIsSystemEdt = false,
): string {
  if (hiddenActionHints.includes(paneFocus)) {
    return '';
  }
  return formatAvailableActionsHint(paneFocus, focusedIsActiveEdt, focusedIsSystemEdt);
}

// A hidden hint (resolveActionHint returning '') must vanish cleanly — no dangling blank
// paragraph left where it would render — rather than joining an empty string with '\n\n'.
export function appendHint(hint: string): string {
  return hint ? '\n\n' + hint : '';
}

// Splits the flat services list into EDT SERVICES (rows whose `path` is a member of the
// *selected* EDT — never `row.isMember`, which stays tied to the *active* EDT for its divergence
// badge) and OTHER SERVICES (everything else). `focusedEdt` undefined -> every row lands in OTHER
// SERVICES; callers show a "No EDT selected" note instead of an empty EDT SERVICES section.
export function partitionServicesByEdtMembership(
  rows: readonly ServiceBranchDivergence[],
  focusedEdt: EdtRegistryEntry | undefined,
): { edtServices: ServiceBranchDivergence[]; otherServices: ServiceBranchDivergence[] } {
  if (focusedEdt === undefined) {
    return { edtServices: [], otherServices: [...rows] };
  }
  const memberPaths = new Set(focusedEdt.members.map((member) => member.repoPath));
  const edtServices = rows.filter((row) => memberPaths.has(row.path));
  const otherServices = rows.filter((row) => !memberPaths.has(row.path));
  return { edtServices, otherServices };
}
