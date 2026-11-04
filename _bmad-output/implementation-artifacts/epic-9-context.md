# Epic 9 Context: Service Terminals & Unified Service Actions

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A developer can open a command terminal on a service (its repo directory) or on its container from the Dashboard or the Logs tab, every per-service action behaves identically wherever it is offered, and the Shared Types tab makes its commands and post-publish next steps obvious. Added after Epic 8 closed; additive only, no existing epic is reopened.

## Stories

- Story 9.1: Shell Session Port, Driven Adapter & `core/shell` Use-Case
- Story 9.2: Registry Entries for Service & Container Terminals
- Story 9.3: Shared Scrollable Output & Fullscreen Primitive
- Story 9.4: Terminal View in the TUI
- Story 9.5: Unified Service Actions in the Logs Tab
- Story 9.6: Shared Types UX — Action Bar & Post-Publish Choice Screen

## Requirements & Constraints

- Terminal: type commands at a prompt, stdout/stderr stream back as lines, output scrolls and can go fullscreen (shared with Logs), a running command can be cancelled without quitting the app, history recall at the prompt.
- Line-oriented only: no interactive TTY programs; a command needing a TTY fails fast with a visible hint, never hangs.
- Container-less service: container terminal disabled with reason `no container`; non-running container disabled with `container not running`.
- Unified actions: Open in IDE, Restart, Clean restart, service terminal, container terminal are available from Dashboard and Logs from one registry with the same availability rules (amends the earlier restart/open-in-IDE requirement).
- Shared Types: every action shown as a labelled command with its key and, if unavailable, its reason; after a successful publish the next steps (propagate this version, back to form, close) are an explicit choice, not a dim hint.
- No new dependency. Done when `npm test && npm run typecheck && npm run depcheck` plus the bounded-rendering and dialog-registry guards are green.

## Technical Decisions

- Shell session port (AD-22): `core/ports/shell-session.ts`, driven adapter `adapters/driven/shell-session/`, use-cases in `core/shell/` returning `Result` (never reject). Each command runs via `sh -c` in the service dir, or `docker exec` without a TTY for the container (a non-running container yields `container-not-running` before anything runs). Service-shell cwd persists across commands (pwd sentinel); a bad `cd` reports an error and keeps the previous cwd. Cancel terminates the process group and the run settles `cancelled`. Retained output is a bounded ring buffer with an "N lines dropped" marker. Blank command is a no-op; blank repo path is rejected. Not a PTY (a PTY adapter is optional unscheduled backlog 9.7).
- `child_process` stays confined to driven adapters (existing depcruise rule). Core tested against a fake port; adapter against the real system (temp dir; docker via the existing docker test seam).
- Service action registry (AD-21, extended): `core/service-actions` gains `terminal-service` and `terminal-container` with availability + reasons; consumers render whatever the registry lists. Logs' hard-wired `R` / `O` branches must be rerouted through the registry with no duplicated availability rules in `logs-zone.tsx`.
- Extract scroll / wrap / fullscreen logic from the Logs fullscreen pane into `tui/shared/` (scroll state, wrap toggle, bounded viewport); Logs behaviour must stay identical and its tests pass.
- Bounded rendering (AD-19): all regions bounded in both axes, no unbounded `.map`, dynamic text truncated, growing lists via the shared scroll region. Update `bounds-*.test.tsx` / the static guard and register new dialogs/zones in the dialog/zone registries.
- Reuse the shared input-history primitive (Story 5.6) for command history; overlays own keys per Story 7.11; footer and `?` help come from keybinding declarations.
- Shared Types change is zone/logic only; existing publish/propagate use-cases and the `q` mid-run guard are unchanged.

## UX & Interaction Patterns

- Terminal view (overlay owning keys): header shows target (service or container name), cwd and a running indicator; scrollable output; one prompt line at the bottom. Enter runs; Up/Down recall history; a key moves focus to output for scrolling; `F` toggles fullscreen; `Ctrl+C` cancels the running command (does not quit); `Esc` closes, confirming if a command is running. stdout/stderr coloured like Logs.
- Service action menu: the registry list as a navigable menu in Logs panes (grid and fullscreen), disabled entries show reasons, Enter runs; `R` and `O` remain shortcuts.
- Shared Types action bar: Publish, Propagate, History, Reload with keys and disabled reasons (e.g. `historyDisabledReason`), also in `?` help.
- Post-publish choice screen: "Propagate <version> to consumers" (pre-fills version), "Back to the form", "Close"; Up/Down + Enter, Esc = Close, one-line explanation each. Failed publish lists Relaunch / Back the same way.
- Keys must obey the interaction consistency contract. Proposed `Ctrl+T` (service terminal) and `Ctrl+E` (container terminal): HALT and ask if either collides with a canonical key or zone binding. Note `Ctrl+E` is already the canonical second-step key for irreversible file-loss confirmations, and `Ctrl+O/R/L`, `R`, `e` are used on the Dashboard — check before binding.

## Cross-Story Dependencies

- 9.2 needs 9.1 and Story 7.12 (registry / `ServiceActionsRow`); the row must show the new entries with no component change.
- 9.3 is a no-behaviour-change refactor, parallelisable with 9.1.
- 9.4 needs 9.1, 9.2, 9.3. 9.5 needs 9.2 and 9.4.
- 9.6 is independent of 9.1–9.5 and can run any time.
- Suggested order: 9.1 / 9.3 -> 9.2 -> 9.4 -> 9.5; 9.6 anywhere. Branching: epic branch `epic-9-service-terminals-unified-service-actions`, one branch per story.
- Manifest surface unchanged: no manifest doc or manifest-generator skill update needed.
