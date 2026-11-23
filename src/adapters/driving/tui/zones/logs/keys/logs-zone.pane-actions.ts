// tui/zones/logs: logs-zone.pane-actions — per-pane operations of the Logs zone: scrolling (with
// the oldest-line history fetch), the `a` actions menu, registry shortcuts and the service name
// of a pane. Plain functions rebuilt each render over the zone's state, like the original closures.
import { basename } from 'node:path';
import { LOGS_ACTIONS_MENU_LIST_ERROR } from '../logs-actions-menu.js';
import {
  adjustScrollOffset,
  applyLogRules,
  filterVisibleLines,
  isAtOldestLine,
  isPaneEngagedInGlobalFilter,
} from '../logic/logs-zone.logic.js';
import type { LogsState } from '../hooks/use-logs-state.js';
import type { LogsDerived } from '../hooks/use-logs-derived.js';

export function createPaneActions(s: LogsState & LogsDerived) {
  const {
    logsPanes,
    paneFilterEngaged,
    globalFilter,
    paneFilters,
    visibility,
    setLogsPaneScrollOffset,
    loadOlderLogsPane,
    actionsMenuSeq,
    setActionsMenu,
    listLogsPaneActions,
    runLogsPaneAction,
    runLogsPaneShortcut,
    logsFullscreenTarget,
    logsFullscreenServiceName,
    rows,
  } = s;

  function handlePaneScroll(repoPath: string, direction: 'up' | 'down'): void {
    const pane = logsPanes[repoPath];
    // Scroll math (and the "at oldest line" history-fetch trigger below) uses the *visible*
    // (toggled and filtered) line count, not the raw buffered `lines.length` — otherwise scroll
    // position and the oldest-line trigger diverge from what's actually rendered.
    const engagedGlobal = isPaneEngagedInGlobalFilter(paneFilterEngaged, repoPath) ? globalFilter : null;
    const ownFilter = paneFilters[repoPath] ?? null;
    const visibleLineCount = pane ? applyLogRules(filterVisibleLines(pane.lines, visibility), engagedGlobal, ownFilter).length : 0;
    const nextOffset = adjustScrollOffset(pane?.scrollOffset ?? 0, direction, visibleLineCount);
    setLogsPaneScrollOffset(repoPath, nextOffset);
    if (direction === 'up' && isAtOldestLine(nextOffset, visibleLineCount) && pane && !pane.noMoreHistory) {
      void loadOlderLogsPane(repoPath);
    }
  }

  // Opens the `a` actions menu on one pane and lists the registry's actions for its service.
  // A failed listing (or unwired restart ports) leaves one error line; Esc still closes.
  function openActionsMenu(repoPath: string, service: string): void {
    actionsMenuSeq.current += 1;
    const seq = actionsMenuSeq.current;
    setActionsMenu({ repoPath, service, cursor: 0, actions: null, error: null });
    void listLogsPaneActions(repoPath)
      .catch(() => null)
      .then((actions) => {
        if (actionsMenuSeq.current !== seq) {
          return;
        }
        setActionsMenu((current) =>
          current === null ? null : { ...current, actions, error: actions === null ? LOGS_ACTIONS_MENU_LIST_ERROR : null },
        );
      });
  }
  function closeActionsMenu(): void {
    actionsMenuSeq.current += 1;
    setActionsMenu(null);
  }
  // The slice's actions never reject by contract; the catch keeps a broken one from surfacing as
  // an unhandled rejection.
  function runPaneAction(repoPath: string, actionId: string, service: string): void {
    void runLogsPaneAction(repoPath, actionId, service).catch(() => {});
  }
  function runPaneShortcut(repoPath: string, shortcut: 'restart' | 'ide', service: string): void {
    void runLogsPaneShortcut(repoPath, shortcut, service).catch(() => {});
  }
  // The fullscreen pane's service name — captured when it opened, else the listed row, else the
  // repo directory's name (never the full path).
  function serviceNameFor(repoPath: string): string {
    return (
      (logsFullscreenTarget === repoPath ? logsFullscreenServiceName : null) ??
      rows.find((row) => row.path === repoPath)?.service ??
      (basename(repoPath) || repoPath)
    );
  }

  return { handlePaneScroll, openActionsMenu, closeActionsMenu, runPaneAction, runPaneShortcut, serviceNameFor };
}

export type LogsPaneActions = ReturnType<typeof createPaneActions>;
