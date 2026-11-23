---
title: 'Story 2.47: Shared-Branches EDT in the EDTs Zone and the Settings Screen'
type: 'feature'
created: '2026-11-18'
status: 'done'
baseline_commit: '311d7e93773a9d59a323df8b98f6f404957183d7'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/sprint-1-delivery-of-tui-back/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/sprint-1-delivery-of-tui-back/epic-2/spec-2-46-shared-branches-edt-model-guards-setting-switch-and-update.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 2.46 delivered the system "Shared branches" EDT (model, guards, `edts.sharedBranchesEdtEnabled` setting, CLI/MCP switch and update) but the TUI neither lets the user enable it nor shows or handles it correctly.

**Approach:** Add the toggle to the `:settings` EDTs tab and make the EDTs zone, wizard, quick-pick, Update zone, Dashboard and switch dialog treat the system EDT as a first-class, read-only row (switch and update only), per the Story 2.47 ACs in `epics.md`.

## Boundaries & Constraints

**Always:** Reuse the 2.46 helpers (`isSystemEdt`, `EDT_SYSTEM_READONLY_MESSAGE`, `assertSharedEdtCanBeDisabled`). Every key hint shown is declared in `FOOTER_CONTEXTS` (`footer-contexts.ts`). The badge is text (`shared`), never colour alone. The system EDT sorts first in the EDTs zone. Setting off ⇒ the EDT is absent everywhere (the registry already omits it).

**Ask First:** Any change to core/CLI/MCP behaviour beyond excluding the system EDT from `usedByEdts`.

**Never:** Allow modify, rename, member editing, delete or create-from on the system EDT. No new CLI flags. No Story 2.48 work (fast-forward without switching).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Enable | Space on the toggle, setting off | Persisted true; EDT appears live in the zone | N/A |
| Disable while active | Space, setting on, system EDT active | Nothing persisted; `settingsWarning` shown inline | Refusal message from 2.46 |
| Read-only key | System row focused, Enter on modify/rename/delete/member edit paths | `EDT_SYSTEM_READONLY_MESSAGE` shown, no dialog | N/A |
| Switch away | System EDT active, switch dialog | Adopt choice hidden | Core `switch-adopt-unavailable` stays as backstop |
| Name collision | Wizard name "Shared branches" (any case), setting off | Rejected as taken | Existing taken-name error |

</frozen-after-approval>

## Code Map

Paths under `src/adapters/driving/tui` (`TUI`) unless noted.

- `TUI/shared/settings/edts.logic.ts:74` + `edts-tab.tsx` + `TUI/shared/settings-screen.tsx:526-650` + `settings/footer-context.logic.ts` -- add a toggle row "Show the shared-branches EDT" (+ one-line `DimAnnotation`); Space calls `updateSettings({edts:{sharedBranchesEdtEnabled}})`; `settingsWarning` (settings-slice.ts:78-90) already refuses.
- `TUI/keybindings/footer-contexts.ts:406-446` -- new contexts for the settings toggle and the system EDT row.
- `TUI/zones/edts/edts-zone.tsx` (rows :271, `ListRow` :872, `openEdtAction` :649, `currentEdtAction` effect :386-464, openers :821-860) + `edts-zone.logic.ts` (`formatEdtRowMeta` :323, `formatEdtDetail` :328, hint :378/:395) -- `shared` badge, sort first, detail with members/branches, guards showing the readonly message, switch allowed.
- `TUI/zones/edts/dialogs/quick-pick-dialog.tsx:28` -- switch mode keeps the system EDT; modify/delete/create-from exclude it.
- `TUI/zones/edts/dialogs/create-wizard/wizard.logic.ts:46` + `initialCreateDialog` -- reject the system topic via `isSharedEdtTopic`; never seed from the system EDT.
- `TUI/zones/edts/dialogs/switch-resolution/switch-resolution.logic.ts:30,136` -- `otherEdtBranches` skips the system EDT; no `adopt` when the outgoing EDT is the system one.
- `TUI/zones/update/update-zone.logic.ts:269` (+ update-zone.tsx:158-172, :473) -- scope label "all shared branches".
- `src/core/dashboard/snapshot.ts:205` -- exclude `isSystemEdt` from `usedByEdts`.
- Footer top-bar and `core/edt/branch-owners.ts` already correct — read-only evidence.
- Tests: `edts-zone.test.tsx`, `edts-zone.interaction.test.tsx`, `settings-screen.test.tsx`, `keybindings.test.ts`, `wizard.logic.test.ts`, `update-zone.test.tsx`, dashboard snapshot tests.

