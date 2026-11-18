// tui/zones/update: use-update-effects — the Update zone's footer context and side effects, in
// their original relative order: mount loads, health polling, input capture, service-menu /
// incident-popup / quick-pick resets, the no-arg `:update-service` request and the report
// auto-close.
import { useEffect, useRef } from 'react';
import { useFooterContext } from '../../shared/hooks/use-footer-context.js';
import { updateConfigFooterContext } from './update-config-panels.logic.js';
import { updateFooterContext } from './update-zone.logic.js';
import { createFilterablePickListState } from '../../shared/components/index.js';
import type { UpdateZoneCtx } from './update-zone.ctx.js';

export function useUpdateEffects(c: UpdateZoneCtx): void {
  const {
    useStore, updateBlocker, incidentListActive, updateConfig, configPanels, updateServicePick, quitConfirm, serviceMenu,
    updateServiceSelectRequest, reportService, loadEdtsBranches, loadEdts, servicePaths, stopUpdateHealthPolling,
    startUpdateHealthPolling, setZoneInputCaptured, popupOpen, setServiceMenuCursor, incidentMode, selectedIncident,
    setBlockerCursor, setEditorError, setIncidentMode, setIncidentIndex, setIncidentNow, incidentToast, clearIncidentToast,
    setPickState, clearUpdateServiceSelectionRequest, focusedServiceRow, openUpdateConfig, openUpdateServicePick,
    reportAvailable, setReportService, setReportOffset,
  } = c;

  // The layer that owns the keyboard, in the same priority order as the key handler.
  useFooterContext(
    'update',
    updateFooterContext({
      blocker: updateBlocker !== null,
      incidentList: incidentListActive,
      config: updateConfig !== null ? updateConfigFooterContext(configPanels.view, configPanels.box) : null,
      servicePick: updateServicePick !== null,
      quitConfirm,
      serviceMenu: serviceMenu !== null,
      selectRequest: updateServiceSelectRequest,
      report: reportService !== null,
    }),
    useStore,
  );

  useEffect(() => {
    void loadEdtsBranches();
    void loadEdts();
    // Fires once on mount only, like logs-zone.tsx's mount effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Starts (or restarts, on a changed service list) this zone's own health poll whenever the
  // loaded service list changes — independent of the Logs zone's subscriptions. Torn down on
  // unmount so no poll timer outlives the zone.
  useEffect(() => {
    if (servicePaths === '') {
      // A service list going from non-empty to empty (edtsBranches becomes `[]`, or
      // servicesStatus flips to 'error') stops the previous poll cycle too — otherwise a stale
      // interval keeps polling repoPaths no longer displayed.
      stopUpdateHealthPolling();
      return;
    }
    startUpdateHealthPolling(servicePaths.split('\u0000'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servicePaths]);
  useEffect(() => () => stopUpdateHealthPolling(), [stopUpdateHealthPolling]);

  // While any dialog owns the keystroke, every global shortcut (including `?`
  // help and the zone mnemonics) must not fire — the same zoneInputCaptured gate the EDTs
  // zone's own dialogs use. The blocker menu captures hardest: while a repo waits, no
  // other zone key may fire at all. A pending no-arg service request captures too, so a
  // second trigger can't race the pick opening underneath it.
  useEffect(() => {
    setZoneInputCaptured(
      quitConfirm || updateConfig !== null || popupOpen || serviceMenu !== null || updateServicePick !== null || updateServiceSelectRequest || reportService !== null,
    );
  }, [quitConfirm, updateConfig, popupOpen, serviceMenu, updateServicePick, updateServiceSelectRequest, reportService, setZoneInputCaptured]);

  // A newly opened service menu always starts browsing on its first row.
  useEffect(() => {
    if (serviceMenu !== null) {
      setServiceMenuCursor(0);
    }
  }, [serviceMenu]);

  // A newly opened incident menu always starts on its first row; every selection change or
  // popup open lands back on the list.
  useEffect(() => {
    if (incidentMode === 'menu') {
      setBlockerCursor(0);
    }
    setEditorError(null);
  }, [incidentMode, selectedIncident?.id]);
  // A choice is always for the incident the menu opened on: if that one leaves the queue (or the
  // selection shifts) the keys fall back to the list rather than answering another incident.
  const menuIncidentId = useRef<string | null>(null);
  useEffect(() => {
    if (incidentMode !== 'menu') {
      menuIncidentId.current = null;
    } else if (menuIncidentId.current === null) {
      menuIncidentId.current = selectedIncident?.id ?? null;
    } else if (menuIncidentId.current !== selectedIncident?.id) {
      menuIncidentId.current = null;
      setIncidentMode('list');
    }
  }, [incidentMode, selectedIncident?.id]);
  useEffect(() => {
    if (!popupOpen) {
      setIncidentMode('list');
      setIncidentIndex(0);
    }
  }, [popupOpen]);
  // The popup's ages tick while it is open; the toast of a late incident fades on its own.
  useEffect(() => {
    if (!popupOpen) {
      return undefined;
    }
    setIncidentNow(Date.now());
    const timer = setInterval(() => setIncidentNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [popupOpen]);
  useEffect(() => {
    if (incidentToast === null) {
      return undefined;
    }
    const timer = setTimeout(clearIncidentToast, 5000);
    return () => clearTimeout(timer);
  }, [incidentToast, clearIncidentToast]);

  // A newly opened service pick always starts unfiltered on its first row. The single reset point
  // is the pick *closing* — whoever closed it (Enter, Esc, or the store on a run start/reset) —
  // so the next open never paints a frame of the previous session's filter. Keyed on the open
  // boolean, never the candidate list, so a store refresh doesn't wipe typed filter text.
  const isUpdateServicePickOpen = updateServicePick !== null;
  useEffect(() => {
    if (!isUpdateServicePickOpen) {
      setPickState(createFilterablePickListState());
    }
  }, [isUpdateServicePickOpen]);

  // Consumes the no-arg `:update-service` request raised through the store. A highlighted row
  // pre-scopes the config to that one service (`p` without the keypress); with no row selected
  // the filterable quick-pick opens. Runs through the same guarded openers, so a request racing a
  // run start is rejected rather than opening a screen mid-run.
  useEffect(() => {
    if (!updateServiceSelectRequest) {
      return;
    }
    clearUpdateServiceSelectionRequest();
    if (focusedServiceRow !== undefined) {
      void openUpdateConfig({ service: focusedServiceRow.service, repoPath: focusedServiceRow.path });
    } else {
      void openUpdateServicePick();
    }
    // Keyed on primitives — selectedServiceRow is re-derived every render, so depend on
    // its identity fields rather than the object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateServiceSelectRequest]);

  // A report whose service lost everything to show (a new run reset it) closes on its own.
  useEffect(() => {
    if (reportService !== null && !reportAvailable) {
      setReportService(null);
      setReportOffset(0);
    }
  }, [reportService, reportAvailable]);
}
