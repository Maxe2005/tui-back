---
title: 'Split the Zone Logic Modules'
type: 'refactor'
created: '2026-11-16'
status: 'done'
baseline_commit: '2104932c11e0323be1a5d030b2caadb1f8da130d'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/sprint-2-refonte-fichiers-volumineux/epic-12-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `logs-zone.logic.ts` (1054 lines), `edts-zone.logic.ts` (956) and `update-zone.logic.ts` (674) each mix several concerns, and `update-zone.tsx` (1163) embeds ~240 lines of pure constants, formatters, trigger/confirm resolvers and blocker menus.

**Approach:** Group each logic file by concern into sibling `<zone>-zone.<concern>.logic.ts` modules. Each original `*.logic.ts` stays as a thin barrel re-exporting every previously exported symbol. The pure code at the top of `update-zone.tsx` moves verbatim into `update-zone.logic.ts` + sibling modules, and `update-zone.tsx` re-exports it. Code moved verbatim, one commit per zone.

## Boundaries & Constraints

**Always:** Behaviour-preserving. Every previously exported symbol stays importable from its original path (`logs-zone.logic.js`, `edts-zone.logic.js`, `update-zone.logic.js`, `update-zone.js`). No import cycle (concern modules never import their barrel). One responsibility + header comment per file, each under ~400 lines (justify exceptions in the spec). Gates before every commit: `npm test && npm run typecheck && npm run depcheck`.

**Never:** Edit any test file, change messages/keys/layout constants, or touch the `.tsx` components other than update-zone's pure-code extraction and re-exports.

</frozen-after-approval>

## Code Map

Logs (`zones/logs/`): `logs-zone.logic.ts` → barrel over
- `logs-zone.health.logic.ts` -- health badge/label, restarting display, no-container rows (L22-76).
- `logs-zone.focus.logic.ts` -- `LogsPaneFocus`, nav, `movePaneSubFocus`, `reindexPaneSubFocus`.
- `logs-zone.layout.logic.ts` -- grid + `computeLogsLayout` + chrome constants, `resolvePostLoadScrollOffset`.
- `logs-zone.keys.logic.ts` -- select-all/clear/wrap keys, visibility toggles/flags, footer context, legend hints, `filterVisibleLines`.
- `logs-zone.filter.logic.ts` -- filter types, level detect, ANSI split, `compileLogFilter`, `applyLogRules`, rule/scope ops, engagement, formatting, `formatLogLine`.
- `logs-zone.filter-editor.logic.ts` -- history keys/encoding, `FilterEditorState`, editor/rule-set state builders and formatters.

Edts (`zones/edts/`): `edts-zone.logic.ts` → barrel over
- `edts-zone.format.logic.ts` -- branch/service/issue/EDT formatters, issue explanations, action hints, service partition.
- `edts-zone.focus.logic.ts` -- pane/form focus, member toggle, branch suggestions/validation.
- `edts-zone.modify.logic.ts` -- candidate list state, modify enter action, `resolveModifyOps`, failed-result summaries.
- `edts-zone.wizard.logic.ts` -- create wizard step state (`BranchStepState`...), `CreateDialogState`, `initialCreateDialog`, picker session.
- `edts-zone.dialogs.logic.ts` -- remaining dialog states/initialisers (switch, activation, modify, service actions, add-to-EDT, delete, issues, quick-pick).

Update (`zones/update/`): `update-zone.logic.ts` keeps status/rows/outcome formatting and re-exports siblings
- `update-zone.steps.logic.ts` -- step keys/states/glyphs, advance/finalize/infer, `buildServiceStepViews`.
- `update-zone.report.logic.ts` -- report types, `buildServiceReport`, windowing, report keys/scroll.
- `update-zone.recap.logic.ts` -- last-update recap, footer context.
- `update-zone.resolvers.logic.ts` -- from `update-zone.tsx`: constants, `formatUpdateRow/Summary`, `resolveUpdateTone`, `shouldOffer*/Open*`, `resolveUpdateTrigger`, all/quit confirm resolvers.
- `update-zone.blockers.logic.ts` -- from `update-zone.tsx`: blocker menu items, `blockerMenuItems`, `formatBlockerBody/Retry`.
- `update-zone.tsx` -- imports from and re-exports those modules; component untouched.

## Tasks & Acceptance

**Execution:**
- [x] logs split + barrel -- commit `refactor(logs-zone): ... (story 12.7)`
- [x] edts split + barrel -- commit `refactor(edts-zone): ... (story 12.7)`
- [x] update logic split + `update-zone.tsx` extraction/re-exports -- commit `refactor(update-zone): ... (story 12.7)`

**Acceptance Criteria:**
- Given the split, when the zone logic/component tests and the full suite run unchanged, then they pass (modulo the known `app-shell` `:reset` failure) and typecheck + depcheck are green.

## Verification

**Commands:**
- `npm test && npm run typecheck && npm run depcheck` -- expected: green (modulo the known `:reset` failure)

## Implementation Notes

- `update-zone.logic.ts` became a barrel like the other two zones; its status/rows/outcome code lives in `update-zone.status.logic.ts`.
- `initialCreateDialog` and `createPickerSession` stayed in `edts-zone.dialogs.logic.ts` (next to the other initialisers); `edts-zone.wizard.logic.ts` holds the wizard step state and `CreateDialogState`.
- Cross-module helpers were exported so siblings can import them; the barrels therefore also expose them (harmless).
- `npx vitest run --configLoader runner` was needed locally (default config bundling fails in this environment); full suite green except the known `app-shell` `:reset` test.

## Suggested Review Order

**Logs zone**

- Barrel keeping the original import path; start here.
  [`logs-zone.logic.ts:1`](../../../../src/adapters/driving/tui/zones/logs/logs-zone.logic.ts#L1)

- Largest module: filter model, ANSI-safe compile/apply (400 lines).
  [`logs-zone.filter.logic.ts:1`](../../../../src/adapters/driving/tui/zones/logs/logs-zone.filter.logic.ts#L1)

- Filter history and editor dialog state.
  [`logs-zone.filter-editor.logic.ts:1`](../../../../src/adapters/driving/tui/zones/logs/logs-zone.filter-editor.logic.ts#L1)

**Edts zone**

- Barrel over format, focus, modify, wizard and dialogs modules.
  [`edts-zone.logic.ts:1`](../../../../src/adapters/driving/tui/zones/edts/edts-zone.logic.ts#L1)

- Dialog states and initialisers (412 lines, cohesive).
  [`edts-zone.dialogs.logic.ts:1`](../../../../src/adapters/driving/tui/zones/edts/edts-zone.dialogs.logic.ts#L1)

**Update zone**

- Barrel plus status/recap/steps/report modules.
  [`update-zone.logic.ts:1`](../../../../src/adapters/driving/tui/zones/update/update-zone.logic.ts#L1)

- Pure code lifted out of the component; the tsx re-exports it.
  [`update-zone.tsx:50`](../../../../src/adapters/driving/tui/zones/update/update-zone.tsx#L50)

- Trigger/confirm resolvers and blocker menus.
  [`update-zone.resolvers.logic.ts:1`](../../../../src/adapters/driving/tui/zones/update/update-zone.resolvers.logic.ts#L1)
  [`update-zone.blockers.logic.ts:1`](../../../../src/adapters/driving/tui/zones/update/update-zone.blockers.logic.ts#L1)
