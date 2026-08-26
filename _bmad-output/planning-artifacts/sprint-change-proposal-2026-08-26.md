---
date: 2026-08-26
trigger: 'Post-implementation UX feedback on Story 2.15 (EDT commands & action history) — five distinct usability/behavior corrections identified during real usage of the Dashboard, command bar, and EDTs zone'
mode: incremental
epic_impact: 'Epic 2 (in-progress) — 5 new stories appended (2.16–2.20). No epic redefinition, no PRD/MVP change.'
scope_classification: moderate
---

# Sprint Change Proposal — 2026-08-26

## 1. Issue Summary

Following Story 2.15 (`done`), Max used the running TUI and identified five separate usability
gaps and bugs across three zones (Dashboard, command bar, EDTs zone) plus the permanent top
bar/footer chrome. None of these were raised by a specific story's own review — they surfaced
from direct usage, after the feature they touch had already shipped.

**Findings, in the order raised:**

1. **Dashboard launch banner is first-visit-only.** UX-DR14/Story 1.12 (Epic 1, `done`,
   already merged to `devlopment`) explicitly specified "shown once, on launch." In practice
   this means the banner disappears from the Dashboard after the first view — Max wants it
   permanent.
2. **Command bar shows every command immediately on open.** Story 2.14/UX-DR29 specified "the
   full list of registered commands shown" the instant `:` is pressed. Max wants shell-style
   behavior instead: nothing shown until `Tab` is pressed, common-prefix completion, and a
   double-Tab-to-browse grid — verified against the current `command-bar.tsx` implementation,
   which does show every match live as the query changes.
3. **EDTs zone: active EDT isn't visually distinct, detail pane repositions, services aren't
   categorized, and only one contextual action exists per row.** Verified against
   `edts-zone.tsx`: `formatEdtRowMeta` appends "— active" as plain dim text (no color), the
   detail pane's box has no fixed geometry (grows/shrinks with content), the services list is
   one flat list with no member/non-member split, and `Enter` only ever opens Switch-or-Modify.
4. **New capability requested: a global settings screen**, surfaced while discussing item 3 —
   Max wants configurable behaviors (grid density from item 2, hidden action-hints from item 3)
   exposed in one place rather than fixed code constants.
5. **Top bar shows the active EDT's raw ULID, not its name; footer is missing the `[←→] zone`
   hint.** Verified as genuine bugs against `top-bar.tsx` (renders `store.activeEdt`, which
   holds the ULID, never resolved against the EDTs list) and `footer.tsx`'s
   `DEFAULT_FOOTER_HINTS` (lists `[d/e/u/l/r/s] zone` only, even though Story 2.12 already
   shipped `Left`/`Right` zone switching).

A sixth request — automatic clipboard copy on mouse text-selection — was investigated and
**abandoned by Max** after a feasibility discussion: the app's mouse-tracking (used for
splitter-drag and click-to-select) already suppresses the terminal's native selection-copy
gesture, and reimplementing text selection inside Ink from scratch (no built-in primitive for
it) was judged disproportionate to the value. No story was created for it; documenting the
terminal's native Shift-drag bypass was noted as the low-cost alternative if this resurfaces.

## 2. Impact Analysis

### Epic Impact

- **No new epic, no epic redefinition, no PRD/MVP scope change.** All five findings are
  refinements or bug fixes within the surfaces already covered by FR-3–FR-9 and UX-DR13/14/16/20/29.
- **Epic 2** (`in-progress`, all current stories `done`, retrospective not yet run) absorbs all
  five as new stories **2.16–2.20**, following the exact precedent already established by
  Stories 2.10/2.11/2.12/2.13 for appending work whose *code* sits in Epic 1's territory to
  Epic 2 because Epic 2's branch is still open. Two of these five (2.16, 2.20) touch Epic-1-owned
  files (`launch-banner.tsx`/`dashboard-zone.tsx`, `top-bar.tsx`/`footer.tsx`); three (2.17, 2.18,
  2.19) touch Epic-2-owned files.
- **Epics 3–6**: no impact, no resequencing.

### Story Impact

