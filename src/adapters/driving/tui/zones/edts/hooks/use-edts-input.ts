// tui/zones/edts: use-edts-input — the zone's single `useInput` dispatcher: an open dialog owns
// the keystroke (routed to its handler); otherwise the base view handles Tab / reload / issues /
// per-pane navigation. Inert behind any overlay or Ctrl+W resize-mode.
import { isSystemEdt } from '../../../../../../core/workspace/edt/shared-edt/shared-edt.js';
import { useInput } from '../../../shared/hooks/use-input.js';
import { useZoneInputActive } from '../../../shared/hooks/use-zone-input-active.js';
import { resolveFocusStep } from '../../../shared/keys/focus-navigation.js';
import { jumpSelection, moveSelection, resolveSelectionDirection, resolveSelectionJump } from '../../../shared/keys/list-cursor.js';
import {
  cyclePaneFocus,
  initialAddToEdtDialog,
  initialIssuesDialog,
  initialServiceActionsDialog,
  PANE_FOCUS_NAV,
  SYSTEM_EDT_NOTICE,
} from '../logic/edts-zone.logic.js';
import type { EdtsZoneCtx } from '../edts-zone.ctx.js';

export function useEdtsInput(c: EdtsZoneCtx): void {
  const {
    useStore,
    dialog,
    setDialog,
    paneFocus,
    setPaneFocus,
    status,
    edtsStatus,
    loadEdtsBranches,
    loadEdts,
    issuesSummary,
    edtsRows,
    setEdtsSelected,
    setEdtServicesSelected,
    setOtherServicesSelected,
    edtServices,
    otherServices,
    clampedEdtServicesSelected,
    clampedOtherServicesSelected,
    focusedEdt,
    openEdtAction,
    runFastForwardShared,
    readonlyNotice,
    setReadonlyNotice,
    focusedIsSystem,
    handleCreateInput,
    handleSwitchDialogInput,
    handleModifyDialogInput,
    handleServiceActionsInput,
    handleAddToEdtInput,
    handleDeleteDialogInput,
    handleQuickPickDialogInput,
  } = c;

  const zoneInputActive = useZoneInputActive(useStore);
  useInput((input, key) => {
    if (readonlyNotice !== null) {
      setReadonlyNotice(null);
    }
    if (dialog.kind === 'create') {
      handleCreateInput(dialog, input, key);
      return;
    }
    if (dialog.kind === 'switch-confirm') {
      handleSwitchDialogInput(dialog, input, key);
      return;
    }
    if (dialog.kind === 'modify') {
      handleModifyDialogInput(dialog, input, key);
      return;
    }
    if (dialog.kind === 'service-actions') {
      handleServiceActionsInput(dialog, input, key);
      return;
    }
    if (dialog.kind === 'add-to-edt') {
      handleAddToEdtInput(dialog, input, key);
      return;
    }
    if (dialog.kind === 'delete-confirm') {
      handleDeleteDialogInput(dialog, input, key);
      return;
    }
    if (dialog.kind === 'quick-pick') {
      handleQuickPickDialogInput(dialog, input, key);
      return;
    }
    if (dialog.kind === 'fast-forward-shared') {
      // Inert while running; the results close with Esc or Enter.
      if (dialog.status === 'done' && (key.escape || key.return)) {
        setDialog({ kind: 'none' });
      }
      return;
    }
    if (dialog.kind === 'issues') {
      // Read-only dialog, no submit path — Esc or Enter both just close it.
      if (key.escape || key.return) {
        setDialog({ kind: 'none' });
      }
      return;
    }

    // Base edt-list view (no dialog open): Tab cycles which of the three lists is focused;
    // arrows/Home/End move only the currently-focused list — all three stay independently
    // navigable.
    const paneStep = resolveFocusStep(input, key, PANE_FOCUS_NAV.mode);
    if (paneStep !== null) {
      setPaneFocus((current) => cyclePaneFocus(current, paneStep));
      return;
    }

    if (input === 'R' && (edtsStatus === 'error' || status === 'error')) {
      // Reload only the failed source(s); ignored while any load is still in flight.
      if (edtsStatus !== 'loading' && status !== 'loading') {
        if (status === 'error') {
          void loadEdtsBranches();
        }
        if (edtsStatus === 'error') {
          void loadEdts();
        }
      }
      return;
    }

    // Opens the issues detail dialog from any pane, like the summary line's "[i] details" hint —
    // only reachable when there's actually something to show.
    if (input === 'i' && issuesSummary !== null) {
      setDialog(initialIssuesDialog());
      return;
    }

    if (paneFocus === 'edts') {
      // Quick action on the system "Shared branches" row only (it exists only while the setting is on).
      if (input === 'f' && focusedIsSystem) {
        void runFastForwardShared();
        return;
      }
      const jump = resolveSelectionJump(key);
      if (jump !== null) {
        setEdtsSelected(jumpSelection(jump, edtsRows.length));
        return;
      }
      const direction = resolveSelectionDirection(key);
      if (direction !== null) {
        setEdtsSelected((prevIndex) => moveSelection(prevIndex, direction, edtsRows.length));
        return;
      }
      if (key.return) {
        openEdtAction();
      }
      return;
    }

    if (paneFocus === 'edt-services') {
      const jump = resolveSelectionJump(key);
      if (jump !== null) {
        setEdtServicesSelected(jumpSelection(jump, edtServices.length));
        return;
      }
      const direction = resolveSelectionDirection(key);
      if (direction !== null) {
        setEdtServicesSelected((prevIndex) => moveSelection(prevIndex, direction, edtServices.length));
        return;
      }
      if (key.return) {
        const service = edtServices[clampedEdtServicesSelected];
        if (service !== undefined && focusedEdt !== undefined && isSystemEdt(focusedEdt)) {
          setReadonlyNotice(SYSTEM_EDT_NOTICE);
        } else if (service !== undefined && focusedEdt !== undefined) {
          setDialog(initialServiceActionsDialog(focusedEdt, service.path, service.service));
        }
      }
      return;
    }

    // paneFocus === 'other-services'
    const jump = resolveSelectionJump(key);
    if (jump !== null) {
      setOtherServicesSelected(jumpSelection(jump, otherServices.length));
      return;
    }
    const direction = resolveSelectionDirection(key);
    if (direction !== null) {
      setOtherServicesSelected((prevIndex) => moveSelection(prevIndex, direction, otherServices.length));
      return;
    }
    if (key.return) {
      const service = otherServices[clampedOtherServicesSelected];
      if (service !== undefined && focusedEdt !== undefined && isSystemEdt(focusedEdt)) {
        setReadonlyNotice(SYSTEM_EDT_NOTICE);
      } else if (service !== undefined && focusedEdt !== undefined) {
        setDialog(initialAddToEdtDialog(focusedEdt, service.path, service.service, service.branch, service.sharedBranch));
      }
    }
  // Inert behind any overlay or Ctrl+W resize-mode (see use-zone-input-active).
  }, { isActive: zoneInputActive });
}
