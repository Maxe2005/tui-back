// tui/zones/dashboard: pure helpers for the Dashboard shell — which body the zone shows, the
// "updated Ns ago" line and the short labels a service row prints for each probed field.
import type { DashboardRegistrySummary, DashboardService } from '../../../../../core/dashboard/snapshot.js';
import type { StatusBadgeState } from '../../shared/components/status-badge.js';

export type DashboardBody = 'registry-error' | 'empty-registry' | 'sections';

// Registry check failure wins over a stale "empty", which wins over any snapshot content.
export function resolveDashboardBody(registryEmpty: boolean | null, registryEmptyStatus: 'idle' | 'loading' | 'error'): DashboardBody {
  if (registryEmptyStatus === 'error') {
    return 'registry-error';
  }
  return registryEmpty === true ? 'empty-registry' : 'sections';
}

export function formatUpdatedAgo(now: number, updatedAt: number): string {
  const seconds = Math.max(0, Math.floor((now - updatedAt) / 1000));
  if (seconds < 60) {
    return `updated ${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `updated ${minutes}m ago` : `updated ${Math.floor(minutes / 60)}h ago`;
}

export function containerLabel(container: DashboardService['container']): { text: string; badge: StatusBadgeState } {
  if (!container.ok) {
    return { text: 'container error', badge: 'error' };
  }
  switch (container.value) {
    case 'up':
      return { text: 'up', badge: 'up' };
    case 'down':
      return { text: 'down', badge: 'down' };
    case 'restarting':
      return { text: 'restarting', badge: 'restarting' };
    case 'no-container':
      return { text: 'no container', badge: 'no-container' };
  }
}

export function branchLabel(service: DashboardService): string {
  return service.branch ?? (service.divergence.detail === undefined ? 'branch unknown' : 'branch error');
}

export function workingTreeLabel(workingTree: DashboardService['workingTree']): string | null {
  if (!workingTree.ok) {
    return 'git error';
  }
  const { uncommitted, mergeInProgress, rebaseInProgress } = workingTree.value;
  const parts = [uncommitted ? 'uncommitted' : '', mergeInProgress ? 'merging' : '', rebaseInProgress ? 'rebasing' : ''].filter((part) => part !== '');
  return parts.length === 0 ? null : parts.join(', ');
}

export function formatRegistrySummary(summary: DashboardRegistrySummary): string {
  return `${summary.repoCount} repos · ${summary.invalidManifests} invalid manifests · ${summary.unreachable} unreachable · ${summary.listingIssues} listing issues`;
}
