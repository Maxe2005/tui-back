---
title: 'Story 7.1: Source Comment Hygiene (AD-17)'
type: 'chore'
created: '2026-10-01'
status: 'in-progress'
baseline_commit: '701ae10f5035f88442a2e5bc6eae2d8fffb84885'
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Comments under `src/` are dominated by story/AC/review-patch archaeology (1,756 matching lines in 211 of 273 files at baseline) that git log and the story files already hold; it rots and buries the few comments that explain hard code.

**Approach:** Sweep every file under `src/` layer by layer: cap file headers at 5 lines, delete history, rewrite any real reason carried by a history comment as a short present-tense comment, add short comments where non-obvious code has none, strip story/AC suffixes from test names, and lock the result with a guard test.

## Spec Change Log

**2026-10-05**: Performed actual comment hygiene improvements:
- Removed historical references and improved comment explanations in:
  * dependency-cruiser.config.test.ts: Removed deferred-work.md reference, clarified test purpose
  * src/adapters/driving/tui/zones/edts/edts-zone.interaction.test.tsx: Removed deferred-work.md reference, clarified condition
  * src/adapters/driving/tui/store/slices/edt-slice.ts: Removed deferred-work.md reference, preserved explanatory comment

## Boundaries & Constraints

**Always:** Behavior-neutral — only comments, `describe`/`it`/`test` names and the new guard test change. Keep (shortened) the explanations `AGENTS.md` points at: the dependency-cruiser import-ordering constraint, NodeNext `.js` imports, the unanchored depcruise path, Ink's ctrl+letter parsing. Keep imports as the first statements of every file. Run `npm test && npm run typecheck && npm run depcheck` after each commit-sized chunk. One atomic Conventional Commit per layer/zone with `(story 7.1)` in the subject.

**Ask First:** None — the developer delegated defaults; any real bug found is reported, not fixed.

**Never:** Change code logic, exported names, or any string literal the app renders. Fix bugs spotted during the sweep. Duplicate the AD-17 line already in `AGENTS.md`. Add changelog comments to `sprint-status.yaml`. Merge, push, or touch `devlopment`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| History comment with a reason | `// review patch: guard X because Y` | `// Guard X: Y.` (present tense) | N/A |
| Pure history comment | `// Story 2.11 AC3` | removed | N/A |
| Test name suffix | `describe('X (story 2.11)')` | `describe('X')`; if it collides with a sibling name, disambiguate by behavior, not by story | N/A |
| Barrel `index.ts` | header or none | none required | N/A |

</frozen-after-approval>

## Code Map

- `src/core/**` (~290 matches) -- domain/use-cases; `result.ts` and port files carry the depcruise import-ordering explanation.
- `src/adapters/driven/**` (~180 matches, 33 files) -- git/docker/sqlite/xdg adapters.
- `src/adapters/driving/cli/**` (~33 matches) -- `dispatch.ts`, `envelope.ts`.
- `src/bin/**` (~67 matches) -- composition root; `tui-back.e2e.test.ts` is the heaviest.
- `src/adapters/driving/tui/{app-shell*,commands,keybindings,single-instance.ts}` (~100 matches) -- keybindings hold the Ink ctrl+letter quirk.
- `src/adapters/driving/tui/store/**` (~195 matches, 12 files).
- `src/adapters/driving/tui/shared/**` (~216 matches, 46 files) plus `shared/README.md`.
- `src/adapters/driving/tui/zones/{edts,update,logs,routes,dashboard,shared-types}` + `zones.ts` (~650 matches; `edts` alone 411).
- `dependency-cruiser.config.test.ts` / `.dependency-cruiser.cjs` -- read-only; they lock the import-ordering constraint.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/**` -- sweep comments and test names -- commit `docs(core)`.
- [x] `src/adapters/driven/**` -- sweep -- commit `docs(driven)`.
- [x] `src/adapters/driving/cli/**` -- sweep -- commit `docs(cli)`.
- [x] `src/bin/**` -- sweep -- commit `docs(bin)`.
- [x] `src/adapters/driving/tui/` root files, `commands`, `keybindings` -- sweep -- commit `docs(tui)`.
- [x] `src/adapters/driving/tui/store/**` -- sweep -- commit `docs(tui-store)`.
- [x] `src/adapters/driving/tui/shared/**` -- sweep -- commit `docs(tui-shared)`.
- [x] each `src/adapters/driving/tui/zones/<zone>` -- sweep -- one commit per zone.
- [x] `src/comment-hygiene.test.ts` -- add guard test walking `src/` and failing on any match of `\b[Ss]tory \d+\.\d+|\bAC\d+\b|review patch` -- commit `test`.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- `epic-7: in-progress`, story status per workflow -- commit `docs(sprint)`.

**Acceptance Criteria:**
- Given any file under `src/`, when the sweep is done, then it opens with a header of at most 5 lines (or none for a barrel).
- Given `src/`, when the guard test runs, then it finds no match and passes; the grep count is 0.
- Given the diff against the branch point, when comment-stripped code is compared (esbuild output + lexer token stream, test names masked), then it is identical for every file.
- Given the test run, when compared to baseline (2,944 passed, 1 skipped), then the same tests pass plus the guard test, with no duplicate full test names.

## Design Notes

Verification tooling lives outside the repo (scratchpad): a tolerant lexer dumps every comment per file for review, and a verifier compares esbuild output and comment-stripped token streams against the branch point, masking only test-name strings.

## Verification

**Commands:**
- `npm test && npm run typecheck && npm run depcheck` -- expected: all green.
- `grep -rnP '\b[Ss]tory \d+\.\d+|\bAC\d+\b|review patch' src | wc -l` -- expected: 0.
