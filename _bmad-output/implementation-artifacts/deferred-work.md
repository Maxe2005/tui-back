# Deferred Work

## Deferred from: spec-filterable-pick-list-shared-component (2026-09-30)

- source_spec: `_bmad-output/implementation-artifacts/no-epic/spec-filterable-pick-list-shared-component.md`
  summary: `branch-picker.tsx`'s `FilterableBranchList` (pick-existing mode) is a third hand-written filter-and-select list that does not yet render through the shared `FilterablePickList`.
  evidence: kept out of scope by the spec's own Never tier (same two-step split as the branch-autocomplete component: shared component first, adoption as a follow-up spec). `FilterableBranchList` still draws its own `› ` rows and the picker still owns its own `pickCursor` handling (`handlePickExistingKey`). **Track:** a follow-up adoption spec, which also has to decide whether the picker's prefix/substring conventions converge with the shared filter.

## Deferred from: review of 3-11-update-commands-main-all-repos-single-service (2026-09-29)

- source_spec: `_bmad-output/implementation-artifacts/epic-3/spec-3-11-update-commands-main-all-repos-single-service.md`
  summary: A future epic-2 → epic-3 merge must reconcile two parallel implementations of the command zone-switch (`runCommand()` + `zoneId`) and the filterable quick-pick (update-service pick vs 2.30 EDT pick).
  evidence: the 3.11 spec required syncing epic-2 first, but epic-2 has diverged (wizard stories 2.35-2.38), so 3.11 built the assumed contracts locally in `src/adapters/driving/tui/shared/command-bar.tsx` (`runCommand`) and `src/adapters/driving/tui/zones/update/` (service pick) instead of reusing epic-2's `670bfcb`/`7fcf592` — a side-effect fix to `edt-switch <topic>` arg dispatch is also bundled in. Surfaced by design (documented in the spec's own task 1 DONE AS), not by review layers.
  resolved_by: the 2026-09-30 epic sync merge `5557b8a` (command zone-switch — `command-bar.tsx`'s `runCommand` now delegates to `commands.ts`'s) and `_bmad-output/implementation-artifacts/no-epic/spec-filterable-pick-list-shared-component.md` (2026-09-30, quick-pick — both dialogs now render through the shared `FilterablePickList`).
- source_spec: `_bmad-output/implementation-artifacts/epic-3/spec-3-11-update-commands-main-all-repos-single-service.md`
  summary: Duplicate service names across managed repos have no disambiguation in the `:update-service <name>` path — it resolves to the first match with no ambiguous-name handling.
  evidence: `src/adapters/driving/tui/store/slices/update-slice.ts`'s `openSingleServiceConfig` returns the first case-insensitive match in both the EDT-member and registry loops; the same duplicate-name collision is already tracked for the Update zone's outcome map (see 3-6 deferred entries). Surfaced by blind-hunter review layer.

## Deferred from: sprint-change-proposal-2026-09-24-2 (edt switch three-state model) (2026-09-24)

- source_spec: `_bmad-output/planning-artifacts/sprint-change-proposal-2026-09-24-2.md`
  summary: Removing a member from an EDT (Story 2.24 modify / 2.29 delete) while a stash tagged `tui-back:<that ulid>` is still pending for that repo leaves the stash orphaned — nothing pops it once the repo is no longer a member of that EDT.
  evidence: state-1 stashes (Story 2.39) and adopt stashes are popped only by a switch into the owning EDT where the repo is still a member (`switchMemberRepo`). Not introduced by this change (same gap exists today for member stashes) but made more reachable by adopt. **Track:** on member removal / EDT delete, either warn about a pending tagged stash (`git.hasStash`) or offer to restore/drop it.

## Deferred from: review of 2-30-edt-quick-pick-filterable-list-for-edt-switch-edt-modify (2026-09-23)

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-30-edt-quick-pick-filterable-list-for-edt-switch-edt-modify-edt-delete.md`
  summary: The quick-pick's `dialog.cursor` is a raw index into a match list recomputed fresh from the live store on every render/keypress, but `cursor` itself only updates on an arrow-key press or an actual filter-text edit — if `edtsRows`/`activeEdtUlid` change from a concurrent source (AD-10: `state.json` + `fs.watch` syncs a CLI-driven change into an open TUI) while the dialog is open and idle, the list can shrink/reorder under an unmoved cursor.
  evidence: `quick-pick-dialog.tsx`'s `handleQuickPickDialogInput` only clamps `cursor` inside the Up/Down and text-edit branches (`moveSelection`, and `nextCursor = edited.value === current.query ? current.cursor : 0`); Enter's `matches[current.cursor]` guards only the exact `undefined` case (list shrank below the cursor), not a same-length reorder. Surfaced by edge-case-hunter + blind-hunter independently. In practice `QuickPickDialogView` re-renders live, so whatever is highlighted at Enter-time is what gets selected (no display/selection mismatch) — the risk is narrow (requires a concurrent external EDT mutation while the picker sits open and idle) and shared by every other positional-cursor list in this codebase (branch-picker's `pickCursor`, delete-dialog's `memberCursor`, the base EDT list's own focus tracking), none of which re-derive cursor identity against a live-reordering source either. **Track:** worth a codebase-wide look at cursor-by-identity vs. cursor-by-index for live-synced lists, not a fix scoped to this story alone.

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-30-edt-quick-pick-filterable-list-for-edt-switch-edt-modify-edt-delete.md`
  summary: The spec's own Code Map named `edts-zone.styles.test.tsx`/`edts-zone.layout.test.tsx` among the "tests to extend" for the new `quick-pick` dialog kind (mirroring spec-2-29's pattern), but the Tasks & Acceptance checklist only required `.test.tsx`/`.interaction.test.tsx`, and the implementation followed the narrower Tasks list — so the new dialog kind has zero styles/layout coverage.
  evidence: Flagged by blind-hunter; internal inconsistency between this spec's own Code Map and its Tasks section. Low risk (378 tests across the two extended files already exercise the dialog's behavior and one rendering snapshot), but worth closing the gap if `edts-zone.styles.test.tsx`/`.layout.test.tsx` turn out to assert something dialog-kind-specific that would have caught a real regression.

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-30-edt-quick-pick-filterable-list-for-edt-switch-edt-modify-edt-delete.md`
  summary: No test opens quick-pick when the candidate pool is genuinely empty (not just filtered-to-zero) — reachable in switch mode whenever exactly one EDT exists total (it's active, so the non-active candidate pool is `[]`).
  evidence: Flagged by blind-hunter. In the zero-*total*-EDTs case the zone's pre-existing "auto-open the create dialog" guard (`edts.length === 0 && dialog.kind === 'none'`, edts-zone.tsx:321) fires first and quick-pick can never open at all, so that sub-case is unreachable — but the "exactly 1 EDT, it's active" sub-case for switch mode specifically *is* reachable and untested.
  resolved_by: `_bmad-output/implementation-artifacts/no-epic/spec-filterable-pick-list-shared-component.md` (2026-09-30). `edts-zone.test.tsx` now opens the switch-mode pick with a single, active EDT and asserts the empty-pool line; the shared reducer's own tests cover Enter/Esc on an empty pool.

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-30-edt-quick-pick-filterable-list-for-edt-switch-edt-modify-edt-delete.md`
  summary: `QuickPickDialogView` renders the identical "No matching EDT" wording whether the pool is genuinely empty (nothing to select, ever, for this mode) or just the current filter text matches nothing — unlike the base EDT list's own distinct "No EDTs yet." message for its own true-empty state.
  evidence: Flagged by blind-hunter. Not incorrect, just imprecise in the genuinely-empty-pool case (most reachable for switch mode with exactly one, active, EDT — see the entry above). Cosmetic wording polish, not a behavior bug.
  resolved_by: `_bmad-output/implementation-artifacts/no-epic/spec-filterable-pick-list-shared-component.md` (2026-09-30). The shared `FilterablePickList` takes two distinct lines — the EDT pick shows "No EDT to select" for an empty pool and keeps "No matching EDT" for a filter matching nothing.

## Deferred from: review of 3-8-manifest-defined-clean-restart-recipe (2026-09-24)

- source_spec: `_bmad-output/implementation-artifacts/epic-3/spec-3-8-manifest-defined-clean-restart-recipe.md`
  summary: `runRestart` (like the migration and container adapters it mirrors) runs `spawnSync` with no timeout — a hanging recipe command blocks the group update forever.
  evidence: `src/adapters/driven/restart/index.ts`'s `spawnSync` call has no `timeout` option, matching `src/adapters/driven/migration/index.ts:42` and `src/adapters/driven/container/index.ts:29` exactly — a codebase-wide spawn-timeout decision, not a single-adapter fix. Surfaced by blind-hunter + edge-case-hunter review layers.

- source_spec: `_bmad-output/implementation-artifacts/epic-3/spec-3-8-manifest-defined-clean-restart-recipe.md`
  summary: `spawnFailureDetail` reports a signal-killed child as a bare `unknown error` instead of naming the signal.
  evidence: `src/adapters/driven/restart/index.ts`'s null-status branch reads only `result.error.message/code`, which are undefined on signal kills (only `result.signal` is set) — the migration/container adapters share the identical shape, so fixing one adapter alone would diverge the trio. Surfaced by edge-case-hunter review layer.

## Deferred from: review of 3-6-update-zone-shell-service-list-live-status (2026-09-22)

- source_spec: `_bmad-output/implementation-artifacts/epic-3/spec-3-6-update-zone-shell-service-list-live-status.md`
  summary: `pollServiceHealth` (update-slice.ts) has no try/catch around `deps.manifest.load`/`getServiceHealth` — an unexpected throw (vs. a returned `err(...)` Result) would produce an unhandled promise rejection instead of the intended silent per-poll no-op.
  evidence: this mirrors `logs-slice.ts`'s own `pollPaneHealth`, which has the identical gap — the Code Map explicitly directed 3.6 to mirror that existing pattern, so the root cause (no defensive try/catch around a poll cycle) predates this story. Surfaced incidentally by blind-hunter and edge-case-hunter review layers.

- source_spec: `_bmad-output/implementation-artifacts/epic-3/spec-3-6-update-zone-shell-service-list-live-status.md`
  summary: The health-poll timer has no cancellation/generation guard — a poll cycle already in flight when `stopUpdateHealthPolling` runs (or `startUpdateHealthPolling` restarts with a new service list) can still resolve afterward and write a now-stale value into `updateServiceHealth`.
  evidence: same shape as `logs-slice.ts`'s own health-poll timer, which has no such guard either — pre-existing pattern this story's Code Map directed it to mirror. Surfaced incidentally by blind-hunter and edge-case-hunter review layers.

- source_spec: `_bmad-output/implementation-artifacts/epic-3/spec-3-6-update-zone-shell-service-list-live-status.md`
  summary: `UpdateZone`'s `runningMembers` (and now, via this story, the new per-service `isTargeted` status derivation) is computed from the currently *active* EDT, not from the EDT the in-flight run actually targets (`updateUlid`) — switching the active EDT while a scoped run is in progress can misattribute the `updating` status to the wrong EDT's services.
  evidence: `runningMembers = edts?.find((entry) => entry.ulid === activeEdt)?.members ?? []` already existed before 3.6 (it fed the pre-existing running-spinner rows in stories 3.1-3.4) — this story only reused it to also drive the new status glyphs, so it did not introduce the root cause, just widened where it's visible. No guard anywhere in the TUI blocks switching the active EDT while `runInProgress` is true (confirmed: only the `q`/`:quit` gate reads `runInProgress`). Surfaced incidentally by blind-hunter and edge-case-hunter review layers.

- source_spec: `_bmad-output/implementation-artifacts/epic-3/spec-3-6-update-zone-shell-service-list-live-status.md`
  summary: `updateServiceHealth`/`lastServiceOutcomes` entries are never pruned when a service leaves the currently-tracked list (e.g. active EDT membership changes), so stale entries can persist and, on a very unlikely repoPath/service reuse, render an out-of-date glyph.
  evidence: low real-world impact (the tracked set is bounded by the manifest registry's own service count, not unbounded growth), but confirmed no pruning logic exists in either `startUpdateHealthPolling` or the `lastServiceOutcomes` merge. Surfaced incidentally by blind-hunter and edge-case-hunter review layers.

- source_spec: `_bmad-output/implementation-artifacts/epic-3/spec-3-6-update-zone-shell-service-list-live-status.md`
  summary: `lastServiceOutcomes` is keyed by bare `service` name; two repos sharing the same service name within one EDT (an already-acknowledged possibility elsewhere in this codebase) collide, and one's outcome silently overwrites the other's in the Update zone's new detail pane/status glyph.
  evidence: `update-zone.tsx`'s own pre-existing `updateResults.map` already carries the comment "Duplicate service names occur within one EDT — key by service + index" — this is a known, pre-3.6 possibility. The root cause is that `GroupUpdateRepoResult` (from `group-update.ts`, story 3.1/3.2) never carries a repoPath to disambiguate by, and this spec explicitly put `group-update.ts` out of bounds ("Never: do not touch group-update.ts"), so a real fix is out of this story's scope. Surfaced incidentally by edge-case-hunter review layer.

## Deferred from: code review of 2-32-text-input-line-cursor-navigation-app-wide-adoption (2026-09-17)

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-32-text-input-line-cursor-navigation-app-wide-adoption.md`
  summary: Cursor indexing throughout `TextInputLine`'s slicing, `nextTextInputValue`, and `branch-picker.tsx`'s local `applyTextInput` operates on raw UTF-16 code units with no surrogate-pair/combining-mark awareness, so mid-string cursor positioning (new in this story) can land between the two halves of a surrogate pair or split a combining sequence for any free-text field containing non-ASCII characters (the topic field especially).
  evidence: `src/adapters/driving/tui/shared/components/text-input-line.tsx`'s `value.slice(position, position + 1)` and both `nextTextInputValue` (`edts-zone.logic.ts`) and `applyTextInput` (`branch-picker.tsx`)'s Left/Right/Backspace/Delete all index by raw string length/slice, never by code point. Surfaced incidentally by review (blind-hunter + edge-case-hunter); pre-story `TextInputLine` had no mid-string positioning at all (trailing-only), so this specific failure mode is new, but a full fix (code-point-aware stepping via `Array.from`/`Intl.Segmenter`) is non-trivial and out of this story's frozen scope. **Track:** revisit if a real topic/branch name with emoji or combining characters is ever observed hitting this.

## Deferred from: planning of 2-32-text-input-line-cursor-navigation-app-wide-adoption (2026-09-17)

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-32-text-input-line-cursor-navigation-app-wide-adoption.md`
  summary: Migrate `command-bar.tsx`'s query input and `repo-registry-screen.tsx`'s root-path field onto the now-cursor-aware `TextInputLine`/`nextTextInputValue` (replacing their own hand-rolled `typeCommandQueryChar`/`backspaceCommandQuery` and `typeRootInputChar`/`backspaceRootInput` pairs), plus making `TextInputLine`'s `label` prop optional for the command bar's label-less rendering.
  evidence: the full story 2.32 spec (core cursor primitive + EDT-zone/branch-picker adoption + these two migrations + optional label) measured ~2503 tokens, well past the 1600-token scope-standard threshold. The story's own implementation notes already sequence these two migrations after the EDT-zone/branch-picker work ("Sequence command-bar/registry-screen migrations after the EDT-zone fields are done, so the extended `nextTextInputValue` contract is proven first where it has the most callers"), making this a natural, low-risk split point rather than an artificial one.

## Deferred from: review of 2-26-branch-picker-3-explicit-modes-pick-existing-create-new-rename-current (2026-09-16)

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-26-branch-picker-3-explicit-modes-pick-existing-create-new-rename-current.md`
  summary: `FilterableBranchList` has no truncation, pagination, or scroll handling — a repo with a large number of local branches renders every match with no windowing, which can overflow the terminal.
  evidence: `src/adapters/driving/tui/shared/components/branch-picker.tsx`'s `FilterableBranchList` maps over every filtered branch unconditionally. Surfaced incidentally by review (blind-hunter); not required by the story's frozen scope, which specifies filtering but not a branch-count ceiling. **Track:** windowing/scroll pass once real branch counts make it a felt problem, ideally alongside the EDTs-zone list's own pre-existing lack of windowing (see 2-9's deferred entry above).
- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-26-branch-picker-3-explicit-modes-pick-existing-create-new-rename-current.md`
  summary: When `listBranches` fails (`branchesStatus === 'error'`), switching to Pick-existing silently renders an empty list indistinguishable from "this repo has no other branches" — no error indication or retry/refetch affordance.
  evidence: `src/adapters/driving/tui/shared/components/branch-picker.tsx` shows "Failed to load branches." at the top level but nothing blocks entering Pick-existing mode with `branches` still `[]`. Surfaced incidentally by review (blind-hunter); the frozen spec doesn't address the `listBranches`-failure UX. **Track:** decide the desired error-state UX (disable Pick-existing entirely vs. show the error inline in the list) next time this component is touched.
- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-26-branch-picker-3-explicit-modes-pick-existing-create-new-rename-current.md`
  summary: `GitPort.renameBranch`'s check-then-act sequence (`showRef(newName)`, `showRef(oldName)`, then `git branch -m`) has an inherent TOCTOU gap — a ref deleted/created externally between checks and the actual rename isn't handled or tested.
  evidence: `src/adapters/driven/git/index.ts`'s `renameBranch`. Surfaced incidentally by review (blind-hunter); the same check-then-act shape already exists in this codebase's pre-existing `createBranch`, so this isn't a risk newly introduced by this story. **Track:** address at the `GitPort` level (e.g. atomic rename with race detection) if it's ever hit in practice, covering both `createBranch` and `renameBranch` together.

## Deferred from: dev of 2-9-edts-zone-create-switch-modify (2026-08-20)

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-9-edts-zone-create-switch-modify.md`
  summary: The EDT selector list has no scroll/windowing — every registered EDT renders as a row, unbounded.
  evidence: `src/adapters/driving/tui/zones/edts/edts-zone.tsx`'s EDT-selector `.map` over `edtsRows` has no visible-window slicing, mirroring the flat SERVICES list's own pre-existing lack of one (story 2.6). Explicitly out of this story's scope (spec's Never list: "Don't add scroll/windowing to the EDT selector list ... real but separate UX enhancements"). **Track:** a scroll-window pass across both EDTs-zone lists together, once real EDT/service counts make it a felt problem.
- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-9-edts-zone-create-switch-modify.md`
  summary: The create/modify forms' member checklist never proactively filters or flags a service already claimed as another EDT's own branch (AD-8) — a developer can check a candidate that `assertAllowedBranch`'s cross-EDT gate will later reject at submit time, discovering the conflict only from the inline error, not from the checklist itself.
  evidence: `src/adapters/driving/tui/zones/edts/edts-zone.tsx`'s candidate rendering (`candidates.map(...)` in both the create and modify dialogs) shows every registered service uniformly, with no per-row "already claimed by EDT X" annotation. Explicitly out of this story's scope (spec's Never list). **Track:** a checklist-level AD-8 conflict hint, once the EDTs zone has a cheap way to know every other EDT's member set without an extra round-trip per keystroke.
- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-9-edts-zone-create-switch-modify.md`
  summary: `modify.ts`'s pre-existing `addMembers`/`removeMembers` edge cases (a duplicate path within one array; the same path present in both arrays) are still unhandled — not reachable via the TUI's modify form (`resolveModifyOps` derives `addMembers`/`removeMembers` as a clean set-diff against the current selection, so it can never itself produce a duplicate-within-array or a path in both arrays), but still reachable via the CLI's hand-rolled `edt modify --add-member`/`--remove-member` flag repetition.
  evidence: `src/core/edt/modify.ts`'s add/remove loops (unchanged by this story) do no such de-duplication or cross-array conflict check; pre-existing since story 2.5. Explicitly out of this story's scope (spec's Never list: "Don't 'fix' the pre-existing, unreached-by-this-story's-TUI gaps ..."). **Track:** decide the CLI-side semantics (reject vs. last-write-wins vs. add-wins-over-remove) the next time `modify.ts`'s core logic is touched.
- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-9-edts-zone-create-switch-modify.md`
  summary: Creating a *second* (or later) EDT from the TUI is not wired — the EDTs zone's create dialog only ever opens automatically when the registry is genuinely empty (AC1's literal "no EDT exists" trigger); there is no populated-view affordance to create another one.
  evidence: `src/adapters/driving/tui/zones/edts/edts-zone.tsx`'s only path to `dialog.kind === 'create'` is the zero-EDT auto-open effect; Enter on an existing EDT row always opens switch-confirm or modify, never create. This story's Tasks/AC text scopes the create-prompt requirement to the empty-registry case specifically, and the canonical keybinding contract (arrows/Home/End/Tab/Space/Enter/Esc only) leaves no free key for a "new EDT" action in the populated view without inventing one outside that contract. **Track:** the CLI (`tui-back edt create`) remains the only way to create a second EDT until a future story either grows the keybinding contract or repurposes an existing affordance for it. **tracked_by:** Story 2.15 (entry point, shipped) + Story 2.38 (explicit activation choice; the store's unconditional active-pointer write is removed there) — Sprint Change Proposal 2026-09-24.
  resolved_by: Story 2.38 (2026-09-29). The store's `createEdt` no longer writes `state.json`'s active pointer; the create wizard's Step 4 makes activation explicit — a first EDT goes through the new `core/edt/activate.ts` (pre-flight of files at risk, Retry / Overwrite / Esc), a later one is either handed to the protected switch (`switchActiveEdt`, Story 2.41 resolution dialog) or created without switching. Second-EDT creation from the TUI itself shipped with Story 2.15's entry point.
- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-9-edts-zone-create-switch-modify.md`
  summary: Two pre-existing tests in `src/core/edt/modify.test.ts` fail independently of this story — `rejects adding a member on a shared branch` and `fails with edt-not-found for unknown topic`.
  evidence: Confirmed by checking out `src/core/edt/modify.test.ts` at this story's `baseline_commit` (`6b8b84a`, unchanged by this story's diff) and re-running it standalone: the same 2 failures reproduce. Root causes are test-file bugs pre-dating this story: (1) the shared-branch test's mock `currentBranch` gates on `repoPath.endsWith('-shared')` but the test passes `/repos/shared-repo`, which doesn't match, so the mock never returns the shared branch the assertion expects; (2) the edt-not-found test passes no operation (`addMembers`/`removeMembers`/`setBranches` all empty, `renameTo` undefined), so `modifyEdt` fast-fails on `hasOp` with `invalid-argument` before ever reaching the existence check the test means to exercise. **Track:** fix both mock/fixture bugs (not `modify.ts` itself) the next time `modify.test.ts` is touched.

## Deferred from: code review of 2-9-edts-zone-create-switch-modify (2026-08-24)

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-9-edts-zone-create-switch-modify.md`
  summary: The create/switch/modify submit handlers' re-entrancy guards (`if (current.submitting) return;`) read the dialog state closed over by that render's `useInput` callback — two keypresses delivered within the same stdin `data` chunk (key-repeat, paste, or any batching input source) before React re-renders could both read `submitting === false` and both fire the async use-case call.
  evidence: `src/adapters/driving/tui/zones/edts/edts-zone.tsx`'s `submitCreate`/`handleSwitchConfirm`/`submitModify` all guard the same way. The interaction tests (`edts-zone.interaction.test.tsx`) only verify the guard by explicitly `await`ing a render flush between every keystroke (`press()`'s own definition), which structurally cannot exercise a same-chunk double-delivery. Not introduced by this story (the create path's guard, `submitCreate`, predates the switch/modify ones added here) — a systemic characteristic of every dialog's re-entrancy guard in this codebase, not specific to 2.9. **Track:** if double-submits are ever observed in practice, the fix is a ref-based (not state-based) in-flight flag, checked and set synchronously before the first `await`.
- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-9-edts-zone-create-switch-modify.md`
  summary: `handleCreateInput`/`handleModifyDialogInput` never check `current.submitting` before processing Tab/Space/text-typing/arrow keys — only Enter (submit) and Escape are guarded. While "Creating…"/"Saving…" is shown, the user can keep editing the topic field or toggling members; those edits update `dialog` state but have no effect on the already-in-flight request (whose payload was captured pre-submit), so the visible "in progress" state doesn't actually freeze the form.
  evidence: `src/adapters/driving/tui/zones/edts/edts-zone.tsx`'s `handleCreateInput`/`handleModifyDialogInput` gate only `key.tab`/`key.escape`/the members-jump/direction branches on being reached at all, none of them check `current.submitting`. Cosmetic (no data corruption — the in-flight request's payload was already captured), not a correctness bug. **Track:** disable all non-Escape input while `submitting` is true, the next time these forms are revisited.
- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-9-edts-zone-create-switch-modify.md`
  summary: `modify.ts`'s `results` can misreport what was actually persisted under a race between the pre-lock add-member/set-branch computation and the lock-guarded write: a concurrent modify that already added the same member first causes this call's add to be silently skipped (`existingPaths.has(...)`) under the lock, but the pre-computed `results` entry for that member still reads `outcome: 'added'`, unchanged, in the response. The same applies to duplicate `setBranches` entries for the same path (CLI-only, via repeated `--set-branch`, not reachable through this story's TUI form) — `branchByPath`'s `Map` collapses duplicates to the last value under the lock, but every duplicate still gets its own "branch-changed" row in `results`.
  evidence: `src/core/edt/modify.ts` lines ~300-322 (the lock-guarded add/branch-change application) vs. the pre-lock `results` push at lines ~166-171/255-260 — the two are computed at different times and never reconciled. Pre-existing structural characteristic of `modify.ts`'s pre-lock-compute / lock-write split (not introduced by this story, which only fixed the *persistence* of these already-computed results, not the narrow race in what they report). **Track:** revisit if a concurrent-modify race is ever observed causing a user-visible "added" that didn't actually apply.
- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-9-edts-zone-create-switch-modify.md`
  summary: A member of an EDT whose backing repo has since been deregistered from the managed-repo registry becomes invisible and unremovable in the modify form's member checklist — the checklist only renders from the flat SERVICES list (registered repos), while the EDT's actual persisted member set can contain a path no longer in it.
  evidence: `src/adapters/driving/tui/zones/edts/edts-zone.tsx`'s modify checklist renders from `candidates` (`= rows`, the registered-repo list), while `selectedMembers` seeds from `target.members` (the EDT's real members); a deregistered member's path stays silently present in `selectedMembers`/persists on every submit, with no checklist row to see or uncheck it from. A real but narrow edge case (repo deregistered out from under an EDT that still references it) — no test covers it. **Track:** either surface orphaned members as a distinct (unregistered, greyed) checklist row, or a dedicated "remove orphaned member" affordance, next time this form is revisited.
- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-9-edts-zone-create-switch-modify.md`
  summary: `zoneInputCaptured` is set from a passive `useEffect` keyed on `dialogOpen`, not synchronously with `setDialog(...)` — a keystroke arriving in the gap between a dialog opening and that effect committing could theoretically still reach AppShell's global dispatch instead of the zone.
  evidence: `src/adapters/driving/tui/zones/edts/edts-zone.tsx`'s `useEffect(() => { setZoneInputCaptured(dialogOpen); }, [dialogOpen, setZoneInputCaptured])`. The interaction test suite works around this by inserting a second `waitUntilRenderFlush()` "to let both effects settle before asserting" rather than proving the gap can't be hit by an adversarial input timing. A real fix (setting `zoneInputCaptured` synchronously in the same state update that opens the dialog, e.g. by moving it into the store alongside `dialog`) is a larger refactor than this story's scope. **Track:** revisit if a real dropped-keystroke-into-global-dispatch report ever surfaces.
- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-9-edts-zone-create-switch-modify.md`
  summary: `EdtsZone`'s test-only injection props (`initialPaneFocus`, `initialDialogKind`) are ordinary, unguarded exported props — nothing prevents a future production caller from passing them and silently changing the zone's bootstrap state (e.g. auto-opening a dialog).
  evidence: `src/adapters/driving/tui/zones/edts/edts-zone.tsx`'s `EdtsZone` component signature accepts both with no runtime or type-level guard restricting them to test callers; only the doc comment says "test-only." Cosmetic/dev-hygiene, not a runtime defect (the only current caller, `app-shell.tsx`, never passes either). **Track:** if this pattern spreads to more zones, consider a shared `__test` props bag convention that's harder to reach for accidentally, rather than a per-zone ad hoc prop.

