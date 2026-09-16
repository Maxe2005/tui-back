---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-tui-back-2026-08-10/prd.md
  - _bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-tui-back-2026-08-10/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-tui-back-2026-08-10/EXPERIENCE.md
---

# tui-back - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for tui-back, decomposing the requirements from the PRD, UX Design contract (Atelier), and Architecture Spine into implementable stories.

## Requirements Inventory

### Functional Requirements

FR-1: A developer can invoke any Must-scope action (repo update, migration, propagation, health check) either through the TUI or as a standalone script from a shell, with identical effect (script/CLI parity).
FR-2: The tool only acts on a repo that carries a manifest; the manifest declares that repo's service identity and which modules are active for it.
FR-3: A developer can create a new EDT by giving it a topic and manually selecting its member services from the set of managed repos.
FR-4: At EDT creation, a developer can have the tool create a working branch in each selected member service, based on `development` by default or another chosen base branch, named either as one shared name across all selected services or individually per service.
FR-5: A developer can add or remove member services from an existing EDT, and change a member service's working branch, after the EDT has been created.
FR-6: A developer can switch the active EDT at any time; the tool auto-preserves any uncommitted work in every affected repo of the outgoing EDT before switching.
FR-7: Assigning a shared/protected branch (`development`, preprod, prod) as an EDT's "own" branch for a service is rejected.
FR-8: While an EDT is active, every managed repo that is not one of its member services is kept on `development` (or its configured shared branch).
FR-9: Every managed service is displayed with its current branch and how far that branch has diverged from its own origin/upstream, in both directions — ahead and behind.
FR-10: A developer can run a group update — pull `development`, run migrations, restart containers — against either the active EDT's member services (default) or explicitly against all managed repos regardless of EDT (maintenance mode).
FR-11: When a group update hits a repo that isn't cleanly updatable, the tool auto-resolves already-known-safe cases and otherwise guides the developer through a bounded menu, then re-verifies before continuing.
FR-12: When a migration fails during a group update, the tool surfaces which service, which migration, and the error output, and lets the developer re-trigger just that service's migration after a fix.
FR-13: A developer can publish a new `shared-types` version through the tool, which runs the `shared-types` repo's existing `npm run v` script (bump → build → publish → push), gated on the active EDT including the `shared-types-source` repo as a member, and chaining into propagation on success (amended 2026-08-24).
FR-14: The tool shows, for the active EDT's member services, which are on the version most recently published from the active EDT's own `shared-types` branch (resolved via git ancestry, never the global-max version across unrelated branches) and which aren't (amended 2026-08-24).
FR-15: A developer can propagate the new `shared-types` version to some or all of the active EDT's eligible member services in one action.
FR-16: A developer can view a single, live, aggregated log stream from every service in the active EDT, or a chosen subset.
FR-17: The aggregated log stream can be filtered by service, by free-text/regex search, and by log level, without restarting it.
FR-18: Service health (up / down / restarting) is visible inline with the log view.
FR-19: For any managed repo whose manifest activates a route-explorer module, the tool lists the routes that module's scanner discovers for that repo.
FR-20: A developer can fire a request against any route discovered via FR-19, with authentication for protected routes handled automatically in dev mode.
FR-21: A developer can save a request (method, path, body, headers), and when re-firing a saved request, can further customize it before sending — then either overwrite the original saved request or save the customized version as a new one.
FR-22: Firing a request (saved or ad hoc) surfaces its response and the relevant aggregated logs for the affected services in the same place, immediately after — with the affected-service set learned progressively per route rather than pre-configured.
FR-23: A developer's saved requests form one global library, not siloed per EDT; each EDT can independently hide individual saved requests from its own view and mark others as favorites (per-EDT or global).
FR-24 (added 2026-09-16, Sprint Change Proposal): A developer can delete an EDT they no longer need, choosing per member service whether to leave its branch alone or delete it too — informed by that branch's merge status (into its `sharedBranch`) and any uncommitted work — with deletion blocked while the EDT is active and blocked per-service when the branch is also registered as another EDT's own branch for that repo.

### NonFunctional Requirements

NFR-1 (Performance): No perceptible slowness — UI interaction response under ~150ms; a log line visible within ~1s of container emission. Non-negotiable (sluggishness sends the developer back to bash).
NFR-2 (Reliability / blast radius): A crash or bug in one action must not corrupt another EDT's state or another service's data. One SQLite file per EDT isolates state; the one deliberate exception is the narrowly-scoped global store for cross-EDT data (saved-request library).
NFR-3 (Auditability): Every action is a standalone script, independently inspectable and re-runnable outside the TUI — the trust mechanism that makes giving the tool git authority acceptable.
NFR-4 (Extensibility, structural): The generic-core/module split (manifest-driven) is enforced from day one, proven on `shared-types` propagation and the route explorer, so the tool can extend to a structurally different stack later (not validated against a second stack in v1).
NFR-5 (Local state layout): Config, per-EDT SQLite data, transient state, and cache follow XDG Base Directory conventions (`XDG_CONFIG_HOME`/`XDG_DATA_HOME`/`XDG_STATE_HOME`/`XDG_CACHE_HOME`).
NFR-6 (Single-instance enforcement): A second running instance of the tool on the same machine is detected and blocked.

### Additional Requirements

