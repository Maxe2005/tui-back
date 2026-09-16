// tui/zones/edts/dialogs: the EDT SERVICES row contextual menu ("Remove from EDT" / "Change
// branch for this EDT" / disabled "Restart") opened by Enter — extracted from edts-zone.tsx
// (see that file's header for why).
import { Box, Text, type Key } from 'ink';
import type { AppState } from '../../../store/app-store.js';
import { BranchPicker, handleBranchPickerKey, type BranchPickerOutcome } from '../../../shared/components/branch-picker.js';
import { DimAnnotation } from '../../../shared/components/dim-annotation.js';
import { FailedResultList, type FailedResultRow } from '../../../shared/components/failed-result-list.js';
import { ListRow } from '../../../shared/components/list-row.js';
import { ModalDialog } from '../../../shared/components/modal-dialog.js';
import { colors } from '../../../shared/theme/theme.js';
import {
  createPickerSession,
  findRetryableFailedRow,
  jumpSelection,
  moveSelection,
  resolveSelectionDirection,
  resolveSelectionJump,
  SERVICE_ACTION_MENU_ITEMS,
  summarizeFailedResults,
  type EdtDialogState,
  type ServiceActionsDialogState,
} from '../edts-zone.logic.js';

export type ServiceActionsDialogDeps = {
  setDialog: (updater: EdtDialogState | ((prev: EdtDialogState) => EdtDialogState)) => void;
  modifyEdtAction: AppState['modifyEdt'];
  loadEdts: AppState['loadEdts'];
  loadEdtsBranches: AppState['loadEdtsBranches'];
  logEdtAction: AppState['logEdtAction'];
  createMemberBranchAction: AppState['createMemberBranch'];
};

