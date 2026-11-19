// tui/zones/edts: use-edts-dialog-effects — the zone's lifecycle effects, second half, in their
// original declaration order (post-switch restart report, switch resolution draft + decision,
// create-wizard activation decision / pending lists / cancel, delete-confirm member statuses).
import { useEffect, useRef } from 'react';
import {
  initialSwitchResolution,
  otherEdtBranches,
  resolutionRepos,
  type LocalBranchList,
} from './dialogs/switch-resolution/switch-resolution.logic.js';
import { initialSwitchDialog, resolveOutgoingTopic, type DeleteDialogState } from './edts-zone.logic.js';
import type { EdtsZoneCtx } from './edts-zone.ctx.js';

export function useEdtsDialogEffects(c: EdtsZoneCtx): void {
  const {
    edts,
    edtsRows,
    activeEdtUlid,
    switchDirtyRepos,
    switchRestart,
    dialog,
    setDialog,
    listBranchesAction,
    dispatchResolutionDecision,
    dispatchActivationDecision,
    loadPendingBranchLists,
    handleCancelRequest,
    loadMemberStatuses,
  } = c;

  // The handlers these effects call come from use-edts-handlers.ts (rebuilt every render).
  // A post-switch restart report kept in the store (the run outlives this zone's dialogs): coming
  // back to the zone reopens it on that report once, so the run state is intact on return.
  // Only a report already in the store at mount is reopened — never one this mount started and
  // the developer then closed with Esc while it was still running.
  const restartReportReopened = useRef(switchRestart === null);
  useEffect(() => {
    if (restartReportReopened.current || switchRestart === null || dialog.kind !== 'none') {
      return;
    }
    const target = edtsRows.find((row) => row.topic === switchRestart.topic);
    if (target === undefined) {
      return;
    }
    restartReportReopened.current = true;
    setDialog({ ...initialSwitchDialog(target), results: [], restartReport: true });
  }, [switchRestart, edts]);

  // Once the core switch parks on the dirty-repo seam, open the resolution view on a fresh draft —
  // the outgoing EDT is the store's active one (null on a first switch) — and load each state-2/3
  // repo's local branch list once (listMemberBranches, via the store), for the advisory "already
  // exists" check. Keyed on primitives, never on the dialog object.
  const switchResolutionDraftCounter = useRef(0);
  const switchResolutionNeeded = dialog.kind === 'switch-confirm' && switchDirtyRepos !== null && dialog.resolution === null;
  useEffect(() => {
    if (!switchResolutionNeeded || switchDirtyRepos === null) {
      return;
    }
    const dirty = switchDirtyRepos;
    // Leaving the system EDT: nothing to adopt dirty work into (no outgoing topic -> discard/stash only).
    const outgoingTopic = resolveOutgoingTopic(edtsRows, activeEdtUlid);
    // Branches other EDTs register per repo, so a row sitting on one is retargeted to the global
    // name and such a name is rejected inline.
    const claims = otherEdtBranches(edtsRows, activeEdtUlid);
    // Each draft is tagged, so a late list load from an earlier attempt never lands in a newer
    // draft; a rejected load settles as 'error', never stuck 'loading'.
    switchResolutionDraftCounter.current += 1;
    const draftId = switchResolutionDraftCounter.current;
    setDialog((prev) =>
      prev.kind === 'switch-confirm' && prev.resolution === null
        ? { ...prev, resolution: initialSwitchResolution(outgoingTopic, dirty, claims, draftId) }
        : prev,
    );
    for (const repo of resolutionRepos(dirty)) {
      const repoPath = repo.repoPath;
      const apply = (list: LocalBranchList) => {
        setDialog((prev) => {
          if (
            prev.kind !== 'switch-confirm' ||
            prev.resolution === null ||
            prev.resolution.draftId !== draftId ||
            prev.resolution.lists[repoPath]?.status !== 'loading'
          ) {
            return prev;
          }
          return { ...prev, resolution: { ...prev.resolution, lists: { ...prev.resolution.lists, [repoPath]: list } } };
        });
      };
      listBranchesAction(repoPath).then(
        (result) => apply(result.ok ? { status: 'ready', branches: result.data } : { status: 'error', branches: [] }),
        () => apply({ status: 'error', branches: [] }),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [switchResolutionNeeded]);

  // The resolution view's decision (raised inside its key reducer) resumes the parked core switch
  // here, outside any state updater.
  const switchResolutionDecision = dialog.kind === 'switch-confirm' ? (dialog.resolution?.decision ?? null) : null;
  useEffect(() => {
    if (switchResolutionDecision !== null && dialog.kind === 'switch-confirm') {
      dispatchResolutionDecision(dialog);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [switchResolutionDecision]);

  // A decision Step 4's key reducer raised (retry / overwrite / stop) runs here, outside any state
  // updater — the same pattern as the switch resolution view's decision.
  const activationDecision = dialog.kind === 'create' ? dialog.activation.decision : null;
  useEffect(() => {
    if (activationDecision !== null && dialog.kind === 'create') {
      dispatchActivationDecision(dialog);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activationDecision]);

  // Entering the create wizard's Step 3 queues every service whose lists are not loaded yet (or
  // failed last time) as `pending`; this effect hands them to the wizard, which flips them to
  // `loading` at once — so each service is loaded once per entry. Keyed on the joined pending
  // paths (a primitive), never on the dialog object itself.
  const pendingCreateListPaths =
    dialog.kind === 'create'
      ? Object.entries(dialog.branches.lists)
          .filter(([, lists]) => lists.status === 'pending')
          .map(([path]) => path)
          .sort()
          .join('\n')
      : '';
  useEffect(() => {
    if (pendingCreateListPaths !== '') {
      loadPendingBranchLists(pendingCreateListPaths.split('\n'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCreateListPaths]);

  // Step 3 decides an Esc-cancel against the latest state inside its updater and raises
  // `cancelRequested`; the cancel's side effects (close / quit) run here.
  const createCancelRequested = dialog.kind === 'create' && dialog.cancelRequested;
  useEffect(() => {
    if (createCancelRequested) {
      handleCancelRequest();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createCancelRequested]);

  // Fetches the delete-confirm dialog's per-member merge/clean statuses once, when it opens with
  // memberRows === null — never for a `rejected` dialog (nothing to disposition). Keyed on
  // primitives (ulid + a loading/loaded flag), like the branch-picker effect above: a fresh
  // `dialog` object on every keystroke must never re-trigger this fetch.
  const deleteDialogTargetUlid = dialog.kind === 'delete-confirm' && !dialog.rejected ? dialog.target.ulid : null;
  const deleteDialogNeedsStatuses = dialog.kind === 'delete-confirm' && !dialog.rejected && dialog.memberRows === null;
  useEffect(() => {
    if (deleteDialogTargetUlid === null || !deleteDialogNeedsStatuses) {
      return;
    }
    const current = dialog as DeleteDialogState;
    void loadMemberStatuses(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteDialogTargetUlid, deleteDialogNeedsStatuses]);
}
