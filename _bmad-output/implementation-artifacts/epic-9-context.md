# Epic 9 Context: Service Terminals & Unified Service Actions

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Let a developer open a line-oriented command terminal on a service's repo directory or on its container from the Dashboard or the Logs tab. Every per-service action (open in IDE, restart, clean restart, both terminals) behaves the same wherever it appears, and the Shared Types tab shows its commands and post-publish next steps clearly. The epic also makes the displayed service state health-first: one resolver combines the `healthUrl` probe with the container state. That state feeds a one-action "heal" that restarts every service that is not up, from the Dashboard and from the CLI. Two smaller additions round it out: a type-to-filter `?` help and a per-service setting that turns the health check off.

## Stories

- Story 9.1: Shell Session Port, Driven Adapter & `core/shell` Use-Case
- Story 9.2: Registry Entries for Service & Container Terminals
- Story 9.3: Shared Scrollable Output & Fullscreen Primitive
- Story 9.4: Terminal View in the TUI
- Story 9.5: Unified Service Actions in the Logs Tab
- Story 9.6: Shared Types UX — Action Bar & Post-Publish Choice Screen
- Story 9.7: Health-First Service Status Resolution
- Story 9.8: `heal` Use-Case & CLI — Restart Services That Are Not Up
- Story 9.9: Dashboard — Heal Action
- Story 9.10: Text Filter in the Keybinding Help
- Story 9.11: Per-Service Health Check Toggle

## Requirements & Constraints

- **Terminals:** commands are typed at a prompt and stdout/stderr stream back as lines. Output scrolls and can go fullscreen, using the same behaviour as the Logs view. A running command can be cancelled without quitting the tool, and the prompt has history recall. Terminals are line-oriented only: a command that needs a TTY fails with a visible hint and never hangs. A container-less service offers no container terminal (disabled: `no container`), and a stopped container is disabled with its reason.
- **Unified actions:** Open in IDE, restart, clean restart, service terminal and container terminal come from one registry with the same availability rules on the Dashboard and in Logs. Unavailable actions are shown disabled with their reason. A clean restart without a recipe falls back to a simple restart with a visible notice.
- **Shared Types:** every action is a labelled command showing its key and, when unavailable, its reason. After a publish, the next steps are an explicit choice screen, not a hint line. Existing use-cases and the `q` mid-run guard stay unchanged.
- **Health-first status:** Dashboard, Logs, Update and the CLI `dashboard` all get a service's state from one rule, using the closed set `up | unhealthy | inconsistent | restarting | down | no-container` plus a probe-error state. `inconsistent` shows up as an Attention item. A container-less service that declares `healthUrl` gets a real up/down state. A periodic poll must never overlap the previous poll for the same repo or block rendering, and it keeps the last-known state on failure.
- **Heal:** targets are active-EDT services whose status is `down` or `unhealthy` and that declare a container. Every other service is listed as skipped with a reason. Heal runs after a confirmation, in simple or clean mode, and verifies each restarted service. The CLI uses the standard envelope and exits 1 when a targeted service ends failed, down or unhealthy. New setting: `dashboard.restartMode` (default `simple`).
- **Help filter:** typing narrows the `?` help by keys, description or section (case-insensitive) and shows a "no match" line when nothing matches. Esc clears a non-empty filter before it closes the help. `?` closes the help only when the filter is empty.
- **Health check toggle:** a local setting `services.healthCheckDisabled` holds a list of manifest service names (default empty). A disabled service resolves as if it had no `healthUrl`, is marked `healthCheck: 'disabled'`, and is never probed. That includes post-restart verification, and heal never targets it as `unhealthy`. The change applies on the next resolution, with no restart.
- **Documentation:** any change to the manifest surface (the widened role of `healthUrl`, the toggle) must update `docs/tui-back-manifest.md` and the `manifest-generator` skill. CLI envelope changes (the `dashboard` `status` field, `heal`) must update the envelope doc.

## Technical Decisions

- **Shell session port:** `core/ports/shell-session.ts`, with a driven adapter in `adapters/driven/shell-session/` and use-cases in `core/shell/`. A service command runs with `sh -c` in the repo directory, and the cwd persists across commands (`cd` is handled, and a bad `cd` keeps the previous cwd). A container command runs with `docker exec` and no TTY. Output lines are tagged stdout or stderr. `cancel()` kills the process group. Retained output is a bounded ring buffer with an "N lines dropped" marker. This is not a PTY, so a PTY adapter could replace the adapter later without touching core. `child_process` never appears in `core/` or the TUI.
- **Service action registry** (the existing core registry, extended): it also lists `terminal-service` and `terminal-container`. Consumers such as `ServiceActionsRow` and the Logs menu render the registry and never duplicate availability rules.
- **Service status resolution:** `core/service-status/resolveServiceStatus(repoPath)` is the only producer of a displayed service state. It probes `healthUrl` first through `HealthProbePort` (one GET, short timeout), then reads the container state through `DockerPort.getContainerHealth`. The combination table lives only in the resolver:
  - 2xx and the container is up: `up`
  - 2xx and the container is down or restarting: `inconsistent`
  - non-2xx or timeout and the container is up: `unhealthy`
  - non-2xx or timeout and the container is down or restarting: `down` or `restarting`
  - no `healthUrl`: the container state, with `up` flagged unverified
  - 2xx while Docker errors: `up`, with the container error carried separately
  The resolver is the only reader of the health-check-disabled setting, through the optional `isHealthCheckEnabled` dependency (absent = enabled). `verifyService` keeps its polling loop but applies the same per-attempt rule and the same toggle decision. New probe kinds are added inside the resolver only.
