---
title: 'EDT Creation — Branch-Picker Reuse & Manifest-Aware Base-Branch Default'
type: 'feature'
created: '2026-09-16'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'dad21b3e2820f2bf1b164e9f9b45ab9308b9d99d'
context:
  - `{project-root}/_bmad-output/implementation-artifacts/epic-2/epic-2-context.md`
  - `{project-root}/_bmad-output/implementation-artifacts/epic-2/spec-2-26-branch-picker-3-explicit-modes-pick-existing-create-new-rename-current.md`
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Create-EDT's branch-setup step still uses raw `<Text>` fields and a hardcoded `DEFAULT_BASE_BRANCH` ('development') default, unlike Modify/service-actions/add-to-EDT which already reuse the shared 3-mode `BranchPicker` (Story 2.26) — this hard-fails whenever a repo's real shared branch isn't literally named `development`.

**Approach:** Make Create-EDT's branch-setup step open the shared `BranchPicker` (Pick existing / Create new only — no Rename current, since nothing exists yet) and `TextInputLine` for the name field(s), instead of raw `<Text>`; switch every base-branch suggestion in the EDT zone from `DEFAULT_BASE_BRANCH` to each repo's manifest-declared `sharedBranch`, forcing a per-member base-branch picker when selected members' `sharedBranch` values diverge.

## Boundaries & Constraints

