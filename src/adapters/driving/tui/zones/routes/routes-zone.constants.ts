// tui/zones/routes: routes-zone.constants — first-paint row-budget estimates shared by the zone and its derived hook.

// First-paint estimate of the route list's row budget (top bar + tab bar + footer + the
// list pane's own header/filter/hint lines), used only until useElementSize has measured the
// list's real flex-bound area — after that the budget is the measured height, so the list can
// never overrun the tab bar above or the footer below.
export const ROUTES_LIST_CHROME_ROWS = 9;
// First-paint estimate of the response tree's total row budget (shell chrome + the route
// detail + the Response header + the right pane's own hint line around the tree's own
// box); the measured box height takes over after mount, like the list above.
export const RESPONSE_AREA_CHROME_ROWS = 13;

// The Favorites pane above the route list: at most this many body rows (BoundedList budget,
// indicators included), and the rows the route list always keeps — the pane shrinks (down to
// nothing) before the list does.
export const ROUTES_FAVORITES_MAX_BODY_ROWS = 5;
export const ROUTES_MIN_LIST_ROWS = 4;
