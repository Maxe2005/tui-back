# Epic 2 Context: EDT Workspace Management

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Give the developer persistent, protected workspaces ("EDTs"): create an EDT with a topic and manually selected member services, optionally create dev branches for them, modify membership and branches after creation, and safely switch the active EDT at any time — auto-preserving uncommitted work in every affected repo and keeping every non-member managed repo on `development`. Along the way, surface branch and divergence visibility for every managed service so the developer never runs `git status` by hand. This is the "no data loss on switch" and "no stray-branch drift" safety core of the tool; it realizes PRD feature 4.2 (FR-3 through FR-9).

## Stories

- Story 2.1: Create an EDT
- Story 2.2: Create Dev Branches at EDT Creation
- Story 2.3: Git Branch-Scope Safety Gate & Shared-Branch Rejection
- Story 2.4: Switch the Active EDT Without Data Loss
- Story 2.5: Modify an EDT After Creation
- Story 2.6: Branch and Divergence Visibility

## Requirements & Constraints

- Create an EDT from a unique topic plus a manual member-service selection drawn from managed repos; at least one member is required at creation, and the topic must be unique among existing EDTs — both rejected with clear messages before any write.
- An EDT persists across restarts. A service may be a member of several EDTs at once; each EDT tracks its own working branch for that service independently — a deliberate feature, not an edge case.
- Branch creation at EDT-creation time is optional and all-or-nothing per action: one base-branch choice (default `development`) and one naming mode (grouped — identical name in every service, or individual — one name per service). A per-service failure is reported per service and must not abort the others. Branches created this way become the service's registered branch for the EDT.
- Modify after creation: add/remove members without disturbing others' recorded state; remove the last member is allowed (zero-member EDT is valid, displayed as "no members", never an error); change a member's branch under the same no-data-loss protected-switch rule; rename the topic under the same uniqueness rule as creation.
- Switching the active EDT: auto-preserve uncommitted work in every affected repo before switching (checked, never assumed); after the switch exactly one EDT is active, each member service is on that EDT's own registered branch, and every non-member managed service is on `development` (or its configured shared branch) — fetched first if not present locally. Non-member repos' uncommitted work is preserved too. The switch is blocked by default while an action on the outgoing EDT is in progress (prompt to stop); returning to an interrupted EDT shows it was interrupted and offers to re-run.
- `development`, preprod, and prod are read-only to the tool. Registering any shared branch as an EDT's own branch is rejected with a clear explanation before any git write — at creation and at later branch changes.
- Every managed service, EDT member or not, shows its current branch and ahead/behind divergence against its origin/upstream; a service with no upstream shows an explicit "no upstream" state and an offline check shows "unknown (offline)" — never a stale numeric value.
- Blast-radius isolation: a crash or bug in one EDT's state must never corrupt another EDT's state or another service's data.

## Technical Decisions

- One SQLite file per EDT at `XDG_DATA_HOME/tui-back/edts/<ulid>.db` — the filename is a generated ULID, never the topic (the topic is a field inside the file); schemas evolve via hand-rolled numbered `.sql` files tracked by a `schema_version` table. The active-EDT pointer and transient UI state live at `XDG_STATE_HOME/tui-back/state.json`, never inside a `.db`.
- Every git write passes through `adapters/driven/git`, which rejects — before any `git` invocation — a write targeting `development`/preprod/prod or any branch that isn't the current EDT's own registered branch for that service. The adapter resolves the allowed-branch context itself at write time from EDT/manifest state; it never trusts a caller-supplied branch name.
- State-mutating EDT use-cases acquire a short-lived advisory lock scoped to the EDT id / repo paths they touch, so concurrent CLI/TUI writers serialize or reject instead of racing.
- Hexagonal placement: EDT lifecycle lives in `core/edt` against `core/ports` (`EdtStorePort`, `GitPort`, `RegistryPort`, `ManifestPort`); `adapters/driven/persistence` and `adapters/driven/git` implement them; the EDTs zone (`adapters/driving/tui/edts/`) and CLI subcommands both invoke the same core use-cases — the TUI calls them in-process and never shells out to the CLI.
- The Zustand store's `activeEdt` field is a hydrated cache of `state.json`, loaded at startup and re-synced via `fs.watch`/poll so a CLI-made active-EDT change is picked up while the TUI is open.
- Conventions: kebab-case files, `PascalCase` types, `camelCase` functions; EDT ids are ULIDs, dates ISO 8601, error codes kebab-case; results flow through the `{ok,data}`/`{ok,error}` envelope.

## UX & Interaction Patterns

- EDTs zone states: explicit "create the first EDT" prompt when none exist (never a bare empty list); populated list of EDTs with per-service branch + divergence; duplicate-topic and zero-member-at-creation rejections surfaced before anything happens; per-service branch-creation failures reported without aborting the rest; shared-branch rejection explained before any git write; member add/remove without disturbing others; zero-member EDT as a valid "no members" state; member branch changes under the protected-switch rule; switch blocked during an in-progress run with a stop-or-cancel prompt; interrupted runs offered for re-run on return.
- Member selection uses the checkbox-list-item pattern (`Space` toggles, `Enter` confirms the whole selection); confirmations and guided menus use modal-dialog (`Esc` cancels, `Enter` confirms regardless of trigger method); the zone renders in the standard resizable list/detail split with list-row/detail-pane and splitter; `j`/`k`/`g`/`G` navigate, footer-hint always reflects live context keybindings.
- Outcome messages follow the two-layer voice: a dry, factual primary line sufficient on its own (e.g. `✔ EDT créé: JIRA-1532-refund-flow (2 membres)`) with an optional dim-annotation wink below it — never folded into the primary line, never required.
- Glyphs pair with colors (status-badge); accent is reserved for selection/primary action, never a status.

## Cross-Story Dependencies

- Builds on Epic 1: hexagonal skeleton, XDG layout, output envelope, manifest schema/loader, explicit repo registry (the managed-repo set that member selection draws from), single-instance/per-resource locking, Atelier components, keybinding contract, and the six-zone shell.
- Story 2.2's created branches feed Story 2.6 via the registered-branch record; Story 2.3's safety gate is the same gate Epic 3's group update (and later propagation) will rely on.
- Story 2.4's protected-switch and interrupted-run mechanics set the precedent Epic 3's and Epic 4's quit-mid-run/resume behavior follows.
- Active-EDT state built here is consumed by every later epic: Epic 3 (EDT-scoped group update), Epic 4 (propagation status for active-EDT members), Epic 5 (aggregated logs for the active EDT).
