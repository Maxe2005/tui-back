---
title: 'Assisted Resolution of Merge Conflicts / Dirty State'
type: 'feature'
created: '2026-09-21'
status: 'done'
baseline_commit: 'eab36cbfe5c76860f210ce23a4a555115dc24963'
review_loop_iteration: 0
context: [_bmad-output/implementation-artifacts/epic-3-context.md]
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A group update today aborts and reports: any dirty worktree becomes a `skipped`/`dirty-worktree` row with zero writes, any merge conflict is `merge --abort`ed into a `failed`/`merge-conflict` row. The developer must drop to a separate terminal to resolve, and the run stalls on every repo.

**Approach:** Core classifies dirty state (lockfile-only dirt is silently discarded per the `update_repo.sh` convention, everything else pauses on a driving-provided resolution seam), surfaces pre-existing mid-merge/mid-rebase as a distinct state before any menu, and re-verifies a repo before resuming it. The CLI passes no seam and keeps today's skip/abort rows; the TUI backs the seam with a bounded modal menu.

## Boundaries & Constraints

**Always:** All core returns are `Result<T>` with kebab-case error codes (AD-3). Core never imports from adapters (AD-1); relative imports end in `.js` with imports-first-in-file. Merge stays `git merge`, never rebase; `assertAllowedBranch` gating is unchanged. One repo's resolution never touches another repo. Real conflict content is never auto-resolved; developer changes are never committed or discarded without an explicit in-the-moment choice. Core aborts only merges the current run started — a pre-existing mid-merge/mid-rebase is never aborted, only reported. Every targeted service still appears in `data.results` — none silently absent.

**Ask First:** If the lockfile auto-fix needs anything beyond a path-scoped discard (`git checkout -- <paths>` equivalent) of package.json/lockfile paths; if finalizing a human-resolved merge needs anything beyond verifying zero unmerged paths plus `git commit --no-edit`; if the TUI's editor launch needs anything beyond spawning `$EDITOR` (fallback `vi`) and waiting for exit; if the seam needs anything beyond the `onUpdateBlocker` callback shape below — HALT and ask before proceeding.

**Never:** No change to the migrate/restart phases (story 3.2) or to all-repos enumeration/confirmation (story 3.3). No standalone per-service re-trigger and no retry-limit/escalation logic (story 3.5). No CLI prompting — non-TTY output stays exactly one JSON line. The TUI never calls a driven adapter directly (AD-1): every git write goes through a core use-case, and the editor spawn is driving-side only (core only ever sees the `edited` choice, never an editor).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Lockfile-only dirt | Only `package.json`/lockfile paths dirty (any scope, seam or not) | Paths discarded silently, repo proceeds normally | N/A |
| Other dirt, seam present | Dirty blocker raised to the seam | Menu: stash / open in editor / cancel repo / cancel run; run waits on that repo | N/A |
| Stash choice | Blocker pending | Stash via the git port, re-verify clean, resume pull/merge | Still dirty after stash → re-present the menu |
| Edited choice | Blocker pending (editor spawned driving-side) | Re-verify state before continuing; conflict resolved by hand → finalize the merge commit, then migrate/restart | Still dirty/conflicted → re-present the menu |
| Cancel repo | Blocker pending | Own-started merge aborted, repo left at pre-run HEAD; `skipped` row, others continue | Pre-existing mid-state is never aborted, left as-is |
| Cancel run | Blocker pending | Own-started merge aborted, loop stops, rows so far returned | Same no-abort rule for pre-existing states |
| Other dirt, no seam (CLI) | Same dirty repo | `skipped`/`dirty-worktree` row exactly as today | Others continue |
| Mid-run conflict, seam present | Merge/pull leaves repo mid-merge | No abort yet — blocker of kind `merge-conflict` with the same four choices | `edited` → verify zero unmerged paths → finalize commit; retry path bounded: one re-merge, still conflicted → `failed` row, no second prompt |
| Mid-run conflict, no seam (CLI) | Same | Abort + `failed`/`merge-conflict` exactly as today | Abort failure keeps the code, appends detail |
| Pre-existing mid-merge/mid-rebase | Repo already mid-state when reached | Distinct blocker kind (`mid-merge`/`mid-rebase`) surfaced before the menu; menu applies after | Cancel choices never abort it; rebase is never touched by this tool |

