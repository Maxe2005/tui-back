---
title: 'Split EDT Switch'
type: 'refactor'
created: '2026-11-16'
status: 'done'
baseline_commit: '7b5c54c837e113efbbe96353a9f36fcdbb441682'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/sprint-2-refonte-fichiers-volumineux/epic-12-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `core/edt/switch.ts` (893 lines) mixes the `switchActiveEdt` orchestration with dirty-repo pre-flight/planning/execution/adoption and the per-repo member/non-member switching.

**Approach:** Move dirty-work handling to `core/edt/switch/dirty.ts` and per-repo switching to `core/edt/switch/member.ts`; shared public types and the `failed` helper go to `switch/types.ts`. `switch.ts` keeps `switchActiveEdt`, `classifySwitchRepos` and re-exports the whole public API. Code moved verbatim.

## Boundaries & Constraints

**Always:** Behaviour-preserving. Every previously exported symbol (types, `failed`, `classifySwitchRepos`, `resolveTargetBranch`, `TargetBranchSpec`, `switchActiveEdt`) stays exported from `switch.js`. No import cycle (new modules never import `switch.ts`). One responsibility and a header comment per file. Gates: typecheck, depcheck, vitest.

**Never:** Edit `switch.test.ts` / `switch-restart.test.ts`, or change messages, error codes or call order.

</frozen-after-approval>

## Code Map

- `switch.ts` -- orchestration: `switchActiveEdt`, `classifySwitchRepos`, `blockedBy`; re-exports.
- `switch/types.ts` -- public/shared types (`SwitchEdtRepoResult`, `DirtyResolution`, `SwitchActiveEdtParams`, `ClassifiedSwitchRepo`, `RepoSwitchContext`...) + `failed`.
- `switch/dirty.ts` -- `resolveDirtyRepos`, `describeDirtyRepo`, `planDirtyWork`, `executeDirtyPlan`, `adoptDirtyWork`, `restoreAndFail`, stash tag helper.
- `switch/member.ts` -- `switchMemberRepo`, `switchNonMemberRepo`, `failAfterPrepare`, `failAfterCheckout`, `succeeded`.
- Importers of `./switch.js` (activate.ts, etc.) stay untouched.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/edt/switch/{types,dirty,member}.ts` + `switch.ts` -- extract verbatim, re-export public API -- single commit (modules depend on each other)

**Acceptance Criteria:**
- Given the split, when `switch.test.ts`, `switch-restart.test.ts` and the full suite run unchanged, then they pass (except the pre-existing `app-shell` `:reset` failure); typecheck and depcheck are green.

## Verification

**Commands:**
- `npm test && npm run typecheck && npm run depcheck` -- expected: green (modulo the known `:reset` failure)

## Suggested Review Order

- Orchestration entry point and public re-exports: [`switch.ts:1`](../../../../src/core/edt/switch.ts#L1)
- Dirty pre-flight, plan, execute, adopt: [`dirty.ts:1`](../../../../src/core/edt/switch/dirty.ts#L1)
- Per-repo member / non-member switching: [`member.ts:1`](../../../../src/core/edt/switch/member.ts#L1)
- Shared types and `failed` (leaf module, no cycle): [`types.ts:1`](../../../../src/core/edt/switch/types.ts#L1)
