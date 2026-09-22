// tui/zones/routes/logic: story 6.1 — the Routes zone's pure formatting/selection logic,
// kept out of routes-zone.tsx so the component stays scannable (idiom:
// edts-zone.logic.ts). Every keystroke behavior is a standalone pure function,
// unit-tested directly; the `useInput` callback in the component stays a thin dispatcher.
import type { Route } from '../../../../../core/ports/route-scanner.js';

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

// The spec's CLI row shape (`METHOD path`) doubles as the list-row label; the summary (when
// the scanner found one) rides as the row's dim meta, never crowding the label.
export function formatRouteRow(route: Route): { label: string; meta?: string } {
  return route.summary === undefined
    ? { label: `${route.method} ${route.path}` }
    : { label: `${route.method} ${route.path}`, meta: route.summary };
}

// DetailPane wraps its children in a single Ink <Text> internally, so the detail is one
// joined string (UX-DR17, same constraint edts-zone.tsx documents) — never nested <Box>.
export function formatRouteDetail(route: Route): string {
  const summary = route.summary ?? 'No summary available.';
  return `${route.method} ${route.path}\n\n${summary}`;
}
