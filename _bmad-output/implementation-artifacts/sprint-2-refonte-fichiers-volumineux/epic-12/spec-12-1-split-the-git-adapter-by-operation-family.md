---
title: 'Split the Git Adapter by Operation Family'
type: 'refactor'
created: '2026-11-12'
status: 'done'
baseline_commit: '8ee2a7cd79710cbc8142c0d19ac209ccaa037459'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `src/adapters/driven/git/index.ts` is 1222 lines with ~40 independent git operations, so no git concern can be read or changed in isolation.

**Approach:** Move the operations into per-family modules in the same folder (moves first, edits second); `index.ts` keeps only `createGitPort` and re-exports every symbol it exported before.

## Boundaries & Constraints

**Always:** Behaviour-preserving. Every git write stays behind the branch-scope gate (`assertAllowedBranch` / `assertCurrentBranchAllowed`). Original path `git/index.js` keeps exporting the same names (tests import them). Each new file under ~400 lines with one stated responsibility and a header comment. Green gates before each commit: `npm test && npm run typecheck && npm run depcheck`. One extraction per commit: `refactor(git): ... (story 12.1)` with a body explaining why. No new cross-layer import.

**Ask First:** Any family that cannot stay under ~400 lines or needs a circular import between family modules.

**Never:** Edit `index.test.ts`, `version-history.test.ts` or `switch-manifest-carry.integration.test.ts`. Change signatures, error messages or git arguments. Split the test files (epic 13). Rename the folder or move `index.ts`.

</frozen-after-approval>

## Code Map

- `src/adapters/driven/git/index.ts` -- source (1222 lines): `createGitPort` (l.18-71) + operations; sole external importer is `src/bin/composition.ts:17` (`createGitPort`); tests import the other named exports.
- `gate.ts` (new) -- `assertAllowedBranch` (l.73), `assertCurrentBranchAllowed` (l.979); shared by write families, so extract FIRST.
- `branches.ts` (new) -- createBranch, deleteBranch, isBranchMerged, currentBranch, aheadBehind + `readBranchConfig`, checkoutBranch, branchExistsLocally, listBranches, renameBranch, listRemoteBranches, createTrackingBranch, `showRef`/`showFullRef`/`spawnFailureDetail`.
- `stash.ts` (new) -- stashSave, restoreStash, findStashRef, hasStash.
- `remote.ts` (new) -- fetchBranch, fetchRemoteBranch, listUnpushedCommits, pullBranch.
- `merge.ts` (new) -- mergeBranch, abortMerge, isMergeInProgress, isRebaseInProgress, hasUnmergedPaths, finalizeMerge, listUnmergedPaths, readWorktreeFile, writeResolvedFile, checkoutSide, `isInside`.
- `diff.ts` (new) -- hasUncommittedChanges, `excludePathspecs`, listDirtyPaths, diffNameOnly, headRevision, diffStat.
- `discard.ts` (new) -- discardPaths, discardPathsToHead, discardAll, `chunked`.
- `commit.ts` (new) -- stagePaths, commitPaths.
- `version-history.ts` (new) -- listVersionBumpCommits, listBranchesContaining, `escapeRegexLiteral`.
- Exact family assignment may be adjusted to real helper dependencies (cross-check with `grep` before moving).

## Tasks & Acceptance

**Execution:**
- [x] `git/gate.ts` -- extract the two gate functions; re-export from `index.ts` -- shared dependency of write families
- [x] `git/stash.ts`, `git/remote.ts`, `git/diff.ts`, `git/discard.ts` -- extract one per commit -- leaf families with few dependencies
- [x] `git/merge.ts`, `git/commit.ts`, `git/version-history.ts`, `git/branches.ts` -- extract one per commit -- remaining families
- [x] `git/index.ts` -- reduce to header comment, imports, `createGitPort` and `export *`/named re-exports -- composition only

**Acceptance Criteria:**
- Given the refactor, when `index.test.ts`, `version-history.test.ts` and `switch-manifest-carry.integration.test.ts` run unchanged, then they pass.
- Given the split, when listing `git/`, then `index.ts` contains only `createGitPort` and re-exports, and no source file exceeds ~400 lines (or is justified here).
- Given the split, when running `npm run depcheck`, then no new violation appears and every write family imports the gate.

## Spec Change Log

## Verification

**Commands:**
- `npm test && npm run typecheck && npm run depcheck` -- expected: all green
- `wc -l src/adapters/driven/git/*.ts` -- expected: source files ≤ ~400 lines

## Suggested Review Order

**Composition entry point**

- `createGitPort` now only wires family functions; re-exports keep the old import surface.
  [`index.ts:33`](../../../src/adapters/driven/git/index.ts#L33)

**Branch-scope safety gate**

- The AD-8 gate lives alone; every write family imports it.
  [`gate.ts:15`](../../../src/adapters/driven/git/gate.ts#L15)

- Current-branch variant used by commit and merge writes.
  [`gate.ts:59`](../../../src/adapters/driven/git/gate.ts#L59)

- Deviation from spec: `refs.ts` breaks the gate/branches import cycle.
  [`refs.ts:47`](../../../src/adapters/driven/git/refs.ts#L47)

**Write families**

- Branch create/delete/rename behind the gate.
  [`branches.ts:10`](../../../src/adapters/driven/git/branches.ts#L10)

- Stage and commit behind the current-branch gate.
  [`commit.ts:10`](../../../src/adapters/driven/git/commit.ts#L10)

- Merge and conflict-resolution primitives.
  [`merge.ts:17`](../../../src/adapters/driven/git/merge.ts#L17)

- Destructive discard primitives, reviewed for unchanged git arguments.
  [`discard.ts:93`](../../../src/adapters/driven/git/discard.ts#L93)

- Stash save/restore.
  [`stash.ts:8`](../../../src/adapters/driven/git/stash.ts#L8)

**Read-only families**

- Diff and dirty-path inspection.
  [`diff.ts:101`](../../../src/adapters/driven/git/diff.ts#L101)

- Version-bump history walk.
  [`version-history.ts:21`](../../../src/adapters/driven/git/version-history.ts#L21)
