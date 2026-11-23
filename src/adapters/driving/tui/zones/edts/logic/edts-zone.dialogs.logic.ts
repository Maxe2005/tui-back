// tui/zones/edts: remaining EDT dialog states and their initialisers.
import type { ActivationBlockedRepo } from '../../../../../../core/workspace/edt/lifecycle/activate.js';
import { defaultDispositionFor, type MemberDeleteStatus, type MemberDisposition } from '../../../../../../core/workspace/edt/lifecycle/delete.js';
import { isSystemEdt } from '../../../../../../core/workspace/edt/shared-edt/shared-edt.js';
import type { FastForwardSharedRow } from '../../../../../../core/workspace/edt/branches/fast-forward-shared.js';
import type { SwitchEdtRepoResult } from '../../../../../../core/workspace/edt/switch/switch.js';
import type { EdtRegistryEntry } from '../../../../../../core/ports/storage/edt-registry.js';
import { createBranchPickerState, applyBranchPickerRetry, type BranchPickerState } from '../../../shared/components/pickers/branch-picker.js';
import { type FailedResultRow } from '../../../shared/components/lists/failed-result-list.js';
import type { MenuItem } from '../../../shared/components/lists/menu-list.js';
import { createFilterablePickListState, type FilterablePickListState } from '../../../shared/components/pickers/filterable-pick-list.js';
import type { TextInputState } from '../../../shared/components/inputs/text-edit.js';
import type { SwitchRestartRunMode } from '../../../../../../core/workspace/edt/switch/restart/switch-restart.js';
import type { SwitchResolutionState } from '../dialogs/switch-resolution/switch-resolution.logic.js';
import type { FormFocus } from './edts-zone.focus.logic.js';
import type { CreateDialogState } from './edts-zone.wizard.logic.js';
import { initialBranchStepState } from './edts-zone.wizard.logic.js';
import { resolveModifyOps } from './edts-zone.modify.logic.js';

// The create-EDT wizard's 4 steps (Nom -> Services -> Branches -> Activation).
export type WizardStep = 1 | 2 | 3 | 4;

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
  // summary (Enter/Esc close it); an all-`switched`/`unchanged` run closes.
  results?: SwitchEdtRepoResult[];
  // This switch's post-switch restart choice (FR-37). Undefined = inherit the
  // `switch.restartMode` setting (the dialog never writes it back); the create wizard's
  // "switch now" handoff sets an explicit `'none'` — its Enter was already the confirmation and
  // no selector is shown there.
  restartMode?: SwitchRestartRunMode;
  // True once the dialog is on the post-switch restart report (rows live in the store's
  // `switchRestart`, so the report survives leaving the zone).
  restartReport?: boolean;
};

// A live branch-picker session, opened from any of the 3 non-creation branch-entry points.
// `branches`/`branchesStatus` are this repoPath's own `listBranches()` result, fetched once when
// the session opens (not continuously re-synced).
export type BranchPickerSession = {
  repoPath: string;
  state: BranchPickerState;
  branches: string[];
  branchesStatus: 'loading' | 'ready' | 'error';
  // Branch -> topics of the *other* EDTs that register it as their own for this repoPath,
  // computed alongside `branches` when the list loads. Drives the chooser's `⚠ EDT « topic »`
  // annotations and the picker's inline refusals.
  owners?: Record<string, string[]>;
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
  // shared/components/inputs/text-edit.ts.
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
// repoPath in one call (core/edt/lifecycle/modify.ts composes them).
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
// toggleable. Reuses core/edt/lifecycle/delete.ts's defaultDispositionFor as the single source of truth.
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

// The "fast-forward the shared branches" quick action: running while the core call
// is in flight, then the per-service rows (or a refusal) until Enter/Esc.
export type FastForwardDialogState = {
  kind: 'fast-forward-shared';
  status: 'running' | 'done';
  rows: FastForwardSharedRow[];
  error: string | null;
};

export function initialFastForwardDialog(): FastForwardDialogState {
  return { kind: 'fast-forward-shared', status: 'running', rows: [], error: null };
}

export type EdtDialogState =
  | { kind: 'none' }
  | CreateDialogState
  | SwitchDialogState
  | ModifyDialogState
  | ServiceActionsDialogState
  | AddToEdtDialogState
  | DeleteDialogState
  | IssuesDialogState
  | QuickPickDialogState
  | FastForwardDialogState;

export function initialIssuesDialog(): IssuesDialogState {
  return { kind: 'issues' };
}

export function initialQuickPickDialog(mode: QuickPickMode, notFound: string | null = null): QuickPickDialogState {
  return { kind: 'quick-pick', mode, notFound, ...createFilterablePickListState() };
}

// `seed` (edt-create-from's root EDT) pre-checks Step 2 with its members, in root order; Step 3's
// per-row seeding happens on entering it (wizard.logic.ts's enterBranchStep), once the global
// name is known. The topic always starts empty — never derived from the root.
export function initialCreateDialog(rawSeed?: EdtRegistryEntry): CreateDialogState {
  // The system EDT is never a template: a system seed is ignored (a blank wizard opens).
  const seed = rawSeed !== undefined && isSystemEdt(rawSeed) ? undefined : rawSeed;
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

export function initialSwitchDialog(target: EdtRegistryEntry, restartMode?: SwitchRestartRunMode): SwitchDialogState {
  return {
    kind: 'switch-confirm',
    target,
    submitting: false,
    error: null,
    failedRows: [],
    blocked: false,
    resolution: null,
    ...(restartMode !== undefined ? { restartMode } : {}),
  };
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
