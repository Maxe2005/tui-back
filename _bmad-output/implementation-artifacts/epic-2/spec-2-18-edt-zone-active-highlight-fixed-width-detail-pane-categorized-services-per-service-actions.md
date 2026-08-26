---
title: 'EDT Zone — Active Highlight, Fixed-Width Detail Pane, Categorized Services & Per-Service Actions'
type: 'feature'
created: '2026-08-26'
status: 'ready-for-dev'
review_loop_iteration: 0
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/implementation-artifacts/epic-2/spec-2-9-edts-zone-create-switch-modify.md'
  - '_bmad-output/implementation-artifacts/epic-2/spec-2-15-edt-commands-and-action-history.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The EDTs zone's active EDT isn't visually distinguishable from the keyboard cursor, and the flat services list (Story 2.6) forces the developer to cross-reference EDT membership by hand; per-service changes (remove, branch change, add) require opening the full Modify form even for a single field, and the detail pane's "available actions" hint (Story 2.15) is static text that doesn't match what `Enter` actually does.

**Approach:** Give `ListRow` an `active` prop for the tool-wide active EDT; split SERVICES into two Tab-cyclable panes (EDT SERVICES / OTHER SERVICES) partitioned by the *selected* EDT's own member list; add per-service contextual actions (Remove, Change branch, disabled Restart / Add to EDT) that call the existing `modifyEdt` use-case; make the detail pane's hint line reflect the current pane's actual `Enter` behavior.

## Boundaries & Constraints

**Always:**
- `ListRow` gains `active?: boolean` (default `false`): accent-colored, bold label — additive, composes with (never replaces) the existing `selected` cursor treatment.
- EDT selector rows pass `active={entry.ulid === activeEdtUlid}`, independent of cursor position.
- `PaneFocus` becomes 3-way (`'edts' | 'edt-services' | 'other-services'`); `togglePaneFocus` becomes `cyclePaneFocus`, rotating `edts → edt-services → other-services → edts` on `Tab` (base view, no dialog open).
- New pure fn `partitionServicesByEdtMembership(rows, focusedEdt)`: EDT SERVICES = rows whose `path` is in `focusedEdt.members[].repoPath` (client-side against the *selected* EDT — never `row.isMember`, which stays tied to the *active* EDT for its existing divergence badge); OTHER SERVICES = everything else. `focusedEdt` undefined → all rows in OTHER SERVICES with a "No EDT selected" note instead of an empty EDT SERVICES group.
- `Enter` on an EDT SERVICES row opens a contextual menu: **Remove from EDT**, **Change branch for this EDT**, **Restart** (rendered disabled, annotated "Available with Epic 5" — no handler fires).
- **Remove from EDT** confirm → `modifyEdt({ topic: selectedEdt.topic, removeMembers: [repoPath] })`.
- **Change branch for this EDT** confirm (non-empty, via `validateBranchEditValue`) → `modifyEdt({ topic: selectedEdt.topic, setBranches: [{ repoPath, branch }] })`.
- `Enter` on an OTHER SERVICES row opens **Add to EDT**: a branch text-input pre-filled with that service's current branch (from `ServiceBranchDivergence.branch`), editable; confirm → `modifyEdt({ topic: selectedEdt.topic, addMembers: [repoPath], setBranches: [{ repoPath, branch }] })` in one call. Verified in `core/edt/modify.ts`: `addMembers` and `setBranches` for the same `repoPath` in one call already compose correctly — the branch-change is applied to the final member set (post-add) under the lock, so no core change is needed.
- All three actions reuse the existing inline-error/loading/`summarizeFailedResults` treatment and log through `logEdtAction(ulid, 'modify', outcome, detail)` (Story 2.15) — no new action type.
- The detail pane's "available actions" hint (currently hardcoded inside `formatEdtActionHistory` as `"Available: [Enter] Switch  [c] Create  [m] Modify"`) is replaced by a context-derived line: EDT selector → `[Enter] Modify` when the focused row is the active EDT, else `[Enter] Switch`; EDT SERVICES → `[Enter] Remove / Change branch`; OTHER SERVICES → `[Enter] Add to EDT`. Never lists `c`/`m` — they were never wired as direct keys.
- The detail pane's horizontal position/width is already derived once from `ListDetailSplit`'s `flexGrow` ratio (`resolveSplitFlex`), independent of content — confirmed by reading `list-detail-split.tsx`. This story only needs a regression test proving it stays stable across the new longer detail content; no layout change.
- `canEditMemberBranch`'s existing restriction (member of target EDT AND currently selected/checked) no longer covers the new direct-action flows, where "Change branch" targets an existing member outside the big Modify dialog and "Add to EDT" targets a row that isn't a member yet — loosen it (or bypass it for these two new call sites) so branch-editing applies to any candidate the flow already knows is valid, not just an existing-and-checked Modify-dialog row.
- Reuse `ModalDialog` + `ListRow` (contextual menu, arrow-navigable like every other dialog list) and the existing branch-edit text-input pattern (`nextTextInputValue`, `validateBranchEditValue`) — no new component.

