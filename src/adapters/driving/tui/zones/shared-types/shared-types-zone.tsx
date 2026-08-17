import type { AppStore } from '../../store/app-store.js';
import { ZonePlaceholder } from '../../shared/components/index.js';

export function SharedTypesZone({ useStore }: { useStore?: AppStore }) {
  return <ZonePlaceholder zoneId="shared-types" useStore={useStore} />;
}
