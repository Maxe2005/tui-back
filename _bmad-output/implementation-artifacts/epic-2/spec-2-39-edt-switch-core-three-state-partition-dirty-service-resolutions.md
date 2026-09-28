---
title: 'EDT Switch Core — Three-State Partition & Dirty-Service Resolutions'
type: 'feature'
created: '2026-09-28'
status: 'in-review'
review_loop_iteration: 0
context: []
baseline_commit: '1d4abf4a74b2288cd2d8aecd42dbc98d8db2f6f2'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `switch.ts` partitions repos by *target* membership. As a result, a dirty repo of the outgoing EDT that is not a target member gets stashed and immediately re-popped onto the shared branch (D1: the work leaks out of its EDT). A dirty repo that belongs only to the target is stashed under the outgoing tag (D2). Dirty work owned by nobody travels silently.

**Approach:** Classify every registered repo against the **outgoing** EDT (state 1/2/3). State 1 is auto-stashed for its return. A dirty state-2/3 repo requires an explicit per-repo `adopt` or `discard` resolution; without one, the switch refuses before any write. CLI flags (2.40) and the TUI dialog (2.41) are out of scope. The TUI gets an interim safe cancel.

## Boundaries & Constraints

**Always:**
- All ACs of Story 2.39 in `epics.md` (L1882-1912) are normative, including every adopt step and its order, the discard contract, the `switch-dirty-services-unresolved` details shape and `switch-adopt-without-outgoing`.
- Classification: state 1 is a member of the outgoing EDT; state 2 is a member of any other EDT, including the target; state 3 is a member of no EDT. The destination stays target-driven: a target member goes to its own branch (gated by `assertAllowedBranch(..., target.ulid)` and followed by a pop of its target-tagged stash, as today); any other repo goes to its manifest `sharedBranch`, fetched first if it is missing.
- The pre-flight re-reads the dirtiness of every registered repo before **any** git write. A failed read excludes that repo from the pre-flight; the main loop reports it as `failed`.
- A repo that is clean in the pre-flight but dirty in the main loop, with no resolution, becomes a `failed` row (`switch-dirty-unresolved`) and is left untouched.
- A discard resolution on a repo that is clean at execution time needs nothing discarded: the repo is checked out plainly and its outcome is `switched`.
- Once anything is stashed, every failure restores that stash before returning `failed`.
- `GitPort.discardAll` runs `git reset --hard` then `git clean -fd` (never `-x` or `-ff`). Its only caller is `switch.ts`.
- `listDirtyPaths` gains an opt-in expansion of untracked directories into files. Story 3.4's classifier keeps its current default.
- The adopt membership write (step 4) reuses modify.ts's lock-held edts.yaml assembly, extracted as an exported helper. It never calls the full `modifyEdt`, which would check out and pop.

**Ask First:** changing the idempotency, lock-peek/`--force` or final state.json/edts.yaml write semantics; any CLI flag work (belongs to 2.40).

**Never:** a CLI `--adopt-dirty`/`--discard-dirty` (2.40); the TUI resolution dialog (2.41); keeping `NON_MEMBER_STASH_TAG` or the `tui-back:shared` round-trip; touching ignored files; discarding without an explicit `discard` resolution.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| State 1 dirty, not target | c ∈ outgoing, dirty | stash `tui-back:<out>`, checkout shared, no pop, `switched` | — |
| State 1 dirty, also target | a ∈ outgoing ∩ target | stash `<out>`, checkout own branch, pop `<target>` | — |
| Only state 1 dirty | seam passed | seam not invoked | — |
| State 2/3 dirty, unresolved | no resolution | `switch-dirty-services-unresolved`, details per repo | zero git writes, state untouched |
| Seam cancel | `{kind:'cancel'}` | `switch-cancelled-by-user` | zero writes |
| Explicit resolutions | `dirtyResolutions` + seam | seam skipped | — |
| Adopt, new branch | b dirty, adopt `feat/b` | gate → stash `<out>` → createBranch from current → add to outgoing → checkout dest, `adopted` | — |
| Adopt, same as current | current `feat/b` not shared | no createBranch | shared current → gate rejects |
| Adopt, protected/claimed | `development` or another EDT's branch | `failed`, nothing stashed | — |
| Adopt, later step fails | createBranch/membership/checkout error | stash restored, `failed` | — |
| Adopt, first switch | no outgoing | `switch-adopt-without-outgoing` | zero writes |
| Discard | b dirty | capture paths (expanded), discardAll, checkout, `discarded` + `detail.discardedPaths` | discardAll error → `failed` |
| Target-only dirty member | a ∈ target only | state 2 → needs resolution (D2 gone) | — |

</frozen-after-approval>

## Code Map

- `src/core/edt/switch.ts`:
  - Rewrite the header, classification, pre-flight, seam and per-repo functions.
  - Delete `NON_MEMBER_STASH_TAG` (L274) and the non-member pop (L365).
  - Keep the lock-peek (L147-164), idempotency (L137), unregistered-member rows (L215-224) and the final lock-held write (L234-256) unchanged.
