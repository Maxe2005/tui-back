// adapters/driven/git: the driven implementation of core's GitPort — every git write flows
// through it (AD-8). `assertAllowedBranch` rejects a protected target (resolved from the
// repo's own manifest, never the caller) before any `git` invocation, and with an `edtId` a
// branch owned by another EDT. Shells git via child_process; `--` terminates options for
// `git branch`/`git stash`, and `git checkout <branch> --` forces a revision, never a pathspec.
import { runProcess, streamProcess } from '../process.js';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { err, ok, type Result } from '../../../core/result.js';
import type { EdtRegistryPort } from '../../../core/ports/edt-registry.js';
import { GIT_DETACHED_HEAD, type GitPort, type VersionBumpWalkOptions, type VersionBumpWalkSummary, type VersionWalkEnd } from '../../../core/ports/git.js';
import type { ManifestPort } from '../../../core/ports/manifest.js';
import { branchOwners } from '../../../core/edt/branch-owners.js';
// The FR-7 protected-branch rule lives in core, shared with the TUI's advisory check.
import { isProtectedBranch } from '../../../core/edt/shared-branches.js';
import { spawnFailureDetail, showRef, showFullRef, currentBranch } from './refs.js';
export { currentBranch } from './refs.js';
import { assertAllowedBranch, assertCurrentBranchAllowed } from './gate.js';
export { assertAllowedBranch } from './gate.js';
import { stashSave, restoreStash, hasStash } from './stash.js';
export { stashSave, restoreStash, findStashRef, hasStash } from './stash.js';
import { fetchBranch, fetchRemoteBranch, listUnpushedCommits, pullBranch } from './remote.js';
export { fetchBranch, fetchRemoteBranch, listUnpushedCommits, pullBranch } from './remote.js';
import { LARGE_OUTPUT_BUFFER, hasUncommittedChanges, listDirtyPaths, diffNameOnly, headRevision, diffStat } from './diff.js';
export { hasUncommittedChanges, listDirtyPaths, diffNameOnly, headRevision, diffStat } from './diff.js';
import { discardPaths, discardPathsToHead, discardAll } from './discard.js';
export { discardPaths, discardPathsToHead, discardAll } from './discard.js';
import { mergeBranch, abortMerge, isMergeInProgress, isRebaseInProgress, hasUnmergedPaths, finalizeMerge, listUnmergedPaths, readWorktreeFile, writeResolvedFile, checkoutSide } from './merge.js';
export { mergeBranch, abortMerge, isMergeInProgress, isRebaseInProgress, hasUnmergedPaths, finalizeMerge, listUnmergedPaths, readWorktreeFile, writeResolvedFile, checkoutSide } from './merge.js';
import { stagePaths, commitPaths } from './commit.js';
export { stagePaths, commitPaths } from './commit.js';
import { listVersionBumpCommits, listBranchesContaining } from './version-history.js';
export { listVersionBumpCommits, listBranchesContaining } from './version-history.js';
import { createBranch, deleteBranch, isBranchMerged, aheadBehind, checkoutBranch, branchExistsLocally, listBranches, renameBranch, listRemoteBranches, createTrackingBranch } from './branches.js';
export { createBranch, deleteBranch, isBranchMerged, aheadBehind, checkoutBranch, branchExistsLocally, listBranches, renameBranch, listRemoteBranches, createTrackingBranch } from './branches.js';

export function createGitPort(manifest: ManifestPort, edtRegistry?: EdtRegistryPort): GitPort {
  return {
    assertAllowedBranch: (repoPath, branchName, edtId) =>
      assertAllowedBranch(manifest, repoPath, branchName, edtId, edtRegistry),
    createBranch: (repoPath, branchName, baseBranch) => createBranch(manifest, repoPath, branchName, baseBranch),
    deleteBranch: (repoPath, branchName, force) => deleteBranch(manifest, repoPath, branchName, force),
    isBranchMerged: (repoPath, branchName, into) => isBranchMerged(repoPath, branchName, into),
    currentBranch: (repoPath) => currentBranch(repoPath),
    aheadBehind: (repoPath) => aheadBehind(repoPath),
    checkout: (repoPath, branchName) => checkoutBranch(repoPath, branchName),
    hasUncommittedChanges: (repoPath, opts) => hasUncommittedChanges(repoPath, opts),
    stashSave: (repoPath, message) => stashSave(repoPath, message),
    restoreStash: (repoPath, message) => restoreStash(repoPath, message),
    hasStash: (repoPath, tag) => hasStash(repoPath, tag),
    branchExistsLocally: (repoPath, branchName) => branchExistsLocally(repoPath, branchName),
    fetch: (repoPath, branchName) => fetchBranch(repoPath, branchName),
    fetchRemote: (repoPath, branchName) => fetchRemoteBranch(repoPath, branchName),
    listUnpushedCommits: (repoPath, branchName) => listUnpushedCommits(repoPath, branchName),
    pull: (repoPath) => pullBranch(repoPath),
    isMergeInProgress: (repoPath) => isMergeInProgress(repoPath),
    mergeBranch: (repoPath, branch) => mergeBranch(repoPath, branch),
    abortMerge: (repoPath) => abortMerge(repoPath),
    listDirtyPaths: (repoPath, opts) => listDirtyPaths(repoPath, opts),
    discardPaths: (repoPath, paths) => discardPaths(repoPath, paths),
    discardAll: (repoPath) => discardAll(repoPath),
    diffNameOnly: (repoPath, from, to) => diffNameOnly(repoPath, from, to),
    headRevision: (repoPath) => headRevision(repoPath),
    diffStat: (repoPath, from, to) => diffStat(repoPath, from, to),
    discardPathsToHead: (repoPath, paths) => discardPathsToHead(repoPath, paths),
    isRebaseInProgress: (repoPath) => isRebaseInProgress(repoPath),
    hasUnmergedPaths: (repoPath) => hasUnmergedPaths(repoPath),
    listUnmergedPaths: (repoPath) => listUnmergedPaths(repoPath),
    readWorktreeFile: (repoPath, path) => readWorktreeFile(repoPath, path),
    writeResolvedFile: (repoPath, path, content, opts) => writeResolvedFile(manifest, repoPath, path, content, opts),
    checkoutSide: (repoPath, path, side) => checkoutSide(manifest, repoPath, path, side),
    finalizeMerge: (repoPath) => finalizeMerge(repoPath),
    listBranches: (repoPath) => listBranches(repoPath),
    renameBranch: (repoPath, oldName, newName, edtId) =>
      renameBranch(manifest, repoPath, oldName, newName, edtId, edtRegistry),
    listRemoteBranches: (repoPath) => listRemoteBranches(repoPath),
    createTrackingBranch: (repoPath, localName, remoteRef) =>
      createTrackingBranch(manifest, repoPath, localName, remoteRef),
    stagePaths: (repoPath, paths) => stagePaths(manifest, repoPath, paths),
    commit: (repoPath, message, paths) => commitPaths(manifest, repoPath, message, paths),
    listVersionBumpCommits: (repoPath, ref, opts) => listVersionBumpCommits(repoPath, ref, opts),
    listBranchesContaining: (repoPath, commit, signal) => listBranchesContaining(repoPath, commit, signal),
  };
}
