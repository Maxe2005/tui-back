---
title: 'Group Update — Pull and Restart (EDT-scoped)'
type: 'feature'
created: '2026-09-17'
status: 'done'
baseline_commit: '9e9ca44da5eee409e46fbc94f9c0419ff0bc7b0a'
review_loop_iteration: 0
context: [_bmad-output/implementation-artifacts/epic-3-context.md]
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Catching up an EDT's member services means hand-running pull, merge, and container restart per service, with no guarantee every service was actually brought up to date.

**Approach:** One core use-case brings every member service of the active EDT up to date with the shared branch and restarts its container, reporting a per-service outcome, exposed identically through a new `tui-back update` CLI subcommand and the Update TUI zone.

## Boundaries & Constraints

**Always:** Every merge into a member branch passes `assertAllowedBranch` before any git write; pulls of the shared branch follow the switch.ts precedent (no write-gate). Every targeted service appears in `data.results` as `updated`/`skipped`/`failed` — none silently absent. Merge means `git merge`, never rebase. One failed service never aborts the others. All core returns are `Result<T>` with kebab-case error codes.

**Ask First:** If implementing container restart via anything other than a new `ContainerPort` driven by `child_process` (dockerode now vs. later) triggers, HALT and ask before proceeding.

**Never:** No migrations step (story 3.2), no all-repos mode or `--all` flag (story 3.3 — bare `update` rejects flags), no stash/auto-fix/guided menu on dirty or conflicted state (story 3.4 — detect and report only), no retry-limit or escalation logic, no AI-copilot behavior.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Member on feature branch | Member branch behind shared branch, clean tree | Fetch shared branch, `git merge`, restart container → `updated` | N/A |
| Member already current | Merge is a no-op, restart succeeds | `updated` (idempotent rerun) | N/A |
| Member sitting on shared branch | `currentBranch == sharedBranch`, clean tree | Plain `git pull`, restart → `updated` | N/A |
| Dirty worktree | `hasUncommittedChanges == true` | Repo untouched, → `skipped` with `dirty-worktree` detail | Continue other services |
| Merge conflict | Merge exits non-zero with conflict markers | `git merge --abort`, → `failed` with `merge-conflict` detail | Continue other services |
| Restart fails | Pull/merge ok, container restart fails | → `failed` with restart detail | Others unaffected |
| Zero members | Active EDT has `members: []` | `ok` with empty results plus an explicit no-op note | Never silent success |
| No active EDT | `readActiveEdt()` returns null | `no-active-edt` error | N/A |
| Second run | A group update already holds the lock | Rejected with `update-already-running` | N/A |
| Quit mid-run (TUI) | `q` pressed while run in progress | Explicit confirmation required; on confirm, EDT marked `interrupted` | Next Update-zone idle shows re-run offer |

</frozen-after-approval>

## Code Map

