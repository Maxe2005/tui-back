# Epic 2 Context: EDT Workspace Management

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A developer can create, modify, safely switch between, and delete EDTs — isolated coding-session workspaces spanning a manually chosen set of managed repos — without ever losing uncommitted work, with branch/divergence visibility across every managed repo and a guarantee that non-member repos stay on their configured shared branch. This is the first FR-bearing epic after Epic 1's navigation shell; its branch stayed open long enough to also absorb cross-cutting TUI infrastructure (command bar, settings screen, resizable multi-pane layout, structured failure display, text-input primitives) even though some of that sits nominally in Epic 1's territory.

## Stories

- Story 2.1: Create an EDT
- Story 2.2: Create dev branches at EDT creation
- Story 2.3: Git branch-scope safety gate & shared-branch rejection
- Story 2.4: Switch the active EDT without data loss
- Story 2.5: Modify an EDT after creation
- Story 2.6: Branch and divergence visibility
- Story 2.7: Canonical navigation contract (arrows/Home/End/Tab)
- Story 2.8: Fullscreen TUI rendering
- Story 2.9: EDTs zone — create, switch, and modify
- Story 2.10: Recover from an already-running TUI instance
- Story 2.11: Repo registry screen & manifest onboarding guidance
- Story 2.12: Zone arrow navigation
- Story 2.13: Manifest-gated zone tab visibility & disabled state
- Story 2.14: Command entry bar (`:`) & registered commands
- Story 2.15: EDT commands in command bar & action history in detail pane
- Story 2.16: Permanent Dashboard banner
- Story 2.17: Terminal-style command bar autocomplete & grid browser
- Story 2.18: EDT zone — active highlight, fixed detail pane, categorized services & per-service actions
- Story 2.19: Global settings screen (`:settings`)
- Story 2.20: Top bar & footer hint accuracy fixes
- Story 2.21: EDT zone — multi-splitter layout with keyboard resize-mode
- Story 2.22: EDT creation — mandatory branch creation UI
- Story 2.23: Visible text-input cursor (EDT zone text fields)
- Story 2.24: Modify EDT — mandatory branch on add, no silent default
- Story 2.25: EDT zone — structured per-repo failure display & branch-collision state
- Story 2.26: Branch-picker — 3 explicit modes (pick existing / create new / rename current)
- Story 2.27: EDT creation — branch-picker reuse & manifest-aware base-branch default
- Story 2.28: Registry — manifest semantic validation
- Story 2.29: Delete an EDT
- Story 2.30: EDT quick-pick — filterable list for edt-switch / edt-modify
- Story 2.31: edt-create-from — clone an EDT's membership as a creation starting point
- Story 2.32: TextInputLine — cursor navigation & app-wide adoption
- Story 2.33: Registry — deregister stale, unreachable, or unmanaged repos
- Story 2.34: EDT zone — colored, explained service-listing issues

## Requirements & Constraints

