---
title: 'shared-types Version History Library'
type: 'feature'
created: '2026-10-14'
status: 'in-progress'
baseline_commit: 'ab341273883c09d38e76626d2fa344aa78e9cc79'
review_loop_iteration: 0
context: [_bmad-output/implementation-artifacts/epic-4-context.md]
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Answering "which version is on my branch?" or "where was 0.1.3770 released?" means digging through git by hand in the `shared-types` source repo.

**Approach:** A read-only **History** view in the st zone searches the source repo by branch (version bumps newest first) or by version (bumping commit, containing branches, date), streamed and cancellable. `Enter` on a row opens the st form (4.2) with that version pre-filled. Two new `sharedTypes` settings bound the walk.

## Boundaries & Constraints

**Always:** Read-only git, nothing cached between searches, nothing in the repo modified. View needs the `shared-types-source` repo in the active EDT (exactly one source, as publish); otherwise unavailable with the usual disabled reason. Core use-case `core/shared-types/version-history.ts` is pure orchestration over `GitPort`, cancellable via `AbortSignal`; the zone only renders. Bumps = commits changing the `"version": "x.y.z",` line of the source's `package.json`. By-branch stops at `sharedTypes.historyDepth` versions (default 20, 1–200), branch exhausted, or `sharedTypes.maxCommitsScanned` commits (default 1000, 100–20000) and says which ended it. Streamed entries with header spinner; `Esc` cancels; a new search/branch change cancels the previous walk first. By-version input validated `MAJOR.MINOR.PATCH` digits only before any git call. Reuse `BranchAutocompleteInput` (local+remote branches), `TextInputLine`, `FilterablePickList`/`BoundedList` windowing (UX-DR37, bounded-rendering guard), `useZoneInputActive` (inert under `?`/`:settings`, Story 7.11). New settings fields optional-with-default in zod (old `settings.yaml` stays valid), as rows appended to the st settings tab.

**Ask First:** None.

**Never:** No fetch, no cache, no repo write. No version-drift view. No change to publish/propagate logic.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| By branch | branch with 30 bumps, depth 20 | 20 entries `{version, commit, date, branch}` newest first, "stopped: depth 20" | N/A |
| Scan bound | maxCommitsScanned reached before depth | partial list, "stopped: 1000 commits scanned" | N/A |
| Branch exhausted | fewer bumps than depth | all entries, "branch exhausted" | N/A |
| By version found | `0.1.3770` | bumping commit(s) with containing branches + bump date; earliest-introducing flagged | N/A |
| By version absent | valid, never set | explicit "not found on any branch" | N/A |
| Invalid version | `0.1`, `a.b.c` | inline message, no git call | N/A |
| Cancel / re-search | Esc, or branch change mid-walk | previous walk aborted, no stale entries appended | N/A |
| Git failure | unknown ref, shallow clone, git unreachable | explicit error shown, view stays usable | `Result` error surfaced, not thrown |
| Select | Enter on a row | st form opens, version pre-filled; registry verify (4.2) still applies | N/A |

</frozen-after-approval>

## Code Map

