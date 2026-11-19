---
title: 'Story 13.6: Split CLI, E2E and Git Tests'
type: 'refactor'
created: '2026-11-18'
status: 'done'
baseline_commit: '7c442363d59ef3e7903dcf6a5f55990fb9fc3b3c'
review_loop_iteration: 0
context:
  - '{project-root}/docs/test-splitting-conventions.md'
  - '{project-root}/_bmad-output/implementation-artifacts/sprint-2-refonte-fichiers-volumineux/epic-13-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `src/bin/tui-back.e2e.test.ts` (2810 lines, 136 tests), `src/adapters/driving/cli/dispatch.test.ts` (2391, 129) and `src/adapters/driven/git/index.test.ts` (2210, 164) no longer mirror the command-family split (12.4) and the git operation-family split (12.1).

**Approach:** Extract one `*.test-support` module per file, then move the tests verbatim into topic files following `docs/test-splitting-conventions.md`, one topic per commit. Test-only change.

## Boundaries & Constraints

**Always:** Same test count before and after (136 + 129 + 164 = 429) and identical sorted title lists (modulo a topic suffix on a describe that has to be split). Tests move verbatim; only imports and helper location change. Gates before each commit: `npm test && npm run typecheck && npm run depcheck`. Each produced test file under ~800 lines, each test-support under ~400. `*.test-support.ts(x)` excluded from the package via `package.json` `files` (first commit only).

**Ask First:** Any production-code change, any test that has to be renamed beyond a topic suffix, any e2e run-time regression beyond ~20%.

**Never:** Change assertions, skip or drop a test, split a top-level `describe` across files without a topic suffix in its title, import test-support from non-test code, add story/AC references in comments or titles.

</frozen-after-approval>

## Code Map

- `src/bin/tui-back.e2e.test.ts` -- 17 black-box describes; helpers `runCli`, `runCliAsync`, `makeRepo`, `manifestYaml`, `makeTempDir`, `makeGitRepo`, `runGit`, `branchExists`, `commitManifest`, `tmpDirs` + `afterEach`.
- `src/adapters/driving/cli/dispatch.test.ts` -- `runCli`, `runCli humanText hook`, then one 2200-line describe `subcommand registry guards` with nested describes (edt delete, edt switch --restart, realign, heal, update settings, update --from-edt, registry clean/validate, interactive TTY); module-level `vi.mock('node:readline/promises')`; fakes `fakeLock`, `fakeState`, `fakeSubcommands`, plus in-describe `fakeEdtRegistry`, `fakeSavedRequests`, `fakeGitPort`, `buildTestSubcommands`.
- `src/adapters/driven/git/index.test.ts` -- ~45 describes, one per git operation; helpers `makeGitRepo`, `makeCleanGitRepo`, `makeOriginAndClone`, `makeManagedClone`, `commit`, `fakeEdtRegistry`, `edtEntry`, `remoteRefExists`, `upstreamOf`.
- `src/adapters/driven/git/{gate,branches,refs,remote,merge,stash,discard,diff,commit}.ts` -- source split that the topics mirror.
- `src/adapters/driving/cli/commands/*.ts` -- command-family split that dispatch/e2e topics mirror.
- Baseline title lists: scratchpad `titles-*.txt` (sorted `fullName`).

## Tasks & Acceptance

**Execution:**
- [ ] `src/adapters/driven/git/git.test-support.ts` + `package.json` `files` -- extract helpers and a `cleanupTmpDirs()`; each topic file calls `afterEach(cleanupTmpDirs)`.
- [ ] `src/adapters/driven/git/git.{gate,branches,remote,merge,stash,worktree-state,port}.test.ts` -- move describes by operation family (gate: assertAllowedBranch + cross-EDT; branches: create/current/delete/rename/list/checkout/exists; remote: aheadBehind, remote branches, tracking, fetch, pull; merge: merge/abort/in-progress/rebase/unmerged/finalize/conflict; stash; worktree-state: dirty paths, discard*, diff*, headRevision, stage/commit; port: createGitPort, spawn diagnostics). One commit each, delete original when empty.
- [ ] `src/adapters/driving/cli/dispatch.test-support.ts` -- extract fakes and `buildTestSubcommands`; keep `vi.mock` in the one file that needs the readline TTY flow.
- [ ] `src/adapters/driving/cli/dispatch.{core,edt,realign-heal,update,registry,routes-requests}.test.ts` -- split by command family; the guards describe gets a topic suffix per file.
- [ ] `src/bin/e2e.test-support.ts` -- extract `runCli*`, `makeRepo`, temp-dir/git helpers (reuse `git.test-support.ts` where identical).
- [ ] `src/bin/tui-back.e2e.{basics,register,registry,routes,edt-create,edt-switch-delete,update,tools}.test.ts` -- move describes by command family; `tools` = completion, mcp, install.
- [ ] Record before/after counts in each commit body; update story status and sprint-status; merge `--no-ff` into the epic branch after review.

**Acceptance Criteria:**
- Given the three original files, when the split is done, then they no longer exist and the 13 to 20 produced files hold exactly 429 tests with identical sorted titles (modulo suffixes).
- Given the full suite, when run, then typecheck and depcheck pass and no test other than the known `app-shell.reset` failure fails.
- Given the e2e, dispatch and git files, when run together, then total time stays within ~20% of the baseline.

## Design Notes

Dispatch's single `subcommand registry guards` describe cannot be kept whole (~2200 lines). As in 13.5, each file gets its own top-level describe titled `subcommand registry guards — <topic>`; the sorted-title diff accounts for the suffix.

## Verification

**Commands:**
- `npx vitest run <file> --reporter=json` -- expected: passed count equals baseline sum per original file
- `npm test && npm run typecheck && npm run depcheck` -- expected: green (except the known reset failure)

## Result

- Git: `git.test-support.ts` + `git.{gate,branches,remote,merge,stash,worktree-state,port}.test.ts` (164 tests).
- Dispatch: `dispatch.test-support.ts` + `dispatch.{core,edt,realign-heal,update,registry,routes-requests}.test.ts` (129 tests). Each file has its own `subcommand registry guards — <topic>` describe; the readline `vi.mock` stays in `dispatch.registry.test.ts`.
- E2E: `e2e.test-support.ts` (reuses `runGit`/`branchExists` from `git.test-support.ts`) + `tui-back.e2e.{basics,register,registry,routes,edt-create,edt-switch-delete,update,tools}.test.ts` (136 tests).
- Totals 164 + 129 + 136 = 429; sorted title lists identical to the baseline (dispatch modulo the topic suffix). Largest produced test file: 568 lines; largest test-support: 200.
- E2E wall time went from ~87s (one file) to ~43s (parallel files). Because the files now run in parallel, `vitest.config.ts` raises `testTimeout` to 20s: a loaded full run otherwise timed out a few multi-spawn cases.
- Gates: `npm test`, typecheck and depcheck pass.