Superseding text amendments (not reopenings — `done` stories keep their status) on:
Story 1.12 AC1, UX-DR14, Story 2.14 AC1, UX-DR29, Story 2.9's EDT-selector-composition note,
UX-DR20, UX-DR5, and AD-7 (storage topology). Each amendment is called out in the story that
supersedes it, mirroring every prior sprint-change-proposal in this repo.

### Artifact Conflicts

- **PRD**: none. No FR is added, changed, or contradicted.
- **Architecture**: additive only. Stories 2.16/2.17/2.18/2.20 stay entirely inside
  `adapters/driving/tui`, zero core/port changes. **Story 2.19 is the one exception** — it
  introduces the first new port this proposal requires (`SettingsPort` +
  `adapters/driven/settings`) and extends AD-7's storage topology with a new
  `XDG_CONFIG_HOME/tui-back/settings.yaml` file, additive to the existing enumeration (registry,
  per-EDT SQLite, global SQLite, state.json) — no existing store changes shape.
- **UI/UX**: two new component patterns are needed, not covered by any existing UX-DR — the
  command-bar's multi-column grid (new **UX-DR30**) and the settings screen (new **UX-DR31**).
  Everything else is a refinement of existing UX-DRs via superseding amendment.
- **Other artifacts**: no deployment/IaC/CI impact — this is 100% application-layer TUI work,
  one new SQLite-free config file.

### Technical Impact / Dependency Finding

While scoping the EDTs-zone story, a real dependency gap was found and resolved with Max before
drafting: the originally-requested "restart this service" per-service action has **no existing
technical foundation** — grep confirms zero Docker/dockerode integration exists anywhere in the
codebase yet; it's Epic 5's Story 5.3 (and partially Epic 3's Story 3.1), both still `backlog`.
**Decision (Max): defer it.** Story 2.18 ships the action as a visibly disabled menu entry
annotated "Available with Epic 5" — no premature Docker adapter is introduced under Epic 2's
branch.

## 3. Recommended Approach

**Option 1 (Direct Adjustment) — selected.** All five findings are addressed by adding five new
stories to the already-open Epic 2, each a self-contained, low-to-moderate-effort, low-risk
change:

| Story | Effort | Risk | Notes |
|---|---|---|---|
| 2.16 Permanent Dashboard Banner | Low | Low | Delete a conditional, remove dead state |
| 2.17 Terminal-Style Command Bar | Medium | Low | Several new pure functions, no core touch |
| 2.18 EDT Zone Highlight/Stability/Categorization/Actions | Medium-High | Low-Medium | Largest of the five; loosens one existing gate (`canEditMemberBranch`), reuses `modifyEdt` entirely |
| 2.19 Global Settings Screen | Medium | Medium | Only story introducing a new port/store |
| 2.20 Top Bar & Footer Accuracy Fixes | Low | Low | Straight bug fixes |

No rollback considered (nothing implemented needs undoing — these are gaps/refinements, not
defects in already-correct behavior) and no PRD/MVP review needed (scope is unaffected).
Rejected: bundling everything into a single mega-story — the five findings have unrelated blast
radii (Dashboard vs. command bar vs. EDTs zone vs. new settings surface vs. top-bar/footer) and
independent review/merge value, consistent with this repo's own "atomic steps" commit
convention.

## 4. Detailed Change Proposals

### New Stories (Epic 2)

#### Story 2.16: Permanent Dashboard Banner

> Added 2026-08-26 (Sprint Change Proposal): reverses Story 1.12/UX-DR14's "shown once, on
> launch" banner behavior — the ASCII banner now stays part of the Dashboard's permanent
> content, not a first-visit-only flash. Appended to Epic 2 because its branch is still open
> (same rationale as stories 2.10/2.11), even though the affected code sits under Epic 1's
> territory (Story 1.12, `done`).

As a developer, I want the k9s-inspired ASCII banner to stay visible on the Dashboard every
time I look at it, not just the first time I launch the tool, So that the Dashboard keeps its
branded first impression permanently instead of losing it after one visit.

**Acceptance Criteria:**

- **Given** the app starts **When** the Dashboard first renders **Then** the banner shows,
  exactly as today (monochrome, no motion/gradient)
- **Given** the Dashboard has already been viewed once (this session or a prior one) **When**
  the Dashboard renders again **Then** the banner still shows, identically — never conditionally
  hidden after a first visit
- **Given** any other Dashboard state (empty-registry prompt, populated view, no-EDT prompt)
  **When** rendered **Then** the banner renders above that content, never replacing or being
  replaced by it (same "above/within the content area" layout as today)
- **Given** the `launchBannerShown` store flag existed solely to gate first-visit-only display
  **When** this story lands **Then** that flag (and the effect that flips it after first view)
  is removed — the banner render becomes unconditional, not state-gated

**Implementation notes:** `dashboard-zone.tsx` currently renders
`{launchBannerShown ? null : <LaunchBanner />}`; becomes an unconditional `<LaunchBanner />`.
`launchBannerShown` state/action in `app-store.ts` is dead code to remove. Test assertions in
`launch-banner.test.tsx`/`dashboard-zone.test.tsx` flip from "hidden after first visit" to
"always visible."

---

#### Story 2.17: Terminal-Style Command Bar Autocomplete & Grid Browser

> Added 2026-08-26 (Sprint Change Proposal): supersedes Story 2.14/UX-DR29's "the full list of
> registered commands shown" on open — the command bar now behaves like a shell's
> Tab-completion (common-prefix completion, double-Tab-to-list, arrow-navigable multi-column
> browser) instead of always showing every command. Appended to Epic 2 — same territory as
> Story 2.14/2.15's command bar, branch still open.

As a developer, I want the `:` command bar to behave like a real shell's Tab-completion (nothing
shown until I ask for it, common-prefix completion, a browsable grid on demand), So that the
command bar feels like the terminal experience the rest of the app already promises, instead of
dumping every command on me the moment I open it.

