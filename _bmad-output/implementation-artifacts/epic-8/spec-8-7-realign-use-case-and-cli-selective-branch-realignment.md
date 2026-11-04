---
title: 'Story 8.7: realign Use-Case & CLI — Selective Branch Realignment'
type: 'feature'
created: '2026-11-02'
status: 'done'
baseline_commit: '97e1082aaa5d8251032813ccb38694a306dbda5f'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8/epic-8-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 8.6 shows which repos left the branch they should be on, but fixing them still means switching EDT or checking out each repo by hand.

**Approach:** A pure `core/realign` use-case checks out the expected branch (members: active-EDT branch; others: `sharedBranch`) for a selection of services, through a checkout step extracted from the switch core, with an optional post-realign restart reusing Story 2.44's restart phase, under the update action lock; exposed as `tui-back realign`.

## Boundaries & Constraints

**Always:** Candidates come from the 8.6 drift model (members + `others`); `--scope none|edt|all` resolves to `[]` / drifted members / every drifted service; `--service` names are added to the scope's list. Aligned selected services → `unchanged`, never touched. Before any git write, per service: a dirty tree (`.tui-back.yaml` excluded, carried as in switch via `withCarriedManifest`) → `skipped` `realign-dirty-work`; merge/rebase in progress or unmerged paths → `skipped` with its own code; drift `unknown` → `skipped` `realign-drift-unknown`. The AD-8 gate (`resolveTargetBranch`) and checkout errors → `failed`. Work is never stashed, discarded or moved. Closed rows `{service, outcome: realigned|unchanged|skipped|failed, detail?}`; a throwing worker → its `failed` row; the run resolves, never rejects. Whole run holds `group-update` then `edt:<active ulid>` (`action-in-progress` → `realign-blocked-action-in-progress`). One `logAction(active, 'realign', success|failed, detail)` entry with selection + outcomes; a log failure never fails the run. Restart (`simple|clean`) only for `realigned` services with a container, via `restartAfterSwitch`; others `skipped`; no rollback. CLI validates every flag, scope and service name (unknown = not a member nor a managed other) before locking or touching anything; absent flags default to `edt` / `none` (settings arrive in 8.8); exit non-zero when any row is `failed` or `restartNeedsAttention`. Core pure (ports injected, `Result<T>`, kebab-case codes); English, header comments ≤ 5 lines, no story/AC refs in `src/`.

**Ask First:** Any change to switch's observable behaviour or existing switch tests beyond the extraction and the lock below; stashing or moving dirty work instead of skipping.

**Never:** TUI dialog, shortcut, `realign.*` settings (8.8); re-implementing the restart phase; a new git call in the dashboard snapshot.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Member drifted | expected `feat/x`, on `main`, clean | checkout `feat/x` → `realigned` | gate/checkout error → `failed` |
| Other drifted | `sharedBranch: develop`, on `hotfix` | fetched if absent, checkout → `realigned` | fetch error → `failed` |
| Named aligned | `--service svc`, on expected | `unchanged`, no git write | N/A |
| Dirty / mid-merge | drifted, uncommitted work or merge | `skipped` with code + message, others proceed | N/A |
| Detached HEAD | drifted, branch `null` | realigned like any drifted service | N/A |
| Unknown service/value | `--service nope`, `--scope foo` | `invalid-argument`, nothing touched, exit ≠ 0 | N/A |
| Lock held | update or realign in flight | `realign-blocked-action-in-progress` | nothing touched |
| No active EDT | `no-active-edt` | error, nothing touched | N/A |
| Restart clean | 2 realigned (1 no container), 1 unchanged | 1 restarted+verified, 2 `skipped` | `down`/`failed` → exit ≠ 0 |
| Empty selection | `--scope none` | ok, no rows, exit 0 | N/A |

</frozen-after-approval>

## Code Map

