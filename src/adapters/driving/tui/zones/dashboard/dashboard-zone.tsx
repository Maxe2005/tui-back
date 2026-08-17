import type { AppStore } from '../../store/app-store.js';
import { ZonePlaceholder } from '../../shared/components/index.js';

export function DashboardZone({ useStore }: { useStore?: AppStore }) {
  return <ZonePlaceholder zoneId="dashboard" useStore={useStore} />;
}
