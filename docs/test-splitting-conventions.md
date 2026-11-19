# Test file splitting conventions

Applies to the monolithic test files split in epic 13 (stories 13.2-13.6). The goal is that one test file mirrors one source module or one scenario family, and that no fixture is copied between files.

## Rules

1. **Naming**: `<module>.<topic>.test.ts` (or `.test.tsx`), placed next to the module under test. Example: `group-update.blockers.test.ts`. The topic is the scenario family or extracted source module, never a number or "part2".
2. **One `describe` family per file**: a file holds the `describe` blocks of a single topic. A top-level `describe` is never split across two files.
3. **Shared builders** live in `<module>.test-support.ts` (or `.tsx` when it renders Ink), next to the tests that use it. It holds fakes, factories, render/press/settle helpers and constants. It contains no `describe`, `it` or `test`, and nothing imports it from `src/` non-test code.
4. **Cross-module helpers** already shared by several modules stay in the existing `tui/shared/test-support/` folder (`fake-tty`, `mount-for-test`, `matrix`, `dialog-registry`). A helper used by two or more split files of different modules is promoted there; a helper used by one module stays in that module's `*.test-support.ts`.
5. **Moves first, edits second**: tests are moved verbatim (same names, same assertions). Only imports and the helper location change. Test titles are kept so the before/after listing can be diffed.
6. **Count check**: before and after each split, run the file with `npx vitest run <file> --reporter=json` and compare the number of passed tests. The sum over the produced files must equal the original count. Record both numbers in the commit body.
7. **No source change**: a split commit touches only test files (and `package.json` `files` on the first test-support file). Green gates before every commit: `npm test && npm run typecheck && npm run depcheck`.
8. **Size target**: each produced test file stays under ~800 lines, each test-support file under ~400.
9. **Comments**: same rule as sources: no story/AC/review-patch references in test names or comments (guard test on `src/`).
10. **One extraction per commit**: `refactor(test): ... (story N.M)`, body explains why. Split a file topic by topic, running the gates after each one.
11. **Packaging**: `*.test-support.ts(x)` files are excluded from the npm package by the `files` globs in `package.json`.

## Fixture inventory (target files)

Duplicates are the main reason a shared test-support module is needed. Names below are the top-level helpers found in each file.

| Helper family | Files where it is defined | Target |
|---|---|---|
| Ink key input: `press`, `pressEscape`, `type`, `settle` | `edts-zone.interaction`, `app-shell.interaction`, `logs-zone.interaction` | `tui/shared/test-support/` (one copy; check `mount-for-test` first) |
| Mount helper: `mount(store)` | `edts-zone.interaction`, `app-shell.interaction`, `logs-zone.interaction` | per-module `*.test-support.tsx` unless identical, then shared |
| Store deps: `fakeDeps`, `manifestFor` | `app-shell.interaction`, `app-store`, `update-slice` (`fakeDeps`) | `tui/store/store.test-support.ts` |
| Core port fakes: `fakeGit`, `fakeManifest`, `fakeLock`, `fakeState`, `fakeRegistry`, `fakeEdtRegistry`, `fakeContainer`, `fakeMigration`, `fakeRestart`, `calls`, `manifestFor` | `group-update`, `switch` (near-identical copies) | `core/shared/core-ports.test-support.ts`, used by both |
| EDT builders: `member`, `edtEntry`, `makeParams` | `group-update`, `switch`, `git/index` (`edtEntry`) | same core test-support module; `makeParams` stays per module |
| Temp dirs and git repos: `tmpDirs`, `makeTempDir`, `makeGitRepo`, `runGit`, `branchExists`, `commit`, `makeOriginAndClone` | `git/index`, `tui-back.e2e` | `adapters/driven/git/git.test-support.ts`, reused by e2e |
| CLI runner: `runCli`, `runCliAsync`, `makeRepo`, `manifestYaml` | `tui-back.e2e` | `bin/e2e.test-support.ts` |
| CLI fakes: `fakeLock`, `fakeState`, `fakeSubcommands` | `dispatch` | `cli/dispatch.test-support.ts` |
| EDT/Logs zone fixtures: `edt`, `service`, `step3Store`, `reachStep3`, `seedStore`, `openRuleEditor` | `edts-zone.interaction`, `logs-zone.interaction` | per-zone `*.test-support.tsx` |

Observations for the later stories:

- `group-update.test.ts` and `switch.test.ts` carry near-identical copies of about 10 port fakes: extract once in 13.3, then reuse (do not create two diverging copies).
- `app-store.test.ts` has top-level `tmpDirs` state with cleanup; the split files that need it must each register their own `afterEach`, or import a helper that does.
- `git/index.test.ts` and `tui-back.e2e.test.ts` both create temp git repos; keep the e2e one independent if it must exercise the real binary's environment.
- Vitest runs files in parallel workers; shared module-level state in a test-support file (counters, temp dirs) is per worker and safe, but must never be relied on across files.

## Per-story checklist

1. Record the test count of the file and the list of titles (`--reporter=json`).
2. Create `<module>.test-support.ts` with the helpers, imports updated, run gates.
3. Move one topic per commit into `<module>.<topic>.test.ts`, run gates.
4. Delete the original file when empty and confirm the total count equals step 1.
