// tui/zones/edts: use-edts-handlers — builds each dialog's input/submit handlers from its own
// factory under dialogs/ (plain functions, no hooks: they close over this render's values, the
// deps object is recreated every render) plus the Enter-on-EDT opener.
import type { AppStore } from '../../../store/app-store.js';
import { createAddToEdtDialogHandlers } from '../dialogs/edt/add-to-edt-dialog.js';
import { createCreateWizardHandlers } from '../dialogs/create-wizard/create-wizard.js';
import { createDeleteDialogHandlers } from '../dialogs/edt/delete-dialog.js';
import { createModifyDialogHandlers } from '../dialogs/edt/modify-dialog.js';
import { createQuickPickDialogHandlers } from '../dialogs/actions/quick-pick-dialog.js';
import { createServiceActionsDialogHandlers } from '../dialogs/actions/service-actions-dialog.js';
import { createSwitchDialogHandlers } from '../dialogs/switch/switch-dialog.js';
import { isSystemEdt } from '../../../../../../core/edt/shared-edt/shared-edt.js';
import { initialFastForwardDialog, initialModifyDialog, initialSwitchDialog, SYSTEM_EDT_NOTICE } from '../logic/edts-zone.logic.js';
import type { EdtsDerived } from './use-edts-derived.js';
import type { EdtsState } from './use-edts-state.js';

export function createEdtsHandlers(useStore: AppStore, s: EdtsState & EdtsDerived) {
  const {
    setDialog,
    switchEdtAction,
    fastForwardSharedAction,
    mountedRef,
    setReadonlyNotice,
    loadEdts,
    loadEdtsBranches,
    logEdtAction,
    setCurrentEdtAction,
    focusedEdt,
    switchDirtyRepos,
    resolveSwitchDirtyRepos,
    runSwitchRestart,
    clearSwitchRestart,
    switchRestart,
    defaultRestartMode,
    createEdtAction,
    requestQuit,
    edtsRows,
    candidates,
    listCreateBranchesAction,
    activateEdtAction,
    clampedEdtsSelected,
    activeEdtUlid,
    modifyEdtAction,
    createMemberBranchAction,
    renameBranchAction,
    deleteEdtAction,
    resolveMemberDeleteStatusesAction,
  } = s;

  const { handleSwitchDialogInput, dispatchResolutionDecision, startSwitch } = createSwitchDialogHandlers({
    setDialog,
    switchEdtAction,
    loadEdts,
    loadEdtsBranches,
    logEdtAction,
    setCurrentEdtAction,
    focusedEdt,
    switchDirtyRepos,
    resolveSwitchDirtyRepos,
    runSwitchRestart,
    clearSwitchRestart,
    switchRestart,
    defaultRestartMode,
  });

  const { handleCreateInput, loadPendingBranchLists, handleCancelRequest, dispatchActivationDecision } = createCreateWizardHandlers({
    setDialog,
    createEdtAction,
    loadEdts,
    loadEdtsBranches,
    logEdtAction,
    requestQuit,
    setCurrentEdtAction,
    focusedEdt,
    edtsRows,
    candidates,
    listCreateBranches: listCreateBranchesAction,
    activateEdtAction,
    // "Switch now" hands off to the switch dialog on the new EDT, resolved from the store's `edts`
    // the wizard just reloaded (this render's `edtsRows` predates the create).
    startSwitch: (created) => {
      const target = useStore.getState().edts?.find((entry) => entry.ulid === created.ulid);
      if (target === undefined) {
        // The reload failed: the EDT exists but cannot be switched to from here.
        setDialog((prev) =>
          prev.kind === 'create'
            ? {
                ...prev,
                submitting: false,
                error: `EDT “${created.topic}” was created but could not be found after reload — switch to it from the EDT list.`,
                activation: { ...prev.activation, created, outcome: 'not-activated' },
              }
            : prev,
        );
        void logEdtAction(
          created.ulid,
          'create',
          'failed',
          `Created EDT "${created.topic}" — not activated: not found after reloading the EDT list, the switch was not run`,
        );
        return;
      }
      startSwitch(target);
    },
  });

  function openEdtAction() {
    const target = edtsRows[clampedEdtsSelected];
    if (target === undefined) {
      return;
    }
    if (isSystemEdt(target)) {
      // Switch only: the active system EDT has nothing left to do from Enter (no modify).
      if (activeEdtUlid !== null && target.ulid === activeEdtUlid) {
        setReadonlyNotice(SYSTEM_EDT_NOTICE);
      } else {
        setDialog(initialSwitchDialog(target));
      }
      return;
    }
    if (activeEdtUlid !== null && target.ulid === activeEdtUlid) {
      setDialog(initialModifyDialog(target));
    } else {
      setDialog(initialSwitchDialog(target));
    }
  }

  // Fast-forwards every local shared branch from origin — no switch, migration or restart. The
  // dialog opens at once ("running") and swaps to the per-service rows when the run lands.
  async function runFastForwardShared(): Promise<void> {
    setDialog(initialFastForwardDialog());
    let result: Awaited<ReturnType<typeof fastForwardSharedAction>>;
    try {
      result = await fastForwardSharedAction();
    } catch (error) {
      result = { ok: false, error: { code: 'fast-forward-failed', message: error instanceof Error ? error.message : String(error) } };
    }
    // The zone may have unmounted while the run was in flight.
    if (!mountedRef.current) {
      return;
    }
    setDialog(
      result.ok
        ? { kind: 'fast-forward-shared', status: 'done', rows: result.data.rows, error: null }
        : { kind: 'fast-forward-shared', status: 'done', rows: [], error: `${result.error.code}: ${result.error.message}` },
    );
    if (result.ok) {
      // Branch positions may have moved: refresh the divergence badges.
      void loadEdtsBranches();
    }
  }

  const { handleModifyDialogInput } = createModifyDialogHandlers({
    setDialog,
    modifyEdtAction,
    loadEdts,
    loadEdtsBranches,
    logEdtAction,
    setCurrentEdtAction,
    createMemberBranchAction,
    renameBranchAction,
    focusedEdt,
    candidates,
  });
  const { handleServiceActionsInput } = createServiceActionsDialogHandlers({
    setDialog,
    modifyEdtAction,
    loadEdts,
    loadEdtsBranches,
    logEdtAction,
    createMemberBranchAction,
    candidates,
  });
  const { handleAddToEdtInput } = createAddToEdtDialogHandlers({
    setDialog,
    modifyEdtAction,
    loadEdts,
    loadEdtsBranches,
    logEdtAction,
    createMemberBranchAction,
    renameBranchAction,
  });
  const { handleDeleteDialogInput, loadMemberStatuses } = createDeleteDialogHandlers({
    setDialog,
    deleteEdtAction,
    resolveMemberDeleteStatusesAction,
    loadEdts,
    loadEdtsBranches,
    setCurrentEdtAction,
  });
  const { handleQuickPickDialogInput } = createQuickPickDialogHandlers({
    setDialog,
    setCurrentEdtAction,
    edtsRows,
    activeEdtUlid,
  });

  return {
    handleSwitchDialogInput,
    dispatchResolutionDecision,
    startSwitch,
    handleCreateInput,
    loadPendingBranchLists,
    handleCancelRequest,
    dispatchActivationDecision,
    openEdtAction,
    runFastForwardShared,
    handleModifyDialogInput,
    handleServiceActionsInput,
    handleAddToEdtInput,
    handleDeleteDialogInput,
    loadMemberStatuses,
    handleQuickPickDialogInput,
  };
}

export type EdtsHandlers = ReturnType<typeof createEdtsHandlers>;
