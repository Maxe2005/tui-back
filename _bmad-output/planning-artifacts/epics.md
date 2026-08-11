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
FR-13: A developer can publish a new `shared-types` version through the tool, which runs the `shared-types` repo's existing `npm run v` script (bump → build → publish → push).
FR-14: The tool shows, for the active EDT's member services, which are on the latest published `shared-types` version and which aren't.
FR-15: A developer can propagate the new `shared-types` version to some or all of the active EDT's eligible member services in one action.
FR-16: A developer can view a single, live, aggregated log stream from every service in the active EDT, or a chosen subset.
FR-17: The aggregated log stream can be filtered by service, by free-text/regex search, and by log level, without restarting it.
FR-18: Service health (up / down / restarting) is visible inline with the log view.
FR-19: For any managed repo whose manifest activates a route-explorer module, the tool lists the routes that module's scanner discovers for that repo.
FR-20: A developer can fire a request against any route discovered via FR-19, with authentication for protected routes handled automatically in dev mode.
FR-21: A developer can save a request (method, path, body, headers), and when re-firing a saved request, can further customize it before sending — then either overwrite the original saved request or save the customized version as a new one.
FR-22: Firing a request (saved or ad hoc) surfaces its response and the relevant aggregated logs for the affected services in the same place, immediately after — with the affected-service set learned progressively per route rather than pre-configured.
FR-23: A developer's saved requests form one global library, not siloed per EDT; each EDT can independently hide individual saved requests from its own view and mark others as favorites (per-EDT or global).

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
- **Manifest is the only per-repo activation surface.** A repo is managed iff it carries a root `.tui-back.yaml`, zod-validated on load, declaring `service`, `container`, `migrationCommand`, optional `sharedBranch` (default `development`), and `modules` (module-id → per-module config) (AD-4).
- **Module implementations are statically registered, never dynamically loaded.** The tool ships a compiled-in registry mapping module id → implementation; a manifest only selects a key from that registry (AD-5).
- **Repo registry is explicit, never path-convention-based.** The set of local filesystem paths the tool scans lives in an explicit registry (`XDG_CONFIG_HOME/tui-back/registry.yaml`), populated by an explicit register action; a separate scan subcommand may propose candidates but never auto-registers (AD-6).
- **Storage topology.** One SQLite file per EDT at `XDG_DATA_HOME/tui-back/edts/<ulid>.db` (filename is a generated ULID, never the topic). One global store at `XDG_DATA_HOME/tui-back/global.db` (saved-request library, per-EDT hide/favorite flags, global favorites). Active-EDT pointer and transient UI state live at `XDG_STATE_HOME/tui-back/state.json`. Each `.db`'s schema evolves through hand-rolled, numbered `.sql` files tracked by a `schema_version` table — no external migration framework (AD-7).
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
UX-DR3: Implement the `zone-tab` component — six permanent top-bar entries (Dashboard, EDTs, Update, Logs, Routes, shared-types), inactive/active visual states, and a background-event glyph+counter badge that clears once the zone is visited.
UX-DR4: Implement the `status-badge` component — the closed glyph+color vocabulary (`●`/`○` up/down, `✔`/`✖` done/failed, `⣾` in-progress, `›`/`▸` selection/action marker), glyph and color always shipped together, never color alone.
UX-DR5: Implement the `list-row` component — base row, nested-member indent, selected state (surface-selected fill + accent bar + `›` marker), and right-aligned/trailing dim meta-suffix (branch, divergence, timestamp).
UX-DR6: Implement the `detail-pane` component — uppercase label-styled title, body content, and an outcome-colored `summary-line` divider (success/warning/error) for run-outcome panes.
UX-DR7: Implement the `footer-hint` component — permanent bottom row of contextual `[key] action` pairs, ordered left-to-right by expected frequency, always reflecting the current context's live keybindings.
UX-DR8: Implement the `modal-dialog` component — bold-border floating dialog for confirmations, guided-resolution menus, and the keybinding-help screen; `Escape` always cancels, `Enter` always confirms regardless of trigger method (mouse or keyboard).
UX-DR9: Implement the `checkbox-list-item` component — `[ ]`/`[x]` multi-select rows for EDT member selection, log-view service filter, and saved-request batch actions; `Space` toggles, `Enter` confirms the whole selection.
UX-DR10: Implement the `splitter` component — single-character divider between list/detail panes; mouse-drag resize; `Ctrl+W` keyboard resize-mode with arrow-key resize, `Tab` cycling the active boundary, `Enter`/`Esc` exit; pane sizes persist per zone independently across sessions.
UX-DR11: Implement the `spinner` component — single functional in-progress indicator (`⣾` braille glyph cycling), the only animated element in the system.
UX-DR12: Implement the `dim-annotation` component — optional italic/dim/indented "wink" line beneath a factual message, never the sole carrier of required information.
UX-DR13: Implement the permanent top bar — app name, active EDT name, `[/]` filter and `[:]` command affordances, always visible above the zone-tab bar.
UX-DR14: Implement the launch banner — a k9s-inspired ASCII-art banner shown once on launch, above/within the Dashboard zone's content area, monochrome (text-dim or accent), no motion/gradient.
UX-DR15: Implement the dedicated keybinding-palette/help screen — opened via `?` from any zone, a `modal-dialog` instance listing every key + description beyond the contextual footer-hint, read-only, scrollable with `j`/`k`, closes via `Esc` or `?` again.
UX-DR16: Implement the canonical keybinding contract — `j`/`k` move, `g`/`G` top/bottom (list-jump only, never zone-switching), `Space` toggle, `Enter` confirm, `Esc` cancel, `Tab` cycle, `Ctrl+W` resize-mode, `/` filter, `:` command entry, `?` help, `q` quit (confirms first if a group update/publish/propagation run is in progress), and single-letter zone mnemonics `d`/`e`/`u`/`l`/`r`/`s`.
UX-DR17: Implement the two-layer outcome-message voice pattern across every zone — a dry/factual primary line sufficient on its own, with an optional `dim-annotation` wink line that is never required and never folded into the primary line; raw stderr/stack traces always stay one action away, never fully hidden.
UX-DR18: Implement the resizable list/detail split as the primary content layout within each zone (roughly 2:3 list:detail ratio), per `{components.splitter}`.
UX-DR19: Implement Dashboard zone states — cold-load spinner, populated (active EDT + member health + last group-update timestamp + default "enter last EDT" action), "no EDT yet" first-run prompt, and background-event badge surfacing while on Dashboard.
UX-DR20: Implement EDTs zone states — empty (explicit "create first EDT" prompt), populated (list with branch + ahead/behind per service), no-upstream/offline divergence display, duplicate-topic rejection, zero-member-at-creation rejection, per-service branch-creation failure reporting, shared-branch rejection (with explanation before any git write), member added/removed without disturbing others, zero-member EDT display (never an error), member branch change (protected-switch rule), protected-switch-blocked-during-update prompt, and interrupted-update recovery offer.
UX-DR21: Implement Update zone states — idle (last outcome visible), no-op-on-zero-member message, all-repos confirmation gate, second-run-blocked message, in-progress per-service spinner, per-service outcome summary (updated/skipped/failed, none silently absent), assisted-resolution guided menu (stash/open-in-editor/cancel-repo/cancel-run), mid-merge/mid-rebase distinct state, migration-failure detail + re-trigger with re-verify, and quit-mid-run confirmation with next-launch interrupted-run resume offer.
UX-DR22: Implement Logs zone states — no-members explicit state, live streaming with debounced/batched re-renders, filter applied without interrupting the stream, invalid-regex inline rejection, service-down/crashed-mid-stream inline display with auto-reconnect, inline health (up/down/restarting), and restart-in-progress control disabling to prevent a second concurrent restart.
UX-DR23: Implement Routes zone states — scan-in-progress spinner, scan-failure vs. genuinely-empty-list as distinct states, fired/response view with correlated logs in the same pane, auth-error as a distinct state from a generic request failure (with automatic token refresh), unlearned-affected-service-set default-proposal-and-adjust flow, stale-saved-request flagging (never fired silently), save-as-new name-collision rejection, and library hide/favorite behavior (per-EDT vs. global, independent scopes).
UX-DR24: Implement shared-types zone states — no-members explicit state, publish-in-progress per-step status with spinner, publish-step-failure detail + resume-from-failed-step re-trigger, propagation status (on-latest vs. behind, live not cached), propagation-in-progress/per-service-failure independent retriability, and quit-mid-run confirmation with resume offer.
UX-DR25: Implement cross-cutting focus/selection treatment (`list-row` selected state) uniformly across every zone's list/detail split.
UX-DR26: Implement the accessibility floor — status never conveyed by color alone (glyph always paired), every keyboard primitive available without a mouse, comfortable warm-off-white-on-charcoal reading contrast.
UX-DR27: Implement the mouse-optional interaction model — every keyboard action has an equivalent mouse action (click select/activate, drag-resize splitter) but no action is ever mouse-only; Ink's lack of built-in mouse support is a flagged risk with `Ctrl+W` keyboard resize-mode as the confirmed-safe fallback.

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

