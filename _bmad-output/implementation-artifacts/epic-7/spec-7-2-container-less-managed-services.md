---
title: 'Story 7.2: Container-less Managed Services (FR-29)'
type: 'feature'
created: '2026-10-05'
status: 'done'
baseline_commit: 'cccf0d7758238a0da9663fbf41a5875d9a3eb404'
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A managed repo must declare a Docker `container` today (`Manifest.container: string`, zod `min(1)`), so libraries and non-dockerized services (e.g. `shared-types`) cannot be registered, updated, or shown without faking a container name.

**Approach:** Make `container` optional end to end: manifests without it validate and register; group update runs pull/merge and migrations normally and skips only the restart phase (or runs the clean-restart recipe); every health/logs/restart surface shows an explicit "no container" state and never touches Docker for such a service.

## Boundaries & Constraints

**Always:** Make the type optional first and let `tsc` enumerate every dereference; every core use-case returns `Result<T>` with kebab-case codes; `ContainerPort`/`DockerPort` are never called with an empty or absent name; AD-17 comment rule (short present-tense headers, no story references); imports stay first in each file; branch `story-7-2-container-less-managed-services` from `epic-7-tui-consistency-dashboard-code-hygiene`, conventional commits with `(story 7.2)`; verify with `npm test && npm run typecheck && npm run depcheck`.

**Ask First:** TTY rendering of a null container (generic envelope prints JSON `null`, not `—`, see Design Notes); whether to create a `service-restart` CLI subcommand (none exists today — recommendation: no, keep the `no-container` contract at core/TUI level only).

**Never:** Add a `service-restart` CLI subcommand unless the human picks it; widen `DockerPort`/`HealthState` in core (the "no container" display state stays TUI-side); add per-command TTY formatting (the envelope stays generic); touch Dashboard summary (Story 7.5) or the zone-layout contract (Story 7.3); change any git/migration behavior.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Register without container | manifest omits `container` | validates, repo registers like any other | N/A |
| Empty container | `container: ""` | rejected | validation error naming the field |
| Explicit null container | `container: null` | rejected | validation error naming the field (skill omits the key instead) |
| Update, recipe declared | container-less, `cleanRestart` on, `restartCommands` non-empty | recipe runs in order; success → `updated` | recipe failure → `failed`/`restart-failed`, same as today |
| Update, no recipe | container-less, `cleanRestart` off or no `restartCommands` | `skipped` with `no container` detail | never `failed`; `ContainerPort.restart` never called |
| Standalone restart, no recipe | container-less via `serviceRestart` | `failed` row with code `no-container` | TUI hides plain restart for such services |
| List repos | registry contains a container-less repo | `container: null` in JSON data | N/A |
| Logs select | container-less service selected | no subscription, pane shows "No container — no logs"; restart control absent | N/A |
| Health badges | Update zone, Logs zone, any badge | dim glyph + "no container" text, never "down" | docker never polled for the service |

</frozen-after-approval>

## Code Map

