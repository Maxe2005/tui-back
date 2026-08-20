# Epic 2 Context: EDT Workspace Management

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A developer can create, modify, and safely switch between EDTs (isolated per-topic workspaces spanning a manually chosen set of member services) without ever losing uncommitted work, with branch and upstream-divergence visibility across every managed repo — member or not — and a hard guarantee that a shared/protected branch (`development`, preprod, prod) can never become an EDT's "own" branch, and that non-member repos stay parked on `development`. This is the foundation every later epic (group update, shared-types propagation, logs, routes) scopes its actions against.

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

## Requirements & Constraints

- A developer creates an EDT with a unique topic and at least one manually selected member service; duplicate topics and zero-member creation are both rejected before anything is written.
- Optionally, working branches are created per member at EDT-creation time, based on a chosen base branch (default `development`), named either identically across all selected services (grouped) or individually per service; a single service's branch-creation failure (missing base, name collision) is reported without aborting the rest of the batch.
- After creation, member services can be added/removed (including down to zero, which is a valid, non-error state) and a member's branch can be changed or the topic renamed, each independently, without disturbing other members' recorded state.
- Assigning a shared/protected branch (`development`, preprod, prod) as any EDT's own branch for a service is always rejected, with a clear explanation, before any git write — at creation, at branch change, and at any other write path.
- Switching the active EDT never loses uncommitted work: it is auto-preserved in every affected repo of the outgoing EDT before the switch. After a switch, every member sits on its EDT-registered branch and every non-member managed repo sits on `development` (or its manifest-configured shared branch), regardless of that repo's membership in some other, inactive EDT. A non-member repo missing `development` locally is fetched first.
- Every managed service (member or not) shows its current branch and ahead/behind divergence from upstream; no upstream shows an explicit "no upstream" state, and being offline shows an explicit "unknown (offline)" state — never a stale or zero value standing in for missing data.
- Blast-radius isolation: a crash or bug touching one EDT's data must never affect another EDT's data.

## Technical Decisions

- **Storage:** one SQLite file per EDT at `XDG_DATA_HOME/tui-back/edts/<ulid>.db` — filename is a generated ULID, never the topic (topic lives as a field inside the file; uniqueness is checked across existing files). This is also why renaming a topic needs no file rename/migration. Active-EDT pointer and other transient UI state (last-used EDT, per-zone splitter sizes) live in `XDG_STATE_HOME/tui-back/state.json`, never inside a `.db`. Each `.db` evolves via hand-rolled numbered `.sql` files tracked by a `schema_version` table.
- **Git safety gate:** every git write goes through `adapters/driven/git`, which resolves the allowed-branch context itself (current EDT/manifest state via `EdtStorePort`/`ManifestPort`) and rejects — before invoking `git` at all — any write targeting a shared branch or a branch that isn't the current EDT's own registered branch for that service. It never trusts a caller-supplied branch name. No commit/push happens without explicit developer approval at the moment of the action; a branch switch always auto-preserves uncommitted work first and re-verifies the resulting state rather than assuming success.
- **Locking:** two independent mechanisms — the interactive TUI refuses to start a second instance (TUI-only, never blocks a hand-run CLI subcommand); separately, any state-mutating use-case acquires a short-lived advisory lock scoped to the specific EDT id / repo path(s) it touches before writing, releasing it after, so concurrent writers to the same resource are serialized/rejected rather than racing.
- **Cross-zone state:** lives in exactly one Zustand store; zone-local UI state (list cursor, scroll position) stays component-local. The store's `activeEdt` field is a hydrated cache of `state.json` (the durable, authoritative record), re-synced via `fs.watch`/poll so a CLI-made change is picked up live while the TUI is open — never silently stale.
- **CLI/TUI parity (relevant to Story 2.9):** the TUI must call `core/edt/create.ts` / `switch.ts` / `modify.ts` in-process — the same core use-cases the CLI subcommands wrap — never by shelling out to the CLI. This parity gap (EDT mutation flows landing CLI-only while the read-only view was wired into the TUI) is exactly what Story 2.9 closes.
- **Conventions carried through this epic:** generated EDT ids are ULIDs; dates/times ISO 8601; any per-service outcome (e.g. batch branch creation) reports via a `data.results: {service, outcome, detail?}[]` shape with `outcome` from a shared closed set; error codes are kebab-case strings.
- **`edts/` zone maps 1:1 to `core/edt`** per the TUI's zone-to-capability-boundary convention; shared visual primitives (list/detail split, modal-dialog, footer-hint, checkbox-list-item) live in `tui/shared/`, never duplicated per zone.

