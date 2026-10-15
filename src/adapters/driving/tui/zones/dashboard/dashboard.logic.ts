// tui/zones/dashboard: pure helpers for the Dashboard shell — which body the zone shows, the
// "updated Ns ago" line and the short labels a service row prints for each probed field.
import type { DashboardRegistrySummary, DashboardService } from '../../../../../core/dashboard/snapshot.js';
import type { ServiceAction } from '../../../../../core/service-actions/index.js';
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

export const ISSUE_MARKER = '!';

// The reason behind each anomaly of a row, in reading order; empty when the row is healthy.
export function reasonParts(service: DashboardService): string[] {
  const parts: string[] = [];
  if (!service.manifest.ok) {
    parts.push(`manifest error: ${service.manifest.error.message}`);
  }
  if (!service.container.ok) {
    parts.push(`container error: ${service.container.error.message}`);
  }
  if (!service.workingTree.ok) {
    parts.push(`git error: ${service.workingTree.error.message}`);
  } else {
    const { uncommitted, mergeInProgress, rebaseInProgress } = service.workingTree.value;
    if (uncommitted) {
      parts.push('uncommitted changes');
    }
    if (mergeInProgress) {
      parts.push('merge in progress');
    }
    if (rebaseInProgress) {
      parts.push('rebase in progress');
    }
  }
  if (service.divergence.status === 'no-upstream') {
    parts.push('no upstream branch');
  } else if (service.divergence.status === 'unknown-offline') {
    parts.push(service.divergence.detail === undefined ? 'offline: divergence unknown' : `offline: ${service.divergence.detail.message}`);
  }
  return parts;
}

export function issueMarker(service: DashboardService): string {
  return reasonParts(service).length === 0 ? ' ' : ISSUE_MARKER;
}

export function aheadBehindLabel(divergence: DashboardService['divergence']): string {
  switch (divergence.status) {
    case 'no-upstream':
      return 'no upstream';
    case 'unknown-offline':
      return 'offline';
    case 'current':
      return divergence.ahead === null || divergence.behind === null ? 'unknown' : `↑${divergence.ahead} ↓${divergence.behind}`;
  }
}

// The focused row's explanation line; null when nothing is wrong.
export function reasonLine(service: DashboardService): string | null {
  const parts = reasonParts(service);
  return parts.length === 0 ? null : parts.join(' · ');
}

export const OPERATION_IN_PROGRESS = 'operation in progress';

// While an action runs on a row, every action of that row is disabled with the same reason.
export function disableWhileRunning(actions: readonly ServiceAction[], running: boolean): ServiceAction[] {
  return running ? actions.map((action) => ({ ...action, availability: { available: false, reason: OPERATION_IN_PROGRESS } })) : [...actions];
}

// The registry action bound to a key press (`Ctrl+<letter>`), matched on its displayed key so a
// newly registered action needs no change here.
export function actionForKey(actions: readonly ServiceAction[], input: string): ServiceAction | undefined {
  return actions.find((action) => action.key.toLowerCase() === `ctrl+${input.toLowerCase()}`);
}

export type AttentionReason = 'protected-branch' | 'no-upstream' | 'unknown-offline' | 'uncommitted' | 'merging' | 'rebasing' | 'behind' | 'used-by-edt';

export type AttentionItem = { service: string; path: string; reason: AttentionReason; text: string };

// One item per (service, reason), severity-ordered: protected branch, upstream trouble, working
// tree, behind, then branch shared with another EDT. A failed probe is never an item.
export function buildAttentionItems(services: readonly DashboardService[]): AttentionItem[] {
  const items: Array<AttentionItem & { rank: number }> = [];
  for (const s of services) {
    const push = (reason: AttentionReason, rank: number, text: string) => items.push({ service: s.service, path: s.path, reason, rank, text });
    if (s.protectedBranch) {
      push('protected-branch', 0, `on protected branch${s.branch === null ? '' : ` ${s.branch}`}`);
    }
    if (s.divergence.status === 'no-upstream') {
      push('no-upstream', 1, 'no upstream');
    } else if (s.divergence.status === 'unknown-offline') {
      push('unknown-offline', 1, 'divergence unknown (offline)');
    }
    if (s.workingTree.ok) {
      const { uncommitted, mergeInProgress, rebaseInProgress } = s.workingTree.value;
      if (uncommitted) push('uncommitted', 2, 'uncommitted changes');
      if (mergeInProgress) push('merging', 2, 'merge in progress');
      if (rebaseInProgress) push('rebasing', 2, 'rebase in progress');
    }
    if (s.divergence.behind !== null && s.divergence.behind > 0) {
      push('behind', 3, `behind by ${s.divergence.behind}`);
    }
    if (s.usedByEdts.length > 0) {
      push('used-by-edt', 4, `branch also used by EDT ${s.usedByEdts.join(', ')}`);
    }
  }
  // Array.prototype.sort is stable, so services keep their listing order within a severity.
  return items.sort((a, b) => a.rank - b.rank).map(({ rank: _rank, ...item }) => item);
}

export function formatAttentionLine(item: AttentionItem): string {
  return `${item.service} · ${item.text}`;
}

export function attentionHeader(count: number): string {
  return `Attention (${count})`;
}

export function registryAllClear(summary: DashboardRegistrySummary): boolean {
  return summary.repoCount > 0 && summary.invalidManifests === 0 && summary.unreachable === 0 && summary.listingIssues === 0;
}

// The next attention line after `current` (none yet = the first), wrapping around; null when empty.
export function nextAttentionIndex(current: number | null, count: number): number | null {
  if (count === 0) {
    return null;
  }
  return current === null || current >= count - 1 ? 0 : current + 1;
}

// Index of the row (in listing order) an attention item points at; -1 when the row is gone.
export function rowIndexForAttention(rows: readonly DashboardService[], item: AttentionItem): number {
  return rows.findIndex((row) => row.path === item.path);
}
