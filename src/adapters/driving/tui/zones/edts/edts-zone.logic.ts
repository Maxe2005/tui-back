// tui/zones/edts: the EdtsZone's pure, non-React logic — formatting, selection/navigation math,
// form-focus derivation, and the dialogs' state shapes + initializers. Kept out of edts-zone.tsx
// so each concern is reachable without scrolling past the Ink component; every export is
// unit-tested directly, with no React import.
import type { ActivationBlockedRepo } from '../../../../../core/edt/activate.js';
import type { MemberBranchPlan } from '../../../../../core/edt/create.js';
import { defaultDispositionFor, type MemberDeleteStatus, type MemberDisposition } from '../../../../../core/edt/delete.js';
import type { ServiceBranchDivergence } from '../../../../../core/edt/list.js';
import type { SwitchEdtRepoResult } from '../../../../../core/edt/switch.js';
import type { EdtRegistryEntry } from '../../../../../core/ports/edt-registry.js';
import type { NavigationKey } from '../../shared/keys/navigation-key.js';
import { stepFocus, type FocusNavDeclaration, type FocusNavDirection } from '../../shared/keys/focus-navigation.js';
import { createBranchPickerState, applyBranchPickerRetry, type BranchPickerState } from '../../shared/components/branch-picker.js';
import { resolveAssistedAction, type FailedResultRow } from '../../shared/components/failed-result-list.js';
import type { MenuItem } from '../../shared/components/menu-list.js';
import { createFilterablePickListState, type FilterablePickListState } from '../../shared/components/filterable-pick-list.js';
import type { TextInputState } from '../../shared/components/text-edit.js';
import type { OverrideBoxState } from './dialogs/create-wizard/override-box.logic.js';
import type { SwitchResolutionState } from './dialogs/switch-resolution/switch-resolution.logic.js';

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

export {
  jumpSelection,
  moveSelection,
  resolveSelectionDirection,
  resolveSelectionJump,
} from '../../shared/keys/list-cursor.js';
export type { SelectionDirection, SelectionJump } from '../../shared/keys/list-cursor.js';

// ---- Base-view focus and forms -----------------------------------------------------------

// Tab's second consumer (the first is cycleFormFocus below, inside a form): cycling which of the
// three simultaneously-visible base-view lists arrows/Home/End move — EDTS, EDT SERVICES and
// OTHER SERVICES (partitioned by the *selected* EDT's membership, see
// partitionServicesByEdtMembership). Default focus is the EDT selector.
export type PaneFocus = 'edts' | 'edt-services' | 'other-services';

export const PANE_FOCUS_NAV: FocusNavDeclaration<PaneFocus> = {
  mode: 'tab',
  stops: ['edts', 'edt-services', 'other-services'],
};

export function cyclePaneFocus(current: PaneFocus, direction: FocusNavDirection = 'next'): PaneFocus {
  return stepFocus(PANE_FOCUS_NAV.stops, current, direction);
}

// Tab's first consumer: cycling a form's topic-input ↔ member-checklist while a
// create/switch/modify dialog is open.
export type FormFocus = 'topic' | 'members';

export const FORM_FOCUS_NAV: FocusNavDeclaration<FormFocus> = { mode: 'tab', stops: ['topic', 'members'] };

export function cycleFormFocus(current: FormFocus, direction: FocusNavDirection = 'next'): FormFocus {
  return stepFocus(FORM_FOCUS_NAV.stops, current, direction);
}

// The hand-rolled controlled text-input interpreter (`TextEditKey`/`TextInputState`/
// `nextTextInputValue`) lives in shared/components/text-edit.ts — a leaf module, so the shared
// branch-autocomplete input can reuse it without closing an import cycle back through
// branch-picker.

// The checkbox-list-item pure toggle (Space): member selection for the create/modify forms.
export function toggleMemberSelection(selected: readonly string[], path: string): string[] {
  return selected.includes(path) ? selected.filter((candidate) => candidate !== path) : [...selected, path];
}

