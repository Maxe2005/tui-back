---
date: 2026-08-28
trigger: 'Real-usage debugging campaign for EDT management (opened by Sprint Change Proposal 2026-08-27, §"Debug-log process") — 6 findings recorded in `_bmad-output/implementation-artifacts/epic-2/edt-management-debug-log.md` while exercising create/switch/modify for the first time end-to-end'
mode: incremental
epic_impact: 'Epic 2 (in-progress) — 5 new stories appended (2.22-2.26), one in-place amendment to Story 2.2 (done, TUI-path narrowing only), no epic redefinition, no PRD/MVP change beyond one FR-4 consequence-level amendment.'
scope_classification: minor
---

# Sprint Change Proposal — 2026-08-28

## 1. Issue Summary

Max ran the debug-log intake process opened by the 2026-08-27 Sprint Change Proposal, exercising
EDT create/switch/modify/service-actions end-to-end for the first time in real conditions. Six
findings were recorded, each root-caused against the actual code and governing spec before
triage:

1. **No branch selection/creation UI at EDT creation.** `core/edt/create.ts` already exposes
   `CreateBranchOptions` (Story 2.2, `done`) but the TUI's create-EDT dialog never surfaces it —
   `submitCreate` calls `createEdtAction({ topic, members })` only. FR-4/Story 2.2 exist in core
   with no TUI surface at all.
2. **Switch-EDT partial failure: no resolution offered, errors dumped unreadably.**
   `summarizeFailedResults()` (`edts-zone.tsx`) flattens every failed repo's error into one
   `; `-joined string, fed into a single-line dialog `error` field — no per-repo breakdown, no
   distinction between failure kinds, no remediation path, even for the branch-collision case
   that looks exactly like the spec's "protected-switch-blocked" scenario.
3. **"Add to EDT" doesn't visibly offer a branch choice.** The field (`AddToEdtDialogState`) is
   functionally editable, but renders as a bare `Branch: {value}` line with no cursor, no hint —
   indistinguishable from a static label.
4. **Modify EDT: checking a new member never offers a branch, silently defaults to whatever it's
   currently on → collision.** `core/edt/modify.ts`'s "1. Add members" step (lines 108-176) reads
   `git.currentBranch(resolved)` unconditionally — never consults `setBranches` at all — and
   gates that value after the fact via `assertAllowedBranch`. Since a repo is often sitting on
   some other EDT's branch, this collision is the expected outcome, not an edge case. Confirmed
   this also puts the "Add to EDT" flow at risk of the same spurious gate (its `setBranches` entry
   is simply never consulted by this step), not just the un-spec'd Modify-checklist path first
   suspected.
5. **No visible cursor when editing a branch (or any) text-input field.** `nextTextInputValue()`
   renders every field as bare `<Text>{label}: {value}</Text>` — universal across the zone, and
   the direct root cause of finding #3.
6. **Branch editing needs 3 explicit modes** (pick existing w/ search, create new, rename
   current) — a feature request, not a regression. The only way to set a branch anywhere today is
   one free-text field typed into blind.

