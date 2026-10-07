// tui/zones/edts: which footer context the open EDTs dialog (and the layer of it that currently
// owns the keyboard) registers. Pure, so every dialog state maps to its keys in one place.
import type { FooterContextId } from '../../keybindings/index.js';
import { branchPickerFooterContext } from '../../shared/components/branch-picker.js';
import type { CreateDialogState, EdtDialogState, SwitchDialogState } from './edts-zone.logic.js';
import { isActivationAcknowledge } from './dialogs/create-wizard/wizard.logic.js';
import type { SwitchResolutionState } from './dialogs/switch-resolution/switch-resolution.logic.js';

type Session = { state: Parameters<typeof branchPickerFooterContext>[0] } | null;

function pickerContext(session: Session, members: readonly { branch: string }[]): FooterContextId | null {
  return session === null ? null : branchPickerFooterContext(session.state, members.length > 0);
}

export function wizardFooterContext(dialog: CreateDialogState, registryEmpty: boolean): FooterContextId | null {
  const { activation, branches } = dialog;
  if (isActivationAcknowledge(dialog)) {
    return 'close';
  }
  if (activation.confirm !== null) {
    return 'overwrite-confirm';
  }
  if (activation.blocked !== null) {
    return 'wizard-pause';
  }
  // Creating or activating: nothing to press until the outcome lands.
  if (activation.created !== null) {
    return null;
  }
  if (dialog.step === 3) {
    if (branches.box !== null) {
      if (!branches.box.editing) {
        return 'override-box';
      }
      return branches.box.line === 'base' || branches.box.line === 'existing' ? 'branch-input' : 'confirm';
    }
    if (branches.editing) {
      return 'confirm';
    }
    return registryEmpty ? 'wizard-branches-first' : 'wizard-branches';
  }
  if (dialog.step === 4) {
    return activation.firstEdt ? 'wizard-activation-first' : 'wizard-activation';
  }
  return registryEmpty ? 'wizard-first' : 'wizard';
}

export function switchResolutionFooterContext(state: SwitchResolutionState): FooterContextId {
  if (state.confirm !== null) {
    return 'overwrite-confirm';
  }
  if (state.box !== null) {
    return state.box.editing ? 'confirm' : 'switch-box';
  }
  return state.editing ? 'confirm' : 'switch-resolution';
}

function switchFooterContext(dialog: SwitchDialogState, resolutionPending: boolean): FooterContextId | null {
  if (dialog.results !== undefined) {
    return 'close';
  }
  if (resolutionPending) {
    return dialog.resolution === null ? null : switchResolutionFooterContext(dialog.resolution);
  }
  return dialog.blocked ? 'force-confirm' : 'confirm';
}

// `resolutionPending`: the core switch is parked on the dirty-services seam (the zone's
// `switchDirtyRepos` is set), so the resolution view owns the keyboard.
export function edtsFooterContext(
  dialog: EdtDialogState,
  state: { registryEmpty: boolean; resolutionPending: boolean },
): FooterContextId | null {
  switch (dialog.kind) {
    case 'none':
      return null;
    case 'create':
      return wizardFooterContext(dialog, state.registryEmpty);
    case 'switch-confirm':
      return switchFooterContext(dialog, state.resolutionPending);
    case 'modify':
      return pickerContext(dialog.branchPicker, dialog.target.members) ?? (dialog.formFocus === 'members' ? 'modify-members' : 'modify-topic');
    case 'service-actions':
      return pickerContext(dialog.branchPicker, dialog.edt.members) ?? 'menu';
    case 'add-to-edt':
      return pickerContext(dialog.branchPicker, dialog.edt.members);
    case 'delete-confirm':
      return dialog.rejected || dialog.memberRows === null ? 'dismiss' : 'checklist';
    case 'issues':
      return 'dismiss';
    case 'quick-pick':
      return 'menu';
  }
}