## Tasks & Acceptance

**Execution:**
- [ ] settings files above -- toggle row, Space handler, footer context, inline refusal -- AC1
- [ ] EDTs zone + logic -- badge, first sort, detail, read-only guards, hints -- AC2, AC3, AC6
- [ ] quick-pick, wizard, switch-resolution -- filtering, name rejection, hidden adopt -- AC3, AC4
- [ ] update-zone.logic + snapshot.ts -- scope label, `usedByEdts` exclusion -- AC5
- [ ] `footer-contexts.ts` -- declare every new hint -- AC6
- [ ] tests for each item and the I/O matrix

**Acceptance Criteria:**
- Given the `:settings` EDTs tab, when rendered, then the toggle (off by default) is shown, Space toggles and persists live, and disabling while active shows the refusal inline.
- Given the setting on, when the EDTs zone renders, then the system EDT is listed first with a `shared` badge, detail with members and shared branches, and recent actions.
- Given the system EDT selected, when actions are offered, then only switch and update work and other keys show `edt-system-readonly`.
- Given the wizard and quick-pick, when opened, then the system EDT is never a template or name, and is switchable only while enabled.
- Given the system EDT active, when footer, Update and Dashboard render, then "Shared branches", "all shared branches" and no "used by another EDT" flags appear.
- Given `?` in the zone, when shown, then every key is declared in `footer-contexts.ts`.

## Spec Change Log

## Design Notes

The toggle is a group-list row whose Space toggles directly (no drill-in), since it is a single boolean unlike the other groups.

## Verification

**Commands:**
- `npm run typecheck` -- expected: no errors
- `npx vitest run` -- expected: all pass

## Suggested Review Order

**Settings toggle**

- Space reads the live value, then updates the setting.
  [`settings-screen.tsx:545`](../../../../src/adapters/driving/tui/shared/settings-screen.tsx#L545)

- Save chain compares against the live value and reloads the EDT list on a real flip.
  [`settings-slice.ts:94`](../../../../src/adapters/driving/tui/store/slices/settings-slice.ts#L94)

- The system EDT sorts first on reload.
  [`edt-slice.ts:313`](../../../../src/adapters/driving/tui/store/slices/edt-slice.ts#L313)

**EDTs zone**

- Badge text, outgoing-topic rule (no adopt from the system EDT).
  [`edts-zone.logic.ts:328`](../../../../src/adapters/driving/tui/zones/edts/edts-zone.logic.ts#L328)

- The zone counts only user EDTs for the empty state and guards the read-only paths.
  [`edts-zone.tsx:340`](../../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L340)

- Quick-pick filtering per mode.
  [`quick-pick-dialog.tsx:39`](../../../../src/adapters/driving/tui/zones/edts/dialogs/quick-pick-dialog.tsx#L39)

- Declared footer contexts for the system row.
  [`footer-contexts.ts:426`](../../../../src/adapters/driving/tui/keybindings/footer-contexts.ts#L426)

**Core and Update**

- The system EDT no longer counts as "used by another EDT".
  [`snapshot.ts:213`](../../../../../src/core/dashboard/snapshot.ts#L213)

- Update scope label "all shared branches".
  [`update-zone.logic.ts:268`](../../../../src/adapters/driving/tui/zones/update/update-zone.logic.ts#L268)
