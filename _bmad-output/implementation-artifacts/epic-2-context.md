# Epic 2 Context: EDT Workspace Management

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A developer can create, modify, and safely switch between EDTs — isolated, per-topic workspaces spanning a manually chosen set of member services, each tracking its own working branch independently — without ever losing uncommitted work, see every managed repo's current branch and divergence from upstream at a glance, and trust that any repo not in the active EDT stays parked on its shared branch. This is the workspace-management pillar the rest of the tool is scoped against (group update, shared-types propagation, logs, and routes all key off "the active EDT's member services"), and it replaces today's manual, error-prone `git checkout`/`git stash` juggling across many repos when switching between concurrent coding sessions.

## Stories

- Story 2.1: Create an EDT
- Story 2.2: Create Dev Branches at EDT Creation
- Story 2.3: Git Branch-Scope Safety Gate & Shared-Branch Rejection
- Story 2.4: Switch the Active EDT Without Data Loss
- Story 2.5: Modify an EDT After Creation
- Story 2.6: Branch and Divergence Visibility
- Story 2.7: Canonical Navigation Contract (Arrows/Home/End/Tab)
- Story 2.8: Fullscreen TUI Rendering
- Story 2.9: EDTs Zone — Create, Switch, and Modify
- Story 2.10: Recover From an Already-Running TUI Instance
- Story 2.11: Repo Registry Screen & Manifest Onboarding Guidance
- Story 2.12: Zone Arrow Navigation
- Story 2.13: Manifest-Gated Zone Tab Visibility & Disabled State (Routes & shared-types)
- Story 2.14: Command Entry Bar (`:`) & Registered Commands
- Story 2.15: EDT Commands in Command Bar & Action History in Detail Pane
- Story 2.16: Permanent Dashboard Banner
- Story 2.17: Terminal-Style Command Bar Autocomplete & Grid Browser
- Story 2.18: EDT Zone — Active Highlight, Fixed-Width Detail Pane, Categorized Services & Per-Service Actions
- Story 2.19: Global Settings Screen (`:settings`)
- Story 2.20: Top Bar & Footer Hint Accuracy Fixes
- Story 2.21: EDT Zone — Multi-Splitter Layout with Keyboard Resize-Mode (`Ctrl+W`)
- Story 2.22: EDT Creation — Mandatory Branch Creation UI
- Story 2.23: Visible Text-Input Cursor (EDT Zone Text Fields)
- Story 2.24: Modify EDT — Mandatory Branch on Add, No More Silent Default
- Story 2.25: EDT Zone — Structured Per-Repo Failure Display & Branch-Collision State
- Story 2.26: Branch-Picker — 3 Explicit Modes (Pick Existing / Create New / Rename Current)
- Story 2.27: EDT Creation — Branch-Picker Reuse & Manifest-Aware Base-Branch Default
- Story 2.28: Registry — Manifest Semantic Validation
- Story 2.29: Delete an EDT
- Story 2.30: EDT Quick-Pick — Filterable List for `edt-switch` / `edt-modify`
- Story 2.31: `edt-create-from` — Clone an EDT's Membership as a Creation Starting Point
- Story 2.32: `TextInputLine` — Cursor Navigation & App-Wide Adoption
- Story 2.33: Registry — Deregister Stale, Unreachable, or Unmanaged Repos

## Requirements & Constraints

