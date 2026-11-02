// tui/zones/dashboard: pure helpers for the Dashboard shell — which body the zone shows, the
// "updated Ns ago" line and the short labels a service row prints for each probed field.
import type { DashboardOtherService, DashboardRegistrySummary, DashboardService } from '../../../../../core/dashboard/snapshot.js';
import type { ServiceAction } from '../../../../../core/service-actions/index.js';
import { formatHint } from '../../shared/components/hints.js';
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

export type AttentionReason =
  | 'protected-branch'
  | 'drift'
  | 'no-upstream'
  | 'unknown-offline'
  | 'uncommitted'
  | 'merging'
  | 'rebasing'
  | 'behind'
  | 'used-by-edt';

// `focusable` is false for an item with no services-table row (an other service's drift).
export type AttentionItem = { service: string; path: string; reason: AttentionReason; text: string; focusable: boolean };

export function driftText(branch: string | null, expectedBranch: string, member: boolean): string {
  return `on ${branch ?? 'detached HEAD'}, expected ${expectedBranch} (${member ? 'EDT member' : 'other service'})`;
}

// One item per (service, reason), severity-ordered: protected branch, drift (members, then
// others), upstream trouble, working tree, behind, then branch shared with another EDT. A failed
// probe is never an item; a detached HEAD shows as drift, not as unknown divergence.
export function buildAttentionItems(services: readonly DashboardService[], others: readonly DashboardOtherService[] = []): AttentionItem[] {
  const items: Array<AttentionItem & { rank: number }> = [];
  for (const s of services) {
    const push = (reason: AttentionReason, rank: number, text: string) =>
      items.push({ service: s.service, path: s.path, reason, rank, text, focusable: true });
    const detached = s.drift === 'drifted' && s.branch === null;
    if (s.protectedBranch) {
      push('protected-branch', 0, `on protected branch${s.branch === null ? '' : ` ${s.branch}`}`);
    }
    if (s.drift === 'drifted') {
      push('drift', 1, driftText(s.branch, s.expectedBranch, true));
    }
    if (s.divergence.status === 'no-upstream') {
      push('no-upstream', 2, 'no upstream');
    } else if (s.divergence.status === 'unknown-offline' && !detached) {
      push('unknown-offline', 2, 'divergence unknown (offline)');
    }
    if (s.workingTree.ok) {
      const { uncommitted, mergeInProgress, rebaseInProgress } = s.workingTree.value;
      if (uncommitted) push('uncommitted', 3, 'uncommitted changes');
      if (mergeInProgress) push('merging', 3, 'merge in progress');
      if (rebaseInProgress) push('rebasing', 3, 'rebase in progress');
    }
    if (s.divergence.behind !== null && s.divergence.behind > 0) {
      push('behind', 4, `behind by ${s.divergence.behind}`);
    }
    if (s.usedByEdts.length > 0) {
      push('used-by-edt', 5, `branch also used by EDT ${s.usedByEdts.join(', ')}`);
    }
  }
  for (const o of others) {
    if (o.drift === 'drifted') {
      items.push({ service: o.service, path: o.path, reason: 'drift', rank: 1, text: driftText(o.branch, o.expectedBranch, false), focusable: false });
    }
  }
  // Array.prototype.sort is stable, so services keep their listing order within a severity.
  return items.sort((a, b) => a.rank - b.rank).map(({ rank: _rank, ...item }) => item);
}

export function formatAttentionLine(item: AttentionItem): string {
  return `${item.service} · ${item.text}`;
}

export const REALIGN_HINT = formatHint(['A', 'realign']);

// The realign shortcut is offered as soon as one Attention line is a drift.
export function attentionHeader(count: number, drift = false): string {
  return `Attention (${count})${drift ? `  ${REALIGN_HINT}` : ''}`;
}

export function registryAllClear(summary: DashboardRegistrySummary): boolean {
  return summary.repoCount > 0 && summary.invalidManifests === 0 && summary.unreachable === 0 && summary.listingIssues === 0;
}

// The next focusable attention line after `current` (none yet = the first), wrapping around;
// null when no line is focusable.
export function nextAttentionIndex(current: number | null, items: readonly AttentionItem[]): number | null {
  const count = items.length;
  for (let step = 1; step <= count; step += 1) {
    const index = current === null ? step - 1 : (current + step) % count;
    if (items[index]?.focusable === true) {
      return index;
    }
  }
  return null;
}

// Index of the row (in listing order) an attention item points at; -1 when the row is gone.
export function rowIndexForAttention(rows: readonly DashboardService[], item: AttentionItem): number {
  return rows.findIndex((row) => row.path === item.path);
}

// The bottom EDT section: which actions the Dashboard offers for the current EDT state.
export type EdtSectionKind = 'active' | 'no-active' | 'none';
export type EdtSectionAction = { key: 'E' | 'e'; label: string };

export const EDT_SECTION_ROWS = 2;
export const NO_EDT_MESSAGE = 'No EDT yet.';

// `edtCount` is null while the EDT list is not loaded: EDTs are then assumed to exist.
export function resolveEdtSection(snapshot: { status: 'active' | 'no-active-edt'; edt: { topic: string } | null }, edtCount: number | null): EdtSectionKind {
  if (snapshot.status === 'active' && snapshot.edt !== null) {
    return 'active';
  }
  return edtCount === 0 ? 'none' : 'no-active';
}

export function edtSectionActions(kind: EdtSectionKind, topic: string | null): EdtSectionAction[] {
  switch (kind) {
    case 'active':
      return [
        { key: 'E', label: `Enter ${topic ?? 'EDT'}` },
        { key: 'e', label: 'Choose another EDT / create one' },
      ];
    case 'no-active':
      return [{ key: 'e', label: 'Choose or create an EDT' }];
    case 'none':
      return [{ key: 'e', label: 'Create a first EDT' }];
  }
}

export function formatEdtAction(action: EdtSectionAction): string {
  return `[${action.key}] ▸ ${action.label}`;
}

// The EDT line: topic, size, then the freshness and refresh hint (omitted until a load landed).
export function formatEdtLine(topic: string, serviceCount: number, updated: string | null): string {
  return `EDT ${topic} · ${serviceCount} services${updated === null ? '' : ` · ${updated} · ${formatHint(['R', 'refresh'])}`}`;
}

export type EdtKeyEffect = { openDialog: 'switch' | 'create' | null; zone: 'edts' } | null;

// What `E` / `e` do: `E` needs an active EDT; `e` opens the quick-pick, or the create wizard when
// no EDT exists at all.
export function edtKeyEffect(input: string, kind: EdtSectionKind): EdtKeyEffect {
  if (input === 'E') {
    return kind === 'active' ? { openDialog: null, zone: 'edts' } : null;
  }
  if (input === 'e') {
    return { openDialog: kind === 'none' ? 'create' : 'switch', zone: 'edts' };
  }
  return null;
}
