// core/edt/delete: deletes a non-active EDT, leaving or deleting each member's branch per the
// caller's disposition (default 'leave'). Merge/clean status is re-read right before deleting
// to pick `-d` vs `-D`; a branch owned by another EDT is refused per-branch without blocking
// the rest. Only the registry-entry and SQLite-file removal is lock-held (AD-9); there is no
// soft-delete and no undo.
import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { withActionLock } from '../locking.js';
import type { EdtMember, EdtRegistryPort } from '../ports/edt-registry.js';
import type { GitPort } from '../ports/git.js';
import type { LockPort } from '../ports/lock.js';
import type { ManifestPort } from '../ports/manifest.js';
import type { StatePort } from '../ports/state.js';
import { err, ok, type Result } from '../result.js';

export type MemberDisposition = 'leave' | 'delete';

export interface DeleteEdtMemberResult {
  service: string;
  outcome: 'deleted' | 'left' | 'failed';
  detail?: { code: string; message: string };
}

export interface DeleteEdtData {
  ulid: string;
  topic: string;
  results: DeleteEdtMemberResult[];
}

export interface DeleteEdtParams {
  edtRegistry: EdtRegistryPort;
  manifest: ManifestPort;
  git: GitPort;
  lock: LockPort;
  state: StatePort;
  edtRegistryResourceKey: string;
  edtsBaseDir: string;
  topic: string;
  // Per-member repoPath -> disposition. A member omitted here defaults to 'leave' — the safe
  // no-op — so a caller that supplies nothing at all still deletes only the registry entry
  // and the EDT's own SQLite file, touching no member branch.
  dispositions?: Record<string, MemberDisposition>;
}

export async function deleteEdt(params: DeleteEdtParams): Promise<Result<DeleteEdtData>> {
  const { edtRegistry, manifest, git, lock, state, edtRegistryResourceKey, edtsBaseDir, dispositions = {} } = params;

  const topic = params.topic.trim();
  if (topic === '') {
    // <topic> is positional on this subcommand (unlike modify/switch's --topic flag).
    return err('missing-argument', 'Usage: tui-back edt delete <topic> [--branches <repoPath>=<leave|delete>]...');
  }

  const listed = await edtRegistry.list();
  if (!listed.ok) {
    return listed;
  }
  const target = listed.data.find((candidate) => candidate.topic === topic);
  if (target === undefined) {
    return err('edt-not-found', `No EDT with topic "${topic}" is registered`);
  }

  // The active EDT can never be deleted — rejected before any git/file write, and never
  // auto-switched away from. state.json's pointer is authoritative, not the registry status.
  const active = await state.readActiveEdt();
  if (!active.ok) {
    return active;
  }
  if (active.data === target.ulid) {
    return err(
      'edt-delete-active-rejected',
      `Cannot delete "${target.topic}" — it is the active EDT. Switch away from it first.`,
    );
  }

  // Normalize both sides before comparing: dispositions' keys come from a CLI flag or the TUI
  // and may not match member.repoPath byte-for-byte (trailing slash, relative segments, ...) —
  // without this, a real disposition can silently fall back to 'leave'.
  const dispositionsByPath = new Map(Object.entries(dispositions).map(([repoPath, disposition]) => [resolve(repoPath), disposition]));

  // Per-member branch disposition, outside the lock (mirrors modify.ts's own step/lock
  // split): one member's failure never blocks another member's deletion or the
  // registry-entry removal below.
  const results: DeleteEdtMemberResult[] = [];
  for (const member of target.members) {
    const disposition = dispositionsByPath.get(resolve(member.repoPath)) ?? 'leave';
    if (disposition === 'leave') {
      results.push({ service: member.service, outcome: 'left' });
      continue;
    }
    results.push(await deleteMemberBranch(git, manifest, target.ulid, member));
  }

  const removed = await withActionLock(lock, edtRegistryResourceKey, async () => {
    const removedEntry = await edtRegistry.remove(target.ulid);
    if (!removedEntry.ok) {
      return removedEntry;
    }
    deleteEdtFiles(edtsBaseDir, target.ulid);
    return ok(undefined);
  });
  if (!removed.ok) {
    // The per-repo branch deletions above already ran (outside the lock, AD-9) by the time
    // this registry write failed — attach what was actually done to git in the error details
    // so the caller isn't left guessing.
    return err(removed.error.code, removed.error.message, { partialResults: results });
  }

  return ok({ ulid: target.ulid, topic: target.topic, results });
}