- `src/core/edt/switch.ts:499-517` -- `resolveTargetBranch` (AD-8 gate + fetch for shared): reuse as-is. `:824-904` -- `switchMemberRepo`/`switchNonMemberRepo` share "resolve destination → prepare → `git.checkout` → on failure undo prepare": extract this sequence into one exported function both switch paths and realign call (realign's prepare is a no-op); switch's dirty plan stays in switch. `:220` -- switch only peeks `edt:<outgoing>`.
- `src/core/edt/manifest-carry.ts:16` -- `withCarriedManifest`, typed on `SwitchEdtRepoResult`; realign reuses it and maps rows.
- `src/core/edt/switch-restart.ts:97-186` -- `isChangedSwitchOutcome`, `restartAfterSwitch` (targets = changed outcomes); add an optional `changedServices` override so realign passes its `realigned` set; `listSwitchRestartRepos` L190; `restartNeedsAttention` L89.
- `src/core/dashboard/snapshot.ts:161-200` -- private `readOthers`/`readOther`/`driftOf`: move to `src/core/dashboard/drift.ts` with an exported `listDriftCandidates({registry, manifest, git, edtRegistry, state})` (members: one `currentBranch` each); snapshot imports them, output unchanged.
- `src/core/scripts/group-update.ts:23-27,600` -- `GROUP_UPDATE_LOCK_KEY`, `edtUpdateLockKey`, nesting pattern; `src/core/locking.ts:18` `withActionLock`.
- `src/core/ports/edt-registry.ts:47` -- optional `logAction`.
- `src/core/ports/git.ts` -- `GIT_DETACHED_HEAD`, `hasUncommittedChanges(…, {excludePaths})`, `isMergeInProgress`, `isRebaseInProgress`, `hasUnmergedPaths`.
- `src/adapters/driving/cli/subcommands.ts:46-65,92-123,814-994` -- usage constants, registry, `runEdtSwitch` (`--restart` parsing L861-912, restart wiring L953-994, `switch-restart-needs-attention` precedent); repeatable flag precedent `runEdtCreate` L689-697.
- `src/bin/main.ts:75` -- CLI deps already carry what realign needs.
- Test fakes: `src/core/edt/switch.test.ts:31-150`, `switch-restart.test.ts:28`.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/edt/switch.ts` (+ `checkout-expected.ts`) -- extract the shared checkout step; switch tests unchanged and green -- one implementation (story note)
- [x] `src/core/edt/switch.ts` (+ test) -- hold `edt:<outgoing ulid>` via `withActionLock` around the per-repo loop when the peek found it free (`--force` path unchanged) -- realign rejected while a switch runs
- [x] `src/core/edt/switch-restart.ts` (+ test) -- optional `changedServices` -- restart reuse
- [x] `src/core/dashboard/drift.ts` (+ test), `snapshot.ts` -- `listDriftCandidates`, snapshot tests unchanged -- candidates
- [x] `src/core/realign/index.ts` (+ test) -- `resolveRealignSelection`, `realignServices` covering the matrix, lock, log, restart; export from `src/core/index.ts` -- use-case
- [x] `src/adapters/driving/cli/subcommands.ts` (+ `dispatch.test.ts`) -- `realign` subcommand, `REALIGN_USAGE`, envelope `{rows, restart?}` -- CLI
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- 2-44 and 8-6 to `done` (stale), 8-7 to `in-progress` -- tracking

**Acceptance Criteria:**
- Given a realign holding the lock, when `update`, `edt switch` or another `realign` starts, then it is rejected; given a switch in flight, when `realign` starts, then it is rejected.
- Given a run, when it ends, then the EDT action log has one `realign` entry naming the selection and every outcome.
- Given `npm test`, `npm run typecheck`, `npm run depcheck`, then all pass.

## Design Notes

Dirty work is skipped rather than stashed: a stash taken on the wrong branch has no natural owner (switch tags stashes by outgoing EDT), and popping it on the expected branch could conflict. The 8.8 dialog can propose a preservation option later.

## Verification

**Commands:**
- `npm test` -- expected: all green
- `npm run typecheck` -- expected: no errors
- `npm run depcheck` -- expected: no violations

## Suggested Review Order

**Realign use-case (core)**

- Entry point: validate up front, lock, re-check the active EDT, re-read drift under the lock.
  [`index.ts:128`](../../src/core/realign/index.ts#L128)

- Per-service pipeline: unchanged/unknown/merge/rebase/dirty guards before the shared checkout.
  [`index.ts:204`](../../src/core/realign/index.ts#L204)

- Scope + names resolve to candidates; unknown or ambiguous names rejected before anything runs.
  [`index.ts:72`](../../src/core/realign/index.ts#L72)

- Selection refreshed by resolved path; a vanished repo becomes `realign-candidate-gone`.
  [`index.ts:123`](../../src/core/realign/index.ts#L123)

- Restart only realigned services, paths normalised; restart failure never rolls back.
  [`index.ts:274`](../../src/core/realign/index.ts#L274)

- One action-log entry; `failed` when any row failed or the restart needs attention.
  [`index.ts:326`](../../src/core/realign/index.ts#L326)

**Shared checkout step (switch ↔ realign)**

- Gate → prepare hook → checkout → undo on failure; one implementation for both callers.
  [`checkout-expected.ts:52`](../../src/core/edt/checkout-expected.ts#L52)

- AD-8 gate moved unchanged; still re-exported by switch for `activate.ts`.
  [`checkout-expected.ts:16`](../../src/core/edt/checkout-expected.ts#L16)

**Action lock between switch and realign/update**

- Switch holds `edt:<outgoing>` through its state/registry writes, closing the mid-switch gap.
  [`switch.ts:333`](../../src/core/edt/switch.ts#L333)

- Losing the peek/acquire race reports the same blocked error, keeping the TUI force prompt.
  [`switch.ts:345`](../../src/core/edt/switch.ts#L345)

**Drift candidates**

- Members (one branch read each, registry membership flagged) plus managed others; listing errors surface.
  [`drift.ts:100`](../../src/core/dashboard/drift.ts#L100)

- Dashboard keeps its swallow-to-empty others behaviour through the shared helper.
  [`drift.ts:51`](../../src/core/dashboard/drift.ts#L51)

**Restart reuse**

- Optional `changedServices` override; switch callers unchanged.
  [`switch-restart.ts:133`](../../src/core/edt/switch-restart.ts#L133)

**CLI**

- Flag parsing and validation before any lock; settings warning on stderr; exit rules.
  [`subcommands.ts:1006`](../../src/adapters/driving/cli/subcommands.ts#L1006)

- Usage string generating `--help`.
  [`subcommands.ts:88`](../../src/adapters/driving/cli/subcommands.ts#L88)

**Tests**

- Use-case matrix, locks, log, restart, re-read and throw guards.
  [`index.test.ts:168`](../../src/core/realign/index.test.ts#L168)

- Shared checkout step ordering and short-circuits.
  [`checkout-expected.test.ts:1`](../../src/core/edt/checkout-expected.test.ts#L1)

- CLI envelope, exit codes, lock rejection, restart-phase failure.
  [`dispatch.test.ts:925`](../../src/adapters/driving/cli/dispatch.test.ts#L925)