- Creating an EDT requires a topic and at least one member service; the topic must be unique before any file is written; each member's working branch is recorded once that service is first touched within the EDT; a service can belong to several EDTs at once, each tracking its own branch for it independently.
- Branch creation at EDT-creation time is driven by a base branch (defaulting to each repo's own manifest-declared shared branch, never a hardcoded value) and a grouped/individual naming mode; a per-service branch-creation failure is reported without aborting the rest of the batch; on the TUI path branch creation is mandatory whenever at least one member is selected, always with an editable, pre-filled suggested name.
- Registering a shared/protected branch (`development`/preprod/prod, or any branch outside the active EDT's own registration) as an EDT's branch is rejected before any git write happens, at creation, modification, and add-to-EDT alike — never inferred silently from whatever a repo currently happens to be checked out on.
- Modifying an EDT (add/remove members, change a member's branch, rename topic) never disturbs other members; a zero-member EDT is a valid, not an error, state; branch changes follow the same protected-switch and uniqueness rules as creation; adding a member always requires an explicit target branch.
- Switching the active EDT auto-preserves uncommitted work in every affected repo — member and non-member alike — before acting; exactly one EDT is active at a time; every non-member managed repo is forced onto its shared branch regardless of that repo's membership in a different, inactive EDT; an in-progress action on the outgoing EDT blocks the switch by default with an offer to stop it, and returning to that EDT later offers to resume the interrupted action.
- Branch name and ahead/behind divergence are shown for every managed service, EDT member or not; explicit "no upstream" and "unknown (offline)" states replace any numeric guess.
- Deleting a non-active EDT offers a per-service leave/delete-branch choice informed by merge status (into that repo's shared branch) and uncommitted-work state; deleting the currently active EDT is rejected outright; a branch also registered as another EDT's own branch is skipped (reported as its own per-service failure) without blocking the rest of the deletion or removing the EDT record; deletion is permanent, no undo/soft-delete.
- A crash or bug touching one EDT's data must never affect another EDT's data or the tool's other capabilities (blast-radius isolation) — the sole deliberate exception is the narrow cross-EDT global store, out of this epic's scope.
- A registry entry whose path no longer exists on disk, or whose manifest file is gone, is never removed automatically or silently — every such stale candidate is shown with its path and reason before anything is removed, and removal requires explicit confirmation or per-path selection; removing a stale entry never touches EDT records that may still reference it.

## Technical Decisions

- Storage: one SQLite file per EDT at `XDG_DATA_HOME/tui-back/edts/<ulid>.db` — the filename is a generated ULID, never the topic, so renaming an EDT never touches the file; schema evolves through hand-rolled numbered `.sql` files tracked by a `schema_version` table, no external migration framework.
- The active-EDT pointer and transient per-zone UI state (including multi-boundary splitter ratios) persist in `XDG_STATE_HOME/tui-back/state.json`; the TUI's single Zustand store re-syncs from it via `fs.watch`/poll so a CLI-driven change is picked up live without a restart.
- Every git write funnels through one centralized git adapter that resolves the allowed-branch context itself from EDT/manifest state at write time — never trusting a caller-supplied branch name — and refuses any write targeting a shared/protected branch or a branch that isn't the current EDT's own registered branch for that service.
- Concurrency: single-TUI-instance detection (scoped to the TUI's own launch path, never blocking a CLI invocation) plus a short-lived advisory lock per EDT id / repo path around any state-mutating use-case; a stale lock from a crashed session is detected and auto-reclaimed, a live one prompts to take over interactively.
- `GitPort` gains `listBranches`, `renameBranch`, `isBranchMerged`, and `deleteBranch` over this epic, each gated through the same centralized branch-scope-safety check as existing writes.
- A new `SettingsPort`/`settings.yaml` (zod-validated, under `XDG_CONFIG_HOME`) holds per-user preferences (command-palette grid density, EDT-detail hint/action-type visibility) — additive to the existing config/data/state layout; a corrupt file falls back to every default with a non-blocking warning rather than crashing.
- The `:` command-entry bar is a small, statically registered in-memory command → handler list in the TUI adapter (no core/port change per command added); its Tab-completion behaves like a shell (common-prefix completion, double-Tab opens a column-major grid browser).
- A structured per-repo failure list, plus an extensible error-code → assisted-resolution registry (first entry: a branch already claimed by another EDT), is shared across every EDT action's partial-failure result.
- A reusable bounded/scrollable-list primitive caps any list or panel to the terminal's actual row count; the EDT zone's service lists adopt it (mechanism originated in and shared with the Logs zone, Epic 5's Story 5.5).
- `RegistryPort` gains a targeted `remove(path)` (read-modify-write, distinct from the whole-file `reset` reserved for corrupt-registry recovery); a stale-entry classifier distinguishes registered paths that no longer exist on disk from ones whose manifest can no longer be found, leaving other manifest-content problems (invalid YAML, schema failures) to manifest validation rather than registry hygiene.

## UX & Interaction Patterns

- EDTs zone states: no-EDT-yet prompt, populated list (branch + ahead/behind per service), zero-member EDT shown as valid, duplicate-topic and zero-member-at-creation rejections, per-service branch-creation failure reporting, protected-branch rejection explained before any write, member add/remove without disturbing others, protected-switch and interrupted-update-recovery prompts, plus later-added EDT-deleted, EDT quick-pick, and create-from-existing-EDT states.
- List side is three panes (EDT selector / EDT SERVICES / OTHER SERVICES) beside the detail pane, with fixed-but-movable borders (`Ctrl+W` keyboard resize-mode, ratios persisted per zone) and `Tab` cycling all four regions; both service lists render inside the shared bounded/scrollable window.
- Canonical navigation: arrows/Home/End move and jump within a list only, `Left`/`Right` directly switch the active zone (wrapping, skipping fully-omitted tabs, landing on disabled ones), `:` opens command entry, `?` opens the scrollable keybinding-help modal — no vim-style `j`/`k`/`g`/`G` anywhere.
- Command-bar EDT actions (`edt-create`/`-switch`/`-modify`/`-delete`/`-create-from`) coexist with the zone's own Enter-key shortcuts; the no-argument form of switch/modify/create-from opens a filterable quick-pick over EDT topics.
- Every branch-entry point in the zone goes through one shared, three-mode picker (pick existing / create new / rename current) plus a visible-cursor, Left/Right/Home/End-navigable text-input component — no blind free-text fields.
- Partial-failure results render as one line per failed repo with an optional assisted-resolution action attached, never a concatenated error string.
- The Repo Registry screen's stale-entry cleanup follows the same detect-then-guided-choice-then-act convention as its own scan/register/validate actions: candidates render as a pre-checked checkbox list, and confirming removal reports outcomes through the same structured per-repo result list used elsewhere in the zone.
- The `:settings` screen is a tab-organized modal; every change applies and persists immediately with no separate save step, and a tab with zero settings still renders validly rather than as an error.

## Cross-Story Dependencies

- Core build-up is sequential: 2.1 → 2.2 (creation) → 2.3 (safety gate, reused by every later branch write) → 2.4 (switch) → 2.5 (modify) → 2.6 (divergence display) establish the EDT domain logic; 2.9 wires it into the TUI zone.
- A long branch-input/failure-display chain, each stage explicitly sequenced after the last: 2.22 (mandatory branch UI) → 2.23 (visible cursor) → 2.24 (mandatory branch on add) → 2.25 (structured failure display) → 2.26 (3-mode branch picker) → 2.27 (branch-picker reuse at creation) → 2.31 (create-from-existing, also depends on 2.30) → 2.32 (cursor navigation, adopted app-wide).
- Command-bar evolution: 2.14 (bar + first command) → 2.15 (EDT commands + action history) → 2.17 (shell-style autocomplete/grid) → 2.19 (settings screen, consumes 2.17's grid-size constant as a default) → 2.30 (quick-pick, reuses the grid pattern).
- Several stories (2.10, 2.11, 2.12, 2.13, 2.16, 2.20) amend code that structurally belongs to Epic 1 but land on this epic's branch because it was still open when the gaps were found — Story 2.21 explicitly cites this as established precedent.
- This epic's mechanisms are built generic enough for reuse outside it: Story 2.21's resize-mode and Story 2.25's failure/assisted-resolution registry are designed as extension points; Epic 5's Story 5.5 both borrows this epic's bounded-list need and retrofits its own bounded-list primitive back onto the EDT SERVICES/OTHER SERVICES lists.
- Downstream epics depend on this epic's output: Epic 3's group update and Epic 4's shared-types publish/propagation are scoped to "the active EDT's member services" and Epic 3 reuses this epic's centralized git branch-scope gate unchanged.
- Story 2.33 closes a gap deferred since Epic 1 (registry had no unregister path) and named again as future scope in Story 2.25; it extends the Repo Registry screen (2.11) with a "clean stale entries" action, reuses the structured per-repo outcome/candidate-list conventions established by 2.25/2.28/2.29, and leaves the switch flow's existing not-registered failed-row handling (2.4) as the mechanism covering EDT members whose registry entry has been removed.
