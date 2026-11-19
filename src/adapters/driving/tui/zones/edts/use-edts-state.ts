// tui/zones/edts: use-edts-state — the EDTs zone's store selectors and local `useState`s. No
// derivation, no effects: those live in the layers built on top.
import { useEffect, useRef, useState } from 'react';
import type { AppStore } from '../../store/app-store.js';
import { seedDialog, type InitialDialogKind } from './edts-zone.dialog-seed.js';
import type { EdtDialogState, PaneFocus } from './edts-zone.logic.js';

export function useEdtsState(useStore: AppStore, initialPaneFocus: PaneFocus, initialDialogKind: InitialDialogKind | undefined) {
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
  // The create wizard's Step 4 first-EDT activation.
  const activateEdtAction = useStore((state) => state.activateEdt);
  const switchEdtAction = useStore((state) => state.switchEdt);
  const fastForwardSharedAction = useStore((state) => state.fastForwardShared);
  // The switch dirty-repo confirm seam (edt-slice.ts).
  const switchDirtyRepos = useStore((state) => state.switchDirtyRepos);
  const resolveSwitchDirtyRepos = useStore((state) => state.resolveSwitchDirtyRepos);
  // FR-37: the post-switch restart run, and the setting the switch dialog's selector starts on.
  const runSwitchRestart = useStore((state) => state.runSwitchRestart);
  const clearSwitchRestart = useStore((state) => state.clearSwitchRestart);
  const switchRestart = useStore((state) => state.switchRestart);
  const defaultRestartMode = useStore((state) => state.settings.switch.restartMode);
  const modifyEdtAction = useStore((state) => state.modifyEdt);
  const deleteEdtAction = useStore((state) => state.deleteEdt);
  const resolveMemberDeleteStatusesAction = useStore((state) => state.resolveMemberDeleteStatuses);
  // The shared branch-picker's store actions — `deps.git` is never touched directly from this
  // zone; these wrap core/edt/modify.ts's listMemberBranches/createMemberBranch/
  // renameMemberBranch exports.
  const listBranchesAction = useStore((state) => state.listBranches);
  // The create wizard's Step 3 per-service lists (local + remote-tracking refs).
  const listCreateBranchesAction = useStore((state) => state.listCreateBranches);
  const createMemberBranchAction = useStore((state) => state.createMemberBranch);
  const renameBranchAction = useStore((state) => state.renameBranch);
  const setZoneInputCaptured = useStore((state) => state.setZoneInputCaptured);
  const requestQuit = useStore((state) => state.requestQuit);
  // EDT action state for the detail pane — tracks the in-progress action and the action log
  const currentEdtAction = useStore((state) => state.currentEdtAction);
  const setCurrentEdtAction = useStore((state) => state.setCurrentEdtAction);
  const edtActionLog = useStore((state) => state.edtActionLog);
  const edtActionLogStatus = useStore((state) => state.edtActionLogStatus);
  const loadEdtActionLog = useStore((state) => state.loadEdtActionLog);
  const logEdtAction = useStore((state) => state.logEdtAction);
  // Hides a per-context action hint from the detail pane as soon as it is toggled in the settings
  // screen's EDTs tab.
  const hiddenActionHints = useStore((state) => state.settings.edts.hiddenActionHints);
  const hiddenActionTypes = useStore((state) => state.settings.edts.hiddenActionTypes);
  // The shared branch autocomplete's visible row cap — threaded into every BranchPicker
  // session's pick-existing filter (no per-service override, no new setting of its own).
  const branchDropdownMaxRows = useStore((state) => state.settings.edts.branchDropdownMaxRows);

  // ---- EDT selector and dialogs ------------------------------------------------------------
  const [paneFocus, setPaneFocus] = useState<PaneFocus>(initialPaneFocus);
  const [edtsSelected, setEdtsSelected] = useState(0);
  // One cursor per partitioned pane (EDT SERVICES / OTHER SERVICES) — each keeps its own
  // position as paneFocus cycles between them, as edtsSelected does for the EDT selector.
  const [edtServicesSelected, setEdtServicesSelected] = useState(0);
  const [otherServicesSelected, setOtherServicesSelected] = useState(0);
  const [dialog, setDialog] = useState<EdtDialogState>(() => seedDialog(initialDialogKind, useStore));
  // Inline refusal shown when a blocked key (modify, rename, member edit, delete, create-from) is
  // used on the system EDT; cleared by the next keypress.
  const [readonlyNotice, setReadonlyNotice] = useState<string | null>(null);
  // The zone may unmount while an async run (fast-forward) is in flight.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return {
    services,
    status,
    error,
    unreachable,
    errors,
    loadEdtsBranches,
    edts,
    edtsStatus,
    edtsError,
    activeEdtUlid,
    loadEdts,
    createEdtAction,
    activateEdtAction,
    switchEdtAction,
    fastForwardSharedAction,
    switchDirtyRepos,
    resolveSwitchDirtyRepos,
    runSwitchRestart,
    clearSwitchRestart,
    switchRestart,
    defaultRestartMode,
    modifyEdtAction,
    deleteEdtAction,
    resolveMemberDeleteStatusesAction,
    listBranchesAction,
    listCreateBranchesAction,
    createMemberBranchAction,
    renameBranchAction,
    setZoneInputCaptured,
    requestQuit,
    currentEdtAction,
    setCurrentEdtAction,
    edtActionLog,
    edtActionLogStatus,
    loadEdtActionLog,
    logEdtAction,
    hiddenActionHints,
    hiddenActionTypes,
    branchDropdownMaxRows,
    paneFocus,
    setPaneFocus,
    edtsSelected,
    setEdtsSelected,
    edtServicesSelected,
    setEdtServicesSelected,
    otherServicesSelected,
    setOtherServicesSelected,
    dialog,
    setDialog,
    readonlyNotice,
    setReadonlyNotice,
    mountedRef,
  };
}

export type EdtsState = ReturnType<typeof useEdtsState>;
