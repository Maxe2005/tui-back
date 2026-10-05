// tui/zones/edts/dialogs: the DELETE EDT confirm dialog with a per-member "delete this branch?"
// checklist. Two states have no confirm: `rejected` (opened against the active EDT — only the
// error and [Esc] render) and `memberRows === null` (the merge/clean statuses are still being
// fetched; a loading line stands in, Esc still cancels).
import { Box, Text, type Key } from 'ink';
import type { AppState } from '../../../store/app-store.js';
import { CheckboxListItem } from '../../../shared/components/checkbox-list-item.js';
import { DimAnnotation } from '../../../shared/components/dim-annotation.js';
import { FailedResultList } from '../../../shared/components/failed-result-list.js';
import { ModalDialog } from '../../../shared/components/modal-dialog.js';
import { colors } from '../../../shared/theme/theme.js';
import {
  buildDeleteMemberRows,
  formatDeleteMemberMeta,
  jumpSelection,
  moveSelection,
  resolveSelectionDirection,
  resolveSelectionJump,
  stripAssistedActionCodes,
  summarizeFailedResults,
  toggleDeleteDisposition,
  type DeleteDialogState,
  type EdtDialogState,
} from '../edts-zone.logic.js';

export type DeleteDialogDeps = {
  setDialog: (updater: EdtDialogState | ((prev: EdtDialogState) => EdtDialogState)) => void;
  deleteEdtAction: AppState['deleteEdt'];
  resolveMemberDeleteStatusesAction: AppState['resolveMemberDeleteStatuses'];
  loadEdts: AppState['loadEdts'];
  loadEdtsBranches: AppState['loadEdtsBranches'];
  setCurrentEdtAction: AppState['setCurrentEdtAction'];
};

export function createDeleteDialogHandlers(deps: DeleteDialogDeps) {
  // Fetches the per-member merge/clean statuses once, when the dialog opens with
  // memberRows === null (fetched on open, not continuously re-synced). Never fired for a
  // `rejected` dialog: there is nothing to disposition when delete was already refused.
  async function loadMemberStatuses(current: DeleteDialogState) {
    const statuses = await deps.resolveMemberDeleteStatusesAction(current.target.ulid, current.target.members);
    deps.setDialog((prev) =>
      prev.kind === 'delete-confirm' && prev.memberRows === null && prev.target.ulid === current.target.ulid
        ? { ...prev, memberRows: buildDeleteMemberRows(statuses) }
        : prev,
    );
  }

  async function submitDelete(current: DeleteDialogState) {
    if (current.submitting || current.rejected || current.memberRows === null) {
      return;
    }
    const dispositions: Record<string, 'leave' | 'delete'> = {};
    for (const row of current.memberRows) {
      dispositions[row.repoPath] = row.disposition;
    }
    deps.setDialog((prev) => (prev.kind === 'delete-confirm' ? { ...prev, submitting: true, error: null, failedRows: [] } : prev));
    const result = await deps.deleteEdtAction({ topic: current.target.topic, dispositions });
    if (result.ok) {
      void deps.loadEdts();
      void deps.loadEdtsBranches();
      // Structured rows for delete's per-branch collision reporting — but never a "try a
      // different branch" retry: there is no branch-edit sub-dialog to retry into, so
      // stripAssistedActionCodes (as in switch-dialog.tsx) enforces "no registered action".
      const failedRows = stripAssistedActionCodes(summarizeFailedResults(result.data.results));
      if (failedRows.length > 0) {
        // The EDT record and its SQLite file are already gone by the time any per-branch
        // failure can be reported (registry-entry removal always completes regardless of
        // per-member branch-deletion outcomes) — there is nothing left to log an action
        // against, so this dialog never calls logEdtAction.
        deps.setDialog((prev) => (prev.kind === 'delete-confirm' ? { ...prev, submitting: false, failedRows } : prev));
        return;
      }
      deps.setDialog({ kind: 'none' });
      return;
    }
    deps.setDialog((prev) => (prev.kind === 'delete-confirm' ? { ...prev, submitting: false, error: result.error.message } : prev));
  }

  function handleDeleteDialogInput(current: DeleteDialogState, input: string, key: Key) {
    if (key.escape) {
      if (!current.submitting) {
        deps.setDialog({ kind: 'none' });
        deps.setCurrentEdtAction(null);
      }
      return;
    }
    // A rejected (active-EDT) dialog never offers a confirm affordance — Esc above is the only
    // way out. Still-loading (memberRows === null) is likewise inert beyond Esc.
    if (current.rejected || current.memberRows === null || current.submitting) {
      return;
    }

    const jump = resolveSelectionJump(key);
    if (jump !== null) {
      deps.setDialog((prev) => (prev.kind === 'delete-confirm' ? { ...prev, memberCursor: jumpSelection(jump, current.memberRows?.length ?? 0) } : prev));
      return;
    }
    const direction = resolveSelectionDirection(key);
    if (direction !== null) {
      deps.setDialog((prev) =>
        prev.kind === 'delete-confirm' ? { ...prev, memberCursor: moveSelection(prev.memberCursor, direction, prev.memberRows?.length ?? 0) } : prev,
      );
      return;
    }
    if (input === ' ') {
      deps.setDialog((prev) =>
        prev.kind === 'delete-confirm' && prev.memberRows !== null
          ? { ...prev, memberRows: toggleDeleteDisposition(prev.memberRows, prev.memberCursor) }
          : prev,
      );
      return;
    }
    if (key.return) {
      void submitDelete(current);
    }
  }

  return { handleDeleteDialogInput, loadMemberStatuses };
}

export function DeleteDialogView({ dialog }: { dialog: DeleteDialogState }) {
  return (
    <ModalDialog title="DELETE EDT" onConfirm={() => {}} onCancel={() => {}} open={true}>
      <Box flexDirection="column">
        {dialog.rejected ? (
          <>
            <Text color={colors.error}>{dialog.error}</Text>
            <Text color={colors.text}>[Esc] cancel</Text>
          </>
        ) : dialog.memberRows === null ? (
          <DimAnnotation text="Loading member status…" />
        ) : (
          <>
            <Text color={colors.text}>Delete EDT "{dialog.target.topic}"?</Text>
            {dialog.memberRows.length === 0 ? (
              <Text color={colors['text-dim']}>No members — only the EDT record will be removed.</Text>
            ) : (
              dialog.memberRows.map((row, index) => (
                <Box key={row.repoPath}>
                  <Text color={colors.accent}>{index === dialog.memberCursor ? '›' : ' '}</Text>
                  <CheckboxListItem
                    label={row.service}
                    state={row.disposition === 'delete' ? 'checked' : 'unchecked'}
                    meta={formatDeleteMemberMeta(row)}
                  />
                </Box>
              ))
            )}
            <Text color={colors.text}>[Space] toggle delete  [Enter] confirm  [Esc] cancel</Text>
            {dialog.failedRows.length > 0 ? <FailedResultList rows={dialog.failedRows} /> : dialog.error ? <DimAnnotation text={dialog.error} /> : null}
            {dialog.submitting ? <DimAnnotation text="Deleting…" /> : null}
          </>
        )}
      </Box>
    </ModalDialog>
  );
}
