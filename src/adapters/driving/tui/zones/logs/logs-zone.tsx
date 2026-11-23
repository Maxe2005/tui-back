// tui/zones/logs: the Logs zone — two multi-select service lists (active-EDT members / other
// manifest services) drive an auto-resizing grid of scrollable log panes, with a per-pane
// fullscreen view and a two-tier text/regex/level filter. This file only composes the layers:
// state → derived → effects → actions → one `useInput` dispatcher (use-logs-input.ts) that routes
// every keystroke to per-mode handlers (overlays first); the render lives in logs-service-lists.tsx
// and the pane/modal components.
import { Box, Text } from 'ink';
import { DimAnnotation } from '../../shared/components/feedback/dim-annotation.js';
import { ZoneLayout } from '../../shared/components/zone-layout.js';
import { colors } from '../../shared/theme/theme.js';
import { useAppStore, type AppStore } from '../../store/app-store.js';
import { FullscreenPane } from './fullscreen-pane.js';
import { LogFilterEditor } from './log-filter-editor.js';
import { LogsActionsMenu } from './logs-actions-menu.js';
import { LogsGrid } from './logs-grid.js';
import { LogsServiceLists } from './logs-service-lists.js';
import { isPaneEngagedInGlobalFilter, isPaneWrapped } from './logs-zone.logic.js';
import type { LogsZoneCtx } from './logs-zone.ctx.js';
import { createEditorActions } from './logs-zone.editor-actions.js';
import { createPaneActions } from './logs-zone.pane-actions.js';
import { useLogsDerived } from './use-logs-derived.js';
import { useLogsEffects } from './use-logs-effects.js';
import { useLogsInput } from './use-logs-input.js';
import { useLogsState } from './use-logs-state.js';

export function LogsZone({ useStore = useAppStore }: { useStore?: AppStore }) {
  const state = useLogsState(useStore);
  const derived = useLogsDerived(state);
  const base = { ...state, ...derived };
  useLogsEffects(useStore, base);
  const c: LogsZoneCtx = { useStore, ...base, ...createPaneActions(base), ...createEditorActions(base) };
  useLogsInput(c);

  const {
    logsFullscreenTarget,
    logsFullscreenServiceName,
    logsPanes,
    visibility,
    paneWrap,
    fullscreenVisibleLines,
    fullscreenContentWidth,
    globalFilter,
    paneFilterEngaged,
    paneFilters,
    restartMode,
    rulesWarning,
    activePanes,
    visiblePaneCount,
    layout,
    paneVisibleLines,
    paneContentWidth,
    paneFocus,
    subFocus,
    filterEditor,
    currentScopeOf,
    rulesListMaxVisibleRows,
    rows,
    ruleSets,
    historyForEditor,
    filterHistoryGridMaxRows,
    historyGridCursor,
    historyGridScroll,
    historyGridAvailableWidth,
    historyGridAvailableHeight,
    actionsMenu,
  } = c;

  return (
    <Box flexDirection="column" flexGrow={1} backgroundColor={colors.surface}>
      {logsFullscreenTarget !== null ? (
        <FullscreenPane
          repoPath={logsFullscreenTarget}
          serviceName={logsFullscreenServiceName}
          pane={logsPanes[logsFullscreenTarget]}
          visibility={visibility}
          wrapLines={isPaneWrapped(paneWrap, logsFullscreenTarget)}
          visibleLines={fullscreenVisibleLines}
          contentWidth={fullscreenContentWidth}
          globalFilter={globalFilter}
          engaged={isPaneEngagedInGlobalFilter(paneFilterEngaged, logsFullscreenTarget)}
          ownFilter={paneFilters[logsFullscreenTarget] ?? null}
          restartMode={restartMode}
        />
      ) : (
        <Box flexDirection="column" flexGrow={1} minHeight={0}>
          {/* The warning shares the title row, so the row budget is unchanged. */}
          <Box flexDirection="row" height={1} overflow="hidden">
            <Text color={colors['text-dim']}>LOGS</Text>
            {rulesWarning !== null ? (
              <Text color={colors.warning} wrap="truncate-end">
                {'  '}
                {rulesWarning}
              </Text>
            ) : null}
          </Box>
          <ZoneLayout
            zoneId="logs"
            useStore={useStore}
            first={<LogsServiceLists c={c} />}
            second={
              <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden">
                {activePanes.length === 0 ? (
                  <DimAnnotation text="No service selected — select one or more services on the left to stream their logs." />
                ) : (
                  <LogsGrid
                    panes={activePanes.slice(0, visiblePaneCount)}
                    hiddenPaneCount={activePanes.length - visiblePaneCount}
                    logsPanes={logsPanes}
                    layout={layout}
                    visibleLines={paneVisibleLines}
                    contentWidth={paneContentWidth}
                    visibility={visibility}
                    paneWrap={paneWrap}
                    subFocused={paneFocus === 'panes' ? subFocus : -1}
                    globalFilter={globalFilter}
                    paneFilterEngaged={paneFilterEngaged}
                    paneFilters={paneFilters}
                    restartMode={restartMode}
                  />
                )}
              </Box>
            }
          />
        </Box>
      )}
      {filterEditor !== null ? (
        <LogFilterEditor
          editor={filterEditor}
          filterScope={currentScopeOf(filterEditor)}
          rulesMaxVisibleRows={rulesListMaxVisibleRows}
          serviceName={filterEditor.repoPath !== null ? (rows.find((row) => row.path === filterEditor.repoPath)?.service ?? null) : null}
          ruleSets={ruleSets}
          history={historyForEditor(filterEditor)}
          gridMaxRows={filterHistoryGridMaxRows}
          gridCursor={historyGridCursor}
          gridScrollOffset={historyGridScroll}
          gridAvailableWidth={historyGridAvailableWidth}
          gridAvailableHeight={historyGridAvailableHeight}
        />
      ) : null}
      {actionsMenu !== null ? <LogsActionsMenu menu={actionsMenu} restartMode={restartMode} /> : null}
    </Box>
  );
}
