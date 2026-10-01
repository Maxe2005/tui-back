// tui/zones/routes/logic: story 6.1 — the Routes zone's pure formatting/selection logic,
// kept out of routes-zone.tsx so the component stays scannable (idiom:
// edts-zone.logic.ts). Every keystroke behavior is a standalone pure function,
// unit-tested directly; the `useInput` callback in the component stays a thin dispatcher.
import type { Route } from '../../../../../core/ports/route-scanner.js';
import type { FireResult } from '../../../../../core/routes/fire-request.js';

export type RoutesSelectionDirection = 'up' | 'down';

export function resolveRoutesDirection(key: { upArrow?: boolean; downArrow?: boolean }): RoutesSelectionDirection | null {
  if (key.downArrow === true) {
    return 'down';
  }
  if (key.upArrow === true) {
    return 'up';
  }
  return null;
}

export function moveRoutesSelection(current: number, direction: RoutesSelectionDirection, length: number): number {
  if (length === 0) {
    return 0;
  }
  const next = direction === 'down' ? current + 1 : current - 1;
  return Math.min(Math.max(next, 0), length - 1);
}

// The spec's CLI row shape (`METHOD path`) is the whole list row: the summary is deliberately
// NOT rendered in the list (a long summary wrapped and made rows taller than the one-row
// budget BoundedList assumes) — it only appears in the detail pane (formatRouteDetail) for the
// focused route.
export function formatRouteRow(route: Route): { label: string } {
  return { label: `${route.method} ${route.path}` };
}

// The route filter: case-insensitive, whitespace-separated terms that must ALL appear in the
// row's own label (`METHOD path`) — so `get user` matches `GET /users/{id}` and `post` alone
// narrows to a method. The summary is not matched: it isn't visible in the list, and a row
// matching on hidden text would look like a false positive.
export function filterRoutes(routes: readonly Route[], query: string): Route[] {
  const terms = query.toLowerCase().split(/\s+/).filter((term) => term !== '');
  if (terms.length === 0) {
    return [...routes];
  }
  return routes.filter((route) => {
    const label = formatRouteRow(route).label.toLowerCase();
    return terms.every((term) => label.includes(term));
  });
}

// DetailPane wraps its children in a single Ink <Text> internally, so the detail is one
// joined string (UX-DR17, same constraint edts-zone.tsx documents) — never nested <Box>.
export function formatRouteDetail(route: Route): string {
  const summary = route.summary ?? 'No summary available.';
  return `${route.method} ${route.path}\n\n${summary}`;
}

// Story 6.2: the fired view is `status + duration + body` (DetailPane Text-safe, same
// single-string constraint as the route detail above) — no logs pane (Story 6.4).
export function formatFireResult(result: FireResult): string {
  return `${result.status} · ${result.durationMs}ms\n\n${result.body}`;
}

// Story 6.7: the Response header keeps the status line while the body dump moves into
// the JsonTree (DetailPane's single-<Text> constraint forbids nesting the tree inside).
export function formatFireStatus(result: FireResult): string {
  return `${result.status} · ${result.durationMs}ms`;
}

// Story 6.2: auth failures render distinctly from generic failures so a permission
// mismatch or a down auth route is never mistaken for a broken endpoint. Non-auth fire
// errors get the same human-friendly treatment (prefix + raw message) instead of a raw
// pass-through.
export function formatFireError(code: string, message: string): string {
  switch (code) {
    case 'auth-unauthorized':
      return `Auth failed — the session was rejected even after re-authentication.\n\n${message}`;
    case 'auth-forbidden':
      return `Access forbidden — this session lacks permission for the route.\n\n${message}`;
    case 'auth-endpoint-failed':
      return `Dev auth is unreachable — no request was fired.\n\n${message}`;
    case 'route-exploration-not-activated':
      return `Route exploration is not activated for this repo.\n\n${message}`;
    case 'missing-base-url':
      return `No dev server configured — the route-explorer module has no baseUrl.\n\n${message}`;
    case 'unknown-route':
      return `Unknown route — it is not among the discovered routes.\n\n${message}`;
    case 'route-scan-failed':
      return `Route scan failed — no request was fired.\n\n${message}`;
    case 'request-failed':
      return `Request failed — the dev server could not be reached.\n\n${message}`;
    default:
      if (code.startsWith('manifest-')) {
        return `Manifest problem — the repo manifest could not be loaded.\n\n${message}`;
      }
      return message;
  }
}

// Story 6.2: the Enter key fires the selected route — a pure dispatch helper so the
// keystroke behavior is unit-testable without Ink. Returns the route to fire, or
// undefined when there is nothing to fire (empty list): the component calls
// `fireRoute(target.method, target.path)` only for a defined return.
export function resolveEnterFireTarget(
  routes: Route[] | null | undefined,
  selected: number,
): Route | undefined {
  const list = routes ?? [];
  if (list.length === 0) {
    return undefined;
  }
  return list[Math.min(selected, list.length - 1)];
}