export function createServiceActionsDialogHandlers(deps: ServiceActionsDialogDeps) {
  // Story 2.18: EDT SERVICES row contextual menu — "Remove from EDT" ------------------------
  async function submitRemoveFromEdt(current: ServiceActionsDialogState) {
    if (current.submitting) {
      return;
    }
    deps.setDialog((prev) => (prev.kind === 'service-actions' ? { ...prev, submitting: true, error: null, failedRows: [] } : prev));
    const result = await deps.modifyEdtAction({ topic: current.edt.topic, addMembers: [], removeMembers: [current.repoPath], setBranches: [] });
    if (result.ok) {
      void deps.loadEdts();
      void deps.loadEdtsBranches();
      // Story 2.25: structured rows — Never boundary: remove-from-edt never touches a
      // branch, so a row here never carries branch-owned-by-other-edt in practice (and even
      // if it somehow did, this call site never wires a retry action for it).
      const failedRows = summarizeFailedResults(result.data.results);
      if (failedRows.length > 0) {
        deps.setDialog((prev) => (prev.kind === 'service-actions' ? { ...prev, submitting: false, failedRows } : prev));
        await deps.logEdtAction(current.edt.ulid, 'modify', 'failed', failedRows.map((row) => row.message).join('; '));
        return;
      }
      deps.setDialog({ kind: 'none' });
      await deps.logEdtAction(current.edt.ulid, 'modify', 'success', `Removed ${current.serviceName} from EDT "${current.edt.topic}"`);
      return;
    }
    deps.setDialog((prev) => (prev.kind === 'service-actions' ? { ...prev, submitting: false, error: result.error.message } : prev));
    await deps.logEdtAction(current.edt.ulid, 'modify', 'failed', result.error.message);
  }

  // Story 2.18: EDT SERVICES row contextual menu — "Change branch for this EDT" -------------
  // Story 2.26: applies a confirmed BranchPickerOutcome for Service-actions' "Change branch for
  // this EDT" — always an *existing* member (this menu only opens from an EDT-services row), so
  // a 'rename' outcome always routes through modifyEdt's own renameBranches param, never a
  // direct pre-step. 'create' still needs its own eager pre-step (branch creation has no
  // membership semantics of its own — Design Notes) before the usual setBranches submit; a
  // pre-step failure folds into this same failedRows/FailedResultList display, never a second
  // error UI (Boundaries), by synthesizing the row directly instead of calling modifyEdtAction.
  async function submitServiceActionsBranchOutcome(current: ServiceActionsDialogState, outcome: BranchPickerOutcome) {
    if (current.submitting) {
      return;
    }
    const attempted = outcome.kind === 'rename' ? outcome.newName : outcome.kind === 'create' ? outcome.branchName : outcome.branch;
    const attemptedRenameOldName = outcome.kind === 'rename' ? outcome.oldName : null;
    deps.setDialog((prev) =>
      prev.kind === 'service-actions'
        ? { ...prev, submitting: true, error: null, failedRows: [], lastAttemptedBranch: attempted, lastAttemptedRenameOldName: attemptedRenameOldName }
        : prev,
    );

    if (outcome.kind === 'create') {
      const created = await deps.createMemberBranchAction(current.repoPath, outcome.branchName, outcome.baseBranch);
      if (!created.ok) {
        const failedRows: FailedResultRow[] = [{ service: current.serviceName, code: created.error.code, message: created.error.message }];
        deps.setDialog((prev) => (prev.kind === 'service-actions' ? { ...prev, submitting: false, branchPicker: null, failedRows } : prev));
        await deps.logEdtAction(current.edt.ulid, 'modify', 'failed', created.error.message);
        return;
      }
    }

    const result = await deps.modifyEdtAction({
      topic: current.edt.topic,
      addMembers: [],
      removeMembers: [],
      setBranches: outcome.kind === 'rename' ? [] : [{ repoPath: current.repoPath, branch: attempted }],
      renameBranches: outcome.kind === 'rename' ? [{ repoPath: current.repoPath, newName: outcome.newName }] : [],
    });
    if (result.ok) {
      void deps.loadEdts();
      void deps.loadEdtsBranches();
      const failedRows = summarizeFailedResults(result.data.results);
      if (failedRows.length > 0) {
        deps.setDialog((prev) => (prev.kind === 'service-actions' ? { ...prev, submitting: false, branchPicker: null, failedRows } : prev));
        await deps.logEdtAction(current.edt.ulid, 'modify', 'failed', failedRows.map((row) => row.message).join('; '));
        return;
      }
      deps.setDialog({ kind: 'none' });
      await deps.logEdtAction(current.edt.ulid, 'modify', 'success', `Changed branch for ${current.serviceName} to "${attempted}"`);
      return;
    }
    deps.setDialog((prev) => (prev.kind === 'service-actions' ? { ...prev, submitting: false, branchPicker: null, error: result.error.message } : prev));
    await deps.logEdtAction(current.edt.ulid, 'modify', 'failed', result.error.message);
  }

  function openServiceActionsBranchPicker(
    current: ServiceActionsDialogState,
    options: { retry?: { field: 'create-name' | 'rename'; value: string; oldName?: string } } = {},
  ) {
    const currentBranch = current.edt.members.find((member) => member.repoPath === current.repoPath)?.branch ?? '';
    const session = createPickerSession(current.repoPath, {
      suggestedName: currentBranch,
      hasCurrentBranch: true,
      currentBranch,
      retry: options.retry,
    });
    deps.setDialog((prev) => (prev.kind === 'service-actions' ? { ...prev, branchPicker: session } : prev));
  }

  function handleServiceActionsBranchPickerInput(current: ServiceActionsDialogState, session: ServiceActionsDialogState['branchPicker'], input: string, key: Key) {
    if (session === null) {
      return;
    }
    if (key.escape && current.submitting) {
      // Review fix (story 2.18, carried over): never tear down the picker while a submit is
      // in flight.
      return;
    }
    const otherMemberBranches = Array.from(new Set(current.edt.members.map((member) => member.branch)));
    const result = handleBranchPickerKey(session.state, session.branches, otherMemberBranches, input, key);
    if (result.type === 'cancel') {
      deps.setDialog((prev) => (prev.kind === 'service-actions' ? { ...prev, branchPicker: null } : prev));
      return;
    }
    if (result.type === 'submit') {
      void submitServiceActionsBranchOutcome(current, result.outcome);
      return;
    }
    deps.setDialog((prev) =>
      prev.kind === 'service-actions' && prev.branchPicker !== null ? { ...prev, branchPicker: { ...prev.branchPicker, state: result.state } } : prev,
    );
  }

  // Boundary/Design Notes: the two new direct-action flows (this contextual menu's "Change
  // branch" and the Add-to-EDT dialog) open the branch picker straight from the row-level
  // Enter handler — they never route through resolveModifyEnterAction/canEditMemberBranch (the
  // big Modify dialog's own member-checklist Enter dispatch), so that check's existing
  // restriction (member of target EDT AND currently checked) simply doesn't apply here: it's
  // bypassed, not loosened.
  function handleServiceActionsInput(current: ServiceActionsDialogState, input: string, key: Key) {
    if (current.branchPicker !== null) {
      handleServiceActionsBranchPickerInput(current, current.branchPicker, input, key);
      return;
    }
    if (key.escape) {
      if (!current.submitting) {
        deps.setDialog({ kind: 'none' });
      }
      return;
    }
    // Story 2.25/2.26: "try a different branch"/"try a different name" — reopens the branch
    // picker pre-filled with `lastAttemptedBranch` (the value that just got rejected, tracked
    // separately since this dialog's own branchPicker sub-state is cleared once a submit is in
    // flight), rather than openServiceActionsBranchPicker's normal "still-current member
    // branch" pre-fill. Confirming it re-runs submitServiceActionsBranchOutcome via the same
    // picker dispatch above, unchanged — never a full-dialog restart. Takes priority over the
    // SERVICE_ACTION_MENU_ITEMS dispatch below whenever a resolvable failure is showing.
    if (key.return && !current.submitting) {
      const retryRow = findRetryableFailedRow(current.failedRows);
      if (retryRow !== undefined) {
        const retry =
          current.lastAttemptedRenameOldName !== null
            ? { field: 'rename' as const, value: current.lastAttemptedBranch ?? '', oldName: current.lastAttemptedRenameOldName }
            : { field: 'create-name' as const, value: current.lastAttemptedBranch ?? '' };
        openServiceActionsBranchPicker(current, { retry });
        return;
      }
    }
    const jump = resolveSelectionJump(key);
    if (jump !== null) {
      deps.setDialog((prev) => (prev.kind === 'service-actions' ? { ...prev, cursor: jumpSelection(jump, SERVICE_ACTION_MENU_ITEMS.length) } : prev));
      return;
    }
    const direction = resolveSelectionDirection(key);
    if (direction !== null) {
      deps.setDialog((prev) =>
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
        openServiceActionsBranchPicker(current);
      }
    }
  }

  return { handleServiceActionsInput };
}

