// tui/zones/update: update-zone-dialogs — the zone's overlays: the quit-run confirm, the pre-run
// configuration screen, the row-local service menu, the no-arg service quick-pick and the
// incident queue popup. Each is rendered only while its state is open.
import { ModalDialog } from '../../shared/components/index.js';
import { ClampedParagraph } from '../../shared/components/truncated-text.js';
import { colors } from '../../shared/theme/theme.js';
import { UpdateConfigPanels } from './update-config-panels.js';
import { UpdateIncidentsDialog } from './update-incidents-dialog.js';
import { UpdateServiceMenuDialog } from './update-service-menu-dialog.js';
import { UpdateServicePickDialog } from './update-service-pick-dialog.js';
import { UPDATE_QUIT_CONFIRM_BODY, UPDATE_QUIT_CONFIRM_BODY_ALL, UPDATE_QUIT_CONFIRM_TITLE } from './update-zone.resolvers.logic.js';
import type { UpdateZoneCtx } from './update-zone.ctx.js';

export function UpdateZoneDialogs({ c }: { c: UpdateZoneCtx }) {
  const {
    quitConfirm, isAllRun, quitCounts, updateConfig, configPanels, serviceMenu, clampedServiceMenuCursor, serviceMenuItems,
    updateServicePick, pickState, popupOpen, incidents, selectedIncidentIndex, incidentMode, blockerCursor, editorError, incidentNow,
  } = c;
  return (
    <>
      <ModalDialog title={UPDATE_QUIT_CONFIRM_TITLE} open={quitConfirm}>
        <ClampedParagraph color={colors.text} maxLines={4}>{`${isAllRun ? UPDATE_QUIT_CONFIRM_BODY_ALL : UPDATE_QUIT_CONFIRM_BODY}${quitCounts !== null ? ` ${quitCounts}` : ''}`}</ClampedParagraph>
      </ModalDialog>
      {updateConfig !== null ? (
        <UpdateConfigPanels
          draft={updateConfig}
          view={configPanels.view}
          budget={configPanels.budget}
          edtState={configPanels.edtField}
          edtTopics={configPanels.edtTopics}
          edtStatus={configPanels.edtStatus}
          box={configPanels.box}
          boxContext={configPanels.boxContext}
        />
      ) : null}
      {serviceMenu !== null ? (
        <UpdateServiceMenuDialog service={serviceMenu.service} cursor={clampedServiceMenuCursor} items={serviceMenuItems} />
      ) : null}
      {/* The no-arg `:update-service` fallback — a filterable service quick-pick. Confirming a
          row opens the config pre-scoped to that one service; Esc closes with nothing opened. */}
      {updateServicePick !== null ? <UpdateServicePickDialog state={pickState} candidates={updateServicePick} /> : null}
      {popupOpen ? (
        <UpdateIncidentsDialog
          incidents={incidents}
          selected={selectedIncidentIndex}
          mode={incidentMode}
          menuCursor={blockerCursor}
          editorError={editorError}
          now={incidentNow}
        />
      ) : null}
    </>
  );
}
