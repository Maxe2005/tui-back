---
title: 'Modify EDT — Mandatory Branch on Add, No More Silent Default'
type: 'feature'
created: '2026-09-14'
status: 'ready-for-dev'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `core/edt/modify.ts`'s "Add members" step unconditionally reads `git.currentBranch()` and registers whatever the repo happens to be checked out on, never even looking at a matching `setBranches` entry — so the TUI Modify checklist (no branch field for a newly-checked member today) and the Add-to-EDT flow (Story 2.18, which already supplies `setBranches`) can both suffer a spurious failure-on-current-branch instead of using the branch actually requested.

**Approach:** Step 1 defers branch resolution to step 3 for any `addMembers` entry with a matching `setBranches` entry (skip `currentBranch`/`assertAllowedBranch`), and step 3 promotes a successful branch change for such a repo into the member list; an unmatched `addMembers` entry fails fast with a new `branch-required` error. TUI: checking a not-yet-member candidate in Modify auto-stages a suggested branch, reusing the existing branch-edit sub-dialog (now reachable for new members too).

## Boundaries & Constraints

**Always:**
- Step 1 (`modify.ts`) never calls `currentBranch`/`assertAllowedBranch` for a repo that also has a matching `setBranches` entry — only registered/duplicate-membership checks run there; branch resolution defers entirely to step 3.
- An `addMembers` entry with no matching `setBranches` fails that member with `branch-required` ("no branch specified for new member <path>") — isolated/non-fatal, same as `invalid-member`/`duplicate-member`.
- Step 3, on a successful checkout for a deferred (`pendingAdds`) repo, also promotes it into `addedMembers` (not just `branchChanges`) — lock-time assembly already applies `branchChanges` after `addedMembers` (Story 2.18 ordering).
- New pure `suggestBranchForNewMember(existingMembers, topic)`: the shared branch when every existing member has the same one (and ≥1 exists), else `suggestBranchNameFromTopic(topic)`'s slugify. Colocated in `edts-zone.tsx` — reuse Story 2.22's version as-is if it already exists by implementation time.
- Checking a not-yet-member candidate (Space) auto-stages `branchEdits[path]` with that suggestion; `canEditMemberBranch` extended so Enter on that row opens the same branch-edit sub-dialog existing members use (`openBranchEdit`) — today's plain `<Text>` field convention (`text-input-line.tsx`, Story 2.23, doesn't exist yet).
- `resolveModifyOps` includes a `setBranches` entry for every checked non-member, never omits one; confirm is blocked inline (no core call) when a newly-checked member's staged branch is empty, same convention as `validateBranchEditValue`.
- A `branch-required`/collision failure surfaces via whichever per-repo failure convention currently exists (`summarizeFailedResults` or its Story 2.25 replacement) — no new failure-display code here.

**Ask First:** None expected — `pendingAdds`→`addedMembers` promotion mirrors the pattern already used for `branchChanges` in the lock-time assembly.