// Rejects an empty value in the branch-edit flow inline so it never reaches modifyEdt
// unvalidated. Returns the inline error message, or null when valid.
export function validateBranchEditValue(value: string): string | null {
  return value.trim() === '' ? 'Branch name must not be empty' : null;
}

// ---- New-member branch suggestion --------------------------------------------------------
// Suggestion for a not-yet-member candidate newly checked in the Modify dialog: reuse the EDT's
// shared branch when every existing member agrees on one (>=1 member exists), otherwise fall back
// to the topic-slug suggestion the create flow uses.
export function suggestBranchForNewMember(existingMembers: readonly { branch: string }[], topic: string): string {
  const first = existingMembers[0];
  if (first !== undefined && existingMembers.every((member) => member.branch === first.branch)) {
    return first.branch;
  }
  return suggestBranchNameFromTopic(topic);
}

// ---- Branch-name suggestion --------------------------------------------------------------

// Slugifies a topic into a branch-name suggestion — lowercase, then any run of non-alphanumeric
// characters collapses to a single '-', trimmed of leading/trailing '-' (e.g. "Fix Auth Bug!!" ->
// "fix-auth-bug"). Pure and total: an all-punctuation topic slugifies to '' — exactly what
// validateBranchEditValue catches, never silently patched over with a fallback name.
export function suggestBranchNameFromTopic(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// The create dialog's form focus; Step 3's own focus lives in BranchStepState below (panel /
// globalLine / editing / rowCursor / box).
export type CreateFormFocus = FormFocus;

// ---- Create wizard Step 3 ----------------------------------------------------------------
// The "global strategy + per-service exceptions" state. A row override is exactly core's
// MemberBranchPlan: `create` renders as [Create (Custom)], `existing` as [Existante] — or
// [Rename] once `renameTo` is set. A path with no override follows Panel A's global rule
// ([Create (Global)]).
export type RowOverride = MemberBranchPlan;

// One service's branch lists, loaded once per Step 3 entry (a failed load is retried on the
// next entry). `pending` = requested by the entry, not yet in flight (the zone's effect picks
// it up and flips it to `loading`, see edts-zone.tsx) — keeps enterStep itself pure.
export type BranchListStatus = 'pending' | 'loading' | 'ready' | 'error';

export type BranchListState = {
  status: BranchListStatus;
  local: readonly string[];
  remote: readonly string[];
  error?: string;
};

export type BranchStepState = {
  globalBase: TextInputState; // '' = each service uses its own manifest sharedBranch
  globalName: TextInputState;
  // Touched-flag convention: an untouched name keeps tracking Step 1's slug.
  globalNameTouched: boolean;
  panel: 'global' | 'rows';
  globalLine: 'base' | 'name';
  editing: boolean; // Panel A's focused line is in edit mode
  rowCursor: number;
  overrides: Readonly<Record<string, RowOverride>>;
  lists: Readonly<Record<string, BranchListState>>;
  box: OverrideBoxState | null;
  // The root-EDT members already given their seeded [Create (Custom)] override — each path is
  // seeded at most once, so a row the developer reset to global stays global.
  seededPaths: readonly string[];
};

export function initialBranchStepState(): BranchStepState {
  return {
    globalBase: { value: '', cursor: 0 },
    globalName: { value: '', cursor: 0 },
    globalNameTouched: false,
    panel: 'global',
    globalLine: 'base',
    editing: false,
    rowCursor: 0,
    overrides: {},
    lists: {},
    box: null,
    seededPaths: [],
  };
}

export function isSwitchBlockedError(code: string): boolean {
  return code === 'switch-blocked-action-in-progress';
}

// createEdt/switchActiveEdt/modifyEdt are per-repo/per-member isolated — one repo's failure (a
// protected-branch rejection, a stash/checkout error, a manifest-load failure) never fails the
// overall action, so `result.ok === true` can still carry `results` rows with `outcome:
// 'failed'`. Every submit handler inspects `results` rather than closing the dialog as if every
// requested change had applied.
type FailableResultRow = { service: string; outcome: string; detail?: { code: string; message: string } };

// Returns a structured FailedResultRow[] (never a `; `-joined string) — one row per failed repo,
// rendered by the shared FailedResultList at every partial-failure call site. `code` is carried
// through as-is (resolveAssistedAction decides from it whether a row gets a guided action); a
// `failed` row's `detail` is always set in practice, but a defensive fallback keeps this total.
export function summarizeFailedResults(results: readonly FailableResultRow[]): FailedResultRow[] {
  return results
    .filter((row) => row.outcome === 'failed')
    .map((row) => ({
      service: row.service,
      ...(row.detail?.code !== undefined ? { code: row.detail.code } : {}),
      message: row.detail?.message ?? 'Failed',
    }));
}

// Create and Switch never get the "try a different branch" retry — `resolveMemberBranch` never
// passes an `edtId` to `assertAllowedBranch` at create time, and `switchActiveEdt` carries no
// per-member branch override to retry into. Stripping `code` here (used only at those two call
// sites) makes `resolveAssistedAction` treat every row as unregistered — even
// `branch-owned-by-other-edt` — rather than `FailedResultList` knowing which dialogs may offer
// the affordance.
export function stripAssistedActionCodes(rows: readonly FailedResultRow[]): FailedResultRow[] {
  return rows.map((row) => ({ service: row.service, message: row.message }));
}

// Shared by the Modify and service-actions "try a different branch" Enter handlers — both need
// the same "first row with a registered action" lookup.
export function findRetryableFailedRow(failedRows: readonly FailedResultRow[]): FailedResultRow | undefined {
  return failedRows.find((row) => resolveAssistedAction(row.code) !== null);
}

// Takes no `isActive` — the "— active" suffix is `ListRow`'s own `active` prop (a discreet,
// independently-colored suffix), so this stays a pure member-count formatter.
export function formatEdtRowMeta(entry: EdtRegistryEntry): string {
  const count = entry.members.length;
  return `${count} member${count === 1 ? '' : 's'}`;
}

export function formatEdtDetail(entry: EdtRegistryEntry, isActive: boolean): string {
  const lines = [
    `Topic: ${entry.topic}`,
    `Status: ${isActive ? 'active' : entry.status}`,
    entry.members.length === 0 ? 'Members: none' : 'Members:',
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
export function formatAvailableActionsHint(paneFocus: PaneFocus, focusedIsActiveEdt: boolean): string {
  switch (paneFocus) {
    case 'edts':
      return focusedIsActiveEdt ? '[Enter] Modify' : '[Enter] Switch';
    case 'edt-services':
      return '[Enter] Remove / Change branch';
    case 'other-services':
      return '[Enter] Add to EDT';
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
): string {
  if (hiddenActionHints.includes(paneFocus)) {
    return '';
  }
  return formatAvailableActionsHint(paneFocus, focusedIsActiveEdt);
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

// The candidate list's four distinct states — a still-loading fetch, a genuinely-empty registry,
// a load failure, and a ready-with-rows list — never conflated (a failed or pending load must
// never read as "No registered services available.").
export type CandidateListState = 'loading' | 'error' | 'empty' | 'ready';

export function resolveCandidateListState(
  status: 'idle' | 'loading' | 'error',
  candidateCount: number,
): CandidateListState {
  if (status === 'loading') {
    return 'loading';
  }
  if (status === 'error') {
    return 'error';
  }
  return candidateCount === 0 ? 'empty' : 'ready';
}

// A row is branch-editable when it's currently checked AND it wasn't already a member when the
// dialog opened — an unchecked row's edit would be dropped at submit anyway, and an existing
// member's branch is changed via the EDT SERVICES row's "Change branch for this EDT" menu. A
// newly checked candidate auto-stages a branchEdits entry (suggestBranchForNewMember), so Enter
// opens the branch-edit flow on it. `originalMemberPaths` (the dialog-open-time membership
// snapshot) excludes already-checked existing members, so Enter on them submits the form.
export function canEditMemberBranch(repoPath: string, selectedMembers: readonly string[], originalMemberPaths: ReadonlySet<string>): boolean {
  return selectedMembers.includes(repoPath) && !originalMemberPaths.has(repoPath);
}

export type ModifyEnterAction = { type: 'submit' } | { type: 'edit-branch'; repoPath: string };

// Members-focus Enter is contextual: on a branch-editable row it opens the branch-edit flow;
// everywhere else (topic-focus always, or a row that isn't branch-editable) it submits the whole
// form — Enter always confirms *something* (UX-DR8), never a dead key.
export function resolveModifyEnterAction(
  formFocus: FormFocus,
  selectedMembers: readonly string[],
  focusedPath: string | undefined,
  originalMemberPaths: ReadonlySet<string>,
): ModifyEnterAction {
  if (formFocus === 'members' && focusedPath !== undefined && canEditMemberBranch(focusedPath, selectedMembers, originalMemberPaths)) {
    return { type: 'edit-branch', repoPath: focusedPath };
  }
  return { type: 'submit' };
}

export interface ResolvedModifyOps {
  addMembers: string[];
  removeMembers: string[];
  setBranches: Array<{ repoPath: string; branch: string }>;
  renameBranches: Array<{ repoPath: string; newName: string }>;
  renameTo?: string;
}

// The modify form's submit-op derivation, a pure function so the rule "drop any staged
// branch-edit for a member no longer in the current selection" is unit-testable without an async
// submit round-trip. `branchRenames` is a sibling of `branchEdits`, never overlapping (a rename
// on an *existing* member stages into branchRenames only, since modifyEdt's renameBranches step
// both renames the ref and records the branch change). The same drop-if-unselected rule applies.
export function resolveModifyOps(
  target: EdtRegistryEntry,
  topic: string,
  selectedMembers: readonly string[],
  branchEdits: Readonly<Record<string, string>>,
  branchRenames: Readonly<Record<string, string>> = {},
): ResolvedModifyOps {
  const originalPaths = new Set(target.members.map((member) => member.repoPath));
  const selectedPaths = new Set(selectedMembers);

  const addMembers = selectedMembers.filter((path) => !originalPaths.has(path));
  const removeMembers = target.members.map((member) => member.repoPath).filter((path) => !selectedPaths.has(path));

  // A branch edit staged for a since-unchecked member must never reach modifyEdt — dropped here,
  // before any setBranches entry is built (a real `git checkout` on a repo the developer just
  // told the form to drop). Conversely, every checked non-member (addMembers) always carries a
  // setBranches entry, so modify.ts's step 1 always finds a match instead of failing
  // `branch-required`. Confirm is blocked when that staged value is empty (submitModify), so the
  // '' fallback below is a safety net, not the normal path.
  const branchEditsForSelected = new Map(Object.entries(branchEdits).filter(([path]) => selectedPaths.has(path)));
  for (const path of addMembers) {
    if (!branchEditsForSelected.has(path)) {
      branchEditsForSelected.set(path, '');
    }
  }
  const setBranches = Array.from(branchEditsForSelected.entries()).map(([repoPath, branch]) => ({ repoPath, branch }));

  const renameBranches = Object.entries(branchRenames)
    .filter(([path]) => selectedPaths.has(path))
    .map(([repoPath, newName]) => ({ repoPath, newName }));

  const trimmedTopic = topic.trim();
  const renameTo = trimmedTopic !== '' && trimmedTopic !== target.topic ? trimmedTopic : undefined;

  return {
    addMembers,
    removeMembers,
    setBranches,
    renameBranches,
    ...(renameTo !== undefined ? { renameTo } : {}),
  };
}

// ---- Dialog state -----------------------------------------------------------------------

// The create-EDT wizard's 4 steps (Nom -> Services -> Branches -> Activation).
export type WizardStep = 1 | 2 | 3 | 4;

export type CreateDialogState = {
  kind: 'create';
  // The wizard's current step.
  step: WizardStep;
  topic: string;
  // topic's own caret position — see TextInputState/nextTextInputValue in
  // shared/components/text-edit.ts.
  topicCursor: number;
  formFocus: CreateFormFocus;
  selectedMembers: readonly string[];
  memberCursor: number;
  submitting: boolean;
  error: string | null;
  // The structured per-repo breakdown for a partial failure riding inside an ok:true result
  // (summarizeFailedResults) — rendered via FailedResultList, apart from `error` above, which
  // keeps its validation/full-failure use.
  failedRows: FailedResultRow[];
  // Step 3's whole state (global strategy, per-service overrides, branch lists, override box).
  branches: BranchStepState;
  // Step 3 decides "Esc cancels the wizard" against the latest state, inside the setDialog
  // updater, where a cancel's side effects (closing, requesting a quit) cannot run. It raises
  // this flag instead; the zone's effect then runs the wizard's cancel (see create-wizard.tsx's
  // handleCancelRequest).
  cancelRequested: boolean;
  // Step 4's activation state (see ActivationState).
  activation: ActivationState;
  // The root EDT `edt-create-from` seeded this wizard from (TUI-only state): Step 2 starts on its
  // members, Step 3 seeds each inherited row on that member's root branch.
  seedFromEdt: EdtRegistryEntry | null;
};

// What Step 4 asks the effectful handler to do once its key reducer decided (activation.logic.ts)
// — the same "reducer raises, zone effect dispatches" pattern as the switch resolution view.
export type ActivationDecision = { kind: 'retry' } | { kind: 'overwrite' } | { kind: 'stop' };

// The wizard's Step 4.
//   - `firstEdt` (captured on entering Step 4: no EDT existed) locks the choice on activating
//     through activateEdt; otherwise `choice` is the radio: switch now, or create without it.
//   - `created`: the EDT this wizard already created — once set, Retry/Overwrite only ever call
//     activateEdt again, never createEdt.
//   - `blocked`: the first-EDT pre-flight's at-risk files (the pause panel); `confirm` the
//     second, explicit overwrite confirmation over it (its file-list scroll).
//   - `outcome`: a terminal, acknowledge-only state — `stopped` (Esc on the pause panel) or
//     `not-activated` (a partial-failure create, or a failed activation).
export type ActivationState = {
  firstEdt: boolean;
  choice: 'switch' | 'stay';
  created: { ulid: string; topic: string } | null;
  blocked: ActivationBlockedRepo[] | null;
  confirm: { scroll: number } | null;
  outcome: 'stopped' | 'not-activated' | null;
  decision: ActivationDecision | null;
};

export function initialActivationState(firstEdt = false): ActivationState {
  return { firstEdt, choice: 'switch', created: null, blocked: null, confirm: null, outcome: null, decision: null };
}

export type SwitchDialogState = {
  kind: 'switch-confirm';
  target: EdtRegistryEntry;
  submitting: boolean;
  error: string | null;
  failedRows: FailedResultRow[];
  blocked: boolean;
  // The dirty-service resolution draft, non-null while the core switch is parked on the edt-slice
  // seam (initialized by the zone when `switchDirtyRepos` turns non-null).
  resolution: SwitchResolutionState | null;
  // An ok switch that adopted/discarded/failed anything keeps the dialog open on this per-repo
  // summary (Enter/Esc close it); an all-`switched` run closes.
  results?: SwitchEdtRepoResult[];
};

// A live branch-picker session, opened from any of the 3 non-creation branch-entry points.
// `branches`/`branchesStatus` are this repoPath's own `listBranches()` result, fetched once when
// the session opens (not continuously re-synced).
export type BranchPickerSession = {
  repoPath: string;
  state: BranchPickerState;
  branches: string[];
  branchesStatus: 'loading' | 'ready' | 'error';
  // Set only when this session was opened by the "try a different name/branch" assisted action —
  // confirming it re-runs the owning dialog's submit immediately (Modify: submitModify;
  // service-actions/add-to-edt resubmit on every confirm anyway, so they never set this).
  autoSubmitOnConfirm?: boolean;
};

export type ModifyDialogState = {
  kind: 'modify';
  target: EdtRegistryEntry;
  topic: string;
  // topic's own caret position — see TextInputState/nextTextInputValue in
  // shared/components/text-edit.ts.
  topicCursor: number;
  formFocus: FormFocus;
  selectedMembers: readonly string[];
  memberCursor: number;
  branchEdits: Readonly<Record<string, string>>;
  // A rename staged for an *existing* member (Rename current, or Pick-existing's row-rename
  // landing on that member's own branch) — sibling of branchEdits, never overlapping it (see
  // resolveModifyOps). A not-yet-member's rename instead lands in branchEdits directly, after an
  // eager renameMemberBranch pre-step.
  branchRenames: Readonly<Record<string, string>>;
  branchPicker: BranchPickerSession | null;
  submitting: boolean;
  error: string | null;
  failedRows: FailedResultRow[];
};

// The EDT SERVICES row contextual menu opened by Enter — Remove from EDT / Change branch for this
// EDT / a visibly disabled Restart. Three ListRows inside the existing ModalDialog,
// arrow/Home/End-navigable via the resolveSelectionDirection/moveSelection pair every list here
// uses.
export type ServiceActionValue = 'remove' | 'change-branch' | 'restart' | 'close';

export const SERVICE_ACTION_MENU_ITEMS: readonly MenuItem<ServiceActionValue>[] = Object.freeze([
  { value: 'remove', label: 'Remove from EDT' },
  { value: 'change-branch', label: 'Change branch for this EDT' },
  { value: 'restart', label: 'Restart', disabled: true, note: 'Available with Epic 5' },
]);

export type ServiceActionsDialogState = {
  kind: 'service-actions';
  edt: EdtRegistryEntry;
  repoPath: string;
  serviceName: string;
  cursor: number;
  branchPicker: BranchPickerSession | null;
  submitting: boolean;
  error: string | null;
  failedRows: FailedResultRow[];
  // The branch value last attempted via submitServiceActionsBranchChange — kept (never cleared,
  // including on failure) so a "try a different branch" retry reopens the picker pre-filled with
  // the rejected value rather than the member's still-current branch.
  lastAttemptedBranch: string | null;
  // Set only when the failed attempt was a 'rename' outcome (its oldName) — lets a retry reopen
  // onto the picker's originating field (rename) instead of Create-new, which would *create* a
  // branch when the user meant to rename.
  lastAttemptedRenameOldName: string | null;
};

// The OTHER SERVICES row's Add-to-EDT dialog opened by Enter — the branch-picker opens
// immediately (there is no "current branch" step to gate behind, so the picker *is* the dialog's
// branch step); confirm calls modifyEdt with both `addMembers` and `setBranches` for the same
// repoPath in one call (core/edt/modify.ts composes them).
export type AddToEdtDialogState = {
  kind: 'add-to-edt';
  edt: EdtRegistryEntry;
  repoPath: string;
  serviceName: string;
  branchPicker: BranchPickerSession | null;
  error: string | null;
  failedRows: FailedResultRow[];
  submitting: boolean;
};

// ---- Delete dialog -----------------------------------------------------------------------
// The delete-EDT confirm dialog's per-member row: branch, merge status, uncommitted-work status,
// plus the row's own independently-toggleable disposition.
export type DeleteMemberRow = {
  repoPath: string;
  service: string;
  branch: string;
  merged: boolean;
  clean: boolean;
  disposition: MemberDisposition;
  // Set when resolveMemberDeleteStatuses couldn't establish this member's merged/clean status (a
  // manifest or git read failed) — the row still renders and defaults to 'leave', but its
  // merged/clean values are untrustworthy, so formatDeleteMemberMeta annotates the row instead
  // of silently rendering a possibly-wrong status.
  statusError?: string;
};

export type DeleteDialogState = {
  kind: 'delete-confirm';
  target: EdtRegistryEntry;
  // null while the per-member merge/clean statuses are still being fetched (mirrors the
  // branch-picker's own "fetched once, on open" convention) — never rendered with computed
  // defaults until they resolve. Never populated at all when `rejected` is true (nothing to
  // disposition — the dialog never gets that far).
  memberRows: DeleteMemberRow[] | null;
  memberCursor: number;
  submitting: boolean;
  error: string | null;
  failedRows: FailedResultRow[];
  // The active EDT can never be deleted, nor auto-switched away from. This fires at dialog-open
  // time (edts-zone.tsx), before any member status is fetched — a rejected dialog shows only the
  // error message; Esc is the only way out, no confirm affordance is ever offered.
  rejected: boolean;
};

export function initialDeleteDialog(target: EdtRegistryEntry, isActive: boolean): DeleteDialogState {
  if (isActive) {
    return {
      kind: 'delete-confirm',
      target,
      memberRows: [],
      memberCursor: 0,
      submitting: false,
      error: `Cannot delete "${target.topic}" — it is the active EDT. Switch away from it first.`,
      failedRows: [],
      rejected: true,
    };
  }
  return {
    kind: 'delete-confirm',
    target,
    memberRows: null,
    memberCursor: 0,
    submitting: false,
    error: null,
    failedRows: [],
    rejected: false,
  };
}

// Per-member disposition defaults to 'Leave branch as-is', except a branch both merged into its
// sharedBranch and clean, which defaults to 'Delete branch'; every row stays independently
// toggleable. Reuses core/edt/delete.ts's defaultDispositionFor as the single source of truth.
export function buildDeleteMemberRows(statuses: readonly MemberDeleteStatus[]): DeleteMemberRow[] {
  return statuses.map((status) => ({
    repoPath: status.repoPath,
    service: status.service,
    branch: status.branch,
    merged: status.merged,
    clean: status.clean,
    disposition: defaultDispositionFor(status),
    ...(status.statusError !== undefined ? { statusError: status.statusError } : {}),
  }));
}

export function toggleDeleteDisposition(rows: readonly DeleteMemberRow[], index: number): DeleteMemberRow[] {
  return rows.map((row, i) => (i === index ? { ...row, disposition: row.disposition === 'delete' ? 'leave' : 'delete' } : row));
}

// The confirm dialog's per-row meta text: branch + merge status + uncommitted-work status.
export function formatDeleteMemberMeta(row: DeleteMemberRow): string {
  const mergeLabel = row.merged ? 'merged' : 'unmerged';
  const cleanLabel = row.clean ? 'clean' : 'uncommitted work';
  const base = `${row.branch} — ${mergeLabel}, ${cleanLabel}`;
  // The merged/clean values above are not to be trusted when a status read failed — say so
  // explicitly rather than rendering a plausible-looking status.
  return row.statusError !== undefined ? `${base} (status unknown — defaulted to leave)` : base;
}

// The issues dialog is read-only and carries no payload of its own — the unreachable/errors
// data it renders already lives in the zone's store selectors, so there is nothing to seed.
export type IssuesDialogState = { kind: 'issues' };

// ---- EDT quick-pick ----------------------------------------------------------------------
// The shared EDT quick-pick — a filterable list of EDT topics opened by a no-argument
// `edt-switch`/`edt-modify`/`edt-delete`/`edt-create-from` instead of guessing a target. One
// dialog, four modes: `mode` decides both the candidate pool (switch excludes the active EDT;
// modify/delete/create-from include it) and which pre-targeted dialog Enter opens.
export type QuickPickMode = 'switch' | 'modify' | 'delete' | 'create-from';

// The pick's own filter text, caret and highlighted row are the shared component's state
// (shared/components/filterable-pick-list.tsx), embedded here so the dialog stays one member
// of this zone's dialog union.
export type QuickPickDialogState = {
  kind: 'quick-pick';
  mode: QuickPickMode;
  // `edt-create-from <unknown>`'s inline error (`EDT not found: "<topic>"`), cleared on the first
  // filter edit.
  notFound: string | null;
} & FilterablePickListState;

export type EdtDialogState =
  | { kind: 'none' }
  | CreateDialogState
  | SwitchDialogState
  | ModifyDialogState
  | ServiceActionsDialogState
  | AddToEdtDialogState
  | DeleteDialogState
  | IssuesDialogState
  | QuickPickDialogState;

export function initialIssuesDialog(): IssuesDialogState {
  return { kind: 'issues' };
}

export function initialQuickPickDialog(mode: QuickPickMode, notFound: string | null = null): QuickPickDialogState {
  return { kind: 'quick-pick', mode, notFound, ...createFilterablePickListState() };
}

// `seed` (edt-create-from's root EDT) pre-checks Step 2 with its members, in root order; Step 3's
// per-row seeding happens on entering it (wizard.logic.ts's enterBranchStep), once the global
// name is known. The topic always starts empty — never derived from the root.
export function initialCreateDialog(seed?: EdtRegistryEntry): CreateDialogState {
  return {
    kind: 'create',
    step: 1,
    topic: '',
    topicCursor: 0,
    formFocus: 'topic',
    selectedMembers: seed !== undefined ? seed.members.map((member) => member.repoPath) : [],
    memberCursor: 0,
    submitting: false,
    error: null,
    failedRows: [],
    // Seeded (name slug, list loads) when Step 3 is entered — see create-wizard.tsx.
    branches: initialBranchStepState(),
    cancelRequested: false,
    // Re-seeded (firstEdt captured) when Step 4 is entered — see create-wizard.tsx.
    activation: initialActivationState(),
    seedFromEdt: seed ?? null,
  };
}

export function initialSwitchDialog(target: EdtRegistryEntry): SwitchDialogState {
  return { kind: 'switch-confirm', target, submitting: false, error: null, failedRows: [], blocked: false, resolution: null };
}

export function initialModifyDialog(target: EdtRegistryEntry): ModifyDialogState {
  return {
    kind: 'modify',
    target,
    topic: target.topic,
    topicCursor: target.topic.length,
    formFocus: 'topic',
    selectedMembers: target.members.map((member) => member.repoPath),
    memberCursor: 0,
    branchEdits: {},
    branchRenames: {},
    branchPicker: null,
    submitting: false,
    error: null,
    failedRows: [],
  };
}

export function initialServiceActionsDialog(edt: EdtRegistryEntry, repoPath: string, serviceName: string): ServiceActionsDialogState {
  return {
    kind: 'service-actions',
    edt,
    repoPath,
    serviceName,
    cursor: 0,
    branchPicker: null,
    submitting: false,
    error: null,
    failedRows: [],
    lastAttemptedBranch: null,
    lastAttemptedRenameOldName: null,
  };
}

// Opens a fresh branch-picker session for repoPath — `branches`/`branchesStatus` start
// empty/'loading'; the zone's own effect fetches listBranches(repoPath) once and fills them in,
// whichever entry point created the session. `defaultBaseBranch` is caller-supplied — every call
// site sources it from the repo's manifest sharedBranch, never DEFAULT_BASE_BRANCH.
export function createPickerSession(
  repoPath: string,
  options: {
    suggestedName: string;
    defaultBaseBranch: string;
    hasCurrentBranch: boolean;
    currentBranch: string;
    retry?: { field: 'create-name' | 'rename'; value: string; oldName?: string };
    autoSubmitOnConfirm?: boolean;
  },
): BranchPickerSession {
  let state = createBranchPickerState({
    suggestedName: options.suggestedName,
    defaultBaseBranch: options.defaultBaseBranch,
    hasCurrentBranch: options.hasCurrentBranch,
    currentBranch: options.currentBranch,
  });
  if (options.retry !== undefined) {
    state = applyBranchPickerRetry(state, options.retry);
  }
  return { repoPath, state, branches: [], branchesStatus: 'loading', autoSubmitOnConfirm: options.autoSubmitOnConfirm };
}

export function initialAddToEdtDialog(
  edt: EdtRegistryEntry,
  repoPath: string,
  serviceName: string,
  currentBranch: string | null,
  sharedBranch: string,
): AddToEdtDialogState {
  return {
    kind: 'add-to-edt',
    edt,
    repoPath,
    serviceName,
    // The picker is this dialog's whole branch step (only Rename current is ruled out here) — it
    // opens immediately on Create new, pre-filled with the candidate's own current git branch.
    branchPicker: createPickerSession(repoPath, {
      suggestedName: currentBranch ?? '',
      // Manifest-driven, not DEFAULT_BASE_BRANCH — this repo's own sharedBranch.
      defaultBaseBranch: sharedBranch,
      hasCurrentBranch: false,
      currentBranch: '',
    }),
    error: null,
    failedRows: [],
    submitting: false,
  };
}
