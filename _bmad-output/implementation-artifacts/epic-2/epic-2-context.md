# Epic 2 Context: EDT Workspace Management

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A developer can create, modify, and safely switch between EDTs (isolated workspaces scoping a set of member services to a coding session) with no uncommitted work ever lost, full branch/divergence visibility across every managed repo, and the guarantee that non-member repos always stay on `development`. The epic also carries the TUI shell forward: fullscreen rendering, arrow-key zone navigation, manifest-gated tab visibility, a real `:` command bar with autocomplete/grid browsing, a global settings screen, and several accuracy/UX fixes to already-`done` Epic 1 surfaces — all appended here because this epic's branch stayed open while those needs surfaced.

## Stories

- Story 2.1: Create an EDT
- Story 2.2: Create dev branches at EDT creation
- Story 2.3: Git branch-scope safety gate & shared-branch rejection
- Story 2.4: Switch the active EDT without data loss
- Story 2.5: Modify an EDT after creation (members, branch, topic rename)
- Story 2.6: Branch and divergence visibility
- Story 2.7: Canonical navigation contract (arrows/Home/End/Tab, retires j/k/g/G)
- Story 2.8: Fullscreen TUI rendering (alternate-screen buffer)
- Story 2.9: EDTs zone — create, switch, and modify
- Story 2.10: Recover from an already-running TUI instance (stale-lock reclaim, live-lock kill prompt)
- Story 2.11: Repo registry screen & manifest onboarding guidance
- Story 2.12: Zone arrow navigation (Left/Right direct zone switch)
- Story 2.13: Manifest-gated zone tab visibility & disabled state (Routes & shared-types)
- Story 2.14: Command entry bar (`:`) & registered commands
- Story 2.15: EDT commands in command bar & action history in detail pane
- Story 2.16: Permanent Dashboard banner (reverses "shown once")
- Story 2.17: Terminal-style command bar autocomplete & grid browser
- Story 2.18: EDT zone — active highlight, fixed-width detail pane, categorized services & per-service actions
- Story 2.19: Global settings screen (`:settings`)
- Story 2.20: Top bar & footer hint accuracy fixes (EDT name not ULID; `[←→] zone` hint)

## Requirements & Constraints