- `src/core/ports/manifest.ts:6-16` -- `Manifest.container: string` becomes `container?: string`.
- `src/adapters/driven/manifest/schema.ts:12-16` -- `container: z.string().trim().min(1)` gains `.optional()`; absent → `undefined`.
- `src/core/scripts/list-repos.ts:9-15,55-61` -- `ManagedRepo.container: string` becomes `string | null`; map `undefined` → `null`.
- `src/core/scripts/group-update.ts:526-566` (`RestartStepInput`, `runRestartStep`) -- `containerName: string | undefined`; recipe branch unchanged; absent container with no applicable recipe returns `err('no-container', ...)` without calling the port.
- `src/core/scripts/group-update.ts:807-814` (restart phase in `updateWithLoadedManifest`) -- map the `no-container` error to a `skipped` row (detail names the repo), not `failed`.
- `src/core/scripts/service-restart.ts:55-65` -- passes `containerName` through (always `cleanRestart: true`); `no-container` propagates as the `failed` row code.
- `src/core/logs/use-cases.ts` -- unchanged (params keep `container: string`); slices guard before calling.
- `src/adapters/driving/tui/store/slices/logs-slice.ts:195-213,283-337,340-407,434-452` -- `pollPaneHealth`, `subscribeLogsPane`, `restartLogsPane`, `loadOlderLogsPane`: when the loaded manifest has no container, set the pane's no-container state and return before any docker/manager call; no health timer for such panes.
- `src/adapters/driving/tui/store/slices/update-slice.ts:235-254,859-949` -- `pollServiceHealth` skips docker and records no-container; `runServiceRestart` path honors the core `no-container` failure; plain-restart menus hide it, clean restart offered only with declared `restartCommands`.
- `src/adapters/driving/tui/zones/update/update-zone.logic.ts:18-30` + `src/adapters/driving/tui/zones/logs/logs-zone.logic.ts:11-15` -- badge mapping for the new TUI-side `no-container` state (dim glyph + text, never the down treatment).
- `.agents/skills/manifest-generator/SKILL.md` + `assets/template.md` -- omit `container` when no compose service matches instead of emitting `null`.
- `src/core/edt/create.ts:172-174` -- placeholder manifest keeps a `container` value (still valid under the optional schema); no change needed unless typecheck says otherwise.
- Tests: `src/adapters/driven/manifest/index.test.ts` (omit/empty/null cases), `src/core/scripts/group-update.test.ts` (skip + recipe paths), `src/core/scripts/service-restart.test.ts` (`no-container`), `src/core/scripts/list-repos.test.ts` (`null`), slice tests for the guards.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/ports/manifest.ts` -- make `container` optional -- unlocks every layer via typecheck.
- [x] `src/adapters/driven/manifest/schema.ts` -- accept absent `container`, keep rejecting empty/null -- manifests validate.
- [x] `src/core/scripts/list-repos.ts` -- expose `container: string | null` -- CLI JSON carries `null`.
- [x] `src/core/scripts/group-update.ts` -- recipe-or-skip restart for absent container; `skipped` row with `no container` -- update never fails on it.
- [x] `src/core/scripts/service-restart.ts` -- propagate `no-container` as the failed-row code -- TUI has a stable contract.
- [x] `src/adapters/driving/tui/store/slices/logs-slice.ts` -- no-container pane state, no subscribe/poll/restart -- Logs zone degrades explicitly.
- [x] `src/adapters/driving/tui/store/slices/update-slice.ts` -- no-container health + restart gating -- Update/EDT actions degrade explicitly.
- [x] TUI zone logic + badges -- render the dim "no container" state -- never shown as "down".
- [x] `.agents/skills/manifest-generator/` -- omit `container` when undetectable -- generated manifests load.
- [x] Tests for every I/O-matrix row -- locks FR-29 behavior per layer (AD-13).
- [ ] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- `7-2-container-less-managed-services: in-progress` → `done` on completion.

**Acceptance Criteria:**
- Given a manifest without `container`, when loaded, then it validates and the repo registers, updates, and displays like any other except for container-dependent phases.
- Given any group update including a container-less service, when the restart phase is reached, then the recipe runs if asked and declared, else a `skipped` row with `no container` — never `failed`, and `ContainerPort.restart` is never called (assert via fake port in tests).
- Given the Logs zone with a container-less service selected, when rendered, then no subscription exists and the pane shows the explicit no-container state with no restart control.
- Given any health surface, when showing a container-less service, then it shows the dim no-container state and docker is never polled for it.

## Design Notes

TTY rendering: the CLI envelope (`adapters/driving/cli/envelope.ts`) is generic — TTY prints pretty JSON, so `container: null` surfaces as `"container": null`, not `—`. Rendering `—` would need per-command human formatting, which the envelope deliberately avoids. Recommendation: accept `null` on both branches (deviation from the proposal's `—`, recorded here); the JSON contract is what scripts consume.

## Verification

**Commands:**
- `npm test` -- expected: all pass, including the new omit/empty/null, skip, recipe, and slice-guard tests.
- `npm run typecheck` -- expected: clean; every missed dereference surfaces here first.
- `npm run depcheck` -- expected: clean; no new cross-layer imports (imports stay first per file).

## Suggested Review Order

**Core contract: optional container, skip-not-fail restart**

- Restart step returns `no-container` without touching the port; recipe still runs when declared
  [`group-update.ts:556`](../../../src/core/scripts/group-update.ts#L556)

- The `no-container` error maps to a `skipped` row, never `failed`
  [`group-update.ts:814`](../../../src/core/scripts/group-update.ts#L814)

- `container` becomes optional on the Manifest port
  [`manifest.ts:8`](../../../src/core/ports/manifest.ts#L8)

- Schema accepts absence, still rejects empty and null
  [`schema.ts:16`](../../../src/adapters/driven/manifest/schema.ts#L16)

- Missing or blank container surfaces as `null` in list data
  [`list-repos.ts:57`](../../../src/core/scripts/list-repos.ts#L57)

**TUI degradation: explicit state, Docker never polled**

- Health poll records no-container without reaching Docker
  [`update-slice.ts:252`](../../../src/adapters/driving/tui/store/slices/update-slice.ts#L252)

- Menu asks the store, never a driven port, whether restart applies
  [`update-slice.ts:877`](../../../src/adapters/driving/tui/store/slices/update-slice.ts#L877)

- Subscribe path degrades before any timer, stream, or poll starts
  [`logs-slice.ts:312`](../../../src/adapters/driving/tui/store/slices/logs-slice.ts#L312)

- Dim badge entry shared by every no-container surface
  [`status-badge.tsx:44`](../../../src/adapters/driving/tui/shared/components/status-badge.tsx#L44)

- Restart row drops from the menu when no restart exists
  [`update-service-menu-dialog.tsx:21`](../../../src/adapters/driving/tui/zones/update/update-service-menu-dialog.tsx#L21)

**Peripherals**

- Skill template comments out `container` instead of emitting `null`
  [`template.md`](../../../.agents/skills/manifest-generator/assets/template.md)

- Black-box CLI asserts `container: null` in the JSON envelope
  [`tui-back.e2e.test.ts:346`](../../../src/bin/tui-back.e2e.test.ts#L346)
