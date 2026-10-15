# Epic 4 Context: `shared-types` Propagation & Smart Update

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A developer can propagate a `shared-types` version to the active EDT's consuming services, publish new versions, and let a group update handle `shared-types` automatically (publish, propagate, commit, conflict resolution), so bumping the dependency is never a manual task. This is the first company-specific module and validates the generic-core/module split.

## Stories

- Story 4.1: `shared-types` Modules & Manifest Parameters
- Story 4.2: Propagate a Version to Chosen Services
- Story 4.3: Publish a New `shared-types` Version
- Story 4.4: Smart Group Update — `shared-types` First
- Story 4.5: Auto-Resolve `shared-types`-Only Merge Conflicts
- Story 4.6: `shared-types` Version History Library (real-time branch & commit search)
- Story 4.7: `shared-types` Zone — Configurable Default Options & Busy Tab Indicator

## Requirements & Constraints

- Publishing runs a configurable command with per-step progress, resumes from the failed step, and is verified on the npm registry; it is only offered when the active EDT includes the source repo.
- Propagation rewrites only the dependency line of `package.json`, then optionally `npm i`, clean restart, and a commit of `package.json` + `package-lock.json` only. Nothing is ever pushed.
- A group update can process `shared-types` first, then publish, propagate and commit per an update-configuration setting. Merge conflicts limited to the `shared-types` dependency line are auto-resolved.
- Auto-resolution applies only when the sole conflicting hunk in `package.json` is the `shared-types` dependency line: it takes the EDT's value, runs `npm i`, takes the lockfile from the EDT side (regenerated, not hunk-merged), and completes the merge. Any other conflict falls through untouched to assisted resolution. The outcome is shown per service in run tracking.
- A failure in the `shared-types` phase of a group update pauses the run with a choice (retry, skip `shared-types` handling, abort) rather than silently updating the rest.
- The version history library (4.6) is bounded by `historyDepth` and `maxCommitsScanned` settings; both live in the `:settings` st tab (`sharedTypes` group) that 4.7 hosts.
- Zone option defaults (`Run npm i`, `Clean restart`, commit) come from settings (zod defaults: install on, cleanRestart off, commit on); changing a toggle in the zone affects only that run.
- The st tab shows the same busy badge as the Update tab while publishing/propagating (even when active); a store flag `sharedTypesBusy` feeds a generic per-zone `busy` map on `ZoneTabBar`.

## Technical Decisions

- Manifest modules `shared-types-source` (defaults `publishCommand: "npm run v"`, `packageName: "@ianord/shared-types"`) and `shared-types-consumer` (defaults `dependency: "@ianord/shared-types"`, `packageJsonPath: "package.json"`). All parameters are optional, unknown ones are rejected, and module ids are kebab-case.
- Modules are statically registered in the compiled-in module registry. `ModuleImplementation` is a discriminated union on `kind`; `shared-types` exposes a `SharedTypesPort` (read declared version, rewrite only the dependency line via targeted text edit with no JSON re-serialisation, verify version on the registry).
- Core code never names `shared-types`. It receives the port via the manifest module. Code lives in `adapters/driven/modules/shared-types`, `core/ports/shared-types.ts` and `tui/shared-types/`.
- Every git write goes through the git adapter's branch-scope safety gate. Consumer commits stage exactly `package.json` and `package-lock.json`.
- Services may have no container. Source and consumers must be accepted as EDT members without one.
- Clean restart uses the manifest `restartCommands` recipe through `RestartPort`.
- Tab gating (`core/edt/resolve-tab-visibility.ts`) already shows, omits or disables the `shared-types` tab from `shared-types-source` / `shared-types-consumer` module ids.

## UX & Interaction Patterns

- The zone has an explicit no-members state, a version field pre-filled with `0.1.`, and a consumer checklist.
- Options (`npm i`, clean restart, commit) are independent toggles.
- Per-service result, skip reason and independent retry.
- Publish shows per-step status with a spinner and failure detail with resume.
- Quitting mid-run requires confirmation.
- The update configuration gains a `shared-types` row: off / publish if the merge changed something / always.

## Cross-Story Dependencies

- Prerequisite: Epic 7 done (container-less services, layout, interaction audit).
- Stories 4.4 and 4.5 additionally need Epic 3 merged into `devlopment` (update configuration, run tracking, assisted conflict resolution).
- 4.1 provides the port/modules used by 4.2 to 4.6. 4.3 chains into 4.2. 4.4 reuses 4.3 and 4.2. 4.6 jumps into 4.2. 4.7 edits the zone from 4.2/4.3 and hosts 4.6's settings; build order 4.3 -> 4.7 -> 4.6.
