---
title: 'EDT Creation Wizard — Step 4: Activation & Switch Choice'
type: 'feature'
created: '2026-09-29'
status: 'in-progress'
review_loop_iteration: 0
context: []
baseline_commit: 'dc1e4d352cb7a5f6354ffcd8dbd901d87e65cdef'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A TUI create silently becomes the active EDT: the store writes `state.json` directly, with no protected switch and no care for uncommitted work. The create action-log entry also lands in the previously focused EDT.

**Approach:** Wizard Step 4 makes activation explicit. For the first EDT, a new core `activateEdt` pre-flights every repo and pauses on files at risk (Retry / Overwrite / Esc). For later EDTs, the developer chooses "switch now" (through the existing protected switch and the 2.41 resolution dialog) or "create without switching". The store's unconditional active write is removed.

## Boundaries & Constraints

**Always:**
- Story 2.38's ACs in `epics.md` (L1854-1878) are normative: labels, radio, info block, pause panel, logging target.
- At-risk files are `listDirtyPaths(expandUntracked)` ∩ `diffNameOnly(current, target)`. If the current branch is unreadable, `from` is `HEAD`. A repo already on its target has no risk.
- The pre-flight checks nothing out. Its only writes are the FR-8 fetch of a missing shared branch.
- The activation targets reuse switch.ts's rules:
  - a member gets its own branch, gated with `assertAllowedBranch(…, ulid)`;
  - a non-member gets its manifest `sharedBranch`, fetched if missing.
- An overwrite discards only at-risk paths the developer confirmed. When a fresh pre-flight finds any at-risk path outside the confirmed set, it returns `blocked` again and writes nothing.
- Activation writes `state.json` + registry `status: 'active'` under the edts.yaml lock, whatever the per-repo outcomes. One repo's failure never blocks the others (`FailedResultList`).
- `activateEdt` refuses (`activate-has-outgoing`) when an active EDT already exists. After the first EDT, the switch is the only path.
- Every log entry goes to the new EDT's ulid. A total create failure has no new EDT, so nothing is logged.
- Overwrite confirmation mirrors 2.41: it lists every file (scrollable), `Ctrl+E` confirms, and `Enter`/`Esc` mean Retour.
- The CLI `edt create`/`edt switch` behavior is unchanged.

**Ask First:** changing `switchActiveEdt` semantics; changing `create.ts`'s registry `status` on create.

**Never:** a direct `writeActiveEdt` outside `activateEdt`/`switchActiveEdt`; stash tagging in `activateEdt`; `discardAll` from activation; activating after a partial-failure create (the EDT stays inactive, with a message); Story 2.31/2.40/2.42/2.43 scope.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First EDT, clean | 0 EDTs, all repos clean | create → activate → all checked out, active set, wizard closes | — |
| First EDT, harmless dirt | dirty file not in the branch diff | not blocked; checkout carries it | — |
| First EDT, at risk | `a.ts` dirty ∧ differs on target | pause panel lists service + `a.ts`; zero checkouts | — |
| Retry | fixed by hand, `R` | fresh pre-flight → proceeds | still blocked → panel refreshed |
| Overwrite | `E` → confirm `Ctrl+E` | exactly `a.ts` discarded (tracked, staged or untracked), then activation | new at-risk path → panel again |
| Stop | `Esc` on panel | "EDT créé mais non actif"; logged to new ulid; Enter/Esc close | — |
| Later, switch | ≥1 EDT, default radio, Enter | create → handoff to the switch dialog on the new EDT (runs at once) | lock → 2.41 blocked prompt; cancel → EDT stays inactive |
| Later, stay | radio → stay, Enter | create only; active unchanged; logged | — |
| Partial create | a member failed | failed rows + "non activé"; logged `failed` to new ulid | — |
| Repo failure | checkout of `b` fails | others proceed, active set, `b` in `FailedResultList` | — |

</frozen-after-approval>

## Code Map

- `src/core/ports/git.ts` + `src/adapters/driven/git/index.ts` (L55 wiring, near `discardPaths` L563):
  - add `diffNameOnly(repoPath, from, to)`: `git diff --name-only -z from to --`, read-only, not gated;
  - add `discardPathsToHead(repoPath, paths)`: consent-gated. It runs `reset -q -- paths`, then `checkout HEAD -- <paths in HEAD>` (`ls-tree`), then `clean -f -- <rest>`. The existing `discardPaths` (`checkout -- paths`) fails on untracked paths and keeps staged content, so it is not reused.
  - every fake `GitPort` in tests gains both methods: `grep -rl "discardAll:" src`, about 15 files.
- New `src/core/edt/activate.ts` (+ test):
  - `activateEdt({edtRegistry, registry, manifest, git, lock, state, edtRegistryResourceKey, topic, overwrite?: Record<repoPath,string[]>})` → `{status:'blocked', blocked:[{service, repoPath, paths}]} | {status:'activated', ulid, topic, results}`.
  - Extract and export a target helper from `switch.ts`'s `switchMemberRepo`/`switchNonMemberRepo` (L741/L796) so both use one rule. Reuse `failed()`.
