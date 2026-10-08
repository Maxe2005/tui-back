// tui/zones/edts/dialogs: the MODIFY EDT dialog — topic rename, member checklist, and the shared
// branch-picker for per-member branch set/create/rename outcomes. The most involved dialog: it
// *stages* picker outcomes (rather than submitting immediately, like service-actions/add-to-edt)
// and drives the "try a different branch/name" retry flow.
import { Box, Text, type Key } from 'ink';
import type { ServiceBranchDivergence } from '../../../../../../core/edt/list.js';
import type { EdtRegistryEntry } from '../../../../../../core/ports/edt-registry.js';
import type { AppState } from '../../../store/app-store.js';
import { CheckboxListItem } from '../../../shared/components/checkbox-list-item.js';
import { BranchPicker, handleBranchPickerKey, type BranchPickerOutcome } from '../../../shared/components/branch-picker.js';
import { DimAnnotation } from '../../../shared/components/dim-annotation.js';
import { FailedResultList } from '../../../shared/components/failed-result-list.js';
import { ModalDialog } from '../../../shared/components/modal-dialog.js';
import { TextInputLine } from '../../../shared/components/text-input-line.js';
import { nextTextInputValue } from '../../../shared/components/text-edit.js';
import { resolveFocusStep } from '../../../shared/keys/focus-navigation.js';
import { colors } from '../../../shared/theme/theme.js';
import {
  createPickerSession,
  cycleFormFocus,
  FORM_FOCUS_NAV,
  findRetryableFailedRow,
  resolveModifyEnterAction,
  resolveModifyOps,
  suggestBranchForNewMember,
  summarizeFailedResults,
  toggleMemberSelection,
  validateBranchEditValue,
  type BranchPickerSession,
  type CandidateListState,
  type EdtDialogState,
  type ModifyDialogState,
} from '../edts-zone.logic.js';
import { StateLine } from '../../../shared/components/state-line.js';
import { jumpSelection, moveSelection, resolveSelectionDirection, resolveSelectionJump } from '../../../shared/keys/list-cursor.js';

export type ModifyDialogDeps = {
  setDialog: (updater: EdtDialogState | ((prev: EdtDialogState) => EdtDialogState)) => void;
  modifyEdtAction: AppState['modifyEdt'];
  loadEdts: AppState['loadEdts'];
  loadEdtsBranches: AppState['loadEdtsBranches'];
  logEdtAction: AppState['logEdtAction'];
  setCurrentEdtAction: AppState['setCurrentEdtAction'];
  createMemberBranchAction: AppState['createMemberBranch'];
  renameBranchAction: AppState['renameBranch'];
  focusedEdt: EdtRegistryEntry | undefined;
  candidates: readonly ServiceBranchDivergence[];
};