- Create an EDT with a unique topic and ≥1 member service; duplicate topic or zero-member creation is rejected up front (FR-3).
- Branch creation at EDT creation is mandatory on the TUI path: base branch (default = each repo's manifest `sharedBranch`, never hardcoded) plus a naming mode (shared name or per-service); a per-service branch-creation failure is reported without aborting the others (FR-4).
- A shared/protected branch (`development`, preprod, prod) can never become an EDT's own branch — rejected with explanation before any git write, at creation, modification, or any later change (FR-7).
- Switching the active EDT auto-preserves uncommitted work everywhere affected, resets every non-member repo to its shared branch (fetching it first if absent), and is blocked while a locked action runs on the outgoing EDT, with a stop-and-resume offer (FR-6, FR-8).
- Members/branches/topic are editable post-creation without disturbing other members; a zero-member EDT is a valid, non-error state (FR-5).
- Every managed service shows branch plus ahead/behind divergence, with explicit "no upstream" / "unknown (offline)" states instead of numeric placeholders (FR-9).
- Deleting a non-active EDT offers a per-member branch disposition (leave/delete) informed by merge status and uncommitted work, force-deleting when unmerged/dirty; deletion is blocked while active, and per-service when that branch belongs to another EDT (FR-24).
- A crash touching one EDT's SQLite file must never affect another EDT's data (NFR-2).

## Technical Decisions

- One SQLite file per EDT at `XDG_DATA_HOME/tui-back/edts/<ulid>.db` (ULID filename, topic lives inside the file) (AD-7). Adds `XDG_CONFIG_HOME/tui-back/settings.yaml`, a new zod-validated `SettingsPort`/`adapters/driven/settings`.
- All git writes pass through the centralized `adapters/driven/git`, which resolves the allowed branch itself at write time and never trusts a caller-supplied branch (AD-8). `GitPort` grows `listBranches`, `renameBranch`, `isBranchMerged`, `deleteBranch`, all gated the same way.
- `core/edt/modify.ts`'s add-member step must always receive an explicit target branch; it never falls back to the repo's current checked-out branch (a `branch-required` error surfaces instead).
- Partial-failure results (switch/create/modify/add-to-edt/delete) render as a structured per-repo list with an extensible `resolveAssistedAction(code)` registry (one entry shipped: `branch-already-claimed`).
- Two shared components originate here but end up used app-wide: `TextInputLine` (visible cursor, later gains Left/Right/Home/End, adopted by the command bar and registry screen) and `BranchPicker` (pick existing / create new / rename current).
- The EDTs zone becomes the app's first multi-splitter zone (EDT selector / EDT SERVICES / OTHER SERVICES + detail, `Ctrl+W` resize-mode); ratios persist per zone in `state.json`.
- Active-EDT state stays synced via `state.json` + `fs.watch`, so a CLI-driven change reaches an open TUI without restart (AD-10).

## UX & Interaction Patterns

- EDT selector rows use an `emphasized` (accent+bold) treatment for whichever row drives the EDT SERVICES/OTHER SERVICES split, decoupled from a separate discreet `" active"` suffix marking the tool-wide active EDT.
- Categorized service lists and detail-pane hints render inside the shared bounded/scrollable list window (also used by the Logs zone).
- Per-service contextual actions (`Enter`) open a menu: member rows get Remove/Change-branch (Restart shown disabled, "Available with Epic 5"); non-member rows get Add-to-EDT.
- The `:` command bar registers `edt-create`/`edt-switch`/`edt-modify`/`edt-delete`/`edt-create-from`; run with no argument, the switch/modify/create-from commands open a filterable quick-pick over EDT topics.
- Every EDT action logs to a per-EDT history (timestamp, type, outcome, detail) surfaced in the detail pane, filterable via the settings screen.
- Delete confirmation lists every member with branch, merge status, and uncommitted-work status, each independently toggleable between leave/delete.
- A severity-colored summary plus `[i] details` dialog explains unreachable/errored services, pointing at the registry's "clean stale entries" action.

## Cross-Story Dependencies

- Story 2.3 (git safety gate) underlies every branch-mutating story: 2.2, 2.4, 2.5, 2.22, 2.24, 2.26, 2.29.
- Story 2.6 (divergence visibility) feeds the EDTs zone's service list (2.9, 2.18) and Story 2.34's issue counts.
- Story 2.23 (`TextInputLine`) is a prerequisite for 2.22, 2.24, 2.26; Story 2.32 later generalizes it app-wide.
- Story 2.25's structured failure list/registry is reused by 2.24, 2.26, 2.28, 2.33, 2.34.
- Story 2.26 (`BranchPicker`) is extended by 2.27 (EDT creation, also depends on 2.23) and 2.31 (create-from, also depends on 2.30).
- Story 2.14 (command bar) is a prerequisite for every later `:`-registered EDT command (2.15, 2.19, 2.29, 2.30, 2.31).
- Story 2.18's multi-splitter concept is completed by 2.21.
- Epics 3–5 depend on this epic's git safety gate (AD-8) and assisted-resolution mechanic; Story 2.18's deferred "Restart" action depends on Epic 5's Docker integration (Story 5.3).
