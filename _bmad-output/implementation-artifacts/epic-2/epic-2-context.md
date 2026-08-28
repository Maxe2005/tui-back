# Epic 2 Context: EDT Workspace Management

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A developer can create, modify, and safely switch between EDTs — persistent, topic-named workspaces grouping a manually-chosen set of member services and each member's own working branch — without ever losing uncommitted work, with branch/divergence visibility across every managed repo and the guarantee that non-member repos always stay on `development`. This epic also carries the TUI shell forward from Epic 1's placeholders into a real, fully keyboard-navigable EDTs zone, plus several cross-cutting shell additions (zone arrow navigation, manifest-gated tabs, the `:` command bar and grid, a settings screen, multi-splitter resize) that landed here because Epic 2's branch stayed open while they were found, even though some affected code is nominally Epic 1 territory.

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

## Requirements & Constraints

- Creating an EDT requires a topic unique among existing EDTs and at least one manually-selected member service; a service may belong to several EDTs at once, each tracking its own branch for it independently.
- Branch creation at EDT-creation is optional: a chosen base branch (default `development`) plus grouped (one shared name) or individual naming; per-service branch-creation failures are reported individually and never abort the others.
- Post-creation, members can be added/removed and a member's branch changed without disturbing other members; an EDT may end at zero members and must display validly, never as an error. Topic rename follows the same uniqueness rule as creation, with no file rename needed (filename is a ULID).
- A shared/protected branch (`development`, preprod, prod) can never be registered as an EDT's own branch — rejected with a clear explanation before any git write, both at creation and later.
- Switching the active EDT must never lose uncommitted work anywhere affected. After a switch: exactly one EDT is active, every member sits on its own registered branch, every non-member managed service sits on `development` (or its shared branch) — evaluated purely against the new EDT's membership, independent of that service's membership elsewhere. An in-progress locked action on the outgoing EDT blocks the switch by default with a stop-and-proceed prompt; returning to an interrupted EDT offers to re-run it.
- Every managed service (member or not) shows branch + ahead/behind divergence; "no upstream" and "unknown (offline)" are explicit distinct states, never numeric/stale placeholders.
- Blast-radius isolation: a bug/crash in one EDT's SQLite file must never affect another EDT or the global store.
- List navigation is exclusively arrows/Home/End (no `j`/`k`/`g`/`G`); `Tab` cycles focus among fields/panes/boundaries only, never list movement.

## Technical Decisions

- **Storage:** one SQLite file per EDT at `XDG_DATA_HOME/tui-back/edts/<ulid>.db` (filename is the ULID, never the topic); schema evolves via hand-rolled numbered `.sql` files with a `schema_version` table. Active-EDT pointer and persisted UI state (incl. per-zone splitter ratios) live in `XDG_STATE_HOME/tui-back/state.json`, the durable authoritative record. Adds `XDG_CONFIG_HOME/tui-back/settings.yaml`, a zod-validated per-user preferences file, additive and independent of registry/EDT/global stores; corrupt/invalid settings fall back to defaults with a non-blocking warning (manifest-validation convention).
- **Git safety gate:** every write passes through `adapters/driven/git`, which resolves the allowed-branch context itself from EDT/manifest state at write time and rejects (pre-invocation) any write outside the current EDT's own registered branch for that service — never trusts a caller-supplied branch name.
- **Locking:** single-TUI enforcement is scoped to the interactive TUI's launch path only (never blocks a CLI subcommand); independently, any state-mutating use-case acquires a short-lived advisory lock on the EDT id/repo path(s) it touches. A stale (dead-pid) TUI lock auto-reclaims silently; a live-pid conflict in an interactive terminal offers kill-and-take-over, never in a non-TTY context.
- **State ownership:** one Zustand store holds cross-zone state (active EDT, per-service status, in-flight runs); zone-local UI state stays component-local. The store's `activeEdt` is a hydrated cache of `state.json`, re-synced via `fs.watch`/poll so a concurrent CLI-made change is picked up live.
- Manifest-gated tab visibility requires loading manifests for all registered repos (not just active-EDT members) at shell level.
- The `:` command bar is a small in-memory, statically-defined registry (name → handler) in `adapters/driving/tui`, no core/port change; autocomplete/grid logic is pure and unit-testable without mounting Ink.
- EDT action history persists per-EDT in its own SQLite (`action_log` table), via `EdtRegistryPort` extensions (`logAction`/`getActionLog`).

## UX & Interaction Patterns

- EDTs zone states: empty (explicit create-first prompt), populated list with branch+divergence, duplicate-topic and zero-member-at-creation rejection, per-service branch-creation failure reporting, shared-branch rejection before any write, member added/removed without disturbing others, zero-member EDT shown valid, protected-switch rule on branch change, protected-switch-blocked-during-update prompt, interrupted-update recovery offer.
- The services pane splits into "EDT SERVICES" (members of the *selected*, not necessarily active, EDT) and "OTHER SERVICES"; `Tab` cycles three-way focus (selector → EDT SERVICES → OTHER SERVICES). Per-service actions (remove/change-branch on a member, add-to-EDT on a non-member) open via `Enter`.
- Row emphasis: the row driving the current EDT/OTHER split renders accent+bold (`emphasized`); the tool-wide active EDT instead renders a discreet dim `" active"` suffix — independent, can coincide or differ.
- The detail pane's position/width is fixed, derived once from the split ratio; its "available actions" hint always mirrors exactly what `Enter` will do in context.
- The EDT zone is the first "multi-splitter zone": 3 internal boundaries plus the list/detail split, keyboard-resizable via `Ctrl+W` (`Tab` cycles targeted boundary, arrows resize, `Enter`/`Esc` exit), ratios persisted per zone across sessions.
- `Left`/`Right` (no focus mode) switch the active zone directly, wrapping, skipping omitted tabs, landing on disabled ones; inert under any overlay/dialog or resize-mode.
- The settings screen (`:settings`) is a tabbed modal ("General"/"EDTs"/"Command Palette"); the EDTs tab holds two drill-down groups ("Hint visibility", "Recent action types") navigated into a `checkbox-list-item` list, `Esc` stepping back one level before closing the screen.

## Cross-Story Dependencies

- Stories 2.7–2.21 build on `done` Epic 1 groundwork: the navigation stub (1.13), single-instance lock (1.7), Atelier components (1.9/1.10), permanent shell (1.11), scan/register use-cases (1.5) — several amend that story text in place rather than reopening it.
- 2.2 (branch creation) and 2.4/2.5 (switch/modify) all depend on 2.3's safety gate and 1.7's per-resource lock.
- 2.9 (EDTs zone) is the first TUI consumer of 2.1–2.6's core use-cases and 2.7's navigation contract.
- 2.11's `:`-binding is superseded by 2.14 (command bar), which 2.17 then extends with autocomplete/grid — incremental work on one surface.
- 2.15 (EDT commands + action history) builds on 2.9's dialog state machines and is extended by 2.18 (categorized services/actions, logging through 2.15) and 2.19 (settings-driven filtering of 2.15/2.18's output).
- 2.18's original "active" `list-row` treatment is superseded by 2.21's `emphasized`/`active` split; 2.18's layout is what 2.21 turns into a multi-splitter layout.
- 2.19 introduces the first new port (`SettingsPort`); 2.17's grid-row constant and 2.18's hint list both become settings-backed by it.
- The "Restart" action stubbed disabled in 2.18 depends on Docker integration not yet built (Epic 5's Story 5.3, partially Epic 3's Story 3.1) — out of scope here.
- Epic 3 and Epic 4 both reuse this epic's git safety gate and EDT membership model directly.
