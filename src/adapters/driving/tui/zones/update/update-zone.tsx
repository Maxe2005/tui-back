import type { AppStore } from '../../store/app-store.js';
import { ZonePlaceholder } from '../../shared/components/index.js';

export function UpdateZone({ useStore }: { useStore?: AppStore }) {
  return <ZonePlaceholder zoneId="update" useStore={useStore} />;
}
