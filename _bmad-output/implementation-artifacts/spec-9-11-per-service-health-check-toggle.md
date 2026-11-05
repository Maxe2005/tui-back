---
title: 'Per-Service Health Check Toggle'
type: 'feature'
created: '2026-11-05'
status: 'done'
baseline_commit: '1f3f31e9d184955db8c6e00e4411180946d5369a'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A slow or meaningless `healthUrl` on a developer's machine makes a service look `unhealthy`/`down` or slows every poll, and there is no way to opt out short of editing the shared manifest.

**Approach:** Add a local setting `services.healthCheckDisabled: string[]` (manifest `service` names). The AD-23 resolver reads it through an optional `isHealthCheckEnabled(manifest)` dependency and, when disabled, resolves as if no `healthUrl` existed, marked `healthCheck: 'disabled'`. A new last **Services** tab in `:settings` toggles it per service.

## Boundaries & Constraints

**Always:**
- `core/service-status` is the only reader of the decision: consumers (snapshot, slices, CLI) only wire `isHealthCheckEnabled` into resolver deps; `verifyService` receives the same dep and applies the same gate. Absent dep = enabled.
- The dep reads live settings at call time (TUI: `get().settings`; CLI: settings loaded per command, defaults + stderr warning on failure), so a toggle applies at the next poll/refresh without restart.
- `healthCheck: 'disabled'` is set only when the manifest declares `healthUrl` and the dep returns false.
- Settings: port type + `DEFAULT_SETTINGS` (`[]`), zod `z.array(z.string()).optional().default(...)`, `settings-slice.updateSettings` merges `services`. Corrupt value → existing whole-file default fallback with the field-naming warning. Unknown names kept and ignored.
- Services tab: last in `SETTINGS_TABS`, rendered through `BoundedList` (AD-19), footer from a new `settings-services` keybinding context; toggling persists immediately.
- Dashboard `health check off` is dim and is NOT an issue (does not trigger the issue marker nor replace `No issue.` semantics for real issues).

**Ask First:** changing `HealthProbePort`, `DockerPort`, the manifest schema or `ServiceFinalState`; a per-field (instead of whole-file) settings fallback.

**Never:** a consumer checking `healthCheckDisabled` itself; implementing heal (9.8 — it will inherit the gate through the resolver); new dependencies; editing the manifest.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output |
|---|---|---|
| Disabled, container up | in list, `healthUrl`, container `up` | `up`, `verified:false`, `healthCheck:'disabled'`, probe never called |
| Disabled, container down/restarting | same, container `down`/`restarting` | `down`/`restarting`, `healthCheck:'disabled'` |
| Disabled, container-less | in list, `healthUrl`, no container | `no-container`, `healthCheck:'disabled'` |
| Disabled, no healthUrl | in list, no `healthUrl` | unchanged no-healthUrl result, no `healthCheck` field |
| Not in list | any | identical to Story 9.7 |
| Disabled verify | restart then `verifyService` | no probe, no `verification-unavailable`; started container → `up-unverified` |
| Settings corrupt | `healthCheckDisabled: 3` | defaults + warning naming `services.healthCheckDisabled` |

</frozen-after-approval>

## Code Map

