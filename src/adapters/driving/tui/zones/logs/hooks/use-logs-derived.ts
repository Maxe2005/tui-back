// tui/zones/logs: use-logs-derived — everything the Logs zone computes from its state each render:
// the service partition, clamped cursors, active panes, row health and the window-driven layout.
import { useMemo } from 'react';
import { useWindowSize } from 'ink';
import type { ServiceBranchDivergence } from '../../../../../../core/workspace/edt/lifecycle/list.js';
import type { ServiceStatusState } from '../../../../../../core/service-status/index.js';
import { partitionServicesByEdtMembership } from '../../edts/logic/edts-zone.logic.js';
import {
  computeLogsLayout,
  DEFAULT_LOG_FILTER,
  isRestartingDisplay,
  splitNoContainerRows,
  type FilterEditorState,
  type LogFilterScope,
} from '../logic/logs-zone.logic.js';
import { logsActionsMenuRows } from '../panes/logs-actions-menu.js';
import type { LogsState } from './use-logs-state.js';

export function useLogsDerived(s: LogsState) {
  const {
    services,
    servicesStatus,
    edts,
    activeEdtUlid,
    logsEdtSelected,
    logsOtherSelected,
    logsNoContainer,
    logsListedHealth,
    logsFullscreenTarget,
    logsPanes,
    listRatio,
    filterHistoryGridMaxRows,
    ruleSets,
    globalFilter,
    paneFilters,
    filterEditor,
    historyGridCursor,
    actionsMenu,
    edtCursor,
    otherCursor,
  } = s;

  const rows = servicesStatus === 'error' ? [] : (services ?? []);
  const focusedEdt = (edts ?? []).find((entry) => entry.ulid === activeEdtUlid);
  // Any manifest service can be streamed, not only active-EDT members — the partition is against
  // the tool-wide *active* EDT (not a selected row, unlike edts-zone's use of this function),
  // since the Logs zone has no EDT selector of its own. Container-less rows leave both
  // selectable lists for the info-only section below (presence resolves async in the store,
  // so they render in their membership list until then — never blocked on the load).
  const { edtServices, otherServices, withoutContainerServices } = useMemo(() => {
    const partitioned = partitionServicesByEdtMembership(rows, focusedEdt);
    const edt = splitNoContainerRows(partitioned.edtServices, logsNoContainer);
    const other = splitNoContainerRows(partitioned.otherServices, logsNoContainer);
    return {
      edtServices: edt.selectable,
      otherServices: other.selectable,
      withoutContainerServices: [...edt.withoutContainer, ...other.withoutContainer],
    };
  }, [rows, focusedEdt, logsNoContainer]);

  const clampedEdtCursor = edtServices.length === 0 ? 0 : Math.min(edtCursor, edtServices.length - 1);
  const clampedOtherCursor = otherServices.length === 0 ? 0 : Math.min(otherCursor, otherServices.length - 1);

  // Every listed row carries a badge — its subscribed pane's health, else the listed-row
  // poll's value, else `down` (the Update zone's missing-reads-as-down precedent). A
  // requested restart reads explicitly, never as the bare state.
  function displayHealthFor(repoPath: string): ServiceStatusState {
    const pane = logsPanes[repoPath];
    const rowHealth = pane?.health ?? logsListedHealth[repoPath] ?? 'down';
    return isRestartingDisplay(pane?.restarting ?? false, rowHealth) ? 'restarting' : rowHealth;
  }

  // Active panes render in a stable order (EDT-list selections first, then other-list ones) so
  // `subFocus`'s index keeps a consistent meaning as selections change.
  const activeRepoPaths = useMemo(() => [...logsEdtSelected, ...logsOtherSelected], [logsEdtSelected, logsOtherSelected]);
  const activePanes = useMemo(
    () => activeRepoPaths.map((path) => rows.find((row) => row.path === path)).filter((row): row is ServiceBranchDivergence => row !== undefined),
    [activeRepoPaths, rows],
  );

  // The filter editor and the actions menu are modals too — every dialogOpen consumer
  // (zoneInputCaptured, logsPaneGridArrowsActive) treats them like fullscreen, since all of them
  // capture every keystroke.
  const dialogOpen = logsFullscreenTarget !== null || filterEditor !== null || actionsMenu !== null;

  // The committed scope the open editor works on — read live, so list changes apply immediately.
  function currentScopeOf(editor: FilterEditorState): LogFilterScope {
    return editor.scope === 'global' ? globalFilter : (paneFilters[editor.repoPath ?? ''] ?? DEFAULT_LOG_FILTER);
  }

  const windowSize = useWindowSize();
  // Every terminal-row/column budget the render derives from the live window size (pane grid,
  // fullscreen preview, filter-history grid browser, the two service lists' BoundedList windows)
  // — computed by one pure function (logs-zone.logic.ts), unit-testable without Ink.
  const layoutBudget = computeLogsLayout({
    windowColumns: windowSize.columns,
    listRatio,
    windowRows: windowSize.rows,
    activePaneCount: activePanes.length,
    edtServiceCount: edtServices.length,
    otherServiceCount: otherServices.length,
    filterEditorOpen: filterEditor !== null,
    historyGridOpen: historyGridCursor !== null,
    filterHistoryGridMaxRows,
    filterEditorView: filterEditor?.view,
    filterRuleCount: filterEditor === null ? 0 : filterEditor.view === 'library' ? ruleSets.length : currentScopeOf(filterEditor).rules.length,
    actionsMenuRows: actionsMenu === null ? 0 : logsActionsMenuRows(actionsMenu),
  });

  return {
    rows,
    focusedEdt,
    edtServices,
    otherServices,
    withoutContainerServices,
    clampedEdtCursor,
    clampedOtherCursor,
    displayHealthFor,
    activeRepoPaths,
    activePanes,
    dialogOpen,
    currentScopeOf,
    ...layoutBudget,
  };
}

export type LogsDerived = ReturnType<typeof useLogsDerived>;