**Acceptance Criteria:**

- **Given** the command bar just opened (empty input) **When** no key has been pressed yet
  **Then** no command list is shown — only the empty, focused input (supersedes Story 2.14 AC1's
  "full list of registered commands shown")
- **Given** the input is empty **When** `Tab` is pressed **Then** the full command grid is shown
  immediately (no double-press needed — there is nothing to complete against an empty input)
- **Given** the input is non-empty and exactly one command matches its start **When** `Tab` is
  pressed **Then** the input completes to that command's full name (unchanged from Story 2.14
  AC3)
- **Given** the input is non-empty and multiple commands match its start, and every match shares
  a common prefix longer than the current input **When** `Tab` is pressed **Then** the input
  completes up to that longest common prefix (not to a full name, since more than one still
  matches)
- **Given** the input already sits at every match's longest common prefix and more than one
  command still matches **When** `Tab` is pressed once **Then** nothing visibly changes, but the
  press is recorded as a pending completion attempt
- **Given** that pending state **When** a second `Tab` is pressed within the double-press window
  (default 500ms, one named constant) with the query unchanged **Then** the command grid is
  shown, listing every currently-matching command **And When** the window elapses, or any other
  key is pressed first, or the query changes **Then** the pending state is discarded — a later
  `Tab` starts the sequence over
- **Given** the command grid is shown (by either path above) **When** it renders **Then**
  matching commands lay out column-major, left to right, at most **N** rows per column — `N` a
  single named, easily-changed constant (e.g. `COMMAND_GRID_MAX_ROWS`) — column width sized to
  its longest label
- **Given** the full grid's width exceeds the modal's available display width **When** rendered
  **Then** only as many complete columns as fit are shown, with a trailing `…` marker indicating
  more columns exist beyond what's visible — never a silently cut-off partial column
- **Given** the grid is visible and focus is on the input **When** `Down` is pressed **Then**
  focus moves into the grid, landing on the first visible cell (top of the first column) **And
  When** the grid is not visible **Then** `Down` does nothing
