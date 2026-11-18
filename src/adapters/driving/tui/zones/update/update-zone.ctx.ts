// tui/zones/update: update-zone.ctx — the shared context handed to the effects, the input
// dispatcher and the render subcomponents: every layer's return value in one flat object (names
// are unique across layers).
import type { AppStore } from '../../store/app-store.js';
import type { UpdateState } from './use-update-state.js';
import type { UpdateDerived } from './use-update-derived.js';

export type UpdateZoneCtx = { useStore: AppStore } & UpdateState & UpdateDerived;

// Rough terminal-chrome budget (top bar, zone-tab bar, footer, the "UPDATE" title row, the list
// column's section header/loading/error lines) subtracted from the window size before the
// service list's BoundedList sees it — an approximation, like edts-zone.tsx's
// EDTS_SERVICE_LISTS_CHROME_ROWS. Kept here (not in update-zone.tsx) so the layers can import
// them without an import cycle through the composer.
export const UPDATE_SERVICE_LIST_CHROME_ROWS = 8;

// Rows the detail pane keeps around the running list / the recap's result lines.
export const RUNNING_LIST_CHROME_ROWS = 8;
export const RECAP_CHROME_ROWS = 14;
export const RECAP_CONTEXT_MAX_LINES = 4;
