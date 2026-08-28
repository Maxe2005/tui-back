// tui/zones/edts: story 2.6 (FR-9) shipped the flat, ungrouped service/divergence list.
// Story 2.9 layers an EDT selector (list of EDTs + create/switch/modify) above it, driving
// core/edt/{create,switch,modify}.ts in-process (AD-2) via the store's createEdt/switchEdt/
// modifyEdt actions — never shelling out to the CLI. Story 2.6's flat list stays exactly as
// it was: both lists are independently keyboard-navigable, arbitrated by Tab-cycled pane
// focus (default: the EDT selector) rather than one replacing or freezing the other.
//
// Component boundary note (UX-DR17): DetailPane wraps its `children` in a single Ink <Text>
// internally, so only Text-safe content (a joined string, not nested <Box>) goes through it;
// a per-service git-error `detail.message` is rendered as a DimAnnotation *sibling* of
// DetailPane, never nested inside it and never inlined into the ListRow itself.
//
// Design Notes (this story): no shared navigation/form hook exists — every keystroke
// behavior (text-input editing, checkbox toggle, Tab-cycle target, list nav, pane-focus
// toggle, the create/switch/modify submit-op derivation) is a standalone pure function,
// unit-tested directly; the `useInput` callback stays a thin dispatcher over them, following
// the same split resolveSelectionDirection/moveSelection already established in story 2.6/2.7.
import { useEffect, useState } from 'react';
import { Box, Text, useInput, type Key } from 'ink';
import type { ServiceBranchDivergence } from '../../../../../core/edt/list.js';
import type { EdtRegistryEntry } from '../../../../../core/ports/edt-registry.js';
import type { NavigationKey } from '../../keybindings/index.js';
import { useAppStore, type AppStore } from '../../store/app-store.js';
import { CheckboxListItem } from '../../shared/components/checkbox-list-item.js';
import { DetailPane } from '../../shared/components/detail-pane.js';
import { DimAnnotation } from '../../shared/components/dim-annotation.js';
import { ListDetailSplit } from '../../shared/components/list-detail-split.js';
import { ListRow } from '../../shared/components/list-row.js';
import { ModalDialog } from '../../shared/components/modal-dialog.js';
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

// The hand-rolled controlled text-input pure interpreter (topic field, branch-edit field) —
// no new npm dependency, per the spec's Boundaries. Defensively filters every non-character
// key itself (not just the arrow/Home/End/Tab/Return/Escape the useInput dispatcher already
// intercepts first) so it's safe to unit-test directly against any Ink `Key`-shaped object.
export type TextEditKey = {
  backspace?: boolean;
  delete?: boolean;
  return?: boolean;
  escape?: boolean;
  tab?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  home?: boolean;
  end?: boolean;
  ctrl?: boolean;
  meta?: boolean;
};

export function nextTextInputValue(current: string, input: string, key: TextEditKey): string {
  if (key.backspace || key.delete) {
    return current.slice(0, -1);
  }
  if (
    key.return ||
    key.escape ||
    key.tab ||
    key.upArrow ||
    key.downArrow ||
    key.leftArrow ||
    key.rightArrow ||
    key.home ||
    key.end ||
    key.ctrl ||
    key.meta
  ) {
    return current;
  }
  if (input.length === 0) {
    return current;
  }
  return current + input;
}

// The checkbox-list-item pure toggle (Space): member selection for the create/modify forms.
export function toggleMemberSelection(selected: readonly string[], path: string): string[] {
  return selected.includes(path) ? selected.filter((candidate) => candidate !== path) : [...selected, path];
}