- `src/core/scripts/group-update.ts` (new) -- the use-case; mirrors `src/core/edt/switch.ts:70` (per-repo isolation: one repo's failure is a `failed` row, never aborts others; params-struct + `err`/`ok` style).
- `src/core/edt/switch.ts:26-29,88-99` -- active-EDT resolution (`state.readActiveEdt()` + `edtRegistry.list()` find by ulid) and the `edt:<ulid>` lock-peek convention this run must hold so switch blocks.
- `src/core/ports/edt-registry.ts:14-30` -- `EdtMember {service, repoPath, branch}`, `EdtStatus` (`interrupted` reused for abandoned runs), `setStatus` for the interrupted flag.
- `src/core/ports/git.ts` + `src/adapters/driven/git/index.ts:60` -- `GitPort` (has `currentBranch`, `hasUncommittedChanges`, `fetch`, `assertAllowedBranch`); **no `pull`/`merge` exists** — both must be added to port and adapter.
- `src/core/ports/manifest.ts:6-15` -- `Manifest {service, container, sharedBranch}` via `manifest.load(repoPath)`; `container` names the restart target.
- `src/core/locking.ts:24` -- `withActionLock(lock, key, work)`; nest it for the global `group-update` key (cross-scope rejection, story 3.3 included) plus `edt:<ulid>` (switch-block precedent).
- `src/adapters/driving/cli/subcommands.ts` -- `buildSubcommands` array; add `update` entry (`edt` multiplex in same file is the parser pattern); `dispatch.ts` maps throws to `internal-error`.
- `src/bin/main.ts` -- composition root; instantiate the new container port next to `createGitPort` and pass into `buildSubcommands` (mirror in `src/bin/tui.ts` + `createAppStore` deps).
- `src/adapters/driving/tui/zones/update/update-zone.tsx` -- 6-line placeholder; replace following the `edts-zone.tsx` in-process pattern (store slice awaits the core use-case directly, AD-2). Reuse `Spinner`, `DetailPane` summary-line, `ModalDialog` from `shared/components/index.ts`; quit-confirm via the `app-shell.tsx` `quitRequested` pattern.
- New files obey repo rules: relative imports with `.js` suffix, imports-first-in-file (dependency-cruiser), no `process.exit()` (set `process.exitCode`).

## Tasks & Acceptance

**Execution:**
- [x] `src/core/ports/git.ts` + `src/adapters/driven/git/index.ts` -- add `pull(repoPath)` and `mergeBranch(repoPath, branch)` to `GitPort`, implemented via `spawnSync` in the adapter's existing style (exit-code taxonomies, kebab-case codes); integration-test against temp repos.
- [x] `src/core/ports/container.ts` + `src/adapters/driven/container/index.ts` (new) -- `ContainerPort.restart(container): Promise<Result<void>>`; unit-shape only here, adapter integration-tested with a stubbed executable.
- [x] `src/core/scripts/group-update.ts` (+ `group-update.test.ts` vs fake ports) -- resolve active EDT, per-member pull-or-merge then restart, per-service rows, zero-member no-op note, nested locks, `interrupted` marking helper for abandoned runs; unit-test every I/O-matrix row.
- [x] `src/adapters/driving/cli/subcommands.ts` (+ `src/bin/main.ts` wiring) -- `update` subcommand, bare invocation only, TTY human text / single JSON line via existing `renderResult`; extend `src/bin/tui-back.e2e.test.ts` black-box cases.
- [x] `src/adapters/driving/tui/zones/update/update-zone.tsx` (+ store slice) -- Enter starts the run in-process, per-service spinner during, outcome summary after, idle shows last outcome / no-op message / interrupted re-run offer; `q` mid-run requires confirmation via existing quit pattern.

**Acceptance Criteria:**
- Given an EDT with two members behind `development` and clean trees, when `tui-back update` runs non-TTY, then stdout is one JSON line with both services `updated` and exit code 0.
- Given a group update in progress, when a second `tui-back update` triggers, then it is rejected with code `update-already-running`.
- Given a group update in progress in the TUI, when the active EDT is switched, then the switch flow blocks per the story 2.4 peek rule.
- Given a merge conflict on one member, when the run completes, then that service is `failed` with conflict detail, its repo is back at its pre-run HEAD, and every other service still reports its own outcome.

## Spec Change Log

## Design Notes

Lock nesting order: acquire global `group-update` first, then `edt:<ulid>` — so two concurrent triggers serialize on the global key and the EDT key is always held while member branches are written. Per-repo flow: `currentBranch` → equals `sharedBranch` ? `pull` : (`fetch` shared branch, `assertAllowedBranch` on the member branch, `mergeBranch`); on merge conflict `git merge --abort` restores pre-run HEAD (abort cancels only the attempted merge, it never discards developer work — full guided handling arrives in 3.4). Abandoned runs set the EDT entry `interrupted` via existing `setStatus`; the next idle render offers a re-run, which is a true resume in effect because applied merges are no-ops. outcome vocabulary is exactly `updated` / `skipped` / `failed`.

## Verification

**Commands:**
- `npm test && npm run typecheck && npm run depcheck` -- expected: all green (AGENTS.md order).
- `node src/bin/tui-back.mjs update` (pipe) -- expected: single JSON line, exit 0/1 only.

## Suggested Review Order

**Core use-case**

- Entry point: lock nesting, zero-member no-op, per-member loop
  [`group-update.ts:58`](../../../src/core/scripts/group-update.ts#L58)

- Per-member flow: dirty gate, branch-mismatch guard, pull-or-merge, restart
  [`group-update.ts:121`](../../../src/core/scripts/group-update.ts#L121)

- New port surface: pull, merge, abort, merge-in-progress classifier
  [`git.ts:80`](../../../src/core/ports/git.ts#L80)

- Container restart contract
  [`container.ts:9`](../../../src/core/ports/container.ts#L9)

**Driven adapters**

- Non-interactive ff-only pull plus merge/abort implementations
  [`git/index.ts:385`](../../../src/adapters/driven/git/index.ts#L385)

- Docker restart with flag-injection guard and exit-code fallback
  [`container/index.ts:24`](../../../src/adapters/driven/container/index.ts#L24)

**Driving adapters and wiring**

- Bare `update` subcommand entry and strict arg rejection
  [`subcommands.ts:132`](../../../src/adapters/driving/cli/subcommands.ts#L132)

- Container port instantiated in the composition root
  [`main.ts:34`](../../../src/bin/main.ts#L34)

- In-process run, double-run feedback, guarded interrupted-marking
  [`update-slice.ts:51`](../../../src/adapters/driving/tui/store/slices/update-slice.ts#L51)

- Zone rendering: spinners, summary, quit-confirm dialog
  [`update-zone.tsx:88`](../../../src/adapters/driving/tui/zones/update/update-zone.tsx#L88)

**Tests**

- Full I/O-matrix coverage against fake ports
  [`group-update.test.ts:1`](../../../src/core/scripts/group-update.test.ts#L1)

- Black-box CLI runs including conflict isolation and lock contention
  [`tui-back.e2e.test.ts:1`](../../../src/bin/tui-back.e2e.test.ts#L1)
