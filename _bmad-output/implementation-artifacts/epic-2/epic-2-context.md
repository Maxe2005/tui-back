# Epic 2 Context: EDT Workspace Management

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A developer can create, modify, and safely switch between EDTs — isolated workspaces that scope a set of member services to a coding session — with no uncommitted work ever lost, full branch/divergence visibility across every managed repo, and the guarantee that non-member repos always stay on `development`. Because this epic's branch stayed open longest, later sprint-change proposals appended a large amount of adjacent TUI-shell work here even though some of it sits in Epic 1's territory: fullscreen rendering, arrow-key zone navigation, manifest-gated tab visibility, the real `:` command bar with shell-style autocomplete and a grid browser, a persisted settings screen, top-bar/footer accuracy fixes, and a keyboard-driven multi-splitter layout for the EDT zone itself.

## Stories

- Story 2.1: Create an EDT (topic + manually selected member services)
- Story 2.2: Create dev branches at EDT creation (grouped/individual naming)
- Story 2.3: Git branch-scope safety gate & shared-branch rejection
- Story 2.4: Switch the active EDT without data loss
- Story 2.5: Modify an EDT after creation (members, branch, topic rename)
- Story 2.6: Branch and divergence visibility (all managed services)
- Story 2.7: Canonical navigation contract (arrows/Home/End/Tab; retires j/k/g/G)
- Story 2.8: Fullscreen TUI rendering (alternate-screen buffer)
- Story 2.9: EDTs zone — create, switch, and modify from the TUI
- Story 2.10: Recover from an already-running TUI instance (stale-lock reclaim, live-lock kill prompt)
- Story 2.11: Repo registry screen & manifest onboarding guidance
- Story 2.12: Zone arrow navigation (Left/Right switches zones directly)
- Story 2.13: Manifest-gated zone tab visibility & disabled state (Routes & shared-types)
- Story 2.14: Command entry bar (`:`) & registered commands
- Story 2.15: EDT commands in command bar & action history in detail pane
- Story 2.16: Permanent Dashboard banner (no longer first-visit-only)
- Story 2.17: Terminal-style command bar autocomplete & grid browser
- Story 2.18: EDT zone — active highlight, fixed-width detail pane, categorized services & per-service actions
- Story 2.19: Global settings screen (`:settings`)
- Story 2.20: Top bar & footer hint accuracy fixes
- Story 2.21: EDT zone — multi-splitter layout with keyboard resize-mode (`Ctrl+W`)

## Requirements & Constraints

Covers FR-3 through FR-9: create an EDT from a manual member-service selection; optionally create per-service working branches at creation (grouped or individually named, base branch defaults to `development`); add/remove members and change a member's branch after creation; switch the active EDT at any time with uncommitted work auto-preserved in every affected repo; reject assigning any shared/protected branch (`development`, preprod, prod) as an EDT's own branch; keep every non-member managed repo on `development` while an EDT is active; show every managed service's current branch and ahead/behind divergence (with explicit "no upstream" and "unknown (offline)" states, never a stale/zero value).

Non-functional: a bug or crash affecting one EDT's SQLite file must never affect another EDT's data (blast-radius isolation) — the one deliberate exception is the narrow global store. Single-TUI enforcement and a per-EDT/repo advisory action lock guard concurrent writers (extended by Story 2.10 to distinguish a stale dead-pid lock, auto-reclaimed silently, from a live-pid lock, which prompts to kill-and-take-over only in an interactive TTY). Zero-member EDTs are always a valid display state, never an error. All new UI surfaces stay keyboard-reachable end-to-end (mouse-optional).

## Technical Decisions

