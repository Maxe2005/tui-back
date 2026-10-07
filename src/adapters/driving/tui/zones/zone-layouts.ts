// tui/zones: the declarative per-zone layout contract — each zone's resizable boundaries
// (orientation, default ratio, min, max). The single source of truth for ratio defaults and
// validation, Ctrl+W resize-mode (entry, Tab cycling, arrow axis) and footer advertising.
import type { ZoneId } from './zones.js';

export type BoundarySpec = {
  orientation: 'vertical' | 'horizontal';
  defaultRatio: number;
  min: number;
  max: number;
};

export type ZoneLayoutSpec = { boundaries: readonly BoundarySpec[] };

const LIST_DETAIL_BOUNDARY: BoundarySpec = { orientation: 'vertical', defaultRatio: 2 / 5, min: 0.2, max: 0.8 };
const STACKED_BOUNDARY: BoundarySpec = { orientation: 'horizontal', defaultRatio: 2 / 5, min: 0.2, max: 0.8 };

// A zone with an empty `boundaries` list is single-pane: Ctrl+W is a no-op there.
export const ZONE_LAYOUTS: Record<ZoneId, ZoneLayoutSpec> = {
  dashboard: { boundaries: [LIST_DETAIL_BOUNDARY] },
  // 0: list<->detail, 1: EDTS<->services, 2: EDT SERVICES<->OTHER SERVICES.
  edts: { boundaries: [LIST_DETAIL_BOUNDARY, STACKED_BOUNDARY, STACKED_BOUNDARY] },
  update: { boundaries: [LIST_DETAIL_BOUNDARY] },
  // 0: service lists<->pane grid. 0.27 is about the 32 columns the list column used to be fixed at, on a 120-column terminal.
  logs: { boundaries: [{ orientation: 'vertical', defaultRatio: 0.27, min: 0.15, max: 0.5 }] },
  routes: { boundaries: [LIST_DETAIL_BOUNDARY] },
  'shared-types': { boundaries: [LIST_DETAIL_BOUNDARY] },
};

export function boundaryCount(zone: ZoneId): number {
  return ZONE_LAYOUTS[zone].boundaries.length;
}

export function hasResizableBoundary(zone: ZoneId): boolean {
  return boundaryCount(zone) > 0;
}

export function defaultZoneRatios(zone: ZoneId): number[] {
  return ZONE_LAYOUTS[zone].boundaries.map((boundary) => boundary.defaultRatio);
}

export function clampBoundaryRatio(zone: ZoneId, boundaryIndex: number, ratio: number): number {
  const spec = ZONE_LAYOUTS[zone].boundaries[boundaryIndex];
  if (spec === undefined) {
    return Number.isFinite(ratio) ? ratio : 0.5;
  }
  const safe = Number.isFinite(ratio) ? ratio : spec.defaultRatio;
  return Math.min(spec.max, Math.max(spec.min, safe));
}

export function boundaryOrientation(zone: ZoneId, boundaryIndex: number): 'vertical' | 'horizontal' {
  return ZONE_LAYOUTS[zone].boundaries[boundaryIndex]?.orientation ?? 'vertical';
}

export function resolveBoundaryFlex(
  zone: ZoneId,
  boundaryIndex: number,
  ratio: number,
): { first: number; second: number } {
  const clamped = clampBoundaryRatio(zone, boundaryIndex, ratio);
  return { first: clamped, second: 1 - clamped };
}
