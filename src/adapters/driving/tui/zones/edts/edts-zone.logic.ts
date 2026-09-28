// tui/zones/edts: the EdtsZone's pure, non-React logic — formatting, selection/navigation
// math, form-focus/branch-setup derivation, and the 5 dialogs' state shapes + initializers.
// Extracted from edts-zone.tsx (which had grown to ~2500 lines) so each concern is reachable
// without scrolling past the Ink component; every export here stays unit-tested directly, no
// React import, per the file's original Design Notes ("every keystroke behavior ... a
// standalone pure function, unit-tested directly").
import type { MemberBranchPlan } from '../../../../../core/edt/create.js';
import { defaultDispositionFor, type MemberDeleteStatus, type MemberDisposition } from '../../../../../core/edt/delete.js';
import type { ServiceBranchDivergence } from '../../../../../core/edt/list.js';
import type { EdtRegistryEntry } from '../../../../../core/ports/edt-registry.js';
import type { NavigationKey } from '../../keybindings/index.js';
import { createBranchPickerState, applyBranchPickerRetry, type BranchPickerState } from '../../shared/components/branch-picker.js';
import { resolveAssistedAction, type FailedResultRow } from '../../shared/components/failed-result-list.js';
import type { TextInputState } from '../../shared/components/text-edit.js';
import type { OverrideBoxState } from './dialogs/create-wizard/override-box.logic.js';

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

// Story 2.34: the summary above rendered uniformly dim, giving no visual cue that it's worth
// stopping for — this picks which of the theme's two "something's wrong" colors it should
// render with. `errors` (a genuine read failure) always outranks `unreachable` (a path just
// not found) when both are present, same ranking `formatIssuesSummary`'s part order implies.
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

// Story 2.34: a small extensible registry mapping a BranchDivergenceEntryError.code to a
// plain-language reason + suggested next step — mirrors failed-result-list.tsx's
// resolveAssistedAction precedent (a future code gets a new entry here, never a renderer
// change). Codes come from registry.exists()/manifest.load() failures surfaced by
// listEdtBranchesDivergence (core/edt/list.ts); manifest-not-found never reaches here — it's
// silently skipped upstream as a genuinely unmanaged repo.
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

// Review patch: extracted so the arrow-key row-focus transition is unit-testable directly —
// the shared renderToString test harness's fake stdin never emits data, so a useInput
// callback itself is registered but never invoked by any test in the repo (mirrors
// app-shell.tsx's shouldSwitchZone/shouldQuit pattern: interpret the key as a pure function,
// dispatch the interpreted value from the hook).
// Story 2.7: canonical navigation contract retires j/k/g/G in favor of arrows/Home/End —
// arrow/Home/End keys produce an empty `input` string in Ink, only `key` flags are set.
// Story 2.9: reused as-is for the new EDT selector list and the create/modify member
// checklists too — these functions were already generic over "current index, length".
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

// Story 2.9 -----------------------------------------------------------------------------

// Tab's second consumer (the first is cycleFormFocus below, inside a form): cycling which of
// the three simultaneously-visible base-view lists arrows/Home/End move. Default focus is the
// EDT selector (Design Notes, review-loop iteration 0's resolution).
// Story 2.18: widened from a 2-way edts/services toggle to a 3-way cycle — the flat SERVICES
// list (story 2.6) is now split into EDT SERVICES / OTHER SERVICES, partitioned by the
// *selected* EDT's own membership (partitionServicesByEdtMembership below), each
// independently arrow/Home/End-navigable.
export type PaneFocus = 'edts' | 'edt-services' | 'other-services';

export function cyclePaneFocus(current: PaneFocus): PaneFocus {
  if (current === 'edts') {
    return 'edt-services';
  }
  if (current === 'edt-services') {
    return 'other-services';
  }
  return 'edts';
}

// Tab's first consumer: cycling a form's topic-input ↔ member-checklist while a
// create/switch/modify dialog is open.
export type FormFocus = 'topic' | 'members';

