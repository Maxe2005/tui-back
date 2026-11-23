// adapters/driven/git/gate: the branch-scope safety gate (AD-8) every git write passes through — protected-branch and cross-EDT checks, plus the current-branch variant for branch-less writes.
import { resolve } from 'node:path';
import { isProtectedBranch } from '../../../core/edt/branches/shared-branches.js';
import { isSystemEdt } from '../../../core/edt/shared-edt/shared-edt.js';
import { type EdtRegistryPort } from '../../../core/ports/storage/edt-registry.js';
import { type ManifestPort } from '../../../core/ports/vcs/manifest.js';
import { type Result, err, ok } from '../../../core/result.js';
import { currentBranch } from './refs.js';

// Carve-outs: `fetch` / `pull --ff-only` of a shared branch (remote.ts) are deliberately
// ungated — they can only fast-forward it from its own origin counterpart (switch, update and the
// `fastForwardShared` quick action).
//
// The reusable branch-scope safety gate (AD-8): resolves the protected set from the
// repo's own manifest at check time — never trusted from the caller — and rejects
// before any `git` invocation. A repo whose manifest cannot load fails the gate too (it is
// not a managed repo, so no branch of it can be judged safe). When both `edtId` and
// `edtRegistry` are supplied, it also rejects a branchName already registered as a
// *different* EDT's own branch for this repoPath (the cross-EDT half of AD-8).
export async function assertAllowedBranch(
  manifest: ManifestPort,
  repoPath: string,
  branchName: string,
  edtId?: string,
  edtRegistry?: EdtRegistryPort,
): Promise<Result<void>> {
  const loaded = await manifest.load(repoPath);
  if (!loaded.ok) {
    return loaded;
  }

  if (isProtectedBranch(branchName, loaded.data)) {
    return err('shared-branch-rejected', `Branch "${branchName}" is protected by ${loaded.data.service}'s manifest (repo ${repoPath})`);
  }

  if (edtId !== undefined && edtRegistry !== undefined) {
    const listed = await edtRegistry.list();
    if (!listed.ok) {
      return listed;
    }
    // Normalize both sides before comparing — repoPath is whatever shape the registry stored
    // a member's path in, which isn't guaranteed to match the caller's resolve()'d repoPath
    // byte-for-byte (trailing slash, relative segments, ...). Without this, the cross-EDT gate
    // can silently miss a real conflict.
    const target = resolve(repoPath);
    const ownedByOther = listed.data.some(
      (candidate) =>
        // The system shared-branches EDT is not a "user" of any branch.
        !isSystemEdt(candidate) &&
        candidate.ulid !== edtId &&
        candidate.members.some((member) => resolve(member.repoPath) === target && member.branch === branchName),
    );
    if (ownedByOther) {
      return err(
        'branch-owned-by-other-edt',
        `Branch "${branchName}" is already registered as a different EDT's own branch (repo ${repoPath})`,
      );
    }
  }

  return ok(undefined);
}

// The branch-scope gate for a write that has no branch argument: judges the repo's current
// branch (a detached HEAD fails as `git-detached-head`, never writes).
export async function assertCurrentBranchAllowed(manifest: ManifestPort, repoPath: string): Promise<Result<void>> {
  const branch = await currentBranch(repoPath);
  if (!branch.ok) {
    return branch;
  }
  return assertAllowedBranch(manifest, repoPath, branch.data);
}
