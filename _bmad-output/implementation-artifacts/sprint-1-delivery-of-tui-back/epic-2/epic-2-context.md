# Epic 2 Context: EDT Workspace Management

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A developer can create, modify, safely switch between, and delete EDTs — persistent, topic-named workspaces grouping a manually-chosen set of member services and each member's own working branch — without ever losing uncommitted work, with branch/divergence visibility across every managed repo and the guarantee that non-member repos always stay on their shared branch. This epic also carries the TUI shell forward from Epic 1's placeholders into a real, fully keyboard-navigable EDTs zone, plus several cross-cutting shell additions (zone arrow navigation, manifest-gated tabs, the `:` command bar and grid, a settings screen, multi-splitter resize, a reusable branch-picker, and a cursor-addressable text-input primitive) that landed here because Epic 2's branch stayed open while they were found, even though some affected code is nominally Epic 1 territory.

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

## Requirements & Constraints

- Creating an EDT requires a topic unique among existing EDTs and at least one manually-selected member service; a service may belong to several EDTs at once, each tracking its own branch for it independently.
- Branch creation at EDT-creation is mandatory on the TUI path (a base branch plus grouped/individual naming, always editable, pre-filled from the EDT's topic or the repo's own manifest-declared shared branch — never a hardcoded default); `core` still accepts a no-branch-creation call shape for other driving adapters. Per-service branch-creation failures are reported individually via a structured per-repo list and never abort the others.
- A branch is always explicit, never silently inferred from whatever a repo happens to be checked out on — this applies to EDT creation, adding a member, and changing a member's branch alike.
- Post-creation, members can be added/removed and a member's branch changed without disturbing other members; an EDT may end at zero members and must display validly, never as an error. Topic rename follows the same uniqueness rule as creation, with no file rename needed (filename is a ULID).
- A shared/protected branch (`development`, preprod, prod) can never be registered as an EDT's own branch — rejected with a clear explanation before any git write, both at creation and later.
- Switching the active EDT must never lose uncommitted work anywhere affected. After a switch: exactly one EDT is active, every member sits on its own registered branch, every non-member managed service sits on its shared branch — evaluated purely against the new EDT's membership, independent of that service's membership elsewhere.
- Every managed service (member or not) shows branch + ahead/behind divergence and its manifest-declared shared branch; "no upstream" and "unknown (offline)" are explicit distinct states, never numeric/stale placeholders.
- Deleting a non-active EDT requires a per-member branch disposition (leave / delete, merge-status- and clean-work-informed defaults, independently toggleable); deleting the active EDT is rejected outright, never auto-switched. A branch also claimed by another EDT is refused per-branch without blocking the rest of the deletion or the EDT record's own removal. No soft-delete/undo.
- A registered repo's manifest can be schema-valid yet semantically wrong (e.g. a `sharedBranch` that doesn't exist); the registry screen must be able to verify such claims against real repo state, per-repo, via an extensible check registry.
- List navigation is exclusively arrows/Home/End (no `j`/`k`/`g`/`G`); `Tab` cycles focus among fields/panes/boundaries only, never list movement.

## Technical Decisions

- **Storage:** one SQLite file per EDT at `XDG_DATA_HOME/tui-back/edts/<ulid>.db` (filename is the ULID, never the topic); schema evolves via hand-rolled numbered `.sql` files with a `schema_version` table. Active-EDT pointer and persisted UI state (incl. per-zone splitter ratios) live in `XDG_STATE_HOME/tui-back/state.json`. `XDG_CONFIG_HOME/tui-back/settings.yaml` holds zod-validated per-user preferences, additive and independent of registry/EDT/global stores; corrupt/invalid settings fall back to defaults with a non-blocking warning (manifest-validation convention).
- **Git safety gate:** every write passes through `adapters/driven/git`, which resolves the allowed-branch context itself from EDT/manifest state at write time and rejects (pre-invocation) any write outside the current EDT's own registered branch for that service — never trusts a caller-supplied branch name. `GitPort` grows local-only `listBranches`, `renameBranch` (gated by the same safety check as `createBranch`), `isBranchMerged`, and `deleteBranch(force)` — all routed through this gate.
- **Branch resolution is data-driven, not hardcoded:** each service's manifest-declared shared branch feeds every base-branch suggestion in the EDT zone; when several selected members' shared branches disagree, the UI forces an explicit per-member choice rather than guessing.
- **Extensible per-code registries** are the app's standing pattern for "detect → guided choice → act": one registry maps a failure's error code to an optional assisted-resolution action (branch-collision today, others addable without touching the renderer), and a second maps a manifest-semantic check name to its verifier (repo-existence of `sharedBranch` today).
- **Shared UI primitives, not per-dialog reimplementation:** `TextInputLine` (cursor-addressable `{value, cursor}` editing via a shared `nextTextInputValue`) and `BranchPicker` (pick-existing / create-new / rename-current, reusing one filterable-list widget for both branch and base-branch candidates) are the single implementations used everywhere a branch or free-text value is entered — command bar and registry-screen inputs included — leaving no parallel hand-rolled text field in the codebase.
- **State ownership:** one Zustand store holds cross-zone state (active EDT, per-service status, in-flight runs); zone-local UI state (dialog state machines, grid/picker focus) stays component-local. The store's `activeEdt` is a hydrated cache of `state.json`, re-synced via `fs.watch`/poll so a concurrent CLI-made change is picked up live.
- The `:` command bar is a small in-memory, statically-defined registry (name → handler) in `adapters/driving/tui`, no core/port change; autocomplete/grid logic and quick-pick filtering are pure and unit-testable without mounting Ink.
- EDT action history persists per-EDT in its own SQLite (`action_log` table), via `EdtRegistryPort` extensions (`logAction`/`getActionLog`); settings can filter which hints/action types surface without touching the underlying log.

