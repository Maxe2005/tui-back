// tui/zones/edts: edts-zone.dialog-seed — the test-only initial dialog of EdtsZone's `dialog`
// state (see `initialDialogKind`). Production always starts with no dialog open.
import type { AppStore } from '../../../store/app-store.js';
import {
  initialAddToEdtDialog,
  initialCreateDialog,
  initialDeleteDialog,
  initialIssuesDialog,
  initialModifyDialog,
  initialQuickPickDialog,
  initialServiceActionsDialog,
  initialSwitchDialog,
  type EdtDialogState,
} from './edts-zone.logic.js';

export type InitialDialogKind =
  | 'create'
  | 'switch-confirm'
  | 'switch-blocked'
  | 'modify'
  | 'service-actions'
  | 'add-to-edt'
  | 'delete-confirm'
  | 'delete-confirm-rejected'
  | 'delete-confirm-status-error'
  | 'issues'
  | 'quick-pick';

export function seedDialog(initialDialogKind: InitialDialogKind | undefined, useStore: AppStore): EdtDialogState {
  if (initialDialogKind === undefined) {
    return { kind: 'none' };
  }
  if (initialDialogKind === 'create') {
    return initialCreateDialog();
  }
  if (initialDialogKind === 'issues') {
    return initialIssuesDialog();
  }
  if (initialDialogKind === 'quick-pick') {
    // Test-only seed (like 'create'/'issues' above): defaults to switch mode — a smoke test only
    // needs one representative mode's chrome; real per-mode coverage goes through the
    // interaction tests, driving the actual currentEdtAction -> quick-pick effect (use-edts-effects.ts).
    return initialQuickPickDialog('switch');
  }
  const target = useStore.getState().edts?.[0];
  if (target === undefined) {
    return { kind: 'none' };
  }
  if (initialDialogKind === 'switch-confirm') {
    return initialSwitchDialog(target);
  }
  if (initialDialogKind === 'switch-blocked') {
    return { ...initialSwitchDialog(target), blocked: true, error: 'An action is in progress on the current EDT.' };
  }
  if (initialDialogKind === 'service-actions') {
    const branches = useStore.getState().edtsBranches ?? [];
    const memberPath = target.members[0]?.repoPath;
    const svc = branches.find((candidate) => candidate.path === memberPath);
    if (svc === undefined) {
      return { kind: 'none' };
    }
    return initialServiceActionsDialog(target, svc.path, svc.service);
  }
  if (initialDialogKind === 'add-to-edt') {
    const branches = useStore.getState().edtsBranches ?? [];
    const memberPaths = new Set(target.members.map((member) => member.repoPath));
    const svc = branches.find((candidate) => !memberPaths.has(candidate.path));
    if (svc === undefined) {
      return { kind: 'none' };
    }
    return initialAddToEdtDialog(target, svc.path, svc.service, svc.branch, svc.sharedBranch);
  }
  if (initialDialogKind === 'delete-confirm-rejected') {
    return initialDeleteDialog(target, true);
  }
  if (initialDialogKind === 'delete-confirm') {
    // Test-only seed (mirrors service-actions/add-to-edt's own static seeding above):
    // renderToString never observes the real effect-driven listBranches/status fetch, so
    // memberRows is pre-populated here directly rather than left `null` (which would render
    // as "Loading member status…" forever in a one-shot smoke test).
    const dialog = initialDeleteDialog(target, false);
    return {
      ...dialog,
      memberRows: target.members.map((member) => ({
        repoPath: member.repoPath,
        service: member.service,
        branch: member.branch,
        merged: false,
        clean: true,
        disposition: 'leave' as const,
      })),
    };
  }
  if (initialDialogKind === 'delete-confirm-status-error') {
    // Test-only seed: one row carries a statusError (the shape resolveMemberDeleteStatuses
    // returns when a manifest/git read fails) so formatDeleteMemberMeta's "(status unknown —
    // defaulted to leave)" annotation has real rendering coverage.
    const dialog = initialDeleteDialog(target, false);
    return {
      ...dialog,
      memberRows: target.members.map((member) => ({
        repoPath: member.repoPath,
        service: member.service,
        branch: member.branch,
        merged: false,
        clean: true,
        disposition: 'leave' as const,
        statusError: 'no manifest',
      })),
    };
  }
  return initialModifyDialog(target);
}
