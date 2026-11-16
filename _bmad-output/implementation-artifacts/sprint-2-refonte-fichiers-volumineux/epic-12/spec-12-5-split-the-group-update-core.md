---
title: 'Split the Group Update Core'
type: 'refactor'
created: '2026-11-16'
status: 'done'
baseline_commit: 'f5bab91dfcbed63a95cda1f78111e77738e0f6b2'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/sprint-2-refonte-fichiers-volumineux/epic-12-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `core/scripts/group-update.ts` (1627 lines) mixes types, the all-repos and EDT flows, blocker resolution, conflict resolution and the restart step.

**Approach:** Move each concern into `core/scripts/group-update/*.ts`; `group-update.ts` keeps `groupUpdate` and re-exports the whole public API. Code moved verbatim.

## Boundaries & Constraints

**Always:** Behaviour-preserving. Every previously exported symbol stays exported from `group-update.js`. Header comment and one responsibility per file. Gates: typecheck, depcheck, vitest.

**Never:** Edit `group-update.test.ts` or change messages/error codes.

</frozen-after-approval>

## Code Map

- `group-update.ts` -- 52 lines: `groupUpdate` + re-exports.
- `group-update/{types,observers,selection,outcome,restart}.ts` -- shared types and small helpers.
- `group-update/{all,edt}.ts` -- the two scope flows. `member.ts` -- per-service pipeline.
- `group-update/blockers.ts` (dirty, unpushed, pre-existing mid-state), `conflict.ts` (mid-run conflict, edited/retry attempts).

## Tasks & Acceptance

- [x] Split into the modules above (single commit: modules depend on each other).
- Given the split, when `group-update.test.ts` and the full suite run unchanged, then they pass (except the pre-existing `app-shell` `:reset` failure); typecheck and depcheck are green.

## Spec Change Log

## Suggested Review Order

- Entry point and public re-exports: [`group-update.ts`](../../../../src/core/scripts/group-update.ts)
- Per-service pipeline: [`member.ts`](../../../../src/core/scripts/group-update/member.ts)
