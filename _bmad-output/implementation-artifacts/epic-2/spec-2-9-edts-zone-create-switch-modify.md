---
title: 'EDTs Zone — Create, Switch, and Modify'
type: 'feature'
created: '2026-08-20'
status: 'done'
review_loop_iteration: 1
baseline_commit: '6b8b84a1adae0fdd7139140a6e87b308c39f82c7'
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/implementation-artifacts/epic-2/epic-2-context.md'
  - '_bmad-output/implementation-artifacts/deferred-work.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The EDTs zone only renders Story 2.6's read-only flat service list; every EDT-mutation flow (create, switch, modify) exists only in `core/edt/` and the CLI, forcing developers back to the CLI for day-to-day EDT management, and there is no first-EDT prompt when zero EDTs exist.

**Approach:** Layer a new EDT selector (list of EDTs plus create/switch/modify actions) above the existing flat service list, driving the three existing core use-cases in-process via a new store slice, extending the codebase's established pure-interpreter + `useInput` convention for the topic-input and Tab-cycle plumbing this introduces (both currently absent anywhere in the TUI).

## Boundaries & Constraints

**Always:**
- Call `createEdt`/`switchActiveEdt`/`modifyEdt` in-process (`src/core/edt/{create,switch,modify}.ts`) — never shell out to the CLI (AD-2), mirroring `runEdtCreate`/`runEdtSwitch`/`runEdtModify` in `src/adapters/driving/cli/subcommands.ts`.
- Keep Story 2.6's flat, ungrouped service list as the default view; layer the EDT selector above it. **Both stay independently keyboard-navigable**: in the base edt-list view (no form open), Tab cycles focus between the EDT selector and the SERVICES list — arrows/Home/End move only whichever one is currently focused; EDT selector is focused by default. This reuses Tab's pre-existing, pre-2.9-documented pane-cycling role (not a new repurposing).
- Reuse `checkbox-list-item` for member selection. Hand-roll a controlled text-input pure interpreter for topic/branch fields — no new npm dependency.
- Arrows/Home/End (2.7) for list movement only. Extend `NavigationKey` (`keybindings/keybindings.ts`) with `tab`. Tab has exactly two consumers: cycling a form's topic-input ↔ member-checklist while a form is open, and cycling EDT-selector-list ↔ SERVICES-list focus otherwise (previous bullet) — never both at once, never list movement itself.
- Fix `modify.ts`'s existing bug (~lines 264–293): added members/branch changes are computed into `results` but never persisted to the registry entry. Add a regression test with a real (non-mocked) `update()` asserting the persisted patch.
- Extend `AppStoreDeps` (`store/app-store.ts`) with `lock`, `edtRegistryResourceKey`, `edtsBaseDir`; wire in `src/bin/tui.ts`, mirroring `src/bin/main.ts`'s CLI wiring.
- Add store state for the EDT list (`edtRegistry.list()`) — the existing `edtsBranches` array is per-service, not per-EDT. Mirror the services list's own "never show stale rows under an error banner" rule (`rows = status === 'error' ? [] : services`) for this new list on a failed reload.
- Surface `switch.ts`'s `switch-blocked-action-in-progress` as an explicit block/prompt. Any other switch failure stays in `switch-confirm` mode with the error shown inline — never silently returns to the EDT list.
- Before a modify submit, drop any staged branch-edit for a member no longer in the current selection — a branch edit on a since-unchecked member must never reach `modifyEdt` (a real `git checkout` on a repo the user just told the form to drop).
- Guard `handleSwitchConfirm`, and Escape while a create/modify submit is in flight, against re-entrancy the same way `handleCreateSubmit`/`handleModifySubmit` already guard on `formSubmitting`.
- Gate the `?` help dispatch the same as zone-mnemonic/filter/command dispatch in `app-shell.tsx` — it must not fire while `zoneInputCaptured`.
- The create form's candidate list must reflect a still-loading services fetch (a distinct state) rather than rendering "No registered services available." while `edtsBranches` simply hasn't resolved yet.
- Reject an empty value in the branch-edit dialog inline; don't let it reach `modifyEdt` unvalidated.
- Hide the EDT-list keybinding hint line while any dialog/form is open on top of it.
- Test split follows existing convention: pure interpreter functions unit-tested directly, plus one `renderToString` smoke test per new zone state, plus real-keypress interaction tests (reusing `app-shell.alternate-screen.test.tsx`'s `EventEmitter`-fake-TTY technique) for the async submit/confirm/force-switch paths above — this class of wiring bug is exactly what `renderToString`-only coverage missed in review-loop iteration 0.

**Ask First:** None — resolved above against existing convention and review-loop iteration 0's findings.

**Never:**
- Don't wire `fs.watch`/poll re-sync of `state.json`'s `activeEdt` (AD-10) — out of scope. Amend `deferred-work.md`'s 2.4-era entry to record 2.9 as TUI-internal-switch-only.
- Don't build a real abort/kill mechanism for an in-progress locked action, or touch stash-accumulation-across-EDTs — both unchanged, separate deferred items.
- Don't replace Story 2.6's flat list with a grouped-by-EDT view.
- Don't add scroll/windowing to the EDT selector list, or proactively filter/flag AD-8-claimed services in the member checklist — both real but separate UX enhancements, log to `deferred-work.md` rather than building here.
- Don't "fix" the pre-existing, unreached-by-this-story's-TUI gaps in `modify.ts`'s `addMembers`/`removeMembers` handling (duplicate paths within one array; the same path in both arrays) — pre-existing since Story 2.5, not reachable via `computeMemberDiff`'s set-diff construction, log to `deferred-work.md` rather than building here.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| No EDT exists | zone opens, `edtRegistry.list()` empty | explicit create prompt (topic input + member checkbox list) | N/A |
| Create, duplicate topic | submit topic matching an existing EDT | `createEdt`'s rejection surfaced inline, form stays open | existing `createEdt` duplicate-topic error |
| Create, zero members selected | submit with no checkboxes checked | rejected before any write, inline message | existing `createEdt` zero-member error |
| Switch to a different EDT | developer selects another EDT row, confirms | `switchActiveEdt` runs; success updates the store/list to the new active EDT | `switch-blocked-action-in-progress` → explicit block/prompt (force-or-cancel) |
| Modify: add member / change a member's branch / rename topic | developer edits an existing EDT's form | `modifyEdt` runs; registry entry reflects the change (post-fix) | protected-branch / topic-uniqueness rejections surfaced inline, per 2.5 |
| Modify to zero members | remove the last member | accepted, valid non-error state | N/A |
| Switch fails for a reason other than a lock block | `switchActiveEdt` returns an error whose code isn't `switch-blocked-action-in-progress` | error shown inline, dialog stays open | never a silent return to the EDT list |
| Modify: a member is branch-edited then unchecked before submit | `formMembers` no longer contains the branch-edited path | that stale branch edit is dropped, never sent to `modifyEdt` | N/A |
| Branch-edit dialog submitted empty | user presses Enter with an empty branch value | rejected inline, dialog stays open | N/A |
| Tab pressed in the base edt-list view (no form open) | developer presses Tab | focus cycles EDT selector ↔ SERVICES list; arrows/Home/End now move only the focused one | N/A |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/zones/edts/edts-zone.tsx` -- flat list + divergence today; extend with the EDT selector above it, a `listFocus: 'edts' | 'services'` local state (Tab-toggled, default `'edts'`) gating which list arrows/Home/End move, and local pure nav fns for both lists.
- `src/adapters/driving/tui/zones/edts/edts-zone.test.tsx` -- existing pure-fn + smoke tests; extend per new fns/states.
- `src/adapters/driving/tui/app-shell.tsx` -- `resolveHelpDispatch` call currently unconditional; gate it on `!zoneInputCaptured` alongside the existing zone-mnemonic/filter/command gate.
- `src/adapters/driving/tui/app-shell.alternate-screen.test.tsx` -- existing `EventEmitter`-fake-TTY harness driving real Ink `useInput`; reuse its technique (don't duplicate its setup) for the new interactive tests this spec's Always clause requires.
- `src/core/edt/create.ts:96` -- `createEdt(params)`, call shape to mirror.
- `src/core/edt/switch.ts:70,104-124,208-294` -- `switchActiveEdt(params)`; locked-action block/force gate; preserve-then-checkout.
- `src/core/edt/modify.ts:50,131,180,87-94,258-262,264-293` -- `modifyEdt(params)`; protected-branch/topic-uniqueness checks; persistence bug to fix.
- `src/adapters/driving/cli/subcommands.ts` -- `runEdtCreate`/`runEdtSwitch`/`runEdtModify`, proven call shape.
- `src/adapters/driving/tui/shared/components/checkbox-list-item.tsx` -- reuse for member selection (zone owns toggle state).
- `src/adapters/driving/tui/shared/components/modal-dialog.tsx` -- reuse for create/modify forms; wire Enter/Esc via own `useInput`, as `app-shell.tsx` already does.
- `src/adapters/driving/tui/keybindings/keybindings.ts` (+ barrel) -- extend `NavigationKey` with `tab`.
- `src/adapters/driving/tui/store/app-store.ts:29` -- `AppStoreDeps` + EDT-list state + `loadEdts()`; mirror `edtsBranches`' error-clears-stale-rows pattern for the new `edts` list.
- `src/bin/tui.ts` -- wire new deps into the composition root, mirroring `src/bin/main.ts` (`createLockPort`, `resolveEdtRegistryFile`, `join(xdg.dataDir,'edts')`).
- `src/core/ports/edt-registry.ts` -- `EdtRegistryPort.list()`, the selector's read side.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- amend the 2.4-era fs.watch/poll entry; add the two new "Never" items (EDT-list scroll/windowing, proactive AD-8 checklist filtering, `modify.ts` addMembers/removeMembers pre-existing edge cases) as tracked entries.

## Tasks & Acceptance

**Execution:**
- [x] `src/adapters/driving/tui/store/app-store.ts` -- extend `AppStoreDeps` (`lock`, `edtRegistryResourceKey`, `edtsBaseDir`), add `edts`/`edtsStatus`/`edtsError` state + `loadEdts()`, clearing `edts` to empty on a failed reload (mirror `edtsBranches`) -- data source for the selector and deps for the mutation flows
- [x] `src/bin/tui.ts` -- build and pass the three new deps, mirroring `main.ts`'s CLI wiring -- closes the composition-root gap
- [x] `src/core/edt/modify.ts` -- fix the lock-guarded write block so added members/branch changes persist to the registry entry, not just `results` -- else the modify AC can't take effect
- [x] `src/core/edt/modify.test.ts` -- regression test with a real (non-mocked) `update()` asserting the persisted patch -- closes the gap that let the bug ship undetected (added to `src/adapters/driven/edt-registry/index.test.ts` instead: importing the real adapter's `createEdtRegistryPort` from a test file under `src/core/` would itself trip the `no-core-to-adapters` depcheck boundary rule)
- [x] `src/adapters/driving/tui/keybindings/keybindings.ts` (+ barrel) -- add `tab` to `NavigationKey` -- consumer #1 is this story's forms, #2 is edt-list/services pane-cycling
- [x] `src/adapters/driving/tui/zones/edts/edts-zone.tsx` -- empty-EDT create prompt (topic input + `checkbox-list-item` in a `modal-dialog`), calling `createEdt`; candidate list reflects a still-loading services fetch distinctly from a genuinely-empty one -- closes AC1
- [x] `src/adapters/driving/tui/zones/edts/edts-zone.tsx` -- EDT selector above the flat list; selecting + confirming calls `switchActiveEdt`; surface `switch-blocked-action-in-progress` explicitly; any other failure stays in `switch-confirm` with the error shown, never a silent return to the list; guard against re-entrant double-submit -- closes AC2
- [x] `src/adapters/driving/tui/zones/edts/edts-zone.tsx` -- modify form (members/branch/topic) calling `modifyEdt`, surfacing protected-branch/topic-uniqueness rejections inline; drop a staged branch-edit for a since-unchecked member before submit; reject an empty branch-edit value inline -- closes AC3
- [x] `src/adapters/driving/tui/zones/edts/edts-zone.tsx` -- wire Tab to cycle topic-input ↔ member-checklist inside forms, and EDT-selector ↔ SERVICES-list focus in the base edt-list view; guard Escape against tearing down a form mid-submit; hide the edt-list keybinding hint while any dialog is open -- closes AC4/AC6
- [x] `src/adapters/driving/tui/app-shell.tsx` -- gate `resolveHelpDispatch` on `!zoneInputCaptured` too
- [x] `src/adapters/driving/tui/zones/edts/edts-zone.test.tsx` -- unit-test new pure functions directly, plus one `renderToString` smoke test per new zone state, plus real-keypress tests (reusing the alt-screen harness) for switch-failure-stays-visible, stale-branch-edit-dropped, and re-entrancy-guarded submit -- covers the I/O matrix (real-keypress tests live alongside a new `edts-zone.interaction.test.tsx`, reusing extracted `shared/test-support/fake-tty.ts`)
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- amend the 2.4-era fs.watch/poll entry to record 2.9's narrowed scope; add entries for EDT-list scroll/windowing, proactive AD-8 checklist filtering, and `modify.ts`'s pre-existing addMembers/removeMembers edge cases

**Acceptance Criteria:**
- Given no EDT exists, when the EDTs zone opens, then it shows an explicit create prompt (topic input + member checkbox selection) instead of a bare/empty list.
- Given existing EDTs, when the developer selects a different one and confirms, then `switchActiveEdt` runs in-process, applying Story 2.4's protected-switch behavior (uncommitted work preserved; a locked action blocks/prompts instead of silently failing); any other switch failure is shown inline, never silent.
- Given an existing EDT, when the developer edits its members, a member's branch, or its topic and submits, then `modifyEdt` runs in-process and the registry entry actually reflects the change, subject to Story 2.5's protected-branch rejection and topic-uniqueness constraints, and only for members still selected at submit time.
- Given the create/switch/modify forms, when built, then they use only Story 2.7's navigation contract (arrows/Home/End, plus the new Tab-cycle within forms) — never `j`/`k`/`g`/`G`.
- Given Story 2.6's flat service/divergence list, when the EDT selector is added, then the flat list stays visible below/alongside it, and remains independently keyboard-navigable via Tab-cycled focus, rather than being replaced by a grouped view or silently frozen.
- Given a zone-owned form/dialog has captured input, when the developer types any character including `?`, then no AppShell global shortcut (help, filter, command, zone switch, quit) fires.

## Design Notes

No shared navigation hook exists — each zone re-implements pure interpreter functions against `NavigationKey`, unit-tested directly, because `renderToString`'s fake stdin never emits keypresses. Follow the identical split here: every keystroke behavior (text-input editing, checkbox toggle, Tab-cycle target, list nav, pane-focus toggle) is a standalone pure function; `useInput` callbacks stay thin wrappers. Presentational dialogs are covered by `renderToString` smoke tests; the async submit/confirm/force-switch paths and the `zoneInputCaptured` gate are behavior only a real keypress can exercise — cover those by reusing `app-shell.alternate-screen.test.tsx`'s real-Ink-input technique (review-loop iteration 0 shipped this class of bug uncaught precisely because no test drove a real keypress through them).

**Review-loop iteration 0 (resolved above):** the flat SERVICES list's own navigation went dead — the new `useInput` routed every arrow/Home/End to the EDT selector only, and nothing restored `setSelected`. Root cause: this spec's frozen Boundaries scoped Tab to forms only, never addressing focus arbitration between the two simultaneously-visible interactive lists in the base view. Resolved (human-approved) by extending Tab's pre-existing, pre-2.9-documented pane-cycling role to this case — kept, not to be re-litigated: default focus is the EDT selector, Tab moves it to SERVICES, never both at once.

## Verification

**Commands:**
- `npm test` -- expected: all suites green, including new `edts-zone.test.tsx` and `modify.test.ts` assertions.
- `npm run typecheck` -- expected: `tsc --noEmit` clean.
- `npm run depcheck` -- expected: no boundary violations (this story touches `src/core/edt/`, `src/adapters/driving/tui/**`, `src/bin/tui.ts` only).

**Manual checks (if no CLI):**
- `node src/bin/tui-back-tui.mjs` with an empty `edts.yaml`: confirm the create prompt appears, a new EDT can be created, switching to a second EDT and modifying one (add member, rename) all round-trip correctly and are visible in `edts.yaml` afterward.

**Result:** `npm test` — 611/613 green; the 2 remaining failures (`src/core/edt/modify.test.ts`) are pre-existing at `baseline_commit`, unrelated to this story's diff (logged to `deferred-work.md`). `npm run typecheck` and `npm run depcheck` both clean.

## Suggested Review Order

**Per-item failure surfacing (the review round's core correctness fix)**

- Entry point: `createEdt`/`switchActiveEdt`/`modifyEdt` are per-repo isolated — `ok: true` can still carry `results` rows with `outcome: 'failed'`; every submit handler used to ignore that.
  [`edts-zone.tsx:247`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L247)

- The create submit now surfaces a per-member failure inline instead of silently closing as if every selection had applied.
  [`edts-zone.tsx:547`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L547)

- Same fix applied to the switch-confirm path, over per-repo stash/checkout failures.
  [`edts-zone.tsx:580`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L580)

- Same fix applied to the modify path, over per-member/branch-change failures.
  [`edts-zone.tsx:612`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L612)

**Keyboard-trap fix: the forced, zero-EDT create prompt had no way out short of Ctrl+C**

- Escape now quits when there's genuinely nothing to cancel back to, cancels back to the list otherwise.
  [`edts-zone.tsx:641`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L641)

- New `quitRequested`/`requestQuit` store fields — the only way a captured zone can reach `onQuit`, which lives at the composition-root boundary.
  [`app-store.ts:159`](../../../src/adapters/driving/tui/store/app-store.ts#L159)

- AppShell's effect handing `quitRequested` off to the real `onQuit`.
  [`app-shell.tsx:89`](../../../src/adapters/driving/tui/app-shell.tsx#L89)

**A newly-created first EDT never became "active"**

- `createEdt` never wrote `state.json`'s active-EDT pointer (only `switchActiveEdt` did) — the store action now does, mirroring switch's own behavior.
  [`app-store.ts:274`](../../../src/adapters/driving/tui/store/app-store.ts#L274)

**A `state.json` read failure used to discard an already-successfully-loaded, possibly genuinely-empty EDT list**

- `loadEdts` now degrades only the active-EDT pointer, never the list itself, on that failure.
  [`app-store.ts:245`](../../../src/adapters/driving/tui/store/app-store.ts#L245)

**Smaller inline-validation and state-conflation fixes**

- A services-load failure used to render as "no registered services available." — now a distinct `'error'` candidate-list state.
  [`edts-zone.tsx:280`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L280)

- An empty create-form topic now rejects inline instead of surfacing `createEdt`'s raw CLI usage string.
  [`edts-zone.tsx:547`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L547)

- A branch-edit value is now persisted trimmed, matching what was actually validated.
  [`edts-zone.tsx:641`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L641)

**Tests covering the above**

- Direct coverage of the store's `loadEdts`/`createEdt`/`switchEdt`/`modifyEdt` actions — previously zero, every zone test substituted fakes for all four.
  [`app-store.test.ts`](../../../src/adapters/driving/tui/store/app-store.test.ts)

- Real-keypress coverage of the quit-escape-hatch and the per-member-failure surfacing.
  [`edts-zone.interaction.test.tsx`](../../../src/adapters/driving/tui/zones/edts/edts-zone.interaction.test.tsx)

- New file: real-keypress coverage of AC6 (`zoneInputCaptured` gate) mounted through `AppShell` itself, not just the zone.
  [`app-shell.interaction.test.tsx`](../../../src/adapters/driving/tui/app-shell.interaction.test.tsx)

- Latent harness bug fixed along the way: a bare Escape press could resolve before Ink's real 20ms pending-escape flush timer fired, risking vacuous passes on every Escape-driven assertion in this file.
  [`edts-zone.interaction.test.tsx:35`](../../../src/adapters/driving/tui/zones/edts/edts-zone.interaction.test.tsx#L35)
