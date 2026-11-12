---
date: 2026-09-16
trigger: 'Functional review of Epic 2 stories currently `review` (2.22, 2.24, 2.25, 2.26) and `in-progress` (2.23), plus new capability requests for the EDT-management surface — an 8-point list from Max, refined interactively and diagnosed in code.'
mode: incremental
epic_impact: 'Epic 2 (in-progress) — 1 in-place amendment (2.26, unmerged-as-`done`: fixes a confirmed blocking bug), 6 new stories appended (2.27-2.32). No epic redefinition. PRD gains one new FR (EDT deletion, §4.2) — MVP scope unchanged (still EDT workspace management, just a missing lifecycle action being closed).'
scope_classification: moderate
---

# Sprint Change Proposal — 2026-09-16

## 1. Issue Summary

Max ran a functional pass over the EDT-management surface built by Epic 2 (stories up to 2.26
are on the `epic-2-edt-workspace-management` branch; 2.22/2.24/2.25/2.26 sit at `review` and
2.23 at `in-progress` in `sprint-status.yaml`) and reported 8 points. Two of them turned out, on
diagnosis, to be the precise root cause of a **confirmed blocking bug** ("impossible to complete
Create or Modify with branch selection") rather than separate polish items — the other six are
real, scoped gaps or missing capabilities. Every item below was investigated against the actual
code (not just the spec) before being turned into a change:

1. **Create-EDT's base-branch field is free text, no search/pick over existing branches.**
   Confirmed: `create-dialog.tsx`'s branch-setup step (Story 2.22) was never migrated onto the
   shared `BranchPicker` (Story 2.26) — 2.26's own implementation notes flag this explicitly as
   "a natural, explicitly-flagged follow-up, not required here."
2. **The branch-picker TUI should appear at EDT creation too, not just modification.** Same root
   cause as (1) — folded into the same fix.
3. **`registry` needs a manifest-validity check** (e.g. does the declared `sharedBranch` actually
   exist).
4. **A command to delete an EDT is missing**, with a per-service choice (leave the branch alone /
   delete it, including uncommitted work) informed by merge status.
5. **`edt-switch` should open a filterable list of EDTs to pick from.** Confirmed: with no
   argument, it silently jumps to "the first non-active EDT" instead of the quick-pick list
   Story 2.15 (`done`) already specifies. `edt-modify` has the identical gap (picks the currently
   *focused* row instead of offering a list) — folded into the same fix at Max's request.
6. **Create a new EDT from an existing one** — same services (+ add/remove), with each inherited
   service's new branch based on the root EDT's own current branch for it (not `development`).
7. **`TextInputLine` needs Left/Right cursor navigation** — confirmed out of scope by Story 2.23
   itself ("no mid-string cursor movement is introduced by this story ... flagged as a possible
   follow-up"). Extended, at Max's request, to also unify the command-bar and registry-screen's
   own hand-rolled text fields onto the same component/editing primitive.
8. **"Impossible to complete Create or Modify with branch selection."** Diagnosed precisely:
   - **Create:** `DEFAULT_BASE_BRANCH = 'development'` (`edt-slice.ts:27`) is a hardcoded TUI
     constant, sent to `createEdtAction` unchecked. When a repo's real shared branch isn't
     literally named `development`, branch creation hard-fails with no way to pick a real branch
     — this **is** points (1)/(2)'s gap, now confirmed as the actual blocker, not just a UX nicety.
   - **Modify:** two compounding bugs, both new findings:
     a. `BranchPicker` never renders which service/repo the open session applies to — no label
        anywhere in `ModifyDialogView` or `BranchPicker` itself.
     b. `resolveModifyEnterAction` (`edts-zone.logic.ts:604`) routes Enter to "open the branch
        picker" for **any currently-checked member row**, not just newly-added ones. Since
        existing members start checked, the members-list cursor almost never lands on a row
        where Enter submits — the only way out is the undocumented "Tab to Topic, then Enter."
        Reported as an infinite loop back to the member list, which is exactly this behavior.

## 2. Impact Analysis

### Epic Impact

Epic 2 (`in-progress`) absorbs:
- One in-place amendment to **Story 2.26** (`review`, already merged into `epic-2-edt-workspace-
  management` per its own merge commit, but not `done`) — two new ACs closing the two Modify bugs
  in §1.8. Not a reopening of `done` work, same precedent as the 2026-08-27 proposal's Story 2.18
  amendment.
- Six new stories, **2.27-2.32**, appended after 2.26 — same "branch still open" precedent as
  2.10/2.11/2.12/2.16/2.20/2.21.

No other epic affected. Epic 3+ (all `backlog`) are unaffected — none of this touches group
update, migrations, shared-types, logs, or routes.

### Story Impact

| Story | Change |
|---|---|
| 2.26 (amend) | +2 ACs: branch-picker session shows its target service in the modal title; members-list Enter only opens the branch-picker for a newly-checked (not-yet-member) row, submits otherwise. |
| 2.27 (new) | Create-EDT dialog adopts `BranchPicker` + `TextInputLine`; `ServiceBranchDivergence` gains `sharedBranch`; every base-branch default (Create and the existing `BranchPicker` "Create new" mode) reads it instead of the hardcoded constant; mixed-`sharedBranch` selections force individual base-branch entry. |
| 2.28 (new) | `registry` screen gains a "validate registered repos" action; extensible per-check registry, one check shipped (`sharedBranch` existence). |
| 2.29 (new) | `edt-delete` command/action: deletes the EDT record; per-member branch disposition (leave / delete, informed by merge-into-`sharedBranch` status and uncommitted-work detection); blocks on the active EDT; blocks per-service on a branch-name collision with another EDT. |
| 2.30 (new) | Shared "EDT quick-pick" (filterable, prefix-match) used by both `edt-switch` and `edt-modify` when invoked with no argument, replacing today's silent first-match/focused-row behavior. |
| 2.31 (new) | New `edt-create-from <topic>` command: opens the quick-pick (2.30) to choose a root EDT, pre-populates Create's member checklist from it (editable), and for every inherited member, the branch-setup step's "Create new" base branch defaults to that member's *current* branch in the root EDT. |
| 2.32 (new) | `TextInputLine`/`nextTextInputValue` gain cursor-position tracking (Left/Right/Home/End, insert/delete at cursor); command-bar and registry-screen's root-path field migrate onto the same component/primitive. |

### Artifact Conflicts

- **PRD:** gains one new FR under §4.2 EDT Workspace Management — **FR-24: Delete an EDT**
  (nothing in FR-3–FR-9 covers removing an EDT record itself; FR-5 only covers modifying an
  existing one). MVP scope (§6.1) gets one added bullet under EDT workspace management; no MVP
  goal changes. `edt-create-from` (Story 2.31) is treated as a consequence/variant of FR-3
  (member selection can be seeded from another EDT, still manually confirmed/edited) — no new FR.
- **Architecture:** additive only, no `core → adapters` boundary risk (AD-1 preserved):
  - `core/ports/git.ts` gains `deleteBranch(repoPath, branch, force)` and a merge-status query
    (mirrors how 2.26 added `listBranches`/`renameBranch`), gated through the existing
    branch-scope safety adapter (AD-8) — a delete is a git write like any other, never bypasses
    the centralized gate.
  - `core/edt/delete.ts` — new use-case, same shape as `create.ts`/`modify.ts`/`switch.ts`.
  - `core/edt/list.ts`'s `ServiceBranchDivergence` gains `sharedBranch: string` (already loaded
    from the manifest by this use-case, just not threaded into the return type).
  - `core/scripts/validate-registry.ts` — new read-only use-case, mirrors `list-repos.ts`'s shape.
  - No new SQLite schema, no new XDG path, no new driving adapter.
- **UX (`epics.md`):** `UX-DR20` (EDTs zone states) gains new rows — "EDT deleted"/per-service
  branch-disposition, "EDT quick-pick" (switch/modify), "Create from existing EDT". `UX-DR27`
  command-entry-bar gains `edt-delete`/`edt-create-from`/`registry validate` (or equivalent)
  entries. `EXPERIENCE.md`'s Component Patterns table gains a `text-input` cursor-position note
  (supersedes the "no mid-string cursor movement yet" line) and a new `quick-pick` pattern (a
  `checkbox-list-item`-adjacent filterable single-select list, reusing `BranchPicker`'s
  "Pick existing" list-rendering convention rather than inventing a new one).
- **Tests:** new unit tests for every new pure function (branch-disposition resolution, quick-pick
  filtering, cursor-position editing, `sharedBranch`-aware base-branch defaulting); interaction
  tests for the two 2.26 bug fixes; CLI black-box tests for `edt-delete`/`registry validate`/
  `edt-create-from` (AD-3 envelope, per this repo's existing convention for every subcommand).
- **`edt-management-debug-log.md`:** gets a new entry (2026-09-16) recording Max's exact
  Tested/Observed report for point 8, status `story ouverte (2.26 amendment, 2.27)` — same process
  this file was created for.

### Technical Impact

No Docker/process-control adapter touched. One new `GitPort` method pair (delete + merge-status)
and one new core use-case beyond what 2.26 already added (`listBranches`/`renameBranch`) — same
pattern, same risk profile. No SQLite schema change (EDT deletion removes the `.db` file itself,
per AD-7's "one file per EDT" — no row-level delete logic needed).

## 3. Recommended Approach

**Direct Adjustment (Option 1) — viable, effort Medium-High, risk Low-Medium.**

- Amend Story 2.26 in place (2 new ACs) — this is the actual unblock for Modify; small, isolated,
  no core/port change beyond what's already there.
- Add Story 2.27 next — this is the actual unblock for Create (base-branch defaulting); depends on
  nothing new beyond 2.26's own `BranchPicker`.
- Stories 2.28-2.32 are net-new capabilities/gaps, independent of each other and of 2.26/2.27's
  fixes — sequence flexibility exists (see §5), but none of them are blocking bugs.

Rollback was not considered: none of 2.22-2.26's shipped work is wrong, it's incomplete in two
specific, now-understood ways. A PRD/MVP scope review was only needed for one narrow point (EDT
deletion has no FR today) — handled as a single additive FR, not a scope re-negotiation; every
other point fits inside FR-3/FR-4/FR-5/FR-9 as already written.

**Why Moderate, not Minor:** six new stories plus a new FR is real backlog reorganization
(`sprint-status.yaml` needs 6 new entries, the PRD needs an FR added) even though no story here
individually needs architectural rework or PM/Architect involvement — every new capability fits
the hexagonal core/ports pattern already established by 2.26 itself.

## 4. Detailed Change Proposals

### Story 2.26 — amendment (2 new ACs, none removed)

> Amended 2026-09-16 (Sprint Change Proposal): closes a confirmed blocking bug found in real
> usage — Modify's member-checklist Enter routed to the branch-picker for any checked row
> (nearly always every row, since existing members start checked), with no visible indication of
> which service the open picker session was even for. Together these made it practically
> impossible to reach `submitModify` without already knowing the undocumented "Tab to Topic, then
> Enter" escape hatch.

**NEW AC — branch-picker session names its target service:**
> **Given** a branch-picker session is open in the Modify dialog **When** rendered **Then** the
> `ModalDialog`'s title changes from `MODIFY EDT` to `MODIFY EDT — branch for <service>` for the
> duration of the session, reverting once it closes (confirm, cancel, or auto-submit).

**NEW AC — Enter on the members list only edits a branch for a not-yet-member row:**
> **Given** the members-list cursor is on a row that is already a member of this EDT (was checked
> before the dialog opened, or is still checked and was never newly toggled this session) **When**
> `Enter` is pressed **Then** the whole form submits (`submitModify`), exactly as it already does
> from the Topic field — changing an *existing* member's branch from Modify goes through the EDT
> SERVICES pane's own "Change branch for this EDT" action (Story 2.18), not this checklist.
> **Given** the members-list cursor is on a row newly checked this session (not yet a member)
> **When** `Enter` is pressed **Then** the branch-picker opens for it, unchanged from today
> (mandatory per Story 2.24).

**Implementation notes:** `resolveModifyEnterAction`/`canEditMemberBranch` (`edts-zone.logic.ts`)
need the *original* member set (`target.members`), not just `selectedMembers`, to distinguish
"already a member" from "newly checked" — `canEditMemberBranch(repoPath, selectedMembers,
originalMemberPaths)` gains a third parameter; only `!originalMemberPaths.has(repoPath)` rows stay
branch-editable via Enter. `ModalDialog`'s `title` prop becomes dynamic in `ModifyDialogView`,
sourced from `dialog.branchPicker`'s `repoPath` resolved against `candidates`/`target.members`.

---

### Story 2.27: EDT Creation — Branch-Picker Reuse & Manifest-Aware Base-Branch Default

> Added 2026-09-16 (Sprint Change Proposal): closes the explicitly-flagged follow-up from Story
> 2.26's own implementation notes ("EDT creation is not required to adopt Pick existing/Rename
> current by this story ... a natural, explicitly-flagged follow-up") — and, per real-usage
> diagnosis (§1.8), the actual root cause of Create-EDT hard-failing whenever a repo's real shared
> branch isn't literally named `development`.

As a developer, I want the Create-EDT dialog's branch-setup step to use the same searchable
branch-picker as Modify, defaulting to each repo's own manifest-declared shared branch instead of
a hardcoded `development`, so that creating an EDT never fails on a made-up default and I can pick
a real base branch the same way everywhere in the app.

**Acceptance Criteria:**

- **Given** the create-EDT dialog's branch-setup step **When** it renders **Then** the base-branch
  field uses the shared `BranchPicker` (Pick existing / Create new — no Rename current, no member
  yet to rename) instead of a raw `<Text>` field, consistent with Modify/service-actions/add-to-edt.
- **Given** the branch-name field(s) (grouped or individual) **When** rendered **Then** they use
  `TextInputLine` (closing the Story 2.23 gap — today they're the only EDT-zone text fields still
  on raw `<Text>`, with no visible cursor).
- **Given** `core/edt/list.ts`'s `listEdtBranchesDivergence` use-case **When** it builds each row
  **Then** `ServiceBranchDivergence` includes `sharedBranch: string`, sourced from the manifest
  already loaded for that repo — no new port.
- **Given** every base-branch default in the EDT zone (Create's branch-setup step, and the
  existing `BranchPicker`'s "Create new" mode in Modify/service-actions/add-to-edt) **When**
  exactly one repo is in play (Modify/service-actions/add-to-edt, or Create in individual naming
  mode) **Then** the suggested base branch is that repo's own `sharedBranch`, never the hardcoded
  `DEFAULT_BASE_BRANCH` constant.
- **Given** Create in grouped naming mode with ≥2 selected members **When** their manifests'
  `sharedBranch` values are unanimous **Then** that shared value is the suggested base branch.
  **When** they diverge **Then** grouped naming mode stays available for the branch *name*, but
  the base-branch field is forced into a per-member picker (one `BranchPicker` base-branch choice
  per selected member) — never silently defaulting to `development` or picking one member's value
  arbitrarily.
- **Given** any base-branch suggestion **When** shown **Then** it stays fully editable — never
  forced, same convention as every other suggested default in this zone (Story 2.22).

**Implementation notes:** `DEFAULT_BASE_BRANCH` (`edt-slice.ts`) stops being read as the branch
*suggestion* source anywhere in the EDT zone — it may still exist as the `NO_BRANCH_CREATION`
constant's own `base` filler value (never sent to `core` when `create: false`). `create-dialog.tsx`
gains its own `BranchPicker` session, mirroring `openBranchPickerForModify`'s shape but scoped to
the create flow's own state (`CreateDialogState`); the "one base branch per member when
`sharedBranch` diverges" case needs a small per-member base-branch record, analogous to
`branchNames`'s existing per-member shape. Depends on Story 2.26's `BranchPicker`/`listBranches`
(already shipped) and Story 2.23's `TextInputLine` (already shipped).

---

### Story 2.28: Registry — Manifest Semantic Validation

> Added 2026-09-16 (Sprint Change Proposal): the manifest loader (Story 1.4) already rejects a
> schema-invalid `.tui-back.yaml`; nothing checks that a schema-*valid* manifest's declared values
> are actually real — e.g. a `sharedBranch` that doesn't exist in the repo. Extends the registry
> screen (Story 2.11) rather than adding a new command/screen.

As a developer, I want to validate that my registered repos' manifests are not just
schema-correct but actually consistent with the repo's real state, so that a typo'd or stale
`sharedBranch` surfaces before it causes a confusing failure elsewhere in the tool.

**Acceptance Criteria:**

- **Given** the REPO REGISTRY screen (Story 2.11) **When** open **Then** a new action ("Validate
  registered repos") is available alongside scan/register, operating on every path already in
  `registry.yaml` (not the scan-candidates list).
- **Given** validation runs **When** it completes **Then** each registered, manifest-valid repo
  shows a per-repo outcome (valid / invalid + reason), rendered via the same structured
  per-repo list convention as Story 2.25's `FailedResultList` — never a joined string.
- **Given** the `sharedBranch` check specifically **When** a repo's manifest declares one **Then**
  the tool verifies it exists (locally, or fetchable from the configured remote) via `GitPort`,
  reporting `invalid: sharedBranch "<name>" not found` when it doesn't.
- **Given** the check mechanism **When** implemented **Then** it is a small, extensible per-check
  registry (`resolveManifestChecks(manifest, repoPath): Promise<ValidationCheckResult[]>` or
  equivalent) — this story registers exactly one real check (`sharedBranch` existence); a future
  check (e.g. container/migrationCommand) is a registry entry, not a rewrite, mirroring Story
  2.25's `resolveAssistedAction` pattern.
- **Given** a repo whose manifest already fails to *load* (schema-invalid, per `list-repos`'
  existing `errors` array) **When** validation runs **Then** that repo is reported using its
  existing load-error message — this story never re-implements schema validation, only adds
  semantic checks on top of an already-loadable manifest.

**Implementation notes:** new core use-case `core/scripts/validate-registry.ts`, same shape as
`list-repos.ts` (registry + manifest ports), plus `GitPort.branchExistsLocally`/a remote-existence
check (already used by `core/edt/switch.ts` for a different purpose — reused, not duplicated). CLI
subcommand `tui-back registry validate` for script/CLI parity (AD-2); TUI wires it as a new
`RegistryScreenPhase` (`validating` → `validation-results`) in `repo-registry-screen.tsx`, reusing
`useStore`'s existing `registryScanResult`-style pattern for a new `registryValidation*` set of
fields.

---

### Story 2.29: Delete an EDT

> Added 2026-09-16 (Sprint Change Proposal): new PRD FR-24 (§4.2) — no existing FR covers removing
> an EDT record. Per-service branch disposition (leave / delete) informed by merge status and
> uncommitted-work detection, following the same "detect → guided choice → act" shape as every
> other assisted-resolution mechanic in this app (FR-11/FR-13, Story 2.25's registry).

As a developer, I want to delete an EDT I no longer need, choosing per member service whether to
leave its branch alone or delete it too, so that finished or abandoned work doesn't accumulate
stale EDTs and orphaned branches I have to clean up by hand.

**Acceptance Criteria:**

- **Given** the EDT selector **When** the developer triggers delete on a *non-active* EDT (via a
  new `edt-delete` command, or a contextual action on the focused EDT row) **Then** a confirmation
  dialog opens listing every member service with its branch, merge status (merged into that
  repo's `sharedBranch` / not merged), and uncommitted-work status.
- **Given** the target EDT is the currently *active* one **When** delete is attempted **Then** it
  is rejected with a clear message to switch away first — never auto-switched on the developer's
  behalf.
- **Given** the per-service disposition list **When** rendered **Then** each row defaults to
  "Leave branch as-is" except a service whose branch is both merged into its `sharedBranch` and
  clean (no uncommitted work), which defaults to "Delete branch" — every row stays independently
  toggleable (`checkbox-list-item`-style), the defaults are a suggestion, never forced.
- **Given** a service's branch is chosen for deletion, is merged and clean **When** the delete
  runs **Then** it's a plain `git branch -d` (safe delete).
- **Given** a service's branch is chosen for deletion, is unmerged and/or has uncommitted work
  **When** the delete runs **Then** it force-deletes (`git branch -D` — the developer explicitly
  chose this, uncommitted work included, per the ask) — never silently downgraded to "leave alone"
  because it looked risky; the confirmation dialog's merge/uncommitted status is exactly what lets
  the developer make that call knowingly.
- **Given** a service's branch chosen for deletion is *also* registered as another EDT's own
  branch for that repo (same name) **When** the delete runs **Then** that specific branch deletion
  is rejected (structured per-repo failure, Story 2.25's display) — the EDT record itself is still
  deleted, and every other selected service's branch deletion proceeds independently.
- **Given** the EDT record deletion itself **When** it completes **Then** the EDT's SQLite file
  (`XDG_DATA_HOME/tui-back/edts/<ulid>.db`) is removed and it no longer appears anywhere in the
  EDT list — no soft-delete/undo in v1 (matches every other destructive git action's "developer's
  explicit action in the moment" bar, Constraints and Guardrails).

**Implementation notes:** `core/ports/git.ts` gains `isBranchMerged(repoPath, branch, into):
Promise<Result<boolean>>` and `deleteBranch(repoPath, branch, force: boolean): Promise<Result<
void>>`, gated through the same centralized branch-scope-safety adapter as every other git write
(AD-8) — `deleteBranch` refuses a shared/protected branch outright, defense-in-depth even though
FR-7 already prevents one from being registered. New core use-case `core/edt/delete.ts`: validates
not-active, resolves per-service disposition, deletes selected branches independently (partial
failure never blocks the EDT-record deletion or other services), then removes the EDT registry
entry/file. CLI: `tui-back edt delete <topic> [--branches <repoPath>=<leave|delete>...]` for
script/CLI parity. TUI: new `edt-delete` command bar entry (Story 2.14 family) plus the disposition
dialog as a new `EdtDialogState` kind, following the existing 5-dialog file-per-dialog convention
(`dialogs/delete-dialog.tsx`).

---

### Story 2.30: EDT Quick-Pick — Filterable List for `edt-switch` / `edt-modify`

> Added 2026-09-16 (Sprint Change Proposal): closes a gap in Story 2.15 (`done`) — its own AC2/AC4
> describe a quick-pick list for both commands invoked with no argument; today `edt-switch` jumps
> to "the first non-active EDT" and `edt-modify` opens whichever EDT row happens to be focused in
> the selector, neither shows a list to choose from.

As a developer, I want `edt-switch` and `edt-modify` (typed with no argument) to show a filterable
list of EDTs I can search and pick from, so that I don't have to already know or guess which EDT
is "first" or "currently focused" before the right dialog opens.

**Acceptance Criteria:**

- **Given** the command bar, `edt-switch` run with no argument **When** it executes **Then** a
  quick-pick opens: a text filter (prefix match, case-insensitive, same convention as
  `matchCommands`/`matchBranchesByPrefix`) over every *non-active* EDT's topic, with an
  arrow-navigable filtered list below it.
- **Given** the quick-pick (switch mode) **When** an EDT is selected (`Enter`) **Then** the
  switch-confirm dialog opens pre-targeted at it, unchanged from today's pre-targeted-by-topic
  path (`edt-switch <topic>`).
- **Given** the command bar, `edt-modify` run with no argument **When** it executes **Then** the
  same quick-pick opens (mode: modify), filtering over *every* EDT (active included — modifying
  the active EDT is valid).
- **Given** the quick-pick (modify mode) **When** an EDT is selected **Then** the modify dialog
  opens pre-targeted at it, unchanged from today's pre-targeted-by-topic path.
- **Given** the quick-pick, any mode **When** `Esc` is pressed **Then** it closes without opening
  anything, back to no dialog.
- **Given** the quick-pick's filter matches exactly zero EDTs **When** rendered **Then** it shows
  an explicit "no matching EDT" state, never a silently-empty list.
- **Given** `edt-switch <topic>`/`edt-modify <topic>` (topic supplied) **When** run **Then**
  behavior is unchanged — exact-match pre-targeting, "EDT not found" inline error on no match; the
  quick-pick only replaces the no-argument path.

**Implementation notes:** new shared component, `shared/components/edt-quick-pick.tsx` (or folded
into a generalized version of `branch-picker.tsx`'s `FilterableBranchList`, reused rather than
duplicated — verify at implementation time whether generalizing that list-rendering helper is
cheaper than a parallel one). New `EdtDialogState` kind `'quick-pick'` with a `mode: 'switch' |
'modify'` field; `edts-zone.tsx`'s `currentEdtAction` effect (today: "first non-active EDT" /
"focused EDT" fallbacks) is replaced by opening this dialog instead when no topic was given.

---

### Story 2.31: `edt-create-from` — Clone an EDT's Membership as a Creation Starting Point

> Added 2026-09-16 (Sprint Change Proposal): new command, built on Story 2.30's quick-pick
> (root-EDT selection) and Story 2.27's `BranchPicker`-based branch-setup step (per-member base
> branch). Treated as a consequence of existing FR-3 (member selection, still manual/editable),
> not a new FR.

As a developer, I want to create a new EDT starting from an existing one's member services (with
the ability to add or remove some), where every inherited service's new branch is based on that
service's *current* branch in the root EDT, so that I can spin off a continuation of in-progress
work without losing the branch context it was building on.

**Acceptance Criteria:**

- **Given** the command bar, `edt-create-from` run with no argument **When** executed **Then**
  Story 2.30's quick-pick opens (mode: switch-style, i.e. any EDT selectable) to choose the root
  EDT.
- **Given** `edt-create-from <topic>` **When** `<topic>` matches an existing EDT **Then** it's
  pre-targeted directly, skipping the quick-pick — same convention as `edt-switch`/`edt-modify`'s
  own topic-argument path; no match shows an inline "EDT not found" error.
- **Given** a root EDT is resolved **When** the create dialog opens **Then** the member checklist
  is pre-checked with exactly the root EDT's current members — still a normal, fully-editable
  `checkbox-list-item` list (add/remove any service, including ones outside the root EDT).
- **Given** the branch-setup step (Story 2.27) **When** a selected member *was* a member of the
  root EDT and naming mode reaches "Create new" for it **Then** the suggested base branch is that
  member's own *current* branch in the root EDT (not `sharedBranch`, not `development`) — Story
  2.27's `sharedBranch`-aware default applies only to members that were *not* in the root EDT.
- **Given** a selected member that was *not* part of the root EDT **When** the branch-setup step
  renders **Then** it falls back to Story 2.27's normal `sharedBranch`-aware default — unchanged.
- **Given** the pre-filled base-branch suggestion (root-EDT-derived or `sharedBranch`-derived)
  **When** shown **Then** it stays fully editable, same convention as every other suggestion in
  this zone.
- **Given** the new EDT's topic **When** entered **Then** it follows the normal uniqueness rule
  (FR-3) — never auto-derived from the root EDT's topic, always typed fresh.

**Implementation notes:** `initialCreateDialog` gains an optional `seedFromEdt: EdtRegistryEntry`
parameter that pre-populates `selectedMembers` and a new per-member `rootBranch` record consulted
by the branch-setup step's base-branch suggestion logic (Story 2.27's per-member base-branch path,
already required for the divergent-`sharedBranch` case, is reused/extended here rather than a
second mechanism). New `commands.ts` entry `edt-create-from`, same family as `edt-create`/
`edt-switch`/`edt-modify`. Depends on Story 2.27 (branch-setup step's per-member base-branch
picker) and Story 2.30 (quick-pick) — sequence after both.

---

### Story 2.32: `TextInputLine` — Cursor Navigation & App-Wide Adoption

> Added 2026-09-16 (Sprint Change Proposal): closes an explicitly-flagged Story 2.23 follow-up
> ("no mid-string cursor movement is introduced by this story ... flagged as a possible
> follow-up, not blocking"). Scope widened, at Max's request, to unify the command-bar and
> registry-screen's own separate hand-rolled text fields onto the same component and editing
> primitive, leaving exactly one text-input implementation in the codebase.

As a developer, I want every text field built on `TextInputLine` — including the command bar and
the registry screen's root-path field — to let me move the cursor with Left/Right/Home/End and
edit at that position, so that fixing a typo in the middle of a branch name or topic doesn't mean
clearing and retyping the whole field.

**Acceptance Criteria:**

- **Given** `nextTextInputValue` **When** extended **Then** it operates on `{ value: string;
  cursor: number }` instead of a bare `string` — `Left`/`Right` move the cursor (clamped to
  `[0, value.length]`), `Home`/`End` jump to start/end, typed characters insert at the cursor
  (not just appended), `Backspace`/`Delete` remove at the cursor (before/after respectively) —
  every existing non-cursor key behavior (Tab/Return/Escape pass-through, etc.) is unchanged.
- **Given** `TextInputLine` **When** rendered focused **Then** the cursor glyph appears at the
  `cursor` position within `value` (splitting it into before/at/after segments), not always at
  the end — a `cursor` prop defaulting to `value.length` keeps every existing caller that doesn't
  pass one visually unchanged.
- **Given** every EDT-zone field currently driving a `TextInputLine` (topic in Create/Modify,
  branch fields in Create/Modify/service-actions/add-to-edt/branch-picker) **When** this story
  lands **Then** their state shape gains the paired `cursor` field and their key-dispatch calls
  route through the extended `nextTextInputValue`.
- **Given** the command bar's own input (`command-bar.tsx`) **When** this story lands **Then** it
  renders via `TextInputLine` (label-less/prefix mode — see below) instead of its own hand-rolled
  `<Text>:{query}<cursor></Text>`, and its own key handling calls the same extended
  `nextTextInputValue`, gaining cursor movement for free; autocomplete/grid behavior (Story 2.17)
  is unaffected — only the text-editing primitive changes underneath it.
- **Given** the registry screen's root-path field (`repo-registry-screen.tsx`) **When** this story
  lands **Then** it renders via `TextInputLine` (`label="Root path"`) instead of its own
  `typeRootInputChar`/`backspaceRootInput` pair, gaining cursor movement the same way.
- **Given** `TextInputLine` **When** used without a `label` (the command bar's case — a leading
  `:` glyph, not a "Label:" prefix) **Then** it renders the value/cursor alone, no `"undefined: "`
  or empty-label artifact — a `label?: string` becomes optional, and the caller composes any
  leading glyph itself, same as command-bar already does today.

**Implementation notes:** this is the widest-touching story in this batch — every `CreateDialogState`/
`ModifyDialogState`/`ServiceActionsDialogState`/`AddToEdtDialogState`/`BranchPickerState` field that
today is a bare `string` (`topic`, `branchName`, per-path `branchNames`/`branchEdits`, `baseBranch`,
`nameValue`, `pickQuery`, `renameSub.value`, etc.) gains a sibling `cursor` (or becomes a
`{value, cursor}` pair — exact shape decided at implementation time, consistently across all of
them). `branch-picker.tsx`'s own local `applyTextInput`/`TextEditKey` re-implementation (kept
separate today specifically to avoid an import cycle with `edts-zone.tsx`) gets the same cursor
extension in parallel, not via import. Command-bar and registry-screen migrations are each a
contained swap (their own key-dispatch functions keep deciding *what* changes, only the
value-transformation call and the render call move to the shared primitive/component) — sequence
these two after the EDT-zone fields are done, so the extended `nextTextInputValue` contract is
proven first where it has the most callers.

## 5. Implementation Handoff

**Scope classification: Moderate.** Six new stories plus one new PRD FR is real backlog
reorganization, though every capability fits the existing hexagonal core/ports pattern with no
architectural rework.

**Routed to: Product Owner / Developer** (per this repo's own convention: `bmad-sprint-planning`
to formalize the `sprint-status.yaml`/`epics.md` entries below, then `bmad-build`/`bmad-agent-dev`
per story, one branch per story off `epic-2-edt-workspace-management`, per `CLAUDE.md`'s git
workflow).

**Suggested sequencing** (not a hard dependency chain except where noted):
1. **Story 2.26 amendment** and **Story 2.27** first — these are the two confirmed blocking bugs;
   nothing else in this batch is release-blocking.
2. **Story 2.28** (registry validation) and **Story 2.30** (quick-pick) — independent of each
   other and of everything above, can run in parallel.
3. **Story 2.29** (delete EDT) — independent, but touches `GitPort`/a new core use-case, so worth
   its own focused pass.
4. **Story 2.31** (create-from) — depends on 2.27 (per-member base branch) and 2.30 (quick-pick)
   landing first.
5. **Story 2.32** (cursor navigation) — independent of 2.27-2.31 functionally, but touches the
   same dialog state shapes 2.27/2.31 also touch; doing it last avoids merge friction on fields
   those two stories are simultaneously adding.

**Artifacts to update once this proposal is approved** (checklist item 6.4):
- `sprint-status.yaml`: add `2-27-...` through `2-32-...` entries under `epic-2`, status
  `backlog`; `2-26-branch-picker-...` stays `review` (amendment doesn't change its status).
- `epics.md`: insert Stories 2.27-2.32 (text above) after Story 2.26; amend Story 2.26's AC block
  in place; add `FR-24` to the Requirements Inventory and FR Coverage Map (`Epic 2 - Delete an
  EDT`); extend `UX-DR20`/`UX-DR27` per §2's Artifact Conflicts.
- `prds/prd-tui-back-2026-08-10/prd.md`: add `FR-24: Delete an EDT` under §4.2, with its own
  Consequences bullets (mirrors FR-3/FR-5's structure); one bullet added to §6.1 MVP scope.
- `edt-management-debug-log.md`: new 2026-09-16 entry for point 8's Tested/Observed report,
  `story ouverte (2.26 amendment, 2.27)`.

**Success criteria:** Story 2.26's 2 new ACs and Stories 2.27-2.32's ACs above all pass; `npm
test`/`npm run typecheck`/`npm run depcheck` stay green; no `core → adapters` boundary violation
(AD-1); every new git write (branch delete) goes through the centralized safety gate (AD-8); FR-24
is reflected in both `prd.md` and `epics.md`'s coverage map before Story 2.29 is marked `done`.

**Explicitly out of scope (by Max's decision during this session):**
- EDT deletion soft-delete/undo — matches every other destructive git action's "explicit action in
  the moment, no automated recovery" bar.
- Extending `edt-create-from`'s root-branch-as-base-default to also apply retroactively to plain
  `edt-create` — this behavior is specific to the "from an existing EDT" flow.
- Registry validation checks beyond `sharedBranch` existence (container/migrationCommand) — the
  check registry is built extensible, but no further check is scoped by this proposal.
- Migrating every text field in the app (e.g. a future Logs-zone filter input) onto
  `TextInputLine`/cursor tracking — only the three fields named in Story 2.32 are in scope today.
