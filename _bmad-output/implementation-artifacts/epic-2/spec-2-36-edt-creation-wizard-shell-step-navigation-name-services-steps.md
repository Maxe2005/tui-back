---
title: 'EDT Creation Wizard — Shell, Step Navigation, Name & Services Steps'
type: 'feature'
created: '2026-09-28'
status: 'draft'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The CREATE EDT dialog is one flat Tab-cycled form (topic → members → branch fields), so the developer cannot see which decisions are made or still pending, and a duplicate topic is only caught by the core after submit.

**Approach:** Replace it, behind the same `edt-create` / zero-EDT entry points, with a 4-step wizard modal (`dialogs/create-wizard/`): breadcrumb, per-step intro, explicit step navigation, Step 1 (live-checked name), Step 2 (services). Steps 3–4 temporarily host today's branch fields and a plain confirm, so the epic branch stays shippable until Stories 2.37/2.38.

## Boundaries & Constraints

**Always:**
- Modal title `EDT Wizard: Création d'un espace de travail`; breadcrumb `[1. Nom] ── [2. Services] ── [3. Branches] ── [4. Activation]`: current step `▶ … ◀` in accent, steps before it show `stepSummary` (`1. Nom: auth-flow`, `2. Services (3)`), steps outside `reachableSteps` dim. Every step opens with a one-line French intro.
- Keys: `Ctrl+→` / `Ctrl+N` = next step iff `canAdvance`, else show that step's inline error; `Ctrl+←` / `Ctrl+P` (fallback) = back one step, always, state kept; `Tab` moves only within the current step; `Enter` advances on Steps 1–2; `Esc` closes the innermost open sub-field first (Step 3's base-branch picker), else cancels with nothing written — with zero EDTs it calls `requestQuit` (kept). All inert while `submitting`.
- Step 1: one autofocused `TextInputLine`; status recomputed on every keystroke: trimmed, case-sensitive exact match against loaded EDT topics → `✔ disponible` (`success`) / `✖ déjà pris` (`error`); empty or taken blocks advancing.
- Step 2: every registered managed repo as `CheckboxListItem` (`Space` toggles, `↑/↓/Home/End`), existing loading/error/empty states; zero checked blocks advancing with an inline message.
- Step 3 (interim): today's base-branch picker / naming-mode / branch-name fields and handlers unchanged, entered with today's prefill + fresh picker session; `Tab` cycles only its own fields (last name field wraps to base); `Enter` outside the open picker = next step. `canAdvance(3)` = `validateCreateBranchFields(...) === null`.
- Step 4 (interim): read-only recap (name, services, base/branch names) + `Enter` runs today's `submitCreate` unchanged (same `createEdt` params, logging, `FailedResultList`, store's active-pointer write — fixed in 2.38).
- New wizard-only keys are documented in `EXPERIENCE.md` and the `KEYBINDINGS` help list.

**Ask First:** changing `createEdt`'s params, the store's `createEdt`/`writeActiveEdt` behavior, or the action-log target EDT.