**Never:** Building `text-input-line.tsx` (2.23) or the structured failure-display registry (2.25); branch-picker modes (2.26); "Remove members"/lock-time write logic beyond receiving promoted adds; `AddToEdtDialogState` changes — it already supplies a matching pair and is fixed for free.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Add + matching `setBranches` | repo in `addMembers` with matching entry (Modify or Add-to-EDT) | Step 1 skips the gate; step 3 resolves + checks out, promotes into member list | N/A |
| Add, no `setBranches` | repo in `addMembers`, no matching entry | Fails with `branch-required`, others unaffected | Isolated per-repo failure |
| New candidate checked | Space on not-yet-member row | `branchEdits[path]` auto-stages via `suggestBranchForNewMember`; editable | N/A |
| Zero existing members | first member added via checklist | Suggestion falls to `suggestBranchNameFromTopic(topic)` | N/A |
| Staged branch left empty | confirm attempted | Blocked inline, dialog stays open, no core call | Same as `branchEdit` |
| Branch claimed by another EDT | `assertAllowedBranch` rejects | Reported per-repo | `summarizeFailedResults` (or 2.25's replacement) |

</frozen-after-approval>

## Code Map

- `src/core/edt/modify.ts` -- step 1 "Add members" (L107-176): builds `pendingAdds` (repoPath + service, no branch) for `addMembers` entries with a matching `setBranches` entry, skipping `currentBranch`/gate for them; unmatched entries fail with `branch-required`. Step 3 (L191-265), on success for a `pendingAdds` repoPath, also pushes into `addedMembers`; lock-time assembly (L303-325) already orders `branchChanges` after `addedMembers`.
- `src/adapters/driving/tui/zones/edts/edts-zone.tsx` -- `canEditMemberBranch` (L410-416) gains the not-yet-member case; `resolveModifyOps` (L446-474) blocks a selected non-member with an empty/missing `branchEdits` entry instead of silently omitting it; new `suggestBranchForNewMember` near `validateBranchEditValue` (L240-242); Modify's Space-toggle (L1125-1130) stages `branchEdits[path]` on newly selecting a non-member; checklist meta (L1638-1646) already reads `branchEdits[path]`, unaffected. `AddToEdtDialogState` (L542-550) unaffected — already supplies a matching pair.
- Tests: `src/core/edt/modify.test.ts` (pendingAdds/branch-required/promotion); `edts-zone.test.tsx` + `.interaction.test.tsx` (new-member field, empty block, suggestion source).

## Tasks & Acceptance

**Execution:**
- [ ] `modify.ts` -- split step 1 into `pendingAdds` (matched) vs immediate `branch-required` (unmatched) -- stops the silent `currentBranch` read
- [ ] `modify.ts` -- step 3 promotes a successful `pendingAdds` change into `addedMembers` -- new member actually lands in the written entry
- [ ] `edts-zone.tsx` -- `suggestBranchForNewMember(existingMembers, topic)` -- unanimous-branch-or-topic-slug suggestion
- [ ] `edts-zone.tsx` -- extend `canEditMemberBranch` + Space-toggle to stage/edit a non-member's branch
- [ ] `edts-zone.tsx` -- `resolveModifyOps` blocks confirm when a selected non-member's staged branch is empty
- [ ] Extend `modify.test.ts`, `edts-zone.test.tsx`, `edts-zone.interaction.test.tsx` for the I/O matrix

**Acceptance Criteria:**
- Given `modifyEdt` with a repo in `addMembers` and a matching `setBranches` entry, when pre-lock steps run, then step 1 makes no `currentBranch`/gate call for it and the repo lands in the final member list with that branch.
- Given `modifyEdt` with a repo in `addMembers` and no matching `setBranches` entry, then it fails that member with `branch-required`, others unaffected.
- Given the Modify checklist, when a not-yet-member service is checked, then its branch stages via `suggestBranchForNewMember`, always editable, and `resolveModifyOps` includes a `setBranches` entry for it.
- Given a newly-checked member's staged branch is empty, when confirm is attempted, then it's blocked inline and no core call is made.
- Given a requested branch is already claimed by another EDT, then the failure is reported per-repo without aborting the others.
- `npm test`, `npm run typecheck`, `npm run depcheck` all pass.

## Spec Change Log

## Design Notes

Written ahead of Stories 2.22/2.23/2.25 (all still `backlog`/`ready-for-dev`); recommended build order is 2.23 → 2.25 → {2.22, 2.24, 2.26} in any order. If those have landed by implementation time, prefer their real components over the colocated fallbacks above — no functional rework expected either way.

## Verification

**Commands:**
- `npm test` -- all suites green, including updated `modify.test.ts`, `edts-zone.test.tsx`, `edts-zone.interaction.test.tsx`
- `npm run typecheck` -- clean
- `npm run depcheck` -- no boundary violations

**Manual checks:**
- Modify an EDT with ≥2 members sharing a branch → check a new service → field pre-fills with that shared branch, editable; clear it → confirm blocked. Zero/divergent-branch members → field falls back to the topic slug. Add-to-EDT on a service whose current branch collides with another EDT → succeeds using the requested branch instead of failing on the current one.
