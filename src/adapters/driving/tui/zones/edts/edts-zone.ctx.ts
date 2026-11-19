// tui/zones/edts: edts-zone.ctx — the shared context handed to the effects, the input dispatcher
// and the render subcomponents: every layer's return value in one flat object (names are unique
// across layers).
import type { AppStore } from '../../store/app-store.js';
import type { EdtsState } from './use-edts-state.js';
import type { EdtsDerived } from './use-edts-derived.js';
import type { EdtsHandlers } from './use-edts-handlers.js';

export type EdtsZoneCtx = { useStore: AppStore } & EdtsState & EdtsDerived & EdtsHandlers;