export function cycleFormFocus(current: FormFocus): FormFocus {
  return current === 'topic' ? 'members' : 'topic';
}

// The hand-rolled controlled text-input interpreter (`TextEditKey`/`TextInputState`/
// `nextTextInputValue`) lives in shared/components/text-edit.ts — a leaf module, so the
// shared branch-autocomplete input can reuse it without closing an import cycle back
// through branch-picker (story 2.32's import-cycle constraint).

// The checkbox-list-item pure toggle (Space): member selection for the create/modify forms.
export function toggleMemberSelection(selected: readonly string[], path: string): string[] {
  return selected.includes(path) ? selected.filter((candidate) => candidate !== path) : [...selected, path];
}

// Boundary: "Reject an empty value in the branch-edit dialog inline; don't let it reach
// modifyEdt unvalidated." Returns the inline error message, or null when valid.
export function validateBranchEditValue(value: string): string | null {
  return value.trim() === '' ? 'Branch name must not be empty' : null;
}

// Story 2.24 -----------------------------------------------------------------------------
// Suggestion for a not-yet-member candidate newly checked in the Modify dialog: reuse the
// EDT's shared branch when every existing member happens to agree on one (>=1 member exists),
// otherwise fall back to the same topic-slug suggestion the create dialog's branch-setup step
// already uses (Boundaries: "New pure suggestBranchForNewMember(existingMembers, topic)").
export function suggestBranchForNewMember(existingMembers: readonly { branch: string }[], topic: string): string {
  const first = existingMembers[0];
  if (first !== undefined && existingMembers.every((member) => member.branch === first.branch)) {
    return first.branch;
  }
  return suggestBranchNameFromTopic(topic);
}

// Story 2.22 -----------------------------------------------------------------------------
// The create-EDT dialog's mandatory branch-setup step (Boundaries: "shown once >=1 member is
// selected; no enable/disable choice"). core/edt/create.ts's CreateBranchOptions has required
// mandatory branch creation ever since Story 2.2/2.3 — this is the TUI finally surfacing it
// instead of always hardcoding NO_BRANCH_CREATION (app-store.ts).

// Design Notes: slugifies a topic into a branch-name suggestion — lowercase, then any run of
// non-alphanumeric characters collapses to a single '-', trimmed of leading/trailing '-'
// (e.g. "Fix Auth Bug!!" -> "fix-auth-bug"). Pure and total: an all-punctuation topic slugifies
// to '' (still a non-empty *topic* by the time this runs, since submitCreate's own
// topic-not-empty check already ran first) — that empty suggestion is exactly what
// validateBranchEditValue below is for, never silently patched over with a fallback name.
export function suggestBranchNameFromTopic(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Story 2.37: the create dialog's focus is back to FormFocus alone — Step 3's own focus lives
// in BranchStepState below (panel / globalLine / editing / rowCursor / box), no longer in the
// flat pre-wizard `branch-base`/`branch-mode`/`branch-name` cycle.
export type CreateFormFocus = FormFocus;

// Story 2.37 -----------------------------------------------------------------------------
// The create wizard's Step 3 "global strategy + per-service exceptions" state.
//
// A row override is exactly core's MemberBranchPlan (Design Notes): `create` renders as
// [Créer (Perso)], `existing` as [Existante] — or [Renommer] once `renameTo` is set. A path
// with no override follows Panel A's global rule ([Créer (Global)]).
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
  // Touched-flag convention (Story 2.22): an untouched name keeps tracking Step 1's slug.
  globalNameTouched: boolean;
  panel: 'global' | 'rows';
  globalLine: 'base' | 'name';
  editing: boolean; // Panel A's focused line is in edit mode
  rowCursor: number;
  overrides: Readonly<Record<string, RowOverride>>;
  lists: Readonly<Record<string, BranchListState>>;
  box: OverrideBoxState | null;
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
  };
}

export function isSwitchBlockedError(code: string): boolean {
  return code === 'switch-blocked-action-in-progress';
}

