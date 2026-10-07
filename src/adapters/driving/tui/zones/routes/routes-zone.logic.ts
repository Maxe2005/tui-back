// tui/zones/routes/logic: the Routes zone's pure formatting/selection logic, kept out of
// routes-zone.tsx so the component stays scannable. Every keystroke behavior is a standalone
// pure function, unit-tested directly; the component's `useInput` stays a thin dispatcher.
import type { Route } from '../../../../../core/ports/route-scanner.js';
import type { FireResult } from '../../../../../core/routes/fire-request.js';
import { MAX_BODY_CHARS as MAX_FIRE_BODY_CHARS } from '../../shared/components/json-tree/model.js';
import type { FooterContextId } from '../../keybindings/index.js';
import { formatByteSize } from './routes-request.logic.js';

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

// The list row is `METHOD path` only: the summary is deliberately NOT rendered in the list (a
// long summary wraps and makes rows taller than the one-row budget BoundedList assumes) — it
// only appears in the detail pane (formatRouteDetail) for the focused route.
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

// The fired view is `status + duration + body` (DetailPane Text-safe, same single-string
// constraint as the route detail above).
export function formatFireResult(result: FireResult): string {
  return `${result.status} · ${result.durationMs}ms\n\n${result.body}`;
}

// The Response header keeps the status line while the body moves into the JsonTree
// (DetailPane's single-<Text> constraint forbids nesting the tree inside), plus the body size —
// `≥` when the body hit core's 64K-character cap, since the real response was larger.
export function formatFireStatus(result: FireResult): string {
  const capped = result.body.length >= MAX_FIRE_BODY_CHARS;
  return `${result.status} · ${result.durationMs}ms · ${capped ? '≥' : ''}${formatByteSize(result.body)}`;
}

// Auth failures render distinctly from generic failures so a permission mismatch or a down auth
// route is never mistaken for a broken endpoint. Non-auth fire errors get the same
// human-friendly treatment (prefix + raw message) instead of a raw pass-through.
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

// The list cursor's route — the one `Enter` opens and the pane shows. A pure dispatch helper so
// the keystroke behavior is unit-testable without Ink. Returns the cursor route, or undefined
// for an empty list.
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

export type RoutesFooterInput = {
  // The route list is not shown (loading, scan failed, no routes): there is nothing to press.
  unavailable: boolean;
  filterEditing: boolean;
  paneFocused: boolean;
  paneTab: 'request' | 'response';
  listEditable: boolean;
  filterPanelOpen: boolean;
  // Response tab: how the last response renders; null when there is none to classify.
  responseKind: 'json' | 'raw' | 'empty' | null;
  // Request tab.
  section: 'params' | 'query' | 'headers' | 'body';
  rowEditing: boolean;
  rowCount: number;
  editor: { open: boolean; raw: boolean; editing: boolean; canAdd: boolean };
};

// The footer context of the Routes zone: the list, the filter field, or whichever part of the
// focused right pane owns the keyboard. An unavailable list only claims the footer while input is
// captured, so the zone and global keys stay advertised when they work.
export function routesFooterContext(input: RoutesFooterInput): FooterContextId | null {
  const captured = input.filterEditing || input.paneFocused;
  if (input.unavailable) {
    return captured ? 'busy' : null;
  }
  if (!input.paneFocused) {
    if (input.filterEditing) {
      return 'routes-filter';
    }
    return input.listEditable ? 'routes-list-editable' : 'routes-list';
  }
  if (input.paneTab === 'response') {
    if (input.responseKind === 'raw') {
      return 'routes-response-raw';
    }
    if (input.responseKind === 'json') {
      return input.filterPanelOpen ? 'routes-rules-panel' : 'routes-response-tree';
    }
    return 'routes-response-empty';
  }
  if (input.section === 'body') {
    const { editor } = input;
    if (!editor.open) {
      return 'routes-section';
    }
    if (editor.raw) {
      return 'routes-body-raw';
    }
    if (editor.editing) {
      return 'confirm';
    }
    if (input.filterPanelOpen) {
      return 'routes-rules-panel';
    }
    return editor.canAdd ? 'routes-body-tree-add' : 'routes-body-tree';
  }
  if (input.rowEditing) {
    return 'confirm';
  }
  if (input.section === 'params') {
    return input.rowCount > 0 ? 'routes-rows-readonly' : 'routes-section';
  }
  return input.rowCount > 0 ? 'routes-rows' : 'routes-rows-empty';
}

export const UNAVAILABLE_FOOTER_INPUT: RoutesFooterInput = {
  unavailable: true,
  filterEditing: false,
  paneFocused: false,
  paneTab: 'request',
  listEditable: false,
  filterPanelOpen: false,
  responseKind: null,
  section: 'params',
  rowEditing: false,
  rowCount: 0,
  editor: { open: false, raw: false, editing: false, canAdd: false },
};