- New pure export `classifySwitchRepos(registered, outgoing, target, allEdts)` in `switch.ts` (or a sibling `switch-classify.ts`). It returns `state`, `targetMember?` and `owningTopics` per repo.
- New types:
  - `DirtyResolution`.
  - `SwitchDirtyRepo`, reshaped to `{service, repoPath, scope: 'outgoing-member'|'member-of-other-edt'|'non-member', currentBranch, currentBranchShared, owningEdtTopics, resolution?: 'auto-stash'}`.
  - `SwitchDirtyReposChoice` = `{kind:'cancel'} | {kind:'proceed', resolutions}`.
  - `SwitchActiveEdtParams.dirtyResolutions?`.
  - `SwitchEdtRepoResult.outcome` adds `adopted | discarded`, and `detail.discardedPaths?`.
- `src/core/edt/shared-branches.ts` -- `isSharedBranch`, used for `currentBranchShared` (manifest `sharedBranch`).
- `src/core/edt/modify.ts` -- `persistModifiedEntry` (L443): extract an exported `addMemberUnderLock(...)` (or equivalent) that the switch's adopt path calls.
- `src/core/ports/git.ts` -- add `discardAll`, whose doc comment names it the consent-gated primitive; add the `listDirtyPaths(repoPath, opts?: {expandUntracked?: boolean})` option.
- `src/adapters/driven/git/index.ts` -- the `listDirtyPaths` option (L521, `--untracked-files=all`) and the `discardAll` implementation (error code `git-discard-error`); wire both into the adapter object (L55).
- Every `GitPort` fake in 13 test files (grep `discardPaths:`) needs `discardAll`.
- `src/adapters/driving/tui/store/slices/edt-slice.ts`:
  - The seam (L337) keeps pausing on `switchDirtyRepos`.
  - `resolveSwitchDirtyRepos` takes the new choice type.
- `src/adapters/driving/tui/zones/edts/dialogs/switch-dialog.tsx`:
  - L80-90: in the interim, the preview never proceeds. `Enter` and `Esc` both resolve `{kind:'cancel'}`.
  - L111 `DirtyReposPreview`: explain the block and list the state-2/3 services (scope, current branch). Say they must be committed or stashed by hand for now. State-1 rows are marked "mis de côté automatiquement".
- `src/adapters/driving/cli/subcommands.ts` L439 -- no flags yet. It passes neither seam nor resolutions and therefore fails safe; update the comment only.
- Tests:
  - `switch.test.ts`: rewrite the `tui-back:shared` cases (L578-636) and the seam cases (L638+); add the matrix.
  - `git/index.test.ts`: a real-git `discardAll` test (tracked-modified, untracked file, untracked dir, ignored file survives), plus the expanded `listDirtyPaths`.
  - `modify.test.ts`: the extracted helper.
  - `edt-slice.test.ts` L143-195 and `edts-zone.interaction.test.tsx` L188-261: the new choice and the cancel-only preview.
  - `tui-back.e2e.test.ts` L1126: rewrite. r1 (state 1) stays stashed under `tui-back:<a>`, and switching back to `a` pops it onto `feat/r1`.

## Tasks & Acceptance

**Execution:**
- [x] `core/ports/git.ts`, `adapters/driven/git/index.ts` (+ test), all GitPort fakes -- `discardAll` and expanded `listDirtyPaths` -- the destructive primitive with real-git proof.
- [x] `core/edt/modify.ts` (+ test) -- export the lock-held add-member helper -- the single persistence path for adopt.
- [x] `core/edt/switch.ts` -- classification helper, pre-flight, seam, resolutions, adopt/discard, per-repo rewrite -- the story core.
- [x] `core/edt/switch.test.ts` -- rewrite and cover every matrix row, plus `classifySwitchRepos` unit tests.
- [x] `edt-slice.ts`, `switch-dialog.tsx` (+ tests) -- the interim cancel-only preview with explanation.
- [x] `cli/subcommands.ts` comment, `tui-back.e2e.test.ts` -- fail-safe CLI and state-1 stash round-trip e2e.

**Acceptance Criteria:**
- Given a dirty state-2/3 repo and no resolution from any source, when the switch runs, then no git write command is issued on any repo and state.json/edts.yaml are unchanged.
- Given the CLI with a dirty non-member, when `edt switch` runs, then it exits non-zero with `switch-dirty-services-unresolved`.
- `npm run typecheck && npm test && npm run depcheck` pass.

## Design Notes

Per-repo flow: `pre = state1&&dirty ? stash(<out>) : dirty ? resolve(adopt|discard) : none`, then `checkout(dest)`, then `if targetMember: restoreStash(<target>)`. Adopt's stash also uses the outgoing tag, so a later return into the outgoing EDT pops the work onto the adopted branch through the ordinary member path.

On a checkout failure after adopt's membership write, the stash is restored onto the current branch and the membership is kept (the branch exists and is registered). The row detail says so.

## Verification

**Commands:**
- `npm run typecheck && npm test && npm run depcheck` -- expected: all green

**Manual checks:**
- TUI: switch with a dirty non-member → the preview explains the block, and Enter/Esc cancel with nothing touched.
