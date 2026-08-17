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

