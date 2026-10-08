// tui/shared/bounds: the top-down box handed to every region. The shell provides the zone
// region (window minus chrome), ZoneLayout narrows it per pane; a consumer outside any provider
// falls back to the live window size.
import { createContext, useContext, type ReactNode } from 'react';
import { useWindowSize } from 'ink';
import type { Bounds } from './bounds.js';

const BoundsContext = createContext<Bounds | null>(null);

export function BoundsProvider({ columns, rows, children }: Bounds & { children: ReactNode }) {
  return <BoundsContext.Provider value={{ columns: Math.max(0, columns), rows: Math.max(0, rows) }}>{children}</BoundsContext.Provider>;
}

export function useBounds(): Bounds {
  const provided = useContext(BoundsContext);
  const windowSize = useWindowSize();
  return provided ?? { columns: windowSize.columns, rows: windowSize.rows };
}