// Review patch (story 2.9): createEdt/switchActiveEdt/modifyEdt are all per-repo/per-member
// isolated — one repo's failure (a shared/protected-branch rejection, a stash/checkout
// error, a manifest-load failure) never fails the overall action, so `result.ok === true`
// can still carry `results` rows with `outcome: 'failed'`. Every submit handler used to treat
// `result.ok` as unconditional full success and never inspected `results`, silently closing
// the dialog as if every requested change had actually applied — directly contradicting this
// spec's own "surfacing protected-branch/topic-uniqueness rejections inline" requirement for
// the subset of rejections that ride inside an ok:true result rather than the top-level error.
type FailableResultRow = { service: string; outcome: string; detail?: { code: string; message: string } };

// Story 2.25: returns a structured FailedResultRow[] (never a `; `-joined string) — one row
// per failed repo, rendered by the shared FailedResultList (shared/components/failed-result-
// list.tsx) at all 6 partial-failure call sites below. `code` is carried through as-is (used
// by resolveAssistedAction to decide whether a row gets a guided resolution action); a
// `failed` row's `detail` is always set in practice (every core use-case reports a
// code+message together), but a defensive fallback message keeps this total.
export function summarizeFailedResults(results: readonly FailableResultRow[]): FailedResultRow[] {
  return results
    .filter((row) => row.outcome === 'failed')
    .map((row) => ({
      service: row.service,
      ...(row.detail?.code !== undefined ? { code: row.detail.code } : {}),
      message: row.detail?.message ?? 'Failed',
    }));
}

// Never boundary: Create and Switch never get the "try a different branch" retry wired —
// `resolveMemberBranch` never passes an `edtId` to `assertAllowedBranch` at create time
// (core/edt/create.ts), and `switchActiveEdt` carries no per-member branch override to retry
// into. Stripping `code` here (used only at those two call sites) makes
// `resolveAssistedAction` treat every row as unregistered — even `branch-owned-by-other-edt`
// — matching AC2's "no registered action" treatment exactly, rather than relying on
// `FailedResultList` itself to know which dialogs are allowed to offer the affordance.
export function stripAssistedActionCodes(rows: readonly FailedResultRow[]): FailedResultRow[] {
  return rows.map((row) => ({ service: row.service, message: row.message }));
}

// Review patch (story 2.25): shared by the Modify and service-actions "try a different
// branch" Enter handlers — both need the same "first row with a registered action" lookup.
export function findRetryableFailedRow(failedRows: readonly FailedResultRow[]): FailedResultRow | undefined {
  return failedRows.find((row) => resolveAssistedAction(row.code) !== null);
}

// Amended 2026-08-27 (Sprint Change Proposal): no longer takes `isActive` — the "— active"
// suffix moved out of this string and into `ListRow`'s own `active` prop (rendered as a
// discreet, independently-colored suffix), so this stays a pure member-count formatter.
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

