---
title: 'Switch the Active EDT Without Data Loss'
type: 'feature'
created: '2026-08-18'
status: 'in-review'
baseline_commit: fa61e0bcf0463b4fafad20583ca324a969f1e259
review_loop_iteration: 0
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/ARCHITECTURE-SPINE.md'
  - '_bmad-output/implementation-artifacts/epic-2/epic-2-context.md'
  - '_bmad-output/implementation-artifacts/epic-2/2-3-git-branch-scope-safety-gate-shared-branch-rejection.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nothing changes which EDT is "active" yet. Every managed repo just sits wherever its last git write left it, so moving between EDTs by hand risks losing uncommitted work and leaving stray repos on the wrong branch (FR-6/FR-8).

**Approach:** Add a core `switchActiveEdt` use-case: for every managed repo, stash uncommitted work if present, then check out the target EDT's registered branch for its members and the manifest `sharedBranch` (fetched first if missing locally) for everyone else; persist the new active EDT to `state.json` (AD-10); block by default when the outgoing EDT has an in-progress action, detected via a new non-blocking lock peek.

## Boundaries & Constraints

**Always:**
- FR-6/FR-8: after a successful switch, exactly one EDT is active; every target member sits on its own registered branch; every other managed repo sits on its manifest `sharedBranch` — regardless of stale membership in another, now-inactive EDT.
- Every repo's uncommitted work (tracked + untracked) is stashed (`git stash push -u -m "tui-back:<ulid>"`) before any checkout touches it; switching back into an EDT that owns a matching stash pops it (message-matched, not position-matched).
- A missing local shared branch is fetched from `origin` before checkout; per-repo isolation mirrors `createEdt` — one repo's stash/fetch/checkout failure is `failed` in `data.results`, never aborts the others or the `state.json` write.
- `state.json`'s `activeEdt` is updated once the target EDT is resolved and no blocking lock applies, independent of individual repo outcomes (same philosophy as `createEdt` still registering an EDT despite member failures).
- AD-8's cross-EDT half: `assertAllowedBranch` gains an optional `edtId` param — when passed (with an `EdtRegistryPort` wired into the git adapter), it also rejects a branch already registered as a *different* EDT's own branch for that repo. Existing (no-`edtId`) call sites in `create.ts` are untouched.
- The in-progress check is a new non-blocking `LockPort.peek(resourceKey)` (stat only, no retry/wait) against resource key `edt:<outgoingUlid>` — the convention future EDT-scoped actions (Epic 3+) must acquire for this check to mean anything. No action acquires it yet; this story only reserves and checks the convention.
- Switching to the already-active EDT is a no-op success (FR-1 idempotency) — zero git calls.

**Ask First:** None — open design decisions (stash strategy, TUI scope, stop-action scope, AD-8 timing) were already resolved with the human before drafting; see Design Notes.

**Never:**
- Build a real abort/kill mechanism for an in-progress action, or a "re-run" flow — no long-running action exists yet to abort (Epic 3 unbuilt). `--force` past a held lock only marks the outgoing EDT `interrupted`; nothing is actually terminated.
- Wire the TUI (`edts-zone.tsx` switch action, Zustand store `fs.watch` resync of `state.json`) — deferred to a follow-up story, logged in `deferred-work.md`. This story is CLI + core only, matching 2.1–2.3.
- Add a schema/migration framework for `edts.yaml` or `state.json` — both stay hand-rolled reads/writes (AD-7).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | target has a dirty member + a clean non-member repo | member stashed then checked out to its branch; non-member checked out to shared branch; `state.json` updated | N/A |
| Missing local shared branch | non-member repo lacks `development` locally | fetched from `origin`, then checked out | fetch failure → that repo `failed`, others unaffected |
| Already-active target | `state.json.activeEdt` already equals target ulid | no-op success, zero git calls, `state.json` unchanged | N/A |
| Outgoing EDT locked, no `--force` | `edt:<ulid>` lock held | blocked before touching any repo (`switch-blocked-action-in-progress`) | N/A |
| Outgoing EDT locked, `--force` | same, `--force` passed | switch proceeds; outgoing registry entry set to `interrupted` | N/A |
| Returning to an interrupted EDT | target entry's `status === 'interrupted'` | switch succeeds, `data.wasInterrupted: true` | N/A |
| One repo's checkout fails | e.g. dirty worktree git can't stash | that repo `failed` in `data.results`; others + `state.json` still succeed | error surfaced in that result row |

</frozen-after-approval>

## Code Map