- `src/adapters/driving/tui/store/slices/edt-slice.ts`:
  - `createEdt` (L278): delete the `writeActiveEdt` block (L296-307) and keep `loadTabVisibility`;
  - add `activateEdt(params)`: on `activated`, `set({activeEdt})` + `loadTabVisibility`.
  - Tests: `edt-slice.test.ts`, plus `app-store.test.ts` if it asserts the old write.
- `src/adapters/driving/tui/zones/edts/edts-zone.logic.ts`:
  - `CreateDialogState` (L630) gains `activation: ActivationState`;
  - `initialCreateDialog` seeds it.
- `.../create-wizard/wizard.logic.ts` (+ test): pure Step 4 helpers, `STEP_INTROS[4]`, and `nonMemberReturns(candidates, members)` giving service → sharedBranch.
- New `.../create-wizard/activation.logic.ts` (+ test): the Step 4 key reducer (radio, pause panel, confirm scroll) that raises `decision` for the effectful handler, the same pattern as `switch-resolution.logic.ts`.
- `.../create-wizard/create-wizard.tsx`:
  - `submitCreate` (L47) becomes create → branch on `firstEdt`/`choice`, with logs to `result.data.ulid`;
  - `enterStep(4)` captures `firstEdt = edtsRows.length === 0`;
  - `isCreatedWithFailures` (L292) is generalized to a terminal "acknowledge" state;
  - new deps `activateEdtAction` and `startSwitch(target)`.
- `.../create-wizard/step-activation.tsx`: the view for the locked "Oui", the radio + info block + non-member list, the pause panel, the overwrite confirm and the stopped message.
- `.../dialogs/switch-dialog.tsx`: export `startSwitch(target)`. It opens `initialSwitchDialog(target)` (`edts-zone.logic.ts` L921) and calls `handleSwitchConfirm(…, false)` at once.
- `.../edts-zone.tsx` (L505, L574): pass `startSwitch`/`activateEdtAction` into the wizard deps; the target entry comes from the reloaded store `edts`.
- Interaction tests: `edts-zone.interaction.test.tsx`, where Step 4 flows assert the old active write.
- `src/adapters/driving/tui/keybindings/keybindings.ts` (+ test), `EXPERIENCE.md`: document Step 4's Space/↑↓, R/E/Esc and Ctrl+E.
- `_bmad-output/implementation-artifacts/deferred-work.md` L96: add `resolved_by: Story 2.38`.

## Tasks & Acceptance

**Execution:**
- [ ] `git.ts`, `git/index.ts` (+ real-repo tests), test fakes -- `diffNameOnly`, `discardPathsToHead` -- the pre-flight and a correct path-scoped discard.
- [ ] `core/edt/switch.ts`, `core/edt/activate.ts` (+ test) -- shared target helper; blocked/activated use-case covering every matrix row at core level.
- [ ] `edt-slice.ts` (+ test) -- remove the active write, add `activateEdt`.
- [ ] `edts-zone.logic.ts`, `wizard.logic.ts`, `activation.logic.ts` (+ tests) -- state, pure helpers, reducer.
- [ ] `create-wizard.tsx`, `step-activation.tsx`, `switch-dialog.tsx`, `edts-zone.tsx` -- flows, view, handoff.
- [ ] Interaction tests -- first EDT clean/blocked/retry/overwrite/stop; later switch (handoff), stay, partial create; log target.
- [ ] `keybindings.ts` (+ test), `EXPERIENCE.md`, `deferred-work.md` -- docs.

**Acceptance Criteria:**
- Given any TUI create, when it completes, then `state.json` changes only through `activateEdt` or `switchActiveEdt`.
- Given "Basculer immédiatement", when a dirty state-2/3 repo exists, then the 2.41 resolution view opens for the new EDT.
- `npm run typecheck && npm test && npm run depcheck` pass.

## Design Notes

- `ActivationState`:
  - `firstEdt`, `choice: 'switch'|'stay'`, `created: {ulid, topic} | null`;
  - `blocked: BlockedRepo[] | null`, `confirm: {scroll} | null`;
  - `outcome: 'stopped' | 'not-activated' | null`, `decision`.
- Once `created` is set, Retry/Overwrite call only `activateEdt`, never `createEdt` again.
- The switch handoff replaces the wizard dialog. The switch dialog's own results and logging (2.41) apply unchanged.

## Verification

**Commands:**
- `npm run typecheck && npm test && npm run depcheck` -- expected: all green

**Manual checks:**
- In a real terminal: first EDT with an at-risk file (Retry, Overwrite, Esc), and a later EDT with switch/stay.
