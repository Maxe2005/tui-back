// tui/zones/edts/dialogs: the SWITCH EDT confirm dialog — extracted from edts-zone.tsx (see
// that file's header for why). The simplest of the 5 dialogs: no branch picker, no member
// checklist, just a confirm/force-confirm/cancel prompt.
import { Box, Text, type Key } from 'ink';
import type { EdtRegistryEntry } from '../../../../../../core/ports/edt-registry.js';
import type { SwitchDirtyRepo } from '../../../../../../core/edt/switch.js';
import type { AppState } from '../../../store/app-store.js';
import { DimAnnotation } from '../../../shared/components/dim-annotation.js';
import { FailedResultList } from '../../../shared/components/failed-result-list.js';
import { ModalDialog } from '../../../shared/components/modal-dialog.js';
import { colors } from '../../../shared/theme/theme.js';
import { isSwitchBlockedError, stripAssistedActionCodes, summarizeFailedResults, type EdtDialogState, type SwitchDialogState } from '../edts-zone.logic.js';

export type SwitchDialogDeps = {
  setDialog: (updater: EdtDialogState | ((prev: EdtDialogState) => EdtDialogState)) => void;
  switchEdtAction: AppState['switchEdt'];
  loadEdts: AppState['loadEdts'];
  loadEdtsBranches: AppState['loadEdtsBranches'];
  logEdtAction: AppState['logEdtAction'];
  setCurrentEdtAction: AppState['setCurrentEdtAction'];
  focusedEdt: EdtRegistryEntry | undefined;
  // The dirty-repo seam (edt-slice.ts) — non-null while switchEdtAction is paused waiting for
  // a SwitchDirtyReposChoice on the batch of dirty repos (story 2.39). Owned by the store (not local dialog state) for the same reason
  // UpdateSlice's updateBlocker is: the seam callback that sets it lives inside the store
  // action, not this component.
  switchDirtyRepos: AppState['switchDirtyRepos'];
  resolveSwitchDirtyRepos: AppState['resolveSwitchDirtyRepos'];
};

export function createSwitchDialogHandlers(deps: SwitchDialogDeps) {
  async function handleSwitchConfirm(current: SwitchDialogState, force: boolean) {
    // Guard against re-entrancy the same way handleCreateSubmit/handleModifySubmit already do.
    if (current.submitting) {
      return;
    }
    deps.setDialog((prev) => (prev.kind === 'switch-confirm' ? { ...prev, submitting: true, error: null, failedRows: [] } : prev));
    const result = await deps.switchEdtAction({ topic: current.target.topic, force });
    if (result.ok) {
      void deps.loadEdts();
      void deps.loadEdtsBranches();
      // Story 2.25: structured rows — Never boundary: switchActiveEdt carries no per-member
      // branch override, so no row here ever gets a retry action wired, even one whose code
      // happens to be branch-owned-by-other-edt (AC2's "no registered action" treatment).
      // stripAssistedActionCodes enforces that at render time too, not just in the key
      // dispatcher.
      const failedRows = stripAssistedActionCodes(summarizeFailedResults(result.data.results));
      if (failedRows.length > 0) {
        deps.setDialog((prev) => (prev.kind === 'switch-confirm' ? { ...prev, submitting: false, failedRows } : prev));
        // Log failed action
        if (deps.focusedEdt) {
          await deps.logEdtAction(deps.focusedEdt.ulid, 'switch', 'failed', failedRows.map((row) => row.message).join('; '));
        }
        return;
      }
      deps.setDialog({ kind: 'none' });
      // Log successful action
      if (deps.focusedEdt) {
        await deps.logEdtAction(deps.focusedEdt.ulid, 'switch', 'success', `Switched to EDT "${current.target.topic}"${force ? ' (forced)' : ''}`);
      }
      return;
    }
    // switch-blocked-action-in-progress is surfaced as an explicit block/prompt
    // (force-or-cancel); any other failure stays in switch-confirm with the error shown
    // inline — never a silent return to the EDT list.
    if (!force && isSwitchBlockedError(result.error.code)) {
      deps.setDialog((prev) =>
        prev.kind === 'switch-confirm' ? { ...prev, submitting: false, blocked: true, error: result.error.message } : prev,
      );
      return;
    }
    deps.setDialog((prev) => (prev.kind === 'switch-confirm' ? { ...prev, submitting: false, error: result.error.message } : prev));
    // Log failed action
    if (deps.focusedEdt) {
      await deps.logEdtAction(deps.focusedEdt.ulid, 'switch', 'failed', result.error.message);
    }
  }

  function handleSwitchDialogInput(current: SwitchDialogState, _input: string, key: Key) {
    // While the dirty-repo preview is raised, it owns every keystroke. Story 2.39 (interim,
    // until story 2.41's per-service resolution dialog): the preview never proceeds — Enter
    // and Esc both cancel the whole switch with nothing touched, since uncommitted work
    // outside the outgoing EDT may only move under an explicit adopt/discard resolution.
    if (deps.switchDirtyRepos !== null) {
      if (key.return || key.escape) {
        deps.resolveSwitchDirtyRepos({ kind: 'cancel' });
      }
      return;
    }
    if (key.escape) {
      if (!current.submitting) {
        deps.setDialog({ kind: 'none' });
        deps.setCurrentEdtAction(null);
      }
      return;
    }
    if (key.return) {
      void handleSwitchConfirm(current, current.blocked);
    }
  }

  return { handleSwitchDialogInput };
}