## UX & Interaction Patterns

- **Canonical keybinding contract for list navigation is arrows + Home/End** (superseding the originally planned vim-style `j`/`k`/`g`/`G`, retired as impractical per the 2026-08-19 sprint change proposal). `Home`/`End` jump to top/bottom of the focused list and never switch zones. `Tab` keeps its pre-existing role — cycling list/detail panes or splitter boundaries — and is never repurposed as a list-movement key. After Story 2.7, `j`/`k`/`g`/`G` trigger nothing anywhere in the app. Story 2.9's new create/switch/modify flows must be built directly against this contract, not the retired one.
- **Fullscreen rendering (Story 2.8):** on launch in a TTY the app takes over the terminal via the alternate-screen buffer, sized to current rows/columns; a terminal resize re-renders without artifacts; on quit/Ctrl+C/crash the original screen content is restored with no leftover TUI output. This underlies every zone's chrome, EDTs zone included.
- **EDTs zone states:** empty (explicit "create the first EDT" prompt, never a bare empty list); populated (service list with branch + ahead/behind divergence, uniformly shown whether the service is a member or not); duplicate-topic and zero-member-at-creation rejections; per-service branch-creation failure reported without blocking the batch; shared-branch rejection explained before any git write; member add/remove without disturbing other members; zero-member EDT shown as valid, not an error; protected-switch rule on member branch change; switch-blocked-during-update prompt with an offer to stop the run; interrupted-update recovery offer on return.
- EDT member selection at creation, and any later multi-select action, uses the `checkbox-list-item` pattern (`Space` toggles, `Enter` confirms the whole selection).
- **Open composition question for Story 2.9 (flagged, not resolved by planning):** Story 2.6 already shipped a flat list of every managed service (member or not) as the EDTs zone's list pane. The originally-envisioned "populated" state described a list grouped by EDT with members nested underneath. The sprint change proposal's suggested resolution — not finalized — is to keep 2.6's flat list as the default view and layer an EDT selector (create/switch/modify) above it that groups/filters the same list, rather than replacing it with a separate view. Resolve the exact composition at implementation time.

## Cross-Story Dependencies

- Story 2.2 (branch creation) builds directly on 2.1 (EDT creation) and is gated by 2.3's shared-branch rejection.
- Story 2.3's git branch-scope gate is a shared foundation used by 2.2 (creation-time branch naming), 2.4 (protected-switch), and 2.5 (branch changes) — implement it before or alongside the flows that depend on it.
- Story 2.4 depends on Epic 1's per-resource action lock (Story 1.7) for its switch-blocked-during-update behavior.
- Story 2.5's branch-change flow explicitly reuses Story 2.4's protected-switch mechanic.
- Story 2.6's divergence display applies uniformly to every managed service produced by 2.1/2.4/2.5, member or not.
- Sequencing per the sprint change proposal: **2.7 before 2.9** (2.9's new forms must target the finalized nav contract, not the retired one); **2.8 is independent** and can run in parallel with either. 2.9 also depends on 2.1/2.4/2.5's core use-cases already existing (it wires them into the TUI, adding no new core logic) and on 2.6's list as the surface it extends.
- This epic's git-safety gate (AD-8) and per-EDT storage (AD-7) are reused as-is by Epic 3's group update. Epic 2 must fully merge into `devlopment` before Epic 3 starts, per the sprint change proposal's sequencing.
