// tui/zones/edts/dialogs: the SWITCH EDT confirm dialog — a confirm/force-confirm/cancel prompt,
// the dirty-service resolution view (switch-resolution/) shown while the core switch is parked
// on the edt-slice seam, and a per-repo results summary kept open after an adopt/discard/failure.
import { Box, Text, type Key } from 'ink';
import type { EdtRegistryEntry } from '../../../../../../core/ports/edt-registry.js';
import type { SwitchDirtyRepo, SwitchEdtRepoResult } from '../../../../../../core/edt/switch.js';
import type { AppState } from '../../../store/app-store.js';
import { DimAnnotation } from '../../../shared/components/dim-annotation.js';
import { FailedResultList } from '../../../shared/components/failed-result-list.js';
import { ModalDialog } from '../../../shared/components/modal-dialog.js';
import { colors } from '../../../shared/theme/theme.js';
import {
  initialSwitchDialog,
  isSwitchBlockedError,
  stripAssistedActionCodes,
  summarizeFailedResults,
  type EdtDialogState,
  type SwitchDialogState,
} from '../edts-zone.logic.js';
import { SwitchResolutionView } from './switch-resolution/switch-resolution-view.js';
import { describeSwitchForLog, needsResultsView, reduceSwitchResolutionKey } from './switch-resolution/switch-resolution.logic.js';