- **Given** focus is in the grid **When** `Up`/`Down` is pressed **Then** it moves the
  highlighted cell one row up/down within the current column, clamped to that column's row count
  **And When** `Left`/`Right` is pressed **Then** it moves the highlight to the adjacent column,
  same row index (clamped to that column's last row if shorter)
- **Given** focus is in the grid, on the top row of the current column (row 0) **When** `Up` is
  pressed **Then** focus returns to the input (cursor at end of the current text) — this is the
  only way back to the input from the grid
- **Given** the grid is truncated (the `…` marker is showing) and focus is on the rightmost
  visible column **When** `Right` is pressed **Then** the visible window scrolls one column
  right, revealing the next hidden column (re-evaluating whether `…` still applies on that side)
  **And** the same rule applies symmetrically for `Left` at the leftmost visible column
- **Given** focus is in the grid **When** `Enter` is pressed on the highlighted cell **Then** the
  input completes to that command's full name and focus returns to the input (matching a
  completed `Tab`, not an immediate run — the developer may still append arguments)
- **Given** focus is in the grid **When** any printable character is typed **Then** focus returns
  to the input, the character is appended, and grid navigation state resets
- **Given** the command bar in any focus state (input or grid) **When** `Esc` is pressed **Then**
  the entire bar closes without executing anything — unchanged from Story 2.14 AC5
- **Given** the input changes while the grid is visible **When** the change happens **Then** the
  grid re-filters live to the new match set — never shows a stale command list

**Implementation notes:** extend `command-bar.tsx`'s pure functions:
`longestCommonPrefix(matches)`, a `TabPressState` (`{ query: string; at: number } | null`)
driving the double-press window, and a grid-layout pure function
`layoutCommandGrid(matches, maxRows, availableWidth) → { columns, truncated }` plus a
`scrollOffset` — all directly unit-testable. Grid focus is new local state
(`focus: 'input' | 'grid'`, `gridCursor: { column, row }`) in `CommandBar` itself. Grid cells
render as plain colored `<Text>` (accent + `›` on the highlighted cell) — `ListRow` is
full-width, unsuited to a compact grid cell.

**Amended 2026-08-26 (Story 2.19):** `COMMAND_GRID_MAX_ROWS` becomes a settings-overridable
default, not a fixed constant only code can change.

---

#### Story 2.18: EDT Zone — Active Highlight, Fixed-Width Detail Pane, Categorized Services & Per-Service Actions

> Added 2026-08-26 (Sprint Change Proposal): extends Story 2.6/2.9/2.15's EDTs zone — makes the
> active EDT visually distinct, stabilizes the detail pane's horizontal position, splits the
> flat service list into "member of selected EDT" / "other" categories, extends Tab-cycling to a
> third pane, and adds per-service contextual actions. No core/port change beyond loosening one
> existing TUI-side gate (`canEditMemberBranch`) — `modifyEdt` already supports every operation
> needed (add/remove/set-branch). "Restart" is deferred (no Docker integration exists anywhere
> in the codebase yet — that's Epic 5's Story 5.3 and partially Epic 3's Story 3.1, both
> `backlog`); this story ships it as a visibly disabled action annotated "Available with Epic 5."

As a developer, I want to see at a glance which EDT is active, a detail pane whose position
doesn't shift as I browse EDTs, my services grouped by whether they belong to the EDT I'm
looking at, and quick per-service actions without opening the full Modify form, So that the
EDTs zone reads at a glance instead of requiring me to cross-reference the member list by hand
every time.

**Acceptance Criteria:**

- **Given** the EDT selector list **When** rendered **Then** the active EDT's row renders its
  label in `{colors.accent}`, bold — independently of whether that row is also the keyboard
  cursor's current position (extends `list-row`'s existing `selected` prop with a new `active`
  prop; never removes the existing accent-bar+`›`-marker cursor treatment)
- **Given** the EDT detail pane **When** rendered for any EDT or service, regardless of its
  content's length **Then** its horizontal position and width stay fixed — derived once from
  the list/detail split ratio, never recomputed from either pane's content — so the left/right
  boundary never shifts as you browse EDTs or services
- **Given** the detail pane's content (recent actions, member list) **When** it's longer than
  usual **Then** the box simply extends downward to fit it — nothing else occupies the right
  column below it, so no fixed height, no padding, and no scroll/truncation mechanism is needed;
  the terminal's own height is the only natural limit, an existing constraint of the whole app
