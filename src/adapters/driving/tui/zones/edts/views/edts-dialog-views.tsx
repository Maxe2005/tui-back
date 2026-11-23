// tui/zones/edts: edts-dialog-views — renders the open dialog's view (at most one), by dialog kind.
import { CreateWizardView } from '../dialogs/create-wizard/create-wizard.js';
import { AddToEdtDialogView } from '../dialogs/add-to-edt-dialog.js';
import { DeleteDialogView } from '../dialogs/delete-dialog.js';
import { FastForwardDialogView } from '../dialogs/fast-forward-dialog.js';
import { isSystemEdt } from '../../../../../../core/edt/shared-edt.js';
import { IssuesDialogView } from '../dialogs/issues-dialog.js';
import { ModifyDialogView } from '../dialogs/modify-dialog.js';
import { QuickPickDialogView, resolveQuickPickCandidates } from '../dialogs/quick-pick-dialog.js';
import { ServiceActionsDialogView } from '../dialogs/service-actions-dialog.js';
import { SwitchDialogView } from '../dialogs/switch-dialog.js';
import type { EdtsZoneCtx } from '../edts-zone.ctx.js';

export function EdtsDialogViews({ c }: { c: EdtsZoneCtx }) {
  const {
    dialog,
    candidates,
    candidateState,
    edtsRows,
    branchDropdownMaxRows,
    createWizardTableMaxRows,
    switchDirtyRepos,
    switchResolutionMaxRows,
    defaultRestartMode,
    switchRestart,
    activeEdtUlid,
    unreachable,
    errors,
  } = c;
  return (
    <>
      {dialog.kind === 'create' ? (
        <CreateWizardView
          dialog={dialog}
          candidates={candidates}
          candidateState={candidateState}
          edtsRows={edtsRows}
          maxRows={branchDropdownMaxRows}
          maxVisibleRows={createWizardTableMaxRows}
        />
      ) : null}

      {dialog.kind === 'switch-confirm' ? <SwitchDialogView dialog={dialog} switchDirtyRepos={switchDirtyRepos} maxVisibleRows={switchResolutionMaxRows} defaultRestartMode={defaultRestartMode} switchRestart={switchRestart} /> : null}

      {dialog.kind === 'modify' ? <ModifyDialogView dialog={dialog} candidates={candidates} candidateState={candidateState} maxRows={branchDropdownMaxRows} /> : null}

      {dialog.kind === 'service-actions' ? <ServiceActionsDialogView dialog={dialog} maxRows={branchDropdownMaxRows} /> : null}

      {dialog.kind === 'add-to-edt' ? <AddToEdtDialogView dialog={dialog} maxRows={branchDropdownMaxRows} /> : null}

      {dialog.kind === 'delete-confirm' ? <DeleteDialogView dialog={dialog} /> : null}

      {dialog.kind === 'quick-pick' ? (
        <QuickPickDialogView
          dialog={dialog}
          pool={resolveQuickPickCandidates(dialog.mode, edtsRows, activeEdtUlid)}
          systemOnly={dialog.mode !== 'switch' && edtsRows.length > 0 && edtsRows.every((entry) => isSystemEdt(entry))}
        />
      ) : null}

      {dialog.kind === 'fast-forward-shared' ? <FastForwardDialogView dialog={dialog} /> : null}
      {dialog.kind === 'issues' ? <IssuesDialogView unreachable={unreachable} errors={errors} /> : null}
    </>
  );
}