- `src/core/service-status/index.ts` -- `ServiceStatus` L17-28 (add `healthCheck?: 'disabled'`), `ServiceStatusDeps` L39-44, `hasHealthUrl` L52, `combineStatus` L62-94, `resolveManifestStatus` L97-100 (main entry; gate here), `resolveServiceStatus` L102, `readProbe` L118-132. Tests: `index.test.ts` (`deps()` helper, `vi.fn` fakes).
- `src/core/service-actions/index.ts` -- `ServiceActionsDeps` L55-67; `verifyService` L272-330: `verification-unavailable` guard L288-290 and per-attempt probe L296-300 must both honour the gate.
- Verify wiring: `tui/store/slices/edt-slice.ts:228-240`, `realign-slice.ts:107-120`, `cli/subcommands.ts:974-983` (settings already loaded L972) and `:1098-1107` (`settings()` loader L1075-1085). These `createServiceActions` calls sit outside `(set,get)` → pass a late-bound closure.
- Status wiring: `core/dashboard/snapshot.ts` params L73-82 → `readService` L165-181 → `readStatus` L214-226; `dashboard-slice.ts:265`; `logs-slice.ts` `statusPorts` L219 (outside `get`), `recordProbeOnly` L220-226 + L292-297 (a disabled container-less row must become `no-container`), polls L298/L421; `update-slice.ts:382-385`; CLI `dashboard` `subcommands.ts:191-205` (settings load-with-warning pattern L241-250).
- Settings: `src/core/ports/settings.ts` (`Settings` L34-127, `DEFAULT_SETTINGS` L133-146, arrays like `edts.hiddenActionTypes` L56-59); `adapters/driven/settings/schema.ts` (`.strict()` groups, array pattern L62/L67); `adapters/driven/settings/index.ts:55-63` (fallback); `store/slices/settings-slice.ts` (`SettingsUpdate` L11-21, `updateSettings` next-object L73-82).
- Settings screen `shared/settings-screen.tsx`: `SettingsTab` L48, `SETTINGS_TABS` L50, labels L52-59, `settingsFooterContext` L483-505 (exhaustive), shared-types flat-tab model (rows L61-77, resolver L90-115, input L702-712, render L1015-1034), `toggleHiddenHint` L356, `BoundedList` usage L1255-1268, `edtsBranches`/`edtsErrors` sources L567/L591. `CheckboxListItem` has no disabled state.
- `src/core/edt/list.ts:20` `ServiceBranchDivergence` -- no `healthUrl`; manifest failures go to `edtsErrors` (list.ts L108-114).
- `keybindings/footer-contexts.ts:357-368` -- model for `settings-services`.
- Dashboard: `dashboard.logic.ts` `reasonParts` L101-127 (drives `issueMarker` L129-131), `reasonLine` L145-148; `dashboard-body.tsx` `ServiceDetail` L110-134.
- CLI JSON: `cli/envelope.ts` stringifies `ServiceStatus` verbatim.
- Docs: `docs/tui-back-manifest.md` toggle paragraph L171-176 already written; CLI `dashboard` field list L430-440 lacks `healthCheck`; `.claude/skills/manifest-generator/SKILL.md:55`.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/service-status/index.ts` (+test) -- add `healthCheck?`, `isHealthCheckEnabled?` dep, gate in `resolveManifestStatus`; export a small pure helper (e.g. `isProbeEnabled(deps, manifest)`) reused by `verifyService`. Test every matrix row, asserting the probe is not called.
- [x] `src/core/service-actions/index.ts` (+test) -- dep + gate on the L288 guard and per-attempt probe.
- [x] `src/core/ports/settings.ts`, `adapters/driven/settings/schema.ts`, `store/slices/settings-slice.ts` (+tests) -- new `services.healthCheckDisabled` group, default, schema, merge; corrupt-value warning test.
- [x] `src/core/dashboard/snapshot.ts` (+test) -- pass the dep to `resolveManifestStatus`.
- [x] Slices `dashboard-slice.ts`, `logs-slice.ts` (incl. `recordProbeOnly`), `update-slice.ts`, `edt-slice.ts`, `realign-slice.ts` (+tests) -- wire a live closure over `get().settings.services.healthCheckDisabled`.
- [x] `src/adapters/driving/cli/subcommands.ts` (+`dispatch.test.ts`) -- `dashboard`, `edt switch`, `realign` wire the dep from loaded settings; JSON shows `healthCheck:"disabled"`.
- [x] `src/core/edt/list.ts` -- add optional `healthUrl?: string` to `ServiceBranchDivergence` (copied from the manifest) to feed the tab.
- [x] `shared/settings-screen.tsx`, `shared/components/checkbox-list-item.tsx`, `keybindings/footer-contexts.ts` (+tests) -- Services tab: rows from `edtsBranches` (disabled `no healthUrl` when absent) + `edtsErrors` (disabled `manifest unavailable`), Space toggles via `toggleHiddenHint`-style add/remove, disabled rows ignore Space; `CheckboxListItem` gains a `disabled`+dim-reason variant.
- [x] `zones/dashboard/dashboard.logic.ts`, `dashboard-body.tsx` (+tests) -- separate dim `health check off` note rendered after/instead of `No issue.`, kept out of `reasonParts`.
- [x] `docs/tui-back-manifest.md` (CLI field list), `.claude/skills/manifest-generator/SKILL.md:55` -- mention `healthCheck` field and the local toggle.

**Acceptance Criteria:**
- Given the Services tab, when Space is pressed on an enabled row, then the checkbox unchecks, the setting is saved, and the next Dashboard refresh/Logs poll resolves that service without probing.
- Given a disabled service focused on the Dashboard, then the detail shows dim `health check off` and no issue marker unless another issue exists.
- Given `grep -rn healthCheckDisabled src --include=*.ts* | grep -v test`, then hits are limited to settings port/schema/slice, the settings screen, and the dep-wiring closures.
- Given `npm test && npm run typecheck && npm run depcheck`, then all pass.

## Design Notes

- **Service list source:** reusing `edtsBranches`/`edtsErrors` (already loaded for the settings Logs tab) avoids a new loader; only `healthUrl` is missing from the row type.
- **Fallback:** the settings loader already falls back whole-file with a warning naming the first bad field — that is "the usual field-naming warning"; no per-field `.catch`.

## Verification

**Commands:**
- `npm test && npm run typecheck && npm run depcheck` -- expected: all green, including bounds and keybinding guard tests.

## Suggested Review Order

**Resolver gate (single reader of the decision)**

- Entry point: disabled → probe skipped, result marked `healthCheck: 'disabled'` only with a `healthUrl`.
  [`index.ts:120`](../../src/core/service-status/index.ts#L120)

- Shared gate; absent or throwing dep counts as enabled so errors never hide probes.
  [`index.ts:65`](../../src/core/service-status/index.ts#L65)

- New optional status field carried verbatim into the CLI JSON.
  [`index.ts:30`](../../src/core/service-status/index.ts#L30)

**Post-restart verification**

- Same gate: no `verification-unavailable`, no probe, started container → `up-unverified`.
  [`index.ts:294`](../../src/core/service-actions/index.ts#L294)

**Setting & live wiring**

- One predicate over a live settings getter, reused by every slice and CLI command.
  [`settings.ts:161`](../../src/core/ports/settings.ts#L161)

- Schema: list defaults to empty; bad value → whole-file fallback naming the field.
  [`schema.ts:178`](../../src/adapters/driven/settings/schema.ts#L178)

- edt/realign services are built before the store: late-bound getter.
  [`edt-slice.ts:241`](../../src/adapters/driving/tui/store/slices/edt-slice.ts#L241)

- Dashboard refresh reads the toggle at call time.
  [`dashboard-slice.ts:269`](../../src/adapters/driving/tui/store/slices/dashboard-slice.ts#L269)

- Logs and Update polls wired the same way.
  [`logs-slice.ts:238`](../../src/adapters/driving/tui/store/slices/logs-slice.ts#L238)

**Services settings tab**

- Rows from loaded EDT branches plus manifest errors, with disabled reasons.
  [`settings-screen.tsx:77`](../../src/adapters/driving/tui/shared/settings-screen.tsx#L77)

- Tab loads the service list itself when nothing has loaded it yet.
  [`settings-screen.tsx:656`](../../src/adapters/driving/tui/shared/settings-screen.tsx#L656)

- Space toggles from live store state and persists immediately.
  [`settings-screen.tsx:787`](../../src/adapters/driving/tui/shared/settings-screen.tsx#L787)

- EDT rows now carry the manifest `healthUrl` to drive `no healthUrl`.
  [`list.ts:42`](../../src/core/edt/list.ts#L42)

- Disabled checkbox variant: `[-]` box and dim reason.
  [`checkbox-list-item.tsx:14`](../../src/adapters/driving/tui/shared/components/checkbox-list-item.tsx#L14)

- Footer context generated from keybinding declarations.
  [`footer-contexts.ts:369`](../../src/adapters/driving/tui/keybindings/footer-contexts.ts#L369)

**Dashboard note**

- Dim `health check off`, kept out of issue reasons so no issue marker.
  [`dashboard.logic.ts:155`](../../src/adapters/driving/tui/zones/dashboard/dashboard.logic.ts#L155)

- Rendered after real issues or in place of `No issue.`.
  [`dashboard-body.tsx:117`](../../src/adapters/driving/tui/zones/dashboard/dashboard-body.tsx#L117)

**Docs & tests**

- CLI `dashboard` JSON documents the `healthCheck` field.
  [`tui-back-manifest.md:438`](../../docs/tui-back-manifest.md#L438)

- Skill notes the local opt-out never justifies omitting `healthUrl`.
  [`SKILL.md:55`](../../.claude/skills/manifest-generator/SKILL.md#L55)

- Matrix rows, each asserting the probe is never called.
  [`index.test.ts:151`](../../src/core/service-status/index.test.ts#L151)