## Deferred from: code review of 2-8-fullscreen-tui-rendering (2026-08-20)

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-8-fullscreen-tui-rendering.md`
  summary: `src/bin/tui.ts`'s own `render()` call — the actual production wiring that passes `alternateScreen: true` to Ink — is never exercised by any test; nothing would fail if that flag were dropped, renamed, or misspelled during a future refactor.
  evidence: `tui.ts` is a top-level-await composition-root script (checks `process.stdin.isTTY`, acquires a real lock, wires all driven ports) that `tui-back.e2e.test.ts` already documents as unexercised for the same reason (no pty lib, `spawnSync`'s piped stdin trips the `isTTY` guard). The new `app-shell.alternate-screen.test.tsx` calls `render()` directly with its own hard-coded `alternateScreen: true`, so it verifies Ink's mechanism but not that `tui.ts` actually passes the option through. Closing this within the story's bounded "two prop/option additions" scope would need extracting the composition root's `render()` options into an importable, independently-testable unit — an architecture change beyond what the approved sprint-change-proposal scoped. **Track:** revisit if `tui.ts` is ever refactored to separate composition wiring from process-lifecycle side effects (e.g. for the pty-based e2e coverage story eventually), at which point this option can be asserted directly.
- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-8-fullscreen-tui-rendering.md`
  summary: The real `q`/Ctrl+C quit paths (`onQuit` → `process.exit(0)`, and Ink's own `exitOnCtrlC` handler) are not exercised by any test — `app-shell.alternate-screen.test.tsx` verifies alt-screen restoration only via a direct `instance.unmount()` call, a narrower proxy for the same `signal-exit`-patches-`process.exit` mechanism.
  evidence: testing a real `process.exit()`/SIGINT path in-process, without killing the test runner, is inherently difficult without a pty (same documented constraint as the composition-root gap above); the Design Notes' reasoning for trusting this path rests on `signal-exit`'s well-known patching behavior, not on new code this story adds. **Track:** covered only by the manual verification step in the spec until a pty-based e2e story exists.
- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-8-fullscreen-tui-rendering.md`
  summary: `FakeTtyStdout`/`fakeTtyStdin` in `app-shell.alternate-screen.test.tsx` are cast through `as unknown as NodeJS.WriteStream`/`NodeJS.ReadStream`, papering over missing standard stream members (`getColorDepth`, `cursorTo`, `clearLine`, `fd`, etc.) that today's Ink code path happens not to touch.
  evidence: a future Ink upgrade that reads any of those would fail with a cryptic runtime error inside `node_modules` rather than a clear type error at the test's own call site. Low priority — the same risk already exists in `render-to-string.ts`'s established fake-stdin technique this file deliberately mirrors. **Track:** revisit if an Ink upgrade ever breaks either fake-stream test with an unclear error.

## Deferred from: code review of 2-4-switch-the-active-edt-without-data-loss (2026-08-19)

- source_spec: `_bmad-output/implementation-artifacts/epic-2/2-4-switch-the-active-edt-without-data-loss.md`

## Deferred from: code review of 2-5-modify-an-edt-after-creation (2026-08-19)

- source_spec: `_bmad-output/implementation-artifacts/epic-2/2-5-modify-an-edt-after-creation.md`

- Missing e2e tests for `edt modify` — no end-to-end tests exist for the modify subcommand, the code would ship undetected if flag parsing, semantic validations, or the result envelope broke

- Test: "fails with edt-not-found for unknown topic" returns invalid-argument first — test ordering issue; EDT existence check should come before operation-cardinality check

- Test: shared-branch gate not triggered — mock's currentBranch returns 'feature-x' for shared/protected branch names, masking the AD-8 gate

- Unit tests mock update without verifying patch — all 6 unit tests in modify.test.ts mock update returning ok(undefined) and never inspect the patch argument; a bug in driven adapter updateEdtEntry would pass tests but incorrectly write the registry

- removeMembers filtering not verified in tests — "removes a member" test only checks outcome 'removed' but doesn't verify the update patch correctly filters members from the registry entry; removed members could persist

- renameTo topic not verified in update patch — "renames the EDT topic" test checks the result topic but doesn't verify the update call was passed the new topic; rename could silently fail to persist
  summary: `state.json` and `edts.yaml` writes use a plain `writeFile` with no temp-file+rename, so a crash mid-write can leave either file truncated/corrupt.
  evidence: `src/adapters/driven/state/index.ts:81` and `src/adapters/driven/edt-registry/index.ts:89,119` all call `writeFile` directly. This predates story 2.4 (edt-registry's writes go back to story 2.1) — `state.ts` is new but mirrors the same established, non-atomic pattern. Fixing just one file would be inconsistent; worth a single atomic-write helper shared by every YAML/JSON persistence adapter.
- source_spec: `_bmad-output/implementation-artifacts/epic-2/2-4-switch-the-active-edt-without-data-loss.md`
  summary: Even with the new AD-9 lock around `switchActiveEdt`'s own writes, a process crash between `state.writeActiveEdt` succeeding and the `edtRegistry.setStatus` calls (or between the two `setStatus` calls) leaves `state.json` and `edts.yaml` permanently disagreeing about which EDT is active, with nothing to detect or repair it on a later run.
  evidence: `src/core/edt/switch.ts`'s write sequence is three independent read-modify-write cycles; the lock (patched this review) only serializes *concurrent* callers, it doesn't make a single call's sequence crash-atomic. NFR-2 ("a crash must not corrupt another EDT's state") isn't fully addressed for this path. Needs a reconciliation strategy (e.g. treat edts.yaml as derived-from-state.json on read) rather than a mechanical patch.
- source_spec: `_bmad-output/implementation-artifacts/epic-2/2-4-switch-the-active-edt-without-data-loss.md`
  summary: `LockPort.peek`'s `stat().catch(() => null)` treats any filesystem error (not just ENOENT) as "not locked," so a real I/O error on the lock dir (EACCES/EIO) silently reads as free.
  evidence: `src/adapters/driven/lock/index.ts:65` mirrors the exact same catch-and-treat-as-absent pattern already used by `acquire`/`break` at lines 171 and 270 (story 1.7) — fixing `peek` alone would be inconsistent with those; all three need the same fix together.
- source_spec: `_bmad-output/implementation-artifacts/epic-2/2-4-switch-the-active-edt-without-data-loss.md`
  summary: Two stash entries in the same repo tagged with the identical `tui-back:<ulid>` message make `restoreStash` pop only the newest match, leaving the older one permanently stuck in the stash list.
  evidence: `src/adapters/driven/git/index.ts`'s `restoreStash` does a substring match on `git stash list` and pops the first hit. Refines the already-logged "stash accumulation" entry below: reachable when a repo is left dirty by the same EDT twice without a switch back into it in between (e.g. as a non-member repo dirtied independently between two switches).
- source_spec: `_bmad-output/implementation-artifacts/epic-2/2-4-switch-the-active-edt-without-data-loss.md`
  summary: `fetchBranch` (`git fetch origin branch:branch`) creates a plain local branch with no upstream/tracking metadata, unlike a normal tracked checkout.
  evidence: `src/adapters/driven/git/index.ts`'s `fetchBranch` implementation. Story 2.6's planned ahead/behind divergence view will need a tracking ref to compute against — worth revisiting once that story starts.
- source_spec: `_bmad-output/implementation-artifacts/epic-2/2-4-switch-the-active-edt-without-data-loss.md`
  summary: The real `git fetch` path for a missing shared branch (`switchNonMemberRepo`'s fetch-if-missing case) is only unit-tested against a faked `GitPort`/directly against `fetchBranch`, never end-to-end against a genuine `origin` remote through the real CLI.
  evidence: every e2e repo already has its shared branch locally, so `tui-back.e2e.test.ts` never exercises `switchActiveEdt` → real `GitPort.fetch` → an actual remote. Lower urgency than the AD-8 wiring gap (already patched this review) since `fetchBranch` itself is directly unit-tested.
- source_spec: `_bmad-output/implementation-artifacts/epic-2/2-4-switch-the-active-edt-without-data-loss.md`
  summary: `switchActiveEdt`'s per-repo loop processes every managed repo strictly sequentially; once the TUI wiring (already deferred, see below) lands, a slow `fetch`/`stash` on one repo blocks every other repo's checkout in the same switch.
  evidence: `src/core/edt/switch.ts`'s `for…await` loop, same shape as `create.ts`'s. Fine for a CLI call; worth a look against NFR-1's responsiveness goal once a TUI progress UI is built on top of this use-case.
- source_spec: `_bmad-output/implementation-artifacts/epic-2/2-4-switch-the-active-edt-without-data-loss.md`
  summary: `state.json`'s and `edts.yaml`'s `ulid`/`activeEdt` fields are validated only as `z.string().min(1)`, not checked against the ULID format, so a hand-corrupted id passes schema validation and only surfaces later as a generic "no matching EDT" outcome.
  evidence: `src/adapters/driven/state/schema.ts` and `src/adapters/driven/edt-registry/schema.ts:18` (`ulid: z.string().min(1)`) — pre-existing convention since story 2.1's `edts.yaml` schema; `state.ts` (new this story) just follows it.
- source_spec: `_bmad-output/implementation-artifacts/epic-2/2-4-switch-the-active-edt-without-data-loss.md`
  summary: A `state.json.activeEdt` ulid with no matching entry in `edtRegistry.list()` (an orphaned active-EDT pointer) is silently treated as "no outgoing EDT" rather than flagged.
  evidence: `src/core/edt/switch.ts`'s `outgoing = ... listed.data.find(...)` — `undefined` when stale, and nothing distinguishes that from a legitimate first-ever switch. Currently unreachable in practice: no code path removes an `edts.yaml` entry once added (no EDT-deletion feature exists yet). Revisit once one does (story 2.5+).
- source_spec: `_bmad-output/implementation-artifacts/epic-2/2-4-switch-the-active-edt-without-data-loss.md`
  summary: Every hand-rolled CLI flag parser in `subcommands.ts` (`edt create`'s `--topic`/`--member`/`--base`/`--branch-mode`/`--branch-name` and `edt switch`'s `--to`) accepts a following recognized flag as the literal value instead of erroring — e.g. `edt switch --to --force` sets the topic to the literal string `"--force"`.
  evidence: none of the `case '--x':` branches in `runEdtCreate`/`runEdtSwitch` (`src/adapters/driving/cli/subcommands.ts`) check whether `args[i+1]` looks like another flag before consuming it as the value. Pre-existing pattern across the whole parser (present in `edt create` since story 2.1/2.2), not introduced by this story; `edt switch` just follows the same established (and equally untested — see next entry) convention.
- source_spec: `_bmad-output/implementation-artifacts/epic-2/2-4-switch-the-active-edt-without-data-loss.md`
  summary: None of `runEdtCreate`'s or `runEdtSwitch`'s flag-syntax error branches (missing value, duplicate flag, unknown option, missing required flag) have any test coverage.
  evidence: a repo-wide search for the exact error-message fragments (e.g. "Missing value for --to", "Unknown edt create option") only matches their own definitions in `subcommands.ts`, never an assertion in any `*.test.ts`. Pre-existing gap across the whole hand-rolled CLI flag-parsing layer, not specific to `edt switch`.

## Deferred from: code review of 2-4-switch-the-active-edt-without-data-loss (2026-08-18)

- **TUI wiring deferred — RESOLVED (half) by story 2.9 (2026-08-20).** ~~The `edts-zone.tsx` switch action (invoking `switchActiveEdt` in-process, per AD-2) and the Zustand store's `fs.watch`/poll re-sync of `state.json`'s `activeEdt` (AD-10 — so a CLI-made active-EDT change is picked up while the TUI is open) are both unbuilt.~~ Story 2.9 wired the first half: `edts-zone.tsx`'s EDT selector calls `switchActiveEdt`/`createEdt`/`modifyEdt` in-process via new `AppStore` actions, and the store's `activeEdt` field is now populated by `loadEdts()` (a fresh `state.readActiveEdt()` read) and refreshed on a successful TUI-driven switch. The second half — continuous `fs.watch`/poll re-sync while the TUI is open, so a *concurrent CLI-made* active-EDT change is picked up live — remains deliberately out of scope, narrowed by 2.9's spec to "TUI-internal-switch-only": the store's active-EDT pointer is a point-in-time snapshot (refreshed on zone mount and on the TUI's own switch action), not a live subscription. **Track:** wire real `fs.watch`/poll re-sync of `state.json` as part of whichever future story first needs the TUI to reflect a CLI-made EDT switch without a restart.
- **No real abort/kill mechanism for an in-progress action** (`src/core/edt/switch.ts`): `--force` past a held `edt:<ulid>` lock only marks the outgoing EDT `interrupted` in the registry — nothing is actually terminated, and no action anywhere acquires that lock yet (Epic 3's group update is expected to be the first). Deliberate per this story's explicit scope (no abort primitive exists in the codebase; locks today are short-lived, held only for a single action's own duration). **Track:** revisit once Epic 3 introduces a real long-running, lock-holding action — at that point "stop the action" needs to mean something beyond a status flag.
- **Stash accumulation for repos never revisited by their tagging EDT** (`src/core/edt/switch.ts`): a stash tagged `tui-back:<ulid>` for a repo that is a member of neither the outgoing nor the target EDT (e.g. a stray member of some third, currently-inactive EDT) is created but never auto-popped by this switch — only a switch back into the EDT that *owns* the tag pops it. Data is never lost (it stays in the stash list, message-tagged), but it can accumulate indefinitely if that EDT is never revisited. Deliberate: the design note's stash-tag symmetry (outgoing-tagged on the way out, target-tagged looked up on the way in) only needs to hold for the two EDTs actually involved in a given switch. **Track:** no action needed unless real usage shows orphaned stashes piling up in practice; a `tui-back` stash-list/cleanup subcommand would be the natural fix.

## Deferred from: code review of 2-3-git-branch-scope-safety-gate-shared-branch-rejection (2026-08-18)

- **RESOLVED by story 2.4 (2026-08-18).** ~~AD-8's cross-EDT half is still unbuilt~~ (`src/adapters/driven/git/index.ts`, `src/core/ports/git.ts`): `assertAllowedBranch` gained an optional `edtId` param — when passed together with an `EdtRegistryPort` (now wired into `createGitPort` in `src/bin/main.ts`), it additionally rejects a branchName already registered as a *different* EDT's own branch for that repo, closing AD-8's cross-EDT half. First call site: `switchActiveEdt` (`src/core/edt/switch.ts`) re-verifies a target member's branch this way before checking it out. `createBranch`/`deleteBranch`/`create.ts`'s existing (no-`edtId`) call sites are unaffected.
- **`edt create` can exit 0 with a functionally empty EDT and no top-level signal** (`src/core/edt/create.ts`, `src/adapters/driving/cli/subcommands.ts`): since story 2.3 excludes every gate-rejected member from `members`, a request where every requested member is rejected (e.g. all on `development` with `--create-branches` disabled) still returns `ok: true` with `members: []` — the only indication is reading every row of `data.results` for `outcome: 'failed'`. Deliberate per this story's spec (consistent with Story 2.5's zero-member invariant), but a CLI/TUI user could easily miss it. **Track:** consider a summary flag (e.g. `allFailed: true`) or a distinct exit code when zero members end up registered, as a UX pass once Story 2.5/2.6's member-visibility work lands.
- **Redundant manifest load on the branch-creation-disabled path** (`src/core/edt/create.ts` `resolveMemberBranch`, `src/adapters/driven/git/index.ts` `assertAllowedBranch`): `resolveMemberBranch` already calls `manifest.load(member)` once to resolve `service`; when branch-creation is disabled it then calls `git.assertAllowedBranch(member, current.data)`, whose real adapter implementation calls `manifest.load(repoPath)` again for the same repo — a second file read/parse/validate per member on that path. Low impact (local YAML read), but avoidable. **Track:** revisit if `GitPort`'s contract is ever reshaped (e.g. to accept a pre-loaded manifest) — not worth a signature change on its own.

## Deferred from: code review of 2-2-create-dev-branches-at-edt-creation (2026-08-18)

- **RESOLVED by story 2.3 (2026-08-18).** ~~Shared branch can be recorded as a member's EDT branch via the failure fallback~~ (`src/core/edt/create.ts`): story 2.3 extracted the shared-branch check into a reusable `GitPort.assertAllowedBranch`, called from the branch-creation-disabled path before an existing current branch is reused as a member's own EDT branch, and changed the per-member loop to exclude any `failed`-outcome member from `memberEntries` entirely — no "best effort" fallback branch is ever recorded for a failed member any more, so the fallback can no longer end up shared. See `src/core/edt/create.ts` (`resolveMemberBranch`, the per-member loop) and `src/adapters/driven/git/index.ts` (`assertAllowedBranch`).
- **Legacy 2.1-shape `edts.yaml` entries hard-fail under the new strict schema** (`src/adapters/driven/edt-registry/schema.ts`): the entry shape evolved in place to `{ulid, topic, createdAt, status, members}` (`.strict()`), so any file written by Story 2.1 (`{ulid, branch, createdAt, status}`) now fails `list()`/`add()` with `edt-registry-invalid-format`, breaking every subsequent `edt create`. Verified at review time that no real 2.1 data exists on the dev machine (`~/.config/tui-back/edts.yaml` absent), so the strict failure is pinned by test rather than migrated. **Track:** if a real 2.1-era `edts.yaml` ever shows up, decide a migration (2.1 entries are topic-less/member-less placeholders — likely dropped or coerced) before it breaks creation.

## Deferred from: code review of 2-1-create-edt (2026-08-17)

- **AC3/Task 3 (git branch `edt-<ulid>` creation + AD-8 branch-scope safety gate) deferred to story 2.2** (`src/core/edt/create.ts`): `createEdt` takes no repo/service selection parameter today, so there is no target repo to branch. The user confirmed EDT creation's real branch semantics are per-service (point to an existing branch, or create either a branch dedicated to one service or one shared across the selected services) — a decision that needs the service-selection context story 2.2 ("create dev branches at edt creation") owns, not 2.1. **Track:** implement the `adapters/driven/git` `GitPort` + AD-8 safety gate as part of 2.2, exercised through the per-service branch selection flow described above; re-verify AC3 against the 2.2 story text once written (this story's own AC3 wording may need amending to match).

## Deferred from: code review of 1-12-launch-banner-keybinding-help-screen (2026-08-17)

- **Help-modal scroll counts keybinding items, not wrapped visual lines** (`src/adapters/driving/tui/shared/components/keybinding-help.tsx`): wide rows (e.g. `Ctrl+W` ~84 chars) wrap inside the modal, so one `j`/`k` press can jump multiple visual lines, and the modal height is unbounded on short terminals. Deferred: the story explicitly scoped scroll as a pure-function, prop-driven slice with no pixel measurement. **Track:** a terminal-dimension-aware scroll window if/when the TUI measures height.
- **Help modal and launch banner clip/wrap on unusually short/narrow terminals** (`src/adapters/driving/tui/zones/dashboard/launch-banner.tsx`, `src/adapters/driving/tui/shared/components/keybinding-help.tsx`): terminal < ~26 cols wraps the 24-glyph banner; terminal < ~14 rows clips the 10-row modal. Deferred: pre-existing edge case; no terminal-dimension measurement exists in the TUI yet. **Track:** revisit when Ink terminal-dimension hooks land in the TUI. **RESOLVED (story 8.5):** the Dashboard keeps its banner intact at every matrix size (`dashboard-zone.bounds.test.tsx`); below the minimum the shell's too-small screen applies.
- **`ModalDialog` `onConfirm`/`onCancel` are inert for the help instance** (`src/adapters/driving/tui/shared/components/keybinding-help.tsx`, `src/adapters/driving/tui/shared/components/modal-dialog.tsx`): closing is driven by AppShell's `useInput`; a standalone `KeybindingHelp` (outside `AppShell`) would never close on `Esc`/`?`. Deferred: pre-existing ModalDialog contract (1.10) with no internal `useInput`; works in the shipped app because AppShell owns key handling. **Track:** wire Esc/`?` into `KeybindingHelp` itself if it ever renders outside AppShell.

## Deferred from: code review of 1-11-permanent-app-shell.md (2026-08-17)

- **AppShell never mounted in a runnable entry point** (`src/adapters/driving/tui/app-shell.tsx:11`): referenced only by `app-shell.test.tsx`; `src/bin/main.ts` mounts only the CLI dispatch path, so AC1 ("Given the app is running") and AD-2 are unmet end-to-end. **Track:** wire the TUI entry point (composition root) in Story 1.12 (launch banner / entry point).
- **AD-13 wording contradicts task T2** (`_bmad-output/implementation-artifacts/epic-1/1-11-permanent-app-shell.md`): the Technical Requirements say "TUI gets smoke-tests via Ink's `render()` only", yet `app-store.test.ts` unit-tests the Zustand store directly with no Ink render; the story's own task T2 explicitly endorses this, so the diff follows the task line and AD-13's wording should be reconciled. **Track:** amend AD-13 (or the story requirement) when the architecture doc next gets edited.

## Deferred from: code review of 1-8-atelier-design-tokens-theme-module (2026-08-14)

- **No runtime immutability** (`src/adapters/driving/tui/shared/theme/theme.ts`): `as const` is compile-time only, so a Story 1.9+ component could mutate `theme.colors.accent` (or an aggregate) at runtime and no test would catch it, undermining the "single source of truth" invariant. **Track:** add `Object.freeze` on each token group + an `Object.isFrozen(theme)` assertion when the first consumer lands (Story 1.9+).
- **Barrel `theme/index.ts` untested as the public entrypoint** (`src/adapters/driving/tui/shared/theme/index.ts`): tests import the deep `./theme.js` path, so a broken barrel (e.g. wrong export name) ships undetected; the advertised entrypoint is never exercised. **Track:** import from `./index.js` in at least one test once consumers exist.
- **Glyph vocabulary absent from the theme** (`src/adapters/driving/tui/shared/theme/theme.ts`): status-badge glyphs (`● ○ ✔ ✖ ⣾ › ▸`) are the non-color half of the "never color alone" rule (DESIGN.md:64,160), but only colors are tokenized. Out of the story's color/spacing/typography/rounded scope. **Track:** tokenize glyphs (or point to a glyph set) in the Story 1.9 status-badge.
- **`sprint-status.yaml` duplicates `generated`/`last_updated` in header comment and body** (`_bmad-output/implementation-artifacts/sprint-status.yaml:1-2,43-44`): the two have already drifted once historically (comment 2026-08-11 vs body 2026-08-13 before this change); this change keeps them in sync but the duplication is a live inconsistency risk. Pre-existing. **Track:** have the generator/validator assert comment block == body block.
- **Future-component guards are doc/test-level only** (`src/adapters/driving/tui/shared/README.md`): no lint or usage test rejects a hardcoded nonzero radius or accent-as-status in a Story 1.9+ component; enforcement lives in the README rules. **Track:** add a depcruise/usage guard when component stories (1.9–1.12) land.

## Deferred from: code review of 1-7-single-instance-enforcement-per-resource-action-lock.md (2026-08-13)

- **PID reuse defeats staleness detection; the recorded `timestamp` is never consulted** (`src/adapters/driven/lock/index.ts:90-104,79`): `isPidAlive` only asks whether *some* process owns the pid, so a recycled pid makes a stale lock look live forever; the owner `timestamp` is written but unused, so no age fallback exists. The age-based reclaim (patch in this review) mitigates orphan/corrupt-owner cases; the residual OS pid-recycle window is a platform reality. **Track:** revisit if the lock ever guards long-lived resources (Epic 2+), where stale-lock cost rises.
- **`releaseLock` removes the lock path without verifying it still records this holder** (`src/adapters/driven/lock/index.ts:122-130`): defensive-only — `withActionLock` releases exactly once per acquire and a live holder is never reclaimed, so the window requires a stale handle from a reclaimed lock. **Track:** add holder-identity verification if double-release or handle-reuse ever becomes reachable.
- **A lock path occupied by a regular file (not a directory) wedges forever** (`src/adapters/driven/lock/index.ts`): `mkdir` EEXIST never clears and `owner.json` is unreadable, so `isStale` stays `false`; only an age-based reclaim (patch in this review) would clear it. **Track:** confirm the age-based reclaim covers non-directory lock paths.
- **The e2e concurrency test may flake if a writer hits the 5s reject deadline under extreme load** (`src/bin/tui-back.e2e.test.ts:171-191`): lock hold is microseconds, so the 5s deadline is generous; a retry loop is suggested only if CI proves otherwise. **Track:** add a retry loop if CI flakes.
- **`withActionLock` maps a thrown `work()` to `internal-error` inside core, duplicating dispatch's catch-all** (`src/core/locking.ts:30-32`): harmless redundancy (dispatch re-maps to the same code at the boundary), but the helper's mapping drops the stack trace (message only). **Track:** drop the in-helper mapping or log to stderr if diagnostics inside core are ever needed.
- **AC4 "rejected" contention path is never black-box tested** (`src/bin/tui-back.e2e.test.ts`): `action-in-progress` on timeout is covered at adapter level (100ms) and core level (fake lock) only; a black-box reject test needs a helper that holds the lock open. **Track:** add a lock-holding helper subprocess when Epic 2+ makes long-held locks realistic.

_Iteration 2 (branch vs epic-1, 2026-08-13):_
- **A `reclaim` break-marker owner-write failure leaves a self-healing marker** (`src/adapters/driven/lock/index.ts:210-215`): if writing `breakPath/owner.json` fails we return `lock-acquire-error` without removing the marker; a subsequent waiter waits out the 2s age-based `breakIsStale` gate before clearing it. Rare, self-heals. **Track:** clean the marker in a `finally` if the write-failure path ever becomes observable.
- **A hung holder wedges waiters until it dies (no hold-side timeout)** (`src/adapters/driven/lock/index.ts`): `timeoutMs` bounds only the waiter's wait, not the holder's hold; waiters reject with `action-in-progress` and stale reclaim clears the lock once the holder dies. Matches "serialize or reject". **Track:** a hold lease / heartbeat if long-lived locks arrive in Epic 2+.
- **`releaseLock` does not verify the dir still records this holder before removing** (`src/adapters/driven/lock/index.ts:254-261`): a stale handle from a reclaimed lock could delete a live holder's re-acquired lock. Impossible for the shipped one-acquire-one-release flow. **Track:** add holder-identity verification if handle reuse becomes reachable.
- **`sanitizeResourceKey`'s 8-hex (32-bit) hash has a small cross-resource collision space** (`src/adapters/driven/lock/helpers.ts:17`): negligible at current cardinality. **Track:** revisit if Epic 2+ keys many resources.

## Deferred from: code review of 1-6-static-module-registry.md (2026-08-13)

- **TTY/human rendering of a `ListReposData` payload carrying `moduleIds` never tested** (`src/adapters/driving/cli/envelope.ts`): the envelope's `renderHuman` passes `ManagedRepo` through a generic pretty-printer; `envelope.test.ts` only exercises the TTY branch with generic payloads (never a `ListReposData` object containing `moduleIds`), the e2e is JSON-only (no pty lib), and the core unit test checks the unrendered data. The generic renderer makes a regression unlikely. **Track:** add an envelope render test with a `moduleIds`-carrying payload once a pty/format test lands, or accept generic pretty-print.
- **AC4 non-empty `moduleIds` never e2e-tested** (`src/bin/tui-back.e2e.test.ts`): because the production registry is empty by design (D1), any real manifest with a `modules` key fails as `unknown-module`, so the e2e can only observe `moduleIds: []`. The non-empty, sorted `moduleIds` path is verified only at core unit level. Intentional and documented. **Track:** add a populated-`moduleIds` e2e case once Epics 4/6 register a real module implementation.

## Deferred from: code review of 1-5-explicit-repo-registry.md (2026-08-12)

- **Scan root-probe lives in the adapter, not the use-case** (`src/adapters/driven/registry/index.ts:97`): spec task text assigned the root probe to core's `scan.ts`, but it's implemented in the driven adapter's `scanRoot`. Behavior contract preserved and consistent with the RegistryPort design note ("adapter owns the filesystem"); literal task split drifted. **Track:** keep as-is or amend the spec text to match.
- **`assertUniqueSubcommandNames` throws outside `runCli`'s try/catch** (`src/bin/main.ts:19`): a duplicate-name throw at composition time escapes uncaught (no AD-3 envelope, raw stack). Only reachable via a programming error; fail-fast intended. **Track:** if subcommands ever become dynamic, move composition inside the dispatch boundary.
- **`addRegistry` TOCTOU read-modify-write, no atomic write/locking** (`src/adapters/driven/registry/index.ts:64`): no temp+rename or lock; two concurrent `register` invocations can lose one registration. **Track:** Story 1.7 owns locking/atomicity; spec "Never" list excludes locking here.
- **No TTY/human-branch coverage for register/list-repos/scan** (`src/bin/tui-back.e2e.test.ts`): e2e exercises only the non-TTY JSON branch (no pty lib); `envelope.ts`'s human rendering of the new data shapes is untested. **Track:** add envelope tests once a pty lib lands, or accept generic pretty-print.
- **`RegistryPort` has no unregister/remove**: dead/replaced paths accumulate in `registry.yaml` forever; nothing prunes them. **Track:** the story where registry editing (unregister) is in scope. **tracked_by:** Story 2.33 (Sprint Change Proposal, 2026-09-22) — Registry: Deregister Stale, Unreachable, or Unmanaged Repos. Item stays open until 2.33 actually lands.
- **Sequential per-repo stat+manifest loads in `listRepos`; adapter non-ENOENT error branches untested** (`src/core/scripts/list-repos.ts`, `src/adapters/driven/registry/index.ts:40,106`): unbounded linear serialize for large registries (acceptable today); `registry-read-error`/`scan-root-error` have no tests (EACCES needs non-root env). **Track:** revisit if registries grow or error-branch tests become portable.
- **Unrelated `fallback-matrix.md` model-priority change rides on the story branch**: scope creep in the review; should be committed/reviewed separately from story 1.5.
- **`manifestSchema` widened to `z.ZodType<Manifest>`** (`src/adapters/driven/manifest/schema.ts`): the TS `satisfies` operator would preserve inference without widening; zod 4.4.3's lack of a runtime `.satisfies()` forced the annotation. Documented deviation; type-level link intact in both directions. **Track:** switch to the `satisfies` operator if a zod release restores inference ergonomics.
- **Recursive `walkForManifests` stack overflow on pathologically deep trees** (`src/adapters/driven/registry/index.ts:118`): only ~10k+ depth triggers; unrealistic for repo trees. **Track:** switch to an iterative walk if scan ever targets deep monorepo trees.

## Deferred from: code review of story-1-4-manifest-schema-loader-validation (2026-08-12)

- No type-level link between the zod `manifestSchema` and core `Manifest` (`src/adapters/driven/manifest/schema.ts`) — no `satisfies`/`z.ZodType<Manifest>` assertion, so a drift between the schema and the core type (e.g. core gains a field the schema lacks) compiles cleanly. The `return ok(result.data)` boundary in `src/adapters/driven/manifest/index.ts:44` catches incompatible drift, but only one direction. **Track:** assert `manifestSchema` against `Manifest` once a real core consumer exists (Story 1.5+).
- Bare `modules:` (YAML null) fails validation — only an explicit `modules: {}` expresses an empty map (`src/adapters/driven/manifest/schema.ts:13`). Story says modules "may be `{}`"; accepting null would need a coercion decision. **Track:** decide whether to accept `modules:` as empty when authoring docs land.
- No example/sample `.tui-back.yaml` shipped, though the product premise is repo developers hand-authoring manifests. Not required by any AC. **Track:** ship an `examples/` file or authoring note (also covers the unquoted-scalar YAML 1.2 gotcha — `service: 123` parses to a number).
- `manifest-not-found` conflates "no manifest" with "repoPath doesn't exist" (both ENOENT, `src/adapters/driven/manifest/index.ts:17`) — Story 1.5's silent skip of unmanaged dirs would also silently swallow a nonexistent/mistyped path. Not reachable today (no scan consumer). **Track:** revisit when Story 1.5's scan decides which paths to feed the loader.
- `repoPath` is not validated (`src/adapters/driven/manifest/index.ts:15`) — an empty/relative path resolves against the process CWD via `join`. No production caller yet (tests only). **Track:** revisit with Story 1.5's first real caller.
- Read-error test is not portable (`src/adapters/driven/manifest/index.test.ts:157-168`): a plain-file repoPath surfaces ENOTDIR on Linux (→ `manifest-read-error`) but typically ENOENT on Windows (→ `manifest-not-found`), so the test would fail on non-Linux CI. **Track:** if Windows CI ever enters scope, loosen the assertion or drive the error deterministically.

## Deferred from: code review of story-1-3-script-output-envelope-cli-entrypoint-contract (2026-08-12)

- No duplicate-subcommand-name guard in `runCli` (`src/adapters/driving/cli/dispatch.ts:19`) — `subcommands.find(candidate => candidate.name === name)` silently lets the first match win if a future registry (`main.ts`) ever contains two entries with the same `name`; nothing warns or fails. Not reachable today (only `ping` is registered). **Track:** revisit once Story 1.4+ registers a second subcommand by hand — either add a startup assertion (no duplicate names) or a unit test on the production registry.

## Investigated during dev of story-1-3-script-output-envelope-cli-entrypoint-contract (2026-08-12)

- **New `depcheck`/acorn-fallback landmine found and worked around (not blocking, mitigation is a style rule the codebase already follows).** This story is the first to add a generic function whose return type references a locally-defined generic *union* type alias (`src/core/result.ts`'s `ok<T>(data: T): Result<T>`, `Result<T>` being a union). Direct reproduction confirmed: a file with exactly this shape **silently drops all of that file's own `import` statements from dependency-cruiser's dependency graph — but only when those imports are not the first statements in the file.** With imports placed at the top (the convention every file in this codebase already follows, and what `src/core/result.ts` and every other file this story adds actually does), extraction works correctly and the `no-core-to-adapters` rule still fires on a deliberately introduced violation (round-tripped: added and removed a real `core → adapters` import in `result.ts`, confirmed the rule catches it). `interface`-only, `type`-alias-only, and generic-function-only files are each individually unaffected regardless of import position — it's specifically the (generic union type alias) + (generic function returning it) + (a later import) combination that breaks. Root cause not identified beyond "acorn-fallback TS-stripping mis-tracks position on this exact combination"; not investigated further since the mitigation (imports first, always) requires no code or config change. **Track:** if a future story ever needs a generic function to appear *before* an import in the same file (unusual, against the existing convention), re-verify `depcheck` actually scans that file's imports before merging.
- Unrelated to, and does not reopen, the `no-core-to-adapters` unresolved-import-path fix below (that fix is about matching `resolved` path text against the rule's `to.path` pattern; this is about whether an import is extracted from the source at all).

## Resolved during code review of story-1-2-xdg-state-layout-resolution (2026-08-12)

- **`no-core-to-adapters` silently could not catch a boundary violation expressed as this project's mandatory NodeNext-style relative import (`./foo.js` resolving to `./foo.ts`) — now fixed.** Story 1.2 Task 2's dev-time investigation found that such an edge is recorded by dependency-cruiser as `couldNotResolve: true`, with only the raw unresolved specifier (e.g. `../adapters/thing.js`) in `resolved` — and, because the rule's `to: { path: '^src/adapters(/|$)' }` only matched a *resolved*, `src/`-prefixed path, concluded no config option could fix it (see git history for the original write-up). Code review reproduced the gap and found it wrong: `resolved` still contains "adapters" as a substring after the unresolved `../` prefix, so dropping the `^src/` anchor (`to: { path: 'adapters(/|$)' }`) makes the rule match. **Fixed in `.dependency-cruiser.cjs`**, with a regression test locking in the behavior: `dependency-cruiser.config.test.ts` (root-level, imports the real rule from `.dependency-cruiser.cjs` directly so it can't drift out of sync) asserts both that the rule now catches a deliberate core→adapters NodeNext-style violation, and that it doesn't false-positive on a benign same-boundary import. This means Story 1.1's AC5 ("structurally enforced" boundary) had zero automated enforcement for the only import style this codebase's `tsconfig.json` permits, from Story 1.1's close until this fix — worth keeping in mind when reasoning about anything merged in that window.
  - Note: `interface`/simple-type-annotation syntax still parses fine through depcruise's acorn fallback (unaffected by, and unrelated to, this fix) — see Story 1.1's TS7 item directly below, which remains open for `type`/generics/enum syntax.

## Deferred from: code review of story-1-1-project-scaffolding-hexagonal-skeleton (2026-08-11)

- `depcheck`'s AD-1 boundary rule (`.dependency-cruiser.cjs`) will silently stop being "structurally enforced" (AC5) the moment real TypeScript syntax (interface/type/generic/enum) lands in `src/core` or `src/adapters` — dependency-cruiser@18.2.0 (latest available) hard-gates its native TS support to `typescript <7.0.0`, and the project is pinned to `typescript@7.0.2`, so extraction falls back to acorn, which cannot parse TS-only syntax. Deferred: blocked by the tool, no compatible version available. **Track as soon as a future story adds real TS syntax to `core/` or `adapters/`** — verify `depcheck` still catches boundary violations in that file before merging.
  - **Update (story-1-3, 2026-08-12):** the general fear here didn't materialize — `interface`, `type` aliases (including generic unions), and generic functions all parse fine through acorn's fallback across Stories 1.2 and 1.3's real usage. The one real gap found is much narrower and is documented above under "Investigated during dev of story-1-3...": a generic function returning a locally-defined generic union type silently drops that *specific file's* imports from the graph, but only when those imports aren't the first statements in the file. Following the codebase's existing "imports first" convention avoids it entirely. Treat this item as resolved in practice; the narrower landmine above is the thing to actually keep in mind.
- No `README.md` documenting the install → link → run → test → depcheck workflow. Not required by any AC as written; useful follow-up for onboarding.
- `src/bin/tui-back.mjs` has no `try/catch` around `await import('./main.ts')`, so a future throwing `main.ts` would surface a raw stack trace instead of a controlled error. `main.ts` cannot currently throw; revisit once real subcommand dispatch lands.
- `package.json` declares `"license": "ISC"` but no `LICENSE` file exists. Package is `private: true` and unpublished, so low priority; needs a licensing decision if that changes.
- `"engines": { "node": ">=24" }` is advisory only — no `.npmrc` `engine-strict` or CI check enforces it, so `npm install` on an older Node warns rather than fails. AC1 only requires the happy path on Node 24 to work, not enforcement.
- The AD-1 boundary rule (`.dependency-cruiser.cjs`) only covers `core → adapters`; nothing stops `src/bin` from importing `src/adapters/driven` directly, or `adapters/driven` ↔ `adapters/driving` from importing each other. Out of AC5's literal scope (core→adapters only); worth hardening once those edges have real code.
- No automated test exercises `src/bin/tui-back.mjs` end-to-end (`npm test` doesn't invoke the CLI binary). AC3 only requires manual `npm link` verification as written; a smoke test would catch future regressions (e.g. lost executable bit).

## Deferred from: code review of story-1-13-canonical-keybinding-contract-zone-navigation (2026-08-17)
- **F6**: Story 1-10 status transition — status changed from review→done without proper review loopback, pre-existing workflow issue (not a code defect).
Track: verify sprint-status.yaml story 1-10 transition pattern on future reviews.

## Deferred from: step-03 matrix audit of 2-6-branch-and-divergence-visibility (2026-08-19)

- source_spec: `_bmad-output/implementation-artifacts/epic-2/2-6-branch-and-divergence-visibility.md`
  summary: Branch/divergence display in the Dashboard, Update, Logs, Routes, and shared-types zones (the Intent's "related displays") is unbuilt — only the EDTs zone got real rendering this story.
  evidence: every one of those five zones (`src/adapters/driving/tui/zones/{dashboard,update,logs,routes,shared-types}/*.tsx`) is still a bare `ZonePlaceholder` with no per-service listing at all to attach branch/divergence data to — there is nothing to extend yet. Track: wire each zone's branch/divergence column as part of whichever future story first gives that zone a real per-service listing (e.g. the Update zone's real content is Epic 3's group-update work).
- source_spec: `_bmad-output/implementation-artifacts/epic-2/2-6-branch-and-divergence-visibility.md`
  summary: The I/O matrix's "Divergence computed mid-run" row (shown in the update zone's per-service outcome summary during a group update) is unimplemented and untested.
  evidence: no group-update use-case or Update-zone outcome summary exists yet (that's Epic 3, story 3.1). Track: cover this matrix row once the group-update use-case and its Update-zone rendering exist — reuse `listEdtBranchesDivergence`/`GitPort.aheadBehind` rather than re-deriving divergence.

## Deferred from: code review of 2-6-branch-and-divergence-visibility (2026-08-19)

- source_spec: `_bmad-output/implementation-artifacts/epic-2/2-6-branch-and-divergence-visibility.md`
  summary: `listEdtBranchesDivergence` has no test covering `registry.exists()` returning `ok: false` (a filesystem error), even though that path is implemented (pushed into the `errors` array).
  evidence: `src/core/edt/list.test.ts` covers `exists` returning `ok(false)` (unreachable) and a failing `manifest.load`, but no test overrides `exists` to return `err(...)`; `src/core/edt/list.ts`'s `if (!exists.ok) { errors.push(...); continue; }` branch is reachable but unexercised.
- source_spec: `_bmad-output/implementation-artifacts/epic-2/2-6-branch-and-divergence-visibility.md`
  summary: `listEdtBranchesDivergence` reads every registered repo's branch/divergence strictly sequentially (a `for...await` loop with no concurrency), and each read is itself 4-5 blocking `spawnSync` git calls (`currentBranch` is called twice per repo — once directly, once again inside `aheadBehind`'s own implementation).
  evidence: `src/core/edt/list.ts`'s main loop and `readServiceDivergence`; `src/adapters/driven/git/index.ts`'s `aheadBehind` calls `currentBranch(repoPath)` itself rather than accepting an already-resolved branch. All git reads go through `spawnSync`, which blocks Node's event loop synchronously despite the surrounding functions being `async` — for a large registry this could make the EDTs zone's "Loading services…" state slow to appear and the listing itself slow to complete. Pre-existing `spawnSync`-everywhere convention in the git adapter, not introduced by this story; worth a concurrency pass (e.g. `Promise.all` with a cap, or switching to async `spawn`) once real-world repo counts make it a felt problem.

## Deferred from: code review of 2-12-zone-tab-bar-focus-arrow-navigation (2026-08-25)

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-12-zone-tab-bar-focus-arrow-navigation.md`
  summary: When the splitter's `Ctrl+W` keyboard resize-mode (documented since UX-DR10/1-9, never yet implemented) is eventually built, its resize-mode state will need adding to the same exclusion gate story 2.12's `Left`/`Right` zone-switch dispatch already checks (`!helpOpen && !filterOpen && !registryScreenOpen`, inert under `zoneInputCaptured`) — otherwise arrow keys meant to resize a splitter boundary would also switch zones.
  evidence: `src/adapters/driving/tui/app-shell.tsx`'s `resolveZoneArrowSwitch` dispatch branch has no resize-mode flag to check because none exists in the codebase yet (confirmed absent during story 2.10/2.12 investigation); flagged in review so whichever story implements `Ctrl+W` resize-mode remembers to add the gate, mirroring how `zoneInputCaptured` is already threaded through every global shortcut.
  tracked_by: Story 2.21 (Sprint Change Proposal, 2026-08-27) — EDT Zone Multi-Splitter Layout with Keyboard Resize-Mode. Item stays open until 2.21 actually lands and the gate is added.
  resolved_by: Story 2.21 (2026-08-28). `app-store.ts` gained a single `resizeMode: { zone: ZoneId; targetBoundary: number } | null` store flag; `app-shell.tsx`'s zone-switch/mnemonic/filter/command/quit exclusion gate (the same `if` block story 2.12's own arrow dispatch already sits inside) now also checks `state.resizeMode === null`, and a new resize-mode-active block ahead of it dispatches Tab (cycle boundary)/arrows (resize)/Enter/Esc (exit) instead — so arrow keys meant to resize a boundary never reach `resolveZoneArrowSwitch` while resize-mode is engaged. See `shouldEnterResizeMode`/`resolveResizeStep`/`shouldExitResizeMode` in `app-shell.tsx`.

## Deferred from: code review of 2-14-command-entry-bar-registered-commands (2026-08-25)

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-14-command-entry-bar-registered-commands.md`
  summary: Any shell-level overlay whose flag a zone's own `useInput` doesn't explicitly check (`registryScreenOpen`, `filterOpen`, `helpOpen`) still leaks keystrokes into that zone's own key handling underneath the overlay — this story only closed the gap for `commandBarOpen` against `EdtsZone`; the same class of bug remains open for the other three overlays and for any future zone that grows its own meaningful `Tab`/`Enter` handling.
  evidence: Ink's `useInput` dispatches every keypress to every mounted hook unless a component passes `{ isActive: false }`; `AppShell` always renders `<ZoneScreen>` regardless of overlay state (`app-shell.tsx`), and `RepoRegistryScreen`'s own `useInput` (Story 2.11) already has no gate protecting a mounted zone from its `Enter`-to-scan keypress — confirmed by two independent review passes on story 2.14, which fixed only the newly-added `commandBarOpen` case. Track: a dedicated hardening pass that introduces one shared "an overlay currently owns input" check (e.g. a single derived store flag `overlayOwnsInput = helpOpen || filterOpen || registryScreenOpen || commandBarOpen`) and threads it through every zone's own `useInput` `isActive` option, rather than gating one flag at a time per story.

## Deferred from: code review of 2-13-manifest-gated-zone-tab-visibility-disabled-state (2026-08-26)

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-13-manifest-gated-zone-tab-visibility-disabled-state.md`
  summary: `tabVisibilityStatus`/`tabVisibilityError` are tracked in the store (mirroring the EDT branches slice's idle/loading/error shape) but never read anywhere outside `app-store.ts` — unlike `edtsBranchesStatus`/`edtsBranchesError`, which `edts-zone.tsx` actually renders — so a registry/manifest failure while resolving tab visibility is completely invisible to the user; the tab bar just silently keeps the last known-good (or default 'enabled') state forever.
  evidence: `grep -rn "tabVisibilityStatus\|tabVisibilityError" src/adapters/driving/tui --include="*.tsx"` outside test files returns nothing, while `edts-zone.tsx:448-449` reads and renders `edtsBranchesStatus`/`edtsBranchesError`. The spec's Boundaries explicitly forbid a shell-wide spinner and don't mandate error UI, so this isn't a spec violation — but it's a real, incidentally-surfaced gap worth a dedicated look once real manifests start populating `moduleRegistry` (Epic 4/6) and load failures become a live possibility.

## Deferred from: code review of 2-16-permanent-dashboard-banner (2026-08-26)

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-16-permanent-dashboard-banner.md`
  summary: The pre-existing "banner clips/wraps on unusually short/narrow terminals" gap (logged under story 1.12) is now visible on every single Dashboard render instead of only a one-off first-launch flash, raising its practical severity without any code in this story addressing it.
  evidence: `src/adapters/driving/tui/zones/dashboard/launch-banner.tsx` still has no terminal-dimension measurement (unchanged by this story, whose Never list explicitly forbids touching the component); the existing deferred entry (see "Deferred from: code review of 1-12-launch-banner-keybinding-help-screen" above) was written when the banner appeared once, transiently, on first launch — now that `dashboard-zone.tsx` renders it unconditionally on every visit, the same clipping is a permanent fixture of the Dashboard rather than a rare flash. **Track:** when picking up the original entry, re-weigh its priority given the banner's now-permanent visibility. **RESOLVED (story 8.5):** the Dashboard keeps its banner intact at every matrix size (`dashboard-zone.bounds.test.tsx`); below the minimum the shell's too-small screen applies.

## Deferred from: code review of 2-20-top-bar-footer-hint-accuracy-fixes (2026-08-27)

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-20-top-bar-footer-hint-accuracy-fixes.md`
  summary: `src/bin/tui-back.e2e.test.ts`'s `edt switch` black-box tests (56 failures) fail independently of this story, all at `registerRepos`'s `expect(runCli(['register', repo], env).status).toBe(0)`.
  evidence: Confirmed by the verification-gap reviewer as pre-existing and unrelated to this diff — `tui-back.e2e.test.ts` was last modified in story 2.8 (commit `842cd84`), long before this story's `baseline_commit`, and this diff touches only `adapters/driving/tui/**`. Looks like a sandbox/environment issue (e.g. git config in the test env) rather than a code regression. **Track:** root-cause the `register` subcommand's non-zero exit in the e2e sandbox next time this suite is touched.

## Deferred from: code review of 2-17-terminal-style-command-bar-autocomplete-grid-browser (2026-08-27)

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-20-top-bar-footer-hint-accuracy-fixes.md`
  summary: The story 2.20 entry above ("`registerRepos` ... 56 failures ... sandbox/environment issue") is resolved, not merely deferred: `tui-back.e2e.test.ts`'s `scriptPath` was pointed at `tui-back.mjs` (the interactive-TUI entrypoint, which exits 1 under `spawnSync`'s non-TTY `register` calls) instead of `cli-back.mjs` (the actual CLI dispatcher) ever since `b081de8` split the two entrypoints. Repointing it to `cli-back.mjs` (this story's diff) makes all 57 tests in the file pass reliably. **Track:** nothing further — close the story 2.20 entry above once its own spec is next touched, it no longer needs root-causing.

## Deferred from: code review of 2-18-edt-zone-active-highlight-fixed-width-detail-pane-categorized-services-per-service-actions-2 (2026-08-27)

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-18-edt-zone-active-highlight-fixed-width-detail-pane-categorized-services-per-service-actions.md`
  summary: The original story 2.18 spec's frontmatter still says `status: 'done'` while `sprint-status.yaml` tracks the story as `review` — a pre-existing mismatch this amendment doesn't reconcile (the frozen spec isn't rewritten in place; the amendment gets its own `-2` spec file per this repo's routing convention for touching an already-`done` spec).
  evidence: `spec-2-18-....md:5` (`status: 'done'`) vs. `sprint-status.yaml`'s `2-18-...: review` entry — both present as of this amendment; not caused by this change, predates it. **Track:** reconcile whichever way is correct (either the spec's status or sprint-status.yaml) next time story 2.18's branch is touched for merge.

## Deferred from: code review of 2-19-global-settings-screen (2026-08-27)

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-19-global-settings-screen.md`
  summary: `EdtsZone`'s own `useInput` handler is gated only by `!commandBarOpen`, not by `settingsScreenOpen` — while the `:settings` overlay is open and the EDTs zone is the active zone underneath it, Tab/Up/Down keys meant only for the settings screen's tab-cycling/value-adjust also silently fire `EdtsZone`'s own pane-cycling (`cyclePaneFocus`) and list-selection handlers, changing EDT selection/focus state the user can't see while the overlay is up.
  evidence: `src/adapters/driving/tui/zones/edts/edts-zone.tsx:1394` — `useInput(..., { isActive: !commandBarOpen })`, with no `registryScreenOpen`/`settingsScreenOpen` check anywhere in the file (confirmed by grep). Pre-existing: the identical gap already exists for `registryScreenOpen` (predates story 2.19); this story's `settingsScreenOpen` simply follows the same established — but incomplete — precedent per the spec's own Code Map instruction ("wire `settingsScreenOpen` exactly like `registryScreenOpen`"). **Track:** give `EdtsZone` (and any future zone) a single "any overlay is open" flag to gate its own `useInput` on, fixing both the settings and registry cases together, next time an overlay-vs-zone keystroke bug is actually observed in practice.
## Deferred from: real-usage review of 2-19-global-settings-screen (2026-08-28)

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-19-global-settings-screen.md`
  summary: The story 2.19 entry above ("EdtsZone's own useInput handler is gated only by !commandBarOpen, not by settingsScreenOpen") is resolved, not merely deferred: Max hit exactly this in real usage (Left/Right/Tab/arrows in the settings popup also moving EdtsZone's own selection/pane focus underneath it). `EdtsZone`'s `useInput` `isActive` option now also checks `!registryScreenOpen && !settingsScreenOpen` (both cases fixed together, per that entry's own "Track" note), with two new regression tests in `app-shell.interaction.test.tsx` pressing a second, later keystroke once each overlay is already open (the original story-2.14/2.19 tests only ever checked the single Enter that *opens* an overlay, not a later one typed while it stays open — the actual shape of this bug).
  evidence: `src/adapters/driving/tui/zones/edts/edts-zone.tsx` — `useInput(..., { isActive: !commandBarOpen && !registryScreenOpen && !settingsScreenOpen })`; `npm test`/`npm run typecheck`/`npm run depcheck` all pass. **Track:** nothing further for `EdtsZone` — close the entry above once story 2.19's spec is next touched. `helpOpen`/`filterOpen` (the other two overlays named in that entry's "single shared flag" suggestion) remain unaddressed — still worth a dedicated hardening pass if either is ever observed leaking in practice.

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-19-global-settings-screen.md`
  summary: `CheckboxListItem`'s `selected` prop is dead code — `resolveCheckboxItemLayout` destructures it but never uses it to affect `boxGlyph`/`labelColor`/`metaColor`/`paddingLeft`, so `settings-screen.tsx`'s `selected={highlighted}` call has no visible effect and the screen has to render its own separate `›` cursor glyph as a workaround.
  evidence: `src/adapters/driving/tui/shared/components/checkbox-list-item.tsx`'s `resolveCheckboxItemLayout` (pre-existing, not touched by this story) ignores `selected` entirely. Pre-existing component gap, surfaced incidentally by this story's first real usage of the prop. **Track:** either wire `selected` into the shared component's highlight styling for real, or drop the now-clearly-inert prop from its type, next time `CheckboxListItem` is touched.

## Deferred from: review of 2-19-global-settings-screen amendment (2026-08-28)

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-19-global-settings-screen.md`
  summary: The frozen spec's Boundaries "Ask First" clause (stub the Command Palette/EDTs tabs' live-wiring if Stories 2.17/2.18 aren't landed yet) and a Design Note ("EDTs-tab token list is Story 2.18's to define... since 2.18 is not yet implemented") are now stale — both 2.17 and 2.18 are `done` and the Code Map's "Delivered by first round" section already lists the concrete token ids — but this amendment left that forward-looking, now-moot conditional text untouched.
  evidence: `_bmad-output/implementation-artifacts/epic-2/spec-2-19-global-settings-screen.md`'s `<frozen-after-approval>` Boundaries block and its Design Notes section; both predate this 2026-08-28 amendment (pre-existing from the story's first round, not introduced by it) and are harmless (doc-only, no code reads them). **Track:** clean up when this spec's frozen section is next renegotiated with the human.

## Deferred from: human review of 2-21-edt-zone-multi-splitter-layout-keyboard-resize-mode (2026-08-28)

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-21-edt-zone-multi-splitter-layout-keyboard-resize-mode.md`
  summary: A follow-up bugfix (`flexBasis={0} minHeight={0} overflow="hidden"` on every flex-grow pane in `edts-zone.tsx`) made the EDT zone's 3 internal boundary positions content-independent, closing a severe regression against the story's own AC ("4 regions ... fixed border between each"). One cosmetic residue remains: when a pane's content is clipped because it exceeds its allotted rows, Ink/Yoga's `overflow: hidden` clip renders a sparse/jagged sample of the overflowing rows (e.g. `row 1, row 4, row 8, row 11, ...`) rather than a clean contiguous top-N prefix — confirmed with a standalone Ink repro (many sibling `<Text>`/`<Box>` rows inside an `overflow: hidden` flex container), not an artifact of any single component here.
  evidence: reproduced with `renderToString` against a minimal `<Box overflow="hidden" flexGrow={1}>` containing 30–100 individually-keyed row children — same sparse pattern with bare `<Text>` rows and with `<Box><Text/></Box>`-wrapped rows (i.e. not specific to `ListRow`). Boundary *position* is unaffected (proven stable by `edts-zone.layout.test.tsx`); only which of the overflowing rows are visible looks jagged rather than a clean truncation. **Track:** a proper fix means measuring each pane's actual available row count (e.g. via `measureElement`/a ref, since ratios alone don't give absolute rows) and slicing the rows array to fit — with a "+N more" `DimAnnotation` hint or real keyboard scroll — rather than relying on Yoga's automatic clip. Sizeable enough to be its own story; flagged to the user rather than silently built or silently dropped.

## Deferred from: code review of 2-24-modify-edt-mandatory-branch-on-add-no-more-silent-default (2026-09-14)

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-24-modify-edt-mandatory-branch-on-add-no-more-silent-default.md`
  summary: `src/adapters/driving/cli` has zero regression tests exercising `edt modify` (`runEdtModify`) at all, so this story's backward-incompatible change (`--add-member` alone now always fails with `branch-required` instead of silently succeeding on the repo's current branch) ships with no CLI-layer coverage.
  evidence: repo-wide search found no test file under `src/adapters/driving/cli` calling `runEdtModify`/`edt modify`; pre-existing gap in CLI test coverage generally, not introduced solely by this story. **Track:** add a CLI-level regression suite for `edt modify` next time that adapter is touched.

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-24-modify-edt-mandatory-branch-on-add-no-more-silent-default.md`
  summary: `modify.ts`'s step 3 `setBranches` loop never dedupes by resolved `repoPath` — a caller (realistically only the CLI's repeatable `--set-branch` flag) supplying two entries for the same path triggers two sequential `git checkout`s and two result rows for one repo.
  evidence: `src/core/edt/modify.ts`'s step 3 loop (`for (const { repoPath, branch } of setBranches)`) iterates the raw array with no path-keyed dedup; this loop and its lack of dedup predate story 2.24 — the new `pendingAdds` mechanism just reuses it as-is. **Track:** dedupe (last-wins or explicit conflict error) next time this loop is touched.

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-24-modify-edt-mandatory-branch-on-add-no-more-silent-default.md`
  summary: `core/edt/modify.ts` never independently validates that a `setBranches` entry's branch string is non-empty — only the TUI's `submitModify` blocks confirm on an empty staged value, so a raw CLI call (`--set-branch path=`) can pass an empty branch straight through to `git.assertAllowedBranch`/`git.checkout`.
  evidence: no non-empty check exists anywhere in `modify.ts`'s step 1 or step 3; this mirrors the codebase's existing convention of validating at the UI layer only (same as topic/branch-name validation elsewhere), not a gap unique to this story. **Track:** consider a core-layer guard if a CLI misuse report ever surfaces this in practice.

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-24-modify-edt-mandatory-branch-on-add-no-more-silent-default.md`
  summary: Two concurrent `modifyEdt` calls adding the same not-yet-member repo with different requested branches can race, since step 3's checkout runs pre-lock (before `lock.acquire`) — whichever call's `git checkout` runs last wins the repo's actual branch, independent of which call's result ends up persisted.
  evidence: `src/core/edt/modify.ts`'s protected-switch (stash/checkout/restore) in step 3 runs entirely before the `lock.acquire()` call later in the function; this pre-lock-checkout architecture predates story 2.24 and applies equally to the pre-existing branch-change/Add-to-EDT paths, not just the new `pendingAdds` case. **Track:** revisit if this race is ever observed in practice — likely needs the checkout itself moved inside the lock, a larger architectural change.

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-24-modify-edt-mandatory-branch-on-add-no-more-silent-default.md`
  summary: The Modify checklist's auto-staged branch suggestion (`suggestBranchForNewMember`) is computed once, at the moment a candidate is checked, and never live-recomputes if the topic is edited afterward — unlike the create dialog's Story 2.22 branch-name field, which keeps recomputing its slug suggestion until the field is manually touched.
  evidence: the Space-toggle handler in `edts-zone.tsx` stages `branchEdits[path]` once via `prev.topic` at check-time and never revisits it on later topic edits; the frozen spec only requires the suggestion to auto-stage and remain editable (both satisfied), not to live-refresh — a real but non-blocking UX inconsistency between the two dialogs' otherwise-similar suggestion mechanics. **Track:** align the two suggestion mechanics next time either dialog's branch-suggestion logic is touched.

## Deferred from: code review of 2-27-edt-creation-branch-picker-reuse-manifest-aware-base-branch-default (2026-09-16)

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-27-edt-creation-branch-picker-reuse-manifest-aware-base-branch-default.md`
  summary: `DEFAULT_BASE_BRANCH` is still publicly re-exported from `src/adapters/driving/tui/store/app-store.ts:24`, but after this story it is read only inside `edt-slice.ts` itself (its own definition plus `NO_BRANCH_CREATION`'s `base` fallback) — dead public surface left behind by this story's "stop reading it as a UI suggestion source" migration.
  evidence: repo-wide grep for `DEFAULT_BASE_BRANCH` outside test files shows the symbol used only in `edt-slice.ts` and re-exported (unused) from `app-store.ts`; every other hit is a comment. **Track:** remove the re-export next time `app-store.ts`'s exports are touched.

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-27-edt-creation-branch-picker-reuse-manifest-aware-base-branch-default.md`
  summary: The `BranchPickerOutcome` value-extraction ternary (`outcome.kind === 'set' ? outcome.branch : outcome.kind === 'create' ? outcome.branchName : outcome.newName`) is now duplicated identically across `create-dialog.tsx`, `modify-dialog.tsx`, and `service-actions-dialog.tsx`, with no shared helper — a future change to `BranchPickerOutcome`'s shape needs updating all three call sites in sync.
  evidence: same ternary shape appears verbatim in all three dialog files' outcome-application functions (pre-existing duplication across 2 of the 3 sites since story 2.26; this story added the third). **Track:** extract a shared `resolveBranchPickerOutcomeValue(outcome)` helper next time any of these three call sites is touched.

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-27-edt-creation-branch-picker-reuse-manifest-aware-base-branch-default.md`
  summary: `CreateBranchOptions` (`core/edt/create.ts`) now carries both a required `base: string` and an optional `bases?: Record<string,string>` with no runtime invariant enforcing they agree; only `edts-zone.logic.ts`'s own `buildCreateBranchOptions` currently keeps them consistent (deriving `base` from `bases[firstSelectedMember]`), so a hypothetical future caller could set `base` without a matching `bases` entry and silently diverge from this story's per-member convention.
  evidence: `resolveMemberBranch` (`core/edt/create.ts:339`) reads `options.bases?.[member] ?? options.base` per member — two overlapping sources of truth for the same data, introduced by this story's `bases` addition; the only current construction site keeps them in sync, so nothing breaks today. **Track:** consider deriving `base` from `bases` internally (single source of truth) if a second real caller of `CreateBranchOptions` ever appears.

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-27-edt-creation-branch-picker-reuse-manifest-aware-base-branch-default.md`
  summary: No test drives the shared branch-fetch effect's `branchesStatus: 'error'` ("Failed to load branches.") rendering path through the new Create base-branch entry point specifically — a pre-existing gap for the other 3 `BranchPicker` entry points too, but Create is a new consumer of that same effect as of this story.
  evidence: `edts-zone.tsx`'s branch-fetch effect (extended to `dialog.kind === 'create'` by this story) is the sole producer of `branchesStatus`; grepping the interaction/unit test suites for `branchesStatus: 'error'` finds no case covering any of the 4 entry points, Create included. **Track:** add coverage for all 4 entry points together next time this effect is touched.

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-27-edt-creation-branch-picker-reuse-manifest-aware-base-branch-default.md`
  summary: The spec's own `## Spec Change Log` section is empty even though its Design Notes "Implementation addendum" documents a materially new core API surface (`CreateBranchOptions.bases`, a change to `resolveMemberBranch`) that was not in the original frozen Code Map.
  evidence: `spec-2-27-...md`'s `## Spec Change Log` section has no entries; the addendum under `## Design Notes` reads like exactly the content that section exists for. **Track:** process note for spec hygiene — no code impact.

## Deferred from: code review of 2-29-delete-an-edt (2026-09-17)

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-29-delete-an-edt.md`
  summary: `delete-dialog.tsx` never calls `logEdtAction` for the active-EDT-rejection path, unlike every sibling EDT dialog (create/switch/modify/add-to-edt/service-actions), which all log an equivalent rejection.
  evidence: the dialog's own in-code comment justifies skipping the log for the *successful*/partial-failure paths (the EDT's SQLite file, which hosts the action log, is already gone by then per AD-7) but that reasoning does not extend to the `rejected` (active-EDT) state, where the file is still present and untouched. Intent is genuinely ambiguous — the frozen spec never mentions action-log behavior for delete — so this wasn't treated as a blocking bad_spec finding. **Track:** get an explicit human call on whether a delete rejection should be logged, next time this dialog or the action-log convention is touched.

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-29-delete-an-edt.md`
  summary: `edt-delete <topic>` gives zero feedback when `<topic>` matches no registered EDT — the dialog-opening effect just closes silently (`setDialog({ kind: 'none' })`).
  evidence: `edts-zone.tsx`'s `currentEdtAction` effect already behaves identically for `edt-switch <topic>`/`edt-modify <topic>` with an unmatched topic — a pre-existing, story-independent convention this story's `delete` branch simply mirrors rather than introduces. **Track:** revisit for all three commands together next time this effect is touched; arguably riskier for a destructive action than for switch/modify.

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-29-delete-an-edt.md`
  summary: `delete-dialog.tsx`'s `submitDelete` (and every sibling confirm dialog's own submit handler) reads `current.submitting` from the closure captured at call time rather than freshly from state, so two `Enter` keypresses arriving before the first `setDialog({submitting: true})` update is observed could invoke the delete action twice concurrently.
  evidence: `switch-dialog.tsx`'s `handleSwitchConfirm` guards re-entrancy the exact same way (`current.submitting`, not a synchronous ref) — a pre-existing pattern across every confirm-style EDT dialog, not specific to this story, and each real keypress is processed by Ink's `useInput` one at a time in practice. **Track:** if this is ever observed in practice (e.g. key-repeat, programmatic double-dispatch), switch every confirm dialog to a synchronous `useRef` in-flight guard together.

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-29-delete-an-edt.md`
  summary: `tui-back edt delete <topic>` cannot delete an EDT whose topic literally begins with `--` — the positional-argument parser treats any leading-`--` token as an unknown option, with no `--` end-of-options escape hatch.
  evidence: `runEdtDelete` (`src/adapters/driving/cli/subcommands.ts`) parses `<topic>` as the first non-flag token, per this story's own approved spec/Code Map (`tui-back edt delete <topic> [--branches ...]`, deliberately positional unlike `create`/`switch`/`modify`'s `--topic`/`--to` flags) — changing the argument shape now would be a disruptive, low-value change for an unlikely topic name. **Track:** add a `--` end-of-options convention if this is ever hit in practice.

## Deferred from: code review of 3-1-group-update-pull-restart-edt-scoped (2026-09-17)

- source_spec: `_bmad-output/implementation-artifacts/epic-3/spec-3-1-group-update-pull-restart-edt-scoped.md`
  summary: The dirty-worktree pre-check in `groupUpdate`'s per-member flow is a non-atomic time-of-check — uncommitted changes or a branch switch landing between the check, fetch, merge, and restart are not serialized by any per-repo primitive.
  evidence: `src/core/scripts/group-update.ts`'s `hasUncommittedChanges` gate runs before the pull/merge/restart sequence with no lock held on the repo itself (same check-then-act shape as the pre-existing `GitPort` operations). Tolerable in practice — `git merge` refuses when it would overwrite dirty files — and fixing it needs a per-repo mutual-exclusion primitive that does not exist yet. **Track:** revisit if a concurrent-edit-during-update incident is ever observed, together with the analogous `GitPort` check-then-act gaps.

## Deferred from: code review of 3-2-run-migrations-as-part-of-the-group-update (2026-09-17)

- source_spec: `_bmad-output/implementation-artifacts/epic-3/spec-3-2-run-migrations-as-part-of-the-group-update.md`
  summary: `runMigration` spawns the migration command with no timeout or kill guard, so a hanging migration (e.g. waiting on a DB lock or stdin) blocks its service's update — and the TUI event loop — indefinitely.
  evidence: `src/adapters/driven/migration/index.ts` calls `spawnSync` with no `timeout` option, the same no-timeout shape as the pre-existing git/container adapters; choosing a timeout value and kill semantics is a human intent decision, not a trivial fix. **Track:** decide a timeout/kill policy (ideally once, across git/container/migration spawns) before or during story 3.5, which owns migration failure UX.

## Deferred from: code review of 3-4-assisted-resolution-of-merge-conflicts-dirty-state (2026-09-21)

- source_spec: `_bmad-output/implementation-artifacts/epic-3/spec-3-4-assisted-resolution-of-merge-conflicts-dirty-state.md`
  summary: `listDirtyPaths` parses `git status --porcelain` without `-z`, so quoted/escaped paths and `old -> new` rename splits can mis-resolve exotic filenames and miss (never wrongly grant) the lockfile auto-fix.
  evidence: `src/adapters/driven/git/index.ts`'s `listDirtyPaths` strips surrounding quotes but never unescapes porcelain C-style escapes and splits renames on every ` -> ` occurrence. Surfaced by review (blind-hunter + edge-case-hunter); degrades safe (falls through to the guided menu, never a wrong silent discard) and only affects exotic filenames. **Track:** a `-z`/NUL-delimited porcelain parse (rename format changes under `-z`) the next time this adapter is touched.
- source_spec: `_bmad-output/implementation-artifacts/epic-3/spec-3-4-assisted-resolution-of-merge-conflicts-dirty-state.md`
  summary: Quitting (`markUpdateInterrupted`) or clearing (`clearUpdate`) the Update zone while a resolution blocker is raised orphans the core seam promise — it hangs forever instead of settling the run.
  evidence: `src/adapters/driving/tui/store/slices/update-slice.ts` nulls `pendingBlockerResolve` without resolving it on those paths; user-visible state stays consistent (flags are cleared, a new run works), but the abandoned run's `await onUpdateBlocker` never settles. Surfaced by review (blind-hunter); settling it needs an abandon-vs-cancel-run design decision, not a trivial fix. **Track:** decide (abandon silently vs. resolve `cancel-run` with a run-generation guard) next time the update slice is touched.
- source_spec: `_bmad-output/implementation-artifacts/epic-3/spec-3-4-assisted-resolution-of-merge-conflicts-dirty-state.md`
  summary: Eight test files hand-maintain their own full `GitPort` fake listing all five story-3.4 methods with no shared factory, so the next port addition touches every file and risks fake drift.
  evidence: `src/core/scripts/group-update.test.ts`, `src/core/edt/*.test.ts`, `src/adapters/driven/edt-registry/index.test.ts` and others each inline the five new methods. Surfaced by review (blind-hunter); mechanical and green today. **Track:** extract one shared `fakeGit` factory when the port next grows.
- source_spec: `_bmad-output/implementation-artifacts/epic-3/spec-3-4-assisted-resolution-of-merge-conflicts-dirty-state.md`
  summary: The resolution modal names the blocked service/repo/kind but never lists which paths are dirty or conflicted, so the developer chooses stash/editor/cancel without seeing the file list.
  evidence: `UpdateBlocker` in `src/core/scripts/group-update.ts` carries no path list and `formatBlockerBody` in `src/adapters/driving/tui/zones/update/update-zone.tsx` renders kind text only. Surfaced by review (blind-hunter); widening the seam shape is extra scope beyond the frozen spec. **Track:** carry the dirty/unmerged path list through the blocker the next time the seam shape is touched.

- source_spec: `_bmad-output/implementation-artifacts/epic-5/spec-5-1-aggregated-live-log-stream.md`
  summary: No automatic reconnect/retry when a live log stream dies mid-flight (`streamError` surfaced via `onUpdate`) — the only recovery path is manually deselecting and reselecting the same service, with no UI hint that this is expected.
  evidence: `LogsManager.subscribe` never retries after the adapter reports a mid-stream failure; the only way to re-run `docker.streamLogs` for that key is a fresh `subscribeLogsPane` call, triggered today only by a selection toggle. **Track:** design a reconnect/backoff strategy alongside story 5.3's health-status work, since automatic recovery is conceptually adjacent to health monitoring and out of story 5.1's frozen scope.

## Deferred from: code review of 5-2-filter-the-aggregated-stream (2026-09-18)

- source_spec: `_bmad-output/implementation-artifacts/epic-5/spec-5-2-filter-the-aggregated-stream.md`
  summary: `compileLogFilter`'s regex mode passes the user-typed query straight into `new RegExp(spec.query, 'i')` with no complexity/length guard, so a pathological pattern (e.g. `(a+)+$`) tested against buffered log lines on every render could hang the render loop.
  evidence: `src/adapters/driving/tui/zones/logs/logs-zone.logic.ts`'s `compileLogFilter` only catches a `RegExp` *construction* syntax error, never a slow-to-evaluate pattern; surfaced incidentally by review (blind-hunter), not required by the story's frozen scope (which only mandates rejecting a pattern that fails to compile). **Track:** revisit if a real hang is ever observed — options include a regex-complexity heuristic, a `RegExp` evaluation timeout (needs a worker/async boundary Ink's synchronous render doesn't have today), or documenting it as an accepted self-inflicted risk (the user only filters their own local session's logs, not shared/untrusted input).

## Deferred from: code review of 5-4-filter-history-recall (2026-09-20)

- source_spec: `_bmad-output/implementation-artifacts/epic-5/spec-5-4-filter-history-recall.md`
  summary: A persisted filter-history list's length isn't capped anywhere except at commit time (`pushFilterHistoryEntry`'s trim), and `stateSchema.filterHistory` has no `.max()` on array length or key count.
  evidence: If `settings.logs.filterHistorySize` is lowered after a list already grew larger, or `state.json` is hand-edited with an oversized array, `loadFilterHistory` loads it verbatim and the grid browser shows more entries than the configured max until the next commit for that exact scope+mode key happens to trim it; the zod schema (`src/adapters/driven/state/schema.ts`) accepts an unbounded map/array. The frozen spec only asked for trimming "on commit," so this matches the letter of the spec — surfaced by review (blind-hunter) as a hardening gap, not a story-scope violation. **Track:** enforce the cap on load too (and/or add a schema `.max()`) next time this area is touched.

- source_spec: `_bmad-output/implementation-artifacts/epic-5/spec-5-4-filter-history-recall.md`
  summary: No garbage collection (or manual clear path) exists for a service's filter history once that service is removed/renamed in the manifest, and the "Clear a service's filter history" drill-down list gives no indication of which services actually have history or a way to clear several at once.
  evidence: History is keyed by absolute `repoPath` in `state.json` forever; the Settings screen's per-service clear list (`settings-screen.tsx`) is built from `edtsBranches` (currently-known services only), so an orphaned entry for a removed/renamed service is permanently untargetable from the UI. Surfaced by review (blind-hunter); not required by the frozen spec, which doesn't mention manifest-removal handling. **Track:** revisit alongside any future manifest-service-removal story, or if `state.json` growth is ever observed.

- source_spec: `_bmad-output/implementation-artifacts/epic-5/spec-5-4-filter-history-recall.md`
  summary: "Clear global filter history" and "Clear a service's filter history" are both immediately destructive with no confirmation prompt or undo, and the Logs settings tab's row-cursor hint text doesn't distinguish which of the two rows fires immediately vs. which merely opens a submenu.
  evidence: In `settings-screen.tsx`, `Enter`/`Space` on "Clear global filter history" wipes both global lists (text+regex) on the spot; "Clear a service's filter history" only drills into a sub-list requiring one more `Enter`. The frozen spec asked only for "actions to clear history globally or per service," not for confirmation UX, so this isn't a spec violation — surfaced by review (blind-hunter) as a usability-safety gap. **Track:** revisit if an accidental-wipe complaint is ever reported, or when the settings screen next gets a confirmation-dialog primitive for any other destructive action.

- source_spec: `_bmad-output/implementation-artifacts/epic-5/spec-5-4-filter-history-recall.md`
  summary: The `filterHistorySize` settings row has no digit-preset quick-jump, unlike its siblings `bufferSize` (x100 presets) and `filterHistoryGridMaxRows` (1-9 presets) — reaching either end of its 1-200 range takes many repeated Left/Right presses.
  evidence: `settings-screen.tsx`'s `filterHistorySize` row only wires Left/Right step-adjust, no `parse*Digit` handler; every other numeric field on this tab (and the Command Palette tab) has one. Surfaced by review (blind-hunter) as a UX-consistency gap; the frozen spec's Boundaries named only the MIN/MAX-constant mirroring convention, not the full digit-preset idiom, so this wasn't a clear-cut spec requirement. **Track:** add a digit-preset (e.g. digit × 10) next time this tab is touched.

- source_spec: `_bmad-output/implementation-artifacts/epic-5/spec-5-4-filter-history-recall.md`
  summary: `filterHistoryKeyString`'s flat `service:${repoPath}:${mode}` encoding is ambiguous if a `repoPath` ever contains a literal colon (e.g. a Windows-style path) — safe today since the key is used only opaquely, but fragile for any future code that needs to decode it.
  evidence: `src/adapters/driving/tui/zones/logs/logs-zone.logic.ts`'s `filterHistoryKeyString` joins scope/repoPath/mode with `:` and is never parsed back today. Surfaced by review (blind-hunter). **Track:** switch to a safer separator or a structured (non-string) key before any decode-needing code (e.g. the manifest-removal GC above) is written against it.

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-35-edt-creation-core-per-service-branch-plans-remote-branches.md`
  summary: Remote-only branch plans derive the local name by stripping the first path segment, which is wrong for remote names containing a slash (e.g. `team/fork/feat/q` → `fork/feat/q`).
  evidence: `listRemoteBranches` returns flat `<remote>/<branch>` strings, so core cannot tell where a slashed remote name ends; fixing it needs `git remote` or structured `{remote, branch}` entries.
- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-35-edt-creation-core-per-service-branch-plans-remote-branches.md`
  summary: Picking `origin/x` in an `existing` plan when a local `x` already exists fails with `branch-exists` instead of offering the local branch — Story 2.37's wizard should steer the choice (or core should fall back to the gated local branch).
  evidence: `createTrackingBranch` rejects a colliding local name by design; the re-attach case (local `x` already tracking `origin/x`) is common and currently a dead end.

## Deferred from: code review of 3-7-pre-run-configuration-interface (2026-09-23)

- source_spec: `_bmad-output/implementation-artifacts/epic-3/spec-3-7-pre-run-configuration-interface.md`
  summary: The manifest schema accepts a whitespace-only `sharedBranch` (`z.string().min(1)` with no `.trim()`), which passes validation and later reaches git as a blank merge source on paths that bypass the TUI's inline blank-branch reject (e.g. a direct core call or the bare CLI with such a manifest).
  evidence: `src/adapters/driven/manifest/schema.ts` declares `sharedBranch` without `.trim()`; the root cause (schema laxity) predates this story — the bare-CLI 3.1 path already merges `loaded.sharedBranch` verbatim. Surfaced incidentally by review (edge-case-hunter). **Track:** trim/normalize `sharedBranch` (and audit sibling string fields) as part of backlog story 2-28 (registry-manifest-semantic-validation).

- source_spec: `_bmad-output/implementation-artifacts/epic-3/spec-3-7-pre-run-configuration-interface.md`
  summary: `UpdateConfigDialog` renders every targeted-service row unconditionally with no `BoundedList` windowing or scroll, so a large fleet (dozens of managed repos) would clip rows inside the `ModalDialog` without any way to reach them.
  evidence: `src/adapters/driving/tui/zones/update/update-config-dialog.tsx` maps all `draft.rows` directly, unlike the 3.6 shell which bounds the service list via `BoundedList` + terminal-height chrome budget. Surfaced by review (blind-hunter); v1 fleets are small so impact is theoretical today. **Track:** reuse the `BoundedList` + cursor-windowing pattern if a large-fleet case is ever observed.

## Deferred from: review of 3-9-per-service-actions-clean-restart-single-service-update (2026-09-24)

- source_spec: `_bmad-output/implementation-artifacts/epic-3/spec-3-9-per-service-actions-clean-restart-single-service-update.md`
  summary: A CLI group update and a TUI standalone restart can overlap on the same repo — core locks don't intersect (`service:<repoPath>` vs global/`edt:<ulid>`), only the TUI store guards separate them.
  evidence: `src/core/scripts/service-restart.ts` takes only the per-service lock while `group-update.ts` takes global (+edt) locks; no CLI entry for the standalone action exists yet, so the race needs concurrent CLI+TUI use. Surfaced by blind-hunter review layer. **Track:** resolve when Story 3.11 adds CLI commands (taking the global lock in serviceRestart is NOT the fix — it would serialize standalone restarts across different services, violating the per-service matrix row).

- source_spec: `_bmad-output/implementation-artifacts/epic-3/spec-3-9-per-service-actions-clean-restart-single-service-update.md`
  summary: A clean restart (recipe commands like `npm ci` / compose rebuild) runs on a single menu Enter with no confirmation step, unlike the update path's config-screen gate.
  evidence: `src/adapters/driving/tui/zones/update/update-zone.tsx`'s menu-choice branch runs `runServiceRestart` immediately after `setServiceMenu(null)`; the approved spec mandates no confirm step. Surfaced by blind-hunter review layer. **Track:** human UX-safety decision — confirm dialog, dry-run hint, or keep as-is — for Story 3.10/3.11 or a later pass.

## Deferred from: review of 2-39-edt-switch-core-three-state-partition-dirty-service-resolutions (2026-09-28)

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-39-edt-switch-core-three-state-partition-dirty-service-resolutions.md`
  summary: The switch classifies repos once before the `onDirtyReposBeforeSwitch` seam and never re-reads edts.yaml/state.json after the (unbounded) TUI pause, so resolutions can be applied to a stale classification if another process switches or edits EDTs meanwhile.
  evidence: `src/core/edt/switch.ts` computes `classifySwitchRepos` before `resolveDirtyRepos` awaits the seam; no lock is held across the pause (pre-existing seam shape from the pre-2.39 preview). Surfaced by edge-case-hunter and blind-hunter. **Track:** Story 2.41 (the real resolution dialog) should re-list and re-classify after the seam resolves, or refuse when the snapshot changed.

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-39-edt-switch-core-three-state-partition-dirty-service-resolutions.md`
  summary: A `discard` resolution on a repo with a rebase in progress runs `git reset --hard` + `clean -fd`, which does not end the rebase; the repo can be left mid-rebase after the switch.
  evidence: `discardAll` in `src/adapters/driven/git/index.ts` has no mid-merge/mid-rebase guard (`isRebaseInProgress` exists from story 3.4). Surfaced by edge-case-hunter. **Track:** decide in 2.41 whether a mid-rebase/merge repo is refused for discard or shown as its own state in the resolution dialog.

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-39-edt-switch-core-three-state-partition-dirty-service-resolutions.md`
  summary: `detail.discardedPaths` can list an untracked nested git repository as discarded although `git clean -fd` (no `-ff`) keeps it.
  evidence: `listDirtyPaths(repo, { expandUntracked: true })` reports a nested repo as `nested/`; `discardAll` intentionally never uses `-ff`. Surfaced by edge-case-hunter and blind-hunter. **Track:** re-list after discardAll and report only paths actually removed, when the 2.41 confirmation screen lists files.

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-39-edt-switch-core-three-state-partition-dirty-service-resolutions.md`
  summary: Stashes left under the removed fixed `tui-back:shared` tag (by a pre-2.39 switch whose restore failed) are no longer popped or surfaced by any code path.
  evidence: story 2.39 removed `NON_MEMBER_STASH_TAG` and its unconditional post-checkout pop from `src/core/edt/switch.ts` (required by the AC); the old pop also healed leftovers. Surfaced by edge-case-hunter and blind-hunter. **Track:** a one-off detection (dirty preview note or a doctor/status check) if any user reports such a stash.

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-41-edt-switch-resolution-dialog-global-strategy-per-service-overrides-discard-confirmation.md`
  summary: A deliberate cancel from the switch dialog (`switch-cancelled-by-user`) is still written to the action log as a `failed` action on the focused EDT, and every non-ok switch still logs to the focused EDT rather than a defined target.
  evidence: `handleSwitchConfirm` error branch in `src/adapters/driving/tui/zones/edts/dialogs/switch-dialog.tsx` predates 2.41 (kept unchanged by its spec); surfaced by blind-hunter.

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-41-edt-switch-resolution-dialog-global-strategy-per-service-overrides-discard-confirmation.md`
  summary: Branch names typed in the switch resolution dialog (and the create wizard) are not checked against git ref-name rules, so an invalid name passes inline validation and only fails the row at `createBranch`.
  evidence: no `check-ref-format`-style validator exists in the TUI layer; the git gate stays authoritative. Surfaced by edge-case-hunter.
- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-38-edt-creation-wizard-step-4-activation-switch-choice.md`
  summary: `listDirtyPaths` parses non-`-z` porcelain, so git C-quoted paths (non-ASCII/special characters) never match the raw `-z` paths from `diffNameOnly` — such an at-risk file is not flagged and the first-EDT pre-flight does not pause on it.
  evidence: Story 2.38 review (edge-case + blind hunters). Safe today (git's own checkout refuses to overwrite it, reported as a failed row), but the pause/overwrite UX is skipped; the fix (`status --porcelain -z` parsing) touches shared callers (switch.ts confirmedPaths, group-update's lockfile classifier).
- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-38-edt-creation-wizard-step-4-activation-switch-choice.md`
  summary: The first-EDT pause panel lists only repos with at-risk files; repos whose pre-flight already failed (missing member branch, manifest or diff error) are not shown before the developer confirms an overwrite.
  evidence: Story 2.38 review (blind hunter). Those repos surface as failed rows only after activation; the overwrite itself stays scoped to confirmed paths, so no data-loss impact.
- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-38-edt-creation-wizard-step-4-activation-switch-choice.md`
  summary: Zero EDTs but a stale `state.json` active pointer (to a removed EDT) makes the first-EDT activation refuse with `activate-has-outgoing`, leaving the new EDT inactive.
  evidence: Story 2.38 review (blind hunter). The wizard decides "first EDT" from the EDT count while `activateEdt` checks the pointer; delete refuses the active EDT, so the stale pointer needs an out-of-band edit, but nothing clears it.

- source_spec: `_bmad-output/implementation-artifacts/no-epic/spec-reset-command.md`
  summary: After a `:reset` of services, Logs zone panes stay subscribed to (and keep streaming/health-polling) repos that are no longer registered.
  evidence: runReset rehydrates edts/tabVisibility/registryEmpty/filterHistory only; logs-slice pane subscriptions are never pruned against the new registry.
- source_spec: `_bmad-output/implementation-artifacts/no-epic/spec-reset-command.md`
  summary: After a `:reset` of EDTs, per-zone UI state tied to deleted EDTs (EDT action log/detail pane, zone cursors, Update zone service list) is not cleared until the next natural reload.
  evidence: runReset only calls four loaders; other slices cache EDT/service-derived state with no reset hook.

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-42-manifest-defined-protected-branches-per-service.md`
  summary: The manifest schema does not trim `sharedBranch` (unlike `protectedBranches` entries), so a padded value such as `" main "` protects the padded name rather than `main`.
  evidence: `adapters/driven/manifest/schema.ts` keeps `z.string().min(1)` for `sharedBranch` (documented as non-trimmed in docs/tui-back-manifest.md); `isProtectedBranch` matches exactly, so the per-service protected set can miss the real shared branch.
- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-31-edt-create-from-clone-an-edt-as-a-creation-starting-point.md`
  summary: The EDT command openers (`edt-switch`/`edt-modify`/`edt-delete`/`edt-create-from`) encode "no argument" as the magic target `'select EDT'` and rebuild the topic with `split(/\s+/).join(' ')`, so an EDT literally named "select EDT" is unreachable by name and a topic with repeated inner whitespace never matches.
  evidence: Story 2.31 review (blind hunter, edge case hunter). `edt-slice.ts` openers and the `currentEdtAction` effect in `edts-zone.tsx` share the sentinel; a `target: string | null` would remove it for all four commands at once.
- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-31-edt-create-from-clone-an-edt-as-a-creation-starting-point.md`
  summary: An EDT command with a topic run before `edtsRows` has loaded resolves against an empty list — `edt-create-from` then shows a false "EDT not found", and switch/modify/delete silently close.
  evidence: Story 2.31 review (edge case hunter). The `currentEdtAction` effect in `edts-zone.tsx` consumes the action without waiting for the EDT list status.
- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-31-edt-create-from-clone-an-edt-as-a-creation-starting-point.md`
  summary: The `:` command-bar grid truncates command labels (e.g. `edt-switch` renders as `edt-switc`) once a longer command name widens the layout.
  evidence: Story 2.31 adding `edt-create-from` made `app-shell.interaction.test.tsx`'s grid assertion fail on the clipped label; the test was re-anchored on `edt-delete`, the layout itself was not fixed.

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-43-cross-edt-branch-usage-alerts-branch-choosers-rename-gate.md`
  summary: Cross-EDT ownership check (renameBranch and assertAllowedBranch) is not atomic with the git write and compares repo paths with resolve() only (no realpath/symlink canonicalisation).
  evidence: Pre-existing pattern in assertAllowedBranch (story 2.4); story 2.43 reuses it for renameBranch, so a concurrent registration or a symlinked repo path can bypass the gate.
- source_spec: `_bmad-output/implementation-artifacts/epic-6/spec-6-6-scanner-extension-parameters-request-body-skeletons.md`
  summary: The `nestjs-openapi` scanner ignores Swagger/OpenAPI 2.0 specs' request details (`in: body` parameters, `consumes`, `#/definitions/...` refs) and path-item-level `$ref`s.
  evidence: extractRequestDetails only reads OpenAPI 3.x `requestBody`/`components`; 2.0 operations yield plain routes (still listed, no body skeleton) — acceptable for the gateway today, revisit if a 2.0 repo activates route-explorer.
- source_spec: `_bmad-output/implementation-artifacts/epic-6/spec-6-7-jsontree-component-read-only-navigation-collapse-session-filters.md`
  summary: JsonTree builds rows via unbounded recursion, so a pathologically deep response (thousands of nesting levels) can overflow the call stack and crash the TUI.
  evidence: buildNode/flattenJson/countJsonNodes/listTreeContainers in shared/components/json-tree/model.ts recurse per nesting level with no depth cap; dev API responses make this unlikely, but a depth guard with a placeholder row needs a design decision.
- source_spec: `_bmad-output/implementation-artifacts/epic-6/spec-6-9-routes-right-pane-mandatory-request-step-request-response-sub-tabs.md`
  summary: Non-JSON request bodies (form, multipart, text) cannot be sent — the draft is always JSON-serialized with an inferred application/json content type, and the route's bodyContentType is not forwarded.
  evidence: fireRequest serializes options.body with JSON.stringify; canEditRouteBody opens an (empty) editor for any content type and CLI --body only accepts JSON — needs a raw-body channel design.
- source_spec: `_bmad-output/implementation-artifacts/epic-6/spec-6-9-routes-right-pane-mandatory-request-step-request-response-sub-tabs.md`
  summary: Per-route request drafts are never reconciled with the scanner after a same-repo reload, so a newly declared required path/query/header parameter does not appear in an existing draft.
  evidence: ensureRequestDraft keeps the existing draft by design and drafts survive same-repo reloads; a reseed/merge policy (and how to keep user edits) needs a decision.
- source_spec: `_bmad-output/implementation-artifacts/epic-6/spec-6-9-routes-right-pane-mandatory-request-step-request-response-sub-tabs.md`
  summary: Scanner-seeded query/header rows (including required ones) can be deleted with d and there is no "reset to seed" action to bring them back within the session.
  evidence: removeRequestRow ignores row.required and addRequestRow creates rows with required false; likely belongs with 6.3's saved-request editing.

- source_spec: `_bmad-output/implementation-artifacts/epic-3/spec-3-12-update-merge-source-from-another-edt.md`
  summary: The panels hook still reads the draft from props, so two keys delivered before a re-render can act on a stale draft (view and box are already read from refs).
  evidence: Edge-case review of story 3.12; the pre-existing simple config dialog has the same limitation, so a store-level `getState()` read would fix both.

## Deferred from: review of 7-2-container-less-managed-services (2026-10-05)

- source_spec: `_bmad-output/implementation-artifacts/epic-7/spec-7-2-container-less-managed-services.md`
  summary: Optional manifest fields use two conventions — `migrationCommand` documents a `null` fallback while `container` (since 7.2) omits the key — and the zod schema rejects explicit `null` for both.
  evidence: `.agents/skills/manifest-generator/SKILL.md` still instructs `migrationCommand: null` when undetected, but `z.string().trim().min(1).optional()` in `src/adapters/driven/manifest/schema.ts` rejects `null`; normalizing (nullish handling or doc alignment) is pre-existing debt surfaced, not caused, by 7.2. Surfaced by blind-hunter review layer.

- source_spec: `_bmad-output/implementation-artifacts/epic-7/spec-7-7-shared-focus-navigation.md`
  summary: Footer `[Tab/Shift+Tab] focus` hint stays visible in EDTs/Logs while a dialog, filter editor or fullscreen preview is open and Tab means something else.
  evidence: footerHintsFor only receives the zone id, not overlay/capture state (edge-case review).
  resolved_by: story 7.4b — the footer is context-live: a dialog, pane or screen registers its context and the zone hints return when it closes (`_bmad-output/implementation-artifacts/epic-7/spec-7-4b-interaction-alignment-follow-up.md`).
- source_spec: `_bmad-output/implementation-artifacts/epic-7/spec-7-7-shared-focus-navigation.md`
  summary: `TWO_PANEL_NAV` lives in `edts-zone.logic.ts` but is imported by shared dialog logic (wizard, switch-resolution); move it to the shared primitive or a dialogs module.
  evidence: layering smell flagged by the blind review; dialogs depend on a zone-specific module.

## Deferred from: review of 6-3-save-customize-and-re-fire-a-request (2026-10-06)

- source_spec: `_bmad-output/implementation-artifacts/epic-6/spec-6-3-save-customize-and-re-fire-a-request.md`
  summary: `global.db` has no version runner for future numbered schema files — `schema-001.sql` is re-applied on every open and there is no loader path for the `002.sql` that Story 6.5 will need for hide/favorite columns.
  evidence: `src/adapters/driven/saved-requests/index.ts` executes the single schema file unconditionally; the `schema_version` row exists but nothing reads it to decide which numbered files to apply. Surfaced by review (blind-hunter); deliberately left for 6.5, which is the first story that must evolve the schema.
  resolved_by: story 7.4b — `TWO_PANEL_NAV` now lives in `shared/keys/focus-navigation.ts` (`_bmad-output/implementation-artifacts/epic-7/spec-7-4b-interaction-alignment-follow-up.md`).

- source_spec: `_bmad-output/implementation-artifacts/epic-7/spec-7-4-interaction-consistency-audit-alignment.md`
  summary: Enforce the one-hint-format rule with a guard test; many wizard, Logs, Routes, registry and reset hints still bypass `formatHints`.
  evidence: Review found hand-written hints with mixed key spellings and letter case outside the helper, and no test checks the rule.
  resolved_by: story 7.4b — hints are declared data (`keybindings/footer-contexts.ts`), and `hints.guard.test.ts` fails any `[Key] verb` literal built outside `formatHints` (`_bmad-output/implementation-artifacts/epic-7/spec-7-4b-interaction-alignment-follow-up.md`).
- source_spec: `_bmad-output/implementation-artifacts/epic-7/spec-7-4-interaction-consistency-audit-alignment.md`
  summary: Derive the footer's resize filter and StateLine's `[R] retry` from the keybinding declarations, and fix the shared → keybindings → zones type-import layering.
  evidence: `footerHintsFor` compares against a duplicated RESIZE_HINT string, StateLine hard-codes the retry text, and `list-cursor.ts` imports `NavigationKey` from `keybindings/`.
  resolved_by: story 7.4b — footer entries carry `when: 'resizable'`, StateLine takes `RETRY_HINT` from the declarations, `NavigationKey` moved to `shared/keys/navigation-key.ts` (`_bmad-output/implementation-artifacts/epic-7/spec-7-4b-interaction-alignment-follow-up.md`).
- source_spec: `_bmad-output/implementation-artifacts/epic-7/spec-7-4-interaction-consistency-audit-alignment.md`
  summary: Reuse the shared list-cursor reducer in settings-screen and repo-registry-screen instead of repeating the Home/End computation, and adopt StateLine in the remaining loading/empty spots.
  evidence: Review found about eight inline `key.home ? 0 : len - 1` copies and unconverted "Loading…"/"No … yet" lines.
  resolved_by: story 7.4b — settings and registry call `nextCursorForKey`; loading/empty/error lines go through `StateLine` (`_bmad-output/implementation-artifacts/epic-7/spec-7-4b-interaction-alignment-follow-up.md`).

- source_spec: `_bmad-output/implementation-artifacts/epic-7/spec-7-4b-interaction-alignment-follow-up.md`
  summary: Long footer contexts (logs-fullscreen, routes-body-tree-add, wizard-pause) can wrap or clip on 80-column terminals; decide truncation or a two-line footer.
  evidence: Review found no truncation or width test, and the agent reverted `truncate-end` because it cut Logs hints in an AppShell test.
- source_spec: `_bmad-output/implementation-artifacts/epic-7/spec-7-4b-interaction-alignment-follow-up.md`
  summary: Close the hint-guard holes (keys longer than three characters, trailing comments, whole-file allowlist) and untangle the keybindings ↔ shared/components dependency cycle.
  evidence: `hints.guard.test.ts` is a regex scan with a 1-3 character key pattern and a whole-file Dashboard exemption; `keybindings/` now imports `shared/components/hints` while components import it back.
- source_spec: `_bmad-output/implementation-artifacts/epic-7/spec-7-4b-interaction-alignment-follow-up.md`
  summary: Restore discoverability of the BranchPicker "other members' branches" sub-list outside the footer, and derive the Tab focus hint from each zone's focus-nav declaration.
  evidence: The in-pane `[↓] other members' branches` hint was removed and `footerHintsFor` now uses a static `Tab/Shift+Tab` entry guarded only by a mode assertion.

- source_spec: `_bmad-output/implementation-artifacts/epic-7/spec-7-9-bounded-rendering-audit-global-fix-regression-guard.md`
  summary: Rewrite the bounded-rendering static guard on the TypeScript AST (regex misses `>` in attributes, nested/self-closing Text, `visible*`-named receivers satisfied by renaming) and extend it beyond `.tsx`.
  evidence: Blind Hunter and Edge Case Hunter both showed regex false negatives; allow-list "empty on purpose" is only syntactically enforced.
- source_spec: `_bmad-output/implementation-artifacts/epic-7/spec-7-9-bounded-rendering-audit-global-fix-regression-guard.md`
  summary: Handle display width (CJK, emoji, zero-width) in bounds math, truncation and matrix assertions instead of UTF-16/code-point counts.
  evidence: normalizeMessage, tab-bar width estimate and matrix `Array.from(line).length` all count characters, not columns.
- source_spec: `_bmad-output/implementation-artifacts/epic-7/spec-7-9-bounded-rendering-audit-global-fix-regression-guard.md`
  summary: Constant-size collections capped with silent `.slice` (wizard breadcrumb, table columns, step views, global lines, pane tabs) hide later additions without a "+N more" marker; chromeRows budgets are hand estimates; dialogs opened from local state (Update config panels, Routes dialogs, quit-confirm/blocker) are not force-opened in the matrix.
  evidence: Edge Case Hunter and Verification Gap reports on the 7.9 diff.

- source_spec: `_bmad-output/implementation-artifacts/epic-4/spec-4-1-shared-types-modules-manifest-parameters.md`
  summary: Harden `writeVersionLine` against nested decoy section keys, braces inside string values, duplicate keys and a dependency declared in both dependencies and devDependencies.
  evidence: The targeted text edit locates the block with a regex plus the first `}`; valid but unusual package.json shapes (overrides nesting, duplicate keys) can make it edit the wrong block or fail.
- source_spec: `_bmad-output/implementation-artifacts/epic-4/spec-4-1-shared-types-modules-manifest-parameters.md`
  summary: Make `writeVersionLine` atomic (temp file plus rename) and reject a blank version.
  evidence: `writeFile` writes in place, so a crash mid-write can truncate package.json.
- source_spec: `_bmad-output/implementation-artifacts/epic-4/spec-4-1-shared-types-modules-manifest-parameters.md`
  summary: Distinguish auth-related E404 (private scope, E401/E403) from "version not published" in `verifyPublished`, and guard against package names starting with `-`.
  evidence: A misconfigured registry login would be reported as an unpublished version; manifest-controlled names reach the npm argv.
- source_spec: `_bmad-output/implementation-artifacts/epic-4/spec-4-1-shared-types-modules-manifest-parameters.md`
  summary: Constrain `packageJsonPath` to stay inside the repo (no absolute path, no `..`) when stories 4.2+ join it with a repo path.
  evidence: The manifest schema currently accepts any non-blank string.

- source_spec: `_bmad-output/implementation-artifacts/epic-4/spec-4-2-propagate-a-version-to-chosen-services.md`
  summary: Unstage the files staged by `stagePaths` when the following `commit` fails, so a retry or a later commit does not sweep them in.
  evidence: Propagation stages `package.json`/`package-lock.json` then commits; a commit failure (hook, identity) leaves them staged.

- source_spec: `_bmad-output/implementation-artifacts/epic-4/spec-4-2-propagate-a-version-to-chosen-services.md`
  summary: Re-check the branch gate immediately before the git write to close the window where HEAD changes after the first check.
  evidence: The gate runs in the gate step and again in stagePaths/commit, but a branch switch between the check and the git command is not prevented (rare TOCTOU).

- source_spec: `_bmad-output/implementation-artifacts/epic-7/spec-7-10-switch-carry-a-dirty-tui-back-yaml-across-the-edt-switch.md`
  summary: A member switch's branch gate (`assertAllowedBranch`) now reads the HEAD version of a dirty `.tui-back.yaml` (protected branches) because the carry clears it first.
  evidence: The git adapter resolves the protected set from the on-disk manifest at gate time; the carry runs before it. Edge case: only differs when the local edit changes `protectedBranches`/`sharedBranch`.
- source_spec: `_bmad-output/implementation-artifacts/epic-7/spec-7-10-switch-carry-a-dirty-tui-back-yaml-across-the-edt-switch.md`
  summary: A symlinked `.tui-back.yaml` is read through but restored as a regular file; file mode is not preserved by the carry.
  evidence: `capture` stores bytes only and `restore` renames a temp file over the target.

- source_spec: `_bmad-output/implementation-artifacts/epic-3/spec-3-19-full-screen-service-report.md`
  summary: `[f] full report` footer hint is static for the whole Update zone instead of being shown only when a report is available.
  evidence: The footer comes from a static KEYBINDINGS row with zones; conditional hints need a dynamic footer mechanism. The matrix row "nothing to show" expects no hint advertised.
- source_spec: `_bmad-output/implementation-artifacts/epic-3/spec-3-19-full-screen-service-report.md`
  summary: `computeLineRowCount` / `sliceVisibleWindow` live in logs-zone.logic and are imported cross-zone by update-zone.logic; move them to a shared module.
  evidence: Update zone logic now depends on the Logs zone's logic file.
- source_spec: `_bmad-output/implementation-artifacts/epic-3/spec-3-19-full-screen-service-report.md`
  summary: A single wrapped line taller than the viewport cannot be scrolled within in the full-screen report; only its first rows are reachable.
  evidence: reportWindow always shows whole lines; reported by blind review.
- source_spec: `_bmad-output/implementation-artifacts/epic-3/spec-3-18-parallel-update-run-incident-queue.md`
  summary: The incident popup can open over a service menu, pick or full-screen report that was already open in the Update zone.
  evidence: The store opens the popup on the first incident whenever the Update zone is active, without knowing the zone's local dialogs; reported by edge-case review.
- source_spec: `_bmad-output/implementation-artifacts/epic-3/spec-3-18-parallel-update-run-incident-queue.md`
  summary: A run cancelled with unstarted services (now `run-cancelled` rows) still clears an `interrupted` EDT status because no row is `failed`.
  evidence: groupUpdateEdt only checks for failed rows before setStatus('active'); reported by edge-case review.
- source_spec: `_bmad-output/implementation-artifacts/epic-3/spec-3-18-parallel-update-run-incident-queue.md`
  summary: update-incidents-dialog imports blocker helpers from update-zone while the zone imports the dialog (circular import); the helpers belong in a shared logic module.
  evidence: Works at runtime (use only inside functions) but is a layering smell; reported by blind review.
- source_spec: `_bmad-output/implementation-artifacts/epic-3/spec-3-18-parallel-update-run-incident-queue.md`
  summary: The CLI `tui-back update` stays sequential (no concurrency passed) while the TUI defaults to 3; cancelled-run issue-log entries stay unresolved; the `:update-incidents` command gives no feedback with an empty queue; no docs mention `update.concurrency`, the `i` key or the awaiting status.
  evidence: Observed by the three review layers; none breaks the story's acceptance criteria.

- source_spec: `_bmad-output/implementation-artifacts/epic-5/spec-5-6-command-history-recall-shared-input-history-primitive.md`
  summary: The persisted-history store ignores failed or throwing state writes/reads (no user-visible warning, an unhandled rejection can surface in `mutate`/`resetAndDrain`).
  evidence: Carried over unchanged from the original filterHistory machinery in logs-slice.ts; `persist` discards the `Result` of `deps.write` and `load` silently keeps the default on a failed read.
- source_spec: `_bmad-output/implementation-artifacts/epic-5/spec-5-6-command-history-recall-shared-input-history-primitive.md`
  summary: A write to state.json while another field is corrupt treats the file as empty and overwrites it, discarding the valid sibling fields.
  evidence: Pre-existing `writeActiveEdt`/`writeSplitterRatios`/`writeFilterHistory` convention (only state-read-error is propagated); the shared `mergeWriteStateFile` preserves it, now also covering commandHistory.

- source_spec: `_bmad-output/implementation-artifacts/epic-4/spec-4-4-smart-group-update-shared-types-first.md`
  summary: Under `if-changed`, a source whose earlier publish failed (nothing new to merge) is never published, and a merge touching only non-package files still publishes.
  evidence: `shouldRunSharedTypesPhase` keys only on merge kind `advanced`; no check of the repo's own version against the registry.
- source_spec: `_bmad-output/implementation-artifacts/epic-4/spec-4-4-smart-group-update-shared-types-first.md`
  summary: A phase retry after publish succeeded but registry verification failed re-runs the publish command, and a partial-propagation retry re-propagates consumers that already succeeded without an idempotence test.
  evidence: Retry reuses `publishedVersion` only after a verified publish; the 4.3 already-published re-check is not applied inside the smart phase.
- source_spec: `_bmad-output/implementation-artifacts/epic-4/spec-4-4-smart-group-update-shared-types-first.md`
  summary: With the source row deselected the config row still shows its mode though confirm drops it, and a missing container/restart/sharedTypes dep silently runs a plain update.
  evidence: `confirmUpdateConfigDraft` drops the mode silently and `buildSharedTypesHook` returns null without a notice.
- source_spec: `_bmad-output/implementation-artifacts/epic-4/spec-4-4-smart-group-update-shared-types-first.md`
  summary: The phase result (published version, per-consumer outcomes) is not shown after the run, and a consumer skipped for a dirty package.json stays on the old version without a visible warning.
  evidence: Only failed consumers pause the run; results are discarded after the hook returns.

- source_spec: `_bmad-output/implementation-artifacts/epic-4/spec-4-5-auto-resolve-shared-types-only-merge-conflicts.md`
  summary: The conflict auto-resolver hardcodes `npm i` and `package-lock.json`, so a consumer on pnpm/yarn (or a workspace-root lock) gets a wrong lockfile.
  evidence: resolve-conflict.ts never reads the manifest's installer or other lock names; propagateVersion (4.2) has the same npm-only assumption, so it is a cross-story gap.
- source_spec: `_bmad-output/implementation-artifacts/epic-4/spec-4-5-auto-resolve-shared-types-only-merge-conflicts.md`
  summary: `writeResolvedFile` is not atomic and its containment check is lexical only (no realpath, `/`-based), so a symlinked package.json could be written through.
  evidence: git adapter `isInside` compares string prefixes; a crash mid-write leaves a truncated package.json during a merge. Low likelihood on the fixed package.json/lockfile paths.
- source_spec: `_bmad-output/implementation-artifacts/epic-4/spec-4-5-auto-resolve-shared-types-only-merge-conflicts.md`
  summary: A dependency declared in several sections (dependencies and devDependencies) of a conflicted package.json is treated as a mixed block and reported as an issue instead of being resolved.
  evidence: rewriteDependencyBlocks forces `mixed` when the dependency line matches more than once in a block.

- source_spec: epic-7/spec-7-11-overlay-owns-the-arrow-keys-settings-screen-help-panel.md
  summary: Gate `issues-dialog.tsx`'s `useInput` on the zone-input predicate and derive AppShell's two hand-written overlay-flag lists from `isZoneInputActive`.
  evidence: Story 7.11 review — both are unreachable leaks today, but a new overlay registered only in the predicate would not update AppShell.

- source_spec: `_bmad-output/implementation-artifacts/epic-7/spec-7-12-shared-service-actions-open-in-ide-simple-clean-restart.md`
  summary: Harden `tokenizeCommandLine`/`resolveEditorCommand` (unterminated quote, quotes-only value that should fall through to `$EDITOR`, `<repo>` in the binary position).
  evidence: The code was moved unchanged from the Update zone; the edge cases exist in the original (command.ts tokenizer swallows an unclosed quote into one token; an empty-string first token is chosen as the binary).
- source_spec: `_bmad-output/implementation-artifacts/epic-7/spec-7-12-shared-service-actions-open-in-ide-simple-clean-restart.md`
  summary: The editor launch runs `spawnSync` with inherited stdio without suspending Ink raw mode / alternate screen, and ignores signal/non-zero exit.
  evidence: Same behaviour as the pre-move `launchEditor`; terminal editors launched from the TUI may share the terminal with Ink's rendering.
- source_spec: `_bmad-output/implementation-artifacts/epic-7/spec-7-12-shared-service-actions-open-in-ide-simple-clean-restart.md`
  summary: Restart conflict is reported with the code `update-already-running`, which is misleading outside the update flow; the Update slice's `describeServiceRestart` still offers restart for a container-less service with a recipe, unlike the registry.
  evidence: Code reused from `service-restart.ts`; the two availability rules diverge until Stories 5.7/7.5 adopt the registry.
- source_spec: `_bmad-output/implementation-artifacts/epic-3/spec-3-20-update-configurable-global-defaults.md`
  summary: An invalid value in any settings key (e.g. `update.cleanRestart`) makes the whole settings file fall back to defaults, discarding unrelated valid settings.
  evidence: Existing loader convention (one zod parse for the whole file); Story 3.20 AC keeps it, but per-field fallback would be kinder.
- source_spec: `_bmad-output/implementation-artifacts/epic-3/spec-3-20-update-configurable-global-defaults.md`
  summary: "Start services" global default for the Update config screen was not delivered; the option does not exist in the 3.7 screen or in group-update.
  evidence: Story 3.20 AC mentions it but the human chose to defer it (no such option in code).
- source_spec: `_bmad-output/implementation-artifacts/epic-3/spec-3-20-update-configurable-global-defaults.md`
  summary: CLI `update --from-edt` consumes the next argument as topic even if it is an override flag, and repeated override flags are accepted silently.
  evidence: parseUpdateOverrides filters flags before topic parsing; edge case surfaced in review.
- source_spec: `_bmad-output/implementation-artifacts/epic-3/spec-3-20-update-configurable-global-defaults.md`
  summary: Settings Update tab cursor is not reset when switching tabs, and rapid toggles read a render-time snapshot of settings.
  evidence: Same behaviour as other settings tabs/concurrency edit; surfaced by edge-case review.

- source_spec: `_bmad-output/implementation-artifacts/epic-4/spec-4-6-shared-types-version-history-library.md`
  summary: Version-bump walk skips merge commits that change `package.json` (no diff under `git log -p`), so bumps introduced via merges are missed.
  evidence: `listVersionBumpCommits` does not pass `-m`/`-c`; edge-case review of story 4.6.
- source_spec: `_bmad-output/implementation-artifacts/epic-4/spec-4-6-shared-types-version-history-library.md`
  summary: In a shallow clone the grafted boundary commit shows the whole `package.json` as added and is reported as a false bump; the port doc promises a shallow-clone error.
  evidence: No `git rev-parse --is-shallow-repository` check in the history adapter.
- source_spec: `_bmad-output/implementation-artifacts/epic-4/spec-4-6-shared-types-version-history-library.md`
  summary: `loadSharedTypesHistoryBranches` has no stale-load token, so an EDT switch during an in-flight load can show the old source repo's branches.
  evidence: Slice sets state after await without checking the active EDT.
- source_spec: `_bmad-output/implementation-artifacts/epic-4/spec-4-6-shared-types-version-history-library.md`
  summary: Tab toggles the History search mode while the branch autocomplete dropdown may be open, instead of letting the autocomplete consume it; it also conflicts with the Tab-moves-focus convention.
  evidence: `shared-types-history.logic.ts` was added to the focus-navigation guard allowlist.

- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-44-edt-switch-optional-parallel-service-restart-verified-state.md`
  summary: The post-switch restart has no cancel and no timeout on `ServiceActions.restart` / `docker.getContainerHealth`; a hung call keeps the run `running` and blocks switches, updates and standalone restarts.
  evidence: `verifyService` only budgets its own poll loop (30 s); a hung `docker restart` or recipe command never resolves, and the TUI offers no escape hatch.
- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-44-edt-switch-optional-parallel-service-restart-verified-state.md`
  summary: With a restart mode set, the switch's action-log entry is written only after the whole restart run, so quitting mid-run loses the switch entry.
  evidence: `handleSwitchConfirm` awaits `runSwitchRestart` before `logEdtAction`; log the switch first and the restart outcome separately.
- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-44-edt-switch-optional-parallel-service-restart-verified-state.md`
  summary: A repo with an unreadable manifest, or two repos sharing a service name, is matched by service name only and may be reported `skipped (unchanged)` instead of surfacing the manifest error.
  evidence: `listSwitchRestartRepos` falls back to `service: repoPath` and `restartAfterSwitch` maps switch rows by `service` string (`SwitchEdtRepoResult` carries no repoPath).
- source_spec: `_bmad-output/implementation-artifacts/epic-2/spec-2-44-edt-switch-optional-parallel-service-restart-verified-state.md`
  summary: The EDTs zone's restart-report reopen effect reads `dialog`/`edtsRows` without listing them as dependencies, and the CLI gives no progress output during a long `--restart` run.
  evidence: `edts-zone.tsx` effect deps are `[switchRestart, edts]`; `runEdtSwitch` passes no `onPhase`.

- source_spec: `_bmad-output/implementation-artifacts/epic-8/spec-8-1-dashboard-snapshot-use-case-and-cli.md`
  summary: Bound the dashboard snapshot's parallelism and add per-probe timeouts.
  evidence: buildDashboardSnapshot runs exists/manifest.load for every registered repo and 3 git calls + 1 docker call per member through unbounded Promise.all; a hung docker/git call blocks the whole snapshot.

- source_spec: `_bmad-output/implementation-artifacts/epic-8/spec-8-2-dashboard-shell-states-fixed-banner-refresh.md`
  summary: Keep the previous Dashboard data on screen (with a dim "refreshing" cue) while a refresh runs, instead of swapping it for a spinner.
  evidence: `DashboardBody` renders the spinner whenever a section status is `loading`, so every `R` blanks the sections briefly; the spec only requires per-section spinners.
- source_spec: `_bmad-output/implementation-artifacts/epic-8/spec-8-2-dashboard-shell-states-fixed-banner-refresh.md`
  summary: Surface the cause (error code/message) of a failed Dashboard section load instead of a bare "Failed to load".
  evidence: `dashboard-slice.ts` drops the `Result` error on failure, so unwired ports, docker and registry errors look identical.

- source_spec: `_bmad-output/implementation-artifacts/epic-8/spec-8-3-dashboard-active-edt-services-table-service-actions.md`
  summary: `restartAvailability` is evaluated twice per `ServiceActions.list` (simple and clean), loading the manifest and peeking locks twice.
  evidence: Both restart actions share one availability; the list runs on every Dashboard focus move, so the manifest is read twice per move.

- source_spec: `_bmad-output/implementation-artifacts/epic-8/spec-8-6-branch-drift-detection-snapshot-attention.md`
  summary: Bound the concurrency of the Dashboard snapshot probes (members, others and registry summary each fan out through an unbounded Promise.all).
  evidence: Story 8.6 adds one exists/manifest/git rev-parse probe per non-member registered repo on every refresh, on top of the existing unbounded member and registry-summary probes; a large registry spawns that many git processes at once.

- source_spec: `_bmad-output/implementation-artifacts/epic-8/spec-8-7-realign-use-case-and-cli-selective-branch-realignment.md`
  summary: `edt switch --force` past a held `edt:<ulid>` lock proceeds without the lock, so it can run checkouts concurrently with the update or realign holding it.
  evidence: Pre-existing `--force` semantics (no abort primitive exists); story 8.7 made realign a new holder of that lock, widening the exposure, but the race already existed with EDT updates.

- source_spec: `_bmad-output/implementation-artifacts/epic-8/spec-8-7-realign-use-case-and-cli-selective-branch-realignment.md`
  summary: `restartAfterSwitch` keys restart targets by service name, so two managed repos sharing a manifest service name can be conflated in the restart report.
  evidence: Pre-existing in Story 2.44's restart phase; realign rejects ambiguous `--service` names but `--scope all` can still select both repos.

- source_spec: `_bmad-output/implementation-artifacts/epic-9/spec-9-1-shell-session-port-driven-adapter-core-shell-use-case.md`
  summary: Cancelling a container-shell run only kills the local `docker exec` client; the in-container process can keep running (mitigation: record the in-container PGID and `docker exec <c> kill -TERM -<pgid>`, or the 9.7 PTY adapter).
  evidence: Accepted limitation of the no-PTY decision (AD-22); without `-t` docker does not forward the signal into the container.

- source_spec: `_bmad-output/implementation-artifacts/epic-9/spec-9-1-shell-session-port-driven-adapter-core-shell-use-case.md`
  summary: Background jobs started with `cmd &` in a terminal run keep running after the run settles (until tui-back exits); decide whether the terminal view should list or reap them.
  evidence: Review of story 9.1 — adapter settles after the pipe-drain grace and only reaps groups on app exit; no policy exists for long-lived background jobs.

- source_spec: `_bmad-output/implementation-artifacts/epic-9/spec-9-6-shared-types-ux-action-bar-and-post-publish-choice-screen.md`
  summary: In the Shared Types form, long consumer checkbox rows wrap onto two lines while `BoundedList` counts them as one, so the 120x40 adversarial frame overdraws lines.
  evidence: Reproduced at baseline 72dc5611 once the size-matrix test stubs `loadSharedTypesSource`/`loadSharedTypesConsumers` so the form actually renders; the frame still fits rows x columns, so the matrix guard does not catch it.
- source_spec: `_bmad-output/implementation-artifacts/epic-9/spec-9-6-shared-types-ux-action-bar-and-post-publish-choice-screen.md`
  summary: `app-shell.interaction.test.tsx > AppShell reset screen (:reset) > opens only through the reset command, and Esc closes it with zero writes` fails (`RESET TOOL DATA` not in output).
  evidence: Fails at baseline 72dc5611 with the story changes stashed (1 failed / 5 passed in that file), so it predates story 9.6.

- source_spec: `_bmad-output/implementation-artifacts/epic-9/spec-9-3-shared-scrollable-output-and-fullscreen-primitive.md`
  summary: A stored scroll offset larger than the current visible line count (e.g. stream toggle or filter applied while scrolled up) yields an empty window and a misleading "Waiting for logs" placeholder; offset is only clamped at keypress time.
  evidence: `sliceVisibleWindow` computes `end = max(lines.length - offset, 0)` and returns [] when offset >= length; behaviour pre-dates story 9.3 (moved verbatim from logs-zone.logic.ts) and fixing it would change Logs frames, which 9.3 forbids. Terminal view (9.4) will hit the same path when its buffer is cleared.

- source_spec: `_bmad-output/implementation-artifacts/epic-9/spec-9-2-registry-entries-for-service-and-container-terminals.md`
  summary: The Dashboard service-actions row now carries five entries and is truncated at common widths (~120 cols), hiding the container terminal and its greyed reason.
  evidence: The story 9.2 zone test must render at 240 columns to see all five entries; ServiceActionsRow is a single truncate-end line and was out of scope to change (Ask First).
- source_spec: `_bmad-output/implementation-artifacts/epic-9/spec-9-2-registry-entries-for-service-and-container-terminals.md`
  summary: Each Dashboard row-focus change and every pre-run re-check now spawns a docker inspect for the container terminal, with no short-lived health cache or debounce.
  evidence: list() probes getContainerHealth on every call (dashboard-slice fetchActions on focus change and in runDashboardServiceAction); scrolling the services table can stack concurrent inspects.
- source_spec: `_bmad-output/implementation-artifacts/epic-9/spec-9-2-registry-entries-for-service-and-container-terminals.md`
  summary: app-shell.interaction.test.tsx "AppShell reset screen (:reset) > opens only through the reset command, and Esc closes it with zero writes" fails on the epic-9 branch.
  evidence: Fails 3/3 on story 9.2 and at the baseline 198de464 (output lacks 'RESET TOOL DATA'); not caused by story 9.2.

- source_spec: `_bmad-output/implementation-artifacts/epic-9/spec-9-4-terminal-view-in-the-tui.md`
  summary: Cancelling a container command while `core/shell` is still awaiting the container health check has no effect until that unbounded `getContainerHealth` call settles.
  evidence: `src/core/shell/index.ts` `execute` awaits `deps.docker.getContainerHealth` before honouring `cancelRequested`, with no timeout (Story 9.1 contract); the Terminal view shows "running" meanwhile.
- source_spec: `_bmad-output/implementation-artifacts/epic-9/spec-9-4-terminal-view-in-the-tui.md`
  summary: No test covers the composition root `src/bin/tui.ts` wiring the shell port and closing the terminal on exit.
  evidence: every slice/view test injects its own fake `shell`; removing `shell: createShellSessionPort()` from `src/bin/tui.ts` would leave the real app's terminal disabled with the suite green.
- source_spec: `_bmad-output/implementation-artifacts/epic-9/spec-9-7-health-first-service-status-resolution.md`
  summary: A `healthUrl` added to the manifest of a container-less service while the Logs zone is open is not picked up until container presence is re-resolved, because the presence cache short-circuits the manifest reload.
  evidence: Flagged by blind-hunter in the 9.7 review. The presence cache (`logsNoContainer`) predates 9.7; the resolver only reloads the manifest for rows already known to be probe-only. Manifest edits mid-session are rare; a zone re-entry or app restart picks the change up.
- source_spec: `_bmad-output/implementation-artifacts/epic-9/spec-9-7-health-first-service-status-resolution.md`
  summary: The same `healthUrl` can be probed by up to three independent pollers per 5 s interval (Logs pane, Logs listed row, Update list) with no shared cache or dedupe.
  evidence: Flagged by blind-hunter in the 9.7 review. Each poller existed before 9.7 with its own container read; 9.7 routes each through the resolver, so steady health-route traffic now scales with the number of open views. Acceptable for local dev services; a shared short-TTL status cache would remove it.
