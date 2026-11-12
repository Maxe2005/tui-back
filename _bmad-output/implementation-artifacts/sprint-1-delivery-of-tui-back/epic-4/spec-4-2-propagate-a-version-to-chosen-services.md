---
title: 'Propagate a Version to Chosen Services'
type: 'feature'
created: '2026-10-08'
status: 'done'
baseline_commit: '7c7047cad47ee02f2f1d02ff96b2e4d8e6c45727'
review_loop_iteration: 0
context: [_bmad-output/implementation-artifacts/epic-4-context.md]
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Bumping the `shared-types` dependency across the active EDT's services means editing each `package.json` by hand; the `shared-types` zone is still a placeholder.

**Approach:** Fill the zone: a version field pre-filled `0.1.`, a checklist of the EDT's consumers, option toggles (`npm i`, clean restart, commit), and a per-service run that verifies the version on the registry, rewrites only the dependency line, runs the chosen options, and reports per-service results with independent retry.

## Boundaries & Constraints

**Always:** Verify the version on the registry (`SharedTypesPort.verifyPublished`) before any write; a missing version blocks the run with an explicit message and a registry failure is reported distinctly. Rewrite via `writeVersionLine` only. Order per service: write, then `npm i`, then clean restart, then commit. Commit stages exactly `package.json` (the consumer's configured `packageJsonPath`) and `package-lock.json` (only if present), the message states the tool did it (`chore(deps): bump <dependency> to <version> [tui-back]`), and other dirty files are never staged. Every git write goes through the branch-scope safety gate (AD-8); a consumer on a protected/shared branch is refused as elsewhere. A consumer whose `package.json` is already dirty is skipped with a reason. One failure never blocks the others and is retriable on its own. `q` during a run asks for confirmation. Core never names `shared-types`; the port reaches the TUI through the manifest module wiring.

**Ask First:** Running `npm i` through `RestartPort.run` (`sh -c`) is semantically odd; if a dedicated command-runner port seems warranted, HALT and ask.

**Never:** No push, ever. No publish (4.3), no group-update integration (4.4), no conflict resolution (4.5), no drift view (4.6). No JSON re-serialisation. Do not stage files other than the two above.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | `0.1.3674` published, 2 consumers selected | Both lines rewritten, per-service done | N/A |
| Unpublished version | Registry reports not found | Run blocked, nothing written, explicit message | N/A |
| Registry down | Runner fails | Blocked, distinct "registry unreachable" message | `registry-unreachable` |
| Dirty package.json | Target has uncommitted `package.json` | Service skipped with reason, others proceed | N/A |
| Other files dirty | Only unrelated files dirty | Proceeds, unrelated files never staged | N/A |
| Protected branch | Consumer on protected/shared branch | Refused by the gate, reported failed | gate error code |
| One failure | `npm i` fails on service B | B failed with step named, A and C unaffected, B retriable | step error code |
| No members | Active EDT has no consumers | Explicit empty state | N/A |
| Quit mid-run | `q` while running | Confirmation modal | N/A |

</frozen-after-approval>

## Code Map

- `src/core/ports/shared-types.ts`, `src/adapters/driven/modules/shared-types/npm-package.ts` -- existing port/adapter from 4.1 (`readVersion`, `writeVersionLine`, `verifyPublished`); not wired into the app yet.
- `src/adapters/driven/modules/module-registry.ts` -- `resolveModule`; `shared-types-consumer` entry has `configSchema` (defaults `dependency`, `packageJsonPath`).
- `src/bin/tui.ts:~112` -- routes precedent (`resolveModule`, kind check, pass into `createAppStore`); add `sharedTypes` and consumer config parsing there. `AppStoreDeps` is in `src/adapters/driving/tui/store/app-store.ts:48`.
- `src/core/edt/resolve-tab-visibility.ts`, `src/core/scripts/list-repos.ts` -- active EDT resolution (`state.readActiveEdt`, `edtRegistry.list`, `members[].repoPath`) and `ManagedRepo.moduleIds`; no consumer-listing use-case exists yet.
- `src/core/ports/git.ts`, `src/adapters/driven/git/index.ts` -- gate `assertAllowedBranch`, `currentBranch`, `listDirtyPaths`; **missing**: path-scoped `stagePaths` and `commit` (existing commit is only `finalizeMerge` ~line 708). Fake `GitPort`s in tests (e.g. `group-update.test.ts:48`) need the new methods.
- `src/core/ports/restart.ts`, `src/core/scripts/service-restart.ts`, `src/core/scripts/group-update.ts:~613` -- `RestartPort.run` and the clean-restart recipe via `serviceRestart`; reuse for the restart toggle and `npm i`.
- `src/adapters/driving/tui/zones/shared-types/shared-types-zone.tsx` (+ test) -- current placeholder/disabled message to replace.
- `src/adapters/driving/tui/zones/update/update-zone.tsx` (quit confirm ~349, `ModalDialog`, `setZoneInputCaptured`), `update-zone.logic.ts` (step states), `store/slices/update-slice.ts` (`runInProgress`, blocks global `q` via `app-shell.tsx:145`) -- run/quit precedent.
- `src/adapters/driving/tui/shared/components/` -- `CheckboxListItem`, `TextInputLine` + `text-edit.ts`, `StateLine` (empty), `Spinner`, `FailedResultList`, `ModalDialog`.
- Tests: hand-rolled fakes in core, `mount-for-test.ts` for Ink; dependency-cruiser forbids `core` importing `adapters/`.

## Tasks & Acceptance

**Execution:**
- [ ] `src/core/ports/git.ts`, `src/adapters/driven/git/index.ts` -- add gated `stagePaths` and path-scoped `commit`; update fakes; no push -- AD-8
- [ ] `src/core/shared-types/list-consumers.ts` -- resolve the active EDT's consumers (repo, branch, dependency, packageJsonPath) from manifests -- core without naming the module in logic
- [ ] `src/core/shared-types/propagate-version.ts` -- verify, then per-service write / `npm i` / restart / commit with dirty and gate checks, per-step results, independent retry -- core use-case over ports
- [ ] `src/bin/tui.ts`, `app-store.ts` -- wire `SharedTypesPort` and consumer config into the store
- [ ] `zones/shared-types/` -- version field, checklist, options step, run view with spinner, results, retry, empty state, quit confirm (logic in a `*.logic.ts`)
- [ ] Tests: use-case against fakes (every matrix row), git adapter staging/commit, zone interaction tests

**Acceptance Criteria:**
- Given the zone is opened, when members exist, then the version field shows `0.1.` editable followed by the consumer checklist.
- Given an unpublished version, when confirmed, then no file is modified and the message explains why.
- Given commit is on, when it runs, then only the two files are staged and no push occurs.
- Given a run in progress, when `q` is pressed, then confirmation is required.

## Spec Change Log

## Design Notes

Consumer discovery needs each member's `shared-types-consumer` config. Core cannot import the adapter schema, so the driving layer passes a resolver (parsing with the registry's `configSchema`) into the use-case. `npm i` reuses `RestartPort.run` unless the human objects.

