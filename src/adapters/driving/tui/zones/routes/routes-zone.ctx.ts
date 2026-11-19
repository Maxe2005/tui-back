// tui/zones/routes: routes-zone.ctx — the shared context handed to the key handlers and the render helpers:
// every hook layer's return value in one flat object (names are unique across layers).
import type { RoutesBaseCtx } from './use-routes-derived.js';
import type { RoutesResponseTree } from './use-routes-response-tree.js';
import type { RoutesBodyEditor } from './use-routes-body-editor.js';
import type { RoutesPaneActions } from './use-routes-pane-actions.js';

export type RoutesZoneCtx = RoutesBaseCtx & RoutesResponseTree & RoutesBodyEditor & RoutesPaneActions;