// Story 2.39 (interim): the dirty preview shown while switchDirtyRepos is raised. The seam is
// only raised when a service outside the outgoing EDT (state 2/3) holds uncommitted work —
// work the switch refuses to move without an explicit adopt/discard resolution, which this
// interim preview cannot collect yet (story 2.41). It explains the block and lists the
// blocking services (scope, current branch); state-1 rows (the outgoing EDT's own work) are
// marked as auto-stashed for information.
function scopeLabel(repo: SwitchDirtyRepo): string {
  if (repo.scope === 'member-of-other-edt') {
    return repo.owningEdtTopics.length > 0 ? `membre de l'EDT ${repo.owningEdtTopics.join(', ')}` : 'membre d\'un autre EDT';
  }
  return 'hors de tout EDT';
}

function DirtyReposPreview({ dirty }: { dirty: readonly SwitchDirtyRepo[] }) {
  const blocking = dirty.filter((repo) => repo.scope !== 'outgoing-member');
  const autoStashed = dirty.filter((repo) => repo.scope === 'outgoing-member');
  return (
    <Box flexDirection="column">
      <Text color={colors.warning}>Bascule bloquée : ces services ont des modifications non commitées alors qu'ils ne sont pas membres de l'EDT sortant.</Text>
      {blocking.map((repo) => (
        <Text key={repo.repoPath} color={colors.text}>
          {'  '}• {repo.service} — {scopeLabel(repo)}, branche {repo.currentBranch}
        </Text>
      ))}
      <Text color={colors.text}>Pour l'instant, commitez-les ou mettez-les de côté (git stash) à la main, puis relancez la bascule.</Text>
      {autoStashed.map((repo) => (
        <Text key={repo.repoPath} color={colors['text-dim']}>
          {'  '}• {repo.service} — mis de côté automatiquement
        </Text>
      ))}
      <Text color={colors.text}>[Enter] / [Esc] annuler la bascule (rien n'est modifié)</Text>
    </Box>
  );
}

export function SwitchDialogView({ dialog, switchDirtyRepos }: { dialog: SwitchDialogState; switchDirtyRepos: SwitchDirtyRepo[] | null }) {
  return (
    <ModalDialog title="SWITCH EDT" onConfirm={() => {}} onCancel={() => {}} open={true}>
      <Box flexDirection="column">
        {switchDirtyRepos !== null ? (
          <DirtyReposPreview dirty={switchDirtyRepos} />
        ) : dialog.blocked ? (
          <>
            <Text color={colors.warning}>Cannot switch away: an action is in progress on the current EDT.</Text>
            <Text color={colors.text}>[Enter] force switch anyway  [Esc] cancel</Text>
          </>
        ) : (
          <>
            <Text color={colors.text}>Switch to "{dialog.target.topic}"?</Text>
            <Text color={colors.text}>[Enter] confirm  [Esc] cancel</Text>
          </>
        )}
        {dialog.failedRows.length > 0 ? <FailedResultList rows={dialog.failedRows} /> : dialog.error ? <DimAnnotation text={dialog.error} /> : null}
        {dialog.submitting && switchDirtyRepos === null ? <DimAnnotation text="Switching…" /> : null}
      </Box>
    </ModalDialog>
  );
}
