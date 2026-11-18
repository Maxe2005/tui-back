---
title: 'Story 13.3: Split Group Update and Switch Tests'
type: 'refactor'
created: '2026-11-18'
status: 'done'
baseline_commit: '8c2f00e5f4f55c6fc8f275a5f302ba1eed18fe3a'
review_loop_iteration: 0
context:
  - '{project-root}/docs/test-splitting-conventions.md'
  - '{project-root}/_bmad-output/implementation-artifacts/sprint-2-refonte-fichiers-volumineux/epic-13-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `src/core/scripts/group-update.test.ts` (3384 lines, 159 tests) and `src/core/edt/switch.test.ts` (1705 lines, 87 tests) no longer mirror the split sources of stories 12.5/12.6, and carry ~10 near-identical copies of core port fakes.

**Approach:** Extract the shared port fakes once, give each file its own `*.test-support.ts`, then move the `describe` blocks verbatim into topic files following `docs/test-splitting-conventions.md`. Test-only change.

## Boundaries & Constraints

**Always:** Tests move verbatim (names, assertions). Total count stays 159 + 87 = 246. One extraction per commit, `refactor(test): ... (story 13.3)`, body records before/after counts. Gates before each commit: `npm test && npm run typecheck && npm run depcheck`. Each test file < ~800 lines, each support file < ~400. No story/AC references in comments.

**Ask First:** Any fake that differs between the two files in a way that cannot be unified by a plain parameter/override.

**Never:** Change production code, rename or drop tests, create two diverging copies of the port fakes, split a top-level `describe` across files.

## I/O & Edge-Case Matrix

N/A — structural refactor; equivalence is proven by test count and title list.

</frozen-after-approval>

## Code Map

- `src/core/scripts/group-update.test.ts` -- source file; helpers lines 29-205 (`calls`, `manifestFor`, `fake*`, `member`, `edtEntry`, `ACTIVE`, `makeParams`), 18 top-level `describe`s from line 207.
- `src/core/edt/switch.test.ts` -- source file; helpers 16-170 (+ `WRITE_METHODS`, `expectZeroWrites`, `callOrder`, `OTHER` at 731-745), 21 `describe`s from line 172.
- `src/core/scripts/group-update/{all,blockers,conflict,edt,member,observers,outcome,restart,selection}.ts` -- source modules the topics mirror.
- `src/core/edt/switch/{dirty,member,types}.ts` -- source modules for switch topics.
- `docs/test-splitting-conventions.md` -- rules; inventory prescribes `core/shared/core-ports.test-support.ts` (does not exist yet; `src/core/shared/` must be created) for `calls`, `manifestFor`, `fake{Git,Manifest,Lock,State,Registry,EdtRegistry,Container,Migration,Restart}`, `member`, `edtEntry`.
- `package.json` `files` -- already excludes `*.test-support.ts(x)`; no change needed.

## Tasks & Acceptance

**Execution:**
- [ ] `src/core/shared/core-ports.test-support.ts` -- extract shared fakes/builders (unify `fakeRegistry` signature: group-update `(paths)` vs switch `(paths, overrides)`; `manifestFor` arg) -- one copy for both files
- [ ] `src/core/scripts/group-update.test-support.ts` -- `ACTIVE`, `makeParams` -- per-module params builder
- [ ] `src/core/edt/switch.test-support.ts` -- `TARGET`, `OUTGOING`, `OTHER`, `REPOS`, `makeParams`, `fakeManifestCarry`, `expectZeroWrites`, `callOrder`, `WRITE_METHODS`
- [ ] `src/core/scripts/group-update.{edt,migrate,all,blockers,pre-run,restart,observers,conflicts}.test.ts` -- one topic per commit: edt = active-EDT, pull-or-merge, interrupted, duplicate, locks, markInterrupted; migrate; all = all-repos + no-container services; blockers = assisted resolution; pre-run; restart = clean-restart + `runRestartStep`; observers = result observer, live phase, run detail, parallel pool; conflicts = auto-resolution seam
- [ ] `src/core/edt/switch.{orchestration,dirty,resolution,manifest-carry}.test.ts` -- orchestration = describes 172-731 (validation…deregistered); dirty = `classifySwitchRepos`, pre-flight, resolution seam, seam row facts, state-1 stash; resolution = adopt, discard (x2), failure reporting, dirtyPolicy; manifest-carry = dirty `.tui-back.yaml`. Rebalance if a file exceeds ~800 lines.
- [ ] Delete both original files once empty.

**Acceptance Criteria:**
- Given the split, when running the produced files, then passed tests total 159 (group-update) and 87 (switch), with an identical sorted title list.
- Given the repo, when running `npm test && npm run typecheck && npm run depcheck`, then all pass.
- Given the diff, then only test files and test-support files change.

## Verification

**Commands:**
- `npx vitest run src/core/scripts src/core/edt --configLoader runner --reporter=json` -- expected: 246 passed across the produced files (the default config loader currently fails in this worktree with a rolldown `sourcemapPathTransform` error; `--configLoader runner` works and needs no repo change)
- `npm run typecheck && npm run depcheck` -- expected: exit 0

## Suggested Review Order

**Shared fixtures**

- One copy of the core port fakes replaces the two near-identical sets.
  [`core-ports.test-support.ts:1`](../../../../src/core/shared/core-ports.test-support.ts#L1)

- Per-module params builders and fixtures, with thin wrappers keeping each module's defaults.
  [`group-update.test-support.ts:1`](../../../../src/core/scripts/group-update.test-support.ts#L1)
  [`switch.test-support.ts:1`](../../../../src/core/edt/switch.test-support.ts#L1)

**Group update topics (verbatim moves)**

- Largest topic file: assisted resolution (blockers).
  [`group-update.blockers.test.ts:1`](../../../../src/core/scripts/group-update.blockers.test.ts#L1)

- Other topics: edt, migrate, all, pre-run, restart, observers, conflicts.
  [`group-update.edt.test.ts:1`](../../../../src/core/scripts/group-update.edt.test.ts#L1)

**Switch topics (verbatim moves)**

- Orchestration versus dirty handling, resolution and manifest carry.
  [`switch.orchestration.test.ts:1`](../../../../src/core/edt/switch.orchestration.test.ts#L1)
  [`switch.dirty.test.ts:1`](../../../../src/core/edt/switch.dirty.test.ts#L1)
