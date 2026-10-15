// tui/zones/logs: the active-panes grid. Lays panes out row-major over `layout.cols` and renders
// one LogsPaneView per pane; purely presentational, all keystroke handling stays in LogsZone's
// useInput.
import { Box, Text } from 'ink';
import { colors } from '../../shared/theme/theme.js';
import type { ServiceBranchDivergence } from '../../../../../core/edt/list.js';
import type { RestartMode } from '../../../../../core/service-actions/index.js';
import type { LogsPaneData } from '../../store/app-store.js';
import { LogsPaneView } from './logs-pane-view.js';
import {
  isPaneEngagedInGlobalFilter,
  isPaneWrapped,
  type GridLayout,
  type LogFilterSpec,
  type VisibilityFlags,
} from './logs-zone.logic.js';

export function LogsGrid({
  panes,
  hiddenPaneCount = 0,
  logsPanes,
  layout,
  visibleLines,
  contentWidth,
  visibility,
  paneWrap,
  subFocused,
  globalFilter,
  paneFilterEngaged,
  paneFilters,
  restartMode = 'simple',
}: {
  panes: ServiceBranchDivergence[];
  // Active panes that do not fit the grid at a readable size.
  hiddenPaneCount?: number;
  logsPanes: Record<string, LogsPaneData>;
  layout: GridLayout;
  visibleLines: number;
  contentWidth: number;
  visibility: VisibilityFlags;
  paneWrap: Record<string, boolean>;
  subFocused: number;
  globalFilter: LogFilterSpec;
  paneFilterEngaged: Record<string, boolean>;
  paneFilters: Record<string, LogFilterSpec>;
  restartMode?: RestartMode;
}) {
  const cols = Math.max(layout.cols, 1);
  // `panes` is already capped to what fits; the rest is announced below.
  const visiblePaneRows: ServiceBranchDivergence[][] = [];
  for (let i = 0; i < panes.length; i += cols) {
    visiblePaneRows.push(panes.slice(i, i + cols));
  }
  return (
    <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden">
      {visiblePaneRows.map((visiblePanes, rowIndex) => (
        <Box key={rowIndex} flexDirection="row" flexGrow={1} flexBasis={0} minHeight={0}>
          {visiblePanes.map((service, colIndex) => {
            const index = rowIndex * cols + colIndex;
            return (
              <LogsPaneView
                key={service.path}
                service={service}
                pane={logsPanes[service.path]}
                visibility={visibility}
                wrapLines={isPaneWrapped(paneWrap, service.path)}
                visibleLines={visibleLines}
                contentWidth={contentWidth}
                focused={index === subFocused}
                globalFilter={globalFilter}
                engaged={isPaneEngagedInGlobalFilter(paneFilterEngaged, service.path)}
                ownFilter={paneFilters[service.path] ?? null}
                restartMode={restartMode}
              />
            );
          })}
        </Box>
      ))}
      {hiddenPaneCount > 0 ? <Text color={colors['text-dim']} wrap="truncate-end">{`+${hiddenPaneCount} more panes (enlarge the terminal)`}</Text> : null}
    </Box>
  );
}
