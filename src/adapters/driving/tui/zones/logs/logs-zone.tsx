import type { AppStore } from '../../store/app-store.js';
import { ZonePlaceholder } from '../../shared/components/index.js';

export function LogsZone({ useStore }: { useStore?: AppStore }) {
  return <ZonePlaceholder zoneId="logs" useStore={useStore} />;
}
