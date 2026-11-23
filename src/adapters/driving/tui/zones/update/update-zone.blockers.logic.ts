// tui/zones/update: the update-blocker menu items and blocker body/retry formatters.
import type { IncidentBlocker } from '../../store/slices/update-slice.js';
import type { MenuItem } from '../../shared/components/lists/menu-list.js';

// The assisted-resolution menu — the seam's fixed choices rendered as `ListRow`s navigated like
// the EDT zone's `SERVICE_ACTION_MENU_ITEMS` (arrows/Home/End + Enter). `Escape` answers
// `cancel-repo`: the least-destructive unblock (the repo is skipped, the rest of the run
// continues) so a stray keystroke never cancels the run.
export const UPDATE_BLOCKER_TITLE = 'UPDATE BLOCKED';

export type UpdateBlockerMenuValue = 'stash' | 'edited' | 'cancel-repo' | 'cancel-run' | 'fetch';

export type UpdateBlockerMenuItem = MenuItem<UpdateBlockerMenuValue>;

export const UPDATE_BLOCKER_MENU_ESCAPE: UpdateBlockerMenuValue = 'cancel-repo';

export const UPDATE_BLOCKER_MENU_ITEMS: readonly UpdateBlockerMenuItem[] = Object.freeze([
  { value: 'stash', label: 'Stash changes and continue' },
  { value: 'edited', label: 'Open in editor, then retry' },
  { value: 'cancel-repo', label: 'Cancel this repo (continue with the rest)' },
  { value: 'cancel-run', label: 'Cancel the whole run' },
]);

// The `shared-types` phase failure reuses the same four seam values under phase-specific labels:
// `edited` is retry, `cancel-repo` skips the phase (the remaining services update), `cancel-run`
// aborts the run (the remaining services are cancelled). Escape stays the least destructive.
export const SHARED_TYPES_PHASE_MENU_ITEMS: readonly UpdateBlockerMenuItem[] = Object.freeze([
  { value: 'edited', label: 'Retry the shared-types phase' },
  { value: 'cancel-repo', label: 'Skip shared-types handling (update the rest)' },
  { value: 'cancel-run', label: 'Abort the run (cancel the remaining services)' },
]);

// The choices offered for a blocker kind. A merge conflict drops `stash`: git refuses to
// stash unmerged paths, and once the conflict is resolved and staged a stash silently
// shelves the resolution and clears the merge (the retry then re-conflicts) — the editor
// retry and the two cancels are the only meaningful exits there.
export function blockerMenuItems(kind: IncidentBlocker['kind'], branch?: string): readonly UpdateBlockerMenuItem[] {
  if (kind === 'shared-types-phase-failed') {
    return SHARED_TYPES_PHASE_MENU_ITEMS;
  }
  if (kind === 'unpushed-commits') {
    // No stash (nothing is dirty); the plain fetch comes first as the proposed way out.
    return [
      { value: 'fetch', label: `Simple fetch (git fetch origin ${branch ?? '<branch>'}) and continue` },
      { value: 'edited', label: 'Open in editor, then retry' },
      { value: 'cancel-repo', label: 'Cancel this service (continue with the rest)' },
      { value: 'cancel-run', label: 'Cancel the whole run' },
    ];
  }
  return kind === 'merge-conflict' ? UPDATE_BLOCKER_MENU_ITEMS.filter((item) => item.value !== 'stash') : UPDATE_BLOCKER_MENU_ITEMS;
}

// The modal body names the blocked service, its repo path, and the blocker kind —
// mid-merge/mid-rebase rows stress that the pre-existing state is reported, never
// auto-touched.
export function formatBlockerBody(blocker: IncidentBlocker): string {
  switch (blocker.kind) {
    case 'dirty-worktree':
      return `"${blocker.service}" has uncommitted changes (${blocker.repoPath}).`;
    case 'merge-conflict':
      return `"${blocker.service}" hit a merge conflict (${blocker.repoPath}).${blocker.autoResolveNote !== undefined ? ` Issue: ${blocker.autoResolveNote}` : ''}`;
    case 'mid-merge':
      return `"${blocker.service}" is already mid-merge from an earlier run (${blocker.repoPath}) — left as-is.`;
    case 'unpushed-commits': {
      const commits = blocker.commits ?? [];
      return `There are unpushed commits on branch ${blocker.branch ?? '?'} of service "${blocker.service}", which prevents a clean fetch. How to proceed? Unpushed: ${commits.join(' | ')}`;
    }
    case 'mid-rebase':
      return `"${blocker.service}" is already mid-rebase from an earlier run (${blocker.repoPath}) — rebases are never touched.`;
    case 'shared-types-phase-failed':
      return `shared-types phase failed after "${blocker.service}": ${blocker.message} No other service starts until you choose.`;
  }
}

// A re-presented merge conflict (a failed stash/edit attempt) carries core's retry counter
// and the reason the last attempt did not settle it — rendered under the body so the
// endless resolve-and-retry loop stays legible. Null on a first prompt.
export function formatBlockerRetry(blocker: IncidentBlocker): string | null {
  if (blocker.kind === 'shared-types-phase-failed') {
    return null;
  }
  if (blocker.retry === undefined || blocker.retry <= 0) {
    return null;
  }
  const reason = blocker.retryReason !== undefined && blocker.retryReason !== '' ? ` — ${blocker.retryReason}` : '';
  return `↻ Retry #${String(blocker.retry)} still blocked${reason}`;
}
