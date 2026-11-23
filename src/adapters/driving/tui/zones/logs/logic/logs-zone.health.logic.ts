// tui/zones/logs: pure health-badge, health-label and no-container row helpers for the LogsZone.
import type { ServiceBranchDivergence } from '../../../../../../core/workspace/edt/lifecycle/list.js';
import type { ServiceStatusState } from '../../../../../../core/runtime/service-status/index.js';
import type { StatusBadgeState } from '../../../shared/components/feedback/status-badge.js';

// ServiceStatusState → StatusBadgeState — `up` → `●`/success, `down` → `○`/error, `restarting` →
// `⣾`/info (StatusBadge's `in-progress`), `unhealthy` → `◐`/warning, `inconsistent` → `⚠`/warning.
// A service with no Docker runtime is its own dim state, never the down treatment. Glyph+color
// always paired, never color alone; accent is never a health color. Shared by every place a
// health badge renders (list rows, grid panes, fullscreen pane).
export function healthBadgeState(health: ServiceStatusState): StatusBadgeState {
  if (health === 'no-container') {
    return 'no-container';
  }
  if (health === 'restarting') {
    return 'in-progress';
  }
  return health;
}

// The text next to a health badge — the raw state except the container-less service, which
// reads as words rather than a kebab-case code, and a restarting service, which names both
// halves of what is happening (a restart was requested, the container is being re-verified)
// instead of the bare state.
export function formatHealthLabel(health: ServiceStatusState): string {
  if (health === 'no-container') {
    return 'no container';
  }
  if (health === 'restarting') {
    return 'restart requested — re-verifying';
  }
  return health;
}

// True when a row or pane must read as restarting — either the slice's in-flight restart flag
// or docker itself reporting the state. One predicate so list rows and pane headers agree.
// A container-less row never restarts, so it never reads as restarting either.
export function isRestartingDisplay(restarting: boolean, health: ServiceStatusState): boolean {
  if (health === 'no-container') {
    return false;
  }
  return restarting || health === 'restarting';
}

// Splits an already-partitioned selectable list into the rows that stay selectable and the
// container-less rows that move to the info-only third section. Presence unknown (manifest
// still loading or unloadable) stays selectable — only a positively-resolved no-container
// row ever leaves its membership list.
export function splitNoContainerRows(
  services: readonly ServiceBranchDivergence[],
  noContainerByPath: Readonly<Record<string, boolean>>,
): { selectable: ServiceBranchDivergence[]; withoutContainer: ServiceBranchDivergence[] } {
  const selectable: ServiceBranchDivergence[] = [];
  const withoutContainer: ServiceBranchDivergence[] = [];
  for (const service of services) {
    if (noContainerByPath[service.path] === true) {
      withoutContainer.push(service);
    } else {
      selectable.push(service);
    }
  }
  return { selectable, withoutContainer };
}