- **Given** the EDT selector's focused row **When** the detail pane's "available actions" hint
  renders **Then** it shows exactly the action `Enter` will actually perform in that context —
  `[Enter] Modify` when the focused row is the active EDT, `[Enter] Switch` otherwise — and never
  lists a key that isn't a real binding; Story 2.15's static
  "`[Enter] Switch  [c] Create  [m] Modify`" hint is superseded, since `c`/`m` were never wired
  to any keypress
- **Given** the flat services list (Story 2.6) **When** an EDT row has focus/selection in the
  EDT selector **Then** the services list splits into two labeled groups: **"EDT SERVICES"**
  (services whose path is a member of the currently-*selected* EDT — computed client-side from
  that EDT's own `members` list, independent of `isMember`, which stays tied to the *active* EDT
  for its existing divergence-badge purpose) and **"OTHER SERVICES"** (every other registered
  service)
- **Given** no EDT exists or none is selected yet **When** the services list renders **Then**
  every service falls under "OTHER SERVICES" with an explanatory note ("No EDT selected")
- **Given** the base EDT-list view (no dialog open) **When** `Tab` is pressed **Then** focus
  cycles through three panes in order — EDT selector → EDT SERVICES → OTHER SERVICES → back to
  EDT selector — each independently arrow/Home/End-navigable, extending Story 2.9's two-way
  toggle to a three-way cycle
- **Given** focus is on a row in EDT SERVICES (a member of the selected EDT) **When** `Enter` is
  pressed **Then** a contextual action menu opens: **Remove from EDT**, **Change branch for this
  EDT**, and **Restart** (shown disabled, annotated "Available with Epic 5" — no action fires)
- **Given** "Remove from EDT" is chosen **When** confirmed **Then** it calls `modifyEdt` with
  `removeMembers: [repoPath]` for the selected EDT, with the same inline-error/loading treatment
  as the existing Modify submit, and logs a `modify` action-log entry (Story 2.15)
- **Given** "Change branch for this EDT" is chosen **When** confirmed with a non-empty branch
  name **Then** it calls `modifyEdt` with `setBranches: [{repoPath, branch}]` for the selected
  EDT (reuses the existing branch-edit text-input UI and `validateBranchEditValue` check),
  follows Story 2.4's protected-switch rule, and logs a `modify` action-log entry
- **Given** focus is on a row in OTHER SERVICES (not a member of the selected EDT) **When**
  `Enter` is pressed **Then** an "Add to EDT" flow opens: a branch text-input pre-filled with
  that service's current branch, editable to an existing or new branch name — confirming calls
  `modifyEdt` with both `addMembers: [repoPath]` and `setBranches: [{repoPath, branch}]` in the
  same call, and logs a `modify` action-log entry
- **Given** `canEditMemberBranch` (Story 2.9) currently only allows branch-editing an *existing*
  member of the target EDT **When** this story lands **Then** that gate is loosened to allow
  branch-editing any *selected* candidate (existing member or one just being added) —
  `resolveModifyOps`'s `setBranches` filter already supports this; verify at implementation time
  whether `modifyEdt`'s internal ordering applies `addMembers` before `setBranches` for the same
  repo path within one call (flagged for the implementer)
- **Given** the detail pane while focus is on EDT SERVICES or OTHER SERVICES **When** rendered
  **Then** the "available actions" hint line reflects that pane's context instead of the
  EDT-selector's hint line

**Implementation notes:** `ListRow` gains an `active?: boolean` prop (default `false`,
`labelColor: accent, bold: true` when set — additive). `PaneFocus` becomes a 3-value type
(`'edts' | 'edt-services' | 'other-services'`); `togglePaneFocus` becomes a `cyclePaneFocus`
3-way rotation. Category partitioning is a pure function
(`partitionServicesByEdtMembership(rows, focusedEdt)`), directly unit-testable. The contextual
action menu and "Add to EDT" branch input reuse `ModalDialog` + the existing branch-edit
text-input pattern. All new dialog states log through the existing `logEdtAction` — no new
action type.