// Story 2.15: formats the EDT action history for the detail pane.
// Returns a joined string with timestamps (dim), outcome glyphs, and action details.
// Amended 2026-08-28 (Sprint Change Proposal, story 2.19): `hiddenActionTypes` filters
// `actionLog` before formatting — a live read of `settings.edts.hiddenActionTypes`, never a
// cached copy, same convention as `resolveActionHint`'s live read of `hiddenActionHints`
// above. Defaults to `[]` (nothing hidden) so every pre-2.19-amendment call site keeps
// working unchanged.
export function formatEdtActionHistory(
  actionLog: Array<{ id: string; timestamp: string; actionType: string; outcome: 'success' | 'failed'; detail: string }>,
  inProgressAction: { type: 'create' | 'switch' | 'modify' | 'delete'; target: string; startedAt: string } | null,
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

// Story 2.18: replaces the "Available: [Enter] Switch  [c] Create  [m] Modify" line formerly
// hardcoded inside formatEdtActionHistory above — that line was static and never matched what
// Enter actually did once EDT SERVICES/OTHER SERVICES panes existed. Never lists `c`/`m` (the
// spec's Boundaries: they were never wired as direct keys). The zone's render joins this with
// formatEdtDetail/formatEdtActionHistory using the same '\n\n' separator already used today
// (Design Notes).
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

// Story 2.19 (I/O matrix "Toggle hidden hint"): each `PaneFocus` value is exactly the hint
// token id the settings screen's EDTs tab offers to hide (settings-screen.tsx's
// HIDEABLE_ACTION_HINTS). Hidden immediately — this is a pure read of the live
// `settings.edts.hiddenActionHints` array, never a separate loaded/cached copy — so a toggle
// in the settings screen reflects here on the very next render, no restart needed. Returns
// '' (never null) so call sites can join unconditionally when non-empty.
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
// paragraph left where it used to render — rather than joining an empty string with '\n\n'.
export function appendHint(hint: string): string {
  return hint ? '\n\n' + hint : '';
}

// Story 2.18: splits the flat SERVICES list (story 2.6) into EDT SERVICES (rows whose `path`
// is a member of the *selected* EDT — never `row.isMember`, which stays tied to the *active*
// EDT for its own divergence-badge use, per the spec's Boundaries) and OTHER SERVICES
// (everything else). `focusedEdt` undefined -> every row lands in OTHER SERVICES; callers
// show a "No EDT selected" note instead of an empty EDT SERVICES group (never render an empty
// EDT SERVICES section in that case).
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

// AC1's "candidate list must reflect a still-loading services fetch (a distinct state)
// rather than rendering 'No registered services available.' while edtsBranches simply
// hasn't resolved yet" — a still-loading fetch, a genuinely-empty registry, a load
// failure, and a ready-with-rows list are four distinct states, never conflated.
// Review patch (story 2.9): the flat services fetch failing (`status === 'error'`) used
// to fall through to 'empty', rendering "No registered services available." as if the
// registry were genuinely empty rather than surfacing that the load itself failed.
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

// A row is branch-editable whenever it's currently checked AND it wasn't already a member when
// the dialog opened — an unchecked row's branch edit would be dropped at submit anyway (editing
// it first is confusing, not useful), and an already-a-member row has nothing new to stage via
// this checklist's Enter (its branch is instead changed via the EDT SERVICES row's own "Change
// branch for this EDT" contextual menu). Story 2.24 widened this from "existing member only" to
// include a not-yet-member candidate too: checking it auto-stages a branchEdits entry
// (suggestBranchForNewMember), so Enter on that row now has a real staged branch to open the
// same branch-edit sub-dialog on. Story 2.26 amendment: re-adds membership awareness (dropped by
// 2.24's own code review) via `originalMemberPaths` — the dialog-open-time membership snapshot —
// specifically to exclude already-checked existing members, whose checklist cursor otherwise
// almost never lands anywhere Enter submits the form.
export function canEditMemberBranch(repoPath: string, selectedMembers: readonly string[], originalMemberPaths: ReadonlySet<string>): boolean {
  return selectedMembers.includes(repoPath) && !originalMemberPaths.has(repoPath);
}

export type ModifyEnterAction = { type: 'submit' } | { type: 'edit-branch'; repoPath: string };

// Members-focus Enter is contextual: on a branch-editable row it opens the branch-edit
// dialog; everywhere else (topic-focus always, or a members-focus row that isn't
// branch-editable) it submits the whole form — Enter always confirms *something* (UX-DR8),
// never a dead key. Story 2.26 amendment: threads `originalMemberPaths` through to
// canEditMemberBranch so an already-a-member row (checked or not) always submits instead.
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

// The modify form's submit-op derivation, extracted as a pure function so the boundary rule
// ("drop any staged branch-edit for a member no longer in the current selection") is
// directly unit-testable without an async submit round-trip.
//
// Story 2.26: `branchRenames` is a sibling of `branchEdits` (never overlapping — see
// stageBranchPickerOutcome's comment: a "Rename current"/Pick-existing-rename outcome on an
// *existing* member stages into branchRenames only, never also into branchEdits, since
// modifyEdt's renameBranches step alone both renames the ref and records the branch change —
// no checkout needed). Same drop-if-unselected rule as setBranches: a rename staged for a
// since-unchecked member must never reach modifyEdt either.
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

  // Boundary: a branch edit staged for a since-unchecked member must never reach
  // modifyEdt — dropped here, before any setBranches entry is built (a real `git checkout`
  // on a repo the developer just told the form to drop).
  //
  // Story 2.24: the inverse must also hold — every checked non-member (addMembers) always
  // carries a setBranches entry, never silently omitted, so modify.ts's step 1 always finds a
  // match to defer to instead of falling back to its `branch-required` failure. Confirm is
  // blocked before this ever runs when that staged value is empty (submitModify), so the ''
  // fallback below is a safety net, not the normal path.
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

// Story 2.36: the create-EDT wizard's 4 steps (Nom -> Services -> Branches -> Activation).
export type WizardStep = 1 | 2 | 3 | 4;

export type CreateDialogState = {
  kind: 'create';
  // Story 2.36: the wizard's current step.
  step: WizardStep;
  topic: string;
  // Story 2.32: topic's own caret position — see TextInputState/nextTextInputValue in
  // shared/components/text-edit.ts.
  topicCursor: number;
  formFocus: CreateFormFocus;
  selectedMembers: readonly string[];
  memberCursor: number;
  submitting: boolean;
  error: string | null;
  // Story 2.25: the structured per-repo breakdown for a partial failure riding inside an
  // ok:true result (summarizeFailedResults) — rendered via FailedResultList instead of
  // folding into `error` above, which keeps its own validation/full-failure use unchanged.
  failedRows: FailedResultRow[];
  // Story 2.37: Step 3's whole state (global strategy, per-service overrides, branch lists,
  // override box) — replaces the pre-wizard branch-setup fields (Stories 2.22/2.27/2.32).
  branches: BranchStepState;
  // Story 2.37 (review): Step 3 decides "Esc cancels the wizard" against the latest state,
  // inside the setDialog updater, where the side effects of a cancel (closing, requesting a
  // quit) cannot run. It raises this flag instead; the zone's effect then runs the wizard's
  // cancel (see create-wizard.tsx's handleCancelRequest).
  cancelRequested: boolean;
};

export type SwitchDialogState = {
  kind: 'switch-confirm';
  target: EdtRegistryEntry;
  submitting: boolean;
  error: string | null;
  failedRows: FailedResultRow[];
  blocked: boolean;
};

// Story 2.26: a live branch-picker session, opened over any of the 3 non-creation branch-entry
// points in place of the old free-text BranchEditState sub-dialog. `branches`/`branchesStatus`
// are this repoPath's own `listBranches()` result (fetched once, when the session opens —
// mirrors the rest of this file's "fetched on open, not continuously re-synced" convention).
export type BranchPickerSession = {
  repoPath: string;
  state: BranchPickerState;
  branches: string[];
  branchesStatus: 'loading' | 'ready' | 'error';
  // Story 2.25's retry mechanism, carried over: set only when this session was opened by the
  // "try a different name"/"try a different branch" assisted action — confirming it re-runs
  // the owning dialog's own submit immediately (Modify: submitModify; service-actions/
  // add-to-edt already resubmit on every confirm unconditionally, so they never set this).
  autoSubmitOnConfirm?: boolean;
};

export type ModifyDialogState = {
  kind: 'modify';
  target: EdtRegistryEntry;
  topic: string;
  // Story 2.32: topic's own caret position — see TextInputState/nextTextInputValue in
  // shared/components/text-edit.ts.
  topicCursor: number;
  formFocus: FormFocus;
  selectedMembers: readonly string[];
  memberCursor: number;
  branchEdits: Readonly<Record<string, string>>;
  // Story 2.26: a rename staged for an *existing* member (Rename current, or Pick-existing's
  // row-rename landing on that member's own branch) — sibling of branchEdits, never
  // overlapping it (see resolveModifyOps). A not-yet-member's rename outcome instead lands in
  // branchEdits directly, after an eager renameMemberBranch pre-step (stageBranchPickerOutcome).
  branchRenames: Readonly<Record<string, string>>;
  branchPicker: BranchPickerSession | null;
  submitting: boolean;
  error: string | null;
  failedRows: FailedResultRow[];
};

// Story 2.18: the EDT SERVICES row contextual menu opened by Enter — Remove from EDT / Change
// branch for this EDT / a visibly disabled Restart (Epic 5). No new list-picker component:
// three ListRows inside the existing ModalDialog, arrow/Home/End-navigable via the same
// resolveSelectionDirection/moveSelection pair every other list here already uses (Design
// Notes: "mirrors the create/switch/modify dialogs' existing structure").
export const SERVICE_ACTION_MENU_ITEMS = Object.freeze([
  { label: 'Remove from EDT', disabled: false },
  { label: 'Change branch for this EDT', disabled: false },
  { label: 'Restart', disabled: true },
] as const);

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
  // Story 2.25: the branch value last attempted via submitServiceActionsBranchChange — kept
  // around (never cleared, including on failure) purely so a "try a different branch" retry
  // can reopen the branch-picker session pre-filled with the value that just got rejected,
  // rather than the member's still-current branch.
  lastAttemptedBranch: string | null;
  // Story 2.26: set only when the failed attempt was a 'rename' outcome (its oldName) — lets a
  // retry reopen onto the picker's actual originating field (rename) instead of always forcing
  // Create-new, which would otherwise try to *create* a branch when the user meant to rename.
  lastAttemptedRenameOldName: string | null;
};

