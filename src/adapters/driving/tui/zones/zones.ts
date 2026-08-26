import type { GatedTabStatus, ResolveTabVisibilityData } from '../../../../core/edt/resolve-tab-visibility.js';

export type ZoneId =
  | 'dashboard'
  | 'edts'
  | 'update'
  | 'logs'
  | 'routes'
  | 'shared-types';

export type StatusColorKey = 'success' | 'error' | 'warning' | 'info';

export type Zone = {
  id: ZoneId;
  mnemonic: string;
  label: string;
  statusColor: StatusColorKey;
};

export const ZONES: readonly Zone[] = [
  {
    id: 'dashboard',
    mnemonic: 'd',
    label: 'Dashboard',
    statusColor: 'info',
  },
  {
    id: 'edts',
    mnemonic: 'e',
    label: 'EDTs',
    statusColor: 'info',
  },
  {
    id: 'update',
    mnemonic: 'u',
    label: 'Update',
    statusColor: 'warning',
  },
  {
    id: 'logs',
    mnemonic: 'l',
    label: 'Logs',
    statusColor: 'info',
  },
  {
    id: 'routes',
    mnemonic: 'r',
    label: 'Routes',
    statusColor: 'info',
  },
  {
    id: 'shared-types',
    mnemonic: 's',
    label: 'Shared types',
    statusColor: 'info',
  },
];

export function isZoneId(value: string): value is ZoneId {
  return ZONES.some((zone) => zone.id === value);
}

// The full zone-id set — the default `reachable` param below, and the baseline every
// gated-tab computation narrows away from (Story 2.13: only 'omitted' ever removes a zone
// from this set; 'disabled' stays reachable).
export const ALL_ZONE_IDS: ReadonlySet<ZoneId> = new Set(ZONES.map((zone) => zone.id));

// Story 2.13: only `routes`/`shared-types` are manifest-gated; every other zone is always
// 'enabled' — there is no tabVisibility entry for it because it can never be
// omitted/disabled.
export function zoneGatedStatus(
  zoneId: ZoneId,
  tabVisibility: ResolveTabVisibilityData,
): GatedTabStatus {
  if (zoneId === 'routes') {
    return tabVisibility.routes.status;
  }
  if (zoneId === 'shared-types') {
    return tabVisibility.sharedTypes.status;
  }
  return 'enabled';
}

// The reachable-zone set `nextZoneId`/`shouldSwitchZone` narrow wrap-nav/mnemonic dispatch
// to (Story 2.13): all zones minus whichever gated tab(s) are currently 'omitted' —
// 'disabled' tabs stay reachable (landed on, never skipped).
export function resolveReachableZones(tabVisibility: ResolveTabVisibilityData): ReadonlySet<ZoneId> {
  return new Set(
    ZONES.filter((zone) => zoneGatedStatus(zone.id, tabVisibility) !== 'omitted').map((zone) => zone.id),
  );
}

// Story 2.12: wrap-arithmetic over the full `ZONES` order, kept as its own pure function
// (mirrors shouldSwitchZone's lookup shape in app-shell.tsx). Story 2.13 adds the optional
// `reachable` param (defaults to every zone, preserving 2.12's original behavior): wrap
// traversal only ever considers zones in this set, so an omitted tab is skipped entirely
// while a disabled one (still in the set) can be landed on. `current` itself is expected to
// always be in `reachable` in practice (AppShell falls back off an omitted active zone
// immediately — see shouldFallbackToDashboard) but a defensive fallback to the first
// reachable zone covers the case where it momentarily isn't.
export function nextZoneId(
  current: ZoneId,
  direction: 1 | -1,
  reachable: ReadonlySet<ZoneId> = ALL_ZONE_IDS,
): ZoneId {
  const order = ZONES.filter((zone) => reachable.has(zone.id));
  if (order.length === 0) {
    return current;
  }
  const index = order.findIndex((zone) => zone.id === current);
  if (index === -1) {
    return order[0]!.id;
  }
  const nextIndex = (index + direction + order.length) % order.length;
  return order[nextIndex]!.id;
}
