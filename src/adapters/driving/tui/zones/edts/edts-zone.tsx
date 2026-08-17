import type { AppStore } from '../../store/app-store.js';
import { ZonePlaceholder } from '../../shared/components/index.js';

export function EdtsZone({ useStore }: { useStore?: AppStore }) {
  return <ZonePlaceholder zoneId="edts" useStore={useStore} />;
}
