---
title: 'EDT Creation Core — Per-Service Branch Plans & Remote Branches'
type: 'feature'
created: '2026-09-24'
status: 'done'
review_loop_iteration: 0
context: []
baseline_commit: 'ec8e1019557634e92e3a6d68f47d9917bb97b491'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `createEdt` applies one base / one naming mode to every member (`branchOptions`), so an
EDT cannot mix services starting from different points, attach an existing or remote-only branch,
or rename one — the upcoming wizard (Stories 2.36–2.38) needs all of that. `renameBranch` also only
gates the *new* name, so renaming `development` away is allowed.

**Approach:** Add an optional, authoritative `memberPlans` map to `CreateEdtParams` executed by a
new plan path in `resolveMemberBranch` (side by side with the untouched `branchOptions` path), plus
two `GitPort` methods (`listRemoteBranches`, `createTrackingBranch`), remote-ref bases for
`createBranch`, an old-name gate on `renameBranch`, and rename-back on rollback.

## Boundaries & Constraints

**Always:**
- `MemberBranchPlan = { kind: 'create'; base: string; name: string } | { kind: 'existing'; branch: string; renameTo?: string }`; `memberPlans: Record<repoPath, MemberBranchPlan>` keys are `resolve()`d like `members`.
- When `memberPlans` is present it is authoritative: a member without a plan, a plan key that is not a member, or an empty `base`/`name`/`branch`/`renameTo` → `invalid-argument` before any write. `branchOptions` becomes optional; neither provided → `invalid-argument`.
- Branch writes never check out (Story 2.2). Every git write is gated by the adapter (AD-8, FR-7).
- `existing` resolution order: local branch (`branchExistsLocally`) wins; else a remote-tracking ref listed by `listRemoteBranches`; else `failed` with `branch-missing`.
- Outcome set widens to `created | existing-branch | renamed | failed`; per-member isolation unchanged (failed member → `failed` row, not registered, others proceed).
- Rollback on registry-write failure: created + tracking branches force-deleted; renamed branches renamed back; each failure `console.error`-logged, never thrown.
- `listBranches` stays local-only; `listRemoteBranches` never fetches.

**Ask First:** any change to CLI `edt create` arguments, output, or its existing tests.

**Never:** convert `branchOptions` into plans; modify existing `create.test.ts` cases; touch TUI/wizard code (Stories 2.36–2.38) or store exposure of remote branches (2.37).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create, local base | `{create, base:'develop', name:'feat/x'}` | `createBranch(m,'feat/x','develop')`; `created`; registered `feat/x` | adapter error → `failed` |
| Create, remote base | `base:'origin/release'` (no local `release`) | branch created from remote ref, no upstream set; `created` | missing ref → `base-branch-missing` |
| Existing local | `{existing, branch:'feat/y'}` exists locally | `assertAllowedBranch` passes; `existing-branch`; registered `feat/y` | protected → `failed` `shared-branch-rejected` |
| Existing local + rename | `branch:'feat/y', renameTo:'feat/z'` | `renameBranch`; `renamed`; registered `feat/z` | old or new protected → `failed` |
| Existing remote-only | `branch:'origin/feat/q'` | `createTrackingBranch(m,'feat/q','origin/feat/q')`; `created`; registered `feat/q` | local `feat/q` exists → `branch-exists` |
| Remote-only + rename | `branch:'origin/feat/q', renameTo:'mine'` | tracking branch `mine`; `created` | protected `mine` → `failed` |
| Missing branch | `branch:'nope'` neither local nor remote | `failed` `branch-missing` | — |
| Registry write fails | mix of created/tracking/renamed | EDT dir/db removed; created+tracking `deleteBranch(...,true)`; renamed → `renameBranch(m, renameTo, branch)` | each failure logged |

</frozen-after-approval>

## Code Map

- `src/core/edt/create.ts` -- `CreateBranchOptions` (L61), `CreateEdtMemberResult.outcome` (L79), `CreateEdtParams` (L89), pre-write validation (L147-152), member loop + `createdBranches` rollback list (L243-262), rollback loop (L280-292), `resolveMemberBranch` (L307-353, `!options.create` path = existing-branch precedent).
- `src/core/ports/git.ts` -- `GitPort`; add `listRemoteBranches`, `createTrackingBranch` next to `listBranches`/`renameBranch` (end of interface); update `renameBranch`'s comment (both names gated).
- `src/adapters/driven/git/index.ts` -- `createGitPort` wiring (L35-63); `createBranch` (L118-150): base check uses `showRef` (L679, `refs/heads/` only); `listBranches` (L592) is the for-each-ref precedent; `renameBranch` (L614) gates only `newName` (L620).
- `src/adapters/driven/git/index.test.ts` -- real-repo helpers `makeGitRepo` (L60), `makeOriginAndClone` (L389), `runGit`, `branchExists`; `createBranch` (L259) and renameBranch describes to extend.
- `src/core/edt/create.test.ts` -- `fakeGit` (L86) and `makeParams`; add a new `describe` for plans.
- GitPort fakes that must gain the two methods (typecheck): `src/core/edt/{create,delete,list,modify,switch}.test.ts`, `src/core/scripts/group-update.test.ts`, `src/adapters/driven/edt-registry/index.test.ts`, `src/adapters/driving/cli/dispatch.test.ts`, `src/adapters/driving/tui/{app-shell.test,app-shell.interaction.test}.tsx`, `src/adapters/driving/tui/store/{app-store.test.ts,slices/edt-slice.test.ts,slices/update-slice.test.ts}`, `src/adapters/driving/tui/zones/edts/edts-zone.interaction.test.tsx` (run `npm run typecheck` to find all).

