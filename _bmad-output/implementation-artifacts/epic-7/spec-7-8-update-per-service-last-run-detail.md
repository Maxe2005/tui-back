---
title: 'Story 7.8: Update per-service last-run detail (FR-32)'
type: 'feature'
created: '2026-10-06'
status: 'in-progress'
baseline_commit: '422be0eecdbb1d4b39c59b8b572bc51fdee056d6'
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After a group update the detail pane only says `updated`; the developer cannot tell whether the merge brought anything, or whether migrations really ran, without re-checking by hand. No code currently raises a zone background event, so the tab badge never shows.

**Approach:** `groupUpdate` reports, per service row, what the merge did (HEAD unchanged → up to date; advanced → +N/−M lines, F files via a new GitPort diff capability) and what the migrate phase did (ran + command + output excerpt, or none). The TUI detail pane renders it from the in-memory last-outcome map; the CLI JSON line carries it additively. A finished run raises an Update-tab background event when another zone (e.g. Dashboard) is active.

## Boundaries & Constraints

**Always:** Result<T> with kebab-case codes in core; core never imports adapters; new GitPort methods are read-only and ungated; run detail is best-effort — a failing HEAD/diff read never fails or alters the service's outcome; the new row field is optional/additive (existing JSON consumers unaffected); AD-17 comment rule; imports first per file; conventional commits with `(story 7.8)` on this story branch; verify with `npm test && npm run typecheck && npm run depcheck`.

**Ask First:** None — defaults delegated.

**Never:** Persist anything (no StatePort change, never 7.5's last-update datum); touch Dashboard rendering, Logs, or the zone-layout contract; show a diffstat when HEAD is unchanged; change merge/pull/migrate/restart semantics or phase order.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Already up to date | merge/pull ok, HEAD before == after | `merge: up-to-date`; pane "already up to date" | N/A |
| Advancing merge | HEAD changed | `merge: advanced {files, insertions, deletions}`; pane "+N/−M lines, F files" | diff read fails → `merge: advanced` without counts, pane "updated (diff unavailable)" |
| HEAD unreadable | rev-parse fails before or after | no merge detail on the row | never fails the row |
| Migration ran | run enabled, command declared, ok | `migrations: ran {command, outputExcerpt}`; pane "ran (<command>)" + excerpt | N/A |
| Migration none | disabled, undeclared or blank | `migrations: none`; pane "migrations: none" | N/A |
| Container-less service | merge ok, restart `skipped`/`no-container` | row keeps its run detail | N/A |
| New run lands | service already has a last outcome | entry replaced for that service only | N/A |
| Failed/other skipped row | merge or migration failed, dirty skip | no run detail (existing rendering) | N/A |
| Run ends off-Update | active zone ≠ update | Update tab shows `●1` badge; cleared on visiting Update | N/A |

</frozen-after-approval>

## Code Map

- `src/core/ports/git.ts`, `src/adapters/driven/git/index.ts:39,544` -- add `headRevision(repoPath)` (`git rev-parse HEAD`) and `diffStat(repoPath, from, to)` (`git diff --numstat --no-renames -z`, binary `-` counts a file with 0 lines, code `git-diff-error`); mirror `diffNameOnly` (spawnSync, `LARGE_OUTPUT_BUFFER`).
- `src/core/scripts/group-update.ts:76-80` -- `GroupUpdateRepoResult` gains optional `run`; `:662-848` `updateWithLoadedManifest`: read HEAD before pull/merge (after the dirty gate, `:749`), compare after (incl. resumed-conflict rejoin), capture migration outcome (`:818-828`), attach `run` on the `updated` row and the `no-container` skipped row (`:835-841`).
- `src/adapters/driving/cli/subcommands.ts:155-230` -- no wiring change expected (results serialize as-is); lock with a test.
- `src/adapters/driving/tui/zones/update/update-zone.logic.ts:107-117` -- `formatServiceOutcomeDetail` renders run detail; `:213` `mergeLastServiceOutcomes` already replaces per service.
- `src/adapters/driving/tui/store/slices/update-slice.ts:657-670,1011` -- run completion; call `addZoneEvent('update')` when `activeZone !== 'update'` (`navigation-slice.ts:114`; badge rendering exists in `zone-tab-bar.tsx:44`). Standalone restart rows carry no run detail and replace the entry (new run).
- Tests: `group-update.test.ts`, `adapters/driven/git/index.test.ts`, `update-zone.test.tsx`/`update-slice.test.ts`, `cli/dispatch.test.ts`; every inline `GitPort` fake (`dispatch.test.ts:195`, `app-shell.interaction.test.tsx:51`, `update-slice.test.ts`, `app-store.test.ts`, others flagged by typecheck) needs the two new methods.

## Tasks & Acceptance

**Execution:**
- [ ] `src/core/ports/git.ts` + `src/adapters/driven/git/index.ts` (+ adapter tests, real git repo) -- `headRevision`, `diffStat` -- the GitPort diff capability.
- [ ] `src/core/scripts/group-update.ts` (+ tests per matrix row) -- `run` detail on rows -- core-led truth shared by TUI and CLI.
- [ ] Update inline `GitPort` test fakes across the suite -- typecheck stays green.
- [ ] `src/adapters/driving/tui/zones/update/update-zone.logic.ts` (+ tests) -- detail-pane rendering, excerpt collapsed to one line.
- [ ] `src/adapters/driving/tui/store/slices/update-slice.ts` (+ tests) -- Update-tab background event on off-zone completion.
- [ ] `src/adapters/driving/cli/dispatch.test.ts` -- JSON line carries `run` additively.

**Acceptance Criteria:**
- Given a successful merge with unchanged HEAD, when shown, then "already up to date", never a diffstat.
- Given an advancing merge, when shown, then +N/−M lines and F files.
- Given the migrate phase ran, when shown, then "ran (<command>)" plus an output excerpt; absent/disabled, then "migrations: none".
- Given a new run finishes, when it lands, then it replaces that service's previous detail; nothing is persisted.
- Given the CLI, when a run ends, then the same details ride the JSON line.
- Given a run ends while the Dashboard is active, when the tab bar renders, then the Update tab shows the counter badge.

## Design Notes

Row shape (additive):
```ts
run?: {
  merge: { kind: 'up-to-date' } | { kind: 'advanced'; files?: number; insertions?: number; deletions?: number };
  migrations: { kind: 'none' } | { kind: 'ran'; command: string; outputExcerpt: string };
}
```
Excerpt: last 3 non-empty lines of trimmed output, capped at 200 chars. `diffStat` runs `from..to` = HEAD before → HEAD after.

## Verification

**Commands:**
- `npm test` -- expected: all pass, incl. every matrix row.
- `npm run typecheck` -- expected: clean.
- `npm run depcheck` -- expected: clean.