- **Heal machinery:** generalise the switch-restart pool and report into an entry point that takes a target list. It restarts through `ServiceActions.restart` at `update.concurrency` and verifies through `verifyService`. It reuses the switch-restart vocabulary, and switch/realign behaviour and tests stay unchanged. A held operation lock fails that row with the lock's name.
- **Architecture conventions:**
  - Core code is pure, gets its ports injected, returns `Result` and never rejects.
  - Core is tested against fake ports; adapters are tested against the real system (temp dir).
  - CLI output follows the standard envelope: JSON on non-TTY, exit code 0 or 1, kebab-case error codes.
  - Every rendered region is bounded in both axes: no unbounded `.map`, and growing collections go through the shared scroll region.
  - New overlays own the keyboard and register in the dialog registry.
  - The footer and `?` help are generated from keybinding declarations.
- **Settings:** each new setting (`dashboard.restartMode`, `services.healthCheckDisabled`) needs updates to the settings port, the zod schema, the defaults and the settings screen. The new Services tab goes last in `SETTINGS_TABS`. A missing or corrupt value falls back to the default with the usual warning.

## UX & Interaction Patterns

- **Dashboard service actions:** `Ctrl+O` opens in IDE, `Ctrl+R` restarts, `Ctrl+L` runs a clean restart, `Ctrl+T` opens the service terminal and `Ctrl+X` opens the container terminal. `Ctrl+E` was rejected because it keeps its canonical meaning (second-step confirm of irreversible file loss). The container terminal can be greyed with `no container`, `container not running`, `container state unknown` or `manifest unreadable`.
- **Terminal view (overlay that owns every key):**
  - The header shows the target, the cwd and a running indicator. The prompt is at the bottom.
  - stdout uses the text colour and stderr the error colour. The echoed command and the status lines are dim.
  - Prompt focused: `Enter` runs the command (refused with a dim notice while a command is running, keeping the draft). `↑/↓` recall history, which is shared by every terminal for the whole app run. `Ctrl+C` cancels the running command or, when idle, clears the draft.
  - `Tab` switches focus between the prompt and the output. Output focused: `↑/↓` and `PgUp/PgDn` scroll, `?` opens help, and any printable key returns to the prompt.
  - `Ctrl+F` toggles fullscreen. It replaces the bare `F` from the original brief, because the prompt must accept every printable character.
  - `Esc` closes the view and asks for confirmation while a command runs. Closing discards the cwd and the output.
- **Logs:** an actions key opens a `MenuList` of the registry's actions with their disabled reasons. The existing `R` and `O` stay as shortcuts and go through the registry.
- **Shared Types:**
  - Action bar: Publish, Propagate, History and Reload, each with its key and disabled reason.
  - Next-step choice screen after a publish: `↑/↓` + Enter selects and Esc means Close. Each choice has a one-line explanation. On success the choices are "Propagate <version>" (pre-fills the version), "Back to the form" and "Close". On failure they are Relaunch and Back.
- **Heal screen:** the proposed key is `H`. If it collides with a canonical (UX-DR36) key or a Dashboard/shell binding, HALT and ask.
  - The confirm overlay lists targets and skipped services with reasons, with the mode pre-selected and switchable.
  - Rows go live from `restarting` to `verifying` to the final state. Closing during a run needs confirmation.
  - When the run ends, it shows a summary and the Dashboard refreshes.
  - With no target, a notice is shown instead.
  - The Dashboard still has no live poll outside this screen.
- **New status states:** `unhealthy` and `inconsistent` each get their own glyph and text from theme tokens. The focused-row reason line shows the probe reason, or a dim `health check off` when the check is disabled.
- **Help filter:**
  - A `filter: <text>` line sits under the title, with a dim `type to filter` placeholder when empty.
  - Section headings show only when one of their rows matches.
  - Scrolling resets to the top on each filter change, and a long filter is truncated.
  - The help reopens with an empty filter.
- **Settings, Services tab:** one "health check" checkbox per registered service, checked = enabled. A service without `healthUrl` (`no healthUrl`) or with an unreadable manifest (`manifest unavailable`) is listed disabled with its dim reason. Toggling persists immediately.

## Cross-Story Dependencies

- **Terminal track:** 9.1 and 9.3 can run in parallel, then 9.2 → 9.4 → 9.5. 9.2 also builds on the Epic 7 service action registry (7.12). 9.4 reuses the Epic 5 history primitive and the Epic 7 overlay key ownership.
- **Shared Types (9.6):** independent of the rest of the epic.
- **Health track:** 9.7 → 9.8 → 9.9, independent of 9.1–9.6. 9.11 depends on 9.7. 9.10 is independent.
- **Dashboard snapshot (9.7):** renames the snapshot field `container` to `status` and keeps the raw container state. This changes the Epic 8 Dashboard consumers and the CLI `dashboard` envelope.
- **Heal (9.8, 9.9):** 9.8 reuses the switch-restart machinery from the Epic 2 post-switch restart and the Epic 8 realign. 9.9 reuses the realign dialog's restart-report rendering.