## Tasks & Acceptance

**Execution:**
- [x] `src/core/ports/git.ts` -- add `listRemoteBranches(repoPath): Promise<Result<string[]>>` and `createTrackingBranch(repoPath, localName, remoteRef): Promise<Result<void>>` with contract comments -- port first.
- [x] `src/adapters/driven/git/index.ts` -- implement both; `createBranch` accepts a base found under `refs/heads/` or `refs/remotes/` and passes `--no-track`; `renameBranch` gates `oldName` too, before any git call -- adapter.
- [x] `src/adapters/driven/git/index.test.ts` -- real-repo tests: remote listing (excludes HEAD, no fetch), tracking branch (upstream set, gated, collision, missing remote), remote-base create (no upstream), rename rejects protected old name.
- [x] GitPort fakes (Code Map list) -- add the two methods -- keep typecheck green.
- [x] `src/core/edt/create.ts` -- `MemberBranchPlan`, optional `memberPlans`/`branchOptions`, validation, plan branch in `resolveMemberBranch`, typed rollback entries (delete vs rename-back), header comment for Story 2.35.
- [x] `src/core/edt/create.test.ts` -- new describe covering every I/O matrix row plus validation rejections (no write happened).

**Acceptance Criteria:**
- Given no `memberPlans`, when `createEdt` runs, then behavior and every pre-existing test are unchanged.
- Given `memberPlans`, when a plan fails, then only that member is `failed` and unregistered; the EDT is still created.
- `npm test`, `npm run typecheck`, `npm run depcheck` pass; no `core → adapters` import (AD-1).

## Spec Change Log

## Design Notes

- `listRemoteBranches`: `git for-each-ref --format=%(refname) refs/remotes/`, drop refs ending in `/HEAD`, strip `refs/remotes/` → `origin/x`. `%(refname:short)` is unsafe: git shortens `refs/remotes/origin/HEAD` to `origin`.
- Remote-only local name default = `branch` minus its first path segment (`origin/feat/q` → `feat/q`).
- `createTrackingBranch`: gate `localName` via `assertAllowedBranch`; `branch-exists` if local ref exists; `remote-branch-missing` if `refs/remotes/<remoteRef>` absent; then `git branch --track -- <local> <remoteRef>`.
- `createBranch` from `origin/x` must not inherit `origin/x` as upstream (would skew ahead/behind, Story 2.6) → `--no-track`, harmless for local bases.
- Rename rollback cannot hit the old-name gate: a rename only succeeded if neither name was protected.

## Verification

**Commands:**
- `npm run typecheck` -- expected: no errors
- `npm test` -- expected: all green, pre-existing `create.test.ts` cases untouched
- `npm run depcheck` -- expected: pass

## Suggested Review Order

**Plan contract & validation**

- Entry point: the plan union the wizard will feed; authoritative when present.
  [`create.ts:98`](../../../src/core/edt/create.ts#L98)

- All plan rejections happen here, before any file or git write.
  [`create.ts:366`](../../../src/core/edt/create.ts#L366)

**Plan execution (per member)**

- Dispatch keeps the legacy `branchOptions` path untouched beside the plan path.
  [`create.ts:464`](../../../src/core/edt/create.ts#L464)

- Existing local branch gated with the new EDT's ulid — closes the cross-EDT gap.
  [`create.ts:537`](../../../src/core/edt/create.ts#L537)

- Remote-only branch becomes a local tracking branch; local name defaults to stripped remote.
  [`create.ts:578`](../../../src/core/edt/create.ts#L578)

- Rollback: force-delete created/tracking branches, rename renamed ones back, log failures.
  [`create.ts:326`](../../../src/core/edt/create.ts#L326)

**Git adapter**

- Base resolved under heads then remotes; `--no-track` avoids inheriting `origin/x` upstream.
  [`index.ts:149`](../../../src/adapters/driven/git/index.ts#L149)

- Rename now gates the old name too — `development` can't be renamed away.
  [`index.ts:641`](../../../src/adapters/driven/git/index.ts#L641)

- Remote listing skips only symbolic refs; `:short` would mangle `origin/HEAD`.
  [`index.ts:685`](../../../src/adapters/driven/git/index.ts#L685)

- Tracking branch: gate, collision check, remote-ref check, then `git branch --track`.
  [`index.ts:713`](../../../src/adapters/driven/git/index.ts#L713)

- Port contract for the two new methods.
  [`git.ts:151`](../../../src/core/ports/git.ts#L151)

**Tests**

- Plan behavior matrix, validation, cross-EDT gate and rollback against fake ports.
  [`create.test.ts:604`](../../../src/core/edt/create.test.ts#L604)

- Real-repo remote listing and tracking-branch coverage.
  [`index.test.ts:969`](../../../src/adapters/driven/git/index.test.ts#L969)