// Story 2.18: the OTHER SERVICES row's Add-to-EDT dialog opened by Enter — story 2.26 replaces
// its single free-text field with the shared branch-picker, opened immediately (there is no
// "current branch" step to gate behind here, so the picker *is* the dialog's whole branch
// step); confirm calls modifyEdt with both `addMembers` and `setBranches` for the same repoPath
// in one call (core/edt/modify.ts already composes these correctly — see Design Notes).
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

// Story 2.29 -----------------------------------------------------------------------------
// The delete-EDT confirm dialog's per-member row: branch, merge status, and uncommitted-work
// status (acceptance criteria), plus the row's own independently-toggleable disposition.
export type DeleteMemberRow = {
  repoPath: string;
  service: string;
  branch: string;
  merged: boolean;
  clean: boolean;
  disposition: MemberDisposition;
  // Review fix (story 2.29): set when core/edt/delete.ts's resolveMemberDeleteStatuses
  // couldn't establish this member's real merged/clean status (a manifest or git read
  // failed) — the row still renders (never blocks the dialog from opening) and defaults to
  // 'leave' (defaultDispositionFor's own safe fallback), but the merged/clean values shown
  // are not to be trusted, so formatDeleteMemberMeta annotates the row instead of rendering
  // a plausible-looking but possibly-wrong status silently.
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
  // Boundary: "The active EDT can never be deleted: reject before any git/file write ...
  // never auto-switched." This fires at dialog-open time (edts-zone.tsx), before any member
  // status is even fetched — a rejected dialog shows only the error message; Esc is the only
  // way out, no confirm affordance is ever offered.
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

// Boundary: "Per-member disposition defaults to 'Leave branch as-is', except a branch both
// merged into its sharedBranch and clean, which defaults to 'Delete branch'; every row stays
// independently toggleable." Reuses core/edt/delete.ts's defaultDispositionFor as the single
// source of truth for that rule (never a second, TUI-only copy of it).
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

// The confirm dialog's per-row meta text: branch + merge status + uncommitted-work status
// (acceptance criteria: "lists every member with branch, merge status, and uncommitted-work
// status").
export function formatDeleteMemberMeta(row: DeleteMemberRow): string {
  const mergeLabel = row.merged ? 'merged' : 'unmerged';
  const cleanLabel = row.clean ? 'clean' : 'uncommitted work';
  const base = `${row.branch} — ${mergeLabel}, ${cleanLabel}`;
  // Review fix (story 2.29): the merged/clean values above are not to be trusted when a
  // status read failed — say so explicitly rather than rendering a plausible-looking status.
  return row.statusError !== undefined ? `${base} (status unknown — defaulted to leave)` : base;
}

// Story 2.34: the issues dialog is read-only and carries no payload of its own — the
// unreachable/errors data it renders already lives in the zone's own store selectors, so
// unlike every other dialog here there's nothing to seed on open.
export type IssuesDialogState = { kind: 'issues' };

// Story 2.30 -----------------------------------------------------------------------------
// The shared EDT quick-pick — a filterable, arrow-navigable list of EDT topics — opened in
// place of `edt-switch`/`edt-modify`/`edt-delete`'s old ad hoc no-argument fallbacks (guessing
// "the first non-active EDT" / the currently-focused row). One dialog, one component, three
// modes (Intent/Design Notes), never three near-duplicate dialogs. `mode` decides both the
// candidate pool (quick-pick-dialog.tsx's resolveQuickPickCandidates: switch excludes the
// active EDT, modify/delete include it) and which pre-targeted dialog Enter opens.
export type QuickPickMode = 'switch' | 'modify' | 'delete';

export type QuickPickDialogState = {
  kind: 'quick-pick';
  mode: QuickPickMode;
  // The filter field's own value/caret — same TextInputState-shaped pair every other field in
  // this file uses, fed through nextTextInputValue directly (Code Map: "reuse directly for the
  // filter field's caret handling").
  query: string;
  queryCursor: number;
  // The highlighted row within the *current* filtered match list — reset to 0 whenever the
  // filter text itself changes (mirrors branch-picker.tsx's handlePickExistingKey: "a pure
  // caret move leaves pickQuery's value unchanged ... only an actual filter-text change
  // re-derives the match list and resets pickCursor to the top"), clamped to
  // [0, matches.length - 1] by moveSelection on Up/Down.
  cursor: number;
};

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

export function initialQuickPickDialog(mode: QuickPickMode): QuickPickDialogState {
  return { kind: 'quick-pick', mode, query: '', queryCursor: 0, cursor: 0 };
}

export function initialCreateDialog(): CreateDialogState {
  return {
    kind: 'create',
    step: 1,
    topic: '',
    topicCursor: 0,
    formFocus: 'topic',
    selectedMembers: [],
    memberCursor: 0,
    submitting: false,
    error: null,
    failedRows: [],
    // Story 2.37: seeded (name slug, list loads) when Step 3 is entered — see create-wizard.tsx.
    branches: initialBranchStepState(),
    cancelRequested: false,
  };
}

export function initialSwitchDialog(target: EdtRegistryEntry): SwitchDialogState {
  return { kind: 'switch-confirm', target, submitting: false, error: null, failedRows: [], blocked: false };
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

// Story 2.26: opens a fresh branch-picker session for repoPath — `branches`/`branchesStatus`
// start empty/'loading'; the zone's own effect (mirroring loadEdtsBranches' "fetch once on the
// relevant state change" convention) fetches listBranches(repoPath) once and fills them in,
// regardless of which entry point created this session.
// Story 2.27: `defaultBaseBranch` is now a required caller-supplied value (never this file's
// own DEFAULT_BASE_BRANCH import) — every call site sources it from the repo's own
// manifest-declared sharedBranch (Boundaries: "DEFAULT_BASE_BRANCH stops being read as a
// suggestion source anywhere in the EDT zone ... createPickerSession()").
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
    // Story 2.26: the picker is this dialog's whole branch step (Boundaries: "never at
    // Add-to-EDT" only rules out Rename current — the picker itself opens immediately here,
    // defaulting to Create new pre-filled with the candidate's own current git branch, exactly
    // as the old free-text field used to).
    branchPicker: createPickerSession(repoPath, {
      suggestedName: currentBranch ?? '',
      // Story 2.27: manifest-driven, not DEFAULT_BASE_BRANCH — this repo's own sharedBranch.
      defaultBaseBranch: sharedBranch,
      hasCurrentBranch: false,
      currentBranch: '',
    }),
    error: null,
    failedRows: [],
    submitting: false,
  };
}
