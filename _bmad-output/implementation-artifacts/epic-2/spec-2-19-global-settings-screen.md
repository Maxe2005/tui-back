---
title: 'Global Settings Screen (`:settings`)'
type: 'feature'
created: '2026-08-26'
status: 'in-progress'
review_loop_iteration: 0
baseline_commit: '6c8505b98f6a29fcfc6cc5bad7dfe60a134374af'
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/implementation-artifacts/epic-2/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Three tunables — Story 2.17's command-grid row cap, Story 2.18's per-service action-hint visibility, and which action types (`create`/`switch`/`modify`, Story 2.15) show in the EDT detail pane's "Recent actions" log — are only reachable as code constants (or not reachable at all), and the tool has no discoverable, persisted place for developer preferences; every future tunable would otherwise need its own bespoke UI and storage tier.

*(Amended 2026-08-28, Sprint Change Proposal: the third tunable — recent-action-type filtering — was the actual original ask for the "EDTs" tab; the first implementation round only captured hint-token visibility. Both are real and both are kept.)*

**Approach:** Add a `settings` command opening a tab-organized `modal-dialog` (General / EDTs / Command Palette), backed by a new `SettingsPort` (zod-validated, mirrors the manifest/registry adapters' shape) persisted at `XDG_CONFIG_HOME/tui-back/settings.yaml`; every change applies to the live store and persists to disk immediately, no separate save step.

## Boundaries & Constraints

**Always:** Reachable only via the registered `settings` command in the `:` bar, never a raw keypress (mirrors `registry`, Story 2.14). Every change writes to `settings.yaml` immediately and updates the store optimistically. A corrupt/invalid `settings.yaml` falls back to every default and surfaces a non-blocking warning, never a crash (mirrors the manifest's per-field zod-error convention). `Left`/`Right`/`Tab` cycles General/EDTs/Command Palette, visually mirroring `zone-tab-bar.tsx`'s active/inactive treatment at a smaller scale. Every action reachable keyboard-only (Story 1.9).

**Amended 2026-08-28 (Sprint Change Proposal):** the EDTs tab holds two distinct settings groups (hint visibility, recent-action-type visibility) behind a drill-down, since a single flat checkbox list would conflate two unrelated toggles. On first opening the EDTs tab: an Up/Down-navigable list of the two group names, `Enter` drills into a group's own `checkbox-list-item` list (Up/Down navigates its rows, `Space` toggles, same as before). `Esc`'s meaning is now tab-aware: at the EDTs tab with a group drilled into, `Esc` steps back up to the group list; everywhere else (General tab, Command Palette tab, or the EDTs tab's own group list) `Esc` closes the whole screen — still with nothing to discard, since every change already applied live. This supersedes the previous "`Esc` closes with nothing to discard" line as an unconditional rule; the underlying guarantee (no separate save step, so `Esc` is always safe) is unchanged, only how many `Esc` presses reach the actual close depends on depth.

**Ask First:** If, at implementation time, Story 2.17's `COMMAND_GRID_MAX_ROWS` constant or Story 2.18's per-context hint-token line are not yet landed in `command-bar.tsx`/`edts-zone.tsx`, halt and ask whether to stub those two tabs' live-wiring (settings still save/load, just without an observable downstream effect) or wait for those stories.

**Never:** No new `ZoneId`/7th tab — this is an overlay like `repo-registry-screen.tsx`/`command-bar.tsx`, not a zone. Don't touch `registry.yaml` or any EDT/global SQLite store. No CLI subcommand for settings in this story (TUI-only surface).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open | `:settings` + Enter | Modal opens on General tab | N/A |
| Adjust grid rows | `Up`/`Down` or typed digit on Command Palette tab | Value updates live (command bar's grid) + persists | N/A |
| Enter a settings group | `Enter` on the EDTs tab's group list ("Hint visibility" / "Recent action types") | Drills into that group's own checkbox list | N/A |
| Toggle hidden hint | `Space` on a "Hint visibility" checkbox row (drilled in) | Hint token hidden immediately from the EDT detail pane + persists | N/A |
| Toggle hidden action type | `Space` on a "Recent action types" checkbox row (drilled in) | That action type's entries hidden immediately from the "Recent actions" log + persists | N/A |
| Step back out of a group | `Esc` while a group is drilled into | Returns to the EDTs tab's group list; screen stays open | N/A |
| Restart | Tool relaunched after a change | Prior values load from `settings.yaml`, not defaults | N/A |
| Corrupt file | `settings.yaml` fails zod parse on load | Every setting falls back to default | Non-blocking warning surfaced, never a crash |
| Missing file | `settings.yaml` absent (first run) | Defaults used silently | N/A |

</frozen-after-approval>

## Code Map

**Delivered by the first round (unchanged, KEEP):**

- `src/core/ports/settings.ts` -- `Settings`/`SettingsPort`, `DEFAULT_SETTINGS`, shared `MIN_GRID_MAX_ROWS`/`MAX_GRID_MAX_ROWS`
- `src/adapters/driven/settings/index.ts` + `index.test.ts` -- YAML load/save, corrupt/missing-file fallback
- `src/adapters/driven/settings/schema.ts` -- zod `.strict()` schema with defaults and bounds
- `src/adapters/driving/tui/store/app-store.ts` -- `settings`/`settingsWarning`/`settingsScreenOpen` slice, `loadSettings()`/`updateSettings()` (serialized saves, stale-load guard), `openSettingsScreen`/`closeSettingsScreen`
- `src/adapters/driving/tui/commands/commands.ts` -- `settings` command entry
- `src/adapters/driving/tui/shared/settings-screen.tsx` + test -- tab strip, Command Palette tab, General tab
- `src/adapters/driving/tui/app-shell.tsx` -- mount/gate/Esc-close wiring for `settingsScreenOpen`
- `src/adapters/driving/tui/shared/command-bar.tsx` -- reads `store.settings.commandPalette.gridMaxRows`
- `src/adapters/driving/tui/zones/edts/edts-zone.tsx` -- `resolveActionHint`/`formatAvailableActionsHint` filter the rendered hint-token(s) by `store.settings.edts.hiddenActionHints`; `useInput` gated on `settingsScreenOpen`/`registryScreenOpen` (real-usage review fix, commit `6c8505b`)
- `src/bin/tui.ts` -- composition root: `resolveSettingsFile(xdg)`, `createSettingsPort(settingsFile)`, wired into `createAppStore`

**Amended 2026-08-28 (Sprint Change Proposal) -- new work:**

- `src/core/ports/settings.ts` -- `Settings.edts` gains `hiddenActionTypes: string[]` alongside `hiddenActionHints: string[]`; `DEFAULT_SETTINGS.edts.hiddenActionTypes = []`
- `src/adapters/driven/settings/schema.ts` -- `edts.hiddenActionTypes: z.array(z.string())`, same `.strict().optional().default(...)` shape as `hiddenActionHints`
- `src/adapters/driving/tui/zones/edts/edts-zone.tsx:285` (`formatEdtActionHistory`) -- new parameter `hiddenActionTypes: readonly string[]`; filters `actionLog` (drop entries whose `actionType` is in the set) before formatting the "Recent actions:" lines -- same live-read-no-cache pattern as `resolveActionHint`
- `src/adapters/driving/tui/shared/settings-screen.tsx` -- the EDTs tab gains a group-list level ahead of its checkbox lists: a new pure state type (group id `'hint-visibility' | 'action-types'`, cursor position), `Enter` drills in, `Esc` steps back out (only at this tab -- General/Command Palette are unaffected, single-level as before); "Recent action types" group's `CheckboxListItem` rows are exactly `['create', 'switch', 'modify']` (`EdtActionLogEntry['actionType']`'s only real values today, confirmed by grep of every `logEdtAction(...)` call site -- never invent additional ids)
- `src/adapters/driving/tui/shared/settings-screen.test.tsx` -- tests for the new group-list pure functions and the two-level `Enter`/`Esc` navigation
- `src/adapters/driving/tui/app-shell.interaction.test.tsx` / `edts-zone.test.tsx` -- regression test confirming a hidden action type actually disappears from the rendered "Recent actions:" log

## Tasks & Acceptance

**Execution (first round, delivered -- KEEP):**
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
- [x] `src/adapters/driving/tui/zones/edts/edts-zone.tsx` -- gate `useInput` on `settingsScreenOpen`/`registryScreenOpen` -- real-usage review fix (commit `6c8505b`)

**Execution (amended 2026-08-28, Sprint Change Proposal -- new work):**
- [ ] `src/core/ports/settings.ts` -- add `Settings.edts.hiddenActionTypes: string[]` -- AC5
- [ ] `src/adapters/driven/settings/schema.ts` -- zod field for `hiddenActionTypes` -- AC5
- [ ] `src/adapters/driving/tui/shared/settings-screen.tsx` + test -- EDTs tab group-list level (drill-in/out), "Recent action types" checkbox group -- AC1 (amended), AC5, AC6, I/O matrix "Enter a settings group"/"Toggle hidden action type"/"Step back out of a group"
- [ ] `src/adapters/driving/tui/zones/edts/edts-zone.tsx` -- filter `actionLog` by `edts.hiddenActionTypes` in `formatEdtActionHistory` -- AC5, I/O matrix "Toggle hidden action type"

**Acceptance Criteria:**
- AC1 — Given the settings screen is open, when `Left`/`Right`/`Tab` is pressed, then focus cycles General → EDTs → Command Palette → General, visually matching the zone-tab bar's active/inactive treatment at a smaller scale. *(Amended 2026-08-28: this cycles the top-level tabs only -- it does not fire while a group is drilled into on the EDTs tab, per AC6.)*
- AC2 — Given the General tab, when viewed with zero settings defined, then it renders without error as a valid empty tab.
- AC3 — Given any setting change, when the tool is restarted, then the changed value (not the default) loads from `settings.yaml`.
- AC4 — Given the settings screen, when exercised via keyboard only, then every action (tab cycle, value adjust, checkbox toggle, close) is reachable without a mouse.
- AC5 *(added 2026-08-28)* — Given the EDTs tab's "Recent action types" group (drilled into), when a `create`/`switch`/`modify` row is toggled with `Space`, then entries of that type disappear immediately from the EDT detail pane's "Recent actions" log and the change persists.
- AC6 *(added 2026-08-28)* — Given the EDTs tab, when first opened, then it shows a group list ("Hint visibility", "Recent action types") navigable with `Up`/`Down`; `Enter` on a highlighted group drills into that group's own checkbox list; `Esc` while drilled in returns to the group list without closing the settings screen; `Esc` from the group list (or from any other tab) closes the whole screen, per the amended Boundaries.

## Spec Change Log

### 2026-08-28 — EDTs tab under-specified: missing recent-action-type filter (Sprint Change Proposal)

**Trigger:** Real-usage review (Max) of the first implementation round, still on this story's unmerged branch. Two findings reported together:
1. A keybinding-leakage bug (settings/registry popup keys also driving `EdtsZone` underneath) — not a spec problem, fixed directly (commit `6c8505b`), no spec change needed.
2. The "EDTs" tab's actual intent was never fully captured: `epics.md`'s own Story 2.19 AC (and this spec's frozen Intent/Code Map, faithfully following it) only ever described per-pane hint-token visibility (Story 2.18). Max's real original ask for this tab also included filtering which action *types* (`create`/`switch`/`modify`, Story 2.15) appear in the EDT detail pane's "Recent actions" log — never captured anywhere upstream, so not a coding defect, a captured-intent gap.

**What was amended:** Intent's Problem statement (now three tunables, not two); Boundaries (EDTs tab now holds two settings groups behind a drill-down, `Esc` becomes tab-aware); I/O matrix (3 new rows); Code Map and Tasks & Acceptance (new `hiddenActionTypes` field, filter wiring, group-list UX, AC5/AC6). Mirrored upstream in `epics.md` (UX-DR31, Story 2.19's AC and implementation notes).

**Known-bad state avoided:** shipping only per-pane hint visibility and treating the EDTs tab as "done" would have left the actual, originally-requested control (hiding noisy `modify`/`create` log entries) permanently missing, discoverable only by the same kind of real-usage friction that surfaced it this time.

**KEEP (verified working, not touched by this amendment):** `SettingsPort`/schema/adapter (load/save, corrupt-file fallback, XDG path resolution); the `app-store.ts` `settings` slice including the serialized-save and stale-load-guard patches; the `settings` command entry; the General and Command Palette tabs exactly as shipped; `command-bar.tsx`'s live `gridMaxRows` read; the existing `hiddenActionHints` per-pane hint-visibility feature and its `edts-zone.tsx` wiring; `app-shell.tsx`'s mount/gate/Esc-close wiring; the `tui.ts` composition root; the `useInput` overlay-gating fix (commit `6c8505b`).

## Design Notes

**Corrupt-file handling isn't an `err` Result:** unlike `registry`/`manifest`, a failed settings load must never block the screen from opening (Boundaries: "falls back... never a crash"). `SettingsPort.load` returns `Result<{ settings: Settings; warning: string | null }>` — `ok` even on a validation failure, with `settings` set to defaults and `warning` carrying the human-readable field-naming message; only a real I/O error (permission denied, etc.) is an `err`.

**EDTs-tab token list is Story 2.18's to define:** since 2.18 is not yet implemented, this story cannot enumerate exact hint-token ids ahead of it. At implementation time, read whatever per-context hint tokens 2.18's landed `formatEdtActionHistory` (or its replacement) actually emits, and build the checkbox list from that set — never invent placeholder ids.

**(Amended 2026-08-28) Why a group-list level, not a flat combined list or a sub-tab strip:** a single flat list with section headers would work today (only 2 groups × 3 items) but conflates two unrelated toggles under one cursor with no room to grow. A second horizontal tab strip inside the EDTs tab was considered and rejected: it would need to scope `Left`/`Right`/`Tab` differently at two nested levels inside the same modal, risking exactly the kind of keybinding-leakage class of bug fixed in commit `6c8505b` (only this time internal to the popup). The chosen group-list-then-drill-in design reuses `Enter`/`Esc` for level transitions instead — no key is ever ambiguous between two levels, `Up`/`Down`/`Space` keep their one existing meaning throughout, and it scales cleanly if more EDTs-tab settings groups are added later.

**(Amended 2026-08-28) Action-type list is closed, not derived:** unlike the hint-token list (read from whatever `formatAvailableActionsHint` actually emits), the "Recent action types" group's three rows (`create`/`switch`/`modify`) are the literal `EdtActionLogEntry['actionType']` domain (`app-store.ts`) — confirmed exhaustive by grepping every `logEdtAction(...)` call site in `edts-zone.tsx`. Hardcode this list; do not attempt to derive it from `edtActionLog` at runtime (an EDT with no `modify` entries yet must still offer to hide `modify`).

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