- `src/core/ports/state.ts` (new) -- `StatePort`: `readActiveEdt`/`writeActiveEdt` over the AD-10 `state.json` pointer.
- `src/adapters/driven/state/index.ts` (new) -- implementation at `XDG_STATE_HOME/tui-back/state.json`; ENOENT → `ok(null)`, mirrors `edt-registry/index.ts:38`'s read/parse/validate shape (JSON, not YAML).
- `src/core/ports/lock.ts:14` -- add `peek(resourceKey): Promise<Result<{ locked: boolean }>>` alongside `acquire`.
- `src/adapters/driven/lock/index.ts` -- implement `peek`: stat the lock dir + `owner.json`, no retry/wait; reuses `isPidAlive` (`helpers.ts:21`) so a stale holder reads as not-locked.
- `src/core/ports/edt-registry.ts:26` -- add `setStatus(ulid, status): Promise<Result<void>>`.
- `src/adapters/driven/edt-registry/index.ts` -- implement `setStatus` (read/find/replace/write, mirrors `addEdtRegistryEntry` at line 76).
- `src/core/ports/git.ts` -- extend `GitPort`: `checkout`, `hasUncommittedChanges`, `stashSave`, `restoreStash`, `branchExistsLocally`, `fetch`; `assertAllowedBranch(repoPath, branchName, edtId?)` gains the optional param.
- `src/adapters/driven/git/index.ts:24` -- `createGitPort(manifest, edtRegistry?)`: implement the new methods via `spawnSync` (same exit-code taxonomy as `showRef` at line 161); extend `assertAllowedBranch` to reject a branch owned by a *different* EDT when both `edtId` and `edtRegistry` are present.
- `src/core/edt/switch.ts` (new) -- `switchActiveEdt`: resolve target by topic; no-op if already active; `lock.peek('edt:<outgoingUlid>')` gate (`--force` override → outgoing `status: 'interrupted'`); partition `registry.list()` into target-members vs rest; stash-if-dirty + checkout each (fetch-first for a missing shared branch); write `state.json`; set outgoing `inactive` / target `active`. Per-repo isolation, mirrors `create.ts`'s `results` shape (line 226).
- `src/adapters/driving/cli/subcommands.ts:83` -- add `edt switch --to <topic> [--force]` beside the existing `create` action dispatch.
- `src/bin/main.ts:24` -- wire `createGitPort(manifest, edtRegistry)`; add `createStatePort`/`resolveStateFile`; pass `state` into `buildSubcommands`.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- log the TUI-wiring deferral (edts-zone switch action + store `fs.watch` resync); mark the AD-8 cross-EDT entry resolved by this story.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/ports/state.ts` -- add `StatePort` -- AD-10 contract
- [x] `src/adapters/driven/state/index.ts` + `.test.ts` -- implement + unit test
- [x] `src/core/ports/lock.ts` -- add `peek`
- [x] `src/adapters/driven/lock/index.ts` + `index.test.ts` -- implement `peek` + tests (held/free/stale-holder)
- [x] `src/core/ports/edt-registry.ts` -- add `setStatus`
- [x] `src/adapters/driven/edt-registry/index.ts` + `index.test.ts` -- implement + test
- [x] `src/core/ports/git.ts` -- extend `GitPort`
- [x] `src/adapters/driven/git/index.ts` + `index.test.ts` -- implement new methods + cross-EDT gate + tests
- [x] `src/core/edt/switch.ts` + `switch.test.ts` -- use-case + unit tests covering the I/O matrix
- [x] `src/adapters/driving/cli/subcommands.ts` -- `edt switch` wiring
- [x] `src/bin/main.ts` -- composition-root wiring
- [x] `src/bin/tui-back.e2e.test.ts` -- e2e case(s) for switch
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- log TUI-wiring deferral; resolve AD-8 entry
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- flip `2-4` to `in-progress` then `review`

**Acceptance Criteria:**
- Given the target topic doesn't match any registered EDT, when switch runs, then it fails upfront (`edt-not-found`) with no repo touched.
- Given a switch succeeds, when evaluated, then `state.json`'s `activeEdt` equals the target ulid and the target's registry entry is `active`.
- Given a target member's own branch is missing locally, when checked out, then that repo is `failed` in `data.results`, never a thrown error.
- Given `--force` bypassed a held lock, when the developer later switches back to that EDT, then `data.wasInterrupted` is `true` for that call.

## Design Notes

- Stash matching is by git-stash message (`tui-back:<ulid>`), not stack position — safe even if the developer's own unrelated stashes exist, and avoids inventing a second state file just to track stash refs.
- `edt:<ulid>` as the lock resource-key convention is new precedent this story sets for Epic 3's group update to follow; nothing enforces that convention yet beyond this story's own `peek`.
- "Stop the action" stays detection-only by explicit human direction: no abort primitive exists in the codebase yet (locks are short-lived, held only for a single action's own duration), and nothing long-running exists today to actually stop.

## Verification

**Commands:**
- `npm test` -- all suites green
- `npm run typecheck` -- clean
- `npm run depcheck` -- no dependency violations found

**Manual check:**
- Two local test repos: `tui-back edt create --topic a --member <r1>`, `tui-back edt create --topic b --member <r2>` with dirty worktrees, then `tui-back edt switch --to b` — confirm `r1` is stashed+reset to `development`, `r2` is on its own branch, `state.json.activeEdt` is `b`'s ulid.