**Amended 2026-08-26 (Story 2.19):** the EDT detail pane's list of shown "available actions"
hints becomes settings-overridable (per-hint hide list); nothing hidden by default.

---

#### Story 2.19: Global Settings Screen (`:settings`)

> Added 2026-08-26 (Sprint Change Proposal): introduces a persisted user-preferences surface,
> reachable via the `:` command bar (Story 2.14), tab-organized — a "General" tab plus one tab
> per feature area that has settings (starting with EDTs and the Command Palette). First TUI
> surface needing config the manifest/registry model doesn't cover — extends AD-7's storage
> topology additively. Appended to Epic 2 (branch still open); seeds the two settings Story
> 2.17 (command-palette grid density) and Story 2.18 (EDT detail-pane hidden actions) reference.

As a developer, I want one settings screen, organized by tab, to adjust the tool's configurable
behaviors, So these preferences live in one discoverable place and persist across sessions,
instead of being fixed constants only a code change could adjust.

**Acceptance Criteria:**

- **Given** the command bar is open **When** the developer types `settings` and presses `Enter`
  **Then** the settings screen opens as a `modal-dialog` instance, defaulting to the "General"
  tab
- **Given** the settings screen is open **When** `Left`/`Right` is pressed **Then** focus cycles
  between tabs — "General", "EDTs", "Command Palette" for this story — visually mirroring the
  zone-tab bar's active/inactive treatment at a smaller scale
- **Given** the "Command Palette" tab **When** viewed **Then** it shows the max-rows-per-grid-
  column setting (Story 2.17), editable, defaulting to that story's constant, applied
  immediately to the live command bar
- **Given** the "EDTs" tab **When** viewed **Then** it shows a `checkbox-list-item` list of the
  EDT detail pane's available-action hints (Story 2.18) the developer can hide — unchecked by
  default; toggling applies immediately
- **Given** the "General" tab **When** viewed **Then** it renders validly even with zero
  settings in it yet — a placeholder tab, not a defect
- **Given** any setting change **When** made **Then** it persists immediately to a new per-user
  store — `XDG_CONFIG_HOME/tui-back/settings.yaml`, zod-validated on load like the manifest —
  and survives a restart
- **Given** a corrupt/invalid `settings.yaml` **When** loaded **Then** the tool falls back to
  every default and surfaces a clear, non-blocking warning — never a crash
- **Given** the settings screen **When** `Esc` is pressed **Then** it closes — nothing to
  discard, every change already applied live
