---
title: 'Story 13.4: Split App Shell and Store Tests'
type: 'refactor'
created: '2026-11-18'
status: 'done'
baseline_commit: 'f647e79b827bd101ab4c4d8f4dd09cf5748288b9'
review_loop_iteration: 0
context:
  - '{project-root}/docs/test-splitting-conventions.md'
  - '{project-root}/_bmad-output/implementation-artifacts/sprint-2-refonte-fichiers-volumineux/epic-13-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `app-shell.interaction.test.tsx` (3250 lines, 112 tests), `store/app-store.test.ts` (2982, 150) and `store/slices/update-slice.test.ts` (2759, 136) no longer mirror the sliced sources of epic 12, and each carries its own copy of `fakeDeps`/`manifestFor`.

**Approach:** Give each file a `*.test-support.ts(x)`, then move its `describe` blocks verbatim into topic files (app shell by flow, store by slice, update slice by the story 12.8 sub-creators) following `docs/test-splitting-conventions.md`. Test-only change.

## Boundaries & Constraints

**Always:** Tests move verbatim (names, assertions). Totals stay 112 + 150 + 136 = 398 with an identical sorted title list. One extraction per commit, `refactor(test): ... (story 13.4)`, body records before/after counts. Gates before each commit: `npm test && npm run typecheck && npm run depcheck`. Each test file < ~800 lines, each support file < ~400. Every split file that uses temp dirs registers its own `afterEach` cleanup. No story/AC references in comments.

**Ask First:** The three `fakeDeps` differ in defaults (repo list, ahead/behind, registry/active EDT, extra container/migration/restart ports). If they cannot be unified by a plain override without changing a test's observed defaults, keep one support file per module instead of one shared `store.test-support.ts` — ask before changing any default.

**Never:** Change production code, rename or drop tests, split a top-level `describe` across files, leave a stray `node_modules/node_modules`.

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/app-shell.interaction.test.tsx` -- helpers 32-191 (`manifestFor`, `fakeDeps`, `flushAsyncLoad`, `mount`, `press`, `pressEscape`), 18 top-level `describe`s from 193 (largest: command bar 744-1405, settings 1406-2010, resize-mode 2214-2544, reset 2545-2784).
- `src/adapters/driving/tui/store/app-store.test.ts` -- helpers 28-163 (`manifestFor`, `fakeDeps`, `tmpDirs` + `afterEach`, `makeEdtsBaseDir`); `app store` describe 165-1703 (resizeMode, EDT loading/delete/create, branch picker, settings, splitterRatios), then top-level `logs slice` (1704), `logs slice: inline service health & restart` (2047), `logs slice: filter history` (2733).
- `src/adapters/driving/tui/store/slices/update-slice.test.ts` -- helpers 23-163 (`MEMBERS`, `fakeDeps`); describes: base 165, health polling 680, pre-run config 953-1830, live run tracking 1831, single-service dialog 2128, merge source 2350, smart group update + conflicts 2437, `openInIde` 2742. Sources: `update-slice.{config,health,run,incident}.ts`.
- `src/adapters/driving/tui/shared/test-support/{fake-tty,mount-for-test}.ts` -- existing shared Ink helpers; check before duplicating `press`/`mount`.
- `store/slices/*.test.ts` -- existing per-slice tests (naming precedent for `logs-slice.*`).
- `docs/test-splitting-conventions.md` -- rules; inventory points `fakeDeps`/`manifestFor` to `tui/store/store.test-support.ts`.

## Tasks & Acceptance

**Execution:**
- [ ] Record baseline counts and sorted title lists for the three files (`npx vitest run <file> --configLoader runner --reporter=json`).
- [ ] `store/store.test-support.ts` (or per-module variants, see Ask First) -- extract `manifestFor`, `fakeDeps`, `makeEdtsBaseDir`/tmp-dir cleanup helper.
- [ ] `app-shell.test-support.tsx` + `app-shell.{navigation,command-bar,settings,resize,reset,overlays,load-activation,footer}.test.tsx` -- one topic per commit, grouping the 18 describes by flow.
- [ ] `store/app-store.{core,edt,settings,splitter-ratios}.test.ts` + `store/slices/logs-slice.{store,health,filters}.test.ts` -- split by slice; the three `logs slice*` describes follow the logs slice.
- [ ] `store/slices/update-slice.test-support.ts` + `update-slice.{base,health,config,run,dialog,smart-update}.test.ts` -- by the 12.8 sub-creators (config, health, run, incident).
- [ ] Delete the three originals once empty.

**Acceptance Criteria:**
- Given the split, when running the produced files, then totals are 112, 150 and 136 with identical sorted title lists.
- Given the repo, when running `npm test && npm run typecheck && npm run depcheck`, then all pass.
- Given the diff, then only test and test-support files change.

## Verification

**Commands:**
- `npx vitest run src/adapters/driving/tui --configLoader runner --reporter=json` -- expected: 398 passed for these files, no failures
- `npm run typecheck && npm run depcheck` -- expected: exit 0

## Suggested Review Order

**Shared fixtures**

- One store fixtures module: `fakeDeps`, `manifestFor`, temp-dir cleanup.
  [`store.test-support.ts:1`](../../../../src/adapters/driving/tui/store/store.test-support.ts#L1)

- Shell helpers (`mount`, `press`, `pressEscape`) reuse the store `manifestFor`.
  [`app-shell.test-support.tsx:1`](../../../../src/adapters/driving/tui/app-shell.test-support.tsx#L1)

- Update-slice fixtures with extra container/migration/restart ports.
  [`update-slice.test-support.ts:1`](../../../../src/adapters/driving/tui/store/slices/update-slice.test-support.ts#L1)

**Topic files**

- Largest update-slice topic (pre-run configuration), slightly over the size target.
  [`update-slice.config.test.ts:1`](../../../../src/adapters/driving/tui/store/slices/update-slice.config.test.ts#L1)

- EDT store tests register their own temp-dir cleanup.
  [`app-store.edt.test.ts:1`](../../../../src/adapters/driving/tui/store/app-store.edt.test.ts#L1)

- Logs slice tests moved next to the logs slice.
  [`logs-slice.health.test.ts:1`](../../../../src/adapters/driving/tui/store/slices/logs-slice.health.test.ts#L1)

- Largest app-shell topic: the `:` command bar.
  [`app-shell.command-bar.test.tsx:1`](../../../../src/adapters/driving/tui/app-shell.command-bar.test.tsx#L1)
