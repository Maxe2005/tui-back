---
title: 'Global Settings Screen (`:settings`)'
type: 'feature'
created: '2026-08-26'
status: 'done'
review_loop_iteration: 0
baseline_commit: '673e418657e941e04938eb70a95c48e7582e5b48'
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/implementation-artifacts/epic-2/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Two tunables — Story 2.17's command-grid row cap and Story 2.18's per-service action-hint visibility — are only reachable as code constants, and the tool has no discoverable, persisted place for developer preferences; every future tunable would otherwise need its own bespoke UI and storage tier.

**Approach:** Add a `settings` command opening a tab-organized `modal-dialog` (General / EDTs / Command Palette), backed by a new `SettingsPort` (zod-validated, mirrors the manifest/registry adapters' shape) persisted at `XDG_CONFIG_HOME/tui-back/settings.yaml`; every change applies to the live store and persists to disk immediately, no separate save step.

## Boundaries & Constraints

**Always:** Reachable only via the registered `settings` command in the `:` bar, never a raw keypress (mirrors `registry`, Story 2.14). Every change writes to `settings.yaml` immediately and updates the store optimistically. A corrupt/invalid `settings.yaml` falls back to every default and surfaces a non-blocking warning, never a crash (mirrors the manifest's per-field zod-error convention). `Left`/`Right`/`Tab` cycles General/EDTs/Command Palette, visually mirroring `zone-tab-bar.tsx`'s active/inactive treatment at a smaller scale. `Esc` closes with nothing to discard. Every action reachable keyboard-only (Story 1.9).

**Ask First:** If, at implementation time, Story 2.17's `COMMAND_GRID_MAX_ROWS` constant or Story 2.18's per-context hint-token line are not yet landed in `command-bar.tsx`/`edts-zone.tsx`, halt and ask whether to stub those two tabs' live-wiring (settings still save/load, just without an observable downstream effect) or wait for those stories.

**Never:** No new `ZoneId`/7th tab — this is an overlay like `repo-registry-screen.tsx`/`command-bar.tsx`, not a zone. Don't touch `registry.yaml` or any EDT/global SQLite store. No CLI subcommand for settings in this story (TUI-only surface).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open | `:settings` + Enter | Modal opens on General tab | N/A |
| Adjust grid rows | `Up`/`Down` or typed digit on Command Palette tab | Value updates live (command bar's grid) + persists | N/A |
| Toggle hidden hint | `Space` on an EDTs-tab checkbox row | Hint token hidden immediately from the EDT detail pane + persists | N/A |
| Restart | Tool relaunched after a change | Prior values load from `settings.yaml`, not defaults | N/A |
| Corrupt file | `settings.yaml` fails zod parse on load | Every setting falls back to default | Non-blocking warning surfaced, never a crash |
| Missing file | `settings.yaml` absent (first run) | Defaults used silently | N/A |

</frozen-after-approval>

## Code Map

- `src/core/ports/settings.ts` (new) -- `Settings` model (`{ commandPalette: { gridMaxRows: number }, edts: { hiddenActionHints: string[] } }`) + `SettingsPort` (`load`/`save`) -- mirrors `core/ports/manifest.ts`'s shape exactly
- `src/adapters/driven/settings/index.ts` (new) -- YAML load/save at `settings.yaml`; on missing file returns defaults (ok); on invalid YAML/zod failure returns defaults plus a non-fatal warning message (not an `err` Result — never blocks screen open); mirrors `adapters/driven/registry/index.ts`'s read/parse/validate flow (`listRegistry`, lines 45-73) and `ensureXdgDir` usage
- `src/adapters/driven/settings/schema.ts` (new) -- zod `.strict()` schema with defaults, field-naming error message -- mirrors `adapters/driven/manifest/schema.ts`
- `src/adapters/driven/xdg/index.ts` -- reuse `resolveXdgPaths`/`ensureXdgDir` as-is; add `resolveSettingsFile(xdg)` helper alongside `resolveRegistryFile`'s sibling pattern (`adapters/driven/registry/index.ts:18-20`)
- `src/adapters/driving/tui/store/app-store.ts:56-66,123-268` -- add `settings: Settings`, `settingsWarning: string | null`, `loadSettings()`, `updateSettings(partial)` (optimistic set + persist), `settingsScreenOpen`/`openSettingsScreen`/`closeSettingsScreen` (mirrors `registryScreenOpen` triplet, lines 212-214); extend `AppStoreDeps` with `settings: SettingsPort`
- `src/adapters/driving/tui/commands/commands.ts` -- add `{ name: 'settings', run: (useStore) => useStore.getState().openSettingsScreen() }`, same shape as `registry`
- `src/adapters/driving/tui/shared/settings-screen.tsx` (new) -- `ModalDialog` with a small tab strip (reuses `resolveZoneTabState`-style pure function, new `resolveSettingsTabState`) + 3 tab bodies (General: empty placeholder text; Command Palette: numeric value + dim hint; EDTs: `CheckboxListItem` per hideable hint token)
- `src/adapters/driving/tui/shared/settings-screen.test.tsx` (new) -- mirrors `repo-registry-screen.test.tsx`'s pure-function-first convention
- `src/adapters/driving/tui/app-shell.tsx:114-126,188,192,231-233,252` -- wire `settingsScreenOpen` exactly like `registryScreenOpen`: mount conditionally, add to the global-shortcut gate, Esc-close
- `src/adapters/driving/tui/shared/command-bar.tsx` -- read grid row cap from `store.settings.commandPalette.gridMaxRows` in place of Story 2.17's `COMMAND_GRID_MAX_ROWS` constant (once that story has landed it)
- `src/adapters/driving/tui/zones/edts/edts-zone.tsx:273-302` (`formatEdtActionHistory`) -- filter the rendered hint-token(s) by `store.settings.edts.hiddenActionHints` (once Story 2.18 lands its per-context hint line; enumerate its actual token ids at implementation time rather than guessing here)
- `src/bin/tui.ts:80-105` -- composition root: `resolveSettingsFile(xdg)`, `createSettingsPort(settingsFile)`, pass into `createAppStore({ ...settings })`

## Tasks & Acceptance

**Execution:**
- [x] `src/core/ports/settings.ts` -- define `Settings`/`SettingsPort` -- typed contract core/adapter/store all share
- [x] `src/adapters/driven/settings/schema.ts` -- zod schema with defaults -- AD-4 validation convention
- [x] `src/adapters/driven/settings/index.ts` + test -- load/save, corrupt-file fallback+warning -- I/O matrix "Corrupt file"/"Missing file"
- [x] `src/adapters/driving/tui/store/app-store.ts` -- `settings` slice, screen open/close flags, optimistic update+persist -- AC3, I/O matrix "Restart"
- [x] `src/adapters/driving/tui/commands/commands.ts` + test -- `settings` command entry -- AC1, I/O matrix "Open"
- [x] `src/adapters/driving/tui/shared/settings-screen.tsx` + test -- tab strip + 3 tab bodies -- AC1, AC2, AC4
- [x] `src/adapters/driving/tui/app-shell.tsx` -- mount/gate/Esc-close wiring -- AC1, AC4
- [x] `src/adapters/driving/tui/shared/command-bar.tsx` -- consume `commandPalette.gridMaxRows` -- I/O matrix "Adjust grid rows"
- [x] `src/adapters/driving/tui/zones/edts/edts-zone.tsx` -- filter hint line by `edts.hiddenActionHints` -- I/O matrix "Toggle hidden hint"
- [x] `src/bin/tui.ts` -- composition-root wiring -- AC3

**Acceptance Criteria:**
- AC1 — Given the settings screen is open, when `Left`/`Right`/`Tab` is pressed, then focus cycles General → EDTs → Command Palette → General, visually matching the zone-tab bar's active/inactive treatment at a smaller scale.
- AC2 — Given the General tab, when viewed with zero settings defined, then it renders without error as a valid empty tab.
- AC3 — Given any setting change, when the tool is restarted, then the changed value (not the default) loads from `settings.yaml`.
- AC4 — Given the settings screen, when exercised via keyboard only, then every action (tab cycle, value adjust, checkbox toggle, close) is reachable without a mouse.

## Spec Change Log

<!-- Empty until the first bad_spec loopback. -->

## Design Notes

**Corrupt-file handling isn't an `err` Result:** unlike `registry`/`manifest`, a failed settings load must never block the screen from opening (Boundaries: "falls back... never a crash"). `SettingsPort.load` returns `Result<{ settings: Settings; warning: string | null }>` — `ok` even on a validation failure, with `settings` set to defaults and `warning` carrying the human-readable field-naming message; only a real I/O error (permission denied, etc.) is an `err`.

**EDTs-tab token list is Story 2.18's to define:** since 2.18 is not yet implemented, this story cannot enumerate exact hint-token ids ahead of it. At implementation time, read whatever per-context hint tokens 2.18's landed `formatEdtActionHistory` (or its replacement) actually emits, and build the checkbox list from that set — never invent placeholder ids.

## Verification

**Commands:**
- `npm test` -- expected: all new/updated suites (settings port+adapter, store slice, settings-screen, command-bar, edts-zone, app-shell) pass
- `npm run typecheck` -- expected: no errors, including the `AppStoreDeps` extension
- `npm run depcheck` -- expected: no boundary violations (`core/ports/settings.ts` has no adapter/fs imports; `adapters/driven/settings` is the only layer touching the filesystem for it)

## Suggested Review Order

**Settings model & shared bounds**

- Entry point: the `Settings` contract plus the [MIN, MAX] range shared by the zod schema and the screen's own clamp, so gridMaxRows can never drift between the two.
  [`settings.ts:12`](../../../src/core/ports/settings.ts#L12)

- Zod enforces the same upper/lower bound as the live UI clamp — a hand-edited `settings.yaml` with an out-of-range value now falls back to defaults instead of silently persisting.
  [`schema.ts:17`](../../../src/adapters/driven/settings/schema.ts#L17)

**Load/save adapter (the one genuinely novel I/O path)**

- `loadSettings`/`saveSettings` mirror the registry adapter's read/parse/validate flow; corrupt/invalid files are always `ok` with a warning, never an `err`.
  [`index.ts:31`](../../../src/adapters/driven/settings/index.ts#L31)

- `resolveSettingsFile`/`createSettingsPort` -- the XDG-path + port-factory pair the composition root wires in.
  [`index.ts:20`](../../../src/adapters/driven/settings/index.ts#L20)

**Store slice: optimistic update, serialized persistence, stale-load guard**

- `settingsSaveChain`/`settingsVersion` -- closure-scoped state added in the review-loop patch pass: serializes concurrent `updateSettings()` disk writes in request order, and lets `loadSettings()` detect it's been superseded.
  [`app-store.ts:307`](../../../src/adapters/driving/tui/store/app-store.ts#L307)

- `loadSettings()` captures its start version and discards a stale in-flight result rather than clobbering a newer optimistic update.
  [`app-store.ts:542`](../../../src/adapters/driving/tui/store/app-store.ts#L542)

- `updateSettings()` bumps the version, applies optimistically, then chains its `save()` onto the pending chain and clears `settingsWarning` on success.
  [`app-store.ts:563`](../../../src/adapters/driving/tui/store/app-store.ts#L563)

- `closeSettingsScreen()` also clears `settingsWarning` -- closing acknowledges a previously-surfaced warning instead of leaving it to linger.
  [`app-store.ts:238`](../../../src/adapters/driving/tui/store/app-store.ts#L238)

**Settings screen: tab strip, grid-rows control, hint checkboxes**

- `SettingsScreen` -- the modal's tab cycling, digit/arrow grid-rows editing, and checkbox hint-toggling, wired to the store slice above.
  [`settings-screen.tsx:132`](../../../src/adapters/driving/tui/shared/settings-screen.tsx#L132)

- `clampGridMaxRows`/`adjustGridMaxRows`/`parseGridMaxRowsDigit` -- pure functions behind the Command Palette tab, now bounded by the shared `MIN_GRID_MAX_ROWS`/`MAX_GRID_MAX_ROWS` re-exported from `core/ports/settings.ts`.
  [`settings-screen.tsx:78`](../../../src/adapters/driving/tui/shared/settings-screen.tsx#L78)

- `HIDEABLE_ACTION_HINTS`/`toggleHiddenHint`/`moveHintCursor` -- the EDTs tab's checkbox list over Story 2.18's actual hint tokens.
  [`settings-screen.tsx:99`](../../../src/adapters/driving/tui/shared/settings-screen.tsx#L99)

**Live downstream consumers**

- `command-bar.tsx` reads `store.settings.commandPalette.gridMaxRows` in place of the old constant -- confirms a Command Palette tab change is visibly live without restarting.
  [`command-bar.tsx:326`](../../../src/adapters/driving/tui/shared/command-bar.tsx#L326)

- `edts-zone.tsx` filters the rendered action hint by `store.settings.edts.hiddenActionHints` -- confirms an EDTs-tab checkbox toggle is visibly live.
  [`edts-zone.tsx:342`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L342)

**Wiring & composition root**

- `app-shell.tsx` mounts/gates/Esc-closes `SettingsScreen` exactly like `registryScreenOpen`, and loads settings once at mount.
  [`app-shell.tsx:259`](../../../src/adapters/driving/tui/app-shell.tsx#L259)

- `commands.ts`'s `settings` command entry -- the only way to reach the screen (never a raw keypress).
  [`commands.ts:40`](../../../src/adapters/driving/tui/commands/commands.ts#L40)

- `tui.ts` composition root -- `resolveSettingsFile`/`createSettingsPort` wired into `createAppStore`.
  [`tui.ts:102`](../../../src/bin/tui.ts#L102)

**Peripherals**

- New unit tests covering the serialized-save and stale-load-guard patches (`app-store.test.ts`) and the out-of-range `gridMaxRows` fallback (`index.test.ts`).
  [`app-store.test.ts:628`](../../../src/adapters/driving/tui/store/app-store.test.ts#L628)