async function deleteMemberBranch(
  git: GitPort,
  manifest: ManifestPort,
  edtUlid: string,
  member: EdtMember,
): Promise<DeleteEdtMemberResult> {
  // Gated through the existing branch-scope safety adapter, unchanged (AD-8): a branch also
  // owned by a *different* EDT is refused per-branch (branch-owned-by-other-edt) without
  // blocking the rest of the deletion or the registry-entry removal. Passing edtUlid (this
  // EDT's own, about to be relinquished, claim) so it is never mistaken for someone else's.
  const allowed = await git.assertAllowedBranch(member.repoPath, member.branch, edtUlid);
  if (!allowed.ok) {
    return { service: member.service, outcome: 'failed', detail: { code: allowed.error.code, message: allowed.error.message } };
  }

  // A member's branch may already be gone (deleted manually outside the tool) — isBranchMerged
  // would error on a non-existent ref, reporting a spurious 'failed'. Short-circuit to
  // 'deleted': the developer's intent (this branch should not exist afterwards) is satisfied.
  const exists = await git.branchExistsLocally(member.repoPath, member.branch);
  if (!exists.ok) {
    return { service: member.service, outcome: 'failed', detail: { code: exists.error.code, message: exists.error.message } };
  }
  if (!exists.data) {
    return { service: member.service, outcome: 'deleted' };
  }

  const loaded = await manifest.load(member.repoPath);
  if (!loaded.ok) {
    return { service: member.service, outcome: 'failed', detail: { code: loaded.error.code, message: loaded.error.message } };
  }

  // Never trust a caller-supplied/stale merged+clean belief: a 'delete' is never downgraded
  // because it looked risky — re-read both, right before deciding -d vs -D.
  const merged = await git.isBranchMerged(member.repoPath, member.branch, loaded.data.sharedBranch);
  if (!merged.ok) {
    return { service: member.service, outcome: 'failed', detail: { code: merged.error.code, message: merged.error.message } };
  }
  const dirty = await isMemberBranchDirty(git, edtUlid, member);
  if (!dirty.ok) {
    return { service: member.service, outcome: 'failed', detail: { code: dirty.error.code, message: dirty.error.message } };
  }
  const force = !(merged.data && !dirty.data);

  const deleted = await git.deleteBranch(member.repoPath, member.branch, force);
  if (!deleted.ok) {
    return { service: member.service, outcome: 'failed', detail: { code: deleted.error.code, message: deleted.error.message } };
  }
  return { service: member.service, outcome: 'deleted' };
}

// A member's branch is dirty, for delete purposes, when EITHER:
//   1. A stash tagged `tui-back:<edtUlid>` (the tag switch.ts writes when switching away from
//      this EDT) exists in repoPath — existence only, never popped.
//   2. repoPath's currently checked-out branch equals member.branch AND it has uncommitted
//      changes — the one case where the working tree's state is this member's own.
// hasUncommittedChanges is never called blind: whatever repoPath has checked out may belong to
// an unrelated EDT. Shared by deleteMemberBranch and resolveMemberDeleteStatuses.
async function isMemberBranchDirty(git: GitPort, edtUlid: string, member: EdtMember): Promise<Result<boolean>> {
  const stashed = await git.hasStash(member.repoPath, `tui-back:${edtUlid}`);
  if (!stashed.ok) {
    return stashed;
  }
  if (stashed.data) {
    return ok(true);
  }

  const current = await git.currentBranch(member.repoPath);
  if (!current.ok) {
    return current;
  }
  if (current.data !== member.branch) {
    return ok(false);
  }

  return git.hasUncommittedChanges(member.repoPath);
}

// Mirrors create.ts's rollback() precedent: direct node:fs, no port method (AD-1) — errors
// are logged, never thrown, so a filesystem hiccup here never masks the registry removal that
// already succeeded (completion is always "registry entry gone", regardless of file cleanup).
function deleteEdtFiles(edtsBaseDir: string, ulid: string): void {
  const edtDir = join(edtsBaseDir, ulid);
  const dbPath = join(edtsBaseDir, `${ulid}.db`);
  try {
    rmSync(edtDir, { recursive: true, force: true });
  } catch (cleanupError) {
    console.error(`Failed to remove EDT directory ${edtDir} after deleting EDT ${ulid}:`, cleanupError);
  }
  try {
    rmSync(dbPath, { force: true });
  } catch (cleanupError) {
    console.error(`Failed to remove EDT database ${dbPath} after deleting EDT ${ulid}:`, cleanupError);
  }
}

// The TUI's per-member disposition defaults, and the confirm dialog's branch, merge status and
// uncommitted-work status per member — exposed from core so the TUI never calls git directly.
export interface MemberDeleteStatus {
  repoPath: string;
  service: string;
  branch: string;
  merged: boolean;
  clean: boolean;
  // Set when either underlying git/manifest read failed — the row still renders (never
  // blocks the dialog from opening), but the default falls back to 'leave' (the safe choice)
  // rather than guessing merged/clean.
  statusError?: string;
}

export async function resolveMemberDeleteStatuses(
  git: GitPort,
  manifest: ManifestPort,
  edtUlid: string,
  members: readonly EdtMember[],
): Promise<MemberDeleteStatus[]> {
  const out: MemberDeleteStatus[] = [];
  for (const member of members) {
    const loaded = await manifest.load(member.repoPath);
    if (!loaded.ok) {
      out.push({
        repoPath: member.repoPath,
        service: member.service,
        branch: member.branch,
        merged: false,
        clean: false,
        statusError: loaded.error.message,
      });
      continue;
    }
    const merged = await git.isBranchMerged(member.repoPath, member.branch, loaded.data.sharedBranch);
    // Same clean-detection rule as deleteMemberBranch (isMemberBranchDirty).
    const dirty = await isMemberBranchDirty(git, edtUlid, member);
    const statusError = !merged.ok ? merged.error.message : !dirty.ok ? dirty.error.message : undefined;
    out.push({
      repoPath: member.repoPath,
      service: member.service,
      branch: member.branch,
      merged: merged.ok ? merged.data : false,
      clean: dirty.ok ? !dirty.data : false,
      ...(statusError !== undefined ? { statusError } : {}),
    });
  }
  return out;
}

// Defaults to 'leave', except a branch both merged into its sharedBranch and clean, which
// defaults to 'delete'. A status-read failure always defaults to 'leave' — the safe choice
// when merge/clean state couldn't be established.
export function defaultDispositionFor(status: Pick<MemberDeleteStatus, 'merged' | 'clean' | 'statusError'>): MemberDisposition {
  if (status.statusError !== undefined) {
    return 'leave';
  }
  return status.merged && status.clean ? 'delete' : 'leave';
}
