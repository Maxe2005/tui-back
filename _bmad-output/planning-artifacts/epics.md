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
FR-7: Assigning a shared/protected branch (the service manifest's `protectedBranches` ∪ its `sharedBranch` — amended 2026-09-28) as an EDT's "own" branch for a service is rejected.
FR-8: While an EDT is active, every managed repo that is not one of its member services is kept on `development` (or its configured shared branch).
FR-9: Every managed service is displayed with its current branch and how far that branch has diverged from its own origin/upstream, in both directions — ahead and behind.
FR-10: A developer can run a group update — pull `development`, run migrations, restart containers — against either the active EDT's member services (default) or explicitly against all managed repos regardless of EDT (maintenance mode).
FR-11: When a group update hits a repo that isn't cleanly updatable, the tool auto-resolves already-known-safe cases and otherwise guides the developer through a bounded menu, then re-verifies before continuing.
FR-12: When a migration fails during a group update, the tool surfaces which service, which migration, and the error output, and lets the developer re-trigger just that service's migration after a fix.
FR-13: A developer can publish a new `shared-types` version through the tool (publish command, default `npm run v`; per-step progress, resume from the failed step, publication verified on the registry), gated on the active EDT including the `shared-types-source` repo, optionally chaining into propagation (amended 2026-10-05).
FR-14: The tool shows, per consumer service of the active EDT, the `shared-types` version declared in its `package.json` versus the one declared by the source repo on the EDT's branch — niche/optional, no git-ancestry resolution (amended 2026-10-05).
FR-15: A developer enters a `shared-types` version and applies it to some or all of the active EDT's consumer services (dependency-line rewrite, then optional `npm i` / clean restart / commit of `package.json` and `package-lock.json` only, never a push) (amended 2026-10-05).
FR-16: A developer can view a single, live, aggregated log stream from every service in the active EDT, or a chosen subset.
FR-17: The aggregated log stream can be filtered by service, by free-text/regex search, and by log level, without restarting it (amended 2026-09-18, Sprint Change Proposal, Story 5.4: extends to recall of previously used text/regex filters, per scope, not just new filtering mechanics).
FR-18: Service health (up / down / restarting) is visible inline with the log view.
FR-19: For any managed repo whose manifest activates a route-explorer module, the tool lists the routes that module's scanner discovers for that repo.
FR-20: A developer can fire a request against any route discovered via FR-19, with authentication for protected routes handled automatically in dev mode.
FR-21: A developer can save a request (method, path, body, headers), and when re-firing a saved request, can further customize it before sending — then either overwrite the original saved request or save the customized version as a new one.
FR-22: Firing a request (saved or ad hoc) surfaces its response and the relevant aggregated logs for the affected services in the same place, immediately after — with the affected-service set learned progressively per route rather than pre-configured.
FR-23: A developer's saved requests form one global library, not siloed per EDT; each EDT can independently hide individual saved requests from its own view and mark others as favorites (per-EDT or global).
FR-24 (added 2026-09-16, Sprint Change Proposal): A developer can delete an EDT they no longer need, choosing per member service whether to leave its branch alone or delete it too — informed by that branch's merge status (into its `sharedBranch`) and any uncommitted work — with deletion blocked while the EDT is active and blocked per-service when the branch is also registered as another EDT's own branch for that repo.
FR-28 (added 2026-10-01, Sprint Change Proposal): Merge source from another EDT — global merge-source strategy (shared branches / another EDT) in the EDT-scoped update configuration, with per-service manual resolution for services absent from the chosen EDT.
FR-30 (added 2026-10-05, Sprint Change Proposal): Smart group update — `shared-types` is processed first, then published, propagated and committed, per an update-configuration setting.
FR-31 (added 2026-10-05, Sprint Change Proposal): Auto-resolve merge conflicts limited to the `shared-types` dependency line.
FR-29 (added 2026-10-01, Sprint Change Proposal): Container-less managed services — `container` optional in the manifest; restart/health/logs degrade to an explicit "no container" state.
FR-32 (added 2026-10-05, Sprint Change Proposal): Per-service last-run merge/migration detail in Update, session-only.
FR-33 (added 2026-10-05, Sprint Change Proposal): Reversible, unified focus navigation — Shift+Tab reverses Tab everywhere via one configurable primitive.

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
UX-DR20: Implement EDTs zone states — empty (explicit "create first EDT" prompt), populated (list with branch + ahead/behind per service), no-upstream/offline divergence display, duplicate-topic rejection, zero-member-at-creation rejection, per-service branch-creation failure reporting, shared-branch rejection (with explanation before any git write), member added/removed without disturbing others, zero-member EDT display (never an error), member branch change (protected-switch rule), protected-switch-blocked-during-update prompt, interrupted-update recovery offer, and member/non-member service categorization with per-service contextual actions (amended 2026-08-26, Sprint Change Proposal, Story 2.18); fixed, resizable borders between EDT selector/EDT SERVICES/OTHER SERVICES (amended 2026-08-27, Sprint Change Proposal, Story 2.21). Amended 2026-09-16 (Sprint Change Proposal): adds "EDT deleted" (per-service branch-disposition confirmation, active-EDT-blocked, cross-EDT branch-collision-blocked-per-service — Story 2.29), "EDT quick-pick" (filterable list for `edt-switch`/`edt-modify` with no argument, including its own "no matching EDT" state — Story 2.30), and "Create from existing EDT" (member checklist pre-seeded from a root EDT, root-branch-derived base-branch suggestion — Story 2.31) as new named states. Amended 2026-09-20 (Sprint Change Proposal, Story 5.5): EDT SERVICES/OTHER SERVICES lists adopt the same bounded/scrollable list primitive as the Logs zone (UX-DR33), for the same reason.
UX-DR21: Implement Update zone states — idle (last outcome visible), no-op-on-zero-member message, all-repos confirmation gate, second-run-blocked message, in-progress per-service spinner, per-service outcome summary (updated/skipped/failed, none silently absent), assisted-resolution guided menu (stash/open-in-editor/cancel-repo/cancel-run), mid-merge/mid-rebase distinct state, migration-failure detail + re-trigger with re-verify, and quit-mid-run confirmation with next-launch interrupted-run resume offer.
UX-DR22: Implement Logs zone states — no-members explicit state, live streaming with debounced/batched re-renders, filter applied without interrupting the stream, invalid-regex inline rejection, service-down/crashed-mid-stream inline display with auto-reconnect, inline health (up/down/restarting), and restart-in-progress control disabling to prevent a second concurrent restart. Amended 2026-09-18 (Sprint Change Proposal, Story 5.4): adds filter-history browsing (arrow-recall and grid-browser, see UX-DR32) as a new named state. Amended 2026-09-20 (Sprint Change Proposal, Story 5.5): service lists, the hints panel, and `LogFilterEditor` (including its history-grid browser) now render within a bounded, scrollable window (UX-DR33) rather than unconditionally, preventing terminal-overflow rendering corruption.
UX-DR23: Implement Routes zone states — scan-in-progress spinner, scan-failure vs. genuinely-empty-list as distinct states, fired/response view with correlated logs in the same pane, auth-error as a distinct state from a generic request failure (with automatic token refresh), unlearned-affected-service-set default-proposal-and-adjust flow, stale-saved-request flagging (never fired silently), save-as-new name-collision rejection, and library hide/favorite behavior (per-EDT vs. global, independent scopes). Amended 2026-09-30 (Sprint Change Proposal, Stories 6.6–6.9): the Routes zone's right pane is a focusable two-tab pane (Request / Response, Logs added by Story 6.4) reached with `Enter` from the list; request editing is a mandatory step before any fire; the response is browsed in a JsonTree with session-persistent, per-route filters (UX-DR34).
UX-DR24: Implement shared-types zone states (rewritten 2026-10-05) — no-members explicit state, version-entry field (`0.1.` prefix) + consumer checklist, independent options (`npm i`, clean restart, commit), per-service propagation result/skip reason/independent retry, publish-in-progress per-step status with spinner, publish-step-failure detail + resume, publish-success chaining into propagation, niche declared-version drift view, and quit-mid-run confirmation. UX-DR21 gains a `shared-types` row (off / publish if the merge changed something / always) in the update configuration.
UX-DR25: Implement cross-cutting focus/selection treatment (`list-row` selected state) uniformly across every zone's list/detail split.
UX-DR26: Implement the accessibility floor — status never conveyed by color alone (glyph always paired), every keyboard primitive available without a mouse, comfortable warm-off-white-on-charcoal reading contrast.
UX-DR27 (added 2026-08-24, Sprint Change Proposal, Story 2.11; command mechanism corrected 2026-08-25, Story 2.14): Implement the repo registry screen — static manifest-creation guidance always shown, scan-a-root-path via `checkbox-list-item` multi-select, per-path register outcome (registered/already-registered/failed), distinct empty-scan state, reachable as a registered command inside the `:` command-entry bar (UX-DR29) and auto-offered from Dashboard's "no repos registered yet" state.
UX-DR28 (added 2026-08-24, Sprint Change Proposal, Story 2.12; mechanism corrected 2026-08-25 after a review loopback): Implement zone arrow navigation — `Left`/`Right` directly switch the active zone to the previous/next zone in tab-bar order, wrapping at the ends, always available with no form/overlay capturing input. No focus mode; `Tab` is untouched.
UX-DR29 (added 2026-08-25, Sprint Change Proposal, Story 2.14; reveal mechanism corrected 2026-08-26, Sprint Change Proposal, Story 2.17): Implement the `:` command-entry bar — a `modal-dialog` instance with a text input; no command list shows on open. `Tab` on an empty input shows the full command grid (UX-DR30); `Tab` on a non-empty input autocompletes on a single match, completes to the longest common prefix when several matches share one, or (when already at that prefix) requires a second `Tab` within a short window to reveal the matching-commands grid. `Enter` runs an exact match and closes the bar, `Esc` cancels without executing, and an unmatched `Enter` shows an inline "unknown command" message rather than doing nothing silently. Amended 2026-09-28 (Sprint Change Proposal, Story 5.6): adds command-history recall — `↑` from the input browses previously run (recognized) commands with draft preservation, per the shared input-history recall pattern (UX-DR32); `↓` from an untouched draft keeps its existing grid-entry meaning (no history grid for commands).

UX-DR30 (added 2026-08-26, Sprint Change Proposal, Story 2.17): Implement the `command-grid` component — a multi-column, arrow-navigable browser for the command bar's matching commands (UX-DR29), column-major left-to-right layout with a configurable max rows per column, trailing `…` truncation when the full grid exceeds the display width, and horizontal scrolling at either extremity to reveal columns hidden by that truncation. `Down` from the input enters the grid (landing top-of-first-column); `Up` from a column's top row returns to the input; `Enter` or any typed character exits back to the input (completing or resuming edit, respectively). Amended 2026-09-18 (Sprint Change Proposal, Story 5.4): the component is generalized and reused for the filter-history grid browser (UX-DR32) — a second, independent instance with its own rows-per-column setting.

UX-DR29 amended 2026-09-16 (Sprint Change Proposal): the registered command set grows to include `edt-delete` (Story 2.29), `edt-create-from` (Story 2.31), and a `registry validate` action inside the existing `registry` screen rather than a new top-level command (Story 2.28) — same command-bar mechanism, no new UI pattern.

UX-DR31 (added 2026-08-26, Sprint Change Proposal, Story 2.19): Implement the settings screen — a tab-organized `modal-dialog` instance (a "General" tab plus one tab per configurable feature area), reachable only as a registered `:` command (mirrors UX-DR27's repo-registry-screen precedent — never bound to a raw keypress). Every change applies and persists immediately, no separate save step; a tab with zero settings renders validly, never as an error. Amended 2026-08-28 (Sprint Change Proposal, Story 2.19): a tab may itself hold more than one distinct settings group (first case: the "EDTs" tab, see Story 2.19 below) — such a tab opens on an Up/Down-navigable group list, `Enter` drills into a group's own `checkbox-list-item` list, and `Esc` steps back up one level (out of a group, then — one more `Esc` — closing the whole screen); a tab with a single flat settings list (Command Palette) is unaffected, no group level. Amended 2026-09-18 (Sprint Change Proposal, Story 5.4): the Logs tab, which previously had no row cursor (`Up`/`Down` claimed exclusively by `bufferSize`), grows to 4+ fields plus history-clear actions and gains its own row-cursor navigation model, mirroring the EDTs tab's group-list precedent. Amended 2026-09-28 (Sprint Change Proposal, Story 5.6): the Command Palette tab grows from its single flat field (`gridMaxRows`, which owned `Up`/`Down`) to three fields — grid max rows, command history size, deduplicate command history — plus a "clear command history" action, and gains the same row-cursor navigation model the Logs tab adopted in Story 5.4.

UX-DR32 (added 2026-09-18, Sprint Change Proposal, Story 5.4): Implement filter-history recall in the Logs zone's filter editor — `↑`/`↓` arrow-browse over a scope+mode-specific history (global/per-service × text/regex, each independent) with draft preservation (the in-progress, uncommitted draft is restored when browsing back past the most recent entry), any printable character or Backspace pressed while browsing snapping back to the draft with that keypress applied on top of it, and `↓` from the draft (not browsing) opening the reused `command-grid` component (UX-DR30) as a grid browser over the full history. Amended 2026-09-28 (Sprint Change Proposal, Story 5.6): generalized into a shared input-history recall pattern with two consumers — the Logs filter editor (above, scope+mode-keyed lists, with the `↓`-from-draft grid browser) and the `:` command bar (UX-DR29, a single command list, no grid browser). The push/dedup/trim rules, arrow-browse with draft preservation and skip-equal-to-draft, and snap-back-on-keypress behavior are one implementation shared by both; each consumer only supplies its own history list(s) and its own size/dedup settings.
UX-DR33 (added 2026-09-20, Sprint Change Proposal, Story 5.5): Implement the `bounded-list` component — a scrollable window over any list or panel whose content can exceed the terminal's available rows, extracted from `keybinding-help.tsx`'s `resolveHelpWindow`/`clampHelpOffset`; shows a subtle more-above/below indicator when scrolled away from either end, recalculates live off `useWindowSize()`. Reused by the Logs zone (service lists, hints panel, `LogFilterEditor`) and the EDTs zone (EDT SERVICES/OTHER SERVICES lists).
UX-DR34 (added 2026-09-30, Sprint Change Proposal, Stories 6.6–6.9): Implement the `JsonTree` component and the Routes right-pane sub-tabs — a shared, windowed, line-by-line navigable JSON tree (built on `bounded-list`, UX-DR33) with per-node fold and global key show/hide rules (per route, session-only, stored by normalized path / key name), in read-only (response) and edit (request body) modes; hidden content is never removed from a request body, and a truncated or non-JSON response falls back to raw text with a visible reason. Pane sub-tabs switch with `Ctrl+→`/`Ctrl+←`, fallback `Ctrl+N`/`Ctrl+P` (the same convention as the EDT create wizard).
UX-DR35 (added 2026-10-01, Sprint Change Proposal, Story 7.3): Every zone builds its layout through one shared zone-layout contract declaring its panes and the boundaries between them (orientation, default ratio, min/max); the contract provides splitter rendering, accent recoloring when targeted, Ctrl+W resize-mode, Tab boundary cycling and per-zone persisted ratios — no zone hand-rolls a split.
UX-DR36 (added 2026-10-01, Sprint Change Proposal, Story 7.4): Interaction consistency contract — the same intent uses the same key, wording and component in every zone (list cursor, edit/commit/cancel, confirm dialogs, destructive-action confirmation, filter, footer hint format, modal titles, empty/error/loading states). Recorded as a table in EXPERIENCE.md; deviations require a documented reason. Amended 2026-10-05 (Sprint Change Proposal, Story 7.7): Shift+Tab always reverses Tab; every zone declares focus movement through one shared navigation primitive (H/V arrows, Tab/Shift+Tab, Ctrl+N/P per zone).
UX-DR10 amended 2026-10-01: resize-mode is available in every zone (UX-DR35), not only the EDTs zone.
UX-DR19 amended 2026-10-01: see EXPERIENCE.md State Patterns › Dashboard (container status + branches + divergence per member, working-tree alerts, quick actions, registry health, operation in progress).
UX-DR21 amended 2026-10-01: adds the merge-source strategy states (FR-28).
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
FR-28: Epic 3 - Merge source from another EDT (added 2026-10-01, Sprint Change Proposal — Story 3.12)
FR-13: Epic 4 - Publish a new shared-types version
FR-14: Epic 4 - See declared-version drift (niche)
FR-15: Epic 4 - Propagate a version to chosen services
FR-30: Epic 4 - Smart group update (added 2026-10-05, Sprint Change Proposal — Story 4.4)
FR-31: Epic 4 - Auto-resolve shared-types-only merge conflicts (added 2026-10-05, Sprint Change Proposal — Story 4.5)
FR-16: Epic 5 - Aggregated live log stream
FR-17: Epic 5 - Filter the aggregated stream
FR-18: Epic 5 - Inline service health
FR-19: Epic 6 - Route discovery via a pluggable scanner module
FR-20: Epic 6 - Fire a request with automatic dev-mode auth
FR-21: Epic 6 - Save, customize, and re-fire a request
FR-22: Epic 6 - See response and relevant logs together
FR-23: Epic 6 - Manage the saved-request library across EDTs
FR-29: Epic 7 - Container-less managed services (added 2026-10-01, Sprint Change Proposal — Story 7.2)
FR-32: Epic 7 - Per-service last-run detail in Update (added 2026-10-05, Sprint Change Proposal — Story 7.8)
FR-33: Epic 7 - Reversible, unified focus navigation (added 2026-10-05, Sprint Change Proposal — Story 7.7)

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
A developer can run a group update (pull, migrate, restart) scoped to the active EDT, to all managed repos, or to a single service — configured beforehand (service selection, per-service branch, migrate/clean-restart toggles) and followed live per-service — with assisted resolution of conflicts and migration failures.
**FRs covered:** FR-10, FR-11, FR-12
**Implementation notes:** Update zone (UX-DR21), reuses Epic 2's git safety gate (AD-8), detect → auto-fix-known-safe-or-guided-menu → re-verify mechanic.

### Epic 4: `shared-types` Propagation & Smart Update
A developer can propagate a `shared-types` version to the active EDT's consuming services, publish new versions, and let a group update handle `shared-types` automatically — publish, propagate, commit and conflict resolution.
**FRs covered:** FR-13, FR-14, FR-15, FR-30, FR-31
**Implementation notes:** First company-specific module, validating AD-4/AD-5 (AD-18); shared-types zone (UX-DR24). Prerequisites: Epic 7 done; Epic 3 merged into `devlopment` for Stories 4.4/4.5 (Sprint Change Proposal 2026-10-05).

### Epic 5: Aggregated Log Observability
A developer can view a live, filterable, aggregated log stream across multiple services, with inline health status and a developer-triggered restart control.
**FRs covered:** FR-16, FR-17, FR-18
**Implementation notes:** Bounded in-memory ring buffer (AD-11), debounced/batched render performance budget (AD-12, NFR-1 — the surface most exposed to Ink's rendering ceiling), Logs zone (UX-DR22).

### Epic 6: Route Explorer
A developer can discover a repo's routes, fire a request with automatic dev-mode auth, save/customize/re-fire requests in a global library, and see the response and correlated logs together.
**FRs covered:** FR-19, FR-20, FR-21, FR-22, FR-23
**Implementation notes:** Second pluggable module (NestJS/OpenAPI scanner + `jose` dev-JWT auth), `global.db` (AD-7), Routes zone (UX-DR23).

### Epic 7: TUI Consistency, Dashboard & Code Hygiene
> Added 2026-10-01 (Sprint Change Proposal `sprint-change-proposal-2026-10-01.md`).

A developer gets a Dashboard that actually summarizes their workspace, a TUI whose zones all behave the same way (one layout contract with Ctrl+W resize everywhere, one interaction vocabulary, one focus-navigation primitive with Shift+Tab reversal), per-service last-run transparency in Update, support for services that have no container, and a codebase whose comments explain the code rather than its history.
**FRs covered:** FR-29, FR-32, FR-33 (plus completion of UX-DR10, UX-DR19)
**Implementation notes:** AD-17 (comment convention), AD-4 amendment, AD-16/GitPort diff capability (7.8), UX-DR35, UX-DR36 (amended 2026-10-05: Shift+Tab rule + nav-component contract). Story 7.1 runs first, while no other story branch is in flight. Execution order: 7.2-graft → 7.8 (parallel OK) → 7.3 → 7.7 → 7.4 → 7.5/7.6.

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
So that an EDT can never gain write authority over a protected branch of that service (Story 2.42: manifest `protectedBranches` ∪ `sharedBranch`).

> Amended 2026-09-28 (Sprint Change Proposal): protected set now manifest-defined, see Story 2.42.

**Acceptance Criteria:**

**Given** any git write in the tool
**When** about to execute
**Then** it passes through the centralized git-adapter, which resolves the allowed-branch context itself from EDT/manifest state — never trusting a caller-supplied branch name (AD-8)

**Given** a developer attempts to register a protected branch of that service (Story 2.42: manifest `protectedBranches` ∪ `sharedBranch`) as an EDT's own branch (at creation via Story 2.2 or later via Story 2.5)
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

**Implementation notes:** the registry-wide check requires loading manifests for all registered repos (not just active-EDT members) at shell level — verify this doesn't complicate the cold-load spinner state (UX-DR19). The `shared-types-source` module id and its parameters are specified under Epic 4 Story 4.1 (rewritten 2026-10-05; the git-ancestry mechanism is superseded).

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
>
> Amended 2026-09-24 (Sprint Change Proposal): re-targeted from the flat create dialog to the 4-step creation wizard (Stories 2.36/2.37), which replaces it.

As a developer, I want to create a new EDT starting from an existing one's member services (with the ability to add or remove some), where every inherited service's new branch is based on that service's *current* branch in the root EDT, so that I can spin off a continuation of in-progress work without losing the branch context it was building on.

**Acceptance Criteria:**

**Given** the command bar, `edt-create-from` run with no argument **When** executed **Then** Story 2.30's quick-pick opens (any EDT selectable) to choose the root EDT.

**Given** `edt-create-from <topic>` **When** `<topic>` matches an existing EDT **Then** it's pre-targeted directly, skipping the quick-pick; no match shows an inline "EDT not found" error.

**Given** a root EDT is resolved **When** the creation wizard opens (Story 2.36) **Then** Step 2's checklist is pre-checked with exactly the root EDT's current members — still a normal, fully-editable `checkbox-list-item` list (add/remove any service).

**Given** Step 3 (Story 2.37) **When** a selected member *was* a member of the root EDT **Then** its row starts in `[Créer (Perso)]` with that member's own branch in the root EDT as base (not `sharedBranch`, not `development`).

**Given** a selected member that was *not* part of the root EDT **When** Step 3 renders **Then** its row starts in `[Créer (Global)]`, following Panel A's global strategy — unchanged.

**Given** the pre-filled base-branch suggestion **When** shown **Then** it stays fully editable, same convention as every other suggestion in this zone.

**Given** the new EDT's topic **When** entered **Then** it follows the normal uniqueness rule (FR-3) — never auto-derived from the root EDT's topic, always typed fresh.

**Implementation notes:** the wizard's initial state gains an optional `seedFromEdt: EdtRegistryEntry` that pre-populates Step 2's selection and Step 3's per-row plans. New `commands.ts` entry `edt-create-from`. Depends on Stories 2.30 and 2.37 — sequence after both.

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

### Story 2.33: Registry — Deregister Stale, Unreachable, or Unmanaged Repos

> Added 2026-09-22 (Sprint Change Proposal): closes a gap flagged since Story 1.5's own code review (`deferred-work.md`: "`RegistryPort` has no unregister/remove: dead/replaced paths accumulate in `registry.yaml` forever; nothing prunes them ... the story where registry editing (unregister) is in scope") and named again by Story 2.25's acceptance criteria, which explicitly listed "stale-registry re-registration" as a future assisted-resolution action out of that story's scope. Confirmed in real usage: `switchActiveEdt` (`core/edt/switch.ts`) walks every path in `registry.list()`, not just the target EDT's members — a registered path whose repo no longer exists, or whose `.tui-back.yaml` was removed, surfaces a `failed` row on every single `edt switch`, regardless of which EDT is being switched to.

As a developer, I want to review and remove stale entries from the managed-repo registry — a path that no longer exists on disk, or one whose `.tui-back.yaml` is gone — so that a repo I deleted or deliberately un-managed stops generating a `failed` row on every EDT switch, without me hand-editing `registry.yaml`.

**Acceptance Criteria:**

**Given** `RegistryPort` **When** extended **Then** it gains `remove(path): Promise<Result<void>>` (adapter: `removeRegistry` in `adapters/driven/registry/index.ts`, same read-modify-write shape as `addRegistry`) — a targeted single-path removal, distinct from `reset` (whole-file replacement for corrupt-registry recovery only); removing a path not currently registered is a no-op success, not an error.

**Given** a new core use-case (`core/scripts/clean-registry.ts`, mirroring `list-repos.ts`'s shape) **When** run **Then** it classifies every registered path into exactly the two "stale" categories `list-repos`/`listEdtBranchesDivergence` already compute today: `unreachable` (`registry.exists()` returns `false`) and `manifest-not-found` (`manifest.load()` fails with that exact code) — never any other manifest-load error (invalid YAML, schema failure, `unknown-module`), which stay a manifest-content problem (Story 2.28's territory), not a registry-hygiene one.

**Given** the candidate list **When** presented, via CLI or TUI **Then** removal is never automatic or silent — every candidate is shown with its path and reason (unreachable / no manifest) before anything is removed, and an explicit confirmation (or explicit per-path selection) is required; a run that finds zero candidates reports that explicitly, never silently exiting.

**Given** the CLI **When** a `registry clean` invocation lists candidates and confirms **Then** each confirmed path is removed via `RegistryPort.remove`, one outcome row per path (`removed`/`failed`), per-path failure isolation (one `remove` failure never blocks the others) — same AD-2 script/CLI parity every other action provides.

**Given** the TUI's REPO REGISTRY screen (Story 2.11) **When** open **Then** it gains a "Clean stale entries" action alongside scan/register(/validate, Story 2.28): running it lists candidates as a `checkbox-list-item` list (pre-checked, same "detect → guided choice → act" convention Story 2.29's per-service disposition list already uses), and confirming removes the checked ones, reported via the same structured per-repo outcome list Story 2.25/2.28 already use.

**Given** a stale path also recorded as a member of some EDT in `edts.yaml` **When** it is removed from `registry.yaml` **Then** the EDT record itself is left untouched — `switch.ts`'s existing `repo-not-registered` failed-row handling (review patch, Story 2.4) already covers a target member no longer in the registry, so this story never writes to `edts.yaml`; the candidate list surfaces this case with an extra note ("still a member of EDT <topic>") so the developer isn't surprised later, but it doesn't block removal.

**Implementation notes:** `core/scripts/clean-registry.ts` takes `{registry, manifest, edtRegistry}` and returns `{candidates: StaleRegistryEntry[]}` where `StaleRegistryEntry = {path, reason: 'unreachable' | 'manifest-not-found', memberOfEdts: string[]}` — `memberOfEdts` is populated purely for the AC6 display note, never used to gate removal. A second exported function (or a `paths: string[]` parameter on the same use-case) performs the confirmed removal, calling `registry.remove(path)` per confirmed path with per-path isolation, mirroring `create.ts`'s/`switch.ts`'s own per-repo isolation convention. CLI: `tui-back registry clean` (list-then-confirm interactive on a TTY; `--yes` with repeated `--path <path>` flags for scripted use, consistent with `update`'s `--all --yes` precedent). TUI: new `RegistryScreenPhase` states (`cleaning` → `clean-results`), reusing `repo-registry-screen.tsx`'s existing candidate-list/checkbox/results pattern (Story 1.9/2.11) rather than inventing a new component. Closes the `deferred-work.md` "`RegistryPort` has no unregister/remove" entry (Story 1.5 review) once shipped.

### Story 2.34: EDT Zone — Colored, Explained Service-Listing Issues

> Added 2026-09-23 (direct request, not a full Sprint Change Proposal cycle): the `unreachable`/`errors` counts `listEdtBranchesDivergence` already computes (Story 2.6, first surfaced by the "review patch" in Story 2.18) render today as a single dim, easy-to-miss line ("1 error" / "2 unreachable, 3 errors") with no way to see *which* repo is affected, *why*, or what to do about it. Real-usage feedback: the line blends into the rest of the dim UI chrome and gives no path to a fix.

As a developer, I want the unreachable/error summary in the EDT zone to stand out and to explain each affected repo, so that I notice a listing problem immediately and know what to do about it instead of squinting at a vague count.

**Acceptance Criteria:**

**Given** `unreachable.length > 0` or `errors.length > 0` **When** the SERVICES list renders **Then** the summary line is colored by severity — `colors.error` (with a `✖` glyph) when `errors.length > 0`, else `colors.warning` (with a `▲` glyph) when only `unreachable` is non-empty — instead of the current uniform dim gray; the `status === 'error'` gating that already hides a stale summary during a load failure (Story 2.18 review fix) is unchanged.

**Given** the colored summary line **When** no dialog is open **Then** it carries a `[i] details` hint, and pressing `i` from any of the three list panes opens a new read-only "SERVICE LISTING ISSUES" dialog — the zone's first dialog with no submit action, closed by `Esc` or `Enter`.

**Given** the issues dialog **When** open **Then** it lists every `unreachable` path and every `errors` entry as its own row: the path, a plain-language reason, the original error message (errors only), and a suggested next step — `unreachable` rows point at the Repo Registry screen's "Clean stale entries" action (Story 2.33); `errors` rows resolve their `code` against a small extensible explanation registry (mirrors `resolveAssistedAction`'s precedent in `failed-result-list.tsx`), falling back to a generic "check the message above" note for an unrecognized code rather than rendering nothing.

**Implementation notes:** `edts-zone.logic.ts` gains `resolveIssuesSeverity(unreachableCount, errorCount)` and an `ISSUE_EXPLANATIONS` registry (+ `explainIssueErrorCode`/`explainUnreachable`), pure and unit-tested directly, same convention as `formatIssuesSummary`. New `dialogs/issues-dialog.tsx` (`IssuesDialogView`) takes `unreachable`/`errors` as props (not dialog state — the dialog carries no payload of its own, just `{ kind: 'issues' }`, since the data already lives in the zone). No new store fields, no new port methods.

### Story 2.35: EDT Creation Core — Per-Service Branch Plans & Remote Branches

> Added 2026-09-24 (Sprint Change Proposal): core groundwork for the `edt-create` wizard (Stories 2.36–2.38). Amends FR-4's "one base / one naming mode for the whole action" into "a global strategy with per-service overrides". CLI (`tui-back edt create`) is deliberately unchanged.

As a developer, I want EDT creation to accept an individual branch plan per member service — create from the global base, create from its own base, or attach an existing (local or remote) branch, optionally renamed — so that one EDT can mix services starting from different points without me fixing branches by hand afterwards.

**Acceptance Criteria:**

**Given** `CreateEdtParams` **When** extended **Then** it accepts an optional `memberPlans: Record<repoPath, MemberBranchPlan>` where `MemberBranchPlan = { kind: 'create'; base: string; name: string } | { kind: 'existing'; branch: string; renameTo?: string }`; when `memberPlans` is present it is authoritative for every member (a member missing from it is rejected before any write, `invalid-argument`); when absent, `branchOptions` behaves exactly as today (CLI path untouched).

**Given** a `create` plan **When** executed **Then** `git.createBranch(member, name, base)` runs, where `base` may be a local branch or a remote-tracking ref (`origin/<x>`); the branch is never checked out (Story 2.2 invariant); outcome `created`.

**Given** an `existing` plan on a **local** branch without `renameTo` **When** executed **Then** the branch must pass `git.assertAllowedBranch` (FR-7) and is recorded as the member's branch; outcome `existing-branch`.

**Given** an `existing` plan with `renameTo` **When** executed **Then** `git.renameBranch(member, branch, renameTo)` runs and the member's branch is recorded as `renameTo`; outcome `renamed` (the closed outcome set widens to `created | existing-branch | renamed | failed`).

**Given** an `existing` plan whose `branch` is a **remote-only** ref (`origin/<x>`) **When** executed **Then** a local branch tracking it is created via the new `git.createTrackingBranch(member, localName, remoteRef)` — `localName` is `renameTo` when set, else `<x>` — gated like `createBranch`; outcome `created`.

**Given** `renameBranch` **When** called **Then** it rejects (before any git write) when *either* the old or the new name is a shared/protected branch — renaming `development` away is refused exactly like renaming onto it (closes the old-name gap).

**Given** the new `GitPort.listRemoteBranches(repoPath)` **When** called **Then** it returns the repo's remote-tracking refs (`origin/<x>`, excluding `origin/HEAD`) read from the local clone only — never fetching; `listBranches` stays local-only, unchanged for every existing caller.

**Given** the EDT-registry write fails after some plans succeeded **When** rolling back **Then** created and tracking branches are force-deleted (existing behavior) **and** renamed branches are renamed back to their original name; a rollback failure is logged per branch, never thrown.

**Given** per-member failure isolation (Story 2.2/2.3) **When** any plan fails **Then** that member gets a `failed` row, is not registered, and the others proceed — unchanged.

**Implementation notes:** `resolveMemberBranch` in `core/edt/create.ts` gains a `plan` branch alongside today's `options.create` branches; keep the two paths side by side rather than converting `branchOptions` into plans, so the CLI's behavior is provably unchanged (its existing tests stay untouched). Adapter: `listRemoteBranches` = `git for-each-ref --format=%(refname:short) refs/remotes`, filter `*/HEAD`; `createTrackingBranch` = `git branch --track <local> <remoteRef>`. The TUI-side "does this base exist in this service" check (Story 2.37) is a pure function over `listBranches ∪ listRemoteBranches`, not a new port method.

### Story 2.36: EDT Creation Wizard — Shell, Step Navigation, Name & Services Steps

> Added 2026-09-24 (Sprint Change Proposal): replaces the flat create-EDT dialog (Stories 2.9/2.22/2.27) with a 4-step wizard. This story builds the shell and Steps 1–2; Steps 3–4 land in Stories 2.37/2.38.

As a developer, I want EDT creation to walk me through explicit, labelled steps with a breadcrumb showing where I am and what I've decided so far, so that I never lose track of which choices are made and which are still pending.

**Acceptance Criteria:**

**Given** the `edt-create` command or the zero-EDT auto-open **When** triggered **Then** a modal titled "EDT Wizard: Création d'un espace de travail" opens on Step 1 with a breadcrumb `[1. Nom] ── [2. Services] ── [3. Branches] ── [4. Activation]`; the current step is marked (`▶ … ◀` + accent color), completed steps show their summary (`1. Nom: auth-flow`, `2. Services (3)`), unreachable steps are dim.

**Given** any step **When** rendered **Then** it opens with a short intro explaining what the step does and what is decided in it.

**Given** navigation keys **When** pressed **Then**: `Ctrl+→` / `Ctrl+N` go to the next step only if the current step is valid (else its inline error shows); `Ctrl+←` goes back one step (always allowed, state preserved); `Tab` moves between fields/zones *within* the current step; `Enter` advances on Steps 1–2 (Step 3 uses Enter for editing — Story 2.37; Step 4 uses it for final confirmation — Story 2.38); `Esc` closes the innermost open sub-field/box first, otherwise cancels the whole creation with nothing written — except with zero existing EDTs, where it requests quit (current behavior kept).

**Given** Step 1 **When** shown **Then** a single autofocused `TextInputLine` holds the EDT name; availability is checked live on every keystroke (trimmed, case-sensitive, against the loaded EDT list) and shown with glyph + color — `✔ disponible` (`success`) / `✖ déjà pris` (`error`); an empty or taken name blocks advancing.

**Given** Step 2 **When** shown **Then** every registered managed repo is listed as a `checkbox-list-item` (`Space` toggles, `↑/↓/Home/End` move), with the existing loading/error/empty states; zero checked services blocks advancing with an inline message.

**Given** Steps 3–4 before Stories 2.37/2.38 land **When** reached **Then** Step 3 hosts today's branch-setup fields unchanged and Step 4 is a plain confirm with today's behavior, so the epic branch stays shippable between stories.

**Given** the keybinding contract (Story 1.13, `EXPERIENCE.md`) **When** this story lands **Then** it documents `Ctrl+←/→` and `Ctrl+N` as wizard-scoped additions; if the terminal does not deliver `ctrl` on arrow keys (verify in Ink), `Ctrl+N` and `Ctrl+←`'s fallback (documented) keep every step reachable.

**Implementation notes:** new `dialogs/create-wizard/` folder (one file per step + a pure `wizard.logic.ts`: `canAdvance(step, state)`, `reachableSteps(state)`, `stepSummary(step, state)`), unit-tested directly like `edts-zone.logic.ts`. `CreateDialogState`/`CreateFormFocus`/`advanceCreateFormFocus` are retired at the end of Story 2.37 once Step 3 no longer needs them.

### Story 2.37: EDT Creation Wizard — Step 3: Global Branch Strategy & Per-Service Overrides

> Added 2026-09-24 (Sprint Change Proposal): Step 3 of the wizard. Requires the epic-3 → epic-2 merge (`BranchAutocompleteInput`) and Story 2.35's `memberPlans`/remote-branch support.

As a developer, I want to set one branch rule for all selected services and then adjust individual services in a table, so that the common case takes seconds and the exceptions stay visible instead of being buried in a per-service form.

**Acceptance Criteria:**

**Prerequisite (blocking) — Given** the story starts **When** the developer begins **Then** first run `git merge-base --is-ancestor epic-3-group-update-migrations epic-2-edt-workspace-management` (exit 0 = merge done) and confirm `src/adapters/driving/tui/shared/components/branch-autocomplete-input.tsx` exists on the epic branch; if either check fails, **HALT** — the epic-3 → epic-2 merge must be done first (4 expected conflicts: `deferred-work.md`, `sprint-status.yaml`, `sprint-change-proposal-2026-09-22.md`, `edts-zone.test.tsx`), and `BranchAutocompleteInput` must never be reimplemented or copied into this story.

**Prerequisite (blocking) — Given** the story starts **When** the developer begins **Then** confirm `2-35-edt-creation-core-per-service-branch-plans-remote-branches` is `done` in `sprint-status.yaml` and merged into the epic branch (`memberPlans` on `CreateEdtParams`, `GitPort.listRemoteBranches` present); otherwise **HALT** — never stub or re-implement Story 2.35's core in this story.

**Given** Step 3 **When** shown **Then** it has two vertically stacked panels — **A "STRATÉGIE GLOBALE"** (focused by default) and **B "RÉSUMÉ ET EXCEPTIONS PAR SERVICE"** — and `Tab` switches between them; a footer shows `[Tab] Changer de zone • [Entrée] Configurer la ligne • [Ctrl+N] Étape suivante`.

**Given** Panel A **When** navigated **Then** `↑/↓` move between its two lines ("Branche source par défaut", "Nom global de la branche"); `Enter` enters edit mode on the focused line, `Esc` leaves it, and for the base line any printable key also enters edit mode with that character typed.

**Given** "Branche source par défaut" **When** empty **Then** it shows a dim, non-editable `<shared-branch>` placeholder meaning "each service uses its own manifest `sharedBranch`"; the first keystroke clears the placeholder and the field becomes a `TextInputLine` (`h|`); clearing it back to empty restores the placeholder.

**Given** a non-empty global base **When** typed **Then** every row in mode "Créer (Global)" re-resolves it live against *that service's* local and remote branches (exact match, local preferred over `origin/<x>`); a service with no match shows a red `✖ branche introuvable` message in its row (glyph + color); Step 3 cannot be left while any "Créer (Global)" row carries it.

**Given** "Nom global de la branche" **When** Step 3 is first entered **Then** it is pre-filled with the slug of the Step 1 name (`suggestBranchNameFromTopic`, no prefix) and keeps tracking the name until edited (touched-flag convention, Story 2.22); every edit live-updates every "Créer (Global)" row's target.

**Given** Panel B **When** rendered **Then** it is a table `Service | Mode | Base / Source | Branche cible` with one row per selected service; modes are `[Créer (Global)]`, `[Créer (Perso)]`, `[Existante]`, `[Renommer]`; for `[Renommer]` the target column reads `-> <new name>`; the list is height-bounded (NFR-7); `↑/↓` move the row cursor and `Enter` opens the override box for that service.

**Given** the override box ("Configurer <service>") **When** open **Then** it shows `Mode : (•) Créer nouvelle ( ) Choisir existante` (toggled with `Space` or `Tab` while the Mode line is focused), then mode-specific lines and an `[ Appliquer ]` action. `↑/↓` move between lines; `Enter` enters the focused field; inside a field, `Enter` commits and focuses the next line; `Esc` leaves the field; `Esc` with no field active closes the box without applying; `Enter` on `[ Appliquer ]` (or on the last field's committed value, second `Enter`) applies and closes.

**Given** mode "Créer nouvelle" in the box **When** edited **Then** "Branche de base (source)" is a `BranchAutocompleteInput` over that service's local + remote branches (pre-filled with the current row's base), and "Nom de la branche" is a `TextInputLine` pre-filled with the global name; a protected/shared target name is rejected inline (FR-7); applying sets the row to `[Créer (Perso)]` — it no longer follows Panel A changes.

**Given** mode "Choisir existante" in the box **When** edited **Then** "Branche existante" is a `BranchAutocompleteInput` over local + remote branches; a `[ ] Renommer la branche locale` checkbox (`Space`) reveals "Nouveau nom"; choosing a protected branch without a rename, or a protected new name, is rejected inline (FR-7); applying sets the row to `[Existante]` or `[Renommer]`.

**Given** a row in `[Créer (Perso)]`, `[Existante]` or `[Renommer]` **When** the developer wants the global rule back **Then** a documented key in the box (proposed: `Ctrl+R` "Revenir à la stratégie globale") resets it to `[Créer (Global)]`.

**Given** `Ctrl+N` / `Ctrl+→` **When** Step 3 is valid (no red row, every name non-empty, every base resolved) **Then** the wizard moves to Step 4 and Step 3's rows are turned into Story 2.35's `memberPlans`.

**Implementation notes:** per-service branch lists (`listBranches` + `listRemoteBranches`) are loaded once when Step 3 is first entered (and on retry), exposed through the store like `listMemberBranches` today. Pure helpers in `wizard.logic.ts`: `resolveGlobalBase(input, branchesByService)`, `buildRowView(plan, global)`, `buildMemberPlans(rows)`. Retires `CreateDialogState`'s branch-step fields, `advanceCreateFormFocus`, `prefillBaseBranches`, `resolveBaseBranchMode` if no other caller remains (Story 2.31 is re-pointed to the wizard below).

### Story 2.38: EDT Creation Wizard — Step 4: Activation & Switch Choice

> Added 2026-09-24 (Sprint Change Proposal): Step 4 of the wizard. Fixes two defects: TUI creates silently became the active EDT without a protected switch (`edt-slice.ts:280-291`), and the create action-log entry went to the previously focused EDT (`create-dialog.tsx:491-510`). Relies on the switch resolution dialog of Story 2.41 (which supersedes the confirm seam of branch `fix-edt-switch-dirty-service-confirmation`); Stories 2.39 and 2.41 must be merged into epic-2 first (amended 2026-09-24, Sprint Change Proposal 2026-09-24 (2)).

As a developer, I want the last step of EDT creation to make explicit whether the new EDT becomes active now — and, for my very first EDT, to put every repo on the right branch while showing me exactly which uncommitted files are in the way — so that creation never silently changes my working state.

**Acceptance Criteria:**

**Given** zero EDTs existed before this creation **When** Step 4 renders **Then** the activation option is visually locked on "Oui" with the label "Définir cet EDT comme espace actif immédiatement", plus an explanation that no outgoing EDT exists to preserve.

**Given** that first-EDT case **When** the developer confirms (`Enter`) **Then** `createEdt` runs, then a new core use-case `activateEdt` (`core/edt/activate.ts`) pre-flights every managed repo: members target their EDT branch, non-members target their manifest `sharedBranch` (fetched first if absent locally, FR-8); a repo whose uncommitted changes would be overwritten by that checkout is reported with the exact file list (uncommitted paths ∩ paths differing between current and target branch) and **no checkout runs anywhere yet**.

**Given** that pre-flight reported blocked repos **When** shown **Then** the wizard pauses on a panel listing each blocked service and its files, with: `[R] Réessayer` (re-runs the pre-flight after the developer fixed things by hand — repeatable indefinitely), `[E] Écraser` (a second explicit confirmation listing every file that will be discarded, then discards exactly those paths and proceeds), `[Esc]` (stop: the EDT stays created but **not** active, and the wizard says so).

**Given** a clean pre-flight (or after Retry/Overwrite) **When** activation proceeds **Then** every repo is checked out on its target branch, `state.json`'s active pointer is set to the new EDT, per-repo failures are shown via `FailedResultList`, and one failure never blocks the others.

**Given** one or more EDTs already existed **When** Step 4 renders **Then** a radio toggle (`Space`/`↑↓`) offers `(•) Basculer immédiatement sur ce nouvel EDT` (default) and `( ) Créer sans basculer (rester sur l'EDT courant)`; under the switch option an info block states that uncommitted work in the outgoing EDT's services is auto-preserved (stash) and that uncommitted work in any other service is listed so you choose to adopt it into the outgoing EDT or discard it, that non-member services return to **their own shared branch (listed by name per service)**, and that member services move to their configured branches.

**Given** "Basculer immédiatement" **When** confirmed **Then** `createEdt` runs, then the existing protected switch (`switchActiveEdt`, including the Story 2.41 dirty-service resolution dialog) runs to the new EDT — never a direct `writeActiveEdt`.

**Given** "Créer sans basculer" **When** confirmed **Then** only `createEdt` runs; the active EDT is unchanged.

**Given** the store's `createEdt` action **When** this story lands **Then** its unconditional `writeActiveEdt` is removed — activation only ever happens through Step 4's explicit paths above.

**Given** any creation outcome **When** logged **Then** the action-log entry is written to the **new** EDT's database (success, partial failure, or activation stopped), never to the previously focused EDT.

**Implementation notes:** `activateEdt` reuses `switch.ts`'s per-repo target computation (member → registered branch, non-member → `sharedBranch` + fetch-if-missing) but has no outgoing EDT, so no stash tagging; it takes an explicit `overwrite: string[]` per repo (paths the developer confirmed) and calls the existing `git.discardPaths` for exactly those. The overwrite path is the consent-gated exception recorded in the PRD amendment below. The pre-flight "would be overwritten" set needs one new read-only `GitPort` helper (`diffNameOnly(repoPath, from, to)`), gated nowhere (read-only).

### Story 2.39: EDT Switch Core — Three-State Partition & Dirty-Service Resolutions

> Added 2026-09-24 (Sprint Change Proposal): fixes `switch.ts` D1/D2 and replaces the informational dirty-repo seam with an authoritative per-service resolution. CLI wiring lands in 2.40, TUI dialog in 2.41.

As a developer, I want a switch to know exactly whose uncommitted work each repo holds, so that the outgoing EDT's work is preserved for its return, and work that belongs to no outgoing member is never silently moved — I decide what happens to it.

**Acceptance Criteria:**

**Given** a switch **When** repos are classified **Then** membership is evaluated against the **outgoing** EDT: *state 1* = member of the outgoing EDT; *state 2* = member of another EDT (including the target) but not the outgoing one; *state 3* = member of no EDT. The target's membership still decides the destination branch (its own registered branch if a target member, else the repo's manifest `sharedBranch`, fetched first if absent locally — FR-8).

**Given** a **state-1** repo that is dirty **When** switched **Then** it is stashed with `tui-back:<outgoing ulid>` **before** checkout, no resolution is needed, and it is popped only by a later switch **into** the outgoing EDT (that switch's `switchMemberRepo` pops the target-ulid-tagged stash, unchanged). A state-1 repo that is also a target member additionally pops its target-tagged stash after checkout (unchanged).

**Given** a **state-2 or state-3** repo that is dirty **When** switched **Then** it requires an entry in the caller-supplied `dirtyResolutions: Record<repoPath, DirtyResolution>` where `DirtyResolution = { kind: 'adopt'; branch: string } | { kind: 'discard' }`. The fixed `NON_MEMBER_STASH_TAG` and its unconditional post-checkout pop are **removed**; D1 and D2 no longer exist (a target-only dirty member is state 2 and goes through resolution, never through an outgoing-tagged stash).

**Given** the pre-flight **When** the switch starts **Then**, before any git write, dirtiness of every registered repo is re-read (`hasUncommittedChanges`); if any dirty state-2/3 repo has no resolution, the switch returns `switch-dirty-services-unresolved` whose `details` lists `{service, repoPath, scope: 'member-of-other-edt' | 'non-member', currentBranch}` per repo, with **zero repos touched** and `state.json`/`edts.yaml` untouched.

**Given** the `onDirtyReposBeforeSwitch` seam **When** at least one state-2/3 repo is dirty **Then** it is invoked once with every dirty repo (state-1 rows flagged `resolution: 'auto-stash'` as read-only information; state-2/3 rows carrying their scope, current branch, whether that branch is shared, and the owning EDT topic(s) when state 2) and returns `{ kind: 'cancel' }` (→ `switch-cancelled-by-user`, zero writes) or `{ kind: 'proceed', resolutions }`. When only state-1 repos are dirty the seam is **not** invoked. Explicit `dirtyResolutions` in params take precedence and skip the seam (CLI path).

**Given** an `adopt` resolution **When** executed **Then**, in order: (1) `git.assertAllowedBranch(repo, branch, outgoing.ulid)` — a shared/protected name or a branch claimed by another EDT for this repo is rejected before any write (FR-7, AD-8); (2) `stashSave` with `tui-back:<outgoing ulid>`; (3) if `branch` differs from the repo's current branch, `createBranch(repo, branch, <current HEAD branch>)` — never checked out; if it equals the current branch it must itself pass step 1 (i.e. not shared); (4) the repo is added to the outgoing EDT with `branch` as its registered branch (existing `modifyEdt` add-member path, under the edts.yaml lock); (5) checkout to the destination branch. A failure at any step after the stash restores the stash and reports `failed` — never an orphaned stash. Outcome `adopted`.

**Given** a `discard` resolution **When** executed **Then** the repo must still be dirty at that instant, its dirty paths are captured via `git.listDirtyPaths` (untracked expanded to files), `git.discardAll(repo)` runs, then checkout to the destination branch. Outcome `discarded`, with `detail.discardedPaths` carrying the captured list. Ignored files are never touched.

**Given** no outgoing EDT (first switch) **When** a state-2/3 repo is dirty **Then** an `adopt` resolution is rejected (`switch-adopt-without-outgoing`); only `discard` or cancel apply.

**Given** the new `GitPort.discardAll(repoPath)` **When** implemented **Then** it runs `git reset --hard` then `git clean -fd` (never `-x`, never `-ff`), returns `git-discard-error` on failure, and its port doc comment records that it is the one consent-gated destructive primitive whose only permitted caller is `switch.ts` under an explicit `discard` resolution.

**Given** a discard/adopt failure on one repo **When** reported **Then** it is a `failed` row for that repo; the others proceed (per-repo isolation unchanged). Idempotency, lock-peek/`--force`, AD-8 member re-verification and the final `state.json`/`edts.yaml` writes are unchanged.

**Given** the TUI slice **When** this story lands **Then** its seam implementation compiles against the new signature and, for a dirty state-2/3 repo, returns `cancel` with an explanatory message (interim, safe; replaced by 2.41).

**Implementation notes:** classification is a pure helper `classifySwitchRepos(registered, outgoing, target, allEdts)` unit-tested directly; `switchMemberRepo`/`switchNonMemberRepo` keep their names but take the resolved state + resolution. Unit tests use fake ports (AD-13); `discardAll` gets a real-git integration test (tracked-modified, untracked file, untracked dir, ignored file survives). Existing `switch.test.ts` cases that assert the `tui-back:shared` round-trip are rewritten, not patched.

### Story 2.40: `edt switch` CLI — Fail-Safe Dirty Handling & Explicit Flags

> Added 2026-09-24 (Sprint Change Proposal): CLI side of the 2.39 model. No dialog exists on this path.

As a developer scripting or hand-running `tui-back edt switch`, I want a dirty service that belongs to no outgoing member to stop the switch unless I said what to do with it, so that no script ever silently moves or destroys work.

**Acceptance Criteria:**

**Given** `tui-back edt switch --to <topic>` **When** a state-2/3 repo is dirty and no dirty flag is passed **Then** the command fails with `switch-dirty-services-unresolved` (exit 1, AD-3 envelope; `details` lists each service, scope and current branch) and touches nothing.

**Given** `--discard-dirty` **When** passed **Then** every dirty state-2/3 repo is resolved as `discard` (2.39), and the JSON result lists each discarded path under that service's `detail.discardedPaths` (audit trail); the flag is the explicit consent — no interactive prompt on this path.

**Given** `--adopt-dirty --adopt-branch <name>` **When** passed **Then** every dirty state-2/3 repo currently on a **shared** branch is adopted onto a new branch `<name>`, and every one on a **non-shared** branch is adopted keeping its current branch; a name rejected by the AD-8 gate or already existing in that repo fails that repo's row (`failed`), others proceed. `--adopt-dirty` without `--adopt-branch` while any such repo sits on a shared branch fails up front with `missing-argument` (zero writes).

**Given** `--adopt-dirty` and `--discard-dirty` **When** both passed **Then** `invalid-argument`, zero writes. With no outgoing EDT, `--adopt-dirty` fails with `switch-adopt-without-outgoing`.

**Given** the help text and `docs` for `edt switch` **When** updated **Then** both flags and the fail-safe default are documented, including that the previous silent stash-and-restore for these repos no longer happens.

**Given** `tui-back.e2e.test.ts` **When** run **Then** its `edt switch` expectations are updated (dirty non-member → `switch-dirty-services-unresolved`; both flags exercised black-box in the non-TTY JSON branch).

**Implementation notes:** `subcommands.ts:436` stops passing `onDirtyReposBeforeSwitch: undefined` and instead builds `dirtyResolutions` lazily: the flags produce a *policy* (`adopt(name)` | `discard`) that is turned into per-repo resolutions **after** the core's pre-flight classification (the CLI does not classify repos itself). Simplest shape: core accepts `dirtyPolicy?: { kind: 'adopt'; branch: string } | { kind: 'discard' }` as sugar that expands to resolutions per dirty state-2/3 repo (adopt: current branch kept when non-shared).

### Story 2.41: EDT Switch Resolution Dialog — Global Strategy, Per-Service Overrides & Discard Confirmation

> Added 2026-09-24 (Sprint Change Proposal): TUI side of the 2.39 model; mirrors the edt-create Step 3 pattern (Stories 2.35-2.37). Replaces the informative-only confirm added by `43d4087`.

As a developer switching EDT with uncommitted work in services that don't belong to the EDT I'm leaving, I want to see exactly which services are affected and decide once for all of them — or service by service — whether to keep that work with my current EDT or throw it away, so that nothing is lost by accident and nothing pollutes the shared branches.

**Acceptance Criteria:**

**Prerequisite (blocking) — Given** the story starts **When** the developer begins **Then** confirm Story 2.39 is `done` in `sprint-status.yaml` and merged into the epic branch (`dirtyResolutions`, `discardAll`, resolver-shaped seam present), and that Story 2.37's reusable table/override-box components exist on the epic branch (`branch-plan-table`); otherwise **HALT** — never re-implement either here.

**Given** a switch with ≥1 dirty state-2/3 repo **When** the seam fires **Then** the SWITCH EDT dialog shows a two-panel resolution view — **A "STRATÉGIE GLOBALE"** (focused by default) and **B "SERVICES CONCERNÉS"** — with a footer `[Tab] Changer de zone • [Entrée] Configurer la ligne • [Ctrl+N] Confirmer • [Esc] Annuler le switch`; an intro states which EDT is being left and that state-1 services are handled automatically.

**Given** Panel A **When** navigated **Then** it has a line "Action par défaut" toggling `(•) Adopter dans <outgoing topic>  ( ) Écraser` (`Space`/`←→`) and, when *Adopter*, a line "Nom global de la branche" (a `TextInputLine`, pre-filled with the slug of the outgoing EDT's topic via `suggestBranchNameFromTopic`, touched-flag convention of Story 2.22) applied to every row on a **shared** branch. With no outgoing EDT only *Écraser* is offered, with an explanation.

**Given** Panel B **When** rendered **Then** it is a height-bounded table (NFR-7) `Service | Portée | Branche actuelle | Action | Branche cible`, one row per dirty state-2/3 service (`Portée` = "membre de <topic>" or "hors EDT"); state-1 dirty services appear below as read-only dim rows "sera mis de côté pour <outgoing> (restauré au retour)"; modes per row: `[Adopter (Global)]`, `[Adopter (Perso)]`, `[Écraser]`; `↑/↓` move, `Enter` opens the override box.

**Given** the override box "Configurer <service>" **When** open **Then** it offers `Action : (•) Adopter ( ) Écraser`; for *Adopter*, "Branche" is a `TextInputLine` — **always editable and pre-filled** (global name when the repo is on a shared branch, its current branch name otherwise) — validated live inline: a shared/protected name is rejected (FR-7), a name that already exists locally in that repo is rejected, an empty name is rejected; `Enter` on `[ Appliquer ]` sets the row to `[Adopter (Perso)]` or `[Écraser]`; `Ctrl+R` returns the row to the global strategy.

**Given** `Ctrl+N` **When** every row is valid **Then**: if no row is `[Écraser]` the switch proceeds with the resolutions; if any row is `[Écraser]` a **second confirmation** first lists, per service, every file that will be destroyed (tracked modifications and untracked files, from `listDirtyPaths`), states that the action is irreversible and that ignored files are kept, and requires an explicit confirmation key (default action is *Retour*); `Esc` there returns to the table. Invalid rows block `Ctrl+N` with the inline error.

**Given** `Esc` on the main view **When** pressed **Then** the switch is cancelled (`switch-cancelled-by-user`), nothing touched, and a message says so.

**Given** the switch completes **When** results return **Then** `adopted` / `discarded` / `switched` / `failed` rows are shown via the existing structured result display (`FailedResultList` for failures), and the action-log entry (written to the **new active** EDT's database) records adopted branches and discarded paths.

**Given** the `edt-*` auto-switch-tab command path (Story 670bfcb) and the quick-pick (Story 2.30) **When** they trigger a switch **Then** they go through the same seam, unchanged.

**Implementation notes:** `edt-slice.ts` already parks the core call on a pending promise (`switchDirtyRepos` + `resolveSwitchDirtyRepos`); widen the resolver payload to the `{kind, resolutions}` shape and hold the dialog's draft state in the slice or dialog, not in core. Pure helpers in a new `switch-resolution.logic.ts`: `buildRows(dirty, global)`, `validateRow(row, branchesByService)`, `buildResolutions(rows)`. Per-service branch lists come from `listMemberBranches`.

### Story 2.42: Manifest-Defined Protected Branches per Service

> Added 2026-09-28 (Sprint Change Proposal): replaces FR-7's hardcoded `development`/preprod/prod set with a per-service manifest list. Sequenced after Story 2.37, which moved the rule into `src/core/edt/shared-branches.ts`.

As a developer onboarding services that follow different branching models, I want each service's `.tui-back.yaml` to declare which branches are protected, so that the tool guards exactly that service's release branches instead of a fixed list that fits no one exactly.

**Acceptance Criteria:**

**Prerequisite (blocking) — Given** the story starts **When** the developer begins **Then** confirm Story 2.37 is `done` and merged into the epic branch (`src/core/edt/shared-branches.ts` present); otherwise **HALT**.

**Given** a manifest **When** loaded **Then** it accepts an optional `protectedBranches: string[]` (each entry trimmed, non-empty; duplicates tolerated). A malformed value (not a list, an empty string) is a manifest validation error, reported like any other schema error (Story 1.4). The `Manifest` type gains `protectedBranches?: string[]`.

**Given** a service **When** its protected set is computed **Then** it is exactly `protectedBranches ∪ {sharedBranch}`. `development`/`preprod`/`prod` are no longer protected implicitly. Without `protectedBranches`, only `sharedBranch` is protected (and `sharedBranch` itself still defaults to `development`).

**Given** any git write, rename or registration **When** the gate runs (`assertAllowedBranch`, `createBranch`, `renameBranch` old and new names, `createTrackingBranch`) **Then** it uses that service's manifest-defined set, resolved from the manifest at write time (AD-8), through the single core helper `isProtectedBranch(name, manifest)` that replaces `SHARED_BRANCHES`/`isSharedBranch`. No hardcoded branch list remains in `src/`.

**Given** the create wizard (Step 3 rows and the "Configurer" box) and every other inline FR-7 check **When** they judge a name **Then** they use the same helper with that service's own manifest data. `ServiceBranchDivergence` (`core/edt/list.ts`) carries `protectedBranches` next to `sharedBranch`.

**Given** a rejection **When** shown **Then** the message names the branch and says it is protected by that service's manifest (e.g. `Branch "preprod" is protected by svc-a's manifest`).

**Given** the `manifest-generator` skill **When** it writes a manifest **Then** it emits `protectedBranches: [development, preprod, prod]` by default (documented in its field table) so new manifests keep today's protection.

**Rollout note (not code):** existing managed repos keep working, but without the new line only their `sharedBranch` stays protected. Add `protectedBranches: [development, preprod, prod]` to each existing `.tui-back.yaml` to keep today's behavior.

**Implementation notes:**
- Schema change in `adapters/driven/manifest/schema.ts`.
- The gate in `adapters/driven/git/index.ts` reads `loaded.data`.
- Hardcoded `['development', 'preprod', 'prod']` fixtures in the git adapter and `create.test.ts` become manifest fixtures.

### Story 2.43: Cross-EDT Branch Usage — Alerts in Branch Choosers & Rename Gate

> Added 2026-09-28 (Sprint Change Proposal): makes another EDT's ownership of a branch visible before it is chosen, and closes the ungated rename of such a branch. Sequenced after Story 2.37 (Step 3 table and box). Independent of 2.42.

As a developer choosing or renaming a branch, I want to see which branches another EDT already relies on, and be stopped before I take or rename one, so that working in one EDT can never silently break another.

**Acceptance Criteria:**

**Prerequisite (blocking) — Given** the story starts **When** the developer begins **Then** confirm Story 2.37 is `done` and merged into the epic branch; otherwise **HALT**.

**Given** a rename of branch `old` → `new` in repo R **When** the git adapter's `renameBranch` runs **Then**, besides the FR-7 checks, it rejects with `branch-owned-by-other-edt` when `old` or `new` is registered as the own branch of an EDT other than the caller's. `GitPort.renameBranch` gains an optional `edtId`; with no `edtId`, any registered owner blocks. Callers pass their EDT:
- `modify.ts` rename → the target's ulid;
- `renameMemberBranch` (Add-to-EDT) → the target EDT's ulid;
- `create.ts` existing + rename → the new EDT's ulid;
- `create.ts` rollback → the new EDT's ulid.

This happens before any `git` invocation (AD-8).

**Given** a pure helper `branchOwners(edts, repoPath, branch, excludeUlid)` → the owning EDT topics (paths compared after `resolve()`, like the gate) **When** any branch chooser lists candidates **Then** every candidate owned by another EDT is annotated `⚠ EDT « <topic> »` (glyph + warning color). The candidates owned by the EDT being edited, or none when creating, are excluded. The choosers covered:
- the wizard Step 3 "Configurer" box (existing-branch and base fields);
- the `BranchPicker` pick-existing list (Modify, Add-to-EDT, service actions).

`BranchAutocompleteInput` gains an optional generic `annotations?: Record<branch, string>` prop and stays EDT-agnostic.

**Given** the wizard box, or `BranchPicker`, **When** the developer applies an owned branch as an existing branch, with or without rename, or renames a member's current branch that another EDT also owns **Then** it is refused inline with `utilisée par l'EDT « <topic> » — la reprendre ou la renommer casserait cet EDT`. A Step 3 row carrying such a plan shows the same error and blocks `Ctrl+N`.

**Given** a branch used only as a **base** (create a new branch from it) **When** it is owned by another EDT **Then** it is annotated but allowed, since creating from it never modifies it.

**Given** core **When** reached with an owned branch anyway (CLI, stale UI) **Then** the existing `branch-owned-by-other-edt` failure (Story 2.25 assisted resolution) is unchanged.

**Implementation notes:**
- The owners come from the store's loaded `edts` list: members carry `{repoPath, branch}`. No new port.
- Tests:
  - adapter `renameBranch` owner checks (old and new name, with and without `edtId`);
  - `branchOwners`;
  - the annotation rendering;
  - inline refusals in the wizard box and in `BranchPicker`.

## Epic 3: Group Update & Migrations

A developer can run a group update (pull, migrate, restart) scoped to the active EDT, to all managed repos, or to a single service — configured beforehand (service selection, per-service branch, migrate/clean-restart toggles) and followed live per-service — with assisted resolution of conflicts and migration failures.

### Story 3.1: Group Update — Pull & Restart (EDT-scoped)

As a developer,
I want to run a group update that brings my active EDT's member services up to date with `development` and restarts their containers,
So that I can catch up my session's services in one action instead of doing it by hand per service.

**Acceptance Criteria:**

**Given** the active EDT has at least one member service
**When** a developer triggers a group update
**Then** the tool first opens the configuration interface (Story 3.7): every member service is pre-selected, its source branch pre-filled with the manifest's `sharedBranch`; the developer may deselect services and override any selected service's source branch before confirming

**Given** the developer confirms the run from the configuration interface
**When** the run starts
**Then** for a non-member repo already on `development`, the tool does a plain pull; for a selected member service, the tool merges the configured source branch into the service's own branch (`git merge <source branch>`, never a rebase — chosen for safety-by-default: no rewriting of already-pushed commits, and a merge already applied is a no-op on a second run, satisfying FR-1's idempotency) and restarts the container (plain restart, or the manifest's clean-restart recipe if the restart toggle from Story 3.7 was on), without touching migrations yet unless the migrate toggle was on (Story 3.2)

**Given** a service was deselected in the configuration interface
**When** the run executes
**Then** that service is never targeted — it does not appear in the run's summary as skipped, because it was never part of the run

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

**Given** the migrate toggle was on in the configuration interface (Story 3.7) and a targeted service's manifest declares a `migrationCommand`
**When** the group update reaches that service
**Then** the migration command runs after the pull step and before the restart step (per manifest, FR-10/FR-25)

**Given** the migrate toggle was off in the configuration interface
**When** the group update reaches a targeted service
**Then** its migration step is skipped regardless of whether a `migrationCommand` is declared — the toggle overrides per-service declaration, it does not merely default it

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
**When** it opens
**Then** the same configuration interface as Story 3.7 opens first, pre-selecting every managed repo — followed by the mode's own explicit blast-radius confirmation step before anything runs; the confirmation never replaces or skips the configuration step

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

**Compatibility note (added 2026-09-22 correct-course):** the guided menu keeps blocking input exactly as today; it now renders in front of that service's live detail pane (Story 3.10) instead of a blank backdrop — no change to the detect → auto-fix-known-safe-or-guided-menu → re-verify mechanic itself.

### Story 3.5: Per-Service Migration Failure Handling & Re-Trigger — Superseded

Superseded by the 2026-09-22 correct-course (see `sprint-change-proposal-2026-09-22-2.md`): its "surface which service/migration/error" guarantee is now Story 3.10's live per-service issue log, and its "re-trigger just that service's migration" guarantee is now Story 3.9's single-service update action (migrate toggle on). No requirement from the original story is dropped — it is split across the two new stories instead of implemented standalone.

### Story 3.6: Update Zone Shell — Service List & Live Status

As a developer,
I want the Update zone to show, like the EDT and Logs zones, a left-hand list of services (active EDT members and non-members) each carrying a live status,
So that I always know each service's state without guessing or switching zones.

**Acceptance Criteria:**

**Given** the developer opens the Update zone
**When** it renders
**Then** the left pane lists every service — active EDT members first, other managed services after — the same list/detail split pattern as the EDT and Logs zones

**Given** any service in that list
**When** it is rendered, at any time, run or no run in progress
**Then** it carries a status glyph from the closed set: up / down / restarting / updating / migrating / error — never blank, never an ambiguous generic state

**Given** a service is selected in the list
**When** the detail pane renders
**Then** it shows that service's last known outcome (or "idle" if none yet), ready to be replaced by live run detail (Story 3.10) once a run targets it

### Story 3.7: Pre-Run Configuration Interface

As a developer,
I want a configuration screen before any group update starts,
So that I control exactly which services are touched, which branch each pulls from, and whether migrations and clean restarts run — instead of a fixed, all-or-nothing update.

**Acceptance Criteria:**

**Given** a group update is triggered (EDT-scoped, all-repos, or single-service)
**When** the trigger fires
**Then** the configuration interface opens before any git/docker action runs, listing every targeted service with a checkbox (pre-selected per the trigger's default scope)

**Given** a selected service in the configuration interface
**When** it is shown
**Then** its source branch field is pre-filled with the manifest's `sharedBranch` and can be changed to any branch the tool can resolve for that repo

**Given** the configuration interface is open
**When** the developer toggles "run migrations" or "clean restart"
**Then** the toggle applies to every currently selected service uniformly — there is no per-service override of these two toggles in v1

**Given** the developer deselects every service
**When** they attempt to confirm
**Then** confirming is rejected with an explicit message — the same no-op guarantee FR-10 already gives a zero-member EDT, extended to a zero-selection run

**Given** the developer confirms with at least one service selected
**When** confirmed
**Then** the run starts immediately with exactly that configuration — no further prompt

### Story 3.8: Manifest-Defined Clean-Restart Recipe

As a developer,
I want to declare, per repo, an ordered list of commands that fully restart it cleanly (e.g. `npm i` then `npm run d:up`),
So that a group update — or a one-off trigger — can restart a service properly instead of just restarting its container.

**Acceptance Criteria:**

**Given** a repo's `.tui-back.yaml`
**When** it declares a clean-restart recipe
**Then** the manifest loader accepts an ordered list of commands for it (`restartCommands`), validated the same way `migrationCommand` is today (non-blocking when absent)

**Given** a service with no clean-restart recipe declared
**When** a clean restart is requested for it (via the toggle in Story 3.7, or the standalone action in Story 3.9)
**Then** the tool falls back to today's plain container restart, without error

**Given** a service with a clean-restart recipe declared
**When** a clean restart runs for it
**Then** each command runs in the repo's working directory, in declared order; a failing command stops the recipe and is reported as that service's failure detail (service, which command, error output) — the same per-service failure reporting FR-12 already guarantees for migrations

### Story 3.9: Per-Service Actions — Clean Restart & Single-Service Update

As a developer,
I want to trigger, directly from a service's row in the Update zone, either a clean restart or a full update for just that service,
So that I can fix or catch up one service without running (or reconfiguring) the whole group update.

**Acceptance Criteria:**

**Given** a service row in the Update zone's list
**When** the developer triggers "clean restart" on it
**Then** Story 3.8's recipe (or the plain container-restart fallback) runs for that service alone, with its status reflecting `restarting` for the duration

**Given** a service row in the Update zone's list
**When** the developer triggers "update this service"
**Then** the same configuration interface as Story 3.7 opens, pre-scoped to that one service — same fields (branch, migrate toggle, restart toggle), same confirmation gate

**Given** a single-service update or clean restart is already running for a service
**When** the developer triggers another action on that same service
**Then** it is rejected the same way a second group update is rejected today (FR-10) — serialized per service, not just globally

### Story 3.10: Live Per-Service Run Tracking — Current Step & Issue Log

As a developer,
I want to see, per service, which step is currently running and any problem encountered, clearly marked as resolved or not,
So that I can follow a group update the same way I follow anything else in this tool — never guessing what's happening or what still needs my attention.

**Acceptance Criteria:**

**Given** a run (any scope) in progress
**When** a targeted service is selected in the Update zone's list
**Then** its detail pane shows the current step (pulling / merging / migrating / restarting) live, replacing the last-outcome view from Story 3.6

**Given** a service hits a problem during a run (dirty state, conflict, migration failure — Stories 3.4/3.5's existing mechanics)
**When** it is shown in that service's detail pane
**Then** it is marked clearly as unresolved until the developer acts, and as resolved once the tool re-verifies success — reusing FR-11/FR-12's existing detect → act → re-verify guarantee, now surfaced per-service instead of only in the end-of-run summary

**Given** a run completes
**When** the developer revisits a service already covered by that run
**Then** its detail pane shows the final per-service outcome, matching Story 3.6's idle-state view

### Story 3.11: Update Commands — Main, All-Repos, Single-Service

As a developer,
I want a distinct command for each way to trigger a group update,
So that I can start the right one without hunting through menus.

**Acceptance Criteria:**

**Given** the Update zone
**When** the developer looks for how to start a run
**Then** three distinct commands exist: the main update (EDT-scoped default), the all-repos update (Story 3.3's maintenance mode), and the single-service update (Story 3.9) — each reachable both as a command-bar entry and its own keybinding

**Given** any of the three commands is triggered
**When** it fires
**Then** it opens the same configuration interface (Story 3.7), pre-scoped to that command's targets — no command skips the configuration step

### Story 3.12: Update — Merge Source from Another EDT

> Added 2026-10-01 (Sprint Change Proposal). Extends Story 3.7's configuration interface (FR-25) with FR-28; mirrors the edt-create wizard's Step 3 two-panel pattern (Story 2.37) so the two screens read the same way.

As a developer,
I want to tell an EDT update to merge each service from another EDT's branch in one move,
So that I can bring a colleague's or a sibling EDT's work into mine without retyping every source branch — and still see and fix by hand the services that EDT doesn't cover.

**Acceptance Criteria:**

**Given** an EDT-scoped update's configuration interface **When** it opens **Then** it shows a **global merge-source panel** above the service table with two options: `(•) Shared branches` (default — today's behavior, every row = manifest `sharedBranch`) and `( ) From EDT: <none>`; `Tab` moves focus between the panel and the table (same panel/table navigation as Story 2.37's Step 3).

**Given** "From EDT" is selected **When** the developer activates its field **Then** the EDT quick-pick (Story 2.30's filterable list) opens, listing every EDT **except the one being updated**; picking one applies it.

**Given** a chosen merge EDT **When** rows re-resolve **Then** each service whose repoPath is a member of the chosen EDT gets that member's recorded branch as source, marked `← <edt topic>`; each service not a member of the chosen EDT shows a red `✖ not in <edt topic>` (glyph + color, UX-DR26) and an empty source.

**Given** a resolved branch from the chosen EDT **When** that branch no longer exists locally or on `origin` for that repo **Then** the row shows `✖ branch not found` instead, same blocking treatment.

**Given** an unresolved row **When** the developer presses `Enter` on it **Then** the per-service branch editor opens (the existing `BranchAutocompleteInput` over that repo's branches) **pre-filled with the service's manifest `sharedBranch`**; committing sets the row to a manual override (`[Manual]`), clearing its error.

**Given** any row in `[Manual]` **When** the global strategy changes **Then** the manual row keeps its branch; a documented key (same as Story 2.37's "back to global strategy", `Ctrl+R`) resets it to follow the global strategy.

**Given** at least one **selected** row carries an error **When** the developer tries to start the run (`y`) **Then** start is rejected with a message naming the unresolved services; deselected rows never block.

**Given** the strategy is switched back to "Shared branches" **When** rows re-resolve **Then** every non-manual row returns to its `sharedBranch` and all from-EDT errors clear.

**Given** an all-repos or single-service update **When** its configuration opens **Then** the global merge-source panel is not shown (FR-28 is EDT-scoped); behavior is unchanged from Story 3.7.

**Given** the CLI **When** `tui-back update --from-edt <topic>` runs **Then** it applies the same resolution; if any member service is unresolved it fails with `update-source-unresolved` listing them, with no git write; an unknown topic or the active EDT's own topic fails with `invalid-argument`. `UPDATE_USAGE` documents the flag.

**Implementation notes:** pure resolution helper in core (e.g. `resolveMergeSourcesFromEdt(targetMembers, sourceEdt, branchesByRepo) → rows with {source, origin: 'shared'|'edt'|'manual', error?}`) so the TUI and the CLI share it (FR-1). Draft gains `strategy: {kind:'shared'} | {kind:'edt', ulid, topic}` and per-row `origin`. Reuse `BranchPlanTable`-style row rendering where it fits instead of a new table. Branch lists are already loaded per row by Story 3.7.

## Epic 4: `shared-types` Propagation & Smart Update

A developer can propagate a `shared-types` version to the active EDT's consuming services, publish new versions, and let a group update handle `shared-types` automatically — publish, propagate, commit and conflict resolution — so that bumping the dependency is never a manual task.

> Rewritten 2026-10-05 (Sprint Change Proposal `sprint-change-proposal-2026-10-05.md`): replaces the original publish / ancestry-status / propagate stories. Prerequisites: Epic 7 done; Epic 3 merged into `devlopment` for 4.4 and 4.5.

**Prerequisites:** Epic 7 done (7.2 container-less services, 7.3 layout, 7.4 interaction audit); Epic 3 merged into `devlopment` for 4.4/4.5.

### Story 4.1: `shared-types` Modules & Manifest Parameters
As a developer, I want the manifest to declare which repo is the `shared-types` source and which services consume it, so that the tool knows where to publish from and where to rewrite the dependency.
- **Given** a manifest declaring `shared-types-source` or `shared-types-consumer` **When** loaded **Then** the module ids are known to the registry and their parameters validated with defaults (§2.3); unknown parameters are rejected with a clear message.
- **Given** the Story 2.13 tab gating **When** the modules exist **Then** the `shared-types` tab shows/omits/disables as specified there, with the source/consumer carrying services named.
- **Given** a source repo without a container (Story 7.2) **When** registered **Then** it is accepted as an EDT member.
- A `shared-types` port + adapter exist with read-version, write-version-line and verify-published operations, fully unit-tested against a fake filesystem/registry.

### Story 4.2: Propagate a Version to Chosen Services
As a developer, I want to enter a `shared-types` version and apply it to some or all consuming services of my active EDT, so that I never edit each `package.json` by hand.
- **Given** the zone **When** opened **Then** a version field is pre-filled with `0.1.` and fully editable, followed by the consumer checklist (all consumers of the active EDT, `checkbox-list-item`).
- **Given** a version **When** the developer confirms **Then** its existence on the registry is verified first; a non-existent version blocks execution with an explicit message.
- **Given** selected consumers **When** propagation runs **Then** only the dependency line in each `package.json` is rewritten, preserving all other formatting.
- **Given** the options step **When** shown **Then** `npm i`, clean restart (via the manifest recipe, Story 3.8) and commit are independent toggles; clean restart and `npm i` may both be on; commit happens after them.
- **Given** commit is chosen **When** it runs **Then** only `package.json` and `package-lock.json` are staged, the message states the tool performed it (e.g. `chore(deps): bump @ianord/shared-types to 0.1.3674 [tui-back]`), and **nothing is ever pushed**.
- **Given** a consumer on a protected or shared branch **When** targeted **Then** the AD-8 safety gate applies as elsewhere.
- **Given** a consumer whose `package.json` is already dirty **When** targeted **Then** it is skipped with an explicit reason (other dirty files do not block, and are never staged).
- **Given** one service fails **When** it happens **Then** it is independently retriable and does not block the others.
- **Given** a run is in progress **When** `q` is pressed **Then** confirmation is required.

### Story 4.3: Publish a New `shared-types` Version
As a developer, I want to publish `shared-types` from the tool and optionally propagate straight away, so that I don't run the release script by hand or lose track of the failing step.
- Publish is only offered when the active EDT includes the `shared-types-source` repo (Story 2.13 rule).
- Runs the configured publish command with per-step progress (bump → build → publish → push) and a spinner on the running step; a failure names the exact step.
- A re-trigger after a partial failure resumes from the failed step; on completion the new version is read from the source's `package.json` and **verified on the registry** before being marked published.
- On success the tool offers to chain into Story 4.2's flow with the published version pre-filled, or to stop.
- `q` during a run requires confirmation.

### Story 4.4: Smart Group Update — `shared-types` First
As a developer, I want a group update that includes `shared-types` to publish and propagate a new version automatically, so that consumers merge on top of an already-bumped dependency.
- **Given** the Update configuration (Story 3.7) **When** the EDT contains the source repo **Then** a `shared-types` row offers *off / publish if the merge changed something / always publish*.
- **Given** the row is not off **When** the update runs **Then** `shared-types` is merged first, then (per the setting) published (4.3), propagated to all consumers of the EDT and committed (4.2, commit on, push never).
- **Given** a single-service update of `shared-types` alone **When** it runs **Then** the same behaviour applies.
- **Given** a failure in the `shared-types` phase **When** it occurs **Then** the remaining services are not updated silently: the run pauses with an explicit choice (retry, skip `shared-types` handling, abort), and the live run tracking (Story 3.10) shows the phase.

### Story 4.5: Auto-Resolve `shared-types`-Only Merge Conflicts
As a developer, I want conflicts caused only by the `shared-types` version bump to resolve themselves during an update, so that I only handle real conflicts.
- **Given** a consumer's merge conflicts **When** the only conflicting hunk in `package.json` is the `shared-types` dependency line **Then** it is resolved to the EDT's current value, `npm i` is run, `package-lock.json` is staged if changed, and the merge is completed.
- **Given** any other conflicting hunk in `package.json`, or any conflict in another file **When** detected **Then** nothing is auto-resolved and the existing assisted-resolution flow (Story 3.4) takes over untouched.
- **Given** `package-lock.json` conflicts alongside a st-only `package.json` conflict **When** resolving **Then** the lockfile is taken from the EDT side and regenerated by `npm i` rather than hunk-merged.
- The outcome (auto-resolved / left to user) is shown per service in the run tracking.

### Story 4.6: Declared-Version Drift View *(niche, optional)*
As a developer, I want to see which consumers declare a different `shared-types` version from my EDT's `shared-types` branch, so that I spot stale services at a glance.
- Compares each consumer's declared version with the one declared by the source repo's `package.json` on the EDT's branch; no git-ancestry walk, no caching.
- Consumers on the same version are marked in sync; others show both values and offer a one-key jump into Story 4.2 with the source version pre-filled.
- Explicit "no members" state when the EDT has none.

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

### Story 5.4: Filter History Recall

> Added 2026-09-18 (Sprint Change Proposal): new capability for the filter editor (Story 5.2) — recall the last N text/regex filters used, per scope (global / per-service), instead of retyping them. Introduces the first *persisted* data tied to filters — Story 5.2's "ephemeral, never persisted" boundary continues to apply to the live/active filter state; history is a distinct concept (a record of past commits) and is explicitly exempted. Also reworks the Logs tab of `:settings` to a row-cursor navigation model to accommodate the new fields and history-clear actions.

As a developer,
I want the filter editor to remember and let me recall the recent text/regex filters I've used,
So that I don't have to retype filters I've already used, across services and across sessions.

**Acceptance Criteria:**

**Given** a filter editor (global or per-service)
**When** a filter is committed (`Enter`, compiles successfully, non-empty query)
**Then** it's pushed to the front of that exact scope+mode's history (global vs. that specific service; text vs. regex — two independent lists per scope), moved-to-front instead of duplicated if identical to the current top entry, trimmed to the configured maximum size N

**Given** the developer is typing a fresh draft in the editor
**When** `↑` is pressed
**Then** the input is replaced by the most recent entry of that exact scope+mode's history, and the in-progress draft is preserved for later

**Given** the developer is browsing history via `↑`
**When** `↑` is pressed again
**Then** it moves to the next-older entry, up to the oldest (position N); `↑` at the oldest entry is a no-op

**Given** the developer is browsing history via `↑`/`↓`
**When** `↓` is pressed
**Then** it moves toward more recent entries, and one more `↓` from the most-recent entry restores the original draft exactly as it stood before browsing began

**Given** the developer is browsing history (arrow-recall or the grid below)
**When** a printable character or Backspace is pressed
**Then** browsing stops, the original draft is restored, and that keypress is applied on top of it (same one-key resume as if it had never left the draft)

**Given** the developer is on their own draft (not browsing)
**When** `↓` is pressed
**Then** the same column-major, arrow-navigable grid browser used by the command palette (`command-bar.tsx`, UX-DR30) opens, listing every entry of that scope+mode's history, its rows-per-column governed by its own setting (below) — not `commandPalette.gridMaxRows`; `Enter` recalls the highlighted entry into the input, `Esc` closes the bar entirely

**Given** the `:settings` Logs tab
**When** the developer adjusts "filter history size" (`settings.logs.filterHistorySize`, mirrors `logs.bufferSize`'s clamp/adjust idiom)
**Then** a history already at that size drops its oldest entry on the next new one

**Given** the `:settings` Logs tab
**When** the developer adjusts "filter history grid rows" (`settings.logs.filterHistoryGridMaxRows`, mirrors `commandPalette.gridMaxRows` exactly but as its own independent value)
**Then** the history grid browser's rows-per-column follows it

**Given** the `:settings` Logs tab
**When** the developer wants to clear history
**Then** they can clear the global filter history, or a specific service's filter history, independently — never clearing more than what's targeted

**Given** the Logs tab now has 4+ fields plus history-clear actions
**When** the tab is navigated
**Then** it gains a row cursor (`Up`/`Down` moves between fields, mirrors the EDTs tab's group-list idiom) — `bufferSize`/`startWithHistory`'s existing no-row-cursor scheme is reworked so every field stays reachable unambiguously

**Given** the app is restarted
**When** the filter editor is reopened
**Then** previously recorded history is still available — persisted to disk (unlike the live filter state itself, which stays ephemeral per Story 5.2's boundary)

### Story 5.5: Bound List & Filter-Editor Height to the Terminal Window

> Added 2026-09-20 (Sprint Change Proposal): fixes a rendering-correctness defect surfaced while reviewing Story 5.4 — the Logs zone's service lists, always-visible keybinding hints panel, and LogFilterEditor (including its Story 5.4 history-grid browser) render with no height cap. When their combined content exceeds the terminal's actual row count, Ink's diff-render desyncs from the real terminal cursor and corrupts already-painted lines (glyphs vanish, lines merge/disappear) — reproduced live against real Docker services with 3 active panes and the filter-history grid open. A partial fix (hiding the hint panel while the filter editor has input focus, since its keybindings are inert then) already landed on story-5-4-filter-history-recall; this story generalizes it into a reusable bounded/scrollable list primitive and applies it everywhere the same defect exists — including the EDTs zone (Epic 2 territory, same unbounded-list pattern, no crash reported there yet but confirmed by inspection). Appended to Epic 5 (branch still open, where the defect was found and partly fixed) even though it also touches `edts-zone.tsx` — same "bug fix riding the currently-open epic branch" precedent as Story 2.20.

As a developer,
I want every list and modal panel in the Logs and EDTs zones to stay within my terminal's actual size, scrolling instead of overflowing,
So that the tool never corrupts its own display regardless of how many services I have registered or how small my terminal is.

**Acceptance Criteria:**

**Given** the Logs zone's service lists (ACTIVE EDT MEMBERS / OTHER SERVICES) and its always-visible keybinding hints panel
**When** their combined content would exceed the terminal's available rows
**Then** they render within a bounded, scrollable window instead of overflowing and corrupting the display — reusing the windowing pattern already proven in `keybinding-help.tsx` (`resolveHelpWindow`/`clampHelpOffset`), extracted into a shared primitive rather than duplicated

**Given** the EDTs zone's EDT SERVICES / OTHER SERVICES lists
**When** the same overflow condition applies
**Then** they adopt the same bounded/scrollable list primitive — no separate ad hoc fix between the two zones

**Given** `LogFilterEditor` is open (global or per-service, with or without the Story 5.4 history-grid browser)
**When** the zone's other content (service lists, hint panel, pane grid) is still rendered behind it
**Then** the combined content never exceeds the terminal's row count — this story's bounded-list primitive is one part of the mechanism; the hint-panel-hidden-while-editing fix already shipped on story-5-4-filter-history-recall is retained, not undone

**Given** the filter-history grid browser has more entries than fit vertically
**When** it's rendered
**Then** it scrolls/paginates within the available height rather than growing past it (mirrors `command-grid`'s existing horizontal truncation/scroll, UX-DR30, now applied vertically too)

**Given** a bounded list is scrolled away from its start or end
**When** rendered
**Then** a subtle indicator shows there is more content above/below — never a silent, undiscoverable cutoff

**Given** any bounded list or panel
**When** the terminal is resized
**Then** its visible window recalculates live off `useWindowSize()` — never a stale window computed only at mount

**Given** a terminal large enough that nothing currently overflows
**When** the Logs or EDTs zone is used
**Then** visible behavior is unchanged from before this story — this is a defect fix and a reusable primitive, not a redesign

**Implementation notes:** extract a `bounded-list`/scrollable-window primitive out of `keybinding-help.tsx`'s `resolveHelpWindow`/`clampHelpOffset` (already correct, already tested) into `tui/shared/`; apply it to `logs-zone.tsx`'s two service lists, its hints panel, and `LogFilterEditor`'s body (including the history grid); apply the same primitive to `edts-zone.tsx`'s EDT SERVICES/OTHER SERVICES lists. New shared component per Atelier convention (UX-DR33). No change to `ModalDialog` itself required — the fix is bounding what's rendered *inside* each panel, not the panel chrome.

### Story 5.6: Command History Recall & Shared Input-History Primitive

> Added 2026-09-28 (Sprint Change Proposal): brings Story 5.4's arrow-recall history to the `:` command bar (UX-DR29), and — as a first-class goal, not a side effect — extracts the recall logic both features share into one reusable primitive so neither re-implements it.

As a developer,
I want the `:` command bar to remember the commands I've run and let me recall them with ↑/↓,
So that I don't retype frequent commands — and I want this and the filter history to share one implementation, so future history improvements land in both at once.

**Acceptance Criteria:**

**Given** the `:` bar with focus on the input
**When** a command is run (Enter on an exact, recognized match)
**Then** the submitted query is pushed to the front of the command history, deduplicated per `settings.commandPalette.historyDedup` (same semantics as `logs.filterHistoryDedup`: move-to-front everywhere when on, top-only when off), trimmed to `settings.commandPalette.historySize` — an unknown command is never recorded

**Given** the developer is typing a draft
**When** ↑ is pressed
**Then** the input shows the most recent entry and the draft is preserved; further ↑ walks older entries (no-op at the oldest); ↓ walks back, and one ↓ past the most recent entry restores the draft exactly — entries equal to the draft are skipped, exactly as in Story 5.4

**Given** the developer is on their own draft (not browsing)
**When** ↓ is pressed
**Then** the existing behavior is unchanged (enters the autocomplete grid if visible, otherwise no-op) — no history grid browser for commands

**Given** the developer is browsing
**When** a printable character or Backspace is pressed
**Then** browsing ends, the draft is restored, and the keypress is applied on top of it (Story 5.4's snap-back); Enter runs the displayed (recalled) command; Tab adopts the recalled text as the new draft (browsing ends) and behaves as usual on it

**Given** the app is restarted
**When** `:` is opened
**Then** previous command history is still available (persisted in `state.json`, `commandHistory`, alongside `filterHistory`)

**Given** the `:settings` Command Palette tab
**When** the developer adjusts "command history size" or toggles "deduplicate command history"
**Then** it applies and persists immediately; a "clear command history" action empties it — the tab gains a row cursor (Up/Down moves between rows, mirroring the Logs tab's Story 5.4 rework) since Up/Down no longer belongs exclusively to gridMaxRows

**Given** the refactor
**When** this story lands
**Then** the history push/dedup/trim, the arrow-browse state machine (up/down/skip-equal-to-draft), the snap-back-to-draft rule, and the persisted history store mechanics (hydrate-once, version guard against stale reads, serialized save chain, await-in-flight-load before mutate) each exist exactly once in the codebase and are consumed by both the Logs filter editor and the command bar — Story 5.4's existing tests pass unchanged (behavior-preserving extraction); the shared primitive gets its own tests

**Implementation notes:** new pure module `tui/shared/input-history/` (generic `pushHistoryEntry`, `HistoryBrowseState`, `resolveHistoryBrowseUp/Down`, a snap-back helper) — `logs-zone.logic.ts` keeps only its Logs-specific key encoding (`FilterHistoryKey`/`filterHistoryKeyString`); a generic persisted-history store factory extracted from `logs-slice.ts`'s filterHistory machinery, instantiated for filter history (keyed map) and command history (single list); `StatePort` gains `readCommandHistory`/`writeCommandHistory` sharing the state adapter's existing read-merge-write helper; new settings `commandPalette.historySize` (default 20) and `commandPalette.historyDedup` (default true) — the size range constants are generalized to shared `MIN/MAX_INPUT_HISTORY_SIZE` (1..200) used by both history settings. Coordinate with Story 2.32 (TextInputLine adoption in the command bar): whichever lands second places the cursor at end-of-value on recall.

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

> Amended 2026-09-30 (Sprint Change Proposal): the "customize before firing" mechanics — body, headers, query and params editing, and the mandatory request step — are delivered by Stories 6.8/6.9; 6.3 builds saving on top of them. "Ad hoc customize-then-fire always works without saving" is satisfied by 6.9's request step. Saving also persists the request's JsonTree filters/folds (per-route session state from 6.7), so a saved/favorite request reopens with the same view.

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

> Amended 2026-09-30 (Sprint Change Proposal): the correlated logs are shown in the third **Logs** sub-tab of the Routes right pane (Story 6.9's tab model), shown together with the response's summary line; the response and logs remain reachable without a separate step.

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

### Story 6.6: Scanner Extension — Parameters & Request-Body Skeletons

> Added 2026-09-30 (Sprint Change Proposal): feeds the request editor (6.8/6.9) so a route opens
> pre-filled instead of empty.

As a developer, I want the route scanner to expose each route's parameters and a request-body
example, So that the request editor opens with a realistic skeleton instead of a blank body.

**Acceptance Criteria:**

- **Given** an OpenAPI 3.x operation with `parameters` (path / query / header, at operation or
  path-item level) **When** scanned **Then** the route carries a neutral parameter list
  (`name`, `in`, `required`, optional `example`) — operation-level entries override path-item
  ones with the same `name`+`in`.
- **Given** an operation with a JSON `requestBody` **When** scanned **Then** the route carries
  `bodyExample` — the spec's `example`/`examples` value when present, else a skeleton generated
  from the schema (`string → ""`, `number/integer → 0`, `boolean → false`, `array → [one
  generated item]`, `object → all properties`, `enum → first value`, `default`/`example` on a
  property win) — plus the body `contentType`. `$ref`s into `components` are resolved.
- **Given** a recursive or self-referencing schema **When** the skeleton is generated **Then**
  generation is depth-bounded and cycle-safe (a cyclic branch renders `null`/`{}`) — it never
  loops or throws.
- **Given** a `requestBody` that is not JSON (multipart, form-urlencoded, binary) **When**
  scanned **Then** the route carries its `contentType` and **no** `bodyExample` — the editor
  (6.8) then starts empty; nothing is fabricated.
- **Given** a spec that has no parameters/requestBody info, or a scanner implementation for
  another language that never fills the new fields **When** used **Then** everything keeps
  working exactly as in Story 6.1/6.2 — every new field is optional (AD-5: no core change is
  needed to activate a scanner).
- **Given** a malformed `parameters`/`requestBody`/`$ref` **When** scanned **Then** that
  operation degrades to a route without the extra fields (the route is still listed); the scan
  as a whole only fails on the conditions Story 6.1 already defines.

**Implementation notes:** `Route` gains `parameters?: RouteParameter[]`, `bodyContentType?:
string`, `bodyExample?: unknown` — plain data, no OpenAPI vocabulary crossing the port.
Schema → example generation lives in a pure function inside the `nestjs-openapi` driven
adapter (`schema-example.ts`), never in `core/`. Route identity stays `method + path`.

### Story 6.7: JsonTree Component — Read-Only Navigation, Collapse & Session Filters

> Added 2026-09-30 (Sprint Change Proposal): the shared component used to browse a response
> (this story) and to edit a request body (6.8).

As a developer, I want JSON shown as an indented, scrollable tree I can walk line by line, fold
and filter, So that I can read large API responses without a separate tool.

**Acceptance Criteria:**

- **Given** a JSON value **When** rendered **Then** it is shown as indented lines
  (`key: value`, containers with a `{n}` / `[n]` size hint), scalars colored by type (string,
  number, boolean, null), long strings truncated with `…`, inside a bounded viewport that
  scrolls with the selection (same behavior and `Home`/`End`/`PgUp`/`PgDn` as the routes list);
  only visible rows are rendered.
- **Given** the selection is on a container line **When** `→`/`Space` is pressed **Then** it
  unfolds; `←` folds it, or moves to the parent when it is already folded. `+`/`-` unfold/fold
  every node down to the next depth level.
- **Given** a line is selected **When** the developer hides its key (`h`) **Then** every line
  with that key name disappears from the tree, everywhere (a global key rule); `H` on a line
  keeps **only** rules-matching keys visible (allow-list). `f` opens the filter panel to list and
  remove active rules; a `null`-values toggle hides all nulls. The status line always shows the
  number of hidden lines and active rules.
- **Given** a response with hidden or folded content **When** the developer fires another
  request on the **same route** **Then** the same key rules and folded paths apply to the new
  response. Fold state is stored per **normalized path** (array indices become `[]`, e.g.
  `data.items[].tags`), so it survives responses with different array lengths.
- **Given** the developer selects a different route **When** it is opened **Then** it gets its
  **own** filter/fold state (filters are per route). Nothing is persisted to disk: state lives
  in the store for the session, is lost on quit, and has a serializable shape so Story 6.3 can
  save it with a saved request.
- **Given** a response that is not valid JSON (plain text, HTML, or a body truncated at the
  64 KB cap) **When** shown **Then** the Response view falls back to scrollable raw text with a
  visible reason ("not JSON" / "truncated at 64 KB") — it never renders a partial tree as if
  complete.
- **Given** an empty response body or an empty object/array **When** shown **Then** it is an
  explicit empty state, distinct from an error.

**Implementation notes:** `tui/shared/components/json-tree/` — pure model
(`flattenJson(value, foldState, rules) → Row[]`, `normalizePath`, rule/fold reducers) with
unit tests, plus a thin Ink view built on `bounded-list`. Filter/fold state lives in a new
`jsonTreeStates: Record<routeKey, JsonTreeState>` in the routes slice (AD-10: same single
store), `routeKey = METHOD + ' ' + path`. In this story the component is wired into the
existing Response pane (replacing the raw dump); the sub-tab layout arrives in 6.9.

### Story 6.8: JsonTree Edit Mode — Request Body Editing

> Added 2026-09-30 (Sprint Change Proposal).

As a developer, I want to edit a JSON request body in the same tree, So that I can shape a
realistic payload before firing without leaving the terminal.

**Acceptance Criteria:**

- **Given** the tree in edit mode **When** `Enter` is pressed on a scalar **Then** an inline
  field (`TextInputLine`) opens with the current value; on confirm the value is validated by
  its type (number, boolean, `null`, string) and an invalid entry stays displayed in error
  color with its reason — it is never silently coerced.
- **Given** a container or key line **When** `a` (add key/item), `d` (delete) or `t` (change
  type) is pressed **Then** the tree is updated accordingly; adding a key to an object prompts
  for its name and rejects a duplicate.
- **Given** the developer wants to paste a whole payload **When** `r` is pressed **Then** a
  raw-text mode opens (multi-line editable buffer); leaving it validates the JSON — invalid
  JSON keeps the developer in raw mode with the parse error and line/column shown, and the
  previous valid body is preserved.
- **Given** hidden or folded lines in the editor **When** the request is later fired **Then**
  hidden content **is still sent** and the editor status shows "N lines hidden — still sent";
  hide/fold in edit mode is purely visual.
- **Given** the body still has an invalid value or unparsable raw buffer **When** the developer
  tries to leave the editor to fire **Then** the fire is blocked with the first error shown.
- **Given** the same route is edited twice in a session **When** the developer comes back
  **Then** its last edited body and its tree filters/folds are still there (per-route session
  state, as in 6.7).

**Implementation notes:** extends the 6.7 model with an immutable edit layer
(`setValue`, `addEntry`, `removeEntry`, `changeType`) — pure, fully unit-tested; the view adds
the inline editor and the raw mode. Reuses `text-edit.ts`/`TextInputLine`.

### Story 6.9: Routes Right Pane — Mandatory Request Step & Request/Response Sub-Tabs

> Added 2026-09-30 (Sprint Change Proposal).

As a developer, I want selecting a route to open a request editor and firing to reveal the
response in its own tab, So that I always review what I send and can read what comes back
without the two fighting for the same space.

**Acceptance Criteria:**

- **Given** the routes list has the focus **When** `Enter` is pressed on a route **Then** the
  focus moves to the right pane on its **Request** tab (pane title/border highlighted, footer
  switches to the pane's keys); `Esc` returns the focus to the list. `Enter` on the list never
  fires directly — the request step is mandatory.
- **Given** the Request tab **When** opened **Then** it shows sections **Params** (path
  parameters, required ones marked and pre-filled from `example` when known), **Query**,
  **Headers** and **Body** (the 6.8 editor, pre-filled with the 6.6 `bodyExample`, empty when
  the route has none or no body). `Tab`/`Shift+Tab` move between sections. A route with no
  parameters and no body (e.g. a plain `GET`) shows the sections empty and can be fired in two
  keypresses (`Enter` to open, `Ctrl+R` to fire) — the step is mandatory to *pass through*, not
  to fill.
- **Given** required path parameters are unfilled **When** the developer fires **Then** the fire
  is blocked with the missing parameter names listed; nothing is sent.
- **Given** a valid request **When** `Ctrl+R` is pressed **Then** the request is fired through
  the same core use-case (in-process, AD-2), the pane switches automatically to the **Response**
  tab, and shows status, duration and size followed by the 6.7 JsonTree (or raw-text fallback).
  Auth errors keep their distinct rendering (6.2), now inside the Response tab.
- **Given** the right pane has the focus **When** `Ctrl+→` (fallback `Ctrl+N`) or `Ctrl+←`
  (fallback `Ctrl+P`) is pressed **Then** the sub-tab changes to the next/previous one, without
  wrapping. Number keys and `[` `]` are **not** used. The tab strip shows the active tab; a
  third **Logs** tab is displayed only once Story 6.4 provides it (the tab model supports it).
- **Given** the developer switches route or sub-tab **When** they come back **Then** each
  route's request draft and last response are kept for the session (a reload of the routes
  list for a different repo still drops them, as it does today).
- **Given** a route the developer edited **When** `Esc`/`Ctrl+←` returns to the Request tab
  after a fire **Then** the draft is intact and can be tweaked and re-fired without leaving the
  pane.
- **Given** `fire-request` is used from the CLI **When** run without the new options **Then** it
  behaves exactly as in Story 6.2; the new optional `body`/`query`/`headers` options are
  available on the use-case (and as optional CLI flags) with `Content-Type: application/json`
  inferred for a JSON body.

**Implementation notes:** `fireRequest(deps, repoPath, method, path, options?: {body?, query?,
headers?})` — the trailing optional argument keeps 6.2's tests green; the `Cookie` header is
still owned by the auth port and cannot be overridden by `headers`. The Ctrl+→/N / Ctrl+←/P
resolver in `create-wizard/wizard.logic.ts` is generalized to a shared
`shared/keys/tab-navigation.ts` consumed by both the wizard and the Routes pane (wizard tests
unchanged). The routes slice moves from one global `fireStatus/fireResult/fireError` triple to
per-route `requestDrafts` / `responses` maps plus a `routesPaneFocus: 'list' | 'detail'` and
`routesPaneTab: 'request' | 'response'`.

## Epic 7: TUI Consistency, Dashboard & Code Hygiene

### Story 7.1: Source Comment Hygiene (AD-17)

As a developer reading the code, I want comments that explain only what is hard, surprising or deliberately different, so that the code is readable and the useful comments stand out.

**Acceptance Criteria:**

**Given** any file under `src/` **When** the story is done **Then** it opens with at most a 5-line header describing the file's responsibility (or none for a trivially named file such as an `index.ts` barrel).

**Given** a comment that narrates history (story/AC references, "review patch", spec "Boundaries"/"Design Notes" quotes, "previously…", "story X supersedes…") **When** encountered **Then** it is removed; if it carried a real reason (an invariant, a workaround, a "don't change this because…"), that reason is rewritten as a short present-tense comment without the history.

**Given** a non-obvious piece of code with no comment (a workaround, an ordering constraint, a library quirk like Ink's ctrl+letter parsing or depcruise's import-ordering constraint) **When** found during the sweep **Then** a short explanatory comment is added.

**Given** test files **When** swept **Then** story/AC suffixes are removed from `describe`/`it` names and from comments, same rule.

**Given** the sweep **When** done **Then** a guard test asserts `src/` contains no match for `\b[Ss]tory \d+\.\d+|\bAC\d+\b|review patch` (allow-list empty), and `AGENTS.md` › Code conventions states the AD-17 rule in two lines.

**Given** the change **When** reviewed **Then** it is behavior-neutral: `npm test && npm run typecheck && npm run depcheck` pass with zero code changes besides comments, test names and the guard test; commits are split per layer (core, adapters/driven, adapters/driving/cli, adapters/driving/tui per zone, bin) for reviewable diffs.

**Implementation notes:** must start while no other story branch is open. Do not remove the `dependency-cruiser` import-ordering explanation or other comments `AGENTS.md` points at — rewrite them shorter.

### Story 7.2: Container-less Managed Services (FR-29)

As a developer, I want to register and manage a service that has no Docker container, so that libraries and non-dockerized repos (e.g. `shared-types`) are first-class members of my EDTs and updates.

**Acceptance Criteria:**

**Given** a manifest without `container` **When** loaded **Then** it validates (`Manifest.container?: string`; an empty string is still rejected) and the repo registers.

**Given** a group update (any scope) including a container-less service **When** the restart phase is reached **Then** the clean-restart recipe runs if the run asks for it and `restartCommands` is declared; otherwise the phase is reported `skipped` with detail `no container` — never `failed`, and `ContainerPort.restart` is never called.

**Given** the Update zone, the Logs zone or any health badge **When** showing a container-less service **Then** it shows a distinct "no container" state (dim glyph + text) and never polls docker for it.

**Given** the Logs zone **When** a container-less service is selected **Then** no subscription is made and the pane shows "No container — no logs for this service"; the restart control is absent.

**Given** per-service actions (Update/EDT zones) **When** offered for a container-less service **Then** plain "restart" is hidden; "clean restart" is offered only if `restartCommands` is declared.

**Given** the CLI (`repos list`, `service-restart`) **When** a container-less service is involved **Then** `list` shows `container: null` in JSON / `—` on a TTY, and `service-restart` fails with `no-container` unless a clean restart is requested and declared.

**Given** the `manifest-generator` skill **When** run on a repo with no docker-compose service for it **Then** it omits `container` instead of guessing one.

**Implementation notes:** make the type optional first and let `tsc` enumerate every dereference. Architecture AD-4/AD-16 amendments in this proposal apply.

> Amended 2026-10-05 (Sprint Change Proposal `sprint-change-proposal-2026-10-05-2.md`, graft C1 — implement on the still-open story branch before the epic merge):

**Given** the Logs zone listing services **When** rendered **Then** an info-only "services without container" section groups every container-less registry service (members included): greyed, unselectable, excluded from Tab order and Ctrl+A.

**Given** focus on "active edt members" or "other services" **When** Ctrl+A **Then** the select-all toggle applies to the focused list only.

**Given** any service row with known health **When** rendered **Then** its up/down/restarting/no-container badge is visible with or without cursor.

**Given** a restarting service **When** displayed **Then** the state explicitly reports "restart requested → container state re-verified" (exact treatment at spec: post-restart poll + label), not the bare `restarting` badge.

### Story 7.3: Shared Zone Layout Contract & `Ctrl+W` Resize in Every Zone (UX-DR35)

As a developer, I want to resize the panes of whichever zone I'm in with `Ctrl+W`, and have every zone built from the same layout contract, so that resizing works everywhere and new panes get it for free.

**Acceptance Criteria:**

**Given** the TUI **When** the story is done **Then** a shared zone-layout primitive exists (e.g. `ZoneLayout` + a declarative pane/boundary spec: orientation, default ratio, min/max) that renders panes and `Splitter`s, recolors the targeted boundary, and reads/writes ratios from the store; **every** zone (Dashboard, EDTs, Update, Logs, Routes, shared-types) builds its split through it — no zone hand-rolls a split.

**Given** any zone, no overlay open **When** `Ctrl+W` is pressed **Then** resize-mode engages on that zone's boundary 0; `Tab` cycles that zone's boundaries; arrows move the targeted one per its orientation; `Enter`/`Esc` exit — the existing Story 2.21 behavior, generalized (`shouldEnterResizeMode` no longer checks `activeZone === 'edts'`).

**Given** a zone with a single pane (no boundary) **When** `Ctrl+W` is pressed **Then** it is a no-op and the footer never advertises `Ctrl+W` there.

**Given** ratios moved in any zone **When** the app restarts **Then** they are restored per zone (persisted through the state port as today); a persisted ratio array of the wrong length for a zone (layout changed between versions) is replaced by that zone's defaults, never crashes.

**Given** the Logs zone **When** the story is done **Then** "wrap all panes" moves off `Ctrl+W` to a new key (chosen here, no collision with any canonical binding), updated in the footer, the `?` help screen and the Logs keybinding list; the single-pane `w` is unchanged.

**Given** the EDTs zone **When** migrated **Then** its existing 3-boundary behavior and persisted ratios are preserved (no user-visible change).

**Implementation notes:** Routes and Update already pass `listSplitterTargeted` — fold that into the primitive. The Dashboard's pane spec is defined here as a placeholder and filled by 7.5.

### Story 7.4: Interaction Consistency Audit & Alignment (UX-DR36)

As a developer, I want every zone to use the same keys, wording and components for the same intent, so that I never have to remember which zone does what differently.

**Acceptance Criteria:**

**Given** the story starts **When** the audit runs **Then** it produces an inventory (table, committed under `_bmad-output/implementation-artifacts/epic-7/`) of every zone's and dialog's bindings and components per intent: list cursor/jump, enter/activate, edit-commit-cancel, toggle, confirm/cancel dialog, destructive-action confirmation, filter, refresh/retry, footer hint wording and order, modal title casing/language, empty/loading/error state components, text input (TextInputLine), pick lists (FilterablePickList), branch inputs (BranchAutocompleteInput).

**Given** the inventory **When** divergences are found **Then** one canonical choice per intent is recorded as the UX-DR36 table in EXPERIENCE.md (Interaction Primitives), and the developer validates that table before the alignment work starts.

**Given** the validated table **When** alignment is done **Then** every zone and dialog conforms; duplicated ad-hoc implementations (hand-rolled lists, confirm prompts, footer strings, input handling) are replaced by the shared components; any intentional deviation is listed in the table with its reason.

**Given** UI language **When** audited **Then** mixed French/English labels in the TUI are flagged and unified to the language chosen in the table.

**Given** the footer and `?` help screen **When** rendered in any context **Then** they are generated from the same keybinding declarations (no hand-written duplicate hint strings).

**Given** the result **When** reviewed **Then** existing tests are updated only where a binding or wording deliberately changed, and each such change is listed in the story file.

**Implementation notes:** if the alignment list proves larger than one story, split the remainder into follow-up stories (7.4b…) from the validated table rather than growing this one.

### Story 7.5: Dashboard — Workspace Summary & Last-Update Persistence (UX-DR19)

As a developer, I want the Dashboard to show me my active EDT at a glance — each service's container status, active branch and divergence, and how the last update went — so that I know the state of my workspace the moment I open the tool.

**Acceptance Criteria:**

**Given** the app launches **When** the Dashboard renders **Then** the banner stays (Story 2.16), followed by a cold-load spinner per section while data assembles; sections fill independently.

**Given** an active EDT **When** the summary is ready **Then** it lists each member service with: container status (up/down/restarting/no container — glyph + text, FR-29), current branch, and ahead/behind vs. its `sharedBranch` (FR-9's existing computation, reused), plus the EDT name.

**Given** any group update finishes (any scope, TUI or CLI) **When** it ends **Then** its outcome (finished-at timestamp, scope, updated/skipped/failed counts) is persisted through the state port; the Dashboard shows the latest one ("Last update: <relative time> — 3 updated, 1 failed"), or "No update run yet".

**Given** no EDT exists **When** the Dashboard renders **Then** it prompts to create or choose an EDT instead of an empty summary; with an empty registry the Story 2.11 prompt keeps precedence.

**Given** the Dashboard **When** displayed **Then** the default highlighted action is "Enter [last EDT]" (switches to the EDTs zone with that EDT selected).

**Given** docker or git probes fail for a service **When** rendered **Then** that row shows an explicit error state for that field; other rows and sections are unaffected.

**Implementation notes:** uses Story 7.3's layout contract. The container-status poll reuses the Update zone's health-poll slice logic rather than a third copy.

### Story 7.6: Dashboard — Alerts, Quick Actions, Registry Health & Operation Indicator

As a developer, I want the Dashboard to warn me about anything needing attention and to launch common actions from it, so that it is a real starting point, not just a status page.

**Acceptance Criteria:**

**Given** active-EDT members **When** a member has uncommitted changes or a merge/rebase in progress **Then** it is flagged inline (warning glyph + reason) in the summary.

**Given** the Dashboard **When** focused **Then** a quick-action row offers: enter last EDT, start group update (opens Story 3.7's configuration), open Logs, switch EDT (Story 2.30's quick-pick) — each with its key shown in the row and footer, keys consistent with UX-DR36.

**Given** the registry **When** summarized **Then** a section shows registered-repo count and counts of invalid manifests, unreachable repos and listing issues (Story 2.34's classification), with a shortcut to `:registry`; all-clear shows a single success line.

**Given** an operation holds a lock (update, migration, switch, …) **When** the Dashboard renders **Then** a line names the operation and its progress, and quick actions that would conflict are disabled with the reason.

### Story 7.7: Shared Focus-Navigation Component (FR-33)

> Added 2026-10-05 (Sprint Change Proposal `sprint-change-proposal-2026-10-05-2.md`). Runs before Story 7.4 so the alignment phase consumes its primitive.

As a developer, I want one shared navigation primitive so Tab/Shift+Tab move focus the same way in every zone, with Shift+Tab always reversing Tab.

**Acceptance Criteria:**

**Given** the `focus-navigation` primitive **When** Tab advances **Then** Shift+Tab retreats everywhere Tab navigates (lists, sub-zones, panes).

**Given** the per-zone mode declaration **When** configured **Then** each zone uses H/V arrows, Tab/Shift+Tab, or Ctrl+N/P with no ad-hoc Tab handler left.

**Given** all zones migrated **When** rendered **Then** footer and `?` reflect the active bindings from the same declarations.

### Story 7.8: Update Per-Service Last-Run Detail (FR-32)

> Added 2026-10-05 (Sprint Change Proposal `sprint-change-proposal-2026-10-05-2.md`). Parallelizable with the 7.2 graft; session-only, independent of 7.5's persisted datum.

As a developer, after a group update I want the detail pane to report per service what really happened, so I trust the run without re-checking by hand.

**Acceptance Criteria:**

**Given** a successful merge with unchanged HEAD **When** shown **Then** "already up to date", never a diffstat.

**Given** an advancing merge **When** shown **Then** +N/−M lines and F files (via the GitPort diff capability).

**Given** the migrate phase ran **When** shown **Then** "ran (<command>)" plus an output excerpt; when absent/disabled, "migrations: none".

**Given** a new run finishes **When** it lands **Then** it replaces the previous detail (session-only, never persisted).

**Given** the CLI **When** a run ends **Then** the same details ride the JSON line.

**Given** a zone has a pending background event **When** on the Dashboard **Then** its tab shows the counter badge (UX-DR19 background-event state).