### Story 1.12: Launch Banner & Keybinding-Help Screen

As a developer,
I want a launch banner and a full keybinding reference reachable from anywhere,
So that I get a k9s-style first impression and never have to guess a key the footer doesn't show.

**Acceptance Criteria:**

**Given** the app starts
**When** the Dashboard first renders
**Then** a k9s-inspired ASCII banner shows once, monochrome, no motion/gradient

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
**When** `j`/`k` (or arrows) are pressed
**Then** the highlight moves
**And When** `g`/`G` are pressed
**Then** it jumps to top/bottom — never switching zones

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

As a developer,
I want to publish a new `shared-types` version through the tool,
So that I don't have to run the release script by hand and lose track of which step failed if something breaks.

**Acceptance Criteria:**

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

### Story 4.2: See Propagation Status

As a developer,
I want to see which of my active EDT's member services are on the latest `shared-types` version,
So that I never have to check `package.json` by hand across repos.

**Acceptance Criteria:**

**Given** the active EDT's member services
**When** the shared-types zone is viewed
**Then** every member service that declares itself a `shared-types-consumer` in its manifest shows whether it's on the latest published version or behind

**Given** a member service that doesn't declare `shared-types-consumer`
**When** the view is rendered
**Then** it is omitted from this view

**Given** the status is viewed
**When** rendered
**Then** it reflects the latest published version at that moment, not a cached one

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