## Verification

**Commands:**
- `npm run typecheck` -- expected: no errors
- `npm test` -- expected: all pass
- `npm run lint` -- expected: no errors (dependency-cruiser included)

## Suggested Review Order

**Propagation use-case**

- Entry point: verify first, then per-service gate, dirty check, write, install, restart, commit.
  [`propagate-version.ts:114`](../../../src/core/shared-types/propagate-version.ts#L114)

- Version format guard blocks malformed input before any registry call.
  [`propagate-version.ts:85`](../../../src/core/shared-types/propagate-version.ts#L85)

- Active EDT consumers resolved from manifests without core naming the module.
  [`list-consumers.ts:45`](../../../src/core/shared-types/list-consumers.ts#L45)

**Git safety**

- Gated path-scoped staging; only the named files, never a push.
  [`index.ts:909`](../../../src/adapters/driven/git/index.ts#L909)

- `commit --only` keeps foreign staged files out of the bump commit.
  [`index.ts:926`](../../../src/adapters/driven/git/index.ts#L926)

**Store and wiring**

- Run and retry actions; `runInProgress` gates the global quit.
  [`shared-types-slice.ts:158`](../../../src/adapters/driving/tui/store/slices/shared-types-slice.ts#L158)

- Composition root degrades instead of throwing when the module is absent.
  [`tui.ts:133`](../../../src/bin/tui.ts#L133)

**Zone**

- Form, checklist, options, run view, results, retry and quit confirm.
  [`shared-types-zone.tsx:41`](../../../src/adapters/driving/tui/zones/shared-types/shared-types-zone.tsx#L41)

- Pure form logic: only a valid version can run.
  [`shared-types-zone.logic.ts:61`](../../../src/adapters/driving/tui/zones/shared-types/shared-types-zone.logic.ts#L61)

**Tests**

- Every matrix row, dirty lockfile, and resume at install, restart or commit.
  [`propagate-version.test.ts:1`](../../../src/core/shared-types/propagate-version.test.ts#L1)

- Real keypress flows: form, quit confirm, retry, reset after blocked or done.
  [`shared-types-zone.interaction.test.tsx:1`](../../../src/adapters/driving/tui/zones/shared-types/shared-types-zone.interaction.test.tsx#L1)
