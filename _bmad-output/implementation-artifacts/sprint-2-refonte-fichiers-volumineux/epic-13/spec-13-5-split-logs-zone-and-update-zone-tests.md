---
title: 'Story 13.5: Split Logs Zone and Update Zone Tests'
type: 'refactor'
created: '2026-11-18'
status: 'done'
baseline_commit: 'd99bd5e0'
review_loop_iteration: 0
context:
  - '{project-root}/docs/test-splitting-conventions.md'
  - '{project-root}/_bmad-output/implementation-artifacts/sprint-2-refonte-fichiers-volumineux/epic-13-context.md'
---

## Intent

**Problem:** `logs-zone.interaction.test.tsx` (2457 lines, 91 tests), `update-zone.test.tsx` (1466, 103) and `routes-zone.interaction.test.tsx` (1752, 60) no longer mirror the hook/subcomponent split of epic 12.

**Approach:** Extract one `*.test-support` module per zone, then move the tests verbatim into topic files following `docs/test-splitting-conventions.md`. Test-only change.

## Result

- Logs: `logs-zone.test-support.tsx` + `logs-zone.{navigation,filter-editor,filter-history,service-actions,filter-rules,history-grid,actions-menu}.test.tsx` (91 tests). The first describe is split across files, so each file carries a topic suffix in its describe title.
- Update: `update-zone.test-support.ts` + `update-zone.{resolvers,status,rendering,wiring}.test.ts(x)` (103 tests).
- Routes: `routes-zone.test-support.tsx` + `routes-zone.{list,json-tree,request,saved}.test.tsx` (60 tests). The JsonTree describe is kept whole (700 lines) because the body editor and panel cursor blocks are nested in it and share its helpers.
- Totals 91 + 103 + 60 = 254; sorted title lists identical to the baseline (logs modulo the topic suffix).
- Gates: typecheck and depcheck pass; full suite passes except `app-shell.reset.test.tsx > opens only through the reset command`, which already fails on the epic branch before this story.
