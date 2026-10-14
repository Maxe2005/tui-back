---
title: 'shared-types Zone: Configurable Default Options & Busy Tab Indicator'
type: 'feature'
created: '2026-10-14'
status: 'in-review'
baseline_commit: 'e8f4b7af5c281863a535d7b8b86602ebdb64ad08'
review_loop_iteration: 0
context: [_bmad-output/implementation-artifacts/epic-4-context.md]
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The st zone's three option checkboxes are hard-coded (`install` on, `cleanRestart` off, `commit` on), so the developer re-ticks them every run; and while a publish or propagation runs, nothing on the tab bar says so once another zone is active.

**Approach:** A new `sharedTypes` settings group (zod defaults = today's hard-coded values) and a new st tab in `:settings` seed the zone's option toggles. The st tab gets the same busy badge as the Update tab through a generic per-zone `busy` prop on `ZoneTabBar`, fed from a store-level `sharedTypesBusy` flag.

## Boundaries & Constraints

**Always:** Defaults unchanged until the developer edits them. Toggling in the zone affects only that run (never writes settings). Settings fields are optional-with-default in the zod schema (older `settings.yaml` stays valid). The st settings tab is a flat Up/Down row list with `Space` toggles, built so Story 4.6 can append `historyDepth` / `maxCommitsScanned` rows. Badge glyphs/colours are reused from `resolveZoneTabState`, shown even while st is active. The Update tab's badge behaviour is unchanged. Blocked = attention state `◐ 1 awaiting you` (already supported by the component) when a run or publish is `blocked`; running = `⇄ updating`; idle/done = no badge.

**Ask First:** None.

**Never:** No "propagate after publish" default: the publish-done step is a chain key, not a choice, so there is nothing to default. No 4.6 settings fields now. No change to publish/propagate logic or the manifest.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fresh install | no `sharedTypes` key in settings.yaml | zone opens with install on, cleanRestart off, commit on | N/A |
| Custom defaults | settings: install off, cleanRestart on | zone toggles pre-set so; ticking one only changes this form | N/A |
| Run in flight | `sharedTypesRun` or `sharedTypesPublish` `running`, Update tab/other zone active | st tab shows `⇄ updating` (accent-inverted when st active) | N/A |
| Run blocked | run or publish `blocked` | st tab shows `◐ 1 awaiting you` | N/A |
| Run done / idle | status `done` or `idle` | no badge (other than normal event dot) | N/A |

</frozen-after-approval>

## Code Map

- `src/core/ports/settings.ts` -- `Settings` + `DEFAULT_SETTINGS`: add `sharedTypes: { install, cleanRestart, commit }`.
- `src/adapters/driven/settings/schema.ts` -- zod group, strict, optional-with-default (pattern: `update` block ~l.77).
- `src/adapters/driving/tui/store/slices/settings-slice.ts` -- `SettingsUpdate` gains `sharedTypes?`.
- `src/adapters/driving/tui/shared/settings-screen.tsx` -- `SettingsTab`/`SETTINGS_TABS`/`SETTINGS_TAB_LABELS` (l.38-47), `settingsFooterContext` (~l.344), General-tab row-list pattern (`resolveGeneralSettingsKey` l.155-230, key branch ~l.526) to copy for a `shared-types` tab labelled `st`; footer context id likely needs a new entry.
- `src/adapters/driving/tui/zones/shared-types/shared-types-zone.logic.ts:29` -- `initialFormState()` takes the default options; `shared-types-zone.tsx:95` passes `settings.sharedTypes`, re-seeds options when those settings change.
- `src/adapters/driving/tui/store/slices/shared-types-slice.ts` -- add `sharedTypesBusy` derivation (running → busy; blocked → attention count) from `sharedTypesRun.status`/`sharedTypesPublish.status`.
- `src/adapters/driving/tui/shared/components/zone-tab-bar.tsx` -- replace `updateRunning`/`updateIncidents` with a per-zone `busy: Partial<Record<ZoneId, {incidents:number}>>` map; `resolveZoneTabState` unchanged.
- `src/adapters/driving/tui/app-shell.tsx:164,402` -- build the map from update + shared-types state.
- `docs/` -- no settings doc found (grep for `concurrency`/`filterHistoryDedup` empty): none to update.

## Tasks & Acceptance

**Execution:**
- [x] `settings.ts`, `schema.ts`, `settings-slice.ts` -- `sharedTypes` group, defaults, schema, update type -- tests incl. old-file-without-key
- [x] `shared-types-zone.logic.ts`, `shared-types-zone.tsx` -- seed options from settings -- logic + zone tests
- [x] `settings-screen.tsx` -- `st` tab with three checkboxes, footer context -- screen/logic tests
- [x] `shared-types-slice.ts`, `zone-tab-bar.tsx`, `app-shell.tsx` -- `sharedTypesBusy`, generic `busy` map -- update existing tab-bar/app-shell/update tests, add st cases

**Acceptance Criteria:**
- Given `:settings`, when the st tab is opened, then the three options show their saved state and `Space` toggles and persists each.
- Given customised defaults, when the zone opens, then toggles are pre-set; ticking one in the zone leaves settings untouched.
- Given a publish/propagation running, when any zone is active, then the st tab carries the same badge as Update; it vanishes on done and becomes `◐ 1 awaiting you` on blocked.
- Given an update running, then the Update tab renders exactly as before.

## Verification

**Commands:**
- `npm test` -- expected: all pass
- `npm run typecheck` -- expected: no errors