</frozen-after-approval>

## Code Map

- `src/core/scripts/group-update.ts:271-374` — `updateWithLoadedManifest`, the shared per-service flow both scopes reuse; dirty gate `302-312`, pull-conflict branch `314-325`, fetch + gated merge `326-345`, `failConflicted` abort-and-report `379-393` (becomes the no-seam/cancel path only); result shape `43-56` unchanged.
- `src/core/ports/git.ts:19-99` — existing surface; reusable as-is: `stashSave`/`restoreStash` (`60-64`) for the stash choice, `isMergeInProgress` (`80`) for mid-merge checks, `mergeBranch`/`abortMerge` (`85-88`). Missing capabilities the seam needs (shape at implementation time): porcelain file list for the lockfile classifier, path-scoped discard for the auto-fix, a mid-rebase detector (only merge is detected today), and unmerged-path verification for merge finalization.
- `src/adapters/driven/git/index.ts` — `spawnSync('git', …)` + exit-code taxonomy pattern (kebab-case codes, `spawnFailureDetail`, `status === null` handling) every new port method follows; `mergeBranch`'s locale-independent conflict detection is the model for state checks.
- `src/adapters/driving/cli/subcommands.ts:134-177` — `update` entry (bare vs `--all --yes` vs lone `--all`); explicitly passes no seam so dirty/conflict rows keep today's codes; no new flags.
- `src/adapters/driving/tui/store/slices/update-slice.ts:56-121` — fire-and-forget `runGroupUpdate` calling the use-case in-process (AD-2); gains blocker state plus a resolve dispatch wiring the seam callback to the zone menu (unwired/double-run guards unchanged).
- `src/adapters/driving/tui/zones/update/update-zone.tsx:86-198` — pure key-resolver helpers plus the `ModalDialog` confirm-gate pattern the resolution menu reuses; choice list rendered as `ListRow`s navigated like the EDT zone's `SERVICE_ACTION_MENU_ITEMS` pattern (filterable-list widgets are overkill for four fixed choices).
- Tests: `src/core/scripts/group-update.test.ts` fake-port matrix (`fakeGit` overrides + call-order assertions — scripted seam callbacks test the same way); `src/bin/tui-back.e2e.test.ts` update block (temp-repo/manifest/docker-stub fixtures; add lockfile-dirty auto-update and still-skipped cases); zone resolver unit tests mirroring `resolveAllConfirm`.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/ports/git.ts` (+ `src/adapters/driven/git/index.ts`) -- classifier inputs, path-scoped discard, mid-rebase detector, unmerged-path verification; adapter integration tests in the existing stub style.
- [x] `src/core/scripts/group-update.ts` (+ `group-update.test.ts`) -- lockfile auto-fix; pre-existing mid-state detection; `onUpdateBlocker` seam (`{service, repoPath, kind}` → `stash` / `edited` / `cancel-repo` / `cancel-run`) with re-verify-before-resume, abort-only-own-merge, single-retry bound; absent seam preserves today's rows; unit-test every matrix row with scripted callbacks.
- [x] `src/adapters/driving/cli/subcommands.ts` (+ `src/bin/tui-back.e2e.test.ts`) -- explicit no-seam wiring; black-box lockfile-auto-update, real-dirty-skipped, and conflict-abort cases.
- [x] `src/adapters/driving/tui/store/slices/update-slice.ts` (+ `update-zone.tsx`) -- blocker state, `ModalDialog` four-choice menu, driving-side `$EDITOR` spawn returning `edited`; pure resolvers with unit tests; no new zone patterns.

**Acceptance Criteria:**
- Given a repo dirty only on `package.json`/lockfile paths, when a group update reaches it in either scope, then it is auto-discarded without prompting and the repo proceeds through pull/merge → migrate → restart.
- Given any other dirty repo with the TUI seam present, when reached, then the run waits on a four-choice menu, and the repo resumes only after a passing re-verification following the choice.
- Given the same dirty repo via CLI, when `tui-back update` runs non-TTY, then it is a `skipped`/`dirty-worktree` row with no prompt and single-line JSON output.
- Given a repo already mid-merge/mid-rebase from an earlier run, when reached, then it is reported under its distinct code, never aborted by any choice, and the menu applies after the report.
- Given a mid-run conflict with the seam present, when the developer resolves by hand and confirms, then the merge is finalized and the run continues; a still-conflicted retry ends as one `failed`/`merge-conflict` row with no second prompt.

## Spec Change Log

## Design Notes

The seam is a single optional callback on `GroupUpdateParams` — `onUpdateBlocker?: (blocker: { service, repoPath, kind: 'dirty-worktree' | 'merge-conflict' | 'mid-merge' | 'mid-rebase' }) => Promise<'stash' | 'edited' | 'cancel-repo' | 'cancel-run'>` — injected like a port and absent by default (the CLI path). Core owns classification, auto-fix, stash, re-verification, and merge finalization; the driving side owns only the menu rendering and the editor process. `cancel-run` stops the loop but still returns `ok` with rows so far (a cancelled repo is `skipped`, never `failed`).

## Verification

**Commands:**
- `npm test && npm run typecheck && npm run depcheck` -- expected: all green (AGENTS.md order).
- `node src/bin/tui-back.mjs update` (pipe) -- expected: single JSON line, exit 0/1 only.

## Suggested Review Order

**Seam design and per-service flow**

- Seam contract plus lockfile classifier — the whole feature's entry point
  [`group-update.ts:85`](../../../src/core/scripts/group-update.ts#L85)

- Lockfile auto-fix, dirty gate, and pull/merge settlement wiring
  [`group-update.ts:409`](../../../src/core/scripts/group-update.ts#L409)

- Pre-existing mid-state detection — distinct rows, never aborted
  [`group-update.ts:610`](../../../src/core/scripts/group-update.ts#L610)

- Mid-run conflict settlement — one prompt, bounded single retry
  [`group-update.ts:762`](../../../src/core/scripts/group-update.ts#L762)

**Port surface and driven adapter**

- Five new `GitPort` methods following the existing contract style
  [`git.ts:92`](../../../src/core/ports/git.ts#L92)

- Porcelain parse, path discard, rebase check, finalize — spawnSync taxonomy
  [`index.ts:457`](../../../src/adapters/driven/git/index.ts#L457)

**Driving adapters**

- CLI passes no seam — skip/abort rows preserved on both scopes
  [`subcommands.ts:141`](../../../src/adapters/driving/cli/subcommands.ts#L141)

- Slice blocker state plus closure-held resolver and orphan clearing
  [`update-slice.ts:110`](../../../src/adapters/driving/tui/store/slices/update-slice.ts#L110)

- Modal body, key resolver, EDITOR split fix, menu key capture
  [`update-zone.tsx:157`](../../../src/adapters/driving/tui/zones/update/update-zone.tsx#L157)

**Tests**

- Core matrix with scripted seams, including discard/finalize/pull-path gaps
  [`group-update.test.ts:1210`](../../../src/core/scripts/group-update.test.ts#L1210)

- Adapter integration per method plus hand-resolved-merge finalize
  [`index.test.ts:1146`](../../../src/adapters/driven/git/index.test.ts#L1146)

- Black-box lockfile auto-update against the real binary
  [`tui-back.e2e.test.ts:1482`](../../../src/bin/tui-back.e2e.test.ts#L1482)

- Slice seam round-trip plus zone resolver and menu render
  [`update-zone.test.tsx:168`](../../../src/adapters/driving/tui/zones/update/update-zone.test.tsx#L168)