export function ServiceActionsDialogView({ dialog }: { dialog: ServiceActionsDialogState }) {
  return (
    <ModalDialog title="SERVICE ACTIONS" onConfirm={() => {}} onCancel={() => {}} open={true}>
      <Box flexDirection="column">
        <Text color={colors.text}>{dialog.serviceName}</Text>
        {dialog.branchPicker !== null ? (
          <>
            <BranchPicker
              state={dialog.branchPicker.state}
              branches={dialog.branchPicker.branches}
              branchesStatus={dialog.branchPicker.branchesStatus}
              otherMemberBranches={Array.from(new Set(dialog.edt.members.map((member) => member.branch)))}
            />
            {dialog.failedRows.length > 0 ? <FailedResultList rows={dialog.failedRows} /> : dialog.error ? <DimAnnotation text={dialog.error} /> : null}
            {dialog.submitting ? <DimAnnotation text="Saving…" /> : null}
          </>
        ) : (
          <>
            {SERVICE_ACTION_MENU_ITEMS.map((item, index) => (
              <ListRow key={item.label} label={item.label} meta={item.disabled ? 'Available with Epic 5' : undefined} selected={index === dialog.cursor} />
            ))}
            {dialog.failedRows.length > 0 ? <FailedResultList rows={dialog.failedRows} /> : dialog.error ? <DimAnnotation text={dialog.error} /> : null}
            {dialog.submitting ? <DimAnnotation text="Working…" /> : null}
          </>
        )}
      </Box>
    </ModalDialog>
  );
}
