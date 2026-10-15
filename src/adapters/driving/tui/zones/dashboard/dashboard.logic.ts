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

export function manifestLabel(manifest: DashboardService['manifest']): string | null {
  return manifest.ok ? null : 'manifest error';
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

export type AttentionReason = 'protected-branch' | 'no-upstream' | 'unknown-offline' | 'uncommitted' | 'merging' | 'rebasing' | 'behind' | 'used-by-edt';

export type AttentionItem = { service: string; reason: AttentionReason; text: string };

// One item per (service, reason), severity-ordered: protected branch, upstream trouble, working
// tree, behind, then branch shared with another EDT. A failed probe is never an item.
export function buildAttentionItems(services: readonly DashboardService[]): AttentionItem[] {
  const items: Array<AttentionItem & { rank: number }> = [];
  const push = (service: string, reason: AttentionReason, rank: number, text: string) => items.push({ service, reason, rank, text });
  for (const s of services) {
    if (s.protectedBranch) {
      push(s.service, 'protected-branch', 0, `on protected branch${s.branch === null ? '' : ` ${s.branch}`}`);
    }
    if (s.divergence.status === 'no-upstream') {
      push(s.service, 'no-upstream', 1, 'no upstream');
    } else if (s.divergence.status === 'unknown-offline') {
      push(s.service, 'unknown-offline', 1, 'divergence unknown (offline)');
    }
    if (s.workingTree.ok) {
      const { uncommitted, mergeInProgress, rebaseInProgress } = s.workingTree.value;
      if (uncommitted) push(s.service, 'uncommitted', 2, 'uncommitted changes');
      if (mergeInProgress) push(s.service, 'merging', 2, 'merge in progress');
      if (rebaseInProgress) push(s.service, 'rebasing', 2, 'rebase in progress');
    }
    if (s.divergence.behind !== null && s.divergence.behind > 0) {
      push(s.service, 'behind', 3, `behind by ${s.divergence.behind}`);
    }
    if (s.usedByEdts.length > 0) {
      push(s.service, 'used-by-edt', 4, `branch also used by EDT ${s.usedByEdts.join(', ')}`);
    }
  }
  // Array.prototype.sort is stable, so services keep their listing order within a severity.
  return items.sort((a, b) => a.rank - b.rank).map(({ service, reason, text }) => ({ service, reason, text }));
}

export function formatAttentionLine(item: AttentionItem): string {
  return `${item.service} · ${item.text}`;
}

export function attentionHeader(count: number): string {
  return `Attention (${count})`;
}

export function registryAllClear(summary: DashboardRegistrySummary): boolean {
  return summary.invalidManifests === 0 && summary.unreachable === 0 && summary.listingIssues === 0;
}

export function moveAttentionCursor(cursor: number, delta: 1 | -1, count: number): number {
  return count === 0 ? 0 : Math.min(count - 1, Math.max(0, cursor + delta));
}