During Step 3 (drafting these proposals), Max made two further product decisions while reviewing
the branch-creation and branch-selection flows: **branch creation at EDT creation becomes
mandatory** (no enable/disable toggle — narrows FR-4/Story 2.2's "optional" framing on the TUI
path only), and the mandatory-branch principle extends to adding a member to an existing EDT
(closes finding #4 at the product level, not just the display level).

## 2. Impact Analysis

### Epic Impact

- **Epic 2** (`in-progress`) absorbs five new stories, **2.22-2.26**, sequenced by dependency
  (2.23's `text-input` component is a prerequisite for 2.22/2.24/2.26; 2.25's structured failure
  display and assisted-resolution registry is a prerequisite for 2.22/2.24/2.26's own failure
  paths). One in-place amendment to **Story 2.2** (already `done`) — narrows its "branch-creation
  disabled" AC to non-TUI driving adapters only; not a reopening of the story's implementation,
  since the TUI never actually shipped that toggle in the first place (finding #1's own root
  cause). No other epic affected.

### Story Impact

- **Story 2.2** — one AC narrowed (TUI no longer offers enable/disable; see §4). Nothing else
  about the story changes; `core/edt/create.ts`'s no-branch-creation call shape stays supported
  for other driving adapters.
- **Story 2.22** (new) — EDT Creation: mandatory branch creation UI, with a topic-derived
  suggested name.
- **Story 2.23** (new) — visible text-input cursor, promoted to a shared component; also closes
  finding #3 (same root cause) and formalizes EXPERIENCE.md's missing `text-input` Component
  Pattern.
- **Story 2.24** (new) — Modify EDT: mandatory branch on add, no more silent `currentBranch`
  default; restructures the add-members/set-branches interaction in `core/edt/modify.ts`.
- **Story 2.25** (new) — structured per-repo failure display (all 5 dialog call sites) + a new
  "branch already claimed by another EDT" EDTs State Pattern + an extensible assisted-resolution
  registry (first EDT-zone instance of the "Assisted resolution" mechanic already named in
  EXPERIENCE.md's Update-zone table).
- **Story 2.26** (new) — branch-picker: 3 explicit modes (pick existing/create new/rename
  current), each with sub-choices (base-branch picker and other-members'-name picker inside
  "Create new"; inline rename inside "Pick existing"). Needs two new `GitPort` methods.
- No other story touched. Stories 2.19-2.21 (in-progress/backlog) are unaffected — no dependency
  either direction.

### Artifact Conflicts

- **PRD:** FR-4's "optional at creation" consequence bullet is amended (superseding note, not
  removed) — see §4. No MVP change; no other FR touched. FR-5's "add a service to an EDT" wording
  stays accurate (Story 2.24 makes the *branch* mandatory, not the add operation itself).
- **Architecture:** `core/ports/git.ts` (`GitPort`) gains two additive methods —
  `listBranches`/`renameBranch` (Story 2.26). `core/edt/modify.ts`'s `ModifyEdtParams` gains one
  additive field (`renameBranches`, Story 2.26) and one new error code (`branch-required`, Story
  2.24). No new port, no `core → adapters` boundary risk (AD-1), no schema/storage change.
- **UX (`EXPERIENCE.md`):** gains a `text-input` Component Pattern row (Story 2.23, closes a
  genuine pre-existing spec gap — the pattern was already in use with no entry documenting it)
  and a new EDTs State Patterns row, "Branch already claimed by another EDT" (Story 2.25).
- **Tests:** new unit tests for `suggestBranchNameFromTopic`/`suggestBranchForNewMember` (pure
  functions), the restructured `modify.ts` add/set-branch interaction, the structured
  failure-list renderer and assisted-resolution registry, and the branch-picker's 3 modes +
  sub-choices; interaction tests for each dialog's new fields.
- **`deferred-work.md`:** no entries added or closed by this proposal.

### Technical Impact

- No new port. No Docker/process-control adapter. No SQLite/registry schema change — `GitPort`
  and `ModifyEdtParams` both grow additively. The riskiest single piece is Story 2.24's
  restructuring of `modify.ts`'s step-1/step-3 interaction (a real refactor, not a one-line fix,
  flagged as such in that story's implementation notes) — everything else is additive UI/port
  surface.

## 3. Recommended Approach

**Direct Adjustment (Option 1) — viable, effort Medium (concentrated in 2.24/2.26), risk Low
elsewhere.**

- Five new stories within Epic 2's existing structure, sequenced by real dependency
  (2.23 → 2.22/2.24/2.26; 2.25 → 2.22/2.24/2.26's failure paths), not by debug-log entry order.
- One narrow, in-place amendment to Story 2.2 (`done`) rather than reopening it — the TUI simply
  never exercised the "disabled" path, so nothing already-shipped is being reverted.
- One PRD consequence-level amendment (FR-4), superseding note, not a rewrite.

Rollback was not considered viable: every finding is either a TUI-surface gap for an
already-correct core capability (findings #1, #3, #5, #6) or a core bug with a clear, additive
fix (finding #4/#2) — nothing on `epic-2`'s existing branches needs to be undone. PRD MVP review
was not needed: no goal or scope change, only a UX-completeness correction and one deliberate
narrowing (optional → mandatory branch creation) made explicitly by Max during drafting, not
discovered as a conflict.

## 4. Detailed Change Proposals

### Story 2.2 — AC amendment (append)

> Amended 2026-08-28 (Sprint Change Proposal, Story 2.22): the "Given branch-creation disabled"
> AC is superseded on the TUI path — the TUI's create-EDT dialog no longer offers an
> enable/disable choice; branch creation is mandatory whenever ≥1 member is selected.
> `core/edt/create.ts` keeps accepting a no-branch-creation call shape for other driving adapters
> (no core/port change), but the shipped TUI never sends it anymore.

---

### Story 2.22: EDT Creation — Mandatory Branch Creation UI

> Added 2026-08-28 (Sprint Change Proposal): closes debug-log finding #1 — Story 2.2 built
> branch-creation capability in `core/edt/create.ts` (`CreateBranchOptions`) but the TUI's
> create-EDT dialog never surfaced it. While closing this gap, branch creation is also promoted
> from optional to mandatory on the TUI path (product decision made while triaging this finding)
> — see the companion amendment to Story 2.2 above. No core/port change: `core` keeps supporting
> a no-branch-creation call shape for other driving adapters; the TUI simply never exercises it
> anymore.

As a developer, I want the create-EDT dialog to always have me choose a base branch and a naming
mode (grouped/individual), with a suggested branch name pre-filled from the EDT's topic, So that
every EDT I create starts with its own branch per member by default, without typing a name from
scratch every time.

**Acceptance Criteria:**

- **Given** the create-EDT dialog, member checklist populated **When** at least one member is
  selected **Then** a branch-setup step appears — no enable/disable choice — offering a
  base-branch input (default `development`) and a naming-mode choice (grouped: one shared name /
  individual: one name per selected member)
- **Given** the branch-setup step renders **When** the naming mode is chosen **Then** the
  branch-name field(s) are pre-filled with a suggested default slugified from the EDT's topic
  (lowercase, non-alphanumerics → `-`) — one suggested name in grouped mode, that same suggestion
  pre-filled per member in individual mode — always editable, never forced
- **Given** grouped mode **When** the developer accepts or edits the single branch name and
  confirms **Then** `createEdtAction` is called with `CreateBranchOptions` (`baseBranch`, grouped
  naming, the name) — every selected member gets that identical branch name
- **Given** individual mode **When** the developer accepts or edits each per-service name and
  confirms **Then** `createEdtAction` is called with the per-service names; a per-service
  branch-creation failure is reported without aborting the others (Story 2.2's existing AC),
  displayed via Story 2.25's per-repo failure list rather than a new ad-hoc format
- **Given** any required branch-name field is empty **When** confirm is attempted **Then** it's
  blocked with inline validation (same convention as `validateBranchEditValue`) — a name is
  always required now, so an empty field can't be submitted
- **Given** zero members are selected **When** the EDT is created **Then** no branch step applies
  — unchanged from today (nothing to create a branch in)
- **Given** the branch-name input(s) **When** rendered **Then** they use the `text-input`
  Component Pattern (Story 2.23, visible cursor) — sequenced after 2.23

**Implementation notes:** `CreateDialogState` (`edts-zone.tsx`) gains base-branch, naming-mode,
and branch-name(s) fields, pre-populated by a new pure function (e.g.
`suggestBranchNameFromTopic(topic)`), no enable/disable field. `submitCreate` always passes a
`CreateBranchOptions`-shaped payload to `createEdtAction` when ≥1 member is selected. No `core/`
or port change.

---

### Story 2.23: Visible Text-Input Cursor (EDT Zone Text Fields)

> Added 2026-08-28 (Sprint Change Proposal): closes two debug-log findings with the same root
> cause — no dialog in the EDT zone renders a cursor/caret, so every text-input field (topic in
> Create/Modify, branch in service-actions/Modify/Add-to-EDT) looks like a static label until
> typed into blind. This also fully explains finding #3 ("Add to EDT doesn't visibly offer a
> branch choice") — the field is functionally editable, just not perceivable as such. Also
> formalizes a missing `text-input` entry in EXPERIENCE.md's Component Patterns table (used
> throughout the EDT zone, never named). Confirmed by grep (2026-08-28) that no other zone
> currently uses text-input editing — this pattern is EDT-zone-only today, but is built as a
> shared component (`shared/components/`), not zone-local, so any future zone can reuse it
> without depending on `edts-zone.tsx`.

As a developer, I want every text-input field in the EDT zone to show a visible cursor at my
current editing position, plus a hint that the field is editable, So that I can tell where I am
while typing and that a field labeled e.g. "Branch: master" is an editable choice, not a static
readout.

**Acceptance Criteria:**

- **Given** any text-input field in the EDT zone (topic, branch) **When** rendered, focused
  **Then** a cursor glyph is shown at the current edit position (end of string, matching
  `nextTextInputValue`'s append/backspace-at-end model — no mid-string cursor movement is
  introduced by this story, since arrow keys aren't wired to cursor position yet)
- **Given** a text-input field **When** rendered **Then** it's visually distinguishable from a
  static label (e.g. an inverted/underlined cursor cell, consistent across all instances) —
  closes the "Add to EDT" affordance gap without changing `AddToEdtDialogState`'s underlying
  logic, which was already correct
- **Given** the EXPERIENCE.md Component Patterns table **When** this story lands **Then** it
  gains a `text-input` row (props, states: empty/focused/editing, the cursor treatment)
  documenting the pattern already used in Create/Modify/service-actions/Add-to-EDT dialogs
- **Given** an existing dialog's hint line (e.g. Add to EDT) **When** rendered **Then** it
  includes an explicit `[Enter] confirm [Esc] cancel` hint where one was missing, consistent with
  other dialogs in the zone (closes the secondary affordance gap noted in finding #3)

**Implementation notes:** new shared component `shared/components/text-input-line.tsx` (props:
`label`, `value`, `focused`), following the exact convention of its neighbors
(`checkbox-list-item.tsx`, etc.) — replaces the hardcoded `<Text>{label}: {value}</Text>` in each
`edts-zone.tsx` dialog. Used only by the EDT zone today; no dependency in the other direction. No
change to `nextTextInputValue`'s editing model (cursor-position tracking / arrow-key movement is
explicitly out of scope — flagged as a possible follow-up, not blocking). Prerequisite for Story
2.22 (branch-name fields), Story 2.24 (per-member branch field), and Story 2.26 (branch-picker
reuses the same input styling).

---

### Story 2.24: Modify EDT — Mandatory Branch on Add, No More Silent Default

> Added 2026-08-28 (Sprint Change Proposal): closes debug-log finding #4 — `core/edt/modify.ts`'s
> "1. Add members" step (lines 108-176) unconditionally reads `git.currentBranch(resolved)` and
> tries to register whatever the repo happens to be checked out on, gated only after the fact by
> `assertAllowedBranch`. Confirmed by re-reading the code (2026-08-28): this isn't limited to the
> "no matching `setBranches` entry" case as first suspected — the add-members loop never even
> looks at `setBranches` at all, so it also risks a spurious failure-on-current-branch for the
> "Add to EDT" flow (Story 2.18) when the repo's *current* branch happens to collide with another
> EDT, even though a perfectly valid target branch was supplied via `setBranches` for the same
> call. Extends the "branch is always explicit, never silently inferred" principle established in
> Story 2.22 (mandatory branch at EDT creation) to EDT modification.

As a developer, I want adding a member to an EDT (whichever UI path I use) to always use the
branch I actually asked for, and never silently register or gate on whatever the repo happens to
be checked out on right now, So that "add member" can't collide with an unrelated branch the repo
just happened to be sitting on, and I'm never left wondering why a member I checked got rejected
for a branch I never chose.

**Acceptance Criteria:**

- **Given** `modifyEdt` is called with a repo in `addMembers` that also has a matching
  `setBranches` entry **When** the pre-lock steps run **Then** step 1 ("Add members") no longer
  calls `git.currentBranch()` or gates on it for this repo — it only performs the existing
  registered/duplicate-membership checks, then defers branch resolution entirely to step 3
  ("Set branches"), which already runs `assertAllowedBranch` + protected-switch + checkout
  correctly; on a successful branch change for such a repo, it is promoted into the final member
  list with that branch (not left out because step 3 doesn't normally add new members)
- **Given** `modifyEdt` is called with a repo in `addMembers` and no matching `setBranches` entry
  **When** step 1 runs **Then** it fails that member with a new `branch-required` error ("no
  branch specified for new member <path>; call with a matching setBranches entry") instead of
  silently defaulting to `git.currentBranch()` — no `core` caller can add a member without stating
  its branch, TUI or otherwise
- **Given** the TUI Modify dialog's member checklist **When** a not-yet-member service is checked
  **Then** a mandatory branch field appears for it, pre-filled with a suggested default —
  computed by checking the EDT's *existing* members' branches: if they're all identical, that
  shared name is the suggestion; otherwise the topic-slug suggestion from Story 2.22
  (`suggestBranchNameFromTopic`) is used as fallback — never the newly-checked service's own
  current branch (that's the exact pattern responsible for this bug). Always editable. Reuses
  Story 2.23's `text-input` component. `resolveModifyOps` includes a `setBranches` entry for
  every newly-checked member, never omits one
- **Given** the EDT has zero existing members (first member being added via checklist) **When**
  the branch field renders **Then** it falls straight to the topic-slug suggestion — no
  common-branch computation possible with zero members to compare
- **Given** a newly-checked member's branch field is left empty **When** confirm is attempted
  **Then** it's blocked with inline validation, same convention as Story 2.22/2.23 — a branch is
  always required to add a member, never silently skipped
- **Given** a requested branch (via `setBranches`, from either add path) is already registered as
  a different EDT's own branch **When** `assertAllowedBranch` rejects it **Then** the failure is
  reported per-repo, using Story 2.25's structured failure list and assisted-resolution registry
  — not the current flat error string — so the developer sees exactly which member failed and
  why, and can retry with a different branch

**Implementation notes:** this is a real restructuring of the step-1/step-3 interaction in
`core/edt/modify.ts`, not a one-line fix — flagged for implementation-time care: step 1 builds a
`pendingAdds` list (repoPath + resolved service, no branch) for `addMembers` entries with a
matching `setBranches` entry, skipping `git.currentBranch`/`assertAllowedBranch` entirely for
them; step 3's existing loop, on a successful branch change for a `pendingAdds` repoPath,
promotes it into `addedMembers` (not just `branchChanges`) so the lock-time assembly (already
correct per Story 2.18's flagged ordering concern — `branchChanges` applies after `addedMembers`)
picks it up as a genuinely new member. New pure function `suggestBranchForNewMember(existingMembers,
topic)` — returns the common name if `existingMembers.every(m => m.branch === existingMembers[0]
.branch)` (and `existingMembers.length > 0`), else delegates to `suggestBranchNameFromTopic(topic)`
(Story 2.22, reused as-is, colocated rather than duplicated). TUI: `ModifyDialogState`/
`resolveModifyOps` (`edts-zone.tsx`) gain a per-newly-checked-member branch field.

---

### Story 2.25: EDT Zone — Structured Per-Repo Failure Display & Branch-Collision State

> Added 2026-08-28 (Sprint Change Proposal): closes debug-log finding #2 — a partial-failure
> switch (or create/modify/add-to-edt — same code path) dumps every failed repo's raw error
> message concatenated with `; ` on one line (`summarizeFailedResults()`, a flat
> `map().join('; ')`), no per-repo breakdown, no distinction between failure kinds, no
> remediation offered. Confirmed this helper is shared across **five** call sites (switch,
> create, modify, add-to-edt — `edts-zone.tsx`), so the fix benefits every dialog in the zone at
> once, including the failure paths Stories 2.22/2.24 already reuse. Also formalizes a new state
> in EXPERIENCE.md's EDTs State Patterns table: "branch already claimed by another EDT" — today's
> collisions are display bugs riding on top of an unnamed spec gap. Per Max's explicit direction
> during drafting: only branch-collision gets an assisted resolution today, but other failure
> kinds will likely gain their own later — the display/resolution mechanism is built as an
> extensible per-error-code registry from the start, not a hardcoded single check, reusing the
> "Assisted resolution" mechanic already named in EXPERIENCE.md's Update-zone table (detect →
> guided action → re-verify) rather than inventing a second name for the same idea.

As a developer, I want a partial-failure result from any EDT action to show me, per repo, exactly
what happened and — for a branch collision specifically — an easy way to try a different branch,
So that a partial failure is something I can act on immediately, not a wall of concatenated text
I have to parse by hand.

**Acceptance Criteria:**

- **Given** any EDT action (switch/create/modify/add-to-edt) completes with one or more
  `outcome: 'failed'` rows **When** the result is shown **Then** each failed repo renders as its
  own line — service/repo name, then its error message — instead of one `; `-joined run-on
  string; `summarizeFailedResults` is replaced by a structured list (e.g. returns
  `FailedResultRow[]`, not a pre-joined string), rendered by a shared list renderer used by all
  five call sites
- **Given** a failed row's `detail.code` **When** the failure list renders **Then** each row's
  resolution action is looked up via a small extensible registry (e.g.
  `resolveAssistedAction(code): AssistedAction | null`, keyed by error code) rather than a
  hardcoded branch-collision check — this story registers exactly one entry
  (`branch-already-claimed` → "try a different branch"); a code with no registered entry renders
  the plain per-repo line with no action, which is the correct/expected behavior for every other
  failure kind today, not a gap
- **Given** the registered `branch-already-claimed` entry **When** chosen (`[Enter] try a
  different branch`) **Then** it reopens the same branch-edit input already used elsewhere in the
  zone (Story 2.23's `text-input` component), scoped to just that repo, and re-runs the same
  submit path with the updated branch — not a restart of the whole action
- **Given** a future failure kind gains its own assisted resolution later (e.g. stale-registry
  re-registration, shared-branch-mismatch reconfiguration — both flagged, out of scope here)
  **When** implemented **Then** it only needs to add one registry entry (code → action descriptor
  + handler) — no change to the list-rendering component itself, confirming the registry is the
  actual extension point
- **Given** the EXPERIENCE.md EDTs State Patterns table **When** this story lands **Then** it
  gains a new row — "Branch already claimed by another EDT" — naming this as a distinct, expected
  state, applicable wherever `assertAllowedBranch` can reject a requested branch (switch, create,
  modify, add-to-edt)
- **Given** a failed row whose error is NOT a branch collision (e.g. `no .tui-back.yaml found`, a
  fetch failure) **When** rendered **Then** it still gets its own per-repo line with the raw
  message — this story doesn't invent new remediation for every failure kind, only structures the
  display and adds the one collision-specific registry entry; the two stale-registry entries and
  the `micro-external` shared-branch mismatch noted in the debug log are environmental/
  registry-hygiene issues, explicitly out of scope for this story
- **Given** the existing "Protected-switch blocked" / "Interrupted update" EDTs State Pattern
  rows (already spec'd, UX-DR20) **When** reviewed against this story **Then** they're confirmed
  out of scope here — they cover a different scenario (an in-progress group update blocking a
  switch), not addressed by this finding; no change needed to those rows

**Implementation notes:** `summarizeFailedResults` (`edts-zone.tsx`) changes its return shape from
`string | null` to a structured list (all 5 call sites updated); a new shared render helper (in
`shared/components/`, following Story 2.23's precedent) renders that list as one line per repo,
consulting the `resolveAssistedAction` registry per row for an optional action. The registry
(`Record<string, AssistedAction>` or equivalent) lives alongside the render helper — deliberately
minimal, not a real plugin system, just enough for Story 2.26 (or a future story) to add an entry
without touching the list component. This is the EDT zone's first instance of the "Assisted
resolution" mechanic already named in EXPERIENCE.md (Update-zone table).

---

### Story 2.26: Branch-Picker — 3 Explicit Modes (Pick Existing / Create New / Rename Current)

> Added 2026-08-28 (Sprint Change Proposal): closes debug-log finding #6 — every branch-entry
> point in the EDT zone ("Change branch for this EDT", "Add to EDT", the Modify checklist's
> per-member branch step from Story 2.24) is currently one free-text field the developer types a
> name into blind. Largest-scope item in this batch: needs two new `GitPort` capabilities
> (`listBranches`, `renameBranch`) and a new UI component. Sequenced last — depends on Story 2.23
> (visible-cursor text-input, used by two of the three modes) and lands after 2.24/2.25 so it can
> plug its own failures into 2.25's structured display and (for collisions) its
> assisted-resolution registry.

As a developer, I want every place I set a service's branch for an EDT to offer three explicit
choices — pick an existing branch (searchable), create a new one, or rename the one currently
active — instead of one ambiguous free-text field, So that I always know which of these three
things I'm actually doing, and don't have to remember an exact existing branch name to type it
correctly by hand.

**Acceptance Criteria:**

- **Given** any of the three existing branch-entry points ("Change branch for this EDT", "Add to
  EDT", Modify checklist's per-member branch step) **When** the branch step opens **Then** it
  presents a 3-way mode switch — **Pick existing** / **Create new** / **Rename current** — cycled
  the same way other mode switches in this zone work (e.g. `Tab`), defaulting to **Create new**
  with the context-appropriate suggested name already established by Stories 2.22/2.24
  (topic-slug or common-member-branch), so existing behavior isn't disrupted for a developer who
  ignores the new modes entirely
- **Given** "Create new" mode **When** active **Then** it shows two sections: a **base-branch**
  picker (where the new branch starts from) and a **name** field — base-branch defaults to
  `development`, chosen from the same filterable local-branch list as "Pick existing" mode (this
  repo's own branches, via `listBranches`), reused rather than duplicated
- **Given** the name section in "Create new" mode **When** active **Then** it offers a sub-choice
  alongside free typing: pick from the list of branch names already in use by *other* members of
  this EDT (sourced from the EDT's own member data — `target.members.map(m => m.branch)`,
  deduplicated, no git call involved) — picking one fills the text field, still editable
  afterward; this generalizes Story 2.24's single computed suggestion (unanimous-name-or-topic-
  slug) into an explicit, browsable list for the non-unanimous case
- **Given** "Pick existing" mode **When** active **Then** it shows a filterable list of the
  repo's local branches (typing narrows the list, same filter-as-you-type convention used
  elsewhere in the app), selecting one and confirming sets it as the target branch — no new
  branch created
- **Given** "Pick existing" mode, a branch selected from the filterable list **When** the
  developer chooses "rename" instead of "use as-is" (an inline action on the selected item, not a
  mode switch) **Then** it prompts for a new name (Story 2.23 `text-input`) and, on confirm,
  renames that git branch (`git.renameBranch`) *then* sets the renamed branch as the EDT's branch
  for that service — one combined action, not two separate steps through different modes
- **Given** "Rename current" mode **When** entered **Then** it's a shortcut into the same
  pick-then-rename mechanism above, pre-selected to the branch currently registered for that
  service in this EDT — not a separate implementation, just a different entry point that skips
  the picking step; available only where a "current" branch actually exists (not at EDT creation
  for a not-yet-member service)
- **Given** any mode's confirmation **When** it fails (e.g. name collision, protected-branch
  rejection) **Then** it surfaces through Story 2.25's structured per-repo failure display, and —
  for a branch-collision failure specifically — through 2.25's assisted-resolution registry (adds
  a second registry entry alongside "try a different branch"; rename mode's own collision reuses
  the same display, no new failure-handling path invented)
- **Given** the `GitPort` contract **When** this story lands **Then** it gains two methods:
  `listBranches(repoPath): Promise<Result<string[]>>` (local branches, mirrors
  `branchExistsLocally`'s existing local-only scope — remote-branch listing is explicitly out of
  scope, flagged as a possible follow-up) and `renameBranch(repoPath, oldName, newName):
  Promise<Result<void>>` (local `git branch -m`, gated by `assertAllowedBranch(repoPath, newName,
  edtId)` before renaming, same convention as `createBranch`)
- **Given** `core/edt/modify.ts` **When** this story lands **Then** it gains a
  `renameBranches?: Array<{ repoPath: string; newName: string }>` param (mirrors `setBranches`'s
  shape), a new pre-lock step calling `git.renameBranch` after the existing `assertAllowedBranch`
  gate, and updates the EDT registry entry's `branch` field for that member on success — a
  distinct operation from `setBranches` (which switches to an *existing* branch; this one renames
  the *current* one)

**Implementation notes:** new shared component `shared/components/branch-picker.tsx`, following
Story 2.23's `text-input-line.tsx` precedent — hosts the 3-way mode switch, delegates to
`text-input-line` for two of its three modes; the "Pick existing" list item gains a secondary
action (rename) alongside select, both driving the same underlying `renameBranch` +
`setBranches`/`addMembers` submit path. "Create new"'s base-branch picker reuses the exact same
filterable-list sub-component as "Pick existing" (two call sites of one list widget: base-branch
candidates vs. target-branch candidates). The other-members'-branch-names sub-list needs no new
port method — derived from data the dialog already has loaded. The filterable list itself reuses
whatever filter-as-you-type mechanism already exists elsewhere in the app if one does (verify at
implementation time) rather than introducing a second one. `core/ports/git.ts` gains
`listBranches`/`renameBranch`, implemented in `adapters/driven/git`. EDT creation (Story 2.22) is
not required to adopt "Pick existing"/"Rename current" by this story — it has no "current" branch
to rename and creation's own suggested-default flow already covers the common case; extending it
is a natural, explicitly-flagged follow-up, not required here.

---

### Amendments to Existing Text (superseding notes, not reopenings)

| Document | Location | Change |
|---|---|---|
| `epics.md` | Story 2.2 | `active` "branch-creation disabled" AC narrowed to non-TUI driving adapters only (Story 2.22, see above). |
| `prd.md` | FR-4, "Consequences (testable)" | "Branch creation is optional at EDT-creation time…" narrowed: optional only for non-TUI driving adapters — the TUI's create-EDT dialog makes it mandatory. Amended 2026-08-28 (Story 2.22): `core` still exposes the no-branch-creation shape for non-TUI driving adapters. |
| `EXPERIENCE.md` | Component Patterns table | New `text-input` row (Story 2.23). |
| `EXPERIENCE.md` | EDTs State Patterns table | New row, "Branch already claimed by another EDT" (Story 2.25). |

### Debug-log triage

All 6 entries in `edt-management-debug-log.md` move from `à trier` to `story ouverte (2.2x)`,
linked per the mapping above (finding #1→2.22, #2→2.25, #3 & #5→2.23, #4→2.24, #6→2.26) — applied
directly as part of this proposal.

## 5. Implementation Handoff

**Scope classification: Minor.** Five new stories completing/hardening already-approved scope
(FR-4/Story 2.2's core capability, Story 2.18's "Add to EDT" AC) plus two additive `GitPort`
methods — no new port, no PRD/MVP/epic redefinition beyond one consequence-level FR-4 narrowing
made explicitly by Max, not discovered as a conflict.

**Routed to: Developer agent (`bmad-build` / `bmad-agent-dev`), direct implementation.**

- Implement in dependency order: **2.23** first (shared `text-input` component — prerequisite for
  2.22/2.24/2.26), then **2.25** (structured failure display + assisted-resolution registry —
  prerequisite for 2.22/2.24/2.26's own failure paths), then **2.22**, **2.24**, and **2.26** (in
  any order relative to each other, though 2.24's `pendingAdds` restructuring and 2.26's
  `renameBranches` both touch `core/edt/modify.ts` — coordinate to avoid rebase friction).
- Each on its own story branch off `epic-2-edt-workspace-management`, per this repo's
  one-branch-per-story convention (`CLAUDE.md`).
- The Story 2.2 amendment lands as part of the 2.22 branch (it's the same change, seen from two
  documents).
- `sprint-status.yaml` and `epics.md` amendments applied directly as part of this proposal (see
  below); `edt-management-debug-log.md` entries updated to `story ouverte (2.2x)`.

**Success criteria:** each story's ACs above pass; `npm test` / `npm run typecheck` / `npm run
depcheck` stay green; `core/edt/modify.ts`'s restructured add/set-branch interaction (2.24) is
verified against Story 2.18's originally-flagged ordering concern (branch-override wins for a
member added and branch-set in the same call) as a regression test, not just new coverage.

**Explicitly out of scope (by Max's decision during this session):**
- Remote-branch listing/fetch-on-demand for "Pick existing" (Story 2.26) — local branches only
  for v1.
- Extending EDT creation (Story 2.22) with "Pick existing"/"Rename current" modes — no "current"
  branch exists yet for a not-yet-member service at creation time.
- Assisted resolutions for the stale-registry (`no .tui-back.yaml found`) and
  `micro-external` shared-branch-mismatch cases noted in the debug log — flagged as likely not
  tui-back bugs (registry hygiene / manifest config), not addressed by any story here.
- Cursor mid-string movement / arrow-key cursor positioning (Story 2.23) — append/backspace-at-
  end model unchanged, flagged as a possible future follow-up.
