// tui/shared/settings/services.logic: the Services tab's row model and key mapping (per-service health-check toggle). Pure; no Ink/React.
import type { TextEditKey } from '../../components/inputs/text-edit.js';
import { nextCursorForKey } from '../../keys/list-cursor.js';
import type { BranchDivergenceEntryError, ServiceBranchDivergence } from '../../../../../../core/edt/list.js';

// Services tab: one "health check" checkbox per registered service (checked = enabled), listed
// from the already-loaded EDT branch rows plus the manifests that failed to load. A service with
// no `healthUrl`, or whose manifest is unreadable, is listed but cannot be toggled.
export type ServicesSettingsRow = {
  key: string;
  service: string;
  // null = toggleable; otherwise the dim reason shown next to the disabled row.
  disabledReason: string | null;
};

export const SERVICES_NO_HEALTH_URL_REASON = 'no healthUrl';
export const SERVICES_MANIFEST_UNAVAILABLE_REASON = 'manifest unavailable';

export function buildServicesSettingsRows(
  branches: readonly Pick<ServiceBranchDivergence, 'service' | 'path' | 'healthUrl'>[] | null,
  errors: readonly BranchDivergenceEntryError[],
): ServicesSettingsRow[] {
  const listed: ServicesSettingsRow[] = (branches ?? []).map((row) => ({
    key: row.path,
    service: row.service,
    disabledReason: row.healthUrl !== undefined && row.healthUrl.trim() !== '' ? null : SERVICES_NO_HEALTH_URL_REASON,
  }));
  const unreadable: ServicesSettingsRow[] = errors.map((entry) => ({
    key: entry.path,
    // No manifest means no service name: the repo directory stands in for it.
    service: entry.path.split('/').filter((part) => part !== '').pop() ?? entry.path,
    disabledReason: SERVICES_MANIFEST_UNAVAILABLE_REASON,
  }));
  return [...listed, ...unreadable];
}

export type ServicesSettingsStep = { type: 'move'; cursor: number } | { type: 'toggle'; service: string } | { type: 'ignore' };

// Up/Down move over every row (disabled ones included, so their reason can be read); Space
// toggles only a toggleable row.
export function resolveServicesSettingsKey(input: string, key: TextEditKey, cursor: number, rows: readonly ServicesSettingsRow[]): ServicesSettingsStep {
  const moved = nextCursorForKey(key, cursor, rows.length);
  if (moved !== null) {
    return { type: 'move', cursor: moved };
  }
  const row = rows[cursor];
  if (input === ' ' && row !== undefined && row.disabledReason === null) {
    return { type: 'toggle', service: row.service };
  }
  return { type: 'ignore' };
}
