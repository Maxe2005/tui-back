// tui/zones/logs: logs-zone.ctx — the shared context handed to the key handlers and the render
// helpers: every layer's return value in one flat object (names are unique across layers).
import type { useInput } from '../../shared/hooks/use-input.js';
import type { AppStore } from '../../store/app-store.js';
import type { LogsState } from './hooks/use-logs-state.js';
import type { LogsDerived } from './hooks/use-logs-derived.js';
import type { LogsPaneActions } from './logs-zone.pane-actions.js';
import type { LogsEditorActions } from './logs-zone.editor-actions.js';

export type LogsKey = Parameters<Parameters<typeof useInput>[0]>[1];

export type LogsZoneCtx = { useStore: AppStore } & LogsState & LogsDerived & LogsPaneActions & LogsEditorActions;