- **Given** this screen **When** exercised via keyboard only **Then** every action is reachable
  without a mouse (Story 1.9's standing rule)

**Implementation notes:** new `core/ports/settings.ts` (`SettingsPort`) +
`adapters/driven/settings` (YAML, mirrors `adapters/driven/registry`'s shape) — the first new
port this proposal requires. Consumed via a new `settings` slice in the Zustand store, loaded
once at startup. Story 2.17's `COMMAND_GRID_MAX_ROWS` becomes that setting's *default*, not a
replacement. New `settings` command in `commands.ts`, same shape as `registry`.

---

#### Story 2.20: Top Bar & Footer Hint Accuracy Fixes

> Added 2026-08-26 (Sprint Change Proposal): fixes two UX-DR7/UX-DR13 violations found while
> reviewing the top bar — the active EDT is shown by its ULID instead of its name, and the
> footer never lists the `Left`/`Right` zone-switching shortcut Story 2.12 already implemented.
> Bug fixes, not new behavior; appended to Epic 2 (branch still open) though the affected
> components (`top-bar.tsx`, `footer.tsx`) are Epic 1 territory (Story 1.11).

**Acceptance Criteria:**

- **Given** an EDT is active **When** the top bar renders **Then** it shows that EDT's `topic`
  (its human-readable name) — never its ULID — resolved regardless of which zone is currently
  active (the top bar no longer depends on the EDTs zone having been visited first)
- **Given** no EDT is active **When** the top bar renders **Then** it shows "no active EDT",
  unchanged
- **Given** the footer's default hint set **When** rendered **Then** it includes `[←→] zone`
  alongside the existing `[d/e/u/l/r/s] zone`, reflecting Story 2.12's arrow-based zone
  switching

**Implementation notes:** the active-EDT topic needs to be resolvable at the app-shell level,
not only inside `EdtsZone`'s own mount effect — either lift `loadEdts()` to fire once at
`AppShell` mount, or add a lighter dedicated resolution/topic cache. `TopBar` then derives its
label from `edts.find(e => e.ulid === activeEdt)?.topic`. `footer.tsx`'s
`DEFAULT_FOOTER_HINTS` gains one entry, ordered by frequency per UX-DR7.

### Amendments to Existing Text (superseding notes, not reopenings)

| Document | Location | Change |
|---|---|---|
| `epics.md` | Story 1.12 AC1 | Note: "Amended 2026-08-26 (Story 2.16): 'shows once' is superseded — the banner is now permanent." |
| `epics.md` | UX-DR14 | `"shown once on launch"` → `"shown permanently on the Dashboard (amended 2026-08-26, Story 2.16)"` |
| `epics.md` | Story 2.14 AC1 | Note: "Amended 2026-08-26 (Story 2.17): 'full list shown' on open is superseded — nothing shows until `Tab` is pressed." |
| `epics.md` | UX-DR29 | Amended to describe Tab-driven reveal + grid, referencing Story 2.17 |
| `epics.md` | Story 2.9 (composition note) | Note: "Amended 2026-08-26 (Story 2.18): resolved — flat list superseded by the member/other split." |
| `epics.md` | UX-DR20 | Adds "member/non-member service categorization and per-service contextual actions (amended 2026-08-26, Story 2.18)" |
| `epics.md` | UX-DR5 | Adds the new `active` row state (accent+bold, independent of `selected`) |
| `epics.md` | AD-7 (storage topology) | Additive: adds `XDG_CONFIG_HOME/tui-back/settings.yaml` |
| `epics.md` | New **UX-DR30** | Command-bar multi-column grid component |
| `epics.md` | New **UX-DR31** | Settings screen component |
| `DESIGN.md` | Launch banner (§ Layout & Spacing) | `"appears once, on launch"` → `"appears permanently, on every Dashboard render"` |
| `EXPERIENCE.md` | Navigation model, "Lifted from k9s" | Same once→permanent correction |
| `EXPERIENCE.md` / `DESIGN.md` | command-bar entry | Updated to describe Tab-driven reveal + grid browsing |

## 5. Implementation Handoff

**Scope classification: Moderate.** Five new stories in an already-open epic, one of which
(2.19) introduces a new port/adapter pair — enough coordination to warrant PO/Dev backlog
sequencing, but no PM/Architect replan (no FR/PRD/MVP change) and no rollback.

**Routed to: Product Owner / Developer agents.**

- **Developer (`bmad-build` / `bmad-agent-dev`)**: implement Stories 2.16 → 2.20 in that order —
  each is a small, atomic-commit-friendly branch off `epic-2-edt-workspace-management`, per this
  repo's one-branch-per-story convention. Suggested order follows the effort/risk table in
  §3 (cheapest/lowest-risk first): 2.16, 2.20, 2.17, 2.18, 2.19 — note 2.18 and 2.19 have a
  one-way dependency (2.19's "EDTs"/"Command Palette" tabs reference settings 2.17/2.18 define
  as defaults), so 2.19 should land after both.
- **Product Owner**: confirm `sprint-status.yaml` reflects the five new `backlog` entries under
  `epic-2` (applied as part of this proposal, see below) and re-open Epic 2's retrospective
  timing decision — it was "optional"/not yet run; whether to run it before or after these five
  lands is a PO call, not decided here.

**Success criteria:** each story's own Acceptance Criteria (above) pass; `npm test` /
`npm run typecheck` / `npm run depcheck` stay green after each story lands, per this repo's
existing verification convention; no core/port change outside Story 2.19's `SettingsPort`.

**Explicitly out of scope (by Max's decision during this session):**
- Automatic clipboard copy on mouse text-selection — investigated, abandoned (see §1).
- Implementing "restart this service" — deferred to Epic 5 (Story 5.3); Story 2.18 ships it
  disabled with an explanatory annotation only.
