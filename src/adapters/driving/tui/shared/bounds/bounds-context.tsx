// tui/shared/bounds: the top-down box handed to every region. The shell provides the zone
// region (window minus chrome), ZoneLayout narrows it per pane; a consumer outside any provider
// falls back to the live window size.
import { createContext, useContext, type ReactNode } from 'react';
import { useWindowSize } from 'ink';
import { MIN_PANE_ROWS, type Bounds } from './bounds.js';

const BoundsContext = createContext<Bounds | null>(null);

export function BoundsProvider({ columns, rows, children }: Bounds & { children: ReactNode }) {
  return <BoundsContext.Provider value={{ columns: Math.max(0, columns), rows: Math.max(0, rows) }}>{children}</BoundsContext.Provider>;
}

export function useBounds(): Bounds {
  const provided = useContext(BoundsContext);
  const windowSize = useWindowSize();
  return provided ?? { columns: windowSize.columns, rows: windowSize.rows };
}

// The rows a list may use inside the current region: bounds minus the caller's own chrome
// (headers, hints, frame), never below the pane minimum.
export function useRowBudget(chromeRows: number): number {
  const { rows } = useBounds();
  return Math.max(MIN_PANE_ROWS, rows - chromeRows);
}
