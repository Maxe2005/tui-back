import type { ComponentType } from 'react';
import type { AppStore } from '../store/app-store.js';
import type { ZoneId } from './zones.js';
import { DashboardZone } from './dashboard/dashboard-zone.js';
import { EdtsZone } from './edts/edts-zone.js';
import { UpdateZone } from './update/update-zone.js';
import { LogsZone } from './logs/logs-zone.js';
import { RoutesZone } from './routes/routes-zone.js';
import { SharedTypesZone } from './shared-types/shared-types-zone.js';

export type ZoneScreenProps = {
  useStore?: AppStore;
};

const ZONE_SCREENS: Record<ZoneId, ComponentType<ZoneScreenProps>> = {
  dashboard: DashboardZone,
  edts: EdtsZone,
  update: UpdateZone,
  logs: LogsZone,
  routes: RoutesZone,
  'shared-types': SharedTypesZone,
};

export function getZoneScreen(
  zone: ZoneId,
): ComponentType<ZoneScreenProps> {
  return ZONE_SCREENS[zone];
}