- **Storage:** one SQLite file per EDT at `XDG_DATA_HOME/tui-back/edts/<ulid>.db` — filename is a generated ULID, never the topic (topic uniqueness is checked across existing files' contents). A per-EDT `action_log` table (id, timestamp, action_type, outcome, detail_json) backs Story 2.15's action history. Story 2.19 adds a new, independent store — `XDG_CONFIG_HOME/tui-back/settings.yaml`, zod-validated like the manifest, corrupt/invalid falls back to defaults with a non-blocking warning — the first new port (`SettingsPort`) this epic introduces.
- **Git safety:** every git write passes through the centralized git-adapter, which resolves the allowed-branch context itself from EDT/manifest state at write time (never trusts a caller-supplied branch name) and rejects any write to a shared/protected branch or a branch that isn't the current EDT's own registered branch for that service — this gate is what Story 2.3 hardens and every later branch-mutating flow (2.2, 2.5, 2.18's per-service actions) reuses unchanged.
- **State sync:** the Zustand store's `activeEdt` field is a hydrated cache of `state.json` (the durable record), re-synced via `fs.watch`/poll so a CLI-made change is picked up live while the TUI is open; `state.json` also carries per-zone splitter ratios (Story 2.21 widens this from one ratio per zone to a multi-boundary shape, EDT zone needing 3).
- **UI-state ownership:** cross-zone state lives in the one Zustand store; zone-local UI state (list cursor, dialog open/closed, pane focus) stays component-local. Command registry (Story 2.14/2.17) and the settings-tab list are small in-memory, statically-defined structures in `adapters/driving/tui` — no core/port change for those two stories.
- **Restart is out of scope here:** Story 2.18's per-service "Restart" action is shipped visibly disabled ("Available with Epic 5") — no Docker integration exists yet in this codebase.

## UX & Interaction Patterns

- `list-row` gains two independent, combinable indicators: an `emphasized` prop (accent, bold) driven by whichever row currently drives the EDT SERVICES/OTHER SERVICES category split, and a repurposed `active` prop that renders a discreet `{colors.info}` `" active"` suffix for the tool-wide active EDT — these are decoupled and may land on the same or different rows (superseded from an earlier "active = accent+bold" design).
- The EDT zone's detail pane has a fixed horizontal position/width derived once from the list/detail split ratio, never recomputed from content; it grows downward unbounded (no scroll/truncation needed).
- The services list under a focused/selected EDT splits into "EDT SERVICES" (members of the *selected* EDT, computed client-side) and "OTHER SERVICES"; with no EDT selected, everything falls under "OTHER SERVICES" with an explanatory note. Per-service contextual actions: Enter on an EDT SERVICES row opens Remove/Change-branch/Restart(disabled); Enter on an OTHER SERVICES row opens an "Add to EDT" branch-input flow (pre-filled with that service's current branch).
- `Tab` in the base EDT-list view cycles three panes (EDT selector → EDT SERVICES → OTHER SERVICES → back); the detail pane's "available actions" hint always reflects exactly what `Enter` will do in the currently focused pane/row — never a stale or unwired key.
- Story 2.21 adds fixed-but-movable borders between all three list-side panes plus the list/detail split (3 boundaries total in the EDT zone). `Ctrl+W` engages keyboard resize-mode (targeted boundary recolors to accent; global shortcuts on the same keys go inert while active); `Tab` advances the targeted boundary; arrow keys move it; `Enter`/`Esc` exit. Ratios persist per zone in `state.json` across sessions. Mouse-drag resize stays out of scope (no Ink mouse support).
- `Left`/`Right` (no focus-mode, always available outside overlays/dialogs) switch the active zone directly, wrapping at the ends, skipping fully-omitted tabs and landing on disabled ones; zone mnemonics (`d/e/u/l/r/s`) are unaffected.
- The `:` command bar shows nothing until asked: `Tab` on empty input shows the full grid; on non-empty input it completes to a single match or to the longest shared prefix, requiring a second `Tab` within ~500ms to reveal the grid when several commands still tie at that prefix. The grid is a column-major, arrow-navigable browser with horizontal scroll and `…` truncation when it exceeds the modal width.
- The settings screen (`:settings`) is a tab-organized modal (General / EDTs / Command Palette for this epic); every change applies and persists immediately, no separate save step; an empty tab renders validly, not as an error.

## Cross-Story Dependencies

Stories 2.1–2.6 are the core EDT lifecycle/data layer that 2.9 (TUI EDTs zone) wires into the shell; 2.7 (navigation contract) and 2.8 (fullscreen rendering) are shell-level prerequisites reused by every later story in this epic. 2.9 → 2.15 (adds command-bar EDT commands + action history) → 2.18 (categorized services + per-service actions, reusing 2.15's action log and 2.9's dialog state machines) → 2.21 (adds resizable borders around 2.18's three panes) form one direct chain. 2.11 (registry screen) and 2.14 (command bar mechanism) are prerequisites for each other's final shape — 2.11 is the command bar's first registered command, and 2.14 later corrects 2.11's original `:`-binding mistake. 2.17 (command-bar grid) supplies the `COMMAND_GRID_MAX_ROWS` default that 2.19 (settings) makes user-overridable; 2.19 also gates which of 2.18's action hints are hidden. 2.13 (manifest-gated tab visibility) and Epic 4's shared-types module both depend on the `shared-types-source`/`shared-types-consumer` manifest ids introduced here. Story 2.18's "Restart" action is a visible placeholder for Epic 5 (Docker integration, not yet built).
