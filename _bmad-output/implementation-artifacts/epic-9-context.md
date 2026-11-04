# Epic 9 Context: Service Terminals & Unified Service Actions

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A developer can open a command terminal on a service (its repo directory) or on its container from the Dashboard or the Logs tab. Every per-service action behaves the same wherever it is offered, and the Shared Types tab makes its commands and post-publish next steps obvious. A second extension makes every displayed service state health-first, so a service whose container runs but which does not answer shows as such. It also adds "heal", a one-action restart of every service that is not up, from the Dashboard and the CLI. The epic only adds work: no closed epic is reopened, and Epic 8's status consumers are migrated by this epic.

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

## Requirements & Constraints

- **Terminal:** the user types commands at a prompt, and stdout/stderr stream back as lines. The output scrolls and can go fullscreen, using the same behaviour as Logs. A running command can be cancelled without quitting the app, and the prompt recalls history. Line-oriented only: a command that needs a TTY fails fast with a hint and never hangs.
- **Unified actions:** Open in IDE, Restart, Clean restart, the service terminal and the container terminal come from one registry, with the same availability rules on the Dashboard and in Logs. The container terminal is disabled with a reason (`no container`, `container not running`).
- **Shared Types:** every action is shown as a labelled command with its key and, when unavailable, its reason. After a publish (success or failure), the next steps are an explicit choice, not a dim hint.
- **Health-first status:** every view that shows a service state derives it from one rule. These views are the Dashboard, the Logs panes and badges, the Update service list and the CLI `dashboard`. The rule probes the manifest `healthUrl` first, then reads the container state.
  - The closed set of states is `up | unhealthy | inconsistent | restarting | down | no-container`, plus an explicit probe-error state.
  - A container-less service that declares `healthUrl` gets a real up/down state.
  - `inconsistent` means the health route answers while the container is down or restarting. It is an attention item.
- **Heal:** heal targets the active-EDT services whose status is `down` or `unhealthy` and that declare a container. A confirmation first lists the targets and the skipped services with their reasons. Restarts run in simple or clean mode, then each service is verified and its final state reported. The CLI `tui-back heal [--restart simple|clean]` gives the same result.
- **Manifest:** there is no schema change, but `healthUrl` now drives everyday status, not only post-restart verification. Story 9.7 must update `docs/tui-back-manifest.md` and the `manifest-generator` skill to say so, with the resolution table and the container-less behaviour.
- No new dependency. A story is done when `npm test && npm run typecheck && npm run depcheck` pass, and the bounded-rendering and dialog-registry guards are green.

## Technical Decisions

- **Shell session port:**
  - The port is `core/ports/shell-session.ts`, the driven adapter is `adapters/driven/shell-session/`, and the use-cases live in `core/shell/`. They return `Result` and never reject.
  - A service command runs through `sh -c` in the service directory. A container command runs through `docker exec` without a TTY; a container that is not running yields `container-not-running` before anything runs.
  - The cwd persists across commands. A bad `cd` reports an error and keeps the previous cwd.
  - `cancel()` kills the process group and the run settles `cancelled`.
  - Output is kept in a bounded ring buffer with an "N lines dropped" marker.
  - A blank command is a no-op; a blank repo path is rejected.
  - This is not a PTY. A PTY adapter is an unnumbered backlog item that could replace the adapter later.
- **`child_process`** stays in driven adapters only. Core is tested against fake ports; adapters are tested against the real system (a temp dir, and Docker through the existing test seam).
- **Service action registry** (`core/service-actions`): it gains `terminal-service` and `terminal-container`, each with its availability and reason. Consumers render whatever the registry lists. Logs' `R` and `O` go through the registry, with no availability rules duplicated in `logs-zone.tsx`.
- **Shared scroll primitive:** the scroll, wrap and fullscreen logic is extracted from the Logs fullscreen pane into `tui/shared/`. Logs must behave exactly as before.
- **Service status resolution:**
  - `core/service-status/resolveServiceStatus(repoPath)` is the only producer of a displayed state. It reads `ManifestPort`, `DockerPort.getContainerHealth` and `HealthProbePort`, is pure, and returns `Result`.
  - The combination table lives only in the resolver:
    - 2xx with the container up or no container → `up` (verified).
    - 2xx with the container down or restarting → `inconsistent`.
    - 2xx with a Docker error → `up`, with the container error carried separately. It is never `inconsistent`, so a Docker outage does not flag every service.
    - Not 2xx or timeout with the container up → `unhealthy`. With the container restarting or down, the container state is kept. With no container → `down`.
    - No `healthUrl` → the container state, with `up` marked unverified.
  - A future probe kind is added inside the resolver, never in consumers.
  - `getServiceHealth` stays as the raw container read used by the resolver.
  - `verifyService` keeps its polling loop but uses the same per-attempt rule.
