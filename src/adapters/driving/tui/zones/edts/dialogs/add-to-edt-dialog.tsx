// tui/zones/edts/dialogs: the OTHER SERVICES row's Add-to-EDT dialog opened by Enter —
// extracted from edts-zone.tsx (see that file's header for why).
import { Box, Text, type Key } from 'ink';
import type { AppState } from '../../../store/app-store.js';
import { BranchPicker, handleBranchPickerKey, type BranchPickerOutcome } from '../../../shared/components/branch-picker.js';
import { DimAnnotation } from '../../../shared/components/dim-annotation.js';
import { FailedResultList, type FailedResultRow } from '../../../shared/components/failed-result-list.js';
import { ModalDialog } from '../../../shared/components/modal-dialog.js';
import { colors } from '../../../shared/theme/theme.js';
import { summarizeFailedResults, type AddToEdtDialogState, type EdtDialogState } from '../edts-zone.logic.js';

export type AddToEdtDialogDeps = {
  setDialog: (updater: EdtDialogState | ((prev: EdtDialogState) => EdtDialogState)) => void;
  modifyEdtAction: AppState['modifyEdt'];
  loadEdts: AppState['loadEdts'];
  loadEdtsBranches: AppState['loadEdtsBranches'];
  logEdtAction: AppState['logEdtAction'];
  createMemberBranchAction: AppState['createMemberBranch'];
  renameBranchAction: AppState['renameBranch'];
};

export function createAddToEdtDialogHandlers(deps: AddToEdtDialogDeps) {
  // Story 2.26: never a member yet, so a 'rename' outcome can never route through modifyEdt's
  // own renameBranches param (nothing there to resolve `oldName` from) — it always takes the
  // direct renameMemberBranch pre-step instead, mirroring 'create's own eager pre-step.
  async function submitAddToEdtOutcome(current: AddToEdtDialogState, outcome: BranchPickerOutcome) {
    if (current.submitting) {
      return;
    }
    deps.setDialog((prev) => (prev.kind === 'add-to-edt' ? { ...prev, submitting: true, error: null, failedRows: [] } : prev));

    let branch: string;
    if (outcome.kind === 'set') {
      branch = outcome.branch;
    } else if (outcome.kind === 'create') {
      const created = await deps.createMemberBranchAction(current.repoPath, outcome.branchName, outcome.baseBranch);
      if (!created.ok) {
        const failedRows: FailedResultRow[] = [{ service: current.serviceName, code: created.error.code, message: created.error.message }];
        deps.setDialog((prev) => (prev.kind === 'add-to-edt' ? { ...prev, submitting: false, failedRows } : prev));
        await deps.logEdtAction(current.edt.ulid, 'modify', 'failed', created.error.message);
        return;
      }
      branch = outcome.branchName;
    } else {
      const renamed = await deps.renameBranchAction(current.repoPath, outcome.oldName, outcome.newName, current.edt.ulid);
      if (!renamed.ok) {
        const failedRows: FailedResultRow[] = [{ service: current.serviceName, code: renamed.error.code, message: renamed.error.message }];
        deps.setDialog((prev) => (prev.kind === 'add-to-edt' ? { ...prev, submitting: false, failedRows } : prev));
        await deps.logEdtAction(current.edt.ulid, 'modify', 'failed', renamed.error.message);
        return;
      }
      branch = outcome.newName;
    }

    const result = await deps.modifyEdtAction({
      topic: current.edt.topic,
      addMembers: [current.repoPath],
      removeMembers: [],
      setBranches: [{ repoPath: current.repoPath, branch }],
    });
    if (result.ok) {
      void deps.loadEdts();
      void deps.loadEdtsBranches();
      const failedRows = summarizeFailedResults(result.data.results);
      if (failedRows.length > 0) {
        deps.setDialog((prev) => (prev.kind === 'add-to-edt' ? { ...prev, submitting: false, failedRows } : prev));
        await deps.logEdtAction(current.edt.ulid, 'modify', 'failed', failedRows.map((row) => row.message).join('; '));
        return;
      }
      deps.setDialog({ kind: 'none' });
      await deps.logEdtAction(current.edt.ulid, 'modify', 'success', `Added ${current.serviceName} to EDT "${current.edt.topic}" on branch "${branch}"`);
      return;
    }
    deps.setDialog((prev) => (prev.kind === 'add-to-edt' ? { ...prev, submitting: false, error: result.error.message } : prev));
    await deps.logEdtAction(current.edt.ulid, 'modify', 'failed', result.error.message);
  }

  function handleAddToEdtInput(current: AddToEdtDialogState, input: string, key: Key) {
    if (current.submitting) {
      return;
    }
    // Story 2.25/2.26: "try a different branch"/"try a different name" — the picker's own
    // field is never cleared on failure (createPickerSession's suggestion/retry-prefill
    // persist across a failed submit), so retrying here is just the normal picker Enter flow;
    // nothing extra to wire, unlike Modify/service-actions (which reopen a fresh session).
    if (current.branchPicker === null) {
      return;
    }
    const otherMemberBranches = Array.from(new Set(current.edt.members.map((member) => member.branch)));
    const result = handleBranchPickerKey(current.branchPicker.state, current.branchPicker.branches, otherMemberBranches, input, key, current.branchPicker.owners);
    if (result.type === 'cancel') {
      deps.setDialog({ kind: 'none' });
      return;
    }
    if (result.type === 'submit') {
      void submitAddToEdtOutcome(current, result.outcome);
      return;
    }
    deps.setDialog((prev) =>
      prev.kind === 'add-to-edt' && prev.branchPicker !== null ? { ...prev, branchPicker: { ...prev.branchPicker, state: result.state } } : prev,
    );
  }

  return { handleAddToEdtInput };
}

export function AddToEdtDialogView({ dialog, maxRows }: { dialog: AddToEdtDialogState; maxRows: number }) {
  return (
    <ModalDialog title="ADD TO EDT" onConfirm={() => {}} onCancel={() => {}} open={true}>
      <Box flexDirection="column">
        <Text color={colors.text}>
          Add {dialog.serviceName} to "{dialog.edt.topic}"
        </Text>
        {dialog.branchPicker !== null ? (
          <BranchPicker
            state={dialog.branchPicker.state}
            branches={dialog.branchPicker.branches}
            branchesStatus={dialog.branchPicker.branchesStatus}
            owners={dialog.branchPicker.owners}
            otherMemberBranches={Array.from(new Set(dialog.edt.members.map((member) => member.branch)))}
            maxRows={maxRows}
          />
        ) : null}
        {dialog.failedRows.length > 0 ? <FailedResultList rows={dialog.failedRows} /> : dialog.error ? <DimAnnotation text={dialog.error} /> : null}
        {dialog.submitting ? <DimAnnotation text="Adding…" /> : null}
      </Box>
    </ModalDialog>
  );
}
