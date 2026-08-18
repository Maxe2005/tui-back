---
title: 'Git Branch-Scope Safety Gate & Shared-Branch Rejection'
type: 'feature'
created: '2026-08-18'
status: 'done'
baseline_commit: b7a45ffbbd876683fd2aac1d01e7b819bb32e538
review_loop_iteration: 0
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 2.2's seed gate only rejects a shared branch when explicitly requested as a *new* branch name. Two paths still record a shared branch as a member's own EDT branch (FR-7/AD-8 violation): branch-creation-disabled joins ungated with the raw `currentBranch()` (often `development`); a `createBranch` failure joins via a `currentBranch`/`sharedBranch` fallback (tracked in `deferred-work.md`, confirmed live by an existing test).

**Approach:** Extract Story 2.2's inline shared-branch check into one reusable `GitPort.assertAllowedBranch(repoPath, branchName)` gate (adapter-resolved, never caller-trusted), used by `createBranch`/`deleteBranch` and newly by `createEdt`'s disabled-branch path. A member whose only resolvable branch is shared, or whose resolution failed, is `failed` in `results` and excluded from registered `members`; batch stays per-member isolated.

## Boundaries & Constraints

**Always:**
- AD-8: `assertAllowedBranch` resolves the shared-branch set (`development`/`preprod`/`prod` ∪ manifest `sharedBranch`) itself at check time; no caller-supplied branch bypasses it.
- Every branch that becomes a member's recorded EDT branch — created, reused, or fallback — passes this gate first; a shared branch is never written as a member's own branch.
- Per-service failure isolation stays intact; a gate rejection is `failed` (`shared-branch-rejected`) in `results`, never silently dropped; if every member is excluded, the EDT is still created with zero members (Story 2.5's zero-member invariant).
- Result envelope + kebab-case error codes; outcome set stays `created`/`existing-branch`/`failed`; NodeNext `.js` imports, imports-first.

**Never:** Build Story 2.4/2.5 use-cases or an `EdtRegistryPort`-aware "not this EDT's own branch" check (no call site exists yet); add an "active EDT"/`state.json` read-back concept (2.4's scope); change CLI flags; add npm dependencies.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior |
|----------|--------------|---------------------------|
| Disabled branch-creation, current branch shared | `--member A`, no `--create-branches`, A on `development` | `failed` (`shared-branch-rejected`); excluded from `members`; no `git` call |
| Disabled branch-creation, current branch ordinary | A on `feature-x` | Unchanged: `existing-branch`, included (regression) |
| `createBranch` fails, fallback would be shared | base missing, A's current branch `development` | Stays `failed`; excluded (previously recorded `development`) |

</frozen-after-approval>

## Code Map

- `src/core/ports/git.ts` -- add `assertAllowedBranch(repoPath, branchName): Promise<Result<void>>` to `GitPort`; drop the "story 2.3" forward-reference in the header comment.
- `src/adapters/driven/git/index.ts` -- extract the inline `isSharedBranch` checks (lines 42-47, 87-92) into exported `assertAllowedBranch(manifest, repoPath, branchName)`; `createBranch`/`deleteBranch` call it first; wire into `createGitPort` (21-27).
- `src/core/edt/create.ts` -- `resolveMemberBranch`'s disabled-branch path (293-297): call `git.assertAllowedBranch` before returning `existing-branch`; reject → `failed`. Per-member loop (222-229): push to `memberEntries` only when `outcome !== 'failed'`.
- `src/core/edt/create.test.ts` -- update the fallback test (~363-378) to assert `failed`/excluded; add the table's cases.
- `src/adapters/driven/git/index.test.ts` -- `assertAllowedBranch` cases (`SHARED_BRANCHES`, manifest `sharedBranch`, passing ordinary branch), reusing existing fixtures.
- `src/bin/tui-back.e2e.test.ts` -- one e2e case: repo on `development`, no `--create-branches` → `failed`; `edts.yaml` excludes that member.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- mark the fallback entry (line 5) resolved; `sprint-status.yaml` -- flip `2-3` to `in-progress` then `done`.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/ports/git.ts` -- add `assertAllowedBranch`.
- [x] `src/adapters/driven/git/index.ts` -- extract into `assertAllowedBranch`; delegate from `createBranch`/`deleteBranch`.
- [x] `src/core/edt/create.ts` -- gate disabled-branch path; exclude `failed` from `memberEntries`.
- [x] `src/core/edt/create.test.ts` -- update fallback test; add matrix cases.
- [x] `src/adapters/driven/git/index.test.ts` -- unit-test `assertAllowedBranch`.
- [x] `src/bin/tui-back.e2e.test.ts` -- e2e case for disabled+shared.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- mark fallback item resolved.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- flip 2.3 to `in-progress` then `done`.

**Acceptance Criteria:**
- Given any git write path, when the target is shared/protected, then the adapter-level gate rejects it before any `git` invocation (AD-8).
- Given a member's only resolvable branch is shared, when EDT creation runs, then it is `failed` and excluded from `members`, without aborting others or the creation itself.

## Spec Change Log

<!-- Append-only. Populated by step-04 during review loops. -->

## Design Notes

- `assertAllowedBranch` closes only the shared-branch half of AD-8; the cross-EDT half needs `EdtRegistryPort` wired into the git adapter, deferred to whichever of Story 2.4/2.5 adds the first call site needing it.

## Verification

**Commands:**
- `npm test` -- all suites green.
- `npm run typecheck` -- clean.
- `npm run depcheck` -- `no dependency violations found`.

**Manual check:**
- `tui-back edt create --topic demo --member <repo-on-development>` (no `--create-branches`) → `failed`/`shared-branch-rejected`; `edts.yaml` excludes that member.