**Never:** implement Step 3's global strategy/table or Step 4's activation choice; call `memberPlans`; retire `CreateDialogState`'s branch fields, `CreateFormFocus`, `advanceCreateFormFocus`, `prefillBaseBranches`, `resolveBaseBranchMode` (Story 2.37); bind `Ctrl+←/→/N/P` outside the wizard.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Name free | `auth-flow`, EDTs `[demo]` | `✔ disponible`; `Ctrl+N`/`Enter` → Step 2 | — |
| Name taken, padded | ` demo ` | `✖ déjà pris`; stays on Step 1 | inline error on advance |
| Case differs | `Demo` vs `demo` | available | — |
| Empty name | `''` / `'   '` | no advance | inline `Le nom ne doit pas être vide` |
| No service | Step 2, none checked | no advance | inline `Sélectionnez au moins un service` |
| Back | Step 3 → `Ctrl+←` twice | Step 1, topic/selection/branch fields kept | — |
| Esc in picker | Step 3, picker open | picker closes, still Step 3 | — |
| Esc outside picker | any step, ≥1 EDT | dialog closed, no `createEdt` | — |
| Esc, zero EDTs | any step | `requestQuit()` | — |
| Ctrl+N invalid step 3 | emptied branch name | stays on Step 3 | inline `validateCreateBranchFields` error |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/zones/edts/dialogs/create-dialog.tsx` -- current dialog: `submitCreate` (L85), base picker session/outcome (L168-275), branch-step input (L277-351), dispatcher (L353-502), view (L507-605). Split into the wizard folder, then delete.
- `src/adapters/driving/tui/zones/edts/edts-zone.logic.ts` -- `CreateDialogState` (L845) + `initialCreateDialog` (L1133): add `step`; `advanceCreateFormFocus` (L373) reusable for Step 3 Tab (map returned `topic` → `branch-base`); `validateCreateBranchFields` (L529); `nextTextInputValue` already ignores ctrl/meta (L271).
- `src/adapters/driving/tui/zones/edts/edts-zone.tsx` -- imports/wires `createCreateDialogHandlers` (L491) and `CreateDialogView` (L869); needs `edtsRows` for availability; branch-picker `listBranches` effect keys on `dialog.kind === 'create'` (L358, unchanged).
- `src/adapters/driving/tui/shared/components/{modal-dialog,text-input-line,checkbox-list-item,failed-result-list}.tsx` -- reuse as-is.
- `src/adapters/driving/tui/keybindings/keybindings.ts` + `keybindings.test.ts` -- help-screen list.
- `_bmad-output/planning-artifacts/ux-designs/ux-tui-back-2026-08-10/EXPERIENCE.md` -- Interaction Primitives (L168), Component Patterns table (`text-input` row L80 has stale "no mid-string cursor" wording).
- Tests: `edts-zone.interaction.test.tsx` create cases (L783-1738, use `KEYS.ctrlLeft/ctrlRight`, add `\x0e`/`\x10` for Ctrl+N/P in `fake-tty.ts`), `edts-zone.test.tsx` (L1249-1333 `CREATE EDT`/`Topic:`), `app-shell.interaction.test.tsx` (L1207).
- Ink 7 decodes `\x1b[1;5C/D` as arrow + `ctrl: true`; app-shell's globals are gated by `zoneInputCaptured`, and no `Ctrl+N`/`Ctrl+P` binding exists → no collision.

## Tasks & Acceptance

**Execution:**
- [ ] `src/adapters/driving/tui/zones/edts/edts-zone.logic.ts` -- add `WizardStep = 1|2|3|4` and `step` to `CreateDialogState` (initial 1) -- single state, Step 3 still needs the branch fields.
- [ ] `src/adapters/driving/tui/zones/edts/dialogs/create-wizard/wizard.logic.ts` -- pure `checkNameAvailability`, `canAdvance(step, state, ctx)` → `{ok} | {ok:false, error}`, `reachableSteps`, `stepSummary`, `resolveWizardNavKey(input,key)` (`next`/`back`/null), `STEP_LABELS`, `STEP_INTROS` -- unit-testable core.
- [ ] `.../create-wizard/wizard.logic.test.ts` -- every I/O matrix row reachable at logic level, plus nav-key decoding.
- [ ] `.../create-wizard/step-name.tsx`, `step-services.tsx`, `step-branches.tsx`, `step-activation.tsx` -- one view (+ step-local input handler) per step; `step-branches` carries today's branch handlers/view verbatim.
- [ ] `.../create-wizard/create-wizard.tsx` -- `createCreateWizardHandlers` (nav, Esc, Enter, per-step dispatch, `submitCreate` moved unchanged) + `CreateWizardView` (modal, breadcrumb, intro, step body, error/failed rows/`Création…`, nav hint line); delete `dialogs/create-dialog.tsx`.
- [ ] `src/adapters/driving/tui/zones/edts/edts-zone.tsx` -- rewire to the wizard.
- [ ] `src/adapters/driving/tui/keybindings/keybindings.ts` (+ test) and `EXPERIENCE.md` -- wizard-scoped `Ctrl+←/→`, `Ctrl+N`, `Ctrl+P`; `wizard-breadcrumb` component row; fix stale `text-input` wording.
- [ ] Tests listed in Code Map -- rewrite create-flow interaction tests around wizard navigation (not patched), keep their behavioral assertions (createEdt params, failures, re-entrancy, Esc/quit, caret editing); add Ctrl+N/Ctrl+→/Ctrl+←/Ctrl+P round-trips.

**Acceptance Criteria:**
- Given the zero-EDT auto-open or `edt-create`, when the modal opens, then Step 1 is current with the breadcrumb and intro rendered and the name field focused.
- Given valid Steps 1–3, when Step 4 is confirmed, then `createEdt` receives exactly the params today's dialog would have sent.
- `npm test`, `npm run typecheck`, `npm run depcheck` pass.

## Spec Change Log

## Design Notes

- One `CreateDialogState` + `step` (not a nested per-step union) keeps `submitCreate` and the Step 3 handlers untouched until 2.37 replaces them.
- `reachableSteps`: steps `1..k`, `k` = first step failing `canAdvance` (max 4). Leaving/entering a step resets `error`; entering Step 3 re-runs prefill and opens a fresh picker (today's re-entry convention); leaving it drops the picker.
- `Ctrl+P` chosen as the back fallback (mirrors `Ctrl+N`, unbound elsewhere).

## Verification

**Commands:**
- `npm run typecheck` -- expected: no errors
- `npm test` -- expected: all green
- `npm run depcheck` -- expected: pass

**Manual checks:**
- Real terminal: `Ctrl+→`/`Ctrl+←` reach the wizard (else `Ctrl+N`/`Ctrl+P` do).
