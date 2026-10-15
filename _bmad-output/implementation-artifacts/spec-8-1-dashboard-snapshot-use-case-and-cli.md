---
title: 'Story 8.1: Dashboard Snapshot Use-Case & CLI'
type: 'feature'
created: '2026-10-15'
status: 'in-review'
baseline_commit: 'fedca18701ccbca761bf62983077e292536c2986'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Dashboard has no data source: facts about the active EDT's services (container state, branch, divergence, working-tree issues, branch flags) and registry health are scattered across zones, and no script can read them.

**Approach:** One pure use-case `buildDashboardSnapshot` in `core/dashboard` assembles everything the Dashboard shows from injected ports, and a `dashboard` CLI subcommand emits it in the standard AD-3 envelope. Each probed field fails independently.

## Boundaries & Constraints

**Always:** Core never imports adapters or TUI; returns `Result<T>`; read-only (no fetch, no write, no lock). Per-service/field isolation: a docker or git failure becomes an explicit error state on that field only. Container health reuses `getServiceHealth` (`core/logs/use-cases.ts`) with `no-container` when the manifest has no container (never polled). Divergence reuses `git.aheadBehind` semantics: `current` | `no-upstream` | `unknown-offline`. Protected = `isProtectedBranch` (`core/edt/shared-branches.ts`). Other-EDT ownership: another EDT's member with same resolved `repoPath` and same `branch`, reported by EDT topic(s). Services listed in the active EDT's member order. Header comments ≤ 5 lines, no story/AC references in `src/` (guard test).

**Ask First:** Any change to existing ports' signatures.

**Never:** TUI/Ink code (Stories 8.2+); a third copy of health or divergence logic; polling; a configurable "behind" threshold; modifying `docs/tui-back-manifest.md` (manifest surface unchanged).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Populated | Active EDT, 2 members | `status:'active'`, one row per member with container, branch, divergence, workingTree, flags | N/A |
| No active EDT | `readActiveEdt` → null, or ulid unknown | `status:'no-active-edt'`, `services: []`, registry summary still present | N/A |
| Container-less | manifest without `container` | container = `no-container`, docker never called | N/A |
| Docker probe fails | `getContainerHealth` err | that row's `container` = `{ok:false,error}`; other fields intact | field-level only |
| No upstream / offline | `aheadBehind` err `no-upstream` / other | divergence status `no-upstream` / `unknown-offline`, numbers null | detail on offline |
| Dirty / mid-merge / mid-rebase | git reports true | `workingTree` flags set | probe error → field error |
| Branch flags | branch protected; or same repo+branch in another EDT | `protectedBranch:true`; `usedByEdts:['topic-b']` | N/A |
| Registry health | 5 paths: 1 unreachable, 1 invalid manifest, 1 `exists` error | counts `{repoCount:5, invalidManifests:1, unreachable:1, listingIssues:1}` | per-path isolation |
| Member repo unloadable | manifest load fails for a member | row carries `manifest` error state; other rows unaffected | field-level only |
| Registry/edt list fails | `registry.list` or `edtRegistry.list` err | whole use-case returns that err | N/A |

</frozen-after-approval>

## Code Map

- `src/core/edt/list.ts` -- `listEdtBranchesDivergence`/`readServiceDivergence`: divergence classification to reuse (export a shared helper rather than duplicate)
- `src/core/logs/use-cases.ts` -- `getServiceHealth` (DockerPort health); `HealthState` in `core/ports/docker.ts`
- `src/core/scripts/list-repos.ts`, `clean-registry.ts` -- registry classification patterns (exists → unreachable; manifest-not-found = unmanaged; other load error = invalid)
- `src/core/edt/shared-branches.ts` -- `isProtectedBranch`
- `src/core/ports/git.ts` -- `currentBranch`, `aheadBehind`, `hasUncommittedChanges`, `isMergeInProgress`, `isRebaseInProgress`
- `src/core/ports/{state,edt-registry,registry,manifest}.ts` -- active EDT pointer, EDT members, repo paths, manifest
- `src/adapters/driving/cli/subcommands.ts:84,156` -- `buildSubcommands` deps and the `edts` entry as template
- `src/bin/main.ts:36,72` -- wiring; `bin/tui.ts:118` shows `createDockerPort()`

## Tasks & Acceptance

**Execution:**
- [x] `src/core/edt/list.ts` -- extract the per-repo divergence read into an exported helper -- reuse without a second copy
- [x] `src/core/dashboard/snapshot.ts` -- `buildDashboardSnapshot({registry, manifest, git, docker, edtRegistry, state})` with types `DashboardSnapshot`, `DashboardService`, `Probed<T>` -- the use-case
- [x] `src/core/dashboard/snapshot.test.ts` -- unit tests with fake ports covering every I/O matrix row
- [x] `src/adapters/driving/cli/subcommands.ts` -- add `docker: DockerPort` dep and `dashboard` subcommand (no args, else `invalid-argument`) -- CLI
- [x] `src/bin/main.ts` -- wire `createDockerPort()` -- dependency
- [x] `src/adapters/driving/cli/dispatch.test.ts` (+ other `buildSubcommands` callers) -- dashboard envelope test, fix deps -- coverage
- [x] `README`/`AGENTS.md` command list if one exists -- mention `dashboard`

**Acceptance Criteria:**
- Given an active EDT, when `dashboard` runs, then stdout is one JSON line `{ok:true,data}` matching the snapshot, exit 0.
- Given any single probe fails, when the snapshot is built, then only that field is an error and `ok:true` is returned.
- Given `npm test`, `typecheck` and `depcheck`, then all pass, including the comment-hygiene guard.

## Spec Change Log

## Design Notes

`Probed<T> = {ok:true;value:T} | {ok:false;error:{code;message}}` keeps field-level errors JSON-serialisable (a `Result` stays the use-case's outer type). Service identity: `{service, path}`. Members whose manifest fails to load still produce a row (service = member topic path basename from `EdtMember.service`).

## Verification

**Commands:**
- `npm test` -- expected: all green
- `npm run typecheck` -- expected: no errors
- `npm run depcheck` -- expected: no violations