- **Snapshot and CLI shape:** the Dashboard snapshot field `container` becomes `status`, and the raw container state is kept for the reason line. This changes the CLI `dashboard` JSON, so update its envelope doc.
- **Polls:** Logs and Update poll through the resolver with a short probe timeout (about 2 s). A poll never overlaps the previous one for the same repo and never blocks rendering. On failure, the last known state is kept.
- **Heal use-case:** generalise the pool and report of `restartAfterSwitch` (`core/edt/switch-restart.ts`, over `runPool`) into an entry point that takes a target list. Switch and realign behaviour and their tests must stay unchanged.
  - Restarts go through `ServiceActions.restart` at `update.concurrency` and are verified with `verifyService`. The report uses the switch-restart vocabulary.
  - A held operation lock fails that row with the lock's name.
  - Skip reasons: `up`, `already restarting`, `inconsistent`, `no container`, `status unknown`.
  - With no target, heal succeeds and says "every service is up". With no active EDT, it fails explicitly.
  - The CLI emits the standard envelope. It exits 1 when a targeted service ends failed, down or unhealthy.
- **New setting:** `dashboard.restartMode` (`simple` | `clean`, default `simple`) goes in the settings port, the schema and the settings screen. It is the default for `--restart` and for the Heal screen.
- **Bounded rendering:** every new surface is bounded in both axes, with no unbounded `.map`, truncated dynamic text and growing lists in the shared scroll region. Update the `bounds-*` tests and the static guard, and register new dialogs and zones in the registries.
- **Shared conventions:** reuse the input-history primitive for terminal history. Overlays own their keys, and the footer and `?` help come from keybinding declarations.
- **Shared Types:** only the zone and its logic change. The publish and propagate use-cases and the `q` mid-run guard stay as they are.

## UX & Interaction Patterns

- **Dashboard service-action keys:** `Ctrl+O` open in IDE, `Ctrl+R` restart, `Ctrl+L` clean restart, `Ctrl+T` terminal, `Ctrl+X` container terminal. `Ctrl+X` is the agreed replacement for `Ctrl+E`, which was already canonical elsewhere. Unavailable actions are greyed out with their reason.
- **Terminal view:** an overlay showing the target, the cwd and a running indicator, with scrollable output and a one-line prompt at the bottom.
  - Enter runs the command and Up/Down recall history. A key moves focus to the output for scrolling.
  - `F` toggles fullscreen, and `Ctrl+C` cancels the running command without quitting the app.
  - `Esc` closes the view, asking first if a command is running.
  - stdout and stderr are coloured like Logs.
- **Logs action menu:** shown in both grid and fullscreen panes. It lists the registry actions; disabled entries show their reason and Enter runs the selected one. `R` and `O` remain shortcuts.
- **Shared Types:**
  - An action bar lists Publish, Propagate, History and Reload with their keys and disabled reasons.
  - After a successful publish, a choice screen offers "Propagate <version> to consumers" (version pre-filled), "Back to the form" and "Close". Up/Down and Enter select, and Esc means Close. Each choice has a one-line explanation.
  - A failed publish offers Relaunch and Back the same way.
- **Status vocabulary:** `unhealthy` and `inconsistent` each get their own glyph and text from the existing theme tokens (warning tone, for example `◐ unhealthy` and `⚠ inconsistent`). `inconsistent` gets an Attention item ("health route answers but container is <state>"), placed after the protected-branch items. The focused row's reason line shows the probe reason.
- **Heal screen:**
  - The proposed key is `H`. HALT and ask if it collides with a canonical key or with an existing Dashboard or shell binding.
  - When there are no targets, a notice says every service is up and no screen opens.
  - Otherwise a confirm overlay lists the targets and the skipped services with their reasons. The mode is pre-selected from `dashboard.restartMode` and can be switched. Enter starts and Esc cancels.
  - Each row then shows `restarting → verifying → final state` live. The screen cannot be closed mid-run without confirmation.
  - At the end, the summary is shown and the Dashboard refreshes.
  - The screen reuses the realign dialog's restart-report layout.
  - Outside this screen, the Dashboard still does not poll live: it refreshes on mount and on `R`.

## Cross-Story Dependencies

- Terminal track: 9.1 and 9.3 can run in parallel, then 9.2 (which needs 9.1 and Story 7.12's registry and `ServiceActionsRow`, with no component change), then 9.4 (needs 9.1–9.3), then 9.5 (needs 9.2 and 9.4).
- 9.6 is independent and can run at any time.
- Health and heal track: 9.7, then 9.8, then 9.9. It is independent of 9.1–9.6. 9.7 migrates the four existing `getServiceHealth` consumers (Dashboard snapshot, Logs pane and row polls, Update list). 9.8 depends on 9.7's statuses, and 9.9 on 9.8's use-case.
- Branching: the epic branch is `epic-9-service-terminals-unified-service-actions`, with one `story-9-x-…` branch per story merged back with `--no-ff`.
