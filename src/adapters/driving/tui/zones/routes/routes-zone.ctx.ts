// tui/zones/routes: routes-zone.ctx — the shared context handed to the key handlers and the render helpers:
// every hook layer's return value in one flat object (names are unique across layers).
import type { RoutesBaseCtx } from './hooks/use-routes-derived.js';
import type { RoutesResponseTree } from './hooks/use-routes-response-tree.js';
import type { RoutesBodyEditor } from './hooks/use-routes-body-editor.js';
import type { RoutesPaneActions } from './hooks/use-routes-pane-actions.js';

export type RoutesZoneCtx = RoutesBaseCtx & RoutesResponseTree & RoutesBodyEditor & RoutesPaneActions;
