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

// Story 2.12: wrap-arithmetic over the full `ZONES` order, kept as its own pure function
// (mirrors shouldSwitchZone's lookup shape in app-shell.tsx) so Story 2.13 can later narrow
// the candidate set (skip omitted tabs, still land on disabled ones) without rewriting the
// dispatch plumbing around it. Every zone counts as reachable today.
export function nextZoneId(current: ZoneId, direction: 1 | -1): ZoneId {
  const index = ZONES.findIndex((zone) => zone.id === current);
  const nextIndex = (index + direction + ZONES.length) % ZONES.length;
  return ZONES[nextIndex]!.id;
}
