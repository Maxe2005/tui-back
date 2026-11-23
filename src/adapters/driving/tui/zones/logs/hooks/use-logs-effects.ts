// tui/zones/logs: use-logs-effects — the Logs zone's lifecycle effects, in their original
// declaration order (mount load, presence/health polling, pending-focus hand-off, pane
// subscriptions, input-capture flags, footer context).
import { useEffect } from 'react';
import type { AppStore } from '../../../store/app-store.js';
import { useFooterContext } from '../../../shared/hooks/use-footer-context.js';
import { logsFooterContext, isPaneRestartAdvertised, reindexPaneSubFocus, ruleSetsFooterContext } from '../logs-zone.logic.js';
import { useLogsSubscriptions } from './use-logs-subscriptions.js';
import type { LogsState } from './use-logs-state.js';
import type { LogsDerived } from './use-logs-derived.js';

export function useLogsEffects(useStore: AppStore, s: LogsState & LogsDerived): void {
  const {
    services,
    servicesStatus,
    loadEdtsBranches,
    loadEdts,
    logsEdtSelected,
    logsOtherSelected,
    toggleLogsEdtSelection,
    toggleLogsOtherSelection,
    resolveLogsContainerPresence,
    startLogsListedHealthPolling,
    stopLogsListedHealthPolling,
    logsFullscreenTarget,
    logsPanes,
    subscribeLogsPane,
    unsubscribeLogsPane,
    restartMode,
    setZoneInputCaptured,
    setLogsPaneGridArrowsActive,
    paneFocus,
    setPaneFocus,
    setEdtCursor,
    setOtherCursor,
    setSubFocus,
    filterEditor,
    historyGridCursor,
    actionsMenu,
    actionsMenuSeq,
    pendingServiceFocus,
    clearPendingServiceFocus,
    rows,
    edtServices,
    otherServices,
    activeRepoPaths,
    activePanes,
    dialogOpen,
  } = s;

  useEffect(() => {
    void loadEdtsBranches();
    void loadEdts();
    // Fires once on mount only, mirrors edts-zone.tsx's own mount effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Container presence and listed-row health follow the listed rows — one manifest.load per
  // uncached row, badges for rows that were never subscribed. `services`/`servicesStatus`
  // are stable store references, so this refires only on a real reload, never per render.
  useEffect(() => {
    const listed = servicesStatus === 'error' ? [] : (services ?? []);
    const paths = listed.map((row) => row.path);
    resolveLogsContainerPresence(paths);
    startLogsListedHealthPolling(paths);
  }, [services, servicesStatus, resolveLogsContainerPresence, startLogsListedHealthPolling]);
  useEffect(() => () => stopLogsListedHealthPolling(), [stopLogsListedHealthPolling]);

  // A listing still in flight when the zone unmounts must not touch its state.
  useEffect(
    () => () => {
      actionsMenuSeq.current += 1;
    },
    [],
  );

  useEffect(() => {
    if (pendingServiceFocus === null) {
      return;
    }
    const inEdt = edtServices.findIndex((row) => row.path === pendingServiceFocus);
    const inOther = otherServices.findIndex((row) => row.path === pendingServiceFocus);
    if (inEdt >= 0) {
      if (!logsEdtSelected.includes(pendingServiceFocus)) {
        toggleLogsEdtSelection(pendingServiceFocus);
      }
      setEdtCursor(inEdt);
      setPaneFocus('edt-list');
    } else if (inOther >= 0) {
      if (!logsOtherSelected.includes(pendingServiceFocus)) {
        toggleLogsOtherSelection(pendingServiceFocus);
      }
      setOtherCursor(inOther);
      setPaneFocus('other-list');
    } else if (servicesStatus === 'error' || (servicesStatus === 'idle' && services !== null)) {
      // Not listed (container-less rows only appear in the info section): nothing to select.
    } else {
      return;
    }
    clearPendingServiceFocus();
  }, [
    pendingServiceFocus,
    edtServices,
    otherServices,
    servicesStatus,
    services,
    logsEdtSelected,
    logsOtherSelected,
    toggleLogsEdtSelection,
    toggleLogsOtherSelection,
    clearPendingServiceFocus,
  ]);

  // A request nobody consumed must not fire on a later visit.
  useEffect(() => () => clearPendingServiceFocus(), [clearPendingServiceFocus]);

  useLogsSubscriptions({ activeRepoPaths, logsFullscreenTarget, rows, subscribeLogsPane, unsubscribeLogsPane });

  // The grid reflows and sub-focus moves to the nearest remaining pane.
  useEffect(() => {
    setSubFocus((current) => reindexPaneSubFocus(current, activePanes.length));
  }, [activePanes.length]);

  useEffect(() => {
    setZoneInputCaptured(dialogOpen);
  }, [dialogOpen, setZoneInputCaptured]);
  useEffect(() => () => setZoneInputCaptured(false), [setZoneInputCaptured]);
  useFooterContext(
    'logs',
    logsFooterContext(
      filterEditor !== null,
      historyGridCursor !== null,
      {
        open: logsFullscreenTarget !== null,
        restartable: logsFullscreenTarget === null || isPaneRestartAdvertised(logsPanes[logsFullscreenTarget]),
      },
      restartMode,
      actionsMenu !== null,
      { listOpen: filterEditor?.view === 'list', confirmingClear: filterEditor?.confirmClear === true },
      filterEditor === null ? null : ruleSetsFooterContext(filterEditor),
    ),
    useStore,
  );

  // AppShell's global Left/Right zone-switch fires on the same keypress as this zone's useInput
  // (Ink dispatches to every mounted hook), so moving pane sub-focus with Left/Right would switch
  // zones without this flag. Only set while pane focus owns the arrows (fullscreen already
  // captures everything via zoneInputCaptured, so this stays false there).
  useEffect(() => {
    setLogsPaneGridArrowsActive(paneFocus === 'panes' && !dialogOpen);
  }, [paneFocus, dialogOpen, setLogsPaneGridArrowsActive]);
  useEffect(() => () => setLogsPaneGridArrowsActive(false), [setLogsPaneGridArrowsActive]);
}