// Boundary: "Reject an empty value in the branch-edit dialog inline; don't let it reach
// modifyEdt unvalidated." Returns the inline error message, or null when valid.
export function validateBranchEditValue(value: string): string | null {
  return value.trim() === '' ? 'Branch name must not be empty' : null;
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

export function summarizeFailedResults(results: readonly FailableResultRow[]): string | null {
  const failed = results.filter((row) => row.outcome === 'failed');
  if (failed.length === 0) {
    return null;
  }
  return failed.map((row) => `${row.service}${row.detail ? `: ${row.detail.message}` : ''}`).join('; ');
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
export function formatEdtActionHistory(
  actionLog: Array<{ id: string; timestamp: string; actionType: string; outcome: 'success' | 'failed'; detail: string }>,
  inProgressAction: { type: 'create' | 'switch' | 'modify'; target: string; startedAt: string } | null,
): string {
  const lines: string[] = [];

  // In-progress action
  if (inProgressAction) {
    const typeLabel = inProgressAction.type.charAt(0).toUpperCase() + inProgressAction.type.slice(1);
    lines.push(`⣾ ${typeLabel} "${inProgressAction.target}"…`);
    lines.push(''); // blank line separator
  }

  // Recent actions
  if (actionLog.length === 0) {
    lines.push('No actions yet');
  } else {
    lines.push('Recent actions:');
    for (const entry of actionLog) {
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

// A member row is branch-editable only when it's an existing member of the target EDT
// (there is a registered branch to change) and still checked (an unchecked row's branch
// edit would be dropped at submit anyway — editing it first is confusing, not useful).
export function canEditMemberBranch(
  target: EdtRegistryEntry,
  repoPath: string,
  selectedMembers: readonly string[],
): boolean {
  return target.members.some((member) => member.repoPath === repoPath) && selectedMembers.includes(repoPath);
}

export type ModifyEnterAction = { type: 'submit' } | { type: 'edit-branch'; repoPath: string };

// Members-focus Enter is contextual: on a branch-editable row it opens the branch-edit
// dialog; everywhere else (topic-focus always, or a members-focus row that isn't
// branch-editable) it submits the whole form — Enter always confirms *something* (UX-DR8),
// never a dead key.
export function resolveModifyEnterAction(
  formFocus: FormFocus,
  target: EdtRegistryEntry,
  selectedMembers: readonly string[],
  focusedPath: string | undefined,
): ModifyEnterAction {
  if (formFocus === 'members' && focusedPath !== undefined && canEditMemberBranch(target, focusedPath, selectedMembers)) {
    return { type: 'edit-branch', repoPath: focusedPath };
  }
  return { type: 'submit' };
}

export interface ResolvedModifyOps {
  addMembers: string[];
  removeMembers: string[];
  setBranches: Array<{ repoPath: string; branch: string }>;
  renameTo?: string;
}

// The modify form's submit-op derivation, extracted as a pure function so the boundary rule
// ("drop any staged branch-edit for a member no longer in the current selection") is
// directly unit-testable without an async submit round-trip.
export function resolveModifyOps(
  target: EdtRegistryEntry,
  topic: string,
  selectedMembers: readonly string[],
  branchEdits: Readonly<Record<string, string>>,
): ResolvedModifyOps {
  const originalPaths = new Set(target.members.map((member) => member.repoPath));
  const selectedPaths = new Set(selectedMembers);

  const addMembers = selectedMembers.filter((path) => !originalPaths.has(path));
  const removeMembers = target.members.map((member) => member.repoPath).filter((path) => !selectedPaths.has(path));

  // Boundary: a branch edit staged for a since-unchecked member must never reach
  // modifyEdt — dropped here, before any setBranches entry is built (a real `git checkout`
  // on a repo the developer just told the form to drop).
  const setBranches = Object.entries(branchEdits)
    .filter(([path]) => selectedPaths.has(path))
    .map(([repoPath, branch]) => ({ repoPath, branch }));

  const trimmedTopic = topic.trim();
  const renameTo = trimmedTopic !== '' && trimmedTopic !== target.topic ? trimmedTopic : undefined;

  return {
    addMembers,
    removeMembers,
    setBranches,
    ...(renameTo !== undefined ? { renameTo } : {}),
  };
}

// ---- Dialog state -----------------------------------------------------------------------

type CreateDialogState = {
  kind: 'create';
  topic: string;
  formFocus: FormFocus;
  selectedMembers: readonly string[];
  memberCursor: number;
  submitting: boolean;
  error: string | null;
};

type SwitchDialogState = {
  kind: 'switch-confirm';
  target: EdtRegistryEntry;
  submitting: boolean;
  error: string | null;
  blocked: boolean;
};

type BranchEditState = {
  repoPath: string;
  value: string;
  error: string | null;
};

type ModifyDialogState = {
  kind: 'modify';
  target: EdtRegistryEntry;
  topic: string;
  formFocus: FormFocus;
  selectedMembers: readonly string[];
  memberCursor: number;
  branchEdits: Readonly<Record<string, string>>;
  branchEdit: BranchEditState | null;
  submitting: boolean;
  error: string | null;
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

type ServiceActionsDialogState = {
  kind: 'service-actions';
  edt: EdtRegistryEntry;
  repoPath: string;
  serviceName: string;
  cursor: number;
  branchEdit: BranchEditState | null;
  submitting: boolean;
  error: string | null;
};

// Story 2.18: the OTHER SERVICES row's Add-to-EDT dialog opened by Enter — a single
// branch-edit text input, pre-filled with the service's current branch
// (ServiceBranchDivergence.branch), editable; confirm calls modifyEdt with both `addMembers`
// and `setBranches` for the same repoPath in one call (core/edt/modify.ts already composes
// these correctly — see Design Notes).
type AddToEdtDialogState = {
  kind: 'add-to-edt';
  edt: EdtRegistryEntry;
  repoPath: string;
  serviceName: string;
  value: string;
  error: string | null;
  submitting: boolean;
};

type EdtDialogState =
  | { kind: 'none' }
  | CreateDialogState
  | SwitchDialogState
  | ModifyDialogState
  | ServiceActionsDialogState
  | AddToEdtDialogState;

function initialCreateDialog(): CreateDialogState {
  return { kind: 'create', topic: '', formFocus: 'topic', selectedMembers: [], memberCursor: 0, submitting: false, error: null };
}

function initialSwitchDialog(target: EdtRegistryEntry): SwitchDialogState {
  return { kind: 'switch-confirm', target, submitting: false, error: null, blocked: false };
}

function initialModifyDialog(target: EdtRegistryEntry): ModifyDialogState {
  return {
    kind: 'modify',
    target,
    topic: target.topic,
    formFocus: 'topic',
    selectedMembers: target.members.map((member) => member.repoPath),
    memberCursor: 0,
    branchEdits: {},
    branchEdit: null,
    submitting: false,
    error: null,
  };
}

function initialServiceActionsDialog(edt: EdtRegistryEntry, repoPath: string, serviceName: string): ServiceActionsDialogState {
  return { kind: 'service-actions', edt, repoPath, serviceName, cursor: 0, branchEdit: null, submitting: false, error: null };
}

function initialAddToEdtDialog(
  edt: EdtRegistryEntry,
  repoPath: string,
  serviceName: string,
  currentBranch: string | null,
): AddToEdtDialogState {
  return { kind: 'add-to-edt', edt, repoPath, serviceName, value: currentBranch ?? '', error: null, submitting: false };
}

export function EdtsZone({
  useStore = useAppStore,
  // Test-only injection point (mirrors `useStore` above): `renderToString`'s fake stdin
  // never emits a real keypress (documented repo-wide), so a smoke test can't Tab its way
  // to the SERVICES pane to assert its detail-pane content. Production always starts on the
  // spec-mandated default ('edts' — the EDT selector).
  initialPaneFocus = 'edts',
  // Test-only injection point: `renderToString` performs one synchronous render-then-unmount
  // pass (render-to-string.ts) and never observes a *second*, effect-triggered commit — so a
  // smoke test can't rely on the real "zero EDTs auto-opens the create dialog" effect (AC1)
  // to have already run by the time output is captured. The real-keypress interaction tests
  // (edts-zone.interaction.test.tsx) already exercise that effect end-to-end through a real
  // Ink render loop; this prop only seeds the same initial state a renderToString smoke test
  // needs. Production always starts with no dialog open.
  initialDialogKind,
}: {
  useStore?: AppStore;
  initialPaneFocus?: PaneFocus;
  initialDialogKind?: 'create' | 'switch-confirm' | 'switch-blocked' | 'modify' | 'service-actions' | 'add-to-edt';
}) {
  const ratio = useStore((state) => state.splitterRatios.edts);
  const services = useStore((state) => state.edtsBranches);
  const status = useStore((state) => state.edtsBranchesStatus);
  const error = useStore((state) => state.edtsBranchesError);
  const unreachable = useStore((state) => state.edtsUnreachable);
  const errors = useStore((state) => state.edtsErrors);
  const loadEdtsBranches = useStore((state) => state.loadEdtsBranches);
  const edts = useStore((state) => state.edts);
  const edtsStatus = useStore((state) => state.edtsStatus);
  const edtsError = useStore((state) => state.edtsError);
  const activeEdtUlid = useStore((state) => state.activeEdt);
  const loadEdts = useStore((state) => state.loadEdts);
  const createEdtAction = useStore((state) => state.createEdt);
  const switchEdtAction = useStore((state) => state.switchEdt);
  const modifyEdtAction = useStore((state) => state.modifyEdt);
  const setZoneInputCaptured = useStore((state) => state.setZoneInputCaptured);
  const requestQuit = useStore((state) => state.requestQuit);
  // Story 2.14 review fix: Ink dispatches every keypress to every mounted `useInput` hook
  // regardless of z-order, so without this gate Tab/Enter typed into the `:` command bar
  // would also silently fire this zone's own pane-focus toggle / openEdtAction() underneath
  // it (Spec Change Log, spec-2-14).
  const commandBarOpen = useStore((state) => state.commandBarOpen);
  // Story 2.15: EDT action state for detail pane — tracks in-progress action and action log
  const currentEdtAction = useStore((state) => state.currentEdtAction);
  const setCurrentEdtAction = useStore((state) => state.setCurrentEdtAction);
  const edtActionLog = useStore((state) => state.edtActionLog);
  const edtActionLogStatus = useStore((state) => state.edtActionLogStatus);
  const loadEdtActionLog = useStore((state) => state.loadEdtActionLog);
  const logEdtAction = useStore((state) => state.logEdtAction);
  // Story 2.19: hides a per-context action hint immediately from the detail pane once toggled
  // in the settings screen's EDTs tab.
  const hiddenActionHints = useStore((state) => state.settings.edts.hiddenActionHints);

  useEffect(() => {
    void loadEdtsBranches();
    void loadEdts();
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

  // Story 2.9 -----------------------------------------------------------------------------
  const [paneFocus, setPaneFocus] = useState<PaneFocus>(initialPaneFocus);
  const [edtsSelected, setEdtsSelected] = useState(0);
  // Story 2.18: the flat SERVICES pane's single cursor is now two independent cursors, one
  // per partitioned pane (EDT SERVICES / OTHER SERVICES) — each keeps its own position as
  // paneFocus cycles between them, same as edtsSelected already does for the EDT selector.
  const [edtServicesSelected, setEdtServicesSelected] = useState(0);
  const [otherServicesSelected, setOtherServicesSelected] = useState(0);
  const [dialog, setDialog] = useState<EdtDialogState>(() => {
    if (initialDialogKind === undefined) {
      return { kind: 'none' };
    }
    if (initialDialogKind === 'create') {
      return initialCreateDialog();
    }
    const target = useStore.getState().edts?.[0];
    if (target === undefined) {
      return { kind: 'none' };
    }
    if (initialDialogKind === 'switch-confirm') {
      return initialSwitchDialog(target);
    }
    if (initialDialogKind === 'switch-blocked') {
      return { ...initialSwitchDialog(target), blocked: true, error: 'An action is in progress on the current EDT.' };
    }
    if (initialDialogKind === 'service-actions') {
      const branches = useStore.getState().edtsBranches ?? [];
      const memberPath = target.members[0]?.repoPath;
      const svc = branches.find((candidate) => candidate.path === memberPath);
      if (svc === undefined) {
        return { kind: 'none' };
      }
      return initialServiceActionsDialog(target, svc.path, svc.service);
    }
    if (initialDialogKind === 'add-to-edt') {
      const branches = useStore.getState().edtsBranches ?? [];
      const memberPaths = new Set(target.members.map((member) => member.repoPath));
      const svc = branches.find((candidate) => !memberPaths.has(candidate.path));
      if (svc === undefined) {
        return { kind: 'none' };
      }
      return initialAddToEdtDialog(target, svc.path, svc.service, svc.branch);
    }
    return initialModifyDialog(target);
  });

  const edtsRows = edtsStatus === 'error' ? [] : (edts ?? []);
  const clampedEdtsSelected = edtsRows.length === 0 ? 0 : Math.min(edtsSelected, edtsRows.length - 1);
  const focusedEdt: EdtRegistryEntry | undefined = edtsRows[clampedEdtsSelected];

  const candidates = rows; // the flat services list doubles as the create/modify candidate pool
  const candidateState = resolveCandidateListState(status, candidates.length);

  // Story 2.18: the flat SERVICES list, partitioned against the *selected* EDT's membership —
  // each half is its own independently arrow/Home/End-navigable pane.
  const { edtServices, otherServices } = partitionServicesByEdtMembership(rows, focusedEdt);
  const clampedEdtServicesSelected = edtServices.length === 0 ? 0 : Math.min(edtServicesSelected, edtServices.length - 1);
  const clampedOtherServicesSelected = otherServices.length === 0 ? 0 : Math.min(otherServicesSelected, otherServices.length - 1);
  const focusedEdtService: ServiceBranchDivergence | undefined = edtServices[clampedEdtServicesSelected];
  const focusedOtherService: ServiceBranchDivergence | undefined = otherServices[clampedOtherServicesSelected];

  // Review fix (story 2.18): arrowing within the `edts` pane changes `focusedEdt` — and
  // therefore the contents of both partitioned service panes — without touching either pane's
  // own cursor. Left un-reset, a cursor could silently land on a row unrelated to the newly
  // selected EDT (e.g. row 2 of the old EDT SERVICES list happens to still be in range for the
  // new one, but is a completely different service). Reset both to the top whenever which EDT
  // is selected changes.
  useEffect(() => {
    setEdtServicesSelected(0);
    setOtherServicesSelected(0);
  }, [focusedEdt?.ulid]);

  const dialogOpen = dialog.kind !== 'none';

  // AC1: no EDT exists -> an explicit create prompt (topic input + member checklist),
  // never a bare/empty list. Auto-opens once the list has genuinely resolved to empty
  // (never while still loading, never on a load error — mirrors the flat list's own
  // "never render on a stale/unknown state" rule).
  useEffect(() => {
    if (edtsStatus === 'idle' && edts !== null && edts.length === 0 && dialog.kind === 'none') {
      setDialog(initialCreateDialog());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edtsStatus, edts]);

  // Boundary: gate app-shell's global shortcuts (help/filter/command/zone-mnemonic/quit)
  // while any dialog here owns the keystroke.
  useEffect(() => {
    setZoneInputCaptured(dialogOpen);
  }, [dialogOpen, setZoneInputCaptured]);
  useEffect(() => () => setZoneInputCaptured(false), [setZoneInputCaptured]);

  // Story 2.15: handle command-triggered dialogs via currentEdtAction state.
  // When a command sets currentEdtAction, open the corresponding dialog.
  useEffect(() => {
    if (currentEdtAction && dialog.kind === 'none') {
      if (currentEdtAction.type === 'create') {
        setDialog(initialCreateDialog());
        setCurrentEdtAction(null);
      } else if (currentEdtAction.type === 'switch') {
        // If a topic was specified, find the EDT and open switch-confirm pre-targeted
        if (currentEdtAction.target !== 'select EDT') {
          const targetEdt = edtsRows.find((e) => e.topic === currentEdtAction.target);
          if (targetEdt) {
            setDialog(initialSwitchDialog(targetEdt));
            setCurrentEdtAction(null);
          } else {
            // EDT not found - will be handled by the dialog's error state
            setDialog({ kind: 'none' });
            setCurrentEdtAction(null);
          }
        } else {
          // No topic specified - the dialog will show quick-pick (handled by switch dialog logic)
          // For now, open switch-confirm for the first non-active EDT
          const nonActiveEdt = edtsRows.find((e) => e.ulid !== activeEdtUlid);
          if (nonActiveEdt) {
            setDialog(initialSwitchDialog(nonActiveEdt));
            setCurrentEdtAction(null);
          } else {
            setDialog({ kind: 'none' });
            setCurrentEdtAction(null);
          }
        }
      } else if (currentEdtAction.type === 'modify') {
        // If a topic was specified, find the EDT and open modify dialog pre-targeted
        if (currentEdtAction.target !== 'select EDT') {
          const targetEdt = edtsRows.find((e) => e.topic === currentEdtAction.target);
          if (targetEdt) {
            setDialog(initialModifyDialog(targetEdt));
            setCurrentEdtAction(null);
          } else {
            setDialog({ kind: 'none' });
            setCurrentEdtAction(null);
          }
        } else {
          // No topic specified - open modify for the focused EDT
          if (focusedEdt) {
            setDialog(initialModifyDialog(focusedEdt));
            setCurrentEdtAction(null);
          } else {
            setDialog({ kind: 'none' });
            setCurrentEdtAction(null);
          }
        }
      }
    }
  }, [currentEdtAction, dialog.kind, edtsRows, activeEdtUlid, focusedEdt, setDialog, setCurrentEdtAction]);

  // Story 2.15: load action log when an EDT row is focused
  // Track which EDT we've loaded to avoid infinite reload loops
  const [lastLoadedEdtUlid, setLastLoadedEdtUlid] = useState<string | null>(null);

  useEffect(() => {
    if (focusedEdt && edtActionLogStatus === 'idle' && focusedEdt.ulid !== lastLoadedEdtUlid) {
      void loadEdtActionLog(focusedEdt.ulid);
      setLastLoadedEdtUlid(focusedEdt.ulid);
    }
  }, [focusedEdt, edtActionLogStatus, loadEdtActionLog, lastLoadedEdtUlid]);

  function openEdtAction() {
    const target = edtsRows[clampedEdtsSelected];
    if (target === undefined) {
      return;
    }
    if (activeEdtUlid !== null && target.ulid === activeEdtUlid) {
      setDialog(initialModifyDialog(target));
    } else {
      setDialog(initialSwitchDialog(target));
    }
  }

  async function submitCreate(current: CreateDialogState) {
    if (current.submitting) {
      return;
    }
    // Review patch (story 2.9): reject an empty topic inline (mirroring the branch-edit
    // dialog's own inline validation) rather than letting it reach createEdt, whose
    // `missing-argument` error is a raw CLI usage string ("Usage: tui-back edt create
    // --topic <topic> ...") — confusing surfaced verbatim in a keyboard-only TUI form.
    if (current.topic.trim() === '') {
      setDialog((prev) => (prev.kind === 'create' ? { ...prev, error: 'Topic must not be empty' } : prev));
      return;
    }
    setDialog((prev) => (prev.kind === 'create' ? { ...prev, submitting: true, error: null } : prev));
    const result = await createEdtAction({ topic: current.topic, members: [...current.selectedMembers] });
    if (result.ok) {
      // Awaited (not fire-and-forget) so `edtsRows` reflects the newly-created EDT before
      // this function returns — the create dialog's Escape handling below depends on it to
      // tell whether there's now something to cancel back to.
      await loadEdts();
      void loadEdtsBranches();
      const failedSummary = summarizeFailedResults(result.data.results);
      if (failedSummary !== null) {
        setDialog((prev) =>
          prev.kind === 'create' ? { ...prev, submitting: false, error: `EDT created, but some members could not be added — ${failedSummary}` } : prev,
        );
        // Log failed action
        if (focusedEdt) {
          await logEdtAction(focusedEdt.ulid, 'create', 'failed', failedSummary);
        }
        return;
      }
      setDialog({ kind: 'none' });
      // Log successful action
      if (focusedEdt) {
        await logEdtAction(focusedEdt.ulid, 'create', 'success', `Created EDT "${current.topic}" with ${current.selectedMembers.length} member(s)`);
      }
    } else {
      setDialog((prev) => (prev.kind === 'create' ? { ...prev, submitting: false, error: result.error.message } : prev));
      // Log failed action
      if (focusedEdt) {
        await logEdtAction(focusedEdt.ulid, 'create', 'failed', result.error.message);
      }
    }
  }

  async function handleSwitchConfirm(current: SwitchDialogState, force: boolean) {
    // Guard against re-entrancy the same way handleCreateSubmit/handleModifySubmit already do.
    if (current.submitting) {
      return;
    }
    setDialog((prev) => (prev.kind === 'switch-confirm' ? { ...prev, submitting: true, error: null } : prev));
    const result = await switchEdtAction({ topic: current.target.topic, force });
    if (result.ok) {
      void loadEdts();
      void loadEdtsBranches();
      const failedSummary = summarizeFailedResults(result.data.results);
      if (failedSummary !== null) {
        setDialog((prev) =>
          prev.kind === 'switch-confirm' ? { ...prev, submitting: false, error: `Switched, but some repos had a problem — ${failedSummary}` } : prev,
        );
        // Log failed action
        if (focusedEdt) {
          await logEdtAction(focusedEdt.ulid, 'switch', 'failed', failedSummary);
        }
        return;
      }
      setDialog({ kind: 'none' });
      // Log successful action
      if (focusedEdt) {
        await logEdtAction(focusedEdt.ulid, 'switch', 'success', `Switched to EDT "${current.target.topic}"${force ? ' (forced)' : ''}`);
      }
      return;
    }
    // switch-blocked-action-in-progress is surfaced as an explicit block/prompt
    // (force-or-cancel); any other failure stays in switch-confirm with the error shown
    // inline — never a silent return to the EDT list.
    if (!force && isSwitchBlockedError(result.error.code)) {
      setDialog((prev) =>
        prev.kind === 'switch-confirm' ? { ...prev, submitting: false, blocked: true, error: result.error.message } : prev,
      );
      return;
    }
    setDialog((prev) => (prev.kind === 'switch-confirm' ? { ...prev, submitting: false, error: result.error.message } : prev));
    // Log failed action
    if (focusedEdt) {
      await logEdtAction(focusedEdt.ulid, 'switch', 'failed', result.error.message);
    }
  }

  async function submitModify(current: ModifyDialogState) {
    if (current.submitting) {
      return;
    }
    const ops = resolveModifyOps(current.target, current.topic, current.selectedMembers, current.branchEdits);
    setDialog((prev) => (prev.kind === 'modify' ? { ...prev, submitting: true, error: null } : prev));
    const result = await modifyEdtAction({ topic: current.target.topic, ...ops });
    if (result.ok) {
      void loadEdts();
      void loadEdtsBranches();
      const failedSummary = summarizeFailedResults(result.data.results);
      if (failedSummary !== null) {
        setDialog((prev) =>
          prev.kind === 'modify' ? { ...prev, submitting: false, error: `Some changes could not be applied — ${failedSummary}` } : prev,
        );
        // Log failed action
        if (focusedEdt) {
          await logEdtAction(focusedEdt.ulid, 'modify', 'failed', failedSummary);
        }
        return;
      }
      setDialog({ kind: 'none' });
      // Log successful action
      if (focusedEdt) {
        const changes: string[] = [];
        if (ops.addMembers.length > 0) changes.push(`added ${ops.addMembers.length} member(s)`);
        if (ops.removeMembers.length > 0) changes.push(`removed ${ops.removeMembers.length} member(s)`);
        if (ops.setBranches.length > 0) changes.push(`changed ${ops.setBranches.length} branch(es)`);
        if (ops.renameTo) changes.push(`renamed to "${ops.renameTo}"`);
        const detail = changes.length > 0 ? changes.join(', ') : 'no changes';
        await logEdtAction(focusedEdt.ulid, 'modify', 'success', detail);
      }
    } else {
      setDialog((prev) => (prev.kind === 'modify' ? { ...prev, submitting: false, error: result.error.message } : prev));
      // Log failed action
      if (focusedEdt) {
        await logEdtAction(focusedEdt.ulid, 'modify', 'failed', result.error.message);
      }
    }
  }

  function openBranchEdit(current: ModifyDialogState, repoPath: string) {
    const existing =
      current.branchEdits[repoPath] ?? current.target.members.find((member) => member.repoPath === repoPath)?.branch ?? '';
    setDialog((prev) => (prev.kind === 'modify' ? { ...prev, branchEdit: { repoPath, value: existing, error: null } } : prev));
  }

  function handleCreateInput(current: CreateDialogState, input: string, key: Key) {
    if (key.tab) {
      setDialog((prev) => (prev.kind === 'create' ? { ...prev, formFocus: cycleFormFocus(prev.formFocus) } : prev));
      return;
    }
    if (key.escape) {
      if (current.submitting) {
        // Guard against tearing down a submit in flight, same as every other dialog's
        // Escape handling.
        return;
      }
      // Review patch (story 2.9): the create dialog used to treat Escape as unconditionally
      // inert here, reasoning the forced, zero-EDT create prompt "has nothing meaningful to
      // cancel back to" (UX-DR20). That's only true the very first time it opens — once an
      // EDT list actually exists (e.g. this same dialog reopened after a partial-failure
      // create left it on-screen with an inline error, see submitCreate), Escape does have
      // something to cancel back to. When it genuinely doesn't, request a quit instead of
      // leaving the user with no way out short of Ctrl+C (which skips onQuit's lock
      // release in src/bin/tui.ts).
      if (edtsRows.length > 0) {
        setDialog({ kind: 'none' });
        setCurrentEdtAction(null);
        return;
      }
      requestQuit();
      return;
    }
    if (current.formFocus === 'members') {
      const jump = resolveSelectionJump(key);
      if (jump !== null) {
        setDialog((prev) => (prev.kind === 'create' ? { ...prev, memberCursor: jumpSelection(jump, candidates.length) } : prev));
        return;
      }
      const direction = resolveSelectionDirection(key);
      if (direction !== null) {
        setDialog((prev) =>
          prev.kind === 'create' ? { ...prev, memberCursor: moveSelection(prev.memberCursor, direction, candidates.length) } : prev,
        );
        return;
      }
      if (input === ' ') {
        const path = candidates[current.memberCursor]?.path;
        if (path !== undefined) {
          setDialog((prev) => (prev.kind === 'create' ? { ...prev, selectedMembers: toggleMemberSelection(prev.selectedMembers, path) } : prev));
        }
        return;
      }
      if (key.return) {
        void submitCreate(current);
        return;
      }
      return;
    }
    // formFocus === 'topic'
    if (key.return) {
      void submitCreate(current);
      return;
    }
    setDialog((prev) => (prev.kind === 'create' ? { ...prev, topic: nextTextInputValue(prev.topic, input, key) } : prev));
  }

  function handleSwitchDialogInput(current: SwitchDialogState, _input: string, key: Key) {
    if (key.escape) {
      if (!current.submitting) {
        setDialog({ kind: 'none' });
        setCurrentEdtAction(null);
      }
      return;
    }
    if (key.return) {
      void handleSwitchConfirm(current, current.blocked);
    }
  }

  function handleBranchEditInput(current: ModifyDialogState, branchEdit: BranchEditState, input: string, key: Key) {
    if (key.escape) {
      setDialog((prev) => (prev.kind === 'modify' ? { ...prev, branchEdit: null } : prev));
      return;
    }
    if (key.return) {
      const validationError = validateBranchEditValue(branchEdit.value);
      if (validationError !== null) {
        setDialog((prev) =>
          prev.kind === 'modify' && prev.branchEdit ? { ...prev, branchEdit: { ...prev.branchEdit, error: validationError } } : prev,
        );
        return;
      }
      setDialog((prev) => {
        if (prev.kind !== 'modify' || prev.branchEdit === null) {
          return prev;
        }
        return {
          ...prev,
          // Review patch (story 2.9): validated against the trimmed value above — persist
          // that same trimmed value, not the raw one, so accidental leading/trailing
          // whitespace never reaches `modifyEdt`'s git layer as part of the branch name.
          branchEdits: { ...prev.branchEdits, [prev.branchEdit.repoPath]: branchEdit.value.trim() },
          branchEdit: null,
        };
      });
      return;
    }
    setDialog((prev) => {
      if (prev.kind !== 'modify' || prev.branchEdit === null) {
        return prev;
      }
      return { ...prev, branchEdit: { ...prev.branchEdit, value: nextTextInputValue(prev.branchEdit.value, input, key), error: null } };
    });
  }

  function handleModifyDialogInput(current: ModifyDialogState, input: string, key: Key) {
    if (current.branchEdit !== null) {
      handleBranchEditInput(current, current.branchEdit, input, key);
      return;
    }
    if (key.tab) {
      setDialog((prev) => (prev.kind === 'modify' ? { ...prev, formFocus: cycleFormFocus(prev.formFocus) } : prev));
      return;
    }
    if (key.escape) {
      if (!current.submitting) {
        setDialog({ kind: 'none' });
        setCurrentEdtAction(null);
      }
      return;
    }
    if (current.formFocus === 'members') {
      const jump = resolveSelectionJump(key);
      if (jump !== null) {
        setDialog((prev) => (prev.kind === 'modify' ? { ...prev, memberCursor: jumpSelection(jump, candidates.length) } : prev));
        return;
      }
      const direction = resolveSelectionDirection(key);
      if (direction !== null) {
        setDialog((prev) =>
          prev.kind === 'modify' ? { ...prev, memberCursor: moveSelection(prev.memberCursor, direction, candidates.length) } : prev,
        );
        return;
      }
      if (input === ' ') {
        const path = candidates[current.memberCursor]?.path;
        if (path !== undefined) {
          setDialog((prev) => (prev.kind === 'modify' ? { ...prev, selectedMembers: toggleMemberSelection(prev.selectedMembers, path) } : prev));
        }
        return;
      }
      if (key.return) {
        const path = candidates[current.memberCursor]?.path;
        const action = resolveModifyEnterAction('members', current.target, current.selectedMembers, path);
        if (action.type === 'edit-branch') {
          openBranchEdit(current, action.repoPath);
        } else {
          void submitModify(current);
        }
        return;
      }
      return;
    }
    // formFocus === 'topic'
    if (key.return) {
      void submitModify(current);
      return;
    }
    setDialog((prev) => (prev.kind === 'modify' ? { ...prev, topic: nextTextInputValue(prev.topic, input, key) } : prev));
  }

  // Story 2.18: EDT SERVICES row contextual menu — "Remove from EDT" ------------------------
  async function submitRemoveFromEdt(current: ServiceActionsDialogState) {
    if (current.submitting) {
      return;
    }
    setDialog((prev) => (prev.kind === 'service-actions' ? { ...prev, submitting: true, error: null } : prev));
    const result = await modifyEdtAction({ topic: current.edt.topic, addMembers: [], removeMembers: [current.repoPath], setBranches: [] });
    if (result.ok) {
      void loadEdts();
      void loadEdtsBranches();
      const failedSummary = summarizeFailedResults(result.data.results);
      if (failedSummary !== null) {
        setDialog((prev) => (prev.kind === 'service-actions' ? { ...prev, submitting: false, error: failedSummary } : prev));
        await logEdtAction(current.edt.ulid, 'modify', 'failed', failedSummary);
        return;
      }
      setDialog({ kind: 'none' });
      await logEdtAction(current.edt.ulid, 'modify', 'success', `Removed ${current.serviceName} from EDT "${current.edt.topic}"`);
      return;
    }
    setDialog((prev) => (prev.kind === 'service-actions' ? { ...prev, submitting: false, error: result.error.message } : prev));
    await logEdtAction(current.edt.ulid, 'modify', 'failed', result.error.message);
  }

  // Story 2.18: EDT SERVICES row contextual menu — "Change branch for this EDT" -------------
  async function submitServiceActionsBranchChange(current: ServiceActionsDialogState, branch: string) {
    if (current.submitting) {
      return;
    }
    setDialog((prev) => (prev.kind === 'service-actions' ? { ...prev, submitting: true, error: null } : prev));
    const result = await modifyEdtAction({
      topic: current.edt.topic,
      addMembers: [],
      removeMembers: [],
      setBranches: [{ repoPath: current.repoPath, branch }],
    });
    if (result.ok) {
      void loadEdts();
      void loadEdtsBranches();
      const failedSummary = summarizeFailedResults(result.data.results);
      if (failedSummary !== null) {
        setDialog((prev) => (prev.kind === 'service-actions' ? { ...prev, submitting: false, branchEdit: null, error: failedSummary } : prev));
        await logEdtAction(current.edt.ulid, 'modify', 'failed', failedSummary);
        return;
      }
      setDialog({ kind: 'none' });
      await logEdtAction(current.edt.ulid, 'modify', 'success', `Changed branch for ${current.serviceName} to "${branch}"`);
      return;
    }
    setDialog((prev) => (prev.kind === 'service-actions' ? { ...prev, submitting: false, branchEdit: null, error: result.error.message } : prev));
    await logEdtAction(current.edt.ulid, 'modify', 'failed', result.error.message);
  }

  function openServiceActionsBranchEdit(current: ServiceActionsDialogState) {
    const existing = current.edt.members.find((member) => member.repoPath === current.repoPath)?.branch ?? '';
    setDialog((prev) => (prev.kind === 'service-actions' ? { ...prev, branchEdit: { repoPath: current.repoPath, value: existing, error: null } } : prev));
  }

  function handleServiceActionsBranchEditInput(current: ServiceActionsDialogState, branchEdit: BranchEditState, input: string, key: Key) {
    if (key.escape) {
      // Review fix (story 2.18): guard against tearing down the branch-edit sub-view while a
      // submit is in flight, same as handleServiceActionsInput's and handleAddToEdtInput's own
      // Escape guards.
      if (!current.submitting) {
        setDialog((prev) => (prev.kind === 'service-actions' ? { ...prev, branchEdit: null } : prev));
      }
      return;
    }
    if (key.return) {
      const validationError = validateBranchEditValue(branchEdit.value);
      if (validationError !== null) {
        setDialog((prev) =>
          prev.kind === 'service-actions' && prev.branchEdit ? { ...prev, branchEdit: { ...prev.branchEdit, error: validationError } } : prev,
        );
        return;
      }
      void submitServiceActionsBranchChange(current, branchEdit.value.trim());
      return;
    }
    setDialog((prev) => {
      if (prev.kind !== 'service-actions' || prev.branchEdit === null) {
        return prev;
      }
      return { ...prev, branchEdit: { ...prev.branchEdit, value: nextTextInputValue(prev.branchEdit.value, input, key), error: null } };
    });
  }

  // Boundary/Design Notes: the two new direct-action flows (this contextual menu's "Change
  // branch" and the Add-to-EDT dialog below) open their branch-edit text input straight from
  // the row-level Enter handler — they never route through resolveModifyEnterAction/
  // canEditMemberBranch (the big Modify dialog's own member-checklist Enter dispatch), so
  // that check's existing restriction (member of target EDT AND currently checked) simply
  // doesn't apply here: it's bypassed, not loosened.
  function handleServiceActionsInput(current: ServiceActionsDialogState, input: string, key: Key) {
    if (current.branchEdit !== null) {
      handleServiceActionsBranchEditInput(current, current.branchEdit, input, key);
      return;
    }
    if (key.escape) {
      if (!current.submitting) {
        setDialog({ kind: 'none' });
      }
      return;
    }
    const jump = resolveSelectionJump(key);
    if (jump !== null) {
      setDialog((prev) => (prev.kind === 'service-actions' ? { ...prev, cursor: jumpSelection(jump, SERVICE_ACTION_MENU_ITEMS.length) } : prev));
      return;
    }
    const direction = resolveSelectionDirection(key);
    if (direction !== null) {
      setDialog((prev) =>
        prev.kind === 'service-actions' ? { ...prev, cursor: moveSelection(prev.cursor, direction, SERVICE_ACTION_MENU_ITEMS.length) } : prev,
      );
      return;
    }
    if (key.return) {
      const item = SERVICE_ACTION_MENU_ITEMS[current.cursor];
      if (item === undefined || item.disabled) {
        // Restart is rendered disabled — Enter on it never dispatches (Boundaries).
        return;
      }
      if (current.cursor === 0) {
        void submitRemoveFromEdt(current);
      } else {
        openServiceActionsBranchEdit(current);
      }
    }
  }

  // Story 2.18: OTHER SERVICES row's Add-to-EDT dialog --------------------------------------
  async function submitAddToEdt(current: AddToEdtDialogState) {
    if (current.submitting) {
      return;
    }
    const branch = current.value.trim();
    setDialog((prev) => (prev.kind === 'add-to-edt' ? { ...prev, submitting: true, error: null } : prev));
    const result = await modifyEdtAction({
      topic: current.edt.topic,
      addMembers: [current.repoPath],
      removeMembers: [],
      setBranches: [{ repoPath: current.repoPath, branch }],
    });
    if (result.ok) {
      void loadEdts();
      void loadEdtsBranches();
      const failedSummary = summarizeFailedResults(result.data.results);
      if (failedSummary !== null) {
        setDialog((prev) => (prev.kind === 'add-to-edt' ? { ...prev, submitting: false, error: failedSummary } : prev));
        await logEdtAction(current.edt.ulid, 'modify', 'failed', failedSummary);
        return;
      }
      setDialog({ kind: 'none' });
      await logEdtAction(current.edt.ulid, 'modify', 'success', `Added ${current.serviceName} to EDT "${current.edt.topic}" on branch "${branch}"`);
      return;
    }
    setDialog((prev) => (prev.kind === 'add-to-edt' ? { ...prev, submitting: false, error: result.error.message } : prev));
    await logEdtAction(current.edt.ulid, 'modify', 'failed', result.error.message);
  }

  function handleAddToEdtInput(current: AddToEdtDialogState, input: string, key: Key) {
    if (key.escape) {
      if (!current.submitting) {
        setDialog({ kind: 'none' });
      }
      return;
    }
    if (key.return) {
      const validationError = validateBranchEditValue(current.value);
      if (validationError !== null) {
        setDialog((prev) => (prev.kind === 'add-to-edt' ? { ...prev, error: validationError } : prev));
        return;
      }
      void submitAddToEdt(current);
      return;
    }
    setDialog((prev) => (prev.kind === 'add-to-edt' ? { ...prev, value: nextTextInputValue(prev.value, input, key), error: null } : prev));
  }

  useInput((input, key) => {
    if (dialog.kind === 'create') {
      handleCreateInput(dialog, input, key);
      return;
    }
    if (dialog.kind === 'switch-confirm') {
      handleSwitchDialogInput(dialog, input, key);
      return;
    }
    if (dialog.kind === 'modify') {
      handleModifyDialogInput(dialog, input, key);
      return;
    }
    if (dialog.kind === 'service-actions') {
      handleServiceActionsInput(dialog, input, key);
      return;
    }
    if (dialog.kind === 'add-to-edt') {
      handleAddToEdtInput(dialog, input, key);
      return;
    }

    // Base edt-list view (no dialog open): Tab cycles which of the three lists is focused;
    // arrows/Home/End move only the currently-focused list — all three stay independently
    // navigable.
    if (key.tab) {
      setPaneFocus((current) => cyclePaneFocus(current));
      return;
    }

    if (paneFocus === 'edts') {
      const jump = resolveSelectionJump(key);
      if (jump !== null) {
        setEdtsSelected(jumpSelection(jump, edtsRows.length));
        return;
      }
      const direction = resolveSelectionDirection(key);
      if (direction !== null) {
        setEdtsSelected((prevIndex) => moveSelection(prevIndex, direction, edtsRows.length));
        return;
      }
      if (key.return) {
        openEdtAction();
      }
      return;
    }

    if (paneFocus === 'edt-services') {
      const jump = resolveSelectionJump(key);
      if (jump !== null) {
        setEdtServicesSelected(jumpSelection(jump, edtServices.length));
        return;
      }
      const direction = resolveSelectionDirection(key);
      if (direction !== null) {
        setEdtServicesSelected((prevIndex) => moveSelection(prevIndex, direction, edtServices.length));
        return;
      }
      if (key.return) {
        const service = edtServices[clampedEdtServicesSelected];
        if (service !== undefined && focusedEdt !== undefined) {
          setDialog(initialServiceActionsDialog(focusedEdt, service.path, service.service));
        }
      }
      return;
    }

    // paneFocus === 'other-services'
    const jump = resolveSelectionJump(key);
    if (jump !== null) {
      setOtherServicesSelected(jumpSelection(jump, otherServices.length));
      return;
    }
    const direction = resolveSelectionDirection(key);
    if (direction !== null) {
      setOtherServicesSelected((prevIndex) => moveSelection(prevIndex, direction, otherServices.length));
      return;
    }
    if (key.return) {
      const service = otherServices[clampedOtherServicesSelected];
      if (service !== undefined && focusedEdt !== undefined) {
        setDialog(initialAddToEdtDialog(focusedEdt, service.path, service.service, service.branch));
      }
    }
  }, { isActive: !commandBarOpen });

  const loading = status === 'loading' && rows.length === 0;
  const edtsLoading = edtsStatus === 'loading' && edts === null;

  return (
    <Box flexDirection="column" flexGrow={1} backgroundColor={colors.surface}>
      <ListDetailSplit
        ratio={ratio}
        list={
          <Box flexDirection="column" paddingX={spacing['pane-padding-x']}>
            <Text color={paneFocus === 'edts' ? colors.accent : colors['text-dim']}>EDTS</Text>
            {edtsLoading ? <Text color={colors['text-dim']}>Loading EDTs…</Text> : null}
            {edtsStatus === 'error' ? <Text color={colors.error}>Failed to load EDTs</Text> : null}
            {!edtsLoading && edtsStatus !== 'error' && edtsRows.length === 0 ? (
              <Text color={colors['text-dim']}>No EDTs yet.</Text>
            ) : null}
            {edtsRows.map((entry, index) => (
              <ListRow
                key={entry.ulid}
                label={entry.topic}
                meta={formatEdtRowMeta(entry)}
                selected={paneFocus === 'edts' && index === clampedEdtsSelected}
                // Amended 2026-08-27 (Sprint Change Proposal): `emphasized` now marks the row
                // at `clampedEdtsSelected` — the same index `focusedEdt` (below) is read from,
                // whose membership drives the EDT SERVICES/OTHER SERVICES split — so it persists
                // across all three panes' focus, not just while paneFocus === 'edts' (unlike
                // `selected` above).
                emphasized={index === clampedEdtsSelected}
                // `active` (repurposed): the tool-wide active EDT's row, now a discreet suffix
                // instead of accent+bold — decoupled from `emphasized`, can land on the same or
                // a different row.
                active={entry.ulid === activeEdtUlid}
              />
            ))}
            {!dialogOpen ? <DimAnnotation text="[Enter] switch/modify  [Tab] focus" /> : null}

            <Text> </Text>
            {/* Story 2.18: the flat SERVICES list (story 2.6) is now split into two
                Tab-cyclable panes, partitioned against the *selected* EDT's own membership
                (partitionServicesByEdtMembership) — never an empty EDT SERVICES group when no
                EDT is focused; a "No EDT selected" note stands in for it instead. */}
            {/* Review fix (story 2.18): issuesSummary counts unreachable/error services across
                the whole flat list, which may include rows that land in either partitioned
                group — shown once here, above both groups, rather than nested only under
                OTHER SERVICES where a flagged service that's actually an EDT member would go
                unreported. */}
            {loading ? <Text color={colors['text-dim']}>Loading services…</Text> : null}
            {status === 'error' ? <Text color={colors.error}>Failed to load services</Text> : null}
            {issuesSummary ? <DimAnnotation text={issuesSummary} /> : null}
            {focusedEdt !== undefined ? (
              <>
                <Text color={paneFocus === 'edt-services' ? colors.accent : colors['text-dim']}>EDT SERVICES</Text>
                {!loading && status !== 'error' && edtServices.length === 0 ? (
                  <Text color={colors['text-dim']}>No services in this EDT.</Text>
                ) : null}
                {edtServices.map((service, index) => (
                  <ListRow
                    key={service.path}
                    label={service.service}
                    meta={formatServiceMeta(service)}
                    selected={paneFocus === 'edt-services' && index === clampedEdtServicesSelected}
                  />
                ))}
                <Text> </Text>
              </>
            ) : (
              <DimAnnotation text="No EDT selected" />
            )}

            <Text color={paneFocus === 'other-services' ? colors.accent : colors['text-dim']}>OTHER SERVICES</Text>
            {!loading && status !== 'error' && otherServices.length === 0 ? (
              <Text color={colors['text-dim']}>No managed services found.</Text>
            ) : null}
            {otherServices.map((service, index) => (
              <ListRow
                key={service.path}
                label={service.service}
                meta={formatServiceMeta(service)}
                selected={paneFocus === 'other-services' && index === clampedOtherServicesSelected}
              />
            ))}
          </Box>
        }
        detail={
          <Box flexDirection="column" paddingX={spacing['pane-padding-x']}>
            {paneFocus === 'edts' ? (
              <>
                <DetailPane title={focusedEdt ? focusedEdt.topic : 'EDT'}>
                  {focusedEdt
                    ? formatEdtDetail(focusedEdt, focusedEdt.ulid === activeEdtUlid) +
                      '\n\n' +
                      formatEdtActionHistory(edtActionLog, currentEdtAction) +
                      appendHint(resolveActionHint('edts', focusedEdt.ulid === activeEdtUlid, hiddenActionHints))
                    : 'No EDT selected.'}
                </DetailPane>
                {edtsStatus === 'error' && edtsError ? <DimAnnotation text={edtsError} /> : null}
                {edtActionLogStatus === 'loading' && <DimAnnotation text="Loading action history…" />}
                {edtActionLogStatus === 'error' && <DimAnnotation text="Failed to load action history" />}
              </>
            ) : paneFocus === 'edt-services' ? (
              <>
                <DetailPane title={focusedEdtService ? focusedEdtService.service : 'Service'}>
                  {(focusedEdtService ? formatServiceDetail(focusedEdtService) : 'No service selected.') +
                    appendHint(resolveActionHint('edt-services', false, hiddenActionHints))}
                </DetailPane>
                {focusedEdtService?.detail ? <DimAnnotation text={focusedEdtService.detail.message} /> : null}
                {status === 'error' && error ? <DimAnnotation text={error} /> : null}
              </>
            ) : (
              <>
                <DetailPane title={focusedOtherService ? focusedOtherService.service : 'Service'}>
                  {(focusedOtherService ? formatServiceDetail(focusedOtherService) : 'No service selected.') +
                    appendHint(resolveActionHint('other-services', false, hiddenActionHints))}
                </DetailPane>
                {focusedOtherService?.detail ? <DimAnnotation text={focusedOtherService.detail.message} /> : null}
                {status === 'error' && error ? <DimAnnotation text={error} /> : null}
              </>
            )}
          </Box>
        }
      />

      {dialog.kind === 'create' ? (
        <ModalDialog title="CREATE EDT" onConfirm={() => {}} onCancel={() => {}} open={true}>
          <Box flexDirection="column">
            <Text color={dialog.formFocus === 'topic' ? colors.accent : colors.text}>Topic: {dialog.topic}</Text>
            {candidateState === 'loading' ? <Text color={colors['text-dim']}>Loading services…</Text> : null}
            {candidateState === 'error' ? <Text color={colors.error}>Failed to load services — cannot show candidates.</Text> : null}
            {candidateState === 'empty' ? <Text color={colors['text-dim']}>No registered services available.</Text> : null}
            {candidateState === 'ready'
              ? candidates.map((candidate, index) => (
                  <Box key={candidate.path}>
                    <Text color={colors.accent}>{dialog.formFocus === 'members' && index === dialog.memberCursor ? '›' : ' '}</Text>
                    <CheckboxListItem
                      label={candidate.service}
                      state={dialog.selectedMembers.includes(candidate.path) ? 'checked' : 'unchecked'}
                    />
                  </Box>
                ))
              : null}
            {dialog.error ? <DimAnnotation text={dialog.error} /> : null}
            {dialog.submitting ? <DimAnnotation text="Creating…" /> : null}
          </Box>
        </ModalDialog>
      ) : null}

      {dialog.kind === 'switch-confirm' ? (
        <ModalDialog title="SWITCH EDT" onConfirm={() => {}} onCancel={() => {}} open={true}>
          <Box flexDirection="column">
            {dialog.blocked ? (
              <>
                <Text color={colors.warning}>
                  Cannot switch away: an action is in progress on the current EDT.
                </Text>
                <Text color={colors.text}>[Enter] force switch anyway  [Esc] cancel</Text>
              </>
            ) : (
              <>
                <Text color={colors.text}>Switch to "{dialog.target.topic}"?</Text>
                <Text color={colors.text}>[Enter] confirm  [Esc] cancel</Text>
              </>
            )}
            {dialog.error ? <DimAnnotation text={dialog.error} /> : null}
            {dialog.submitting ? <DimAnnotation text="Switching…" /> : null}
          </Box>
        </ModalDialog>
      ) : null}

      {dialog.kind === 'modify' ? (
        <ModalDialog title="MODIFY EDT" onConfirm={() => {}} onCancel={() => {}} open={true}>
          <Box flexDirection="column">
            {dialog.branchEdit !== null ? (
              <>
                <Text color={colors.accent}>Branch for {dialog.branchEdit.repoPath}: {dialog.branchEdit.value}</Text>
                {dialog.branchEdit.error ? <DimAnnotation text={dialog.branchEdit.error} /> : null}
              </>
            ) : (
              <>
                <Text color={dialog.formFocus === 'topic' ? colors.accent : colors.text}>Topic: {dialog.topic}</Text>
                {candidateState === 'loading' ? <Text color={colors['text-dim']}>Loading services…</Text> : null}
                {candidateState === 'empty' ? <Text color={colors['text-dim']}>No registered services available.</Text> : null}
                {candidateState === 'ready'
                  ? candidates.map((candidate, index) => {
                      const branch = dialog.branchEdits[candidate.path] ??
                        dialog.target.members.find((member) => member.repoPath === candidate.path)?.branch;
                      return (
                        <Box key={candidate.path}>
                          <Text color={colors.accent}>{dialog.formFocus === 'members' && index === dialog.memberCursor ? '›' : ' '}</Text>
                          <CheckboxListItem
                            label={candidate.service}
                            state={dialog.selectedMembers.includes(candidate.path) ? 'checked' : 'unchecked'}
                            meta={branch}
                          />
                        </Box>
                      );
                    })
                  : null}
                {dialog.error ? <DimAnnotation text={dialog.error} /> : null}
                {dialog.submitting ? <DimAnnotation text="Saving…" /> : null}
              </>
            )}
          </Box>
        </ModalDialog>
      ) : null}

      {dialog.kind === 'service-actions' ? (
        <ModalDialog title="SERVICE ACTIONS" onConfirm={() => {}} onCancel={() => {}} open={true}>
          <Box flexDirection="column">
            <Text color={colors.text}>{dialog.serviceName}</Text>
            {dialog.branchEdit !== null ? (
              <>
                <Text color={colors.accent}>Branch for {dialog.serviceName}: {dialog.branchEdit.value}</Text>
                {dialog.branchEdit.error ? <DimAnnotation text={dialog.branchEdit.error} /> : null}
                {dialog.submitting ? <DimAnnotation text="Saving…" /> : null}
              </>
            ) : (
              <>
                {SERVICE_ACTION_MENU_ITEMS.map((item, index) => (
                  <ListRow
                    key={item.label}
                    label={item.label}
                    meta={item.disabled ? 'Available with Epic 5' : undefined}
                    selected={index === dialog.cursor}
                  />
                ))}
                {dialog.error ? <DimAnnotation text={dialog.error} /> : null}
                {dialog.submitting ? <DimAnnotation text="Working…" /> : null}
              </>
            )}
          </Box>
        </ModalDialog>
      ) : null}

      {dialog.kind === 'add-to-edt' ? (
        <ModalDialog title="ADD TO EDT" onConfirm={() => {}} onCancel={() => {}} open={true}>
          <Box flexDirection="column">
            <Text color={colors.text}>Add {dialog.serviceName} to "{dialog.edt.topic}"</Text>
            <Text color={colors.accent}>Branch: {dialog.value}</Text>
            {dialog.error ? <DimAnnotation text={dialog.error} /> : null}
            {dialog.submitting ? <DimAnnotation text="Adding…" /> : null}
          </Box>
        </ModalDialog>
      ) : null}
    </Box>
  );
}