export type SwitchDialogDeps = {
  setDialog: (updater: EdtDialogState | ((prev: EdtDialogState) => EdtDialogState)) => void;
  switchEdtAction: AppState['switchEdt'];
  loadEdts: AppState['loadEdts'];
  loadEdtsBranches: AppState['loadEdtsBranches'];
  logEdtAction: AppState['logEdtAction'];
  setCurrentEdtAction: AppState['setCurrentEdtAction'];
  focusedEdt: EdtRegistryEntry | undefined;
  // The dirty-repo seam (edt-slice.ts) — non-null while switchEdtAction is paused waiting for a
  // SwitchDirtyReposChoice on the batch of dirty repos. Owned by the store (not local dialog
  // state), like UpdateSlice's updateBlocker: the seam callback that sets it lives inside the
  // store action, not this component.
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
      // Structured rows — switchActiveEdt carries no per-member branch override, so no row here
      // ever gets a retry action wired, even one whose code is branch-owned-by-other-edt.
      // stripAssistedActionCodes enforces that at render time too, not just in the key
      // dispatcher.
      const { results } = result.data;
      const failedRows = stripAssistedActionCodes(summarizeFailedResults(results));
      // The entry goes to the NEW active EDT's log and records the adopted branches and discarded
      // paths alongside any failure.
      const detail = describeSwitchForLog(current.target.topic, force, results);
      if (needsResultsView(results)) {
        // Adopted/discarded/failed rows keep the dialog open on the results summary.
        deps.setDialog((prev) => (prev.kind === 'switch-confirm' ? { ...prev, submitting: false, resolution: null, failedRows, results } : prev));
        await deps.logEdtAction(result.data.ulid, 'switch', failedRows.length > 0 ? 'failed' : 'success', detail);
        return;
      }
      deps.setDialog({ kind: 'none' });
      await deps.logEdtAction(result.data.ulid, 'switch', 'success', detail);
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
    deps.setDialog((prev) => (prev.kind === 'switch-confirm' ? { ...prev, submitting: false, resolution: null, error: result.error.message } : prev));
    // A switch that did not happen (refused, cancelled, errored) is logged against the
    // focused EDT, not a new active one — there is none.
    if (deps.focusedEdt) {
      await deps.logEdtAction(deps.focusedEdt.ulid, 'switch', 'failed', result.error.message);
    }
  }

  function handleSwitchDialogInput(current: SwitchDialogState, input: string, key: Key) {
    // The results summary is read-only — Enter/Esc close it.
    if (current.results !== undefined) {
      if (key.return || key.escape) {
        deps.setDialog({ kind: 'none' });
        deps.setCurrentEdtAction(null);
      }
      return;
    }
    // While the dirty-repo seam is raised, the resolution view owns every keystroke. The key is
    // reduced against the latest state (inside the updater, so keys arriving in one input chunk
    // each see the previous key's result); a decision it raises is dispatched to the parked core
    // call by dispatchResolutionDecision (the zone's effect), never from inside the updater.
    const dirty = deps.switchDirtyRepos;
    if (dirty !== null) {
      if (current.resolution === null) {
        // Not initialized yet (the zone's effect runs after this render): Esc still cancels.
        if (key.escape) {
          deps.resolveSwitchDirtyRepos({ kind: 'cancel' });
        }
        return;
      }
      deps.setDialog((prev) =>
        prev.kind === 'switch-confirm' && prev.resolution !== null
          ? { ...prev, resolution: reduceSwitchResolutionKey(prev.resolution, dirty, input, key) }
          : prev,
      );
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

  // Hands the resolution view's decision (proceed with the resolutions, or cancel) to the parked
  // core switch. The zone's effect calls it once per decision; the draft stays in place (the
  // reducer ignores keys once decided) until the switch result clears it, so the view's
  // initializing effect can never re-open it for the same seam.
  function dispatchResolutionDecision(current: SwitchDialogState) {
    const decision = current.resolution?.decision;
    if (decision === undefined || decision === null) {
      return;
    }
    deps.resolveSwitchDirtyRepos(decision);
  }

  // The create wizard's "switch now" handoff — replaces whatever dialog is open with the switch
  // dialog on `target` and runs the protected switch at once (no extra confirm: the wizard's
  // Enter was it). Its blocked prompt, resolution view, results and logging then apply unchanged.
  function startSwitch(target: EdtRegistryEntry) {
    const dialog = initialSwitchDialog(target);
    deps.setDialog(dialog);
    void handleSwitchConfirm(dialog, false);
  }

  return { handleSwitchDialogInput, dispatchResolutionDecision, startSwitch };
}

// The per-repo outcome summary of a switch that adopted, discarded or failed something —
// failures render through the shared FailedResultList.
function resultLabel(row: SwitchEdtRepoResult): string | null {
  switch (row.outcome) {
    case 'adopted':
      return `✔ ${row.service} — adopted on ${row.detail?.adoptedBranch ?? '?'}`;
    case 'discarded':
      return `✔ ${row.service} — overwritten (${row.detail?.discardedPaths?.length ?? 0} file(s))`;
    case 'switched':
      return `✔ ${row.service} — switched`;
    case 'failed':
      return null;
  }
}

function SwitchResultsView({ dialog, results }: { dialog: SwitchDialogState; results: readonly SwitchEdtRepoResult[] }) {
  return (
    <>
      {results.some((row) => row.outcome === 'failed') ? (
        <Text color={colors.warning}>Switch to “{dialog.target.topic}” finished with failures.</Text>
      ) : (
        <Text color={colors.text}>Switch to “{dialog.target.topic}” finished.</Text>
      )}
      {results.map((row, index) => {
        const label = resultLabel(row);
        return label !== null ? (
          <Text key={`${row.service}:${index}`} color={row.outcome === 'switched' ? colors['text-dim'] : colors.success} wrap="truncate-end">
            {'  '}
            {label}
          </Text>
        ) : null;
      })}
      {dialog.failedRows.length > 0 ? <FailedResultList rows={dialog.failedRows} /> : null}
    </>
  );
}

export function SwitchDialogView({
  dialog,
  switchDirtyRepos,
  maxVisibleRows,
}: {
  dialog: SwitchDialogState;
  switchDirtyRepos: SwitchDirtyRepo[] | null;
  // The resolution view's table / file-list height budget (NFR-7).
  maxVisibleRows: number;
}) {
  if (dialog.results !== undefined) {
    return (
      <ModalDialog title="SWITCH EDT" open={true}>
        <Box flexDirection="column">
          <SwitchResultsView dialog={dialog} results={dialog.results} />
        </Box>
      </ModalDialog>
    );
  }
  return (
    <ModalDialog title="SWITCH EDT" open={true}>
      <Box flexDirection="column">
        {switchDirtyRepos !== null ? (
          dialog.resolution !== null ? (
            <SwitchResolutionView state={dialog.resolution} dirty={switchDirtyRepos} targetTopic={dialog.target.topic} maxVisibleRows={maxVisibleRows} />
          ) : (
            <DimAnnotation text="Preparing the resolution…" />
          )
        ) : dialog.blocked ? (
          <>
            <Text color={colors.warning}>Cannot switch away: an action is in progress on the current EDT.</Text>
          </>
        ) : (
          <>
            <Text color={colors.text}>Switch to "{dialog.target.topic}"?</Text>
          </>
        )}
        {dialog.failedRows.length > 0 ? <FailedResultList rows={dialog.failedRows} /> : dialog.error ? <DimAnnotation text={dialog.error} /> : null}
        {dialog.submitting && switchDirtyRepos === null ? <DimAnnotation text="Switching…" /> : null}
      </Box>
    </ModalDialog>
  );
}
