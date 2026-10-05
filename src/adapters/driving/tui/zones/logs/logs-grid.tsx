// tui/zones/logs: the active-panes grid. Lays panes out row-major over `layout.cols` and renders
// one LogsPaneView per pane; purely presentational, all keystroke handling stays in LogsZone's
// useInput.
import { Box } from 'ink';
import type { ServiceBranchDivergence } from '../../../../../core/edt/list.js';
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
}: {
  panes: ServiceBranchDivergence[];
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
}) {
  const cols = Math.max(layout.cols, 1);
  const rowsOfPanes: ServiceBranchDivergence[][] = [];
  for (let i = 0; i < panes.length; i += cols) {
    rowsOfPanes.push(panes.slice(i, i + cols));
  }
  return (
    <Box flexDirection="column" flexGrow={1} minHeight={0}>
      {rowsOfPanes.map((rowPanes, rowIndex) => (
        <Box key={rowIndex} flexDirection="row" flexGrow={1} flexBasis={0} minHeight={0}>
          {rowPanes.map((service, colIndex) => {
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
              />
            );
          })}
        </Box>
      ))}
    </Box>
  );
}