- **No starter/greenfield template specified.** Architecture confirms v1 runs via `tsx`/`node` directly (a `package.json` bin, `npm link` for a local global command) — no compiled binary, no scaffolding template named. Epic 1 Story 1 starts from a bare TypeScript/Node project setup, not a starter kit (AD-14).
- **Hexagonal architecture, one-way dependency direction.** `core/` never imports from `adapters/`; `adapters/driven/*` implement interfaces declared in `core/ports`; `adapters/driving/*` (`tui`, `cli`) call `core/` use-cases only — never a driven adapter directly (AD-1).
- **Script/CLI parity via one umbrella binary, shared core code.** Every Must-scope action is a subcommand of one CLI binary (`tui-back <subcommand>`), a thin `driving/cli` wrapper around exactly one core use-case; the TUI calls that same core use-case directly, in-process — it never spawns the CLI subcommand as a child process (AD-2).
- **Script output envelope.** Every core use-case returns a `{ok,data}`/`{ok,error}` TypeScript shape; the CLI adapter serializes it to stdout as human-readable text (TTY) or a single final JSON line (non-TTY): `{"ok":true,"data":{...}}` / `{"ok":false,"error":{"code":"...","message":"...","details":{...}}}`; exit code `0`/`1` only (AD-3).
- **Manifest is the only per-repo activation surface.** A repo is managed iff it carries a root `.tui-back.yaml`, zod-validated on load, declaring `service`, `container`, optional `migrationCommand` (absent = the service has no migrations), optional `sharedBranch` (default `development`), and `modules` (module-id → per-module config) (AD-4).
- **Module implementations are statically registered, never dynamically loaded.** The tool ships a compiled-in registry mapping module id → implementation; a manifest only selects a key from that registry (AD-5).
- **Repo registry is explicit, never path-convention-based.** The set of local filesystem paths the tool scans lives in an explicit registry (`XDG_CONFIG_HOME/tui-back/registry.yaml`), populated by an explicit register action; a separate scan subcommand may propose candidates but never auto-registers (AD-6).
- **Storage topology.** One SQLite file per EDT at `XDG_DATA_HOME/tui-back/edts/<ulid>.db` (filename is a generated ULID, never the topic). One global store at `XDG_DATA_HOME/tui-back/global.db` (saved-request library, per-EDT hide/favorite flags, global favorites). Active-EDT pointer and transient UI state live at `XDG_STATE_HOME/tui-back/state.json`. Each `.db`'s schema evolves through hand-rolled, numbered `.sql` files tracked by a `schema_version` table — no external migration framework (AD-7). Amended 2026-08-26 (Sprint Change Proposal, Story 2.19): adds `XDG_CONFIG_HOME/tui-back/settings.yaml` — a zod-validated per-user tool-preferences file (command-palette grid density, per-zone hidden-action hints), additive to this enumeration and independent of `registry.yaml` and every EDT/global SQLite store.
- **Git-adapter enforces branch-scope safety centrally.** Every git write passes through `adapters/driven/git`, which rejects (before any `git` invocation) a write targeting `development`/preprod/prod or any branch not the current EDT's own registered branch for that service; the adapter resolves the allowed-branch context itself at write time, never trusting a caller-supplied branch name (AD-8).
- **Single-TUI enforcement plus a per-EDT/repo action lock.** The interactive TUI detects an already-running TUI instance and refuses to start a second one (scoped to the TUI only). Independently, any state-mutating core use-case acquires a short-lived advisory lock scoped to the specific EDT id / repo path(s) it touches (AD-9).
- **One central TUI store (Zustand) for cross-zone state; zone-local UI state stays local.** `state.json` is the durable, authoritative record of the active EDT; the store's `activeEdt` field is a hydrated cache, re-synced via `fs.watch` (or equivalent poll) so a CLI-made change is picked up while the TUI is open. The store's `logBuffers` field is a view onto `core/logs`' buffer, not a second copy (AD-10).
- **Logs are ephemeral; Docker remains the log-truth source.** `adapters/driven/docker` only streams raw lines in; a bounded in-memory ring buffer per service (sized for FR-22's fire-correlation window plus scroll-back) is owned by `core/logs`; nothing is written to disk, discarded on restart (AD-11).
- **Performance budget enforcement.** Log-stream re-renders are debounced/batched, never a full redraw per emitted line; CPU-heavy work never runs synchronously in-process on the TUI's event loop — it goes through the CLI's subprocess boundary instead (AD-12).
- **Testing strategy by layer.** `core/` unit-tested (Vitest) against fake port implementations; `adapters/driven/*` get targeted integration tests against the real system (temp file for persistence, temp repo for git); the Zustand store is tested directly without rendering Ink; `adapters/driving/cli` tested black-box (invoke subcommand as child process, assert AD-3 envelope); `adapters/driving/tui` gets smoke-tests via Ink's `render()` only (AD-13).
- **Packaging is deferred.** v1 runs via `tsx`/`node` directly; a packaging mechanism (Node SEA / `pkg` / `bun --compile`) is chosen only when teammate distribution becomes a real goal (AD-14).
- **TUI zone structure mirrors core capability boundaries 1:1.** Each zone under `adapters/driving/tui/` maps to exactly one core capability area (`edts/`→`core/edt`, `update/`→`core/scripts`, `logs/`→`core/logs`, `routes/`→`core/routes`, `shared-types/`→`adapters/driven/modules/shared-types`), except `dashboard/`, the one zone allowed to read (never write) across all of them (AD-15).
- **Stack (fixed versions):** TypeScript 7.0.2, Node.js 24, Ink 7.1.1, React 19.2.8, Zustand 5.0.14, better-sqlite3 13.0.3, dockerode 5.0.1, openapi-typescript 7.13.0, jose 6.2.8, zod 4.4.3, yaml (eemeli) 2.9.0, ulid 3.0.2, vitest 4.1.10, tsx 4.23.12.
- **Naming/data conventions.** kebab-case files/directories; `PascalCase` types/classes; `camelCase` functions/variables. Manifest module ids are kebab-case, matched 1:1 against the compiled-in module registry. Generated entity ids (EDT id, saved-request id) are ULIDs. Dates/times are ISO 8601. Any use-case reporting a per-service outcome (group update, migrations, propagation status/propagate) puts it in `data.results: {service, outcome, detail?}[]` with `outcome` from a shared closed set (`"updated"`/`"skipped"`/`"failed"`, or equivalent).

### UX Design Requirements

UX-DR1: Implement the Atelier design token system — colors (`background` #1c1b1f, `surface` #232228, `surface-selected` #28262c, `border` #3a3844, `text` #eae7e1, `text-dim` #8f8b98, `accent` #c9a13b, `success` #3f9d6e, `error` #c1495e, `warning` #cf9a3e, `info` #4f80a8), one monospace type family, and the character-cell spacing scale (0/1/2/3ch, glyph-gap, indent, pane-padding-x). Accent reserved exclusively for active-selection/primary-action, never a status color.
UX-DR2: Implement the "square, deliberate" shape rule — every in-app panel, modal, badge, and list row renders at 0px corner radius, no rounding anywhere.
UX-DR3: Implement the `zone-tab` component — up to six top-bar entries (Dashboard, EDTs, Update, Logs, Routes, shared-types); Dashboard/EDTs/Update/Logs are permanent, Routes/shared-types are manifest-gated (Story 2.13, amended 2026-08-24): fully omitted if no repo in the entire registry activates the module, disabled (dimmed/strikethrough) if the module exists in the registry but no active-EDT member carries it. Inactive/active/disabled visual states, and a background-event glyph+counter badge (never on a disabled tab) that clears once the zone is visited.
UX-DR4: Implement the `status-badge` component — the closed glyph+color vocabulary (`●`/`○` up/down, `✔`/`✖` done/failed, `⣾` in-progress, `›`/`▸` selection/action marker), glyph and color always shipped together, never color alone.
UX-DR5: Implement the `list-row` component — base row, nested-member indent, selected state (surface-selected fill + accent bar + `›` marker), and right-aligned/trailing dim meta-suffix (branch, divergence, timestamp). Amended 2026-08-26 (Sprint Change Proposal, Story 2.18): adds an `active` state — accent-colored, bold label — independent of and combinable with the `selected` (cursor) state, for a row representing the current tool-wide active EDT regardless of keyboard focus. Amended 2026-08-27 (Sprint Change Proposal, Story 2.18/2.21): superseded — the accent+bold treatment moves to a new `emphasized` prop, driven by whichever row's membership currently drives a categorized split (e.g. EDT SERVICES/OTHER SERVICES), not tool-wide active status; `active` (repurposed) now renders a discreet `{colors.info}` `" active"` suffix instead, decoupled from `emphasized`.
UX-DR6: Implement the `detail-pane` component — uppercase label-styled title, body content, and an outcome-colored `summary-line` divider (success/warning/error) for run-outcome panes.
UX-DR7: Implement the `footer-hint` component — permanent bottom row of contextual `[key] action` pairs, ordered left-to-right by expected frequency, always reflecting the current context's live keybindings.
UX-DR8: Implement the `modal-dialog` component — bold-border floating dialog for confirmations, guided-resolution menus, and the keybinding-help screen; `Escape` always cancels, `Enter` always confirms regardless of trigger method (mouse or keyboard).
UX-DR9: Implement the `checkbox-list-item` component — `[ ]`/`[x]` multi-select rows for EDT member selection, log-view service filter, and saved-request batch actions; `Space` toggles, `Enter` confirms the whole selection.
UX-DR10: Implement the `splitter` component — single-character divider between list/detail panes; mouse-drag resize; `Ctrl+W` keyboard resize-mode with arrow-key resize, `Tab` cycling the active boundary, `Enter`/`Esc` exit; pane sizes persist per zone independently across sessions. Amended 2026-08-27 (Sprint Change Proposal, Story 2.21): the keyboard resize-mode and persistence, deferred since Story 1.9/1.10, are implemented by Story 2.21 (EDT zone first) — persistence via `StatePort`/`state.json` (AD-7), not the future `SettingsPort` (Story 2.19).
UX-DR11: Implement the `spinner` component — single functional in-progress indicator (`⣾` braille glyph cycling), the only animated element in the system.
UX-DR12: Implement the `dim-annotation` component — optional italic/dim/indented "wink" line beneath a factual message, never the sole carrier of required information.
UX-DR13: Implement the permanent top bar — app name, active EDT name, `[/]` filter and `[:]` command affordances, always visible above the zone-tab bar.
UX-DR14: Implement the launch banner — a k9s-inspired ASCII-art banner shown permanently on the Dashboard (amended 2026-08-26, Sprint Change Proposal, Story 2.16 — originally shown once on launch), above/within the Dashboard zone's content area, monochrome (text-dim or accent), no motion/gradient.
UX-DR15: Implement the dedicated keybinding-palette/help screen — opened via `?` from any zone, a `modal-dialog` instance listing every key + description beyond the contextual footer-hint, read-only, scrollable with `j`/`k`, closes via `Esc` or `?` again.
UX-DR16: Implement the canonical keybinding contract — `j`/`k` move, `g`/`G` top/bottom (list-jump only, never zone-switching), `Space` toggle, `Enter` confirm, `Esc` cancel, `Tab` cycle, `Ctrl+W` resize-mode, `/` filter, `:` command entry, `?` help, `q` quit (confirms first if a group update/publish/propagation run is in progress), and single-letter zone mnemonics `d`/`e`/`u`/`l`/`r`/`s`. Amended 2026-08-24 (Sprint Change Proposal, Story 2.12); zone-switching mechanism corrected 2026-08-25 after a review loopback (see Story 2.12): `Left`/`Right`, with no form/overlay capturing input, directly switch the active zone to the previous/next zone in tab-bar order, wrapping at the ends — always available, no focus mode. `Tab` is unaffected by this story. Amended 2026-08-27 (Sprint Change Proposal, Story 2.21): `Ctrl+W` resize-mode is exited by either `Enter` or `Esc`.
UX-DR17: Implement the two-layer outcome-message voice pattern across every zone — a dry/factual primary line sufficient on its own, with an optional `dim-annotation` wink line that is never required and never folded into the primary line; raw stderr/stack traces always stay one action away, never fully hidden.
UX-DR18: Implement the resizable list/detail split as the primary content layout within each zone (roughly 2:3 list:detail ratio), per `{components.splitter}`. Amended 2026-08-27 (Sprint Change Proposal, Story 2.21): the EDT zone becomes the first "multi-splitter zone" (Story 2.7's already-anticipated concept) — 3 internal boundaries (EDT selector/EDT SERVICES/OTHER SERVICES) in addition to the list/detail split.
UX-DR19: Implement Dashboard zone states — cold-load spinner, populated (active EDT + member health + last group-update timestamp + default "enter last EDT" action), "no EDT yet" first-run prompt, and background-event badge surfacing while on Dashboard.
UX-DR20: Implement EDTs zone states — empty (explicit "create first EDT" prompt), populated (list with branch + ahead/behind per service), no-upstream/offline divergence display, duplicate-topic rejection, zero-member-at-creation rejection, per-service branch-creation failure reporting, shared-branch rejection (with explanation before any git write), member added/removed without disturbing others, zero-member EDT display (never an error), member branch change (protected-switch rule), protected-switch-blocked-during-update prompt, interrupted-update recovery offer, and member/non-member service categorization with per-service contextual actions (amended 2026-08-26, Sprint Change Proposal, Story 2.18); fixed, resizable borders between EDT selector/EDT SERVICES/OTHER SERVICES (amended 2026-08-27, Sprint Change Proposal, Story 2.21). Amended 2026-09-16 (Sprint Change Proposal): adds "EDT deleted" (per-service branch-disposition confirmation, active-EDT-blocked, cross-EDT branch-collision-blocked-per-service — Story 2.29), "EDT quick-pick" (filterable list for `edt-switch`/`edt-modify` with no argument, including its own "no matching EDT" state — Story 2.30), and "Create from existing EDT" (member checklist pre-seeded from a root EDT, root-branch-derived base-branch suggestion — Story 2.31) as new named states.
UX-DR21: Implement Update zone states — idle (last outcome visible), no-op-on-zero-member message, all-repos confirmation gate, second-run-blocked message, in-progress per-service spinner, per-service outcome summary (updated/skipped/failed, none silently absent), assisted-resolution guided menu (stash/open-in-editor/cancel-repo/cancel-run), mid-merge/mid-rebase distinct state, migration-failure detail + re-trigger with re-verify, and quit-mid-run confirmation with next-launch interrupted-run resume offer.
UX-DR22: Implement Logs zone states — no-members explicit state, live streaming with debounced/batched re-renders, filter applied without interrupting the stream, invalid-regex inline rejection, service-down/crashed-mid-stream inline display with auto-reconnect, inline health (up/down/restarting), and restart-in-progress control disabling to prevent a second concurrent restart.
UX-DR23: Implement Routes zone states — scan-in-progress spinner, scan-failure vs. genuinely-empty-list as distinct states, fired/response view with correlated logs in the same pane, auth-error as a distinct state from a generic request failure (with automatic token refresh), unlearned-affected-service-set default-proposal-and-adjust flow, stale-saved-request flagging (never fired silently), save-as-new name-collision rejection, and library hide/favorite behavior (per-EDT vs. global, independent scopes).
UX-DR24: Implement shared-types zone states — no-members explicit state, publish-in-progress per-step status with spinner, publish-step-failure detail + resume-from-failed-step re-trigger, propagation status (on-latest-for-this-branch vs. behind, resolved live via git ancestry, never a global-max version — amended 2026-08-24), publish-success chaining immediately into a propagation offer, propagation-in-progress/per-service-failure independent retriability, and quit-mid-run confirmation with resume offer.
UX-DR25: Implement cross-cutting focus/selection treatment (`list-row` selected state) uniformly across every zone's list/detail split.
UX-DR26: Implement the accessibility floor — status never conveyed by color alone (glyph always paired), every keyboard primitive available without a mouse, comfortable warm-off-white-on-charcoal reading contrast.
UX-DR27 (added 2026-08-24, Sprint Change Proposal, Story 2.11; command mechanism corrected 2026-08-25, Story 2.14): Implement the repo registry screen — static manifest-creation guidance always shown, scan-a-root-path via `checkbox-list-item` multi-select, per-path register outcome (registered/already-registered/failed), distinct empty-scan state, reachable as a registered command inside the `:` command-entry bar (UX-DR29) and auto-offered from Dashboard's "no repos registered yet" state.
UX-DR28 (added 2026-08-24, Sprint Change Proposal, Story 2.12; mechanism corrected 2026-08-25 after a review loopback): Implement zone arrow navigation — `Left`/`Right` directly switch the active zone to the previous/next zone in tab-bar order, wrapping at the ends, always available with no form/overlay capturing input. No focus mode; `Tab` is untouched.
UX-DR29 (added 2026-08-25, Sprint Change Proposal, Story 2.14; reveal mechanism corrected 2026-08-26, Sprint Change Proposal, Story 2.17): Implement the `:` command-entry bar — a `modal-dialog` instance with a text input; no command list shows on open. `Tab` on an empty input shows the full command grid (UX-DR30); `Tab` on a non-empty input autocompletes on a single match, completes to the longest common prefix when several matches share one, or (when already at that prefix) requires a second `Tab` within a short window to reveal the matching-commands grid. `Enter` runs an exact match and closes the bar, `Esc` cancels without executing, and an unmatched `Enter` shows an inline "unknown command" message rather than doing nothing silently.

UX-DR30 (added 2026-08-26, Sprint Change Proposal, Story 2.17): Implement the `command-grid` component — a multi-column, arrow-navigable browser for the command bar's matching commands (UX-DR29), column-major left-to-right layout with a configurable max rows per column, trailing `…` truncation when the full grid exceeds the display width, and horizontal scrolling at either extremity to reveal columns hidden by that truncation. `Down` from the input enters the grid (landing top-of-first-column); `Up` from a column's top row returns to the input; `Enter` or any typed character exits back to the input (completing or resuming edit, respectively).

UX-DR29 amended 2026-09-16 (Sprint Change Proposal): the registered command set grows to include `edt-delete` (Story 2.29), `edt-create-from` (Story 2.31), and a `registry validate` action inside the existing `registry` screen rather than a new top-level command (Story 2.28) — same command-bar mechanism, no new UI pattern.

UX-DR31 (added 2026-08-26, Sprint Change Proposal, Story 2.19): Implement the settings screen — a tab-organized `modal-dialog` instance (a "General" tab plus one tab per configurable feature area), reachable only as a registered `:` command (mirrors UX-DR27's repo-registry-screen precedent — never bound to a raw keypress). Every change applies and persists immediately, no separate save step; a tab with zero settings renders validly, never as an error. Amended 2026-08-28 (Sprint Change Proposal, Story 2.19): a tab may itself hold more than one distinct settings group (first case: the "EDTs" tab, see Story 2.19 below) — such a tab opens on an Up/Down-navigable group list, `Enter` drills into a group's own `checkbox-list-item` list, and `Esc` steps back up one level (out of a group, then — one more `Esc` — closing the whole screen); a tab with a single flat settings list (Command Palette) is unaffected, no group level.
UX-DR27: Implement the mouse-optional interaction model — every keyboard action has an equivalent mouse action (click select/activate, drag-resize splitter) but no action is ever mouse-only; Ink's lack of built-in mouse support is a flagged risk with `Ctrl+W` keyboard resize-mode as the confirmed-safe fallback. Amended 2026-08-27 (Sprint Change Proposal, Story 2.21): the confirmed-safe keyboard fallback is delivered by Story 2.21 (EDT zone); drag-resize stays out of scope (no mouse support in Ink).

### FR Coverage Map

FR-1: Epic 1 - Script/CLI parity for every action
FR-2: Epic 1 - Per-repo manifest declares identity and active modules
FR-3: Epic 2 - Create an EDT
FR-4: Epic 2 - Create dev branches for EDT member services
FR-5: Epic 2 - Modify an EDT after creation
FR-6: Epic 2 - Switch the active EDT without data loss
FR-7: Epic 2 - An EDT never claims a shared branch
FR-8: Epic 2 - Non-member managed repos stay on development
FR-9: Epic 2 - Branch and divergence visibility
FR-24: Epic 2 - Delete an EDT (added 2026-09-16, Sprint Change Proposal — Story 2.29)
FR-10: Epic 3 - Run a group update, EDT-scoped or all-repos
FR-11: Epic 3 - Assisted resolution of merge conflicts / dirty state
FR-12: Epic 3 - Per-service migration failure handling
FR-13: Epic 4 - Publish a new shared-types version
FR-14: Epic 4 - See propagation status without a manual check
FR-15: Epic 4 - Propagate to chosen services
FR-16: Epic 5 - Aggregated live log stream
FR-17: Epic 5 - Filter the aggregated stream
FR-18: Epic 5 - Inline service health
FR-19: Epic 6 - Route discovery via a pluggable scanner module
FR-20: Epic 6 - Fire a request with automatic dev-mode auth
FR-21: Epic 6 - Save, customize, and re-fire a request
FR-22: Epic 6 - See response and relevant logs together
FR-23: Epic 6 - Manage the saved-request library across EDTs

## Epic List

### Epic 1: Foundation — Standalone-Script Core, Manifest & Navigation Shell
A developer can launch the tool, see the full navigation shell (top bar, six zone-tabs, footer, resizable list/detail split, modal-dialog, `?` help screen), register managed repos via a manifest, and run any action identically via the TUI or as a standalone CLI script.
**FRs covered:** FR-1, FR-2
**Implementation notes:** Lays the hexagonal foundation (AD-1–AD-6, AD-9, AD-13–AD-15), the Atelier design tokens and cross-cutting components (UX-DR1–UX-DR18, UX-DR25–UX-DR27), the script output envelope (AD-3), XDG state layout (NFR-5), single-instance enforcement (NFR-6), auditability (NFR-3).

### Epic 2: EDT Workspace Management
A developer can create, modify, and safely switch between EDTs (no uncommitted work ever lost), with branch/divergence visibility across every managed repo, and the guarantee that non-member repos stay on `development`.
**FRs covered:** FR-3, FR-4, FR-5, FR-6, FR-7, FR-8, FR-9
**Implementation notes:** Per-EDT SQLite storage (AD-7), centralized git branch-scope safety gate (AD-8), EDTs zone (UX-DR20), blast-radius isolation (NFR-2).

### Epic 3: Group Update & Migrations
A developer can run a group update (pull, migrate, restart) scoped to the active EDT or to all managed repos, with assisted resolution of conflicts and migration failures.
**FRs covered:** FR-10, FR-11, FR-12
**Implementation notes:** Update zone (UX-DR21), reuses Epic 2's git safety gate (AD-8), detect → auto-fix-known-safe-or-guided-menu → re-verify mechanic.

### Epic 4: `shared-types` Propagation
A developer can publish a new `shared-types` version and see/propagate its adoption status across the active EDT's member services, without any manual per-repo check.
**FRs covered:** FR-13, FR-14, FR-15
**Implementation notes:** First company-specific module, validating AD-4/AD-5 in practice; shared-types zone (UX-DR24).

### Epic 5: Aggregated Log Observability
A developer can view a live, filterable, aggregated log stream across multiple services, with inline health status and a developer-triggered restart control.
**FRs covered:** FR-16, FR-17, FR-18
**Implementation notes:** Bounded in-memory ring buffer (AD-11), debounced/batched render performance budget (AD-12, NFR-1 — the surface most exposed to Ink's rendering ceiling), Logs zone (UX-DR22).

### Epic 6: Route Explorer
A developer can discover a repo's routes, fire a request with automatic dev-mode auth, save/customize/re-fire requests in a global library, and see the response and correlated logs together.
**FRs covered:** FR-19, FR-20, FR-21, FR-22, FR-23
**Implementation notes:** Second pluggable module (NestJS/OpenAPI scanner + `jose` dev-JWT auth), `global.db` (AD-7), Routes zone (UX-DR23).

## Epic 1: Foundation — Standalone-Script Core, Manifest & Navigation Shell

A developer can launch the tool, see the full navigation shell (top bar, six zone-tabs, footer, resizable list/detail split, modal-dialog, `?` help screen), register managed repos via a manifest, and run any action identically via the TUI or as a standalone CLI script.

### Story 1.1: Project Scaffolding & Hexagonal Skeleton

As a developer,
I want the project scaffolded with the hexagonal folder structure and toolchain,
So that every subsequent story has a consistent place to add code and can be run without a compiled build step.

**Acceptance Criteria:**

**Given** a fresh clone of the repository
**When** a developer installs dependencies
**Then** they install cleanly on Node.js 24 with TypeScript 7.0.2 resolved

**Given** the scaffolded project
**When** a developer inspects the source tree
**Then** it matches `src/core/`, `src/adapters/driven/`, `src/adapters/driving/`, `src/bin/` exactly
**And** `core/` contains no import of Ink/React/dockerode/child_process/better-sqlite3/fs

**Given** the scaffolded project
**When** a developer runs the app via `tsx`/`node` (`npm link` then `tui-back`)
**Then** the command resolves and prints placeholder output
**And** no compiled binary exists (AD-14)

**Given** the scaffolded project
**When** a developer runs the test command
**Then** Vitest executes successfully, confirming the harness is wired

**Given** the scaffolded project
**When** a file under `core/` imports from `adapters/`
**Then** a lint/type-check rule flags it (AD-1 structurally enforced)

### Story 1.2: XDG State Layout Resolution

As a developer,
I want the tool's config/data/state/cache to live in standard XDG locations,
So that they never collide with a bespoke directory layout.

**Acceptance Criteria:**

**Given** `XDG_CONFIG_HOME`/`XDG_DATA_HOME`/`XDG_STATE_HOME` are set
**When** the tool resolves storage paths
**Then** it uses `$XDG_*_HOME/tui-back/` respectively

**Given** none are set
**When** resolved
**Then** the tool falls back to the XDG-specified defaults (`~/.config`, `~/.local/share`, `~/.local/state`)

**Given** any of `tui-back`'s XDG-namespaced directories doesn't exist yet
**When** a component (e.g. a future config or data write) needs to create a file under it for the first time
**Then** the tool creates the directory automatically rather than failing

**Given** `XDG_CACHE_HOME`
**When** resolved
**Then** the path is available but nothing is written there yet

### Story 1.3: Script Output Envelope & CLI Entrypoint Contract

As a developer,
I want every CLI subcommand and its underlying core use-case to share one output contract,
So that a script run by hand and the same action triggered from the TUI are provably identical.

**Acceptance Criteria:**

**Given** a core use-case
**When** it completes
**Then** it returns exactly `{ok: true, data: T}` on success or `{ok: false, error: {code, message, details?}}` on failure (AD-3)

**Given** a CLI subcommand
**When** stdout is a TTY
**Then** it renders human-readable text
**And When** stdout is not a TTY
**Then** it prints exactly one final JSON line matching the envelope

**Given** a CLI subcommand
**When** the use-case succeeds
**Then** the process exits 0
**And When** it fails
**Then** it exits 1 — no other exit code is ever used

**Given** the CLI binary
**When** invoked with an unknown subcommand
**Then** it prints usage help and exits 1 without crashing

**Given** the CLI entrypoint
**When** defined
**Then** it is one umbrella binary (`tui-back <subcommand>`) — no per-action separate executable exists (AD-2)

### Story 1.4: Manifest Schema, Loader & Validation

As a developer,
I want the tool to recognize a repo only through a versioned manifest file,
So that an unmanaged repo is never accidentally touched.

**Acceptance Criteria:**

**Given** a repo with a root `.tui-back.yaml` declaring `service`, `container`, `migrationCommand`, `modules`
**When** loaded
**Then** it validates against the zod schema and exposes the identity/modules to core

**Given** a repo with a root `.tui-back.yaml` that omits `migrationCommand`
**When** loaded
**Then** it validates successfully and the service is treated as having no migrations (consistent with Story 3.2's group-update skip behavior)

**Given** a manifest missing a required field
**When** loaded
**Then** loading fails with a clear validation error naming the field — never a generic crash

**Given** a repo with no `.tui-back.yaml`
**When** scanned
**Then** it is treated as unmanaged and excluded from every action, with no special-case code (FR-2)

**Given** a manifest without an explicit `sharedBranch`
**When** loaded
**Then** it defaults to `development` (AD-4)

**Given** a manifest declaring a `modules` map
**When** loaded
**Then** the declared ids and config are exposed as-is (validation against the module registry happens in Story 1.6)

### Story 1.5: Explicit Repo Registry

As a developer,
I want to explicitly register which local repo paths the tool scans,
So that the tool never assumes a single-machine directory layout.

**Acceptance Criteria:**

**Given** no prior registration
**When** a developer runs `tui-back register <path>`
**Then** the path is added to `XDG_CONFIG_HOME/tui-back/registry.yaml` (per Story 1.2's XDG resolution)
**And** the command succeeds with the AD-3 envelope

**Given** registered paths
**When** a developer runs `tui-back list-repos`
**Then** the tool loads each path's manifest and lists every managed repo's identity
**And** unmanaged directories are silently skipped

**Given** `tui-back list-repos` is run twice in a row from a shell with no intervening registry change
**When** the two runs are compared
**Then** they produce identical output — the first real action demonstrating a Must-scope action's standalone, idempotent, shell-invocable nature (FR-1); its TUI-side parity is exercised once a zone consumes this same use-case starting in Epic 2

**Given** a registered path that no longer exists on disk
**When** `list-repos` runs
**Then** that entry is reported unreachable rather than crashing the listing

**Given** a `tui-back scan <root>` subcommand
**When** run
**Then** it proposes candidate manifest-carrying directories without ever auto-registering any (AD-6)

### Story 1.6: Static Module Registry

As a developer,
I want module implementations compiled into the tool rather than dynamically loaded,
So that a manifest can never become an arbitrary-code-execution surface on a tool with git write authority.

**Acceptance Criteria:**

**Given** the tool's source
**When** built
**Then** it ships one compiled-in registry mapping module id to implementation
**And** no dynamic loading of externally supplied paths exists anywhere

**Given** a manifest declaring a module id present in the registry
**When** loaded
**Then** that module is resolved and activated for the repo

**Given** a manifest declaring an unknown module id
**When** loaded
**Then** loading fails with a clear error naming the offending id — never silently ignored

**Given** `tui-back list-repos` run against a repo with an active module
**When** displayed
**Then** the repo's active module ids show alongside its identity

### Story 1.7: Single-Instance Enforcement & Per-Resource Action Lock

As a developer,
I want the tool to prevent two concurrent writers to the same EDT or repo,
So that state can never be corrupted by a race.

**Acceptance Criteria:**

**Given** the TUI is already running
**When** a developer starts a second TUI instance
**Then** it detects the running instance and refuses to start with a clear message
**And** a CLI invocation is never blocked by this (AD-9)

**Given** the TUI is closed
**When** a developer runs a CLI subcommand by hand
**Then** it starts normally regardless of prior TUI state

**Given** a state-mutating use-case scoped to an EDT id or repo path
**When** it begins
**Then** it acquires a short-lived advisory lock on that resource before writing, releasing it once done

**Given** a second action targeting the same EDT/repo while the first holds its lock
**When** attempted
**Then** it is serialized or rejected with an "action already in progress" message — never allowed to race

### Story 1.8: Atelier Design Tokens & Theme Module

As a developer,
I want the Atelier color/typography/spacing tokens implemented as a single theme module,
So that every component reads from one consistent source instead of hardcoded values.

**Acceptance Criteria:**

**Given** the theme module
**When** any component imports it
**Then** it exposes every color token at the exact hex values from DESIGN.md

**Given** the theme module
**When** queried for spacing
**Then** it exposes the character-cell scale (0/1/2/3ch, glyph-gap, indent, pane-padding-x, row-gap, section-gap) as named constants

**Given** any component rendering a panel, modal, badge, or row
**When** it applies a corner radius
**Then** it renders at 0px — no rounding anywhere

**Given** the accent token
**When** documented
**Then** its usage convention (active-selection/primary-action only, never a status color) is captured for later epics to follow

### Story 1.9: Read-Focused Display Components

As a developer,
I want the status-badge, list-row, and detail-pane components built against the Atelier theme,
So that every zone can display state consistently without re-implementing these primitives.

**Acceptance Criteria:**

**Given** `status-badge`
**When** rendered for any state (up/down, done/failed, in-progress, selection/action marker)
**Then** it always renders glyph and paired color together — never color alone

**Given** `list-row` unselected
**When** rendered
**Then** it shows base text on surface with a transparent accent-bar column
**And When** selected
**Then** it shows surface-selected fill, a solid accent bar, and the `›` marker ahead of the label

**Given** a nested `list-row`
**When** rendered
**Then** it is indented by the theme's indent token

**Given** a `list-row` with trailing metadata
**When** rendered
**Then** the metadata renders in text-dim, visually distinct from the label

**Given** `detail-pane` with a title
**When** rendered
**Then** the title is uppercase in label style
**And When** summarizing a run outcome
**Then** a `summary-line` top-rule colors to match the outcome

### Story 1.10: Interactive & Feedback Components

As a developer,
I want the modal-dialog, checkbox-list-item, splitter, spinner, and dim-annotation components built,
So that every zone needing confirmation, multi-select, resizing, progress, or optional asides can reuse them.

**Acceptance Criteria:**

**Given** `modal-dialog`
**When** opened
**Then** it renders on surface background with a bold-style border and square corners

**Given** an open modal
**When** the developer presses `Escape`
**Then** it closes/cancels
**And When** `Enter` is pressed
**Then** it confirms — identically regardless of trigger method

**Given** `checkbox-list-item`
**When** `Space` is pressed on the highlighted item
**Then** its state toggles (`[ ]`↔`[x]`)
**And When** `Enter` is pressed
**Then** the whole selection confirms

**Given** `splitter`
**When** dragged with the mouse
**Then** the boundary resizes directly
**And When** `Ctrl+W` is pressed
**Then** keyboard resize-mode engages (boundary recolors to accent, arrows resize, `Enter`/`Esc` exits)

**Given** `spinner`
**When** an action is in progress
**Then** it cycles the `⣾` glyph in info color and stops the instant the action completes

**Given** `dim-annotation`
**When** rendered beneath a message
**Then** it is italic, text-dim, indented, and never the sole carrier of required information

### Story 1.11: Permanent App Shell

As a developer,
I want the top bar, zone-tab bar, footer, and a generic resizable list/detail layout always present,
So that every zone is reachable from a consistent, always-visible navigation frame.

**Acceptance Criteria:**

**Given** the app is running
**When** any zone is active
**Then** the top bar, the six-zone tab bar, and the footer are all simultaneously visible on the background color

**Given** the zone-tab bar
**When** a zone is active
**Then** its tab shows accent fill + bold background-colored text
**And** every other tab is text-dim on background

**Given** a zone with a pending background event
**When** the developer is elsewhere
**Then** that zone's tab shows a glyph+counter badge in its status color, clearing once visited

**Given** a zone's content area using the list/detail pattern
**When** rendered
**Then** it shows a list pane and a detail pane divided by `splitter`, ~2:3 by default

**Given** cross-zone state
**When** any zone or CLI action updates it
**Then** it is read/written through exactly one Zustand store (scaffolded here with placeholder fields) — no zone keeps a duplicate copy

**Given** the six zones
**When** this story is complete
**Then** each has a placeholder screen mounted at its tab — none is missing or unreachable

> Amended 2026-08-24 (Sprint Change Proposal, Story 2.13): this AC described the state as of Story 1.9, before manifest-gated tab visibility existed. From Story 2.13 onward, Routes/shared-types may be fully omitted (no repo in the registry ever activates the module) or disabled-with-explanation (module exists in the registry but not on an active-EDT member) — a text correction to match the superseding contract, not a re-opening of a `done` story.

### Story 1.12: Launch Banner & Keybinding-Help Screen

As a developer,
I want a launch banner and a full keybinding reference reachable from anywhere,
So that I get a k9s-style first impression and never have to guess a key the footer doesn't show.

**Acceptance Criteria:**

**Given** the app starts
**When** the Dashboard first renders
**Then** a k9s-inspired ASCII banner shows once, monochrome, no motion/gradient

> Amended 2026-08-26 (Sprint Change Proposal, Story 2.16): "shows once" is superseded — the banner is now permanent on every Dashboard render, not a first-visit-only flash. Text correction, not a reopening of a `done` story.

**Given** any zone is active
**When** the developer presses `?`
**Then** a `modal-dialog` opens listing every keybinding plus its description, beyond the footer

**Given** the help modal is open
**When** content exceeds visible height
**Then** it scrolls with `j`/`k`
**And When** `Esc` or `?` is pressed again
**Then** it closes unchanged, read-only (no confirm action)

### Story 1.13: Canonical Keybinding Contract & Zone Navigation

As a developer,
I want the full canonical keybinding contract wired at the app level,
So that navigation and every interaction primitive behave identically across every zone from day one.

**Acceptance Criteria:**

**Given** any list pane
**When** arrow keys are pressed
**Then** the highlight moves
**And When** `Home`/`End` are pressed
**Then** it jumps to top/bottom — never switching zones

> Amended 2026-08-19 (Sprint Change Proposal): originally read `j`/`k` (or arrows) and `g`/`G`; the vim-style bindings were retired in favor of arrows/Home/End — see Story 2.7. Story 1.13 itself never wired list navigation (explicitly deferred to "Epic 2+"), so this is a text correction to match the superseding contract, not a re-opening of a `done` story.

**Given** the app is running
**When** `d`/`e`/`u`/`l`/`r`/`s` is pressed
**Then** the app switches directly to the corresponding zone from anywhere

**Given** the app is running
**When** `/` is pressed
**Then** a filter input opens for the current zone
**And When** `:` is pressed
**Then** command entry opens — both stubbed here, wired per-zone in later epics

**Given** no run is in progress
**When** `q` is pressed
**Then** the app quits immediately without confirmation (confirm-first arrives with Epic 3/4's runs)

**Given** every primitive from Stories 1.9–1.10
**When** exercised via keyboard only
**Then** every mouse-reachable action is also keyboard-reachable — nothing is mouse-only

## Epic 2: EDT Workspace Management

A developer can create, modify, and safely switch between EDTs (no uncommitted work ever lost), with branch/divergence visibility across every managed repo, and the guarantee that non-member repos stay on `development`.

### Story 2.1: Create an EDT

As a developer,
I want to create a new EDT with a topic and a manually selected set of member services,
So that I can start a coding session scoped to exactly the services I need.

**Acceptance Criteria:**

**Given** no EDT with a matching topic exists
**When** a developer creates an EDT with a topic and at least one selected member service
**Then** it is created, persisted in its own SQLite file at `XDG_DATA_HOME/tui-back/edts/<ulid>.db`
**And** it survives a tool restart (FR-3, AD-7)

**Given** an existing EDT named "X"
**When** a developer creates another also named "X"
**Then** creation is rejected with a clear "topic already exists" message before any file is written

**Given** no member service selected
**When** creation is attempted
**Then** it is rejected — at least one member is required

**Given** an EDT with member services
**When** a member is first touched within it
**Then** its working branch is recorded for that EDT

**Given** a service already a member of another EDT
**When** selected as a member of a new EDT
**Then** it is accepted, and each EDT independently tracks its own branch for it

**Given** no EDTs exist yet
**When** the EDTs zone opens
**Then** it shows an explicit prompt to create the first one — never a bare empty list

**Given** a bug/crash affecting one EDT's SQLite file
**When** another EDT's data is accessed
**Then** it is entirely unaffected (NFR-2)

### Story 2.2: Create Dev Branches at EDT Creation

As a developer,
I want to optionally have the tool create working branches for an EDT's member services at creation time,
So that I don't create each branch by hand before starting.

**Acceptance Criteria:**

**Given** branch-creation enabled
**When** a developer chooses a base branch (default `development`) and a naming mode (grouped/individual)
**Then** a working branch is created in each selected member accordingly

**Given** branch-creation disabled
**When** the EDT is created
**Then** it is created against each service's existing branch, no new branch created

**Given** grouped mode
**When** branches are created
**Then** every service gets the identical branch name
**And When** individual mode is chosen instead
**Then** each service's name is entered separately

**Given** one service's branch creation fails (base branch missing, name collision)
**When** the batch runs
**Then** the failure is reported per-service and does not abort creation for the others

**Given** a branch created this way
**When** the EDT is queried
**Then** it is registered as that service's EDT branch (feeds Story 2.6)

> Amended 2026-08-28 (Sprint Change Proposal, Story 2.22): the "branch-creation disabled" AC
> above is superseded on the TUI path — the TUI's create-EDT dialog no longer offers an
> enable/disable choice; branch creation is mandatory whenever ≥1 member is selected. `core/edt/
> create.ts` keeps accepting a no-branch-creation call shape for other driving adapters (no
> core/port change), but the shipped TUI never sends it anymore.

### Story 2.3: Git Branch-Scope Safety Gate & Shared-Branch Rejection

As a developer,
I want the tool to categorically refuse to register a shared branch as an EDT's own branch,
So that an EDT can never gain write authority over `development`/preprod/prod.

**Acceptance Criteria:**

**Given** any git write in the tool
**When** about to execute
**Then** it passes through the centralized git-adapter, which resolves the allowed-branch context itself from EDT/manifest state — never trusting a caller-supplied branch name (AD-8)

**Given** a developer attempts to register `development`/preprod/prod as an EDT's own branch (at creation via Story 2.2 or later via Story 2.5)
**When** attempted
**Then** it is rejected with a clear explanation before any git write happens (FR-7)

**Given** a write targeting a branch not the current EDT's own registered branch for that service
**When** attempted by any use-case
**Then** it never reaches `git` at all

### Story 2.4: Switch the Active EDT Without Data Loss

As a developer,
I want to switch the active EDT at any time without ever losing uncommitted work, with every non-member repo correctly reset,
So that I can move between concurrent work contexts safely.

**Acceptance Criteria:**

**Given** uncommitted changes in any repo of the outgoing EDT
**When** the developer switches EDT
**Then** those changes are auto-preserved before the switch — nothing is ever lost

**Given** the switch completes
**When** evaluated
**Then** exactly one EDT is active, every member service sits on that EDT's own registered branch, and every non-member managed service is on `development` (or configured shared branch) — regardless of that service's membership in a different, inactive EDT (FR-6, FR-8)

**Given** a non-member repo's `development` isn't present locally
**When** switched to
**Then** the tool fetches it first

**Given** a non-member repo also has uncommitted work
**When** switched
**Then** that work is preserved the same way as an outgoing member repo's

**Given** the outgoing EDT has an in-progress locked action (Story 1.7's per-resource lock)
**When** the developer attempts to switch away
**Then** the switch is blocked by default with a prompt to stop the action so the switch can proceed

**Given** the developer confirms stopping it
**When** they later return to that EDT
**Then** it shows the action was interrupted and offers to re-run it

**Given** the active EDT changes (TUI or CLI)
**When** persisted
**Then** `XDG_STATE_HOME/tui-back/state.json` is updated as the durable record (AD-10)

**Given** the TUI is open
**When** a CLI invocation changes the active EDT concurrently
**Then** the TUI's store re-syncs from `state.json` (via `fs.watch`/poll) without a restart

### Story 2.5: Modify an EDT After Creation

As a developer,
I want to add/remove member services, change a member's working branch, and rename the EDT's topic after creation,
So that my EDT can evolve as my work's scope changes.

**Acceptance Criteria:**

**Given** an existing EDT
**When** a developer adds a member
**Then** it is added without disturbing other members' recorded state

**Given** an EDT with multiple members
**When** one is removed
**Then** the others are undisturbed
**And** removing the last member is allowed, leaving zero members

**Given** a zero-member EDT
**When** queried
**Then** it is displayed as valid, never as an error

**Given** a developer changes a member's branch
**When** applied
**Then** it follows Story 2.4's protected-switch rule — no uncommitted work lost

**Given** a developer attempts to set a member's branch to a shared/protected branch
**When** attempted
**Then** it is rejected per Story 2.3

**Given** an existing EDT
**When** a developer renames its topic to a value not used by any other EDT
**Then** the rename succeeds and persists — the SQLite filename stays the ULID (AD-7), so no file rename/migration is needed

**Given** a developer attempts to rename an EDT's topic to one already used by another EDT
**When** attempted
**Then** the rename is rejected under the same uniqueness rule as creation (FR-3)

### Story 2.6: Branch and Divergence Visibility

As a developer,
I want to see every managed service's current branch and divergence from upstream,
So that I never run `git status`/`git log` by hand.

**Acceptance Criteria:**

**Given** a service with a configured upstream
**When** displayed
**Then** it shows the branch name and both ahead/behind counts

**Given** a service with no configured upstream
**When** displayed
**Then** it shows an explicit "no upstream" state, not a numeric value

**Given** the tool is offline
**When** divergence is displayed
**Then** it shows an explicit "unknown (offline)" state, not a stale/zero value

**Given** any managed service — EDT member or not (including ones kept on `development` per Story 2.4)
**When** the EDTs zone is viewed
**Then** its branch/divergence is shown uniformly

### Story 2.7: Canonical Navigation Contract (Arrows/Home/End/Tab)

As a developer,
I want arrows/Home/End/Tab as the sole list-navigation contract, with no `j`/`k`/`g`/`G` anywhere,
So that navigation doesn't require vim familiarity.

**Acceptance Criteria:**

**Given** any list pane
**When** arrow keys are pressed
**Then** the highlight moves

**Given** any list pane
**When** `Home`/`End` are pressed
**Then** it jumps to top/bottom — never switching zones

**Given** the app in any state
**When** `j`, `k`, `g`, or `G` are pressed
**Then** nothing happens — no list movement, no scroll, no zone switch

**Given** a multi-splitter zone or a form
**When** `Tab` is pressed
**Then** it cycles focus between fields/boundaries — unchanged from its existing role, never repurposed as a list-movement key

### Story 2.8: Fullscreen TUI Rendering

As a developer,
I want the TUI to take over the full terminal on launch, like k9s/lazygit,
So that the permanent chrome (top bar/tabs/footer) is always visible without scroll artifacts.

**Acceptance Criteria:**

**Given** the TUI launches in a TTY
**When** it starts rendering
**Then** it enters the terminal's alternate-screen buffer and the app shell fills exactly the terminal's current rows/columns

**Given** the terminal is resized while the TUI is running
**When** the resize event fires
**Then** the app shell re-renders to fill the new dimensions without visual artifacts

**Given** the TUI quits (`q`, Ctrl+C, or a crash)
**When** the process exits
**Then** the alternate-screen buffer is restored to the original terminal content — no leftover TUI output remains in the shell

### Story 2.9: EDTs Zone — Create, Switch, and Modify

As a developer,
I want to create, switch, and modify EDTs directly from the TUI's EDTs zone,
So that I no longer need the CLI for day-to-day EDT management.

**Acceptance Criteria:**

**Given** no EDT exists
**When** the EDTs zone opens
**Then** an explicit prompt offers to create one — topic input plus member selection via `checkbox-list-item`, calling `core/edt/create.ts` in-process (AD-2 parity with the CLI)

**Given** existing EDTs
**When** the developer selects a different one
**Then** `switchActiveEdt` runs in-process with Story 2.4's protected-switch behavior (uncommitted work preserved, locked-action block/prompt)

**Given** an existing EDT
**When** the developer edits its members, a member's branch, or its topic
**Then** `modifyEdt` runs in-process under Story 2.5's constraints (protected-branch rejection, topic uniqueness)

**Given** the EDTs zone's create/switch/modify flows
**When** built
**Then** they use Story 2.7's navigation contract (arrows/Home/End/Tab) — never the retired `j`/`k`/`g`/`G`

**Given** Story 2.6's service/divergence list
**When** the EDT selector is added
**Then** it stays visible alongside it — exact composition (grouped-by-EDT vs. the existing flat list) resolved at implementation time, per the Sprint Change Proposal's note

> Amended 2026-08-26 (Sprint Change Proposal, Story 2.18): resolved — the flat list is superseded by a member-of-selected-EDT / other-services split. Text correction, not a reopening of a `done` story.

### Story 2.10: Recover From an Already-Running TUI Instance

> Added 2026-08-24 (Sprint Change Proposal): extends NFR-6 / AD-9 mechanism 1 (single-TUI enforcement, delivered by Story 1.11) — no new FR. Appended to Epic 2 because its branch is still open (same rationale as stories 2.7-2.9), even though the affected code sits under Epic 1's territory.

As a developer,
I want the TUI to help me resolve a blocked launch instead of only refusing it,
So that a stale lock from a crashed session never locks me out permanently, and killing a genuinely running instance to replace it takes one keystroke instead of a manual `kill`/`rm` of the lock file.

**Acceptance Criteria:**

**Given** the TUI lock file records a pid that is no longer alive (a prior session crashed or was killed without releasing the lock)
**When** a developer launches the TUI
**Then** the stale lock is detected and automatically reclaimed, and the TUI starts normally — no prompt, no manual deletion of the lock file (closes the v1 gap where a dead-pid lock blocks every future launch forever)

**Given** the TUI lock file records a pid that is still alive (a genuinely running TUI instance)
**When** a developer launches a second TUI instance in an interactive terminal
**Then** the tool prompts, naming the existing instance's pid and start time, offering to kill it and take over

**Given** that prompt
**When** the developer confirms
**Then** the tool signals the existing process to terminate, waits briefly for it to release the lock, force-terminates it if it hasn't exited in time, then acquires the lock and starts normally

**Given** that prompt
**When** the developer declines (or gives no input)
**Then** the tool exits 1 with today's "Another TUI instance is already running" message, unchanged — nothing is killed, nothing is deleted

**Given** stdin/stdout is not an interactive TTY (a script or CI invocation)
**When** the lock is held by a live pid
**Then** no prompt is ever shown — it refuses immediately with today's message and exit code 1, exactly as now

**Given** the developer confirms killing the existing instance
**When** the tool lacks permission to signal that pid (e.g. it's owned by another user)
**Then** the failure is clearly reported and the tool exits 1 — it never falls through to deleting the lock file out from under a process it failed to actually stop

**Given** a CLI subcommand (non-TUI)
**When** invoked while a TUI holds the lock
**Then** it is never affected by this story — AD-9 mechanism 1 (single-TUI enforcement) stays scoped to the interactive TUI's own launch path only

### Story 2.11: Repo Registry Screen & Manifest Onboarding Guidance

> Added 2026-08-24 (Sprint Change Proposal): a TUI front-end over the already-decided `scan`/`register` mechanism (AD-6, Story 1.5, `done`) plus static manifest-creation guidance — not the PRD's deferred guided onboarding wizard or AI-assisted manifest bootstrapping (§5/§6.2 Non-Goals, untouched). Appended to Epic 2 because its branch is still open (same rationale as stories 2.7-2.10), even though the affected mechanism sits under Epic 1's territory.

As a developer,
I want a TUI screen to scan a root path for repos already carrying a manifest, register the ones I select, and see clear static guidance on creating a manifest for repos that don't have one yet,
So that I can populate the tool's repo registry — on first use or any time later — without dropping to a separate CLI command.

**Acceptance Criteria:**

**Given** zero registered repos
**When** the TUI launches
**Then** Dashboard shows an explicit "no repos registered yet" prompt (never a bare empty EDT prompt), offering to open the registry screen — chains before Story 2.1/UX-DR19's existing "no EDT yet" state

**Given** the registry screen
**When** opened
**Then** it always shows static manifest-creation guidance (manual `.tui-back.yaml` per Story 1.4's schema, or the manifest-generator skill run in the target repo) alongside the scan/register controls — not just on first launch

**Given** a root path
**When** the developer triggers a scan
**Then** it lists every candidate manifest-carrying directory found (Story 1.5's `scan`, AD-6), via `checkbox-list-item` (UX-DR9) for multi-select

**Given** one or more candidates selected
**When** confirmed
**Then** each selected path is registered (Story 1.5's `register`) and the outcome is reported per-path (registered / already-registered / failed)

**Given** a scan finds nothing
**When** displayed
**Then** it's a distinct "no manifest-carrying repos found here" state — never indistinguishable from a scan failure

**Given** this screen
**When** exercised via keyboard only
**Then** every action is reachable without a mouse (Story 1.9's standing rule)

**Implementation notes:** reuses Story 1.5's existing `scan`/`register` use-cases — no new port/adapter. Reachable as a registered command in the `:` command-entry bar (Story 2.14) — not bound directly to the `:` keypress itself. The exact manifest-generator skill invocation text is to be verified at build time.

> Amended 2026-08-25 (Sprint Change Proposal, Story 2.14): the original implementation bound `:` directly to opening this screen — a misreading of UX-DR13/UX-DR16's "`:` opens command entry" as a single hardcoded action rather than the generic, extensible command input it always described (stubbed since Story 1.13). The registry screen is now reachable only as a registered command inside Story 2.14's `:` command-entry bar.

### Story 2.12: Zone Arrow Navigation

> Added 2026-08-24 (Sprint Change Proposal): purely additive to the canonical keybinding contract (Stories 1.13/2.7, `done`) — a new zone-switching input that never touches list-navigation or `Tab`'s existing role inside forms/resize-mode.
>
> Amended 2026-08-25 (story 2.12 review loopback): the original design (`Tab` moves focus onto the zone-tab bar; `Left`/`Right` only highlights a tab; `Enter` confirms the switch; `Esc`/`Tab` releases focus) left that focus state stuck on the tab bar whenever a global overlay (`?`/`/`/`:`) opened and closed while it was active, since nothing blurred it — a real, reproducible bug caught in review. Renegotiated to drop the focus-mode state machine entirely: `Left`/`Right` now switch the active zone directly and are always available; `Tab` keeps exactly its pre-story role with zero shell-level involvement. Superseded ACs below are rewritten to match (text correction, not a re-opening).

As a developer,
I want to switch zones with the left/right arrow keys,
So that I can switch zones without memorizing or reaching for the single-letter mnemonics.

**Acceptance Criteria:**

**Given** content focus (nothing capturing input, no overlay open)
**When** `Right` is pressed
**Then** the active zone switches directly to the next zone in tab-bar order

**Given** the same preconditions
**When** `Left` is pressed
**Then** the active zone switches directly to the previous zone in tab-bar order

**Given** the active zone is the last (or first) in tab-bar order
**When** `Right` (or `Left`) is pressed
**Then** it wraps to the first (or last) zone (skips fully-omitted tabs, lands on disabled ones per Story 2.13)

**Given** a zone dialog has captured input, or a global overlay (help/filter/command) is open
**When** `Left`/`Right` is pressed
**Then** nothing happens — same gate the zone mnemonics already use

**Given** any state, including a form or resize-mode (`Ctrl+W`)
**When** `Tab` is pressed
**Then** it behaves exactly as it did before this story — no shell-level `Tab` handling was added; Story 2.7's AC stays true, unamended

**Given** any state
**When** a zone mnemonic (`d`/`e`/`u`/`l`/`r`/`s`) is pressed
**Then** it switches zones immediately as today — unaffected by this story

**Implementation notes:** a pure wrap function over the zone-tab order (`nextZoneId`) plus one dispatch branch beside the existing mnemonic dispatch in `AppShell`. No new store state, no core/port change — `adapters/driving/tui` only.

### Story 2.13: Manifest-Gated Zone Tab Visibility & Disabled State (Routes & shared-types)

> Added 2026-08-24 (Sprint Change Proposal): supersedes `EXPERIENCE.md`'s original "Routes and shared-types are always-present, never conditionally hidden" decision with a two-tier rule, refined interactively — a blunt hide-when-unused was rejected in favor of hidden-only-when-globally-absent-from-the-registry, disabled-with-explanation otherwise. Amends Story 1.9's AC (text correction, not a re-opening).

As a developer,
I want `Routes` and `shared-types` to disappear only when no registered repo anywhere could ever use them, and otherwise show as disabled with a clear reason when my active EDT just doesn't need them right now,
So that the tab bar never lies about what's possible, while still decluttering when a capability is genuinely absent from my machine's registry.

**Acceptance Criteria:**

**Given** zero repos in the entire registry activate a route-explorer module
**When** the tab bar renders
**Then** `Routes` is fully omitted — mnemonic and arrow-navigation never land on it; the same rule applies to `shared-types` if zero registered repos declare `shared-types-source` or `shared-types-consumer`

**Given** at least one registered repo activates the module, but the active EDT has no qualifying member
**When** the tab bar renders
**Then** the tab is shown in a distinct disabled visual state (dimmed/strikethrough — see `DESIGN.md`)

**Given** a disabled tab
**When** reached (mnemonic, or `Left`/`Right` direct zone switching, Story 2.12)
**Then** it becomes the active zone and shows a single explanatory message instead of the normal zone screen — e.g. `Routes`: "Aucun de vos services dans cet EDT ne contient de routes ! Les repos avec des routes sont : `api-gateway`, ..."; `shared-types`: "Le repo `shared-types` (qui importe le module `shared-types-source`) ne fait pas partie de votre EDT actif."

**Given** a fully-omitted tab
**When** its mnemonic is pressed or the tab bar is arrow-navigated
**Then** it is skipped entirely — never landed on, unlike the disabled case

**Given** the active EDT's membership changes
**When** a tab's enabled/disabled state changes as a result
**Then** the tab bar updates immediately; if the currently active zone becomes disabled, its content switches to the explanatory message in place — no forced navigation away

**Given** the repo registry changes (Story 2.11)
**When** that changes whether any repo anywhere has the module
**Then** a tab can newly appear or disappear entirely; if the active zone's tab disappears this way, the app falls back to Dashboard

**Implementation notes:** the registry-wide check requires loading manifests for all registered repos (not just active-EDT members) at shell level — verify this doesn't complicate the cold-load spinner state (UX-DR19). The `shared-types-source` module id and the git-ancestry version-resolution mechanism it feeds are specified further under Epic 4's Story 4.1/4.2 (amended below).

### Story 2.14: Command Entry Bar (`:`) & Registered Commands

> Added 2026-08-25 (Sprint Change Proposal): corrects Story 2.11, whose implementation bound `:` directly to opening the repo registry screen — a misreading of UX-DR13/UX-DR16's "`:` opens command entry," which describes a generic, extensible command input (stubbed since Story 1.13), not one hardcoded action. Appended to Epic 2 because its branch is still open (same rationale as stories 2.7–2.13), even though the affected keybinding stub sits under Epic 1's territory (Story 1.13).

As a developer,
I want `:` to open a real command-entry bar — type a registered command name, `Tab` to autocomplete, `Enter` to run it, `Esc` to cancel — with the repo registry screen wired as its first registered command,
So that `:` behaves like the terminal-style command entry the keybinding contract always promised, and future actions can be added as new commands without re-binding a key each time.

**Acceptance Criteria:**

**Given** content focus (no overlay open)
**When** `:` is pressed
**Then** a command-entry bar opens with an empty, focused text input and the full list of registered commands shown

> Amended 2026-08-26 (Sprint Change Proposal, Story 2.17): "the full list of registered commands shown" on open is superseded — nothing shows until `Tab` is pressed (see UX-DR29/UX-DR30). Text correction, not a reopening of a `done` story.

**Given** the command bar open with some text typed
**When** the input changes
**Then** the shown command list filters to commands whose name starts with the typed text (case-insensitive) — an empty input shows every command, no match shows an explicit "no matching command" state

**Given** the command bar open
**When** `Tab` is pressed and exactly one command matches the current input
**Then** the input is completed to that command's full name
**And When** `Tab` is pressed with zero or more than one match
**Then** nothing changes

**Given** the command bar open with text that exactly matches a registered command's name
**When** `Enter` is pressed
**Then** that command executes and the bar closes
**And When** `Enter` is pressed with text matching no registered command exactly
**Then** the bar stays open and shows an explicit "unknown command" message — never executes anything silently

**Given** the command bar open
**When** `Esc` is pressed
**Then** it closes without executing anything, discarding the typed text

**Given** the registry screen (Story 2.11)
**When** it is opened
**Then** it is opened only by running its registered command (e.g. `registry`) through this bar — `:` itself never opens it directly

**Given** another overlay is already open (help, filter, registry screen, or the command bar itself)
**When** `:` is pressed
**Then** nothing happens — the command bar never stacks on top of another overlay

**Given** the command bar is open
**When** `Tab` is pressed
**Then** it is fully consumed by autocomplete — `Tab` has no zone-switching role to conflict with (Story 2.12 uses `Left`/`Right`, not `Tab`)

**Given** this bar
**When** exercised via keyboard only
**Then** every action (type, filter, autocomplete, run, cancel) is reachable without a mouse (Story 1.9's standing rule)

**Implementation notes:** the command registry is a small in-memory, statically-defined list (command name → handler) in `adapters/driving/tui` — no core/port change, mirrors Story 2.11's own "no new port/adapter" rule. Visual treatment reuses the existing `modal-dialog` + `list-row` components (see amended `DESIGN.md`/`EXPERIENCE.md`) rather than introducing new chrome. Only one command (`registry`) is registered by this story; the dispatch mechanism itself is the deliverable — adding a second command later is registry-only, no shell-level change.

### Story 2.15: EDT Commands in Command Bar & Action History in Detail Pane

> Added 2026-08-26: completes Story 2.9's EDT management by exposing create/switch/modify as `:` commands (coexisting with Enter-key shortcuts) and adding an action feed to the EDT detail pane so developers can see what happened, what's happening, and what's possible.

As a developer,
I want `edt-create`, `edt-switch`, and `edt-modify` available in the `:` command bar, and the EDT detail pane to show recent actions, any in-progress action, and available actions for the selected EDT,
So that I can manage EDTs from the command bar without memorizing zone-specific shortcuts, and always have visibility into what actions occurred on each EDT.

**Acceptance Criteria:**

**Given** the command bar is open (no overlay)
**When** the developer types `edt-create` and presses `Enter`
**Then** the create EDT dialog opens (same dialog as Story 2.9's Enter-on-empty-list or zero-EDT prompt)

**Given** the command bar is open
**When** the developer types `edt-switch` and presses `Enter`
**Then** a quick-pick list of non-active EDTs appears; selecting one opens the switch-confirm dialog

**Given** the command bar is open with `edt-switch my-topic`
**When** `Enter` is pressed
**Then** if `my-topic` matches a non-active EDT, the switch-confirm dialog opens pre-targeted; else an inline "EDT not found" error shows in the command bar

**Given** the command bar is open
**When** the developer types `edt-modify` and presses `Enter`
**Then** a quick-pick list of all EDTs appears; selecting one opens the modify dialog pre-targeted

**Given** an EDT row is focused in the EDT selector list
**When** the detail pane renders
**Then** it shows an "Actions" section with: any in-progress action (with spinner/glyph), the last 5 actions (timestamp, type, outcome, detail), and a line of available actions (e.g. `[Enter] Switch  [c] Create  [m] Modify`)

**Given** an EDT action (create/switch/modify) completes
**When** the detail pane is viewed for that EDT
**Then** the action appears in the recent actions list with its outcome (success/failed) and detail

**Given** a command-triggered dialog is open
**When** the developer types any character including `?`
**Then** no AppShell global shortcut fires (the `zoneInputCaptured` gate works identically to Enter-triggered dialogs)

**Implementation notes:** reuses the exact dialog state machines from `edts-zone.tsx` (extract shared open-dialog functions or call the same store actions). Action history stored per-EDT in each EDT's SQLite (`action_log` table: id, timestamp, action_type, outcome, detail_json) — extends `EdtRegistryPort` with `logAction`/`getActionLog`. Command handlers parse their own args from the full query string (e.g. `edt-switch my-topic`). The `DetailPane` currently wraps children in a single `<Text>` — format the Actions section as a joined string with `DimAnnotation` for timestamps and outcome glyphs (`✔`/`✖`), no live spinner in detail pane (static `⣾` glyph for in-progress). Follows the existing pure-interpreter + `useInput` pattern; command bar filtering/autocomplete unchanged.

> Amended 2026-08-26 (Sprint Change Proposal, Story 2.18): the static "`[Enter] Switch  [c] Create  [m] Modify`" available-actions hint in this story's AC5 is superseded — `c`/`m` were never wired to any keypress, and the hint now shows exactly the action `Enter` will actually perform in context. Text correction, not a reopening of a `done` story.

### Story 2.16: Permanent Dashboard Banner

> Added 2026-08-26 (Sprint Change Proposal): reverses Story 1.12/UX-DR14's "shown once, on launch" banner behavior — the ASCII banner now stays part of the Dashboard's permanent content, not a first-visit-only flash. Appended to Epic 2 because its branch is still open (same rationale as stories 2.10/2.11), even though the affected code sits under Epic 1's territory (Story 1.12, `done`).

As a developer,
I want the k9s-inspired ASCII banner to stay visible on the Dashboard every time I look at it, not just the first time I launch the tool,
So that the Dashboard keeps its branded first impression permanently instead of losing it after one visit.

**Acceptance Criteria:**

**Given** the app starts
**When** the Dashboard first renders
**Then** the banner shows, exactly as today (monochrome, no motion/gradient)

**Given** the Dashboard has already been viewed once (this session or a prior one)
**When** the Dashboard renders again
**Then** the banner still shows, identically — never conditionally hidden after a first visit

**Given** any other Dashboard state (empty-registry prompt, populated view, no-EDT prompt)
**When** rendered
**Then** the banner renders above that content, never replacing or being replaced by it (same "above/within the content area" layout as today)

**Given** the `launchBannerShown` store flag existed solely to gate first-visit-only display
**When** this story lands
**Then** that flag (and the effect that flips it after first view) is removed — the banner render becomes unconditional, not state-gated

**Implementation notes:** `dashboard-zone.tsx` currently renders `{launchBannerShown ? null : <LaunchBanner />}`; becomes an unconditional `<LaunchBanner />`. `launchBannerShown` state/action in `app-store.ts` is dead code to remove. Test assertions in `launch-banner.test.tsx`/`dashboard-zone.test.tsx` flip from "hidden after first visit" to "always visible."

### Story 2.17: Terminal-Style Command Bar Autocomplete & Grid Browser

> Added 2026-08-26 (Sprint Change Proposal): supersedes Story 2.14/UX-DR29's "the full list of registered commands shown" on open — the command bar now behaves like a shell's Tab-completion (common-prefix completion, double-Tab-to-list, arrow-navigable multi-column browser) instead of always showing every command. Appended to Epic 2 — same territory as Story 2.14/2.15's command bar, branch still open.

As a developer,
I want the `:` command bar to behave like a real shell's Tab-completion (nothing shown until I ask for it, common-prefix completion, a browsable grid on demand),
So that the command bar feels like the terminal experience the rest of the app already promises, instead of dumping every command on me the moment I open it.

**Acceptance Criteria:**

**Given** the command bar just opened (empty input)
**When** no key has been pressed yet
**Then** no command list is shown — only the empty, focused input (supersedes Story 2.14 AC1's "full list of registered commands shown")

**Given** the input is empty
**When** `Tab` is pressed
**Then** the full command grid is shown immediately (no double-press needed — there is nothing to complete against an empty input)

**Given** the input is non-empty and exactly one command matches its start
**When** `Tab` is pressed
**Then** the input completes to that command's full name (unchanged from Story 2.14 AC3)

**Given** the input is non-empty and multiple commands match its start, and every match shares a common prefix longer than the current input
**When** `Tab` is pressed
**Then** the input completes up to that longest common prefix (not to a full name, since more than one still matches)

**Given** the input already sits at every match's longest common prefix and more than one command still matches
**When** `Tab` is pressed once
**Then** nothing visibly changes (the same "nothing changes" case as today), but the press is recorded as a pending completion attempt

**Given** that pending state
**When** a second `Tab` is pressed within the double-press window (default 500ms, one named constant) with the query unchanged
**Then** the command grid is shown, listing every currently-matching command
**And When** the window elapses, or any other key is pressed first, or the query changes
**Then** the pending state is discarded — a later `Tab` starts the sequence over

**Given** the command grid is shown (by either path above)
**When** it renders
**Then** matching commands lay out column-major, left to right, at most **N** rows per column — `N` a single named, easily-changed constant (e.g. `COMMAND_GRID_MAX_ROWS`) — column width sized to its longest label

**Given** the full grid's width exceeds the modal's available display width
**When** rendered
**Then** only as many complete columns as fit are shown, with a trailing `…` marker indicating more columns exist beyond what's visible — never a silently cut-off partial column

**Given** the grid is visible and focus is on the input
**When** `Down` is pressed
**Then** focus moves into the grid, landing on the first visible cell (top of the first column)
**And When** the grid is not visible
**Then** `Down` does nothing

**Given** focus is in the grid
**When** `Up`/`Down` is pressed
**Then** it moves the highlighted cell one row up/down within the current column, clamped to that column's row count
**And When** `Left`/`Right` is pressed
**Then** it moves the highlight to the adjacent column, same row index (clamped to that column's last row if shorter)

**Given** focus is in the grid, on the top row of the current column (row 0)
**When** `Up` is pressed
**Then** focus returns to the input (cursor at end of the current text) — this is the only way back to the input from the grid

**Given** the grid is truncated (the `…` marker is showing) and focus is on the rightmost visible column
**When** `Right` is pressed
**Then** the visible window scrolls one column right, revealing the next hidden column (and re-evaluating whether `…` still applies on that side)
**And** the same rule applies symmetrically for `Left` at the leftmost visible column when earlier columns are scrolled out of view

**Given** focus is in the grid
**When** `Enter` is pressed on the highlighted cell
**Then** the input completes to that command's full name and focus returns to the input (matching a completed `Tab`, not an immediate run — the developer may still append arguments)

**Given** focus is in the grid
**When** any printable character is typed
**Then** focus returns to the input, the character is appended, and grid navigation state resets (mirrors a normal shell's menu-complete-on-typing behavior)

**Given** the command bar in any focus state (input or grid)
**When** `Esc` is pressed
**Then** the entire bar closes without executing anything — unchanged from Story 2.14 AC5

**Given** the input changes (typing or backspacing) while the grid is visible
**When** the change happens
**Then** the grid re-filters live to the new match set (or hides again if the developer is back to a single unambiguous match) — never shows a stale command list

**Implementation notes:** extend `command-bar.tsx`'s pure functions (mirroring `resolveTabAutocomplete`'s existing style): `longestCommonPrefix(matches)`, a `TabPressState` (`{ query: string; at: number } | null`) driving the double-press window, and a grid-layout pure function `layoutCommandGrid(matches, maxRows, availableWidth) → { columns, truncated }` plus a `scrollOffset` for the horizontal-window case — all directly unit-testable without mounting Ink, per this file's existing convention. Grid focus is new local state (`focus: 'input' | 'grid'`, `gridCursor: { column, row }`) in the `CommandBar` component itself, not the app store (mirrors `edts-zone.tsx`'s local `paneFocus`/`dialog` state). Grid cells render as plain colored `<Text>` (accent + `›` on the highlighted cell, text-dim otherwise) — `ListRow` is full-width, unsuited to a compact grid cell, so this needs its own rendering, not a `ListRow` reuse.

> Amended 2026-08-26 (Sprint Change Proposal, Story 2.19): `COMMAND_GRID_MAX_ROWS` becomes a settings-overridable default, not a fixed constant only code can change.

### Story 2.18: EDT Zone — Active Highlight, Fixed-Width Detail Pane, Categorized Services & Per-Service Actions

> Added 2026-08-26 (Sprint Change Proposal): extends Story 2.6/2.9/2.15's EDTs zone — makes the active EDT visually distinct, stabilizes the detail pane's horizontal position, splits the flat service list into "member of selected EDT" / "other" categories, extends Tab-cycling to a third pane, and adds per-service contextual actions. No core/port change beyond loosening one existing TUI-side gate (`canEditMemberBranch`) — `modifyEdt` already supports every operation needed (add/remove/set-branch). "Restart" is deferred (no Docker integration exists anywhere in the codebase yet — that's Epic 5's Story 5.3 and partially Epic 3's Story 3.1, both `backlog`); this story ships it as a visibly disabled action annotated "Available with Epic 5."

As a developer,
I want to see at a glance which EDT is active, a detail pane whose position doesn't shift as I browse EDTs, my services grouped by whether they belong to the EDT I'm looking at, and quick per-service actions (add/remove/change branch) without opening the full Modify form,
So that the EDTs zone reads at a glance instead of requiring me to cross-reference the member list by hand every time.

**Acceptance Criteria:**

**Given** the EDT selector list
**When** rendered
**Then** the active EDT's row renders its label in `{colors.accent}`, bold — independently of whether that row is also the keyboard cursor's current position — so it stays visually distinct even when a different row is highlighted (extends `list-row`'s existing `selected` prop with a new `active` prop; never removes the existing accent-bar+`›`-marker cursor treatment)

> Amended 2026-08-27 (Sprint Change Proposal, Story 2.21): superseded — the accent+bold
> treatment moves to a new `emphasized` prop, driven by the row whose membership currently
> drives the EDT SERVICES/OTHER SERVICES split (`index === clampedEdtsSelected`, persists
> across all three panes), not the tool-wide active EDT. `active` (repurposed) now renders a
> discreet `{colors.info}` `" active"` suffix next to that row's meta text instead. The two
> indicators are decoupled and can land on the same row or different rows. Text correction, not
> a reopening of a `done` story (branch was still `review`, unmerged, when amended).

**Given** the EDT detail pane
**When** rendered for any EDT or service, regardless of its content's length
**Then** its horizontal position and width stay fixed — derived once from the list/detail split ratio, never recomputed from either pane's content — so the left/right boundary never shifts as you browse EDTs or services

**Given** the detail pane's content (recent actions, member list)
**When** it's longer than usual
**Then** the box simply extends downward to fit it — there is nothing else in the right column below it to disturb, so no fixed height, no padding, and no scroll/truncation mechanism is needed for this story; the terminal's own height is the only natural limit, and that's an existing constraint of the whole app, not something this story introduces

**Given** the EDT selector's focused row
**When** the detail pane's "available actions" hint renders
**Then** it shows exactly the action `Enter` will actually perform in that context (`[Enter] Modify` when the focused row is the active EDT, `[Enter] Switch` otherwise) and never lists a key that isn't currently a real binding — Story 2.15's static "Switch / Create / Modify" hint text is superseded, since `c`/`m` were never wired as direct keys

**Given** the flat services list (Story 2.6)
**When** an EDT row has focus/selection in the EDT selector (whether or not it's the active one)
**Then** the services list splits into two labeled groups: **"EDT SERVICES"** (services whose path is a member of the currently-*selected* EDT — computed client-side from that EDT's own `members` list, independent of `isMember`, which stays tied to the *active* EDT for its existing divergence-badge purpose) and **"OTHER SERVICES"** (every other registered service)

**Given** no EDT exists or none is selected yet
**When** the services list renders
**Then** every service falls under "OTHER SERVICES" with an explanatory note ("No EDT selected") instead of a misleading empty "EDT SERVICES" group

**Given** the base EDT-list view (no dialog open)
**When** `Tab` is pressed
**Then** focus cycles through three panes in order — EDT selector → EDT SERVICES → OTHER SERVICES → back to EDT selector — each independently arrow/Home/End-navigable, extending Story 2.9's two-way toggle to a three-way cycle

**Given** focus is on a row in EDT SERVICES (a member of the selected EDT)
**When** `Enter` is pressed
**Then** a small contextual action menu opens: **Remove from EDT**, **Change branch for this EDT**, and **Restart** (shown disabled with the annotation "Available with Epic 5" — no action fires; consistent with this Sprint Change Proposal's decision to defer restart, no new core/docker adapter introduced by this story)

**Given** "Remove from EDT" is chosen
**When** confirmed
**Then** it calls `modifyEdt` with `removeMembers: [repoPath]` for the selected EDT (same underlying call Story 2.5/2.9 already use), with the same inline-error/loading treatment as the existing Modify submit, and logs a `modify` action-log entry (Story 2.15) with a one-line detail (e.g. "Removed service X")

**Given** "Change branch for this EDT" is chosen
**When** confirmed with a non-empty branch name
**Then** it calls `modifyEdt` with `setBranches: [{repoPath, branch}]` for the selected EDT (reuses the existing branch-edit text-input UI and `validateBranchEditValue` inline-empty-check, Story 2.9), follows Story 2.4's protected-switch rule, and logs a `modify` action-log entry

**Given** focus is on a row in OTHER SERVICES (not a member of the selected EDT)
**When** `Enter` is pressed
**Then** an "Add to EDT" flow opens: a branch text-input pre-filled with that service's current branch (from Story 2.6's data), which the developer can leave as-is or replace with an existing or new branch name — confirming calls `modifyEdt` with both `addMembers: [repoPath]` and `setBranches: [{repoPath, branch}]` in the same call, and logs a `modify` action-log entry (e.g. "Added service X (branch Y)")

**Given** `canEditMemberBranch` (Story 2.9) currently only allows branch-editing an *existing* member of the target EDT
**When** this story lands
**Then** that gate is loosened to allow branch-editing any *selected* candidate (existing member or one just being added) — required for "Add to EDT" above; `resolveModifyOps`'s `setBranches` filter already supports this (it only checks `selectedPaths`, not prior membership) — verify at implementation time whether `modifyEdt`'s internal ordering applies `addMembers` before `setBranches` for the same repo path within one call (flagged for the implementer, not resolved here)

**Given** the detail pane while focus is on EDT SERVICES or OTHER SERVICES
**When** rendered
**Then** the "available actions" hint line reflects that pane's context (e.g. `[Enter] Remove / Change branch` for a member row, `[Enter] Add to EDT` for a non-member row) instead of the EDT-selector's `[Enter] Switch [c] Create [m] Modify` line

**Implementation notes:** `ListRow` gains an `active?: boolean` prop (default `false`, `labelColor: accent, bold: true` when set — additive, no visual change to any existing caller that doesn't pass it). `PaneFocus` becomes a 3-value type (`'edts' | 'edt-services' | 'other-services'`); `togglePaneFocus` becomes a `cyclePaneFocus` 3-way rotation, mirroring the existing pure-function convention. Category partitioning is a pure function (e.g. `partitionServicesByEdtMembership(rows, focusedEdt)`), directly unit-testable. The contextual action menu and "Add to EDT" branch input reuse `ModalDialog` + the existing branch-edit text-input pattern — no new component. All new dialog states log through the existing `logEdtAction` (Story 2.15) — no new action type.

> Amended 2026-08-26 (Sprint Change Proposal, Story 2.19): the EDT detail pane's list of shown "available actions" hints becomes settings-overridable (per-hint hide list); nothing hidden by default.

### Story 2.19: Global Settings Screen (`:settings`)

> Added 2026-08-26 (Sprint Change Proposal): introduces a persisted user-preferences surface, reachable via the `:` command bar (Story 2.14), tab-organized — a "General" tab plus one tab per feature area that has settings (starting with EDTs and the Command Palette). First TUI surface that needs config the manifest/registry model doesn't cover — extends AD-7's storage topology (additive, not a rewrite) rather than reusing per-EDT/global SQLite. Appended to Epic 2 because its branch is still open; seeds the two settings Story 2.17 (command palette) and Story 2.18 (EDT detail pane) reference.
>
> Amended 2026-08-28 (Sprint Change Proposal): the "EDTs" tab's real intent was under-specified on first pass — the original AC only captured per-pane hint-visibility (below), never Max's actual second ask for this tab: filtering which action *types* (`create`/`switch`/`modify`, Story 2.15) show in the EDT detail pane's "Recent actions" log. Discovered during real-usage review of the implemented story (branch not yet merged). Corrects the "EDTs" tab AC below (now two settings groups behind a drill-down) and the global `Esc` AC (now scoped to "no group drilled into"); every other AC, and everything already implemented for the Command Palette tab, `settings.yaml` persistence, and corrupt-file fallback, stays exactly as shipped (KEEP).

As a developer,
I want a single settings screen, organized by tab, where I can adjust the tool's configurable behaviors (starting with the command palette's grid density and which EDT-detail actions show),
So that these preferences are discoverable in one place and persist across sessions, instead of being fixed constants only a code change could adjust.

**Acceptance Criteria:**

**Given** the command bar is open
**When** the developer types `settings` and presses `Enter`
**Then** the settings screen opens as a `modal-dialog` instance, defaulting to the "General" tab

**Given** the settings screen is open
**When** `Left`/`Right` (or `Tab`) is pressed
**Then** focus cycles between the available tabs — "General", "EDTs", "Command Palette" for this story — mirroring the zone-tab bar's own active/inactive visual treatment at a smaller scale

**Given** the "Command Palette" tab
**When** viewed
**Then** it shows a single numeric setting — the max rows per grid column (Story 2.17) — editable, defaulting to that story's constant, with `Up`/`Down` (or typed digits) adjusting it, applied immediately to the live command bar without restarting the tool

**Given** the "EDTs" tab
**When** first opened
**Then** it shows an Up/Down-navigable list of two settings groups — "Hint visibility" and "Recent action types" — each row marked with a `›` cursor when highlighted, no checkboxes at this level

**Given** the "EDTs" tab's group list, a group highlighted
**When** `Enter` is pressed
**Then** it drills into that group's own `checkbox-list-item` list:
- "Hint visibility" — the EDT detail pane's available-action hints (Story 2.18) the developer can hide from that display, one row per hint token — unchecked by default (nothing hidden)
- "Recent action types" — the EDT detail pane's "Recent actions" log entry types (`create`/`switch`/`modify`, Story 2.15), one row per type the developer can hide from that log — unchecked by default (nothing hidden)

toggling either group's checkboxes (`Space`) applies immediately, same as before

**Given** a group's checkbox list is open (drilled in)
**When** `Esc` is pressed
**Then** it steps back up to the group list — the whole settings screen does not close

**Given** the "General" tab
**When** viewed
**Then** it renders without error even with zero settings in it yet (an empty-but-valid tab, same "never an error" convention as a zero-member EDT) — a placeholder for future global preferences, not a defect

**Given** any setting change
**When** made
**Then** it persists immediately (no separate "save" step) to a new per-user settings store — `XDG_CONFIG_HOME/tui-back/settings.yaml`, zod-validated on load like the manifest (AD-4's validation convention) — and survives a tool restart

**Given** a corrupt or invalid `settings.yaml`
**When** loaded
**Then** the tool falls back to every setting's default rather than crashing, and surfaces a clear (non-blocking) warning — mirrors the manifest's "clear validation error naming the field, never a generic crash" rule

**Given** the settings screen, no tab-internal group drilled into (General tab, Command Palette tab, or the EDTs tab's own group list)
**When** `Esc` is pressed
**Then** the whole screen closes — there is nothing to discard, since every change already applied live (the EDTs tab's group-level `Esc`, defined above, steps back one level first instead)

**Given** this screen
**When** exercised via keyboard only
**Then** every action is reachable without a mouse (Story 1.9's standing rule)

**Implementation notes:** new `core/ports/settings.ts` (`SettingsPort`: `load`/`save`, zod schema) + `adapters/driven/settings` (YAML file, mirrors `adapters/driven/registry`'s shape) — the first new port this Sprint Change Proposal actually requires. `adapters/driving/tui` consumes it through the Zustand store (a `settings` slice, loaded once at startup, updated optimistically on every change) — Story 2.17's `COMMAND_GRID_MAX_ROWS` constant becomes that setting's default value, not a replacement; Story 2.18's hidden-actions list gates which hint tokens the "available actions" line includes. New `settings` entry in `commands.ts`'s `COMMANDS` array, same shape as `registry`.

**Amended 2026-08-28 (Sprint Change Proposal):** `Settings.edts` gains a second field, `hiddenActionTypes: string[]` (values among `create`/`switch`/`modify`), alongside the existing `hiddenActionHints: string[]` — both zod-validated with the same "corrupt/invalid falls back to defaults" convention. `edts-zone.tsx`'s `formatEdtActionHistory` filters `actionLog` by `actionType` against `hiddenActionTypes` before rendering the "Recent actions:" list (new parameter, same live-read-no-cache pattern as `resolveActionHint`'s `hiddenActionHints`). The settings screen's EDTs tab gains a group-list level (its own small pure state machine, `resolveSettingsTabState`-style) ahead of the two now-separate checkbox lists; `Esc`'s handling becomes tab-aware (only the EDTs tab has a group level to step back out of).

### Story 2.20: Top Bar & Footer Hint Accuracy Fixes

> Added 2026-08-26 (Sprint Change Proposal): fixes two UX-DR7/UX-DR13 violations found while reviewing the top bar — the active EDT is shown by its ULID instead of its name, and the footer never lists the `Left`/`Right` zone-switching shortcut Story 2.12 already implemented. Bug fixes, not new behavior; appended to Epic 2 (branch still open) though the affected components (`top-bar.tsx`, `footer.tsx`) are Epic 1 territory (Story 1.11).

**Acceptance Criteria:**

**Given** an EDT is active
**When** the top bar renders
**Then** it shows that EDT's `topic` (its human-readable name) — never its ULID — resolved regardless of which zone is currently active (the top bar no longer depends on the EDTs zone having been visited first to have this data)

**Given** no EDT is active
**When** the top bar renders
**Then** it shows "no active EDT", unchanged

**Given** the footer's default hint set
**When** rendered
**Then** it includes `[←→] zone` alongside the existing `[d/e/u/l/r/s] zone`, reflecting Story 2.12's arrow-based zone switching

**Implementation notes:** the active-EDT topic needs to be resolvable at the app-shell level, not only inside `EdtsZone`'s own mount effect — either lift `loadEdts()` to fire once at `AppShell` mount, or add a lighter dedicated resolution or store-level topic cache. `TopBar` then derives its label from `edts.find(e => e.ulid === activeEdt)?.topic`. `footer.tsx`'s `DEFAULT_FOOTER_HINTS` gains one entry, ordered by frequency per UX-DR7 (placed beside the existing zone-mnemonic hint).

### Story 2.21: EDT Zone — Multi-Splitter Layout with Keyboard Resize-Mode (`Ctrl+W`)

> Added 2026-08-27 (Sprint Change Proposal): completes deferred scope from `UX-DR10`/`UX-DR16`/`UX-DR18`/`UX-DR27` (Epic 1, Stories 1.9/1.10 — a `splitter` component with `Ctrl+W` keyboard resize-mode, never implemented; flagged in `deferred-work.md`, code review of 2-12). Extends the EDT zone into a "multi-splitter zone" (Story 2.7's already-anticipated concept): the three panes stacked on the list side since Story 2.18 (EDT selector / EDT SERVICES / OTHER SERVICES) gain visible, fixed-but-movable borders, in addition to the existing list↔detail split. Appended to Epic 2 (branch still open) though the underlying components (`splitter.tsx`, `app-store.ts`'s `splitterRatios` slice) are Epic 1 territory, following the precedent of Stories 2.10/2.11/2.12/2.13/2.16/2.20.

As a developer,
I want to see fixed but movable borders between the EDT zone's panes, and to be able to resize them from the keyboard,
So that I can adjust how much room each pane gets based on what I'm looking at, and have that adjustment survive across sessions.

**Acceptance Criteria:**

**Given** the EDT zone
**When** it renders
**Then** 4 regions are visible with a fixed border between each: EDT selector / EDT SERVICES / OTHER SERVICES (stacked, left column) and Detail (right column) — 3 boundaries total

**Given** the EDT zone, no dialog open
**When** `Ctrl+W` is pressed
**Then** resize-mode engages: the currently targeted boundary recolors to accent (per Story 1.10's original spec); global shortcuts that would otherwise fire on the same keys (zone-switch via `←`/`→`, list navigation) are inert while the mode is active — closes the `deferred-work.md` gate item by adding resize-mode to `resolveZoneArrowSwitch`'s existing exclusion gate (`!helpOpen && !filterOpen && !registryScreenOpen`)

**Given** resize-mode is active
**When** `Tab` is pressed
**Then** the targeted boundary advances to the next one (cycles across the 3 boundaries)

**Given** resize-mode is active, a horizontal boundary targeted
**When** `↑`/`↓` is pressed
**Then** the boundary moves one step, clamped (bounds generalize `MIN_LIST_RATIO`/`MAX_LIST_RATIO` to the 3 sub-panes); given the vertical (list↔detail) boundary targeted, when `←`/`→` is pressed, then likewise

**Given** resize-mode is active
**When** `Enter` or `Esc` is pressed
**Then** the mode exits (both do, per the keybinding-help text already shipped); no separate save step — every move is already applied live

**Given** a boundary has been moved
**When** the app restarts
**Then** the EDT zone's ratios are read back from `state.json` and reapplied — persisted per zone, independent of other zones, per `UX-DR10`

**Implementation notes:** `core/ports/state.ts` extends `StatePort` with splitter-ratio read/write (exact shape — dedicated methods vs. a single `UiState` object alongside `activeEdt` — decided at implementation time); `adapters/driven/state` follows the same zod-validation pattern as `activeEdt` (`state-invalid-json`/`state-invalid-format`). `app-store.ts` gains a `resizeMode: { zone: ZoneId; targetBoundary: number } | null` slice; `splitterRatios` widens from one ratio per zone to a shape that can carry multiple boundaries (EDT zone needs 3; other zones keep 1 for now). `splitter.tsx` wires the previously-dead `onResize` prop and adds accent recoloring when targeted in resize-mode. `app-shell.tsx`'s `resolveZoneArrowSwitch` gains `resizeMode` in its exclusion gate, alongside `helpOpen`/`filterOpen`/`registryScreenOpen` — closes the flagged deferred-work item. `edts-zone.tsx`'s list-side column (EDT selector/EDT SERVICES/OTHER SERVICES) changes from a flat stack to 3 sub-`Box`es separated by `Splitter`, each driven by its own ratio. Scope is explicitly limited to the EDT zone for this story — other zones keep their single, non-resizable list/detail split for now; the mechanism (resize-mode, gate, persistence) is built generic enough to extend to other zones later without rework. Mouse-drag resize (mentioned in `UX-DR10`/`UX-DR27`) stays out of scope — Ink has no mouse support; `Ctrl+W` is the already-acknowledged "confirmed-safe fallback" (`UX-DR27`).

### Story 2.22: EDT Creation — Mandatory Branch Creation UI

> Added 2026-08-28 (Sprint Change Proposal): closes debug-log finding #1 — Story 2.2 built branch-creation capability in `core/edt/create.ts` (`CreateBranchOptions`) but the TUI's create-EDT dialog never surfaced it. While closing this gap, branch creation is also promoted from optional to mandatory on the TUI path (product decision made while triaging this finding) — see the companion amendment to Story 2.2 above. No core/port change: `core` keeps supporting a no-branch-creation call shape for other driving adapters; the TUI simply never exercises it anymore.

As a developer,
I want the create-EDT dialog to always have me choose a base branch and a naming mode (grouped/individual), with a suggested branch name pre-filled from the EDT's topic,
So that every EDT I create starts with its own branch per member by default, without typing a name from scratch every time.

**Acceptance Criteria:**

**Given** the create-EDT dialog, member checklist populated
**When** at least one member is selected
**Then** a branch-setup step appears — no enable/disable choice — offering a base-branch input (default `development`) and a naming-mode choice (grouped: one shared name / individual: one name per selected member)

**Given** the branch-setup step renders
**When** the naming mode is chosen
**Then** the branch-name field(s) are pre-filled with a suggested default slugified from the EDT's topic (lowercase, non-alphanumerics → `-`) — one suggested name in grouped mode, that same suggestion pre-filled per member in individual mode — always editable, never forced

**Given** grouped mode
**When** the developer accepts or edits the single branch name and confirms
**Then** `createEdtAction` is called with `CreateBranchOptions` (`baseBranch`, grouped naming, the name) — every selected member gets that identical branch name

**Given** individual mode
**When** the developer accepts or edits each per-service name and confirms
**Then** `createEdtAction` is called with the per-service names; a per-service branch-creation failure is reported without aborting the others (Story 2.2's existing AC), displayed via Story 2.25's per-repo failure list rather than a new ad-hoc format

**Given** any required branch-name field is empty
**When** confirm is attempted
**Then** it's blocked with inline validation (same convention as `validateBranchEditValue`) — a name is always required now, so an empty field can't be submitted

**Given** zero members are selected
**When** the EDT is created
**Then** no branch step applies — unchanged from today (nothing to create a branch in)

**Given** the branch-name input(s)
**When** rendered
**Then** they use the `text-input` Component Pattern (Story 2.23, visible cursor) — sequenced after 2.23

**Implementation notes:** `CreateDialogState` (`edts-zone.tsx`) gains base-branch, naming-mode, and branch-name(s) fields, pre-populated by a new pure function (e.g. `suggestBranchNameFromTopic(topic)`), no enable/disable field. `submitCreate` always passes a `CreateBranchOptions`-shaped payload to `createEdtAction` when ≥1 member is selected. No `core/` or port change.

### Story 2.23: Visible Text-Input Cursor (EDT Zone Text Fields)

> Added 2026-08-28 (Sprint Change Proposal): closes two debug-log findings with the same root cause — no dialog in the EDT zone renders a cursor/caret, so every text-input field (topic in Create/Modify, branch in service-actions/Modify/Add-to-EDT) looks like a static label until typed into blind. This also fully explains the "Add to EDT doesn't visibly offer a branch choice" finding — the field is functionally editable, just not perceivable as such. Also formalizes a missing `text-input` entry in EXPERIENCE.md's Component Patterns table (used throughout the EDT zone, never named). Confirmed by grep (2026-08-28) that no other zone currently uses text-input editing — this pattern is EDT-zone-only today, but is built as a shared component (`shared/components/`), not zone-local, so any future zone can reuse it without depending on `edts-zone.tsx`.

As a developer,
I want every text-input field in the EDT zone to show a visible cursor at my current editing position, plus a hint that the field is editable,
So that I can tell where I am while typing and that a field labeled e.g. "Branch: master" is an editable choice, not a static readout.

**Acceptance Criteria:**

**Given** any text-input field in the EDT zone (topic, branch)
**When** rendered, focused
**Then** a cursor glyph is shown at the current edit position (end of string, matching `nextTextInputValue`'s append/backspace-at-end model — no mid-string cursor movement is introduced by this story, since arrow keys aren't wired to cursor position yet)

**Given** a text-input field
**When** rendered
**Then** it's visually distinguishable from a static label (e.g. an inverted/underlined cursor cell, consistent across all instances) — closes the "Add to EDT" affordance gap without changing `AddToEdtDialogState`'s underlying logic, which was already correct

**Given** the EXPERIENCE.md Component Patterns table
**When** this story lands
**Then** it gains a `text-input` row (props, states: empty/focused/editing, the cursor treatment) documenting the pattern already used in Create/Modify/service-actions/Add-to-EDT dialogs

**Given** an existing dialog's hint line (e.g. Add to EDT)
**When** rendered
**Then** it includes an explicit `[Enter] confirm [Esc] cancel` hint where one was missing, consistent with other dialogs in the zone (closes the secondary affordance gap noted in the "Add to EDT" finding)

**Implementation notes:** new shared component `shared/components/text-input-line.tsx` (props: `label`, `value`, `focused`), following the exact convention of its neighbors (`checkbox-list-item.tsx`, etc.) — replaces the hardcoded `<Text>{label}: {value}</Text>` in each `edts-zone.tsx` dialog. Used only by the EDT zone today; no dependency in the other direction. No change to `nextTextInputValue`'s editing model (cursor-position tracking / arrow-key movement is explicitly out of scope — flagged as a possible follow-up, not blocking). Prerequisite for Story 2.22 (branch-name fields), Story 2.24 (per-member branch field), and Story 2.26 (branch-picker reuses the same input styling).

### Story 2.24: Modify EDT — Mandatory Branch on Add, No More Silent Default

> Added 2026-08-28 (Sprint Change Proposal): closes debug-log finding #4 — `core/edt/modify.ts`'s "1. Add members" step (lines 108-176) unconditionally reads `git.currentBranch(resolved)` and tries to register whatever the repo happens to be checked out on, gated only after the fact by `assertAllowedBranch`. Confirmed by re-reading the code (2026-08-28): this isn't limited to the "no matching `setBranches` entry" case as first suspected — the add-members loop never even looks at `setBranches` at all, so it also risks a spurious failure-on-current-branch for the "Add to EDT" flow (Story 2.18) when the repo's *current* branch happens to collide with another EDT, even though a perfectly valid target branch was supplied via `setBranches` for the same call. Extends the "branch is always explicit, never silently inferred" principle established in Story 2.22 (mandatory branch at EDT creation) to EDT modification.

As a developer,
I want adding a member to an EDT (whichever UI path I use) to always use the branch I actually asked for, and never silently register or gate on whatever the repo happens to be checked out on right now,
So that "add member" can't collide with an unrelated branch the repo just happened to be sitting on, and I'm never left wondering why a member I checked got rejected for a branch I never chose.

**Acceptance Criteria:**

**Given** `modifyEdt` is called with a repo in `addMembers` that also has a matching `setBranches` entry
**When** the pre-lock steps run
**Then** step 1 ("Add members") no longer calls `git.currentBranch()` or gates on it for this repo — it only performs the existing registered/duplicate-membership checks, then defers branch resolution entirely to step 3 ("Set branches"), which already runs `assertAllowedBranch` + protected-switch + checkout correctly; on a successful branch change for such a repo, it is promoted into the final member list with that branch (not left out because step 3 doesn't normally add new members)

**Given** `modifyEdt` is called with a repo in `addMembers` and no matching `setBranches` entry
**When** step 1 runs
**Then** it fails that member with a new `branch-required` error ("no branch specified for new member <path>; call with a matching setBranches entry") instead of silently defaulting to `git.currentBranch()` — no `core` caller can add a member without stating its branch, TUI or otherwise

**Given** the TUI Modify dialog's member checklist
**When** a not-yet-member service is checked
**Then** a mandatory branch field appears for it, pre-filled with a suggested default — computed by checking the EDT's *existing* members' branches: if they're all identical, that shared name is the suggestion; otherwise the topic-slug suggestion from Story 2.22 (`suggestBranchNameFromTopic`) is used as fallback — never the newly-checked service's own current branch (that's the exact pattern responsible for this bug). Always editable. Reuses Story 2.23's `text-input` component. `resolveModifyOps` includes a `setBranches` entry for every newly-checked member, never omits one

**Given** the EDT has zero existing members (first member being added via checklist)
**When** the branch field renders
**Then** it falls straight to the topic-slug suggestion — no common-branch computation possible with zero members to compare

**Given** a newly-checked member's branch field is left empty
**When** confirm is attempted
**Then** it's blocked with inline validation, same convention as Story 2.22/2.23 — a branch is always required to add a member, never silently skipped

**Given** a requested branch (via `setBranches`, from either add path) is already registered as a different EDT's own branch
**When** `assertAllowedBranch` rejects it
**Then** the failure is reported per-repo, using Story 2.25's structured failure list and assisted-resolution registry — not the current flat error string — so the developer sees exactly which member failed and why, and can retry with a different branch

**Implementation notes:** this is a real restructuring of the step-1/step-3 interaction in `core/edt/modify.ts`, not a one-line fix — flagged for implementation-time care: step 1 builds a `pendingAdds` list (repoPath + resolved service, no branch) for `addMembers` entries with a matching `setBranches` entry, skipping `git.currentBranch`/`assertAllowedBranch` entirely for them; step 3's existing loop, on a successful branch change for a `pendingAdds` repoPath, promotes it into `addedMembers` (not just `branchChanges`) so the lock-time assembly (already correct per Story 2.18's flagged ordering concern — `branchChanges` applies after `addedMembers`) picks it up as a genuinely new member. New pure function `suggestBranchForNewMember(existingMembers, topic)` — returns the common name if `existingMembers.every(m => m.branch === existingMembers[0].branch)` (and `existingMembers.length > 0`), else delegates to `suggestBranchNameFromTopic(topic)` (Story 2.22, reused as-is, colocated rather than duplicated). TUI: `ModifyDialogState`/`resolveModifyOps` (`edts-zone.tsx`) gain a per-newly-checked-member branch field.

### Story 2.25: EDT Zone — Structured Per-Repo Failure Display & Branch-Collision State

> Added 2026-08-28 (Sprint Change Proposal): closes debug-log finding #2 — a partial-failure switch (or create/modify/add-to-edt — same code path) dumps every failed repo's raw error message concatenated with `; ` on one line (`summarizeFailedResults()`, a flat `map().join('; ')`), no per-repo breakdown, no distinction between failure kinds, no remediation offered. Confirmed this helper is shared across **five** call sites (switch, create, modify, add-to-edt — `edts-zone.tsx`), so the fix benefits every dialog in the zone at once, including the failure paths Stories 2.22/2.24 already reuse. Also formalizes a new state in EXPERIENCE.md's EDTs State Patterns table: "branch already claimed by another EDT" — today's collisions are display bugs riding on top of an unnamed spec gap. Per Max's explicit direction during drafting: only branch-collision gets an assisted resolution today, but other failure kinds will likely gain their own later — the display/resolution mechanism is built as an extensible per-error-code registry from the start, not a hardcoded single check, reusing the "Assisted resolution" mechanic already named in EXPERIENCE.md's Update-zone table (detect → guided action → re-verify) rather than inventing a second name for the same idea.

As a developer,
I want a partial-failure result from any EDT action to show me, per repo, exactly what happened and — for a branch collision specifically — an easy way to try a different branch,
So that a partial failure is something I can act on immediately, not a wall of concatenated text I have to parse by hand.

**Acceptance Criteria:**

**Given** any EDT action (switch/create/modify/add-to-edt) completes with one or more `outcome: 'failed'` rows
**When** the result is shown
**Then** each failed repo renders as its own line — service/repo name, then its error message — instead of one `; `-joined run-on string; `summarizeFailedResults` is replaced by a structured list (e.g. returns `FailedResultRow[]`, not a pre-joined string), rendered by a shared list renderer used by all five call sites

**Given** a failed row's `detail.code`
**When** the failure list renders
**Then** each row's resolution action is looked up via a small extensible registry (e.g. `resolveAssistedAction(code): AssistedAction | null`, keyed by error code) rather than a hardcoded branch-collision check — this story registers exactly one entry (`branch-already-claimed` → "try a different branch"); a code with no registered entry renders the plain per-repo line with no action, which is the correct/expected behavior for every other failure kind today, not a gap

**Given** the registered `branch-already-claimed` entry
**When** chosen (`[Enter] try a different branch`)
**Then** it reopens the same branch-edit input already used elsewhere in the zone (Story 2.23's `text-input` component), scoped to just that repo, and re-runs the same submit path with the updated branch — not a restart of the whole action

**Given** a future failure kind gains its own assisted resolution later (e.g. stale-registry re-registration, shared-branch-mismatch reconfiguration — both flagged, out of scope here)
**When** implemented
**Then** it only needs to add one registry entry (code → action descriptor + handler) — no change to the list-rendering component itself, confirming the registry is the actual extension point

**Given** the EXPERIENCE.md EDTs State Patterns table
**When** this story lands
**Then** it gains a new row — "Branch already claimed by another EDT" — naming this as a distinct, expected state, applicable wherever `assertAllowedBranch` can reject a requested branch (switch, create, modify, add-to-edt)

**Given** a failed row whose error is NOT a branch collision (e.g. `no .tui-back.yaml found`, a fetch failure)
**When** rendered
**Then** it still gets its own per-repo line with the raw message — this story doesn't invent new remediation for every failure kind, only structures the display and adds the one collision-specific registry entry; the two stale-registry entries and the `micro-external` shared-branch mismatch noted in the debug log are environmental/registry-hygiene issues, explicitly out of scope for this story

**Given** the existing "Protected-switch blocked" / "Interrupted update" EDTs State Pattern rows (already spec'd, UX-DR20)
**When** reviewed against this story
**Then** they're confirmed out of scope here — they cover a different scenario (an in-progress group update blocking a switch), not addressed by this finding; no change needed to those rows

**Implementation notes:** `summarizeFailedResults` (`edts-zone.tsx`) changes its return shape from `string | null` to a structured list (all 5 call sites updated); a new shared render helper (in `shared/components/`, following Story 2.23's precedent) renders that list as one line per repo, consulting the `resolveAssistedAction` registry per row for an optional action. The registry (`Record<string, AssistedAction>` or equivalent) lives alongside the render helper — deliberately minimal, not a real plugin system, just enough for Story 2.26 (or a future story) to add an entry without touching the list component. This is the EDT zone's first instance of the "Assisted resolution" mechanic already named in EXPERIENCE.md (Update-zone table).

### Story 2.26: Branch-Picker — 3 Explicit Modes (Pick Existing / Create New / Rename Current)

> Added 2026-08-28 (Sprint Change Proposal): closes debug-log finding #6 — every branch-entry point in the EDT zone ("Change branch for this EDT", "Add to EDT", the Modify checklist's per-member branch step from Story 2.24) is currently one free-text field the developer types a name into blind. Largest-scope item in this batch: needs two new `GitPort` capabilities (`listBranches`, `renameBranch`) and a new UI component. Sequenced last — depends on Story 2.23 (visible-cursor text-input, used by two of the three modes) and lands after 2.24/2.25 so it can plug its own failures into 2.25's structured display and (for collisions) its assisted-resolution registry.

As a developer,
I want every place I set a service's branch for an EDT to offer three explicit choices — pick an existing branch (searchable), create a new one, or rename the one currently active — instead of one ambiguous free-text field,
So that I always know which of these three things I'm actually doing, and don't have to remember an exact existing branch name to type it correctly by hand.

**Acceptance Criteria:**

**Given** any of the three existing branch-entry points ("Change branch for this EDT", "Add to EDT", Modify checklist's per-member branch step)
**When** the branch step opens
**Then** it presents a 3-way mode switch — **Pick existing** / **Create new** / **Rename current** — cycled the same way other mode switches in this zone work (e.g. `Tab`), defaulting to **Create new** with the context-appropriate suggested name already established by Stories 2.22/2.24 (topic-slug or common-member-branch), so existing behavior isn't disrupted for a developer who ignores the new modes entirely

**Given** "Create new" mode
**When** active
**Then** it shows two sections: a **base-branch** picker (where the new branch starts from) and a **name** field — base-branch defaults to `development`, chosen from the same filterable local-branch list as "Pick existing" mode (this repo's own branches, via `listBranches`), reused rather than duplicated

**Given** the name section in "Create new" mode
**When** active
**Then** it offers a sub-choice alongside free typing: pick from the list of branch names already in use by *other* members of this EDT (sourced from the EDT's own member data — `target.members.map(m => m.branch)`, deduplicated, no git call involved) — picking one fills the text field, still editable afterward; this generalizes Story 2.24's single computed suggestion (unanimous-name-or-topic-slug) into an explicit, browsable list for the non-unanimous case

**Given** "Pick existing" mode
**When** active
**Then** it shows a filterable list of the repo's local branches (typing narrows the list, same filter-as-you-type convention used elsewhere in the app), selecting one and confirming sets it as the target branch — no new branch created

**Given** "Pick existing" mode, a branch selected from the filterable list
**When** the developer chooses "rename" instead of "use as-is" (an inline action on the selected item, not a mode switch)
**Then** it prompts for a new name (Story 2.23 `text-input`) and, on confirm, renames that git branch (`git.renameBranch`) *then* sets the renamed branch as the EDT's branch for that service — one combined action, not two separate steps through different modes

**Given** "Rename current" mode
**When** entered
**Then** it's a shortcut into the same pick-then-rename mechanism above, pre-selected to the branch currently registered for that service in this EDT — not a separate implementation, just a different entry point that skips the picking step; available only where a "current" branch actually exists (not at EDT creation for a not-yet-member service)

**Given** any mode's confirmation
**When** it fails (e.g. name collision, protected-branch rejection)
**Then** it surfaces through Story 2.25's structured per-repo failure display, and — for a branch-collision failure specifically — through 2.25's assisted-resolution registry (adds a second registry entry alongside "try a different branch"; rename mode's own collision reuses the same display, no new failure-handling path invented)

**Given** the `GitPort` contract
**When** this story lands
**Then** it gains two methods: `listBranches(repoPath): Promise<Result<string[]>>` (local branches, mirrors `branchExistsLocally`'s existing local-only scope — remote-branch listing is explicitly out of scope, flagged as a possible follow-up) and `renameBranch(repoPath, oldName, newName): Promise<Result<void>>` (local `git branch -m`, gated by `assertAllowedBranch(repoPath, newName, edtId)` before renaming, same convention as `createBranch`)

**Given** `core/edt/modify.ts`
**When** this story lands
**Then** it gains a `renameBranches?: Array<{ repoPath: string; newName: string }>` param (mirrors `setBranches`'s shape), a new pre-lock step calling `git.renameBranch` after the existing `assertAllowedBranch` gate, and updates the EDT registry entry's `branch` field for that member on success — a distinct operation from `setBranches` (which switches to an *existing* branch; this one renames the *current* one)

**Implementation notes:** new shared component `shared/components/branch-picker.tsx`, following Story 2.23's `text-input-line.tsx` precedent — hosts the 3-way mode switch, delegates to `text-input-line` for two of its three modes; the "Pick existing" list item gains a secondary action (rename) alongside select, both driving the same underlying `renameBranch` + `setBranches`/`addMembers` submit path. "Create new"'s base-branch picker reuses the exact same filterable-list sub-component as "Pick existing" (two call sites of one list widget: base-branch candidates vs. target-branch candidates). The other-members'-branch-names sub-list needs no new port method — derived from data the dialog already has loaded. The filterable list itself reuses whatever filter-as-you-type mechanism already exists elsewhere in the app if one does (verify at implementation time) rather than introducing a second one. `core/ports/git.ts` gains `listBranches`/`renameBranch`, implemented in `adapters/driven/git`. EDT creation (Story 2.22) is not required to adopt "Pick existing"/"Rename current" by this story — it has no "current" branch to rename and creation's own suggested-default flow already covers the common case; extending it is a natural, explicitly-flagged follow-up, not required here.

> Amended 2026-09-16 (Sprint Change Proposal): closes a confirmed blocking bug found in real usage — Modify's member-checklist Enter routed to the branch-picker for any checked row (nearly always every row, since existing members start checked), with no visible indication of which service the open picker session was even for, making it practically impossible to reach `submitModify` without already knowing the undocumented "Tab to Topic, then Enter" escape hatch. Two new ACs, none removed (branch not yet `done`, so this is a direct edit, not a reopening):
>
> **Given** a branch-picker session is open in the Modify dialog **When** rendered **Then** the `ModalDialog`'s title changes from `MODIFY EDT` to `MODIFY EDT — branch for <service>` for the duration of the session, reverting once it closes.
>
> **Given** the members-list cursor is on a row that is already a member of this EDT **When** `Enter` is pressed **Then** the whole form submits (`submitModify`) — changing an *existing* member's branch from Modify goes through the EDT SERVICES pane's own "Change branch for this EDT" action (Story 2.18), not this checklist. **Given** the cursor is on a row newly checked this session (not yet a member) **When** `Enter` is pressed **Then** the branch-picker opens for it, unchanged (mandatory per Story 2.24).

### Story 2.27: EDT Creation — Branch-Picker Reuse & Manifest-Aware Base-Branch Default

> Added 2026-09-16 (Sprint Change Proposal): closes the explicitly-flagged follow-up from Story 2.26's own implementation notes ("EDT creation is not required to adopt Pick existing/Rename current by this story ... a natural, explicitly-flagged follow-up") — and, per real-usage diagnosis, the actual root cause of Create-EDT hard-failing whenever a repo's real shared branch isn't literally named `development`.

As a developer, I want the Create-EDT dialog's branch-setup step to use the same searchable branch-picker as Modify, defaulting to each repo's own manifest-declared shared branch instead of a hardcoded `development`, so that creating an EDT never fails on a made-up default and I can pick a real base branch the same way everywhere in the app.

**Acceptance Criteria:**

**Given** the create-EDT dialog's branch-setup step **When** it renders **Then** the base-branch field uses the shared `BranchPicker` (Pick existing / Create new — no Rename current) instead of a raw `<Text>` field, consistent with Modify/service-actions/add-to-edt.

**Given** the branch-name field(s) (grouped or individual) **When** rendered **Then** they use `TextInputLine` (closing the Story 2.23 gap — today they're the only EDT-zone text fields still on raw `<Text>`, with no visible cursor).

**Given** `core/edt/list.ts`'s `listEdtBranchesDivergence` use-case **When** it builds each row **Then** `ServiceBranchDivergence` includes `sharedBranch: string`, sourced from the manifest already loaded for that repo — no new port.

**Given** every base-branch default in the EDT zone (Create's branch-setup step, and the existing `BranchPicker`'s "Create new" mode in Modify/service-actions/add-to-edt) **When** exactly one repo is in play **Then** the suggested base branch is that repo's own `sharedBranch`, never the hardcoded `DEFAULT_BASE_BRANCH` constant.

**Given** Create in grouped naming mode with ≥2 selected members **When** their manifests' `sharedBranch` values are unanimous **Then** that shared value is the suggested base branch. **When** they diverge **Then** grouped naming mode stays available for the branch *name*, but the base-branch field is forced into a per-member picker — never silently defaulting to `development` or picking one member's value arbitrarily.

**Given** any base-branch suggestion **When** shown **Then** it stays fully editable — never forced, same convention as every other suggested default in this zone (Story 2.22).

**Implementation notes:** `DEFAULT_BASE_BRANCH` (`edt-slice.ts`) stops being read as the branch *suggestion* source anywhere in the EDT zone. `create-dialog.tsx` gains its own `BranchPicker` session, mirroring `openBranchPickerForModify`'s shape but scoped to `CreateDialogState`; the "one base branch per member when `sharedBranch` diverges" case needs a small per-member base-branch record, analogous to `branchNames`'s existing per-member shape. Depends on Story 2.26's `BranchPicker`/`listBranches` and Story 2.23's `TextInputLine` (both already shipped).

### Story 2.28: Registry — Manifest Semantic Validation

> Added 2026-09-16 (Sprint Change Proposal): the manifest loader (Story 1.4) already rejects a schema-invalid `.tui-back.yaml`; nothing checks that a schema-*valid* manifest's declared values are actually real — e.g. a `sharedBranch` that doesn't exist in the repo. Extends the registry screen (Story 2.11) rather than adding a new command/screen.

As a developer, I want to validate that my registered repos' manifests are not just schema-correct but actually consistent with the repo's real state, so that a typo'd or stale `sharedBranch` surfaces before it causes a confusing failure elsewhere in the tool.

**Acceptance Criteria:**

**Given** the REPO REGISTRY screen (Story 2.11) **When** open **Then** a new action ("Validate registered repos") is available alongside scan/register, operating on every path already in `registry.yaml`.

**Given** validation runs **When** it completes **Then** each registered, manifest-valid repo shows a per-repo outcome (valid / invalid + reason), rendered via the same structured per-repo list convention as Story 2.25's `FailedResultList`.

**Given** the `sharedBranch` check specifically **When** a repo's manifest declares one **Then** the tool verifies it exists (locally, or fetchable from the configured remote) via `GitPort`, reporting `invalid: sharedBranch "<name>" not found` when it doesn't.

**Given** the check mechanism **When** implemented **Then** it is a small, extensible per-check registry — this story registers exactly one real check (`sharedBranch` existence); a future check is a registry entry, not a rewrite, mirroring Story 2.25's `resolveAssistedAction` pattern.

**Given** a repo whose manifest already fails to *load* (schema-invalid) **When** validation runs **Then** that repo is reported using its existing load-error message — this story never re-implements schema validation, only adds semantic checks on top of an already-loadable manifest.

**Implementation notes:** new core use-case `core/scripts/validate-registry.ts`, same shape as `list-repos.ts`. CLI subcommand `tui-back registry validate` for script/CLI parity (AD-2); TUI wires it as a new `RegistryScreenPhase` in `repo-registry-screen.tsx`.

### Story 2.29: Delete an EDT

> Added 2026-09-16 (Sprint Change Proposal): new PRD FR-24 (§4.2) — no existing FR covers removing an EDT record. Per-service branch disposition (leave / delete) informed by merge status and uncommitted-work detection, following the same "detect → guided choice → act" shape as every other assisted-resolution mechanic in this app.

As a developer, I want to delete an EDT I no longer need, choosing per member service whether to leave its branch alone or delete it too, so that finished or abandoned work doesn't accumulate stale EDTs and orphaned branches I have to clean up by hand.

**Acceptance Criteria:**

**Given** the EDT selector **When** the developer triggers delete on a *non-active* EDT (via a new `edt-delete` command, or a contextual action on the focused EDT row) **Then** a confirmation dialog opens listing every member service with its branch, merge status (merged into that repo's `sharedBranch` / not merged), and uncommitted-work status.

**Given** the target EDT is the currently *active* one **When** delete is attempted **Then** it is rejected with a clear message to switch away first — never auto-switched on the developer's behalf.

**Given** the per-service disposition list **When** rendered **Then** each row defaults to "Leave branch as-is" except a service whose branch is both merged into its `sharedBranch` and clean, which defaults to "Delete branch" — every row stays independently toggleable, the defaults are a suggestion, never forced.

**Given** a service's branch is chosen for deletion, is merged and clean **When** the delete runs **Then** it's a plain `git branch -d`.

**Given** a service's branch is chosen for deletion, is unmerged and/or has uncommitted work **When** the delete runs **Then** it force-deletes (`git branch -D`) — never silently downgraded to "leave alone" because it looked risky; the confirmation dialog's merge/uncommitted status is exactly what lets the developer make that call knowingly.

**Given** a service's branch chosen for deletion is *also* registered as another EDT's own branch for that repo **When** the delete runs **Then** that specific branch deletion is rejected (structured per-repo failure, Story 2.25's display) — the EDT record itself is still deleted, and every other selected service's branch deletion proceeds independently.

**Given** the EDT record deletion itself **When** it completes **Then** the EDT's SQLite file (`XDG_DATA_HOME/tui-back/edts/<ulid>.db`) is removed and it no longer appears anywhere in the EDT list — no soft-delete/undo in v1.

**Implementation notes:** `core/ports/git.ts` gains `isBranchMerged(repoPath, branch, into)` and `deleteBranch(repoPath, branch, force)`, gated through the centralized branch-scope-safety adapter (AD-8) — refuses a shared/protected branch outright. New core use-case `core/edt/delete.ts`. CLI: `tui-back edt delete <topic> [--branches <repoPath>=<leave|delete>...]`. TUI: new `edt-delete` command bar entry plus a new `EdtDialogState` kind (`dialogs/delete-dialog.tsx`).

### Story 2.30: EDT Quick-Pick — Filterable List for `edt-switch` / `edt-modify`

> Added 2026-09-16 (Sprint Change Proposal): closes a gap in Story 2.15 (`done`) — its own ACs describe a quick-pick list for both commands invoked with no argument; today `edt-switch` jumps to "the first non-active EDT" and `edt-modify` opens whichever EDT row happens to be focused, neither shows a list to choose from.

As a developer, I want `edt-switch` and `edt-modify` (typed with no argument) to show a filterable list of EDTs I can search and pick from, so that I don't have to already know or guess which EDT is "first" or "currently focused" before the right dialog opens.

**Acceptance Criteria:**

**Given** the command bar, `edt-switch` run with no argument **When** it executes **Then** a quick-pick opens: a text filter (prefix match, case-insensitive, same convention as `matchCommands`/`matchBranchesByPrefix`) over every *non-active* EDT's topic, with an arrow-navigable filtered list below it.

**Given** the quick-pick (switch mode) **When** an EDT is selected (`Enter`) **Then** the switch-confirm dialog opens pre-targeted at it, unchanged from today's pre-targeted-by-topic path.

**Given** the command bar, `edt-modify` run with no argument **When** it executes **Then** the same quick-pick opens (mode: modify), filtering over *every* EDT (active included).

**Given** the quick-pick (modify mode) **When** an EDT is selected **Then** the modify dialog opens pre-targeted at it, unchanged from today's pre-targeted-by-topic path.

**Given** the quick-pick, any mode **When** `Esc` is pressed **Then** it closes without opening anything, back to no dialog.

**Given** the quick-pick's filter matches exactly zero EDTs **When** rendered **Then** it shows an explicit "no matching EDT" state, never a silently-empty list.

**Given** `edt-switch <topic>`/`edt-modify <topic>` (topic supplied) **When** run **Then** behavior is unchanged — the quick-pick only replaces the no-argument path.

**Implementation notes:** new shared component, `shared/components/edt-quick-pick.tsx` (or a generalized version of `branch-picker.tsx`'s `FilterableBranchList`, reused rather than duplicated). New `EdtDialogState` kind `'quick-pick'` with a `mode: 'switch' | 'modify'` field; `edts-zone.tsx`'s `currentEdtAction` effect (today: "first non-active EDT" / "focused EDT" fallbacks) opens this dialog instead when no topic was given.

### Story 2.31: `edt-create-from` — Clone an EDT's Membership as a Creation Starting Point

> Added 2026-09-16 (Sprint Change Proposal): new command, built on Story 2.30's quick-pick (root-EDT selection) and Story 2.27's `BranchPicker`-based branch-setup step (per-member base branch). Treated as a consequence of existing FR-3 (member selection, still manual/editable), not a new FR.

As a developer, I want to create a new EDT starting from an existing one's member services (with the ability to add or remove some), where every inherited service's new branch is based on that service's *current* branch in the root EDT, so that I can spin off a continuation of in-progress work without losing the branch context it was building on.

**Acceptance Criteria:**

**Given** the command bar, `edt-create-from` run with no argument **When** executed **Then** Story 2.30's quick-pick opens (any EDT selectable) to choose the root EDT.

**Given** `edt-create-from <topic>` **When** `<topic>` matches an existing EDT **Then** it's pre-targeted directly, skipping the quick-pick; no match shows an inline "EDT not found" error.

**Given** a root EDT is resolved **When** the create dialog opens **Then** the member checklist is pre-checked with exactly the root EDT's current members — still a normal, fully-editable `checkbox-list-item` list (add/remove any service).

**Given** the branch-setup step (Story 2.27) **When** a selected member *was* a member of the root EDT and naming mode reaches "Create new" for it **Then** the suggested base branch is that member's own *current* branch in the root EDT (not `sharedBranch`, not `development`) — Story 2.27's `sharedBranch`-aware default applies only to members that were *not* in the root EDT.

**Given** a selected member that was *not* part of the root EDT **When** the branch-setup step renders **Then** it falls back to Story 2.27's normal `sharedBranch`-aware default — unchanged.

**Given** the pre-filled base-branch suggestion **When** shown **Then** it stays fully editable, same convention as every other suggestion in this zone.

**Given** the new EDT's topic **When** entered **Then** it follows the normal uniqueness rule (FR-3) — never auto-derived from the root EDT's topic, always typed fresh.

**Implementation notes:** `initialCreateDialog` gains an optional `seedFromEdt: EdtRegistryEntry` parameter that pre-populates `selectedMembers` and a per-member `rootBranch` record consulted by the branch-setup step's base-branch suggestion logic (extends Story 2.27's per-member base-branch path). New `commands.ts` entry `edt-create-from`. Depends on Story 2.27 and Story 2.30 — sequence after both.

### Story 2.32: `TextInputLine` — Cursor Navigation & App-Wide Adoption

> Added 2026-09-16 (Sprint Change Proposal): closes an explicitly-flagged Story 2.23 follow-up ("no mid-string cursor movement is introduced by this story ... flagged as a possible follow-up, not blocking"). Scope widened, at Max's request, to unify the command-bar and registry-screen's own separate hand-rolled text fields onto the same component and editing primitive, leaving exactly one text-input implementation in the codebase.

As a developer, I want every text field built on `TextInputLine` — including the command bar and the registry screen's root-path field — to let me move the cursor with Left/Right/Home/End and edit at that position, so that fixing a typo in the middle of a branch name or topic doesn't mean clearing and retyping the whole field.

**Acceptance Criteria:**

**Given** `nextTextInputValue` **When** extended **Then** it operates on `{ value: string; cursor: number }` instead of a bare `string` — `Left`/`Right` move the cursor (clamped to `[0, value.length]`), `Home`/`End` jump to start/end, typed characters insert at the cursor, `Backspace`/`Delete` remove at the cursor (before/after respectively) — every existing non-cursor key behavior is unchanged.

**Given** `TextInputLine` **When** rendered focused **Then** the cursor glyph appears at the `cursor` position within `value`, not always at the end — a `cursor` prop defaulting to `value.length` keeps every existing caller that doesn't pass one visually unchanged.

**Given** every EDT-zone field currently driving a `TextInputLine` **When** this story lands **Then** their state shape gains the paired `cursor` field and their key-dispatch calls route through the extended `nextTextInputValue`.

**Given** the command bar's own input (`command-bar.tsx`) **When** this story lands **Then** it renders via `TextInputLine` (label-less/prefix mode) instead of its own hand-rolled cursor rendering, and its own key handling calls the same extended `nextTextInputValue`; autocomplete/grid behavior (Story 2.17) is unaffected.

**Given** the registry screen's root-path field (`repo-registry-screen.tsx`) **When** this story lands **Then** it renders via `TextInputLine` (`label="Root path"`) instead of its own `typeRootInputChar`/`backspaceRootInput` pair.

**Given** `TextInputLine` **When** used without a `label` (the command bar's case) **Then** it renders the value/cursor alone, no `"undefined: "` or empty-label artifact — `label?: string` becomes optional.

**Implementation notes:** every `CreateDialogState`/`ModifyDialogState`/`ServiceActionsDialogState`/`AddToEdtDialogState`/`BranchPickerState` field that today is a bare `string` and drives a `TextInputLine` gains a sibling `cursor` (exact shape decided at implementation time, consistently across all of them). `branch-picker.tsx`'s own local `applyTextInput`/`TextEditKey` re-implementation gets the same cursor extension in parallel, not via import (avoids the import-cycle it was written to avoid). Sequence command-bar/registry-screen migrations after the EDT-zone fields are done, so the extended `nextTextInputValue` contract is proven first where it has the most callers.

## Epic 3: Group Update & Migrations

A developer can run a group update (pull, migrate, restart) scoped to the active EDT or to all managed repos, with assisted resolution of conflicts and migration failures.

### Story 3.1: Group Update — Pull & Restart (EDT-scoped)

As a developer,
I want to run a group update that brings my active EDT's member services up to date with `development` and restarts their containers,
So that I can catch up my session's services in one action instead of doing it by hand per service.

**Acceptance Criteria:**

**Given** the active EDT has at least one member service
**When** a developer triggers a group update
**Then** for a non-member repo already on `development`, the tool does a plain pull; for a member service on its own feature branch, the tool merges the latest `development` into that branch (`git merge development`, never a rebase — chosen for safety-by-default: no rewriting of already-pushed commits, and a merge already applied is a no-op on a second run, satisfying FR-1's idempotency) and restarts the container, without touching migrations yet (added in Story 3.2)

**Given** the merge of `development` into a member service's branch produces a real conflict (not just a dirty lockfile)
**When** it occurs
**Then** it is handled by Story 3.4's assisted-resolution mechanic, not silently aborted or auto-resolved here

**Given** a group update run
**When** it completes
**Then** the summary accounts for every targeted service by outcome (updated / skipped / failed) — no service is silently absent

**Given** the active EDT has zero member services
**When** a group update is triggered
**Then** it is a no-op with an explicit message, never a silent success

**Given** a group update is already running (in either scope)
**When** a second group update is triggered
**Then** it is rejected

**Given** a group update is in progress
**When** the developer presses `q`
**Then** quitting requires explicit confirmation first

### Story 3.2: Run Migrations as Part of the Group Update

As a developer,
I want the group update to also run each targeted service's migrations,
So that my session's services are fully caught up, not just on the latest code.

**Acceptance Criteria:**

**Given** a targeted service's manifest declares a `migrationCommand`
**When** the group update reaches that service
**Then** the migration command runs after the pull step and before the restart step (per manifest, FR-10)

**Given** the migration step succeeds
**When** the run's summary is shown
**Then** that service's outcome reflects a fully caught-up state (code + migrations + restarted container)

**Given** a service with no `migrationCommand` declared
**When** the group update reaches it
**Then** the migration step is skipped for that service without error

### Story 3.3: All-Repos Maintenance Mode

As a developer,
I want to explicitly run a group update against every managed repo regardless of EDT,
So that I can do the periodic maintenance sweep the current `update-services.sh` covers, without it ever happening by accident.

**Acceptance Criteria:**

**Given** a developer wants to run the all-repos mode
**When** they trigger it
**Then** it is always an explicit, separate action from the default EDT-scoped update — never the default

**Given** the all-repos mode is triggered
**When** the developer confirms
**Then** it requires an explicit confirmation step before running, since its blast radius extends beyond the active EDT

**Given** the all-repos mode runs
**When** it completes
**Then** every managed repo appears in the outcome summary — the same per-service outcome mechanic as Story 3.1's EDT-scoped run

**Given** the all-repos mode is triggered
**When** a group update (either scope) is already in progress
**Then** it is rejected the same as Story 3.1's second-run-blocked rule

### Story 3.4: Assisted Resolution of Merge Conflicts / Dirty State

As a developer,
I want the tool to auto-resolve known-safe dirty states and guide me through everything else during a group update,
So that a conflict never stalls the whole run or forces me to a separate terminal.

**Acceptance Criteria:**

**Given** a targeted repo has only `package.json`/lockfile dirty during a pull
**When** the group update reaches it
**Then** it is resolved the same way `update_repo.sh` does today, without prompting

**Given** a targeted repo has any other dirty/conflicted state
**When** the group update reaches it
**Then** a guided menu is presented (stash / open in editor / cancel this repo / cancel the whole run), and the run does not proceed on that repo until the developer acts

**Given** the developer chooses "cancel this repo"
**When** selected
**Then** the run continues with the remaining repos
**And When** "cancel the whole run" is chosen instead
**Then** the run stops entirely

**Given** the developer acts (stash / edits and confirms)
**When** the tool resumes
**Then** it re-checks that repo's state before continuing — it never assumes success

**Given** a repo is already mid-merge/mid-rebase from a previous interrupted or crashed run
**When** the group update reaches it
**Then** this is detected and surfaced as its own distinct state, before the guided menu applies

### Story 3.5: Per-Service Migration Failure Handling & Re-Trigger

As a developer,
I want a migration failure during a group update to be clearly reported and independently re-triggerable,
So that one broken migration never stalls the services that already succeeded.

**Acceptance Criteria:**

**Given** a migration fails during a group update
**When** it happens
**Then** the tool surfaces which service, which migration, and the error output

**Given** one service's migration fails
**When** the run continues
**Then** updates that already succeeded on other services in the same run are not blocked or rolled back

**Given** a developer fixes the underlying issue
**When** they re-trigger just that service's migration
**Then** the tool re-verifies success before marking the service caught up

**Given** the same migration fails repeatedly
**When** it is retried
**Then** each failure is surfaced the same way — no retry limit or escalation path is enforced in v1

## Epic 4: `shared-types` Propagation

A developer can publish a new `shared-types` version and see/propagate its adoption status across the active EDT's member services, without any manual per-repo check.

### Story 4.1: Publish a New `shared-types` Version

> Amended 2026-08-24 (Sprint Change Proposal, correction to not-yet-built Epic 4): publish is now gated on a new `shared-types-source` manifest module identifying the `shared-types` repo itself (previously undocumented how the tool identified it), and chains into propagation on success — closing the "find the propagate action separately" gap.

As a developer,
I want to publish a new `shared-types` version through the tool,
So that I don't have to run the release script by hand and lose track of which step failed if something breaks.

**Acceptance Criteria:**

**Given** the active EDT does not include, as a member, the repo whose manifest declares `shared-types-source`
**When** the developer looks for the publish action
**Then** it isn't offered (ties to Story 2.13's disabled-tab rule)

**Given** a developer triggers publish
**When** the tool runs `shared-types`'s `npm run v` script
**Then** it shows per-step progress (bump → build → publish → push) with a spinner on the running step

**Given** a step fails
**When** the failure occurs
**Then** the tool surfaces exactly which step failed, not just a generic error

**Given** a prior publish attempt failed partway (e.g. after bump and build succeeded)
**When** the developer re-triggers after a fix
**Then** the tool resumes from the failed step rather than restarting from bump — avoiding a duplicate version bump or a publish conflict on an already-published version

**Given** a re-trigger completes all remaining steps
**When** the run finishes
**Then** the tool re-verifies the version was actually published before marking it published — a prior failed attempt is never treated as success

**Given** a publish run is in progress
**When** the developer presses `q`
**Then** quitting requires explicit confirmation first, consistent with the Update zone's rule (Story 3.1)

**Given** a publish completes successfully
**When** the run finishes
**Then** the tool immediately offers propagation to the active EDT's eligible consumer members (one, several, or all), chaining into Story 4.3 — propagation remains independently triggerable later too (e.g. a newly added consumer catching up)

### Story 4.2: See Propagation Status

> Amended 2026-08-24 (Sprint Change Proposal, correction to not-yet-built Epic 4): the original "latest published version" framing is functionally wrong — `shared-types` version numbers are globally unique but published independently per branch, so the global maximum can be unrelated to the active EDT's own branch lineage (e.g. global latest = 660, but the version actually relevant to this branch = 613, because 614–660 were published from unrelated branches). Corrected to resolve "latest relevant" via git ancestry on the active EDT's own `shared-types` branch. The exact resolution mechanism (walking tags/commits reachable from the branch tip) is flagged for `bmad-architecture` to specify before this story is built.

As a developer,
I want to see which of my active EDT's member services are on the version relevant to my active EDT's own `shared-types` branch,
So that I never have to check `package.json` by hand across repos, and never get a false "behind" reading caused by an unrelated branch's version bump.

**Acceptance Criteria:**

**Given** the active EDT's member services
**When** the shared-types zone is viewed
**Then** every member service that declares itself a `shared-types-consumer` in its manifest shows whether it's on the version most recently published from the active EDT's own `shared-types` branch — resolved by walking that branch's git ancestry, never by comparing against the single highest version number across all branches

**Given** a member service that doesn't declare `shared-types-consumer`
**When** the view is rendered
**Then** it is omitted from this view

**Given** the status is viewed
**When** rendered
**Then** it reflects the branch-relevant latest version, resolved live via git ancestry at that moment — never cached, never the global maximum across unrelated branches

**Given** the active EDT has zero member services
**When** the shared-types zone is viewed
**Then** it shows an explicit "no members" state, not a bare empty list

### Story 4.3: Propagate to Chosen Services

As a developer,
I want to propagate the new `shared-types` version to some or all eligible member services in one action,
So that I don't bump each `package.json` by hand.

**Acceptance Criteria:**

**Given** one or more eligible member services selected (via `checkbox-list-item`)
**When** the developer triggers propagation
**Then** the tool stages the dependency bump (package.json/lockfile) and installs it per selected service

**Given** a propagation completes
**When** staged
**Then** the tool never commits or pushes the change without the developer's explicit approval — propagation prepares the change, never finalizes it

**Given** one service's propagation fails (e.g. an install error)
**When** it happens
**Then** it is independently retriable and does not block the others

**Given** a propagation or publish run is in progress
**When** the developer presses `q`
**Then** quitting requires explicit confirmation first, same rule as Story 4.1

## Epic 5: Aggregated Log Observability

A developer can view a live, filterable, aggregated log stream across multiple services, with inline health status and a developer-triggered restart control.

### Story 5.1: Aggregated Live Log Stream

As a developer,
I want to view a single live aggregated log stream from every service in my active EDT (or a chosen subset),
So that I stop hopping between terminals to diagnose an issue.

**Acceptance Criteria:**

**Given** the active EDT has member services
**When** the developer opens the Logs zone
**Then** a live stream aggregates logs from every member service (or a developer-chosen subset) in one view

**Given** the log stream is running
**When** new lines arrive
**Then** re-renders are debounced/batched rather than a full redraw per line — responsive under multiple concurrent `docker logs -f` streams (AD-12, NFR-1)

**Given** a log line is emitted by a container
**When** it appears in the view
**Then** it is visible within ~1s of emission (NFR-1)

**Given** the bounded in-memory ring buffer
**When** sized
**Then** it covers several minutes of session scroll-back, is owned by `core/logs` (not the docker adapter), and is discarded on tool restart — nothing written to disk (AD-11); its window is generous enough to be reused as-is by a later short-range correlation feature without changing this story's mechanism

**Given** a service has no running container
**When** the stream is viewed
**Then** it's shown as such explicitly
**And Given** a container stops/crashes mid-stream
**When** detected
**Then** it's shown as such and the tool attempts automatic reconnection when it returns

**Given** the active EDT has zero member services
**When** the Logs zone is opened
**Then** it shows an explicit "no members to aggregate" state, not a bare empty log view

### Story 5.2: Filter the Aggregated Stream

As a developer,
I want to filter the aggregated log stream by service, free-text/regex, and log level,
So that I can narrow in on what matters without losing the live view.

**Acceptance Criteria:**

**Given** a live stream
**When** a developer applies or changes a service/text/regex/level filter
**Then** the stream is not interrupted — it keeps streaming with the filter applied

**Given** a regex filter
**When** it doesn't compile
**Then** it's rejected with an inline error — never silently ignored or crashing the view

**Given** multiple filter dimensions are active at once (service + text + level)
**When** applied
**Then** they combine (AND) rather than one silently overriding another

**Given** a filter is cleared (`Esc`, per Story 1.13's canonical contract)
**When** cleared
**Then** the full unfiltered stream resumes immediately

### Story 5.3: Inline Service Health & Restart Control

As a developer,
I want to see each service's health right next to its logs and trigger a restart myself,
So that I never need a separate health check step and a failing service is never silently auto-restarted behind my back.

**Acceptance Criteria:**

**Given** a service's health (up/down/restarting)
**When** the Logs zone is viewed
**Then** it's visible inline with that service's logs — no separate health check step (FR-18)

**Given** a service is down
**When** the developer views its health badge
**Then** a restart control is available and developer-triggered — this replaces `check_health.sh`'s current silent auto-restart

**Given** a service is already restarting
**When** the developer looks at its restart control
**Then** it is disabled — a restart request on an already-restarting service is a no-op, never triggering a second concurrent restart

**Given** a restart completes
**When** the service comes back up
**Then** its health badge updates to reflect the new state, glyph+color paired per Story 1.9's status-badge rule

## Epic 6: Route Explorer

A developer can discover a repo's routes, fire a request with automatic dev-mode auth, save/customize/re-fire requests in a global library, and see the response and correlated logs together.

### Story 6.1: Route Discovery via a Pluggable Scanner Module

As a developer,
I want the tool to list the routes a repo's active route-explorer module discovers,
So that I can browse a repo's API without fighting the generated Swagger UI.

**Acceptance Criteria:**

**Given** a managed repo whose manifest activates a route-explorer module (e.g. `api-gateway`'s `nestjs-openapi` scanner)
**When** the developer opens the Routes zone for it
**Then** the tool lists every route that module's scanner discovers

**Given** a repo whose manifest does not activate a route-explorer module
**When** browsed
**Then** no route list is offered for it — route exploration is available only where manifest-activated, not hardcoded to the gateway (FR-19)

**Given** a scan fails (e.g. the OpenAPI spec can't be parsed)
**When** it happens
**Then** it is shown as a distinct scan-failure state — never rendered as an empty route list

**Given** a repo genuinely has zero routes
**When** scanned successfully
**Then** it is shown as a genuinely-empty list, visibly distinct from a scan failure

**Given** a future repo activates route exploration in its manifest with a scanner implementation for its language
**When** configured
**Then** no core code change is required — manifest-only activation (AD-4, AD-5)

### Story 6.2: Fire a Request with Automatic Dev-Mode Auth

As a developer,
I want to fire a request against any discovered route with authentication handled automatically,
So that I never re-enter a token by hand mid-session.

**Acceptance Criteria:**

**Given** a route discovered via Story 6.1
**When** a developer fires it
**Then** the request is sent with authentication for protected routes handled automatically by that repo's active auth module (e.g. `jose`-based dev-JWT for `api-gateway`)

**Given** a session firing requests across multiple different repos
**When** each is fired
**Then** no manual re-authentication is needed for any of them

**Given** a dev-mode token has expired
**When** a request is fired
**Then** the token is refreshed automatically without developer action

**Given** a fired request hits a permission mismatch on the target route
**When** the response comes back
**Then** it surfaces as a distinct auth error, not a generic request failure

### Story 6.3: Save, Customize, and Re-Fire a Request

As a developer,
I want to save a request and customize it before re-firing,
So that I build a personal library of realistic examples without losing the ability to fire ad hoc.

**Acceptance Criteria:**

**Given** a route discovered via Story 6.1
**When** a developer fires it without saving first
**Then** the ad-hoc customize-then-fire flow always works — saving is never required to fire

**Given** a developer saves a request (method, path, body, headers)
**When** saved
**Then** it is stored and available to re-fire later

**Given** a saved request is re-fired with further customization
**When** the developer confirms
**Then** they are offered both "overwrite the original" and "save as a new one" — chosen per fire, not a fixed setting

**Given** a save-as-new name collides with an existing saved request's name
**When** attempted
**Then** it is rejected and the developer is prompted for a different name

**Given** a rescan (Story 6.1) no longer discovers a saved request's route
**When** the saved-request list is viewed
**Then** that request is flagged stale and can be deleted — it is never fired silently

### Story 6.4: See Response and Relevant Logs Together

As a developer,
I want the response and the relevant aggregated logs to appear together immediately after firing,
So that I can trace an issue without opening a separate terminal.

**Acceptance Criteria:**

**Given** a request is fired (ad hoc or saved)
**When** the response arrives
**Then** it is shown together with the relevant aggregated logs for the affected services, in the same view, with no separate correlation step (FR-22, integrates Epic 5's log stream)

**Given** a route is fired for the first time
**When** the tool doesn't yet know its affected services
**Then** it proposes a default candidate set (the active EDT's members, logs windowed to the few seconds around the fire) rather than asking the developer to configure it upfront

**Given** the proposed candidate set
**When** the developer adds or removes services from it (before or after firing)
**Then** the adjusted set is saved against that route and reused automatically on every later fire — no per-fire reconfiguration

**Given** a route's real dependencies change over time
**When** the developer wants to update them
**Then** the learned affected-service set can be edited or reset later

### Story 6.5: Manage the Saved-Request Library Across EDTs

As a developer,
I want my saved requests to form one global library with per-EDT hide/favorite controls,
So that a request saved in one EDT is still useful from any other, without clutter.

**Acceptance Criteria:**

**Given** a request saved while working in one EDT
**When** a different EDT is active
**Then** that request is discoverable and fireable from it too, without re-saving (FR-23)

**Given** a developer hides a saved request from one EDT's view
**When** hidden
**Then** it is not removed from the global library or from any other EDT's view

**Given** a developer favorites a saved request per-EDT
**When** favorited
**Then** it appears in that EDT's quick-access list only
**And Given** a request is marked a global favorite instead
**When** favorited
**Then** it appears in every EDT's quick-access list by default

**Given** hide and favorite are the only clutter-management tools in v1
**When** the library is viewed
**Then** no folder or tagging system is offered
