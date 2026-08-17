import type { AppStore } from '../../store/app-store.js';
import { ZonePlaceholder } from '../../shared/components/index.js';

export function RoutesZone({ useStore }: { useStore?: AppStore }) {
  return <ZonePlaceholder zoneId="routes" useStore={useStore} />;
}
