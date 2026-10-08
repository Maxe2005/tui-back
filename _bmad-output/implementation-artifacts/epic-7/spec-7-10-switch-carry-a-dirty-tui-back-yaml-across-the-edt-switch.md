---
title: 'Story 7.10: Switch — carry a dirty .tui-back.yaml across the EDT switch'
type: 'feature'
created: '2026-10-08'
status: 'in-progress'
baseline_commit: '574f40dcc811b1949c799e6b89970371d5087b49'
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `edt switch` stashes a dirty outgoing repo with `git stash push -u`, so a dirty `.tui-back.yaml` is stashed too. The target branch may then overwrite, empty or lack it, a later stash pop can clobber the current one, a manifest-only dirty state-2/3 repo wrongly asks for adopt/discard, `discardAll` destroys it, and a tracked manifest differing across branches aborts the checkout.

**Approach:** The manifest is the single exception to stash/adopt/discard. Per repo, before any other git write, a dirty manifest is captured (exact bytes, or "absent"), cleared to HEAD, the normal switch runs on a tree that no longer contains it, then the captured state is written back last. The pre-flight ignores it when deciding whether a repo is dirty.

## Boundaries & Constraints

**Always:** `core/` imports no `node:fs` — file I/O sits behind a new `ManifestCarryPort`; Result<T> with kebab-case codes; the restore runs after the target-stash pop and also when the switch row failed; a safety copy of the captured file is kept under the repo's `.git/` until the restore succeeds; the `GitPort` read changes are additive/optional; AD-17 comment rule; imports first per file; conventional commits with `(story 7.10)` on this story branch; verify with `npm test && npm run typecheck && npm run depcheck`.

**Ask First:** None — defaults delegated.

**Never:** Change the manifest schema or loader; stash, adopt or discard the manifest; touch the 3-state classification, adopt/discard semantics for other files, or the lock/state.json/edts.yaml writes; add a persisted state file.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Modified tracked manifest | state-1 repo, manifest differs on target | other dirty files stashed; manifest byte-identical after switch | N/A |
| Untracked / staged-new manifest | target tracks its own copy | checkout does not abort; carried file wins | N/A |
| Deleted manifest | tracked, deleted in tree | still absent after switch | N/A |
| Manifest-only dirty, state 2/3 | no other dirty path | not a resolution row; seam not invoked; no `switch-dirty-services-unresolved` | N/A |
| Manifest + other files, adopt/discard | state 2/3 | others adopted/discarded; manifest carried; absent from `dirtyPaths` and `discardedPaths` | N/A |
| Legacy stash holds a manifest | popped on return | carried version still wins (restore is last) | N/A |
| Checkout fails | after clear | manifest rewritten; row `failed` | rollback on restore failure: row names the safety-copy path, copy kept |
| Capture/clear fails | before any write | row `failed`, repo untouched | N/A |

</frozen-after-approval>

## Code Map

- `src/core/edt/switch.ts:164-300,317-427,764-844` -- pre-flight (`hasUncommittedChanges`, `describeDirtyRepo`) and `switchMemberRepo`/`switchNonMemberRepo`; wrap both in the carry helper; add optional `manifestCarried?: boolean` to `SwitchDirtyRepo`; new required `manifestCarry` in `SwitchActiveEdtParams`.
- `src/core/edt/manifest-carry.ts` (new) -- `MANIFEST_FILE`, `withCarriedManifest(git, carry, repoPath, service, run)`: dirty? → `capture` → `git.discardPathsToHead([MANIFEST_FILE])` → `run()` → `restore`; folds restore failure into the row.
- `src/core/ports/manifest-carry.ts` (new) -- `capture(repoPath)` → snapshot (`present` bytes | `absent`) + writes safety copy; `restore(repoPath, snapshot)` writes/deletes then removes the copy.
- `src/adapters/driven/manifest/carry.ts` (new, + test on a tmp dir) -- fs implementation; safety copy at `<repo>/.git/tui-back-manifest-carry` only when `.git` is a directory.
- `src/core/ports/git.ts`, `src/adapters/driven/git/index.ts:330,488` -- `hasUncommittedChanges` and `listDirtyPaths` gain optional `{ excludePaths }` (git pathspec `:(exclude)`); `discardPathsToHead` (`:608`) reused as the clear step.
- `src/core/edt/activate.ts:180-230` -- dirty listing excludes the manifest; wrap `activateRepo` so a dirty manifest is never an at-risk path nor discarded.
- `src/adapters/driving/cli/subcommands.ts:733-790` (+ composition root) -- pass the adapter into `switchActiveEdt` / `activateEdt`.
- `src/adapters/driving/tui/zones/edts/dialogs/switch-resolution/switch-resolution-view.tsx`, `.logic.ts` -- show "`.tui-back.yaml` — conserved" for rows with `manifestCarried`; never in the discard confirmation list.
- `docs/tui-back-manifest.md` -- carry rule already documented (commit 574f40d); no change expected.
- Tests: `switch.test.ts`, `activate.test.ts`, `git/index.test.ts` (real repos), `switch-resolution.logic.test.ts`, plus every inline fake needing `manifestCarry`.

## Tasks & Acceptance

**Execution:**
- [ ] `ports/manifest-carry.ts`, `adapters/driven/manifest/carry.ts` (+ tests) -- capture/restore with safety copy -- file I/O behind a port.
- [ ] `ports/git.ts` + git adapter (+ real-git tests) -- `excludePaths` on the two read methods -- pre-flight ignores the manifest.
- [ ] `core/edt/manifest-carry.ts` (+ tests with fake ports: ordering, rollback, restore failure) -- carry helper.
- [ ] `core/edt/switch.ts` (+ tests per matrix row) -- wire helper, pre-flight exclusion, `manifestCarried` flag.
- [ ] `core/edt/activate.ts` (+ tests) -- same rule on first activation.
- [ ] CLI wiring and test fakes -- typecheck stays green.
- [ ] Switch-resolution dialog (+ tests) -- "conserved" line.
- [ ] Real-git integration test: tracked-modified, untracked, deleted, tracked-and-different-on-target, absent-on-target, with other dirty files, adopt, discard.

**Acceptance Criteria:**
- Given a dirty manifest, when any switch completes, then the working-tree file is byte-identical (or still absent), whatever the target branch holds.
- Given a state-2/3 repo dirty only through the manifest, when pre-flight runs, then no resolution is requested.
- Given adopt/discard on a repo that also has a dirty manifest, then neither stashes nor destroys it and neither path list names it.
- Given the checkout fails or the restore fails, then the manifest is rewritten, or the row names the kept safety copy.

## Design Notes

Clearing the manifest before the normal flow means stash, `discardAll`, adopt and checkout need no knowledge of it. `.tui-back.yaml` is a repo-root path, so the porcelain/pathspec name is the literal `.tui-back.yaml`. Afterwards the file shows as modified against the target branch's HEAD — intended.

## Verification

**Commands:**
- `npm test` -- expected: all pass, incl. every matrix row.
- `npm run typecheck` -- expected: clean.
- `npm run depcheck` -- expected: clean.