## UX & Interaction Patterns

- EDTs zone states: empty (explicit create-first prompt), populated list with branch+divergence, duplicate-topic and zero-member-at-creation rejection, branch-required rejection on any add, shared-branch/branch-collision rejection before any write, member added/removed without disturbing others, zero-member EDT shown valid, interrupted-update recovery offer, and (new) a per-member delete-disposition confirmation and "EDT is active, switch away first" rejection.
- The services pane splits into "EDT SERVICES" (members of the *selected*, not necessarily active, EDT) and "OTHER SERVICES"; `Tab` cycles three-way focus (selector → EDT SERVICES → OTHER SERVICES). Per-service actions (remove/change-branch on a member, add-to-EDT on a non-member) open via `Enter`; the row driving the split renders `emphasized` (accent+bold), independent of the tool-wide active EDT's discreet `" active"` suffix.
- Every branch-entry point (create, modify checklist, change-branch, add-to-EDT) opens the same 3-way `BranchPicker` (Pick existing / Create new / Rename current, `Tab`-cycled, defaulting to Create new) instead of a blind free-text field; a picker session in Modify retitles the dialog to name the service it targets, and only a newly-checked (not-yet-member) row opens it — an existing member's branch change goes through the EDT SERVICES pane's own action, not the checklist.
- Any partial-failure result (switch/create/modify/add-to-edt/delete) renders one line per failed repo via a shared structured list, with a per-error-code registry supplying an optional inline remedial action (currently: retry with a different branch on a collision).
- The detail pane's position/width is fixed, derived once from the split ratio; its "available actions" hint always mirrors exactly what `Enter` will do in context. The EDT zone is the first "multi-splitter zone" (3 internal boundaries plus list/detail), keyboard-resizable via `Ctrl+W`, ratios persisted per zone.
- `Left`/`Right` switch the active zone directly (wrapping, skipping omitted tabs, landing on disabled ones); inert under any overlay/dialog or resize-mode. `edt-switch`/`edt-modify`/`edt-create-from` run with no argument open a filterable quick-pick rather than guessing "first"/"focused."
- The settings screen (`:settings`) is a tabbed modal ("General"/"EDTs"/"Command Palette"); the EDTs tab holds two drill-down groups ("Hint visibility", "Recent action types"), `Esc` stepping back one level before closing the screen.

## Cross-Story Dependencies

- Stories 2.7–2.32 build on `done` Epic 1 groundwork: the navigation stub (1.13), single-instance lock (1.7), Atelier components (1.9/1.10), permanent shell (1.11), scan/register use-cases (1.5) — several amend that story text in place rather than reopening it.
- 2.2 (branch creation) and 2.4/2.5 (switch/modify) all depend on 2.3's safety gate and 1.7's per-resource lock.
- 2.9 (EDTs zone) is the first TUI consumer of 2.1–2.6's core use-cases and 2.7's navigation contract.
- 2.11's `:`-binding is superseded by 2.14 (command bar), which 2.17 then extends with autocomplete/grid.
- 2.15 (EDT commands + action history) builds on 2.9's dialog state machines and is extended by 2.18 (categorized services/actions, logging through 2.15) and 2.19 (settings-driven filtering of 2.15/2.18's output).
- 2.19 introduces `SettingsPort`; 2.17's grid-row constant and 2.18's hint list are settings-backed by it.
- 2.22 (mandatory branch on create) and 2.24 (mandatory branch on add) both depend on 2.23's `TextInputLine`; 2.25's structured failure display is the landing surface both reuse for per-repo errors.
- 2.26's `BranchPicker` depends on 2.23 (text-input), 2.24/2.25 (the failure/assisted-resolution surface it plugs into), and adds `listBranches`/`renameBranch` to `GitPort`; 2.27 then extends creation's base-branch step to reuse the same picker plus manifest-`sharedBranch` defaulting, and 2.31 (`edt-create-from`) builds on both 2.27 and 2.30's quick-pick to seed a new EDT's membership and per-member base-branch suggestions from a root EDT.
- 2.28 (manifest semantic validation) extends 2.11's registry screen with a new extensible check registry, independent of the EDT-zone stories.
- 2.29 (delete) reuses 2.3's safety gate and 2.25's structured failure display for per-branch deletion conflicts.
- 2.32 unifies 2.23's cursor rendering with the command bar's and registry screen's own hand-rolled text fields onto one editing primitive — sequenced last, after the EDT-zone fields prove the extended contract.
- The "Restart" action stubbed disabled in 2.18 depends on Docker integration not yet built (Epic 5's Story 5.3, partially Epic 3's Story 3.1) — out of scope here.
- Epic 3 and Epic 4 both reuse this epic's git safety gate and EDT membership model directly.
