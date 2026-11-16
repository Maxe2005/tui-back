---
title: 'Split the Settings Screen by Tab'
type: 'refactor'
created: '2026-11-16'
status: 'done'
baseline_commit: 'e8596b67f49a328a3bbf428170abaca783a7aa48'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/sprint-2-refonte-fichiers-volumineux/epic-12-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `shared/settings-screen.tsx` (1644 lines) mixes per-tab clamp/adjust/parse helpers, row definitions, key resolvers, the tab views, and the `SettingsScreen` component (state, one big `useInput`, render).

**Approach:** Move the pure helpers/row definitions into per-tab `*.logic.ts` modules, then each tab's JSX into its own view component. `settings-screen.tsx` keeps the shell (state, `useInput`, tab strip, `useFooterContext`) and re-exports every moved symbol. Moves first, edits second.

## Boundaries & Constraints

**Always:** Behaviour-preserving. `shared/settings-screen.js` keeps exporting every name it exported before (importers: app-shell.tsx, test-support/dialog-registry.tsx, reset-screen.tsx, tests). New files live in `shared/settings/`, carry a header comment, one responsibility, under ~400 lines; logic modules import no Ink/React. Green gates before each commit: `npm test && npm run typecheck && npm run depcheck`. One extraction per commit: `refactor(settings): ... (story 12.3)` with a body explaining why.

**Ask First:** A module that cannot stay under ~400 lines, a circular import between new modules, or if the shell stays far above ~400 lines (the single `useInput` handler may stay in the shell; extracting per-tab key handlers is a human call).

**Never:** Edit `settings-screen.test.tsx`. Change signatures, hook order, `useInput` wiring/priority, store selectors or rendered output. Move state out of `SettingsScreen` into tab components (it would change Esc/Tab semantics). Split test files (epic 13).

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/shared/settings-screen.tsx` -- source (1644 lines): helpers l.50-600, `SettingsScreen` l.626-1644 (state 635-716, `useInput` 730-1188, render 1190-1644).
- Target logic modules in `shared/settings/` (line ranges of the source):
  - `settings-tabs.logic.ts` -- `SettingsTab`, `SETTINGS_TABS`, labels, `nextSettingsTab`, `SettingsTabState`/`resolveSettingsTabState` (l.50-63, 171-199), `SETTINGS_LIST_CHROME_ROWS`.
  - `services.logic.ts` (l.65-113), `shared-types.logic.ts` (l.115-169), `general.logic.ts` (l.277-324), `update.logic.ts` (l.326-395).
  - `palette.logic.ts` -- grid max rows, filter-history sizes, `PALETTE_SETTINGS_GROUPS` (l.201-221, 244-275, 506-515).
  - `logs.logic.ts` -- buffer size, `LOGS_SETTINGS_GROUPS`, clear/rules rows (l.223-242, 481-504, 575-599).
  - `edts.logic.ts` -- hints, action types, branch dropdown rows, `SETTINGS_GROUPS`, restart/scope labels (l.397-479).
  - `footer-context.logic.ts` -- `GROUP_FOOTER_CONTEXTS`, `settingsFooterContext` (l.517-573).
- Target views in `shared/settings/`: `general-tab.tsx`, `update-tab.tsx`, `shared-types-tab.tsx`, `services-tab.tsx`, `palette-tab.tsx`, `logs-tab.tsx`, `edts-tab.tsx` -- props-only presentational JSX taken from render l.1208-1644 (state stays in the shell).
- `settings-screen.test.tsx` (889 lines) -- imports from the original path; unchanged = proof of equivalence.

## Tasks & Acceptance

**Execution:**
- [x] `shared/settings/{settings-tabs,services,shared-types,general,update}.logic.ts` -- extract; re-export from `settings-screen.tsx` (one commit per module)
- [x] `shared/settings/{palette,logs,edts,footer-context}.logic.ts` -- extract; re-export (one commit per module)
- [x] `shared/settings/*-tab.tsx` -- extract each tab view as a props-only component (one commit per tab); shell renders them in the same order

**Acceptance Criteria:**
- Given the split, when `settings-screen.test.tsx` and the other importers' tests run unchanged, then they pass.
- Given the folders, when listing them, then `settings-screen.tsx` holds only state, input wiring, tab strip and view dispatch, and no new file exceeds ~400 lines.
- Given `npm test && npm run typecheck && npm run depcheck`, then all are green with no new violation.

## Spec Change Log

## Verification

**Commands:**
- `npm test && npm run typecheck && npm run depcheck` -- expected: all green
- `wc -l src/adapters/driving/tui/shared/settings-screen.tsx src/adapters/driving/tui/shared/settings/*` -- expected: new files ≤ ~400 lines

## Suggested Review Order

**Shell kept thin, public surface kept stable**

- `SettingsScreen` keeps state, the single `useInput`, tab strip and view dispatch (726 lines).
  [`settings-screen.tsx:70`](../../../../src/adapters/driving/tui/shared/settings-screen.tsx#L70)

- Every moved symbol is re-exported, so importers and tests are untouched.
  [`settings-screen.tsx:1`](../../../../src/adapters/driving/tui/shared/settings-screen.tsx#L1)

**Tab views (props-only)**

- Largest view: Logs groups, clear history and filter rules.
  [`logs-tab.tsx:1`](../../../../src/adapters/driving/tui/shared/settings/logs-tab.tsx#L1)

- EDTs group list and drilled-in groups; group list now keyed on `edtsGroup === null`.
  [`edts-tab.tsx:1`](../../../../src/adapters/driving/tui/shared/settings/edts-tab.tsx#L1)

- Command Palette, General, Update, Services and shared-types views.
  [`palette-tab.tsx:1`](../../../../src/adapters/driving/tui/shared/settings/palette-tab.tsx#L1)

**Per-tab logic modules**

- Tab ids, labels, cycling and shared layout constant.
  [`settings-tabs.logic.ts:1`](../../../../src/adapters/driving/tui/shared/settings/settings-tabs.logic.ts#L1)

- Footer context per group.
  [`footer-context.logic.ts:1`](../../../../src/adapters/driving/tui/shared/settings/footer-context.logic.ts#L1)

- Logs, palette and EDTs helpers and group definitions.
  [`logs.logic.ts:1`](../../../../src/adapters/driving/tui/shared/settings/logs.logic.ts#L1)