export function createModifyDialogHandlers(deps: ModifyDialogDeps) {
  async function submitModify(current: ModifyDialogState) {
    if (current.submitting) {
      return;
    }
    // Block confirm inline (no core call) when a newly-checked member's staged branch is empty —
    // the validateBranchEditValue convention, enforced here too since a new member's field can be
    // reached and cleared without ever opening the picker.
    const originalPaths = new Set(current.target.members.map((member) => member.repoPath));
    for (const path of current.selectedMembers) {
      if (!originalPaths.has(path)) {
        const validationError = validateBranchEditValue(current.branchEdits[path] ?? '');
        if (validationError !== null) {
          deps.setDialog((prev) => (prev.kind === 'modify' ? { ...prev, error: validationError } : prev));
          return;
        }
      }
    }
    const ops = resolveModifyOps(current.target, current.topic, current.selectedMembers, current.branchEdits, current.branchRenames);
    deps.setDialog((prev) => (prev.kind === 'modify' ? { ...prev, submitting: true, error: null, failedRows: [] } : prev));
    const result = await deps.modifyEdtAction({ topic: current.target.topic, ...ops });
    if (result.ok) {
      void deps.loadEdts();
      void deps.loadEdtsBranches();
      // Structured rows — `current.branchEdits`/`branchRenames` (read by
      // openBranchPickerForModify below) are never cleared on failure, so a "try a different
      // branch"/"try a different name" retry on one of these rows reopens pre-filled with the
      // value that just got rejected.
      const failedRows = summarizeFailedResults(result.data.results);
      if (failedRows.length > 0) {
        deps.setDialog((prev) => (prev.kind === 'modify' ? { ...prev, submitting: false, failedRows } : prev));
        // Log failed action
        if (deps.focusedEdt) {
          await deps.logEdtAction(deps.focusedEdt.ulid, 'modify', 'failed', failedRows.map((row) => row.message).join('; '));
        }
        return;
      }
      deps.setDialog({ kind: 'none' });
      // Log successful action
      if (deps.focusedEdt) {
        const changes: string[] = [];
        if (ops.addMembers.length > 0) changes.push(`added ${ops.addMembers.length} member(s)`);
        if (ops.removeMembers.length > 0) changes.push(`removed ${ops.removeMembers.length} member(s)`);
        // resolveModifyOps includes a setBranches entry for every checked non-member (every add)
        // — only count an entry toward "changed N branch(es)" when it's NOT also an add, so a
        // plain add never double-logs as a branch change.
        const addPaths = new Set(ops.addMembers);
        const actualBranchChanges = ops.setBranches.filter((entry) => !addPaths.has(entry.repoPath));
        if (actualBranchChanges.length > 0) changes.push(`changed ${actualBranchChanges.length} branch(es)`);
        if (ops.renameBranches.length > 0) changes.push(`renamed ${ops.renameBranches.length} branch(es)`);
        if (ops.renameTo) changes.push(`renamed to "${ops.renameTo}"`);
        const detail = changes.length > 0 ? changes.join(', ') : 'no changes';
        await deps.logEdtAction(deps.focusedEdt.ulid, 'modify', 'success', detail);
      }
    } else {
      deps.setDialog((prev) => (prev.kind === 'modify' ? { ...prev, submitting: false, error: result.error.message } : prev));
      // Log failed action
      if (deps.focusedEdt) {
        await deps.logEdtAction(deps.focusedEdt.ulid, 'modify', 'failed', result.error.message);
      }
    }
  }

  // Opens the shared branch-picker over `repoPath`. `hasCurrentBranch`/`currentBranch` come from
  // this EDT's own membership — an existing member offers Rename current (pre-selected onto its
  // own branch); a not-yet-member candidate (newly checked in the checklist) never does.
  function openBranchPickerForModify(
    current: ModifyDialogState,
    repoPath: string,
    options: { retry?: { field: 'create-name' | 'rename'; value: string; oldName?: string }; autoSubmitOnConfirm?: boolean } = {},
  ) {
    const member = current.target.members.find((candidate) => candidate.repoPath === repoPath);
    const hasCurrentBranch = member !== undefined;
    const currentBranch = member?.branch ?? '';
    const suggestion =
      current.branchEdits[repoPath] ?? current.branchRenames[repoPath] ?? currentBranch ?? suggestBranchForNewMember(current.target.members, current.topic);
    // The picker's "Create new" default base branch is this repo's manifest sharedBranch
    // (deps.candidates carries it), never DEFAULT_BASE_BRANCH. If the candidate lookup misses
    // (e.g. candidates still loading), fall back to the member's current branch rather than '' —
    // this dialog's "Create new" confirm really does perform a git write.
    const defaultBaseBranch = deps.candidates.find((candidate) => candidate.path === repoPath)?.sharedBranch || currentBranch;
    const session = createPickerSession(repoPath, {
      suggestedName: suggestion,
      defaultBaseBranch,
      hasCurrentBranch,
      currentBranch,
      retry: options.retry,
      autoSubmitOnConfirm: options.autoSubmitOnConfirm,
    });
    deps.setDialog((prev) => (prev.kind === 'modify' ? { ...prev, branchPicker: session } : prev));
  }

  // Applies a confirmed BranchPickerOutcome for Modify's per-member step. Modify only *stages*
  // the result — other members may still need checking/unchecking before submit — except when
  // this session was opened by the "try a different name/branch" retry action, which re-runs
  // submitModify immediately (not a full-dialog restart).
  //
  // 'rename' on an *existing* member stages into branchRenames only (modifyEdt's renameBranches
  // step both renames the ref and records the new branch — branchEdits must never also carry it,
  // or step 3's setBranches would check out a branch that no longer exists by the old name before
  // step 4 renamed it). 'rename' on a not-yet-member candidate has no registered branch for
  // renameBranches to resolve, so it is applied eagerly via renameMemberBranch, then staged into
  // branchEdits like any other setBranches target (a brand-new member still needs a checkout).
  async function stageModifyBranchPickerOutcome(current: ModifyDialogState, repoPath: string, outcome: BranchPickerOutcome) {
    const session = current.branchPicker;
    const autoSubmit = session?.autoSubmitOnConfirm ?? false;

    const finish = (branchEdits: Record<string, string>, branchRenames: Record<string, string>) => {
      deps.setDialog((prev) => (prev.kind === 'modify' ? { ...prev, branchEdits, branchRenames, branchPicker: null } : prev));
      if (autoSubmit) {
        void submitModify({ ...current, branchEdits, branchRenames, branchPicker: null });
      }
    };
    const fail = (message: string) => {
      deps.setDialog((prev) =>
        prev.kind === 'modify' && prev.branchPicker !== null
          ? { ...prev, branchPicker: { ...prev.branchPicker, state: { ...prev.branchPicker.state, error: message } } }
          : prev,
      );
    };
    // branchEdits/branchRenames are siblings that must never both carry the same repoPath (see
    // the field comments above) — staging into one always clears any stale entry in the other,
    // so re-opening the picker for the same repo and staging a different-kind outcome can't
    // leave both maps populated for it.
    const withoutRepoPath = (record: Readonly<Record<string, string>>): Record<string, string> => {
      if (!(repoPath in record)) {
        return record;
      }
      const next = { ...record };
      delete next[repoPath];
      return next;
    };

    if (outcome.kind === 'set') {
      finish({ ...current.branchEdits, [repoPath]: outcome.branch }, withoutRepoPath(current.branchRenames));
      return;
    }
    if (outcome.kind === 'create') {
      const created = await deps.createMemberBranchAction(repoPath, outcome.branchName, outcome.baseBranch);
      if (!created.ok) {
        fail(created.error.message);
        return;
      }
      finish({ ...current.branchEdits, [repoPath]: outcome.branchName }, withoutRepoPath(current.branchRenames));
      return;
    }
    // outcome.kind === 'rename'
    const isExistingMember = current.target.members.some((member) => member.repoPath === repoPath);
    if (isExistingMember) {
      finish(withoutRepoPath(current.branchEdits), { ...current.branchRenames, [repoPath]: outcome.newName });
      return;
    }
    const renamed = await deps.renameBranchAction(repoPath, outcome.oldName, outcome.newName);
    if (!renamed.ok) {
      fail(renamed.error.message);
      return;
    }
    finish({ ...current.branchEdits, [repoPath]: outcome.newName }, withoutRepoPath(current.branchRenames));
  }

  function handleModifyBranchPickerInput(current: ModifyDialogState, session: BranchPickerSession, input: string, key: Key) {
    const otherMemberBranches = Array.from(new Set(current.target.members.map((member) => member.branch)));
    const result = handleBranchPickerKey(session.state, session.branches, otherMemberBranches, input, key, session.branchesStatus);
    if (result.type === 'cancel') {
      deps.setDialog((prev) => (prev.kind === 'modify' ? { ...prev, branchPicker: null } : prev));
      return;
    }
    if (result.type === 'submit') {
      void stageModifyBranchPickerOutcome(current, session.repoPath, result.outcome);
      return;
    }
    deps.setDialog((prev) =>
      prev.kind === 'modify' && prev.branchPicker !== null ? { ...prev, branchPicker: { ...prev.branchPicker, state: result.state } } : prev,
    );
  }

  function handleModifyDialogInput(current: ModifyDialogState, input: string, key: Key) {
    if (current.branchPicker !== null) {
      handleModifyBranchPickerInput(current, current.branchPicker, input, key);
      return;
    }
    // "Try a different branch"/"try a different name": an Enter while a failedRows row carries a
    // registered action reopens the branch picker over that repoPath, pre-filled from the value
    // that just got rejected; confirming re-runs submitModify via the autoSubmit path, never a
    // full-dialog restart. Takes priority over the form's other Enter handling whenever a
    // resolvable failure is showing, since retrying it is the only sensible next step.
    if (key.return && !current.submitting) {
      const retryRow = findRetryableFailedRow(current.failedRows);
      if (retryRow !== undefined) {
        const repoPath =
          deps.candidates.find((candidate) => candidate.service === retryRow.service)?.path ??
          current.target.members.find((member) => member.service === retryRow.service)?.repoPath;
        if (repoPath !== undefined) {
          // branchEdits/branchRenames are mutually exclusive per repoPath (see
          // stageModifyBranchPickerOutcome) — a populated branchRenames entry means the failed
          // attempt was a 'rename' outcome, so retry must reopen onto the rename field (not
          // Create-new, which would try to *create* a branch instead of renaming one).
          const failedRename = current.branchRenames[repoPath];
          const retry =
            failedRename !== undefined
              ? {
                  field: 'rename' as const,
                  value: failedRename,
                  oldName: current.target.members.find((member) => member.repoPath === repoPath)?.branch,
                }
              : { field: 'create-name' as const, value: current.branchEdits[repoPath] ?? '' };
          openBranchPickerForModify(current, repoPath, {
            retry,
            autoSubmitOnConfirm: true,
          });
          return;
        }
      }
    }
    const formStep = resolveFocusStep(input, key, FORM_FOCUS_NAV.mode);
    if (formStep !== null) {
      deps.setDialog((prev) => (prev.kind === 'modify' ? { ...prev, formFocus: cycleFormFocus(prev.formFocus, formStep) } : prev));
      return;
    }
    if (key.escape) {
      if (!current.submitting) {
        deps.setDialog({ kind: 'none' });
        deps.setCurrentEdtAction(null);
      }
      return;
    }
    if (current.formFocus === 'members') {
      const jump = resolveSelectionJump(key);
      if (jump !== null) {
        deps.setDialog((prev) => (prev.kind === 'modify' ? { ...prev, memberCursor: jumpSelection(jump, deps.candidates.length) } : prev));
        return;
      }
      const direction = resolveSelectionDirection(key);
      if (direction !== null) {
        deps.setDialog((prev) =>
          prev.kind === 'modify' ? { ...prev, memberCursor: moveSelection(prev.memberCursor, direction, deps.candidates.length) } : prev,
        );
        return;
      }
      if (input === ' ') {
        const path = deps.candidates[current.memberCursor]?.path;
        if (path !== undefined) {
          deps.setDialog((prev) => {
            if (prev.kind !== 'modify') {
              return prev;
            }
            const nextSelected = toggleMemberSelection(prev.selectedMembers, path);
            // Newly checking a not-yet-member candidate auto-stages a suggested branch (never
            // overwriting one already staged, e.g. from an earlier check/edit/uncheck/re-check)
            // so the mandatory-branch confirm guard below always has something real to validate.
            const isNewlyChecked = !prev.selectedMembers.includes(path) && nextSelected.includes(path);
            const isNotYetMember = !prev.target.members.some((member) => member.repoPath === path);
            const nextBranchEdits =
              isNewlyChecked && isNotYetMember && prev.branchEdits[path] === undefined
                ? { ...prev.branchEdits, [path]: suggestBranchForNewMember(prev.target.members, prev.topic) }
                : prev.branchEdits;
            return { ...prev, selectedMembers: nextSelected, branchEdits: nextBranchEdits };
          });
        }
        return;
      }
      if (key.return) {
        const path = deps.candidates[current.memberCursor]?.path;
        const originalMemberPaths = new Set(current.target.members.map((member) => member.repoPath));
        const action = resolveModifyEnterAction('members', current.selectedMembers, path, originalMemberPaths);
        if (action.type === 'edit-branch') {
          openBranchPickerForModify(current, action.repoPath);
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
    deps.setDialog((prev) => {
      if (prev.kind !== 'modify') {
        return prev;
      }
      const next = nextTextInputValue({ value: prev.topic, cursor: prev.topicCursor }, input, key);
      return { ...prev, topic: next.value, topicCursor: next.cursor };
    });
  }

  return { handleModifyDialogInput };
}

// While a branch-picker session is open, the title names the service it's for — otherwise it's
// easy to lose track of which member the picker is editing. Lookup order: candidates, then
// existing members (both resolve to the same `service` for an existing member).
function resolveModifyDialogTitle(dialog: ModifyDialogState, candidates: readonly ServiceBranchDivergence[]): string {
  if (dialog.branchPicker === null) {
    return 'MODIFY EDT';
  }
  const branchPicker = dialog.branchPicker;
  const branchPickerService =
    candidates.find((candidate) => candidate.path === branchPicker.repoPath)?.service ??
    dialog.target.members.find((member) => member.repoPath === branchPicker.repoPath)?.service;
  return branchPickerService !== undefined ? `MODIFY EDT — branch for ${branchPickerService}` : 'MODIFY EDT';
}

export function ModifyDialogView({
  dialog,
  candidates,
  candidateState,
  maxRows,
}: {
  dialog: ModifyDialogState;
  candidates: readonly ServiceBranchDivergence[];
  candidateState: CandidateListState;
  maxRows: number;
}) {
  const title = resolveModifyDialogTitle(dialog, candidates);
  return (
    <ModalDialog title={title} open={true}>
      <Box flexDirection="column">
        {dialog.branchPicker !== null ? (
          <BranchPicker
            state={dialog.branchPicker.state}
            branches={dialog.branchPicker.branches}
            branchesStatus={dialog.branchPicker.branchesStatus}
            otherMemberBranches={Array.from(new Set(dialog.target.members.map((member) => member.branch)))}
            maxRows={maxRows}
          />
        ) : (
          <>
            <TextInputLine label="Topic" value={dialog.topic} cursor={dialog.topicCursor} focused={dialog.formFocus === 'topic'} />
            {candidateState === 'loading' ? <StateLine kind="loading" subject="services" /> : null}
            {candidateState === 'empty' ? <StateLine kind="empty" subject="registered services" text="No registered services available." /> : null}
            {candidateState === 'ready'
              ? candidates.map((candidate, index) => {
                  const branch =
                    dialog.branchRenames[candidate.path] ??
                    dialog.branchEdits[candidate.path] ??
                    dialog.target.members.find((member) => member.repoPath === candidate.path)?.branch;
                  return (
                    <Box key={candidate.path}>
                      <Text color={colors.accent} wrap="truncate-end">{dialog.formFocus === 'members' && index === dialog.memberCursor ? '›' : ' '}</Text>
                      <CheckboxListItem
                        label={candidate.service}
                        state={dialog.selectedMembers.includes(candidate.path) ? 'checked' : 'unchecked'}
                        meta={branch}
                      />
                    </Box>
                  );
                })
              : null}
            {dialog.failedRows.length > 0 ? <FailedResultList rows={dialog.failedRows} /> : dialog.error ? <DimAnnotation text={dialog.error} /> : null}
            {dialog.submitting ? <DimAnnotation text="Saving…" /> : null}
          </>
        )}
      </Box>
    </ModalDialog>
  );
}