**Ask First:** None — the two ambiguities epics.md flagged (branch-edit gate scope; `addMembers`/`setBranches` interaction) were resolved by reading `core/edt/modify.ts` during planning; see Boundaries above and Design Notes.

**Never:**
- Don't touch `core/edt/modify.ts`, `core/ports/edt-registry.ts`, or add any Docker/process-control adapter — Restart stays a visibly disabled label, no handler.
- Don't add scroll/height clamping/truncation to the detail pane — it extends downward to fit content; the terminal's own height is the only limit (existing, not introduced here).
- Don't implement Story 2.19's settings-overridable hidden-actions list — every hint token here is unconditional for this story.
- Don't change `ServiceBranchDivergence.isMember`'s semantics or its divergence-badge usage — it stays tied to the *active* EDT.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Active EDT row rendered, cursor elsewhere | `entry.ulid === activeEdtUlid`, another row is `selected` | row label renders accent+bold (`active`); the cursor row keeps its own accent-bar+`›` treatment | N/A |
| `Tab` with no dialog open | focus on EDT SERVICES | focus moves to OTHER SERVICES (3-way cycle) | N/A |
| No EDT selected/exists | `edtsRows.length === 0` or nothing focused | all services under OTHER SERVICES, "No EDT selected" note, no EDT SERVICES group shown | N/A |
| `Enter` on EDT SERVICES row → Remove | confirmed | `modifyEdt({removeMembers:[path]})` called; success closes menu, action logged `success` | failure → inline error shown, logged `failed` |
| `Enter` on EDT SERVICES row → Change branch, empty value | submitted blank | inline `"Branch name must not be empty"`, no `modifyEdt` call | N/A |
| `Enter` on OTHER SERVICES row → Add to EDT, branch left as pre-filled | confirmed | `modifyEdt({addMembers:[path], setBranches:[{path,branch}]})` in one call; member ends up on the pre-filled branch | partial failure → inline error via `summarizeFailedResults`, logged `failed` |
| Detail pane hint, EDT selector, focused row is active EDT | — | `[Enter] Modify` | N/A |
| Detail pane hint, EDT selector, focused row is not active EDT | — | `[Enter] Switch` | N/A |
| Detail pane hint, focus on EDT SERVICES / OTHER SERVICES | — | `[Enter] Remove / Change branch` / `[Enter] Add to EDT` respectively | N/A |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/shared/components/list-row.tsx` -- add `active?: boolean` to `ListRowProps`; `resolveRowLayout` sets `labelColor: colors.accent, bold: true` when `active` (new field on `ResolvedRow`); `ListRow` passes `bold`/color through to the label `<Text>`
- `src/adapters/driving/tui/shared/components/list-row.test.tsx` -- test `active` alone and composed with `selected`
- `src/adapters/driving/tui/zones/edts/edts-zone.tsx` -- rename `togglePaneFocus`→`cyclePaneFocus` (3-way, `PaneFocus` type widened); add `partitionServicesByEdtMembership`; add contextual-menu dialog state (`kind: 'service-actions'`) and `add-to-edt` dialog state, both reusing the `BranchEditState` shape/text-input handlers; extract hint derivation out of `formatEdtActionHistory` into a new `formatAvailableActionsHint(paneFocus, isFocusedEdtActive)` pure fn; wire `EDT SERVICES`/`OTHER SERVICES` row `Enter` to open the new dialogs; pass `active` to the EDT selector's `ListRow`
- `src/adapters/driving/tui/zones/edts/edts-zone.test.tsx` / `edts-zone.interaction.test.tsx` -- unit tests for `partitionServicesByEdtMembership`, `formatAvailableActionsHint`, `cyclePaneFocus`; smoke/interaction tests for the two new contextual dialogs and the active-highlight row
- `src/adapters/driving/tui/store/app-store.ts` -- no shape change; `modifyEdt` already accepts `addMembers`/`removeMembers`/`setBranches` independently or combined (confirmed at `app-store.ts:470-496`)
- `src/core/edt/modify.ts` -- read-only reference: `addMembers`+`setBranches` for the same `repoPath` in one call compose correctly (branch override applied post-add, under lock — `modify.ts:303-325`); no change needed
- `src/core/ports/edt-registry.ts` -- read-only reference: `EdtMember.repoPath` is the join key against `ServiceBranchDivergence.path`

## Tasks & Acceptance

**Execution:**
- [ ] `src/adapters/driving/tui/shared/components/list-row.tsx` -- add `active` prop + layout resolution -- AC1
- [ ] `src/adapters/driving/tui/shared/components/list-row.test.tsx` -- cover `active` alone and combined with `selected` -- AC1
- [ ] `src/adapters/driving/tui/zones/edts/edts-zone.tsx` -- 3-way `cyclePaneFocus`, `partitionServicesByEdtMembership`, EDT SERVICES/OTHER SERVICES rendering with the "No EDT selected" fallback -- AC4, AC5, AC6
- [ ] `src/adapters/driving/tui/zones/edts/edts-zone.tsx` -- contextual action menu dialog (Remove / Change branch / disabled Restart) wired to `modifyEdt` + `logEdtAction` -- AC7, AC8
- [ ] `src/adapters/driving/tui/zones/edts/edts-zone.tsx` -- Add-to-EDT dialog (pre-filled branch input) wired to `modifyEdt` (`addMembers`+`setBranches`) + `logEdtAction` -- AC9
- [ ] `src/adapters/driving/tui/zones/edts/edts-zone.tsx` -- loosen/bypass `canEditMemberBranch` for the two new direct-action call sites -- AC7, AC9
- [ ] `src/adapters/driving/tui/zones/edts/edts-zone.tsx` -- `formatAvailableActionsHint` replacing the hardcoded hint line, applied to the EDT selector and pass `active` through to its `ListRow` -- AC1, AC3
- [ ] `src/adapters/driving/tui/zones/edts/edts-zone.test.tsx` -- unit tests for all new pure functions (I/O Matrix rows) -- all ACs
- [ ] `src/adapters/driving/tui/zones/edts/edts-zone.interaction.test.tsx` -- real-keypress tests: 3-way Tab cycle, contextual menu open/confirm, Add-to-EDT open/confirm -- AC4, AC7, AC9
- [ ] `src/adapters/driving/tui/zones/edts/edts-zone.tsx` / test -- regression test proving detail-pane width doesn't shift as content grows (longer action history + new hint lines) -- AC2

**Acceptance Criteria:**
- Given the EDT selector, when it renders, then the active EDT's row shows the accent+bold `active` label regardless of cursor position, and the cursor row keeps its own accent-bar+`›` marker independently.
- Given the base EDT-list view (no dialog open), when `Tab` is pressed repeatedly, then focus cycles EDT selector → EDT SERVICES → OTHER SERVICES → EDT selector, each independently arrow/Home/End-navigable.
- Given no EDT is selected, when the services list renders, then every service appears under OTHER SERVICES with a "No EDT selected" note, never an empty EDT SERVICES group.
- Given a row focused in EDT SERVICES, when `Enter` is pressed, then a contextual menu opens with Remove from EDT, Change branch for this EDT, and a visibly disabled Restart annotated "Available with Epic 5".
- Given "Remove from EDT" is confirmed, then `modifyEdt` is called with `removeMembers: [repoPath]` for the selected EDT and the outcome is logged via `logEdtAction`.
- Given a row focused in OTHER SERVICES, when `Enter` is pressed and the branch input is confirmed, then `modifyEdt` is called with both `addMembers` and `setBranches` for that repo in one call and the outcome is logged.
- Given the detail pane's hint line, when focus is on the EDT selector / EDT SERVICES / OTHER SERVICES, then it shows exactly `[Enter] Modify`-or-`Switch` / `[Enter] Remove / Change branch` / `[Enter] Add to EDT` respectively, matching what `Enter` actually does.
- Given the detail pane's content grows (longer action history, new hint line), when re-rendered, then its horizontal position and width are unchanged from before the content grew.

## Spec Change Log

<!-- Empty until the first bad_spec loopback. -->

## Design Notes

**Hint extraction:** `formatEdtActionHistory` currently mixes action-log formatting with a static hint line. Split them: `formatEdtActionHistory` keeps only the in-progress/recent-actions text; a new `formatAvailableActionsHint(paneFocus: PaneFocus, focusedIsActiveEdt: boolean): string` returns the one hint line for whichever pane has focus. The EDTs-zone render joins them with the same `'\n\n'` separator already used today.

**Contextual menu shape:** No new component — a `ModalDialog` containing three `ListRow`s (arrow/Home/End-navigable via the existing `resolveSelectionDirection`/`moveSelection`), `Enter` on the disabled Restart row is a no-op (never dispatches). This mirrors the create/switch/modify dialogs' existing structure rather than introducing a new list-picker component.

**`canEditMemberBranch` loosening:** Rather than widen the check's own signature (used elsewhere by the big Modify dialog's Enter-interpretation, `resolveModifyEnterAction`), the two new flows (contextual "Change branch", "Add to EDT") open their branch-edit text input directly from the row-level `Enter` handler — they don't route through `resolveModifyEnterAction`/`canEditMemberBranch` at all, since they're not inside the Modify dialog's member checklist. Confirm at implementation time whether `canEditMemberBranch` needs any change, or whether the two new call sites simply bypass it entirely (the latter appears sufficient from this investigation, since neither new flow reuses the Modify dialog's member-list Enter dispatch).

## Verification

**Commands:**
- `npm test` -- expected: all suites green, including new `list-row` and `edts-zone` tests
- `npm run typecheck` -- expected: `tsc --noEmit` clean
- `npm run depcheck` -- expected: no boundary violations (touches `src/adapters/driving/tui/**` only; `core/edt/modify.ts` and `core/ports/edt-registry.ts` are read-only references, not edited)

**Manual checks:**
- `node src/bin/tui-back.mjs` (TUI): switch to the EDTs zone; confirm the active EDT's label is accent+bold even when the cursor is on a different row
- `Tab` three times from the EDT selector: confirm it lands on EDT SERVICES, then OTHER SERVICES, then back to the EDT selector
- Focus a member row in EDT SERVICES, press `Enter`, choose Remove: confirm the member disappears from EDT SERVICES and the action appears in the detail pane's recent actions
- Focus a non-member row in OTHER SERVICES, press `Enter`, confirm with the pre-filled branch: confirm the service now appears in EDT SERVICES on that branch
- Browse between EDTs/services with long vs. short detail content: confirm the detail pane's left/right boundary never shifts

## Suggested Review Order

1. `list-row.tsx`'s `active` prop — pure, isolated, no behavior risk
2. `partitionServicesByEdtMembership` + `cyclePaneFocus` — pure functions, directly unit-testable
3. `formatAvailableActionsHint` — pure, replaces the hardcoded hint text
4. Contextual-menu and Add-to-EDT dialog wiring to `modifyEdt`/`logEdtAction` — the actual behavior change
5. Interaction tests end-to-end: Tab cycle → row Enter → dialog confirm → detail pane update
