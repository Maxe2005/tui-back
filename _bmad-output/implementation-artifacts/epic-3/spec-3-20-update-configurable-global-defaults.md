---
title: 'Story 3.20: Update — Configurable Global Defaults'
type: 'feature'
created: '2026-10-14'
status: 'done'
baseline_commit: '6a6bb433f6e317b416e94fa933d6a6ac1189a737'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Update configuration screen (3.7) always opens with hard-coded globals (migrations on, clean restart off, merge source = shared), and the CLI `update` hard-codes the same, so developers re-tick the same options at every run.

**Approach:** Persist these defaults in `settings.yaml` (new `update` keys, zod defaults equal to today's values), expose them in a new `:settings` **Update** tab, seed the 3.7 draft globals from them, and make the CLI honour them with explicit override flags.

## Boundaries & Constraints

**Always:** New keys under `update`: `runMigrations` (true), `cleanRestart` (false), `mergeSource` (`shared` | `edt-pending`, default `shared`). Optional-with-default so a missing key changes nothing; invalid value → existing warn-and-fall-back-to-defaults. `concurrency` moves from the General tab to the new Update tab. Per-run changes in the 3.7 screen are never written back. Rows keep seeding `follow`, so only follow-global rows are affected by default changes. The merge-source line appears in settings only as in 3.7 (EDT layout). Edits in `:settings` persist immediately (existing idiom). CLI: defaults from settings; explicit flags `--migrations`/`--no-migrations`, `--clean-restart`/`--no-clean-restart` override them.

**Ask First:** If `edt-pending` as a persisted default needs a From-EDT topic that the draft cannot resolve at open time.

**Never:** Add a "start services" option (deferred); change `group-update` core semantics; write per-run draft changes to settings; change per-service override behaviour (3.9).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Missing keys | `settings.yaml` without new keys | Draft opens migrations on, clean restart off, shared | N/A |
| Custom defaults | `runMigrations: false` | 3.7 global panel opens with migrations off; per-run toggle not persisted | N/A |
| Invalid value | `cleanRestart: "maybe"` | Whole file falls back to defaults with warning | Existing warning text |
| CLI default | `tui-back update` with `cleanRestart: true` | Runs with clean restart | N/A |
| CLI override | same + `--no-clean-restart` | Runs without clean restart | Conflicting pair → invalid-argument |

</frozen-after-approval>

## Code Map

- `src/core/ports/settings.ts` -- `Settings.update` type (~40), `DEFAULT_SETTINGS.update` (~81)
- `src/adapters/driven/settings/schema.ts` -- zod `update` group (strict, optional+default per field)
- `src/adapters/driven/settings/index.ts` -- loader/saver; no change expected
- `src/adapters/driving/tui/shared/settings-screen.tsx` -- tabs (38-42), General rows (160), concurrency helpers/step (158-230, 527-540, 842-850), toggle idiom (283-335)
- `src/adapters/driving/tui/zones/update/update-config-dialog.logic.ts` -- `createUpdateConfigDraft` (79-107) hard-coded globals
- `src/adapters/driving/tui/store/slices/update-slice.ts` -- `openConfigDraft` (~447-461) has `get().settings`
- `src/adapters/driving/cli/subcommands.ts` -- `update` (156-240), three hard-coded `groupUpdate` calls, deps (55-77)
- `src/bin/main.ts` -- builds subcommands (71-89); wire `createSettingsPort(resolveSettingsFile(xdg))`
- Tests: `settings/index.test.ts` (literal `update: { concurrency: 3 }` at 76/232/322), `settings-screen.test.tsx`, `update-config-dialog.test.ts`, `cli/dispatch.test.ts`

## Tasks & Acceptance

**Execution:**
- [x] `src/core/ports/settings.ts`, `src/adapters/driven/settings/schema.ts` -- add three keys + defaults; update existing literal expectations in `index.test.ts` and add load/default/invalid tests
- [x] `src/adapters/driving/tui/shared/settings-screen.tsx` -- new `update` tab (concurrency moved, two toggles, merge-source choice); extend pure helpers + tests
- [x] `update-config-dialog.logic.ts`, `update-slice.ts` -- seed draft globals from settings via a new option; tests: seeded values, follow rows unaffected, nothing written back
- [x] `subcommands.ts`, `main.ts` -- inject settings port, parse override flags, use effective values in the three calls; update `UPDATE_USAGE`; dispatch tests
- [x] `docs/` / README -- check for settings or CLI usage mentions and update if any

**Acceptance Criteria:**
- Given `:settings` Update tab, when opened, then concurrency, run migrations, clean restart and (EDT layout) merge source are editable and persisted
- Given the 3.7 screen, when opened, then globals reflect settings and in-screen changes do not alter `settings.yaml`
- Given a service with a per-service exception, when defaults change, then that row is unchanged
- Given the CLI, when no flag is passed, then settings defaults apply; explicit flags win

## Spec Change Log

## Verification

**Commands:**
- `npx tsc --noEmit` -- expected: no errors
- `npx vitest run` -- expected: all pass
- `npm run lint` -- expected: clean (if script exists)

## Suggested Review Order

**Settings model**

- Entry point: new `update` keys and defaults equal to today's hard-coded values.
  [`settings.ts:89`](../../../src/core/ports/settings.ts#L89)

- Zod fields optional-with-default, so missing keys change nothing.
  [`schema.ts:87`](../../../src/adapters/driven/settings/schema.ts#L87)

**TUI: `:settings` Update tab**

- New tab; concurrency moved here beside the three new rows.
  [`settings-screen.tsx:212`](../../../src/adapters/driving/tui/shared/settings-screen.tsx#L212)

- Edits persist immediately through `updateSettings`.
  [`settings-screen.tsx:594`](../../../src/adapters/driving/tui/shared/settings-screen.tsx#L594)

**TUI: config screen seeding**

- Draft globals seeded from settings; rows still start on `follow`.
  [`update-config-dialog.logic.ts:91`](../../../src/adapters/driving/tui/zones/update/update-config-dialog.logic.ts#L91)

- Store passes settings in; nothing is written back.
  [`update-slice.ts:463`](../../../src/adapters/driving/tui/store/slices/update-slice.ts#L463)

**CLI**

- Override flag parsing; a flag together with its negation is rejected.
  [`subcommands.ts:60`](../../../src/adapters/driving/cli/subcommands.ts#L60)

- Settings defaults loaded; load problems go to stderr, then fall back.
  [`subcommands.ts:204`](../../../src/adapters/driving/cli/subcommands.ts#L204)

- Composition root wires the settings port.
  [`main.ts:86`](../../../src/bin/main.ts#L86)