- A developer creates an EDT with a topic (globally unique among EDTs) and at least one manually selected member service; zero-member creation is rejected, but an existing EDT can later be reduced to zero members and must display that state as valid, never an error.
- At creation, branch creation per member is optional: a chosen base branch (default `development`) and either one shared branch name across all members or an individually-named one per service; a per-service branch-creation failure is reported per service and never aborts the others.
- Assigning a shared/protected branch (`development`, preprod, prod) as an EDT's own branch for a service is categorically rejected, with a clear explanation, before any git write — both at creation and at any later branch change.
- Switching the active EDT must never lose uncommitted work: it is auto-preserved in every affected repo (outgoing EDT members and any non-member repo also dirty) before the switch. After a switch, every member sits on that EDT's own branch and every non-member managed repo sits on `development` (or its configured shared branch), fetching it first if not present locally.
- An in-progress locked action in the outgoing EDT blocks the switch by default with a prompt to stop it; on later return, the EDT shows the run as interrupted and offers to re-run it.
- After creation, a developer can add/remove members (without disturbing others), change a member's branch (subject to the same protected-branch rejection and no-data-loss rule), and rename the topic (subject to the same uniqueness rule as creation) — the SQLite filename stays the ULID, so renaming never triggers a file rename/migration.
- Every managed service — EDT member or not — displays its branch and ahead/behind divergence; no configured upstream shows an explicit "no upstream" state, and offline shows an explicit "unknown (offline)" state — never a stale or zero value.
- List navigation is arrows/Home/End only; `j`/`k`/`g`/`G` do nothing anywhere. `Tab` keeps its pre-existing field/boundary-cycling role, never repurposed as list movement.
- The TUI renders fullscreen via the terminal's alternate-screen buffer, re-fitting cleanly on resize and restoring the original terminal content on quit (`q`, Ctrl+C, or crash) — no leftover output.
- A second TUI launch: a dead-pid lock is silently reclaimed (no prompt); a live-pid lock in an interactive TTY prompts to kill-and-take-over (declining leaves today's refuse-and-exit-1 behavior unchanged, permission failure is reported and nothing is deleted); a non-TTY invocation never prompts. CLI subcommands are never affected by TUI single-instance locking.
- Routes/shared-types zone tabs: fully omitted only when zero repos anywhere in the registry ever activate the relevant module; shown disabled (dimmed/strikethrough) when the module exists in the registry but no active-EDT member carries it, landing on an explanatory message naming which registered repos do carry it. Fully-omitted tabs are skipped by mnemonic/arrow navigation; disabled tabs are reachable. A registry or active-EDT-membership change updates tab state live; if the active zone's tab disappears entirely, the app falls back to Dashboard.
- The `:` command bar is a generic, extensible, statically-registered command dispatcher (never a single hardcoded action bound to `:` itself) — opens with an empty input and shows nothing until `Tab` is pressed; exact-match `Enter` runs and closes, an unmatched `Enter` shows an inline "unknown command" message, `Esc` cancels discarding input, and it never stacks on another open overlay.
- Command bar Tab-completion mirrors shell semantics: single match completes fully; multiple matches sharing a longer common prefix complete to that prefix; a second `Tab` within a short window (default 500ms) at an already-maximal prefix reveals a column-major, arrow-navigable command grid (max rows per column configurable), with `…` truncation and horizontal scroll when the grid exceeds display width.
- A settings screen, reachable only via a registered `:` command (never a raw keypress, mirroring the registry-screen precedent), is tab-organized (General plus one tab per configurable feature area), applies every change immediately with no separate save step, and renders a zero-setting tab validly rather than as an error. A corrupt/invalid settings file falls back to defaults with a non-blocking warning rather than crashing.
- Any use-case reporting a per-service outcome (branch creation batch, etc.) uses the shared closed outcome set (`"updated"`/`"skipped"`/`"failed"` or equivalent) — no service silently absent from a summary.
- Blast-radius isolation: a bug/crash affecting one EDT's SQLite file must never affect another EDT's data or the narrowly-scoped global store.

## Technical Decisions

- **Storage topology (AD-7):** one SQLite file per EDT at `XDG_DATA_HOME/tui-back/edts/<ulid>.db` — filename is a generated ULID, never the topic (topic is a field inside the file; uniqueness checks read across existing files). Active-EDT pointer and transient UI state (splitter sizes, scroll positions) live at `XDG_STATE_HOME/tui-back/state.json`, never inside a `.db`. Each `.db`'s schema evolves through hand-rolled numbered `.sql` files tracked by a `schema_version` table — no external migration framework. Per Story 2.19, `XDG_CONFIG_HOME/tui-back/settings.yaml` (zod-validated, same convention as the manifest) is an additive new tier for per-user tool preferences, independent of `registry.yaml` and every EDT/global store.
- **Git-adapter branch-scope safety (AD-8):** every git write passes through `adapters/driven/git`, which rejects — before any `git` invocation — a write targeting `development`/preprod/prod or any branch not the current EDT's own registered branch for that service. The adapter resolves the allowed-branch context itself from EDT/manifest state at write time; it never trusts a caller-supplied branch name.
- **Single-TUI + per-resource lock (AD-9):** the interactive TUI's single-instance detection is scoped to the TUI launch path only, never a CLI subcommand. Independently, any state-mutating core use-case acquires a short-lived advisory lock scoped to the specific EDT id / repo path(s) it touches, held for the action's duration.
- **Central store sync (AD-10):** `state.json` is the durable, authoritative record of the active EDT; the Zustand store's `activeEdt` field is a hydrated cache re-synced via `fs.watch`/poll so a CLI-made change is picked up while the TUI is open, never silently stale.
- **Zone-to-capability mapping (AD-15):** `edts/` maps 1:1 to `core/edt`; cross-zone shared components live in `tui/shared/`, never duplicated per zone.
- `EdtRegistryPort` (or equivalent) extends with `logAction`/`getActionLog` for the per-EDT `action_log` table (id, timestamp, action_type, outcome, detail_json) backing Story 2.15's action history.
- New `core/ports/settings.ts` (`SettingsPort`: `load`/`save`, zod schema) plus `adapters/driven/settings` (YAML file, mirrors `adapters/driven/registry`'s shape) — the first new port this epic's later stories require, consumed by the TUI through a `settings` slice in the Zustand store (loaded once at startup, updated optimistically).
- Command registry is a small in-memory, statically-defined list (command name → handler) in `adapters/driving/tui` — no core/port change; adding a command is registry-only.
- `ListRow` gains an `active?: boolean` prop (default false) for the current tool-wide active EDT, independent of and combinable with the existing cursor `selected` state — additive, no visual change to callers that don't pass it.
- Naming/data conventions apply throughout: kebab-case files/dirs, `PascalCase` types/classes, `camelCase` functions/variables; generated entity ids (EDT id) are ULIDs; dates/times ISO 8601.

## UX & Interaction Patterns

- `list-row`: selected state = surface-selected fill + accent bar + `›` marker; nested rows indent by the theme's indent token; trailing metadata renders text-dim. The `active` state (accent-colored, bold label) marks the tool-wide active EDT regardless of cursor position, and composes with `selected`.
- EDTs zone content splits into three independently arrow/Home/End-navigable panes cycled by `Tab` (EDT selector → EDT SERVICES → OTHER SERVICES → back): EDT SERVICES lists services that are members of the currently *selected* EDT (client-side, independent of the active-EDT's own `isMember` divergence-badge computation); OTHER SERVICES lists the rest. No EDT selected → everything falls under OTHER SERVICES with an explanatory note.
- Per-service contextual actions from EDT SERVICES: Remove from EDT, Change branch for this EDT, and a visibly-disabled Restart annotated "Available with Epic 5". From OTHER SERVICES: an "Add to EDT" flow with a branch input pre-filled with the service's current branch, calling `addMembers`+`setBranches` in one `modifyEdt` call.
- The EDT detail pane's horizontal position/width is derived once from the list/detail split ratio and never recomputed from content — it must not shift as the developer browses EDTs or services. Its "available actions" hint always reflects exactly what `Enter` will do in the current focus context (never lists a key not actually wired).
- `checkbox-list-item`: `Space` toggles the highlighted row, `Enter` confirms the whole selection — used for EDT member selection at creation and the repo-registry screen's multi-select.
- `modal-dialog`: bold-border, square corners, floating on surface background; `Escape` always cancels, `Enter` always confirms, regardless of trigger method.
- Command bar visual treatment reuses `modal-dialog` + `list-row`, no new chrome; the command grid renders its own compact colored `<Text>` cells (accent + `›` highlighted, text-dim otherwise) rather than reusing full-width `ListRow`.
- Zone-tab bar: active zone = accent fill + bold background-colored text; every other tab text-dim; disabled tabs dimmed/strikethrough; a background-event glyph+counter badge clears once that zone is visited (never shown on a disabled tab).
- Two-layer outcome-message voice: a dry/factual primary line sufficient alone, with an optional never-required `dim-annotation` wink line; raw stderr/stack traces stay one action away.
- Top bar always shows the active EDT's `topic` (human-readable name), resolved at the app-shell level regardless of which zone was last visited — never the ULID; "no active EDT" when none is active.
- Footer hint set includes both `[d/e/u/l/r/s] zone` and `[←→] zone`, ordered by expected frequency.

## Cross-Story Dependencies

- Stories 2.7–2.20 all extend or correct Epic 1 surfaces (navigation contract, app shell, launch banner, top bar/footer) even though their code lives in Epic 1's territory — appended here solely because this epic's branch remained open; they are text corrections/extensions to already-`done` Epic 1 stories, not reopenings.
- Story 2.2 (branch creation) depends on Story 2.3's git safety gate being in place first (shared-branch rejection applies at creation time).
- Story 2.4 (switch without data loss) and Story 2.5 (modify after creation) both depend on Story 2.3's protected-branch rule for branch changes.
- Story 2.6 (divergence visibility) feeds directly into Story 2.9's EDTs zone list composition.
- Story 2.9 (EDTs zone) depends on Stories 2.1–2.6 (core EDT use-cases) and Story 2.7 (navigation contract) being available to build against.
- Story 2.11 (repo registry screen) reuses Story 1.5's existing `scan`/`register` use-cases as-is — no new port/adapter — and is chained from Dashboard's "no repos registered yet" state ahead of Story 2.1's "no EDT yet" state.
- Story 2.12 (zone arrow navigation) is purely additive over Stories 1.13/2.7's keybinding contract.
- Story 2.13 (manifest-gated tabs) requires loading manifests for all registered repos (not just active-EDT members) at shell level — flagged to verify it doesn't complicate the cold-load spinner state.
- Story 2.14 (command bar) supersedes Story 2.11's original `:`-binding mistake — the registry screen becomes reachable only as a registered command through this bar. Story 2.17 further supersedes Story 2.14's "show full list on open" behavior with the double-Tab/grid model.
- Story 2.15 depends on Story 2.9's dialog state machines (reused/extracted) and Story 2.14's command dispatch mechanism; its static action-hint text is itself superseded by Story 2.18.
- Story 2.18 depends on Stories 2.6, 2.9, and 2.15 (extends the EDTs zone's list, detail pane, and action logging) and loosens Story 2.9's `canEditMemberBranch` gate; it explicitly defers a Restart action to Epic 5 (Story 5.3) and partially Epic 3 (Story 3.1).
- Story 2.19 (settings) is referenced forward by Story 2.17 (`COMMAND_GRID_MAX_ROWS` becomes its default, not a replacement) and Story 2.18 (hidden-actions list) — those two stories' constants become settings-overridable once 2.19 lands.
- Story 2.13's `shared-types-source` module id and git-ancestry version-resolution mechanism are specified further under Epic 4 (Stories 4.1/4.2); Epic 3's Story 3.1 and Epic 5's Story 5.3 are the eventual homes for the Restart action Story 2.18 stubs disabled.
- Epic 3 (group update) and Epic 4 (`shared-types` propagation) both reuse this epic's git branch-scope safety gate (AD-8) and per-service outcome-set convention.