- `src/core/ports/git.ts` -- `GitPort`: add `listVersionBumpCommits(repoPath, ref, {limit, maxScanned, signal})` (streamed: callback/async iterator; `git log <ref> -G'"version"\s*:' --format=… -p -- package.json`, parse added `+  "version": "…"` line) and `listBranchesContaining(repoPath, commit)` (`git branch -a --contains`); by-version commit lookup `git log --all -S'"version": "X"' -- package.json` (extend `listVersionBumpCommits` with `ref: '--all'`+pickaxe or a sibling method).
- `src/adapters/driven/git/index.ts` -- implement them; `runProcess` (`../process.js`) buffers fully, so streaming needs `spawn` with line parsing + abort kill (extend `process.ts` with a streaming variant, or spawn locally). Wire into `createGitPort` (~l.22-60).
- `src/core/shared-types/version-history.ts` (new) -- `searchByBranch`, `searchByVersion`, `isValidVersion` reuse from `propagate-version.ts`; ends-reason result.
- `src/core/ports/settings.ts`, `src/adapters/driven/settings/schema.ts` (`sharedTypes` group ~l.90), `store/slices/settings-slice.ts` -- add `historyDepth`, `maxCommitsScanned` + min/max constants.
- `src/adapters/driving/tui/shared/settings-screen.tsx` -- `SHARED_TYPES_SETTINGS_ROWS` (~l.50-75, checkbox rows) gains two numeric rows; copy `update-concurrency` +/- and digit editing (`resolveGeneralSettingsKey` ~l.183-255).
- `src/adapters/driving/tui/store/slices/shared-types-slice.ts` -- history state (mode, results, status, endedBy, error), actions `startHistorySearch`/`cancelHistorySearch`; source repo from `sharedTypesSources` (single source, as `resolveSingleSourceOf`); uses `deps.git`.
- `src/adapters/driving/tui/zones/shared-types/shared-types-zone.tsx` + `.logic.ts` -- History view toggle key, mode switch key, results list, Enter → set `form.version`; new footer contexts (see `useFooterContext` ~l.123 and `hints.ts`/`footer-context.tsx`, `hints.guard.test.ts`). Zone is 465 lines: put history rendering in a new `shared-types-history.tsx` + pure `shared-types-history.logic.ts`.
- `src/adapters/driving/tui/shared/components/branch-autocomplete-input.tsx` -- `handleBranchAutocompleteKey` pure reducer to drive from the history view.
- `docs/tui-back-manifest.md` -- manifest surface unchanged: no update.

## Tasks & Acceptance

**Execution:**
- [ ] `core/ports/git.ts`, `adapters/driven/git/index.ts` (+ `process.ts` streaming) -- read-only history primitives -- adapter tests on a temp git repo (bumps, bounds, abort, unknown ref) and fake-port in `index.test.ts` conformance
- [ ] `core/shared-types/version-history.ts` -- by-branch/by-version orchestration, ends-reason, abort -- unit tests over a faked `GitPort` covering the I/O matrix
- [ ] settings (`settings.ts`, `schema.ts`, `settings-slice.ts`, `settings-screen.tsx`) -- two bounded fields + st rows -- schema (old file, out-of-range) and screen tests
- [ ] `shared-types-slice.ts` -- history state/actions, cancel-before-restart -- slice tests
- [ ] `shared-types-history.tsx/.logic.ts`, `shared-types-zone.tsx`, hints/footer -- History view, modes, windowed rows, Enter pre-fills form, inert under overlays, disabled without source -- interaction + bounds tests
- [ ] `CHANGELOG`/docs only if a user-facing keys doc exists (grep first)

**Acceptance Criteria:**
- Given the source repo in the active EDT, when History opens, then by-branch/by-version modes switch with a footer-shown key; without the source it is unavailable with the disabled reason.
- Given a walk in progress, when entries are found, then they appear streamed with a header spinner; Esc or a new search aborts the git child.
- Given a result row, when Enter, then the st form shows that version pre-filled and the registry verify still gates the run.
- Given `?` or `:settings` open, when keys are pressed, then the view is inert.
- Given a git failure, then the error is shown and the next search works.

## Spec Change Log

## Design Notes

Entry shape: `{ version, commit, date, branch }`. By-version results: `{ version, commit, date, branches: string[], earliest: string }`; "earliest-introducing" = the branch whose containing commit has the oldest author date among the bumping commits' containing branches. Streaming contract: `onEntry` callback + `AbortSignal`; the adapter kills the child on abort and resolves `ok` with `endedBy: 'aborted'`.

## Verification

**Commands:**
- `npm test` -- expected: all pass
- `npm run typecheck` -- expected: no errors

**Manual checks (if no CLI):**
- In the TUI on the st tab, open History on a real `shared-types` checkout: entries stream in, Esc stops, Enter pre-fills the form.