**Always:**
- Create's `BranchPicker` session always opens with `hasCurrentBranch: false` (no Rename current mode — nothing to rename yet).
- Branch-name field(s) (grouped or individual) use `TextInputLine`, closing the Story 2.23 gap.
- `ServiceBranchDivergence` (`core/edt/list.ts`) gains `sharedBranch: string`, sourced from the manifest already loaded per repo — no new port.
- Exactly one repo in play → suggested base branch is that repo's own `sharedBranch`, everywhere in the EDT zone (Create's branch-setup step and every `BranchPicker` "Create new" default).
- Grouped naming, ≥2 selected members, unanimous `sharedBranch` → that value is the suggestion. Diverging → grouped naming stays available for the branch *name*; base-branch field is forced into a per-member picker (mirrors `CreateDialogState.branchNames`' per-member shape).
- Every base-branch suggestion stays fully editable, never forced (Story 2.22 convention).
- `DEFAULT_BASE_BRANCH` (`edt-slice.ts`) stops being read as a suggestion source anywhere in the EDT zone — both `initialCreateDialog()` and `createPickerSession()`.

**Ask First:** None identified — shape is fully determined by the per-member `branchNames` precedent and existing `createPickerSession`/`BranchPicker` API.

**Never:**
- No new `ManifestPort` method — `sharedBranch` is already available via existing `manifest.load(repoPath)` calls.
- Do not touch Modify/service-actions/add-to-EDT's own "Rename current" mode — Create never offers it.
- `DEFAULT_BASE_BRANCH`'s other use as `NO_BRANCH_CREATION`'s `base` fallback (`edt-slice.ts`) is out of scope — that's a core default-params shape, not a UI suggestion.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Single repo | 1 selected member, manifest `sharedBranch: "main"` | Base-branch suggestion is `"main"`, never `"development"` | N/A |
| Grouped, unanimous | ≥2 members, all `sharedBranch: "main"` | Shared `"main"` suggestion; grouped name field stays available | N/A |
| Grouped, diverging | ≥2 members, `sharedBranch` `"main"` vs `"master"` | Grouped naming mode stays for the name; base-branch forced into per-member picker | N/A |
| Individual naming, diverging `sharedBranch` | ≥2 members, individual mode | Each member's base-branch field independently suggests its own `sharedBranch` | N/A |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/zones/edts/dialogs/create-dialog.tsx` -- L302-324: raw `<Text>` base-branch/name fields to replace with `<BranchPicker>` + `<TextInputLine>`; `handleCreateBranchStepInput` (L119-179) delegates to `handleBranchPickerKey` for the base-branch step.
- `src/adapters/driving/tui/zones/edts/edts-zone.logic.ts` -- `CreateDialogState` (L687-711): `baseBranch`(L700)/`branchNames`(L703, per-member precedent to mirror as new `baseBranches: Readonly<Record<string,string>>`). `initialCreateDialog()` L813-831 (`baseBranch: DEFAULT_BASE_BRANCH` at L823 — remove). `createPickerSession()` L874-894 (`defaultBaseBranch: DEFAULT_BASE_BRANCH` at L886 — shared default source for all `BranchPicker` entry points, becomes manifest-driven). `CreateFormFocus`/`isBranchStepFocus` L267-269.
- `src/adapters/driving/tui/store/slices/edt-slice.ts` -- `DEFAULT_BASE_BRANCH` L27 (stop reading as suggestion source; keep for `NO_BRANCH_CREATION.base` L35 only).
- `src/adapters/driving/tui/shared/components/branch-picker.tsx` -- `BranchPickerMode`/`cycleBranchPickerMode` L23-35 (pass `hasCurrentBranch: false` for Create's 2-mode cycle), `createBranchPickerState` L81-101, `handleBranchPickerKey` L175-226, `BranchPicker` component L378-449.
- `src/adapters/driving/tui/zones/edts/dialogs/modify-dialog.tsx` -- `openBranchPickerForModify` L118-135, real precedent for wiring `createPickerSession` into a dialog.
- `src/adapters/driving/tui/zones/edts/edts-zone.tsx` -- branch-fetch effect L244-280, keyed off `dialog.kind`; add `'create'`.
- `src/core/edt/list.ts` -- `ServiceBranchDivergence` L28-42 (add `sharedBranch: string`); manifest loaded at L110 inside the registered-repos loop; `readServiceDivergence` L127-170 builds the row (thread `loaded.data.sharedBranch` through).
- `src/core/ports/manifest.ts` -- `Manifest['sharedBranch']: string` L10 (non-optional in core type).
- `src/adapters/driven/manifest/schema.ts` -- zod default L23 (`.default('development')` — repo-level fallback, unrelated to this story's UI default).
- Tests: `branch-picker.test.tsx`, `edts-zone.interaction.test.tsx` (create-dialog flows, `initialDialogKind: 'create'`), `edts-zone.test.tsx` (pure-fn logic incl. `createPickerSession`/`initialCreateDialog`), `edts-zone.styles.test.tsx`/`edts-zone.layout.test.tsx` (swapped field rendering), `core/edt/list.ts`'s existing divergence test suite.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/edt/list.ts` -- add `sharedBranch: string` to `ServiceBranchDivergence`, thread `loaded.data.sharedBranch` through `readServiceDivergence` -- exposes the manifest value the rest of this story consumes, no new port
- [x] `src/core/edt/list.ts`'s test suite -- extend for the new `sharedBranch` field -- regression coverage for the data change
- [x] `src/adapters/driving/tui/zones/edts/edts-zone.logic.ts` -- `initialCreateDialog()`/`createPickerSession()` stop defaulting to `DEFAULT_BASE_BRANCH`; add per-member `baseBranches` record; derive suggestion (single/unanimous/diverging) from selected members' `sharedBranch` -- core suggestion-resolution logic, covers the I/O matrix
- [x] `src/adapters/driving/tui/zones/edts/dialogs/create-dialog.tsx` -- replace raw `<Text>` base-branch/name fields with `<BranchPicker>` (`hasCurrentBranch: false`) + `<TextInputLine>` -- closes the free-text and cursor gaps
- [x] `src/adapters/driving/tui/zones/edts/edts-zone.tsx` -- extend the branch-fetch effect to also key off `dialog.kind === 'create'` -- picker needs `listBranches` populated for Create too
- [x] Extend `branch-picker.test.tsx`, `edts-zone.interaction.test.tsx`, `edts-zone.test.tsx`, `edts-zone.styles.test.tsx`/`.layout.test.tsx` -- I/O matrix + swapped-field regression coverage (`branch-picker.test.tsx` needed no change — its own component/reducer contract is unchanged, only new callers)

**Acceptance Criteria:**
- Given the create-EDT dialog's branch-setup step, when it renders, then the base-branch field is the shared `BranchPicker` (Pick existing / Create new — no Rename current).
- Given the branch-name field(s), when rendered, then they use `TextInputLine` with a visible cursor.
- Given any base-branch suggestion anywhere in the EDT zone, when shown, then it stays fully editable, never forced.
- `npm test`, `npm run typecheck`, `npm run depcheck` all pass.

## Spec Change Log

## Design Notes

The new per-member `baseBranches: Readonly<Record<string,string>>` on `CreateDialogState` mirrors the existing `branchNames` field exactly (same repoPath-keyed shape, same touched-tracking convention as `branchNamesTouched`) — no new pattern introduced. `DEFAULT_BASE_BRANCH`'s remaining valid use (`NO_BRANCH_CREATION.base`) is untouched; only its role as a UI suggestion source is removed.

**Implementation addendum (not in the original Code Map, resolved during build):**

- **`CreateBranchOptions` gains an optional `bases?: Record<string, string>` (`core/edt/create.ts`).**
  The frozen matrix's "individual naming, diverging" and "grouped, diverging" rows both require
  a genuinely *different* base branch per member to actually reach `git.createBranch` — a
  single top-level `base: string` (unchanged since story 2.2) cannot express that, since each
  repo has its own independent branch namespace (repo A's `main` and repo B's `master` are not
  interchangeable). `resolveMemberBranch` now resolves `options.bases?.[member] ?? options.base`
  per member; every pre-2.27 caller that never sets `bases` keeps applying `base` uniformly,
  unchanged (verified: `create.test.ts`'s existing suite passes unmodified, plus one new case).
  `edts-zone.logic.ts`'s `buildCreateBranchOptions` always populates `bases` for every selected
  member (never only the diverging ones), with `base` falling back to the first member's own
  value for any caller that only reads the top-level field.
- **The base-branch `BranchPicker` session never performs a git write.** Unlike its 3 other call
  sites (Modify/service-actions/add-to-edt), where a confirmed `'create'`/`'rename'` outcome
  immediately calls `createMemberBranch`/`renameBranch`, Create's base-branch picker collapses
  every outcome kind (`set`/`create`/`rename`) to just its resulting string, assigned straight
  into `baseBranch`/`baseBranches[path]` — no branch is ever created or renamed as a side effect
  of merely *browsing a base-branch candidate*. That string later feeds `git.createBranch` once,
  per selected member, only when the whole form is actually submitted (the existing, unchanged
  `submitCreate` → `createEdtAction` path) — consistent with "every base-branch suggestion stays
  fully editable, never forced": nothing is ever auto-applied to a repo before that final submit.
  A "create a brand-new base branch across every selected member first" flow was considered and
  rejected as out of scope — it has no clean single-repo target for the "shared" (unanimous
  `sharedBranch`) case and isn't required by the frozen Boundaries/I-O matrix.
- **`createPickerSession`'s `defaultBaseBranch` becomes a required, caller-supplied option**
  (previously implicit via the module's own `DEFAULT_BASE_BRANCH` import). Every one of its 4
  call sites (Create's own base-branch step, Modify's `openBranchPickerForModify`,
  service-actions' `openServiceActionsBranchPicker`, `initialAddToEdtDialog`) now sources it from
  that repo's own `sharedBranch` (via the flat `ServiceBranchDivergence[]` candidate pool, now
  carrying it per story 2.27) — closing the "Always" boundary's "every `BranchPicker` 'Create
  new' default" clause, not just Create's own step. `ServiceActionsDialogDeps` gained a
  `candidates` field it didn't have before, to make that lookup possible.
- **The base-branch step's own `BranchPicker` session takes over input exactly like Modify's
  `branchPicker` sub-state does** (`Tab` cycles the picker's own Pick existing/Create new mode,
  never the outer form's field-to-field advance; `Escape` closes a nested rename/other-members
  sub-view first, falling back to "step back to members" once nothing is left nested) — the
  existing precedent this spec's Ask First section pointed to. One session is live at a time;
  the "per-member" display mode cycles through one session per selected member (confirm-driven,
  since `Tab` is claimed by the picker's own mode switch), closing and reopening a fresh one for
  the next member — mirroring Modify's own "reopen on each entry" convention, never a persisted
  `Record<string, BranchPickerSession>` (kept `CreateDialogState`'s shape to the single
  `branchPicker: BranchPickerSession | null` field the branch-fetch effect already expects).
- **Matrix Test Audit gap closed post-implementation:** the "Individual naming, diverging
  `sharedBranch`" row initially had only indirect coverage (naming-mode-agnostic unit tests for
  `resolveBaseBranchMode`/`prefillBaseBranches`). Added a dedicated end-to-end interaction test
  in `edts-zone.interaction.test.tsx` combining per-member base-branch divergence with individual
  naming, mirroring the existing "grouped, diverging" test — confirms the two axes compose
  correctly rather than relying on a naming-mode-independence argument alone.
- **`BranchPicker`'s "Create new" mode opens straight onto the Name field** for this specific use
  (`baseFocused: false`, overridden right after `createPickerSession` returns) — its own inner
  "base branch to create the new branch from" sub-field is real, useful chrome at the other 3
  call sites (a real branch gets created there) but unused clutter here (nothing is ever
  created), so requiring an extra `Enter` just to tab past it would contradict the shared
  component's own "Create new default, pre-filled suggestion" promise (spec 2.26) for this
  entry point. Tabbing away to Pick existing and back does reset it to `true` (a minor,
  accepted rough edge — the shared reducer's own general Tab handler, untouched by this story).

## Verification

**Commands:**
- `npm test` -- all suites green, including updated `branch-picker.test.tsx`, `edts-zone.*.test.tsx`, `core/edt/list.ts` suite
- `npm run typecheck` -- clean
- `npm run depcheck` -- no boundary violations

**Manual checks:**
- TUI: open Create-EDT, reach the branch-setup step — base-branch field is the `BranchPicker` (Pick existing / Create new only, `Tab`-cycled), pre-filled from the selected repo(s)' `sharedBranch`; with ≥2 members whose `sharedBranch` diverges, base-branch becomes per-member while naming can stay grouped; every suggestion remains editable.

## Suggested Review Order

**Manifest-driven base-branch data (entry point)**

- New field every other change consumes — each service's manifest-declared shared branch.
  [`list.ts:36`](../../../src/core/edt/list.ts#L36)

- Threads the manifest's `sharedBranch` into the row `listEdtBranchesDivergence` already builds.
  [`list.ts:126`](../../../src/core/edt/list.ts#L126)

**Per-member base-branch resolution & the real git write**

- `bases[member]` wins over the top-level `base` — the new per-repo override shape.
  [`create.ts:69`](../../../src/core/edt/create.ts#L69)

- The only real git write this data feeds — code-review fix: `||` not `??`, so an explicit empty override still falls back.
  [`create.ts:342`](../../../src/core/edt/create.ts#L342)

- Decides shared vs. forced-per-member from selected members' `sharedBranch` values.
  [`edts-zone.logic.ts:358`](../../../src/adapters/driving/tui/zones/edts/edts-zone.logic.ts#L358)

- Derives the top-level `base`/per-member `bases` map submitted to core.
  [`edts-zone.logic.ts:403`](../../../src/adapters/driving/tui/zones/edts/edts-zone.logic.ts#L403)

- `defaultBaseBranch` becomes a required, caller-supplied option — closes the boundary for all 4 `BranchPicker` entry points, not just Create's own.
  [`edts-zone.logic.ts:966`](../../../src/adapters/driving/tui/zones/edts/edts-zone.logic.ts#L966)

**Create-EDT dialog wiring**

- Opens/cycles one picker session per member when base-branch is forced per-member.
  [`create-dialog.tsx:145`](../../../src/adapters/driving/tui/zones/edts/dialogs/create-dialog.tsx#L145)

- Collapses the picker outcome to a plain string — this session never itself creates/renames a branch.
  [`create-dialog.tsx:186`](../../../src/adapters/driving/tui/zones/edts/dialogs/create-dialog.tsx#L186)

- The picker owns every keystroke while open, including Tab/Escape, before the outer form's generic handling.
  [`create-dialog.tsx:229`](../../../src/adapters/driving/tui/zones/edts/dialogs/create-dialog.tsx#L229)

- Renders the shared `BranchPicker` with the new `hideNestedBaseField` suppression flag.
  [`create-dialog.tsx:487`](../../../src/adapters/driving/tui/zones/edts/dialogs/create-dialog.tsx#L487)

**Shared `BranchPicker` component change**

- Code-review fix: suppresses the dead nested "Base branch" sub-field this repurposed entry point never uses.
  [`branch-picker.tsx:362`](../../../src/adapters/driving/tui/shared/components/branch-picker.tsx#L362)

- Relabels the remaining field "Base branch" instead of "Name" when hidden, only while unfocused.
  [`branch-picker.tsx:403`](../../../src/adapters/driving/tui/shared/components/branch-picker.tsx#L403)

**Manifest-driven default across Modify/service-actions (code-review fix)**

- Falls back to the member's own current branch, never blank, if the manifest candidate lookup misses.
  [`modify-dialog.tsx:136`](../../../src/adapters/driving/tui/zones/edts/dialogs/modify-dialog.tsx#L136)

- Same fallback fix, service-actions' own "Change branch" entry point.
  [`service-actions-dialog.tsx:128`](../../../src/adapters/driving/tui/zones/edts/dialogs/service-actions-dialog.tsx#L128)

**Peripherals**

- I/O matrix coverage plus the 4 code-review test additions (quick-submit, Pick-existing/Escape routing, manifest-base assertion).
  [`edts-zone.interaction.test.tsx:1052`](../../../src/adapters/driving/tui/zones/edts/edts-zone.interaction.test.tsx#L1052)

- Unit coverage for the new resolution functions (`resolveBaseBranchMode`, `suggestBaseBranchFor`, `prefillBaseBranches`).
  [`edts-zone.test.tsx:678`](../../../src/adapters/driving/tui/zones/edts/edts-zone.test.tsx#L678)

- Core-layer regression coverage for `sharedBranch` threading and the `bases` override.
  [`list.test.ts`](../../../src/core/edt/list.test.ts) · [`create.test.ts`](../../../src/core/edt/create.test.ts)

- Story 2-27 bumped to `in-progress` in sprint tracking.
  [`sprint-status.yaml`](../../../_bmad-output/implementation-artifacts/sprint-status.yaml)
