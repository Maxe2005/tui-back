export type ZoneId =
  | 'dashboard'
  | 'edts'
  | 'update'
  | 'logs'
  | 'routes'
  | 'shared-types';

export type Zone = {
  id: ZoneId;
  mnemonic: string;
  label: string;
};

export const ZONES: readonly Zone[] = [
  { id: 'dashboard', mnemonic: 'd', label: 'Dashboard' },
  { id: 'edts', mnemonic: 'e', label: 'EDTs' },
  { id: 'update', mnemonic: 'u', label: 'Update' },
  { id: 'logs', mnemonic: 'l', label: 'Logs' },
  { id: 'routes', mnemonic: 'r', label: 'Routes' },
  { id: 'shared-types', mnemonic: 's', label: 'shared-types' },
];

export function isZoneId(value: string): value is ZoneId {
  return ZONES.some((zone) => zone.id === value);
}
