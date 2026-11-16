# Sprint Change Proposal — 2026-11-04: Service terminals, unified service actions, Shared Types UX (Epic 9)

Mode: Batch. Scope: **Moderate** (new epic, backlog reorganisation, one new port, AD addendum; no rollback).

## 1. Issue Summary

Three requests raised after Epic 8 closed:

1. **Service terminal.** From the Dashboard, after "Open in IDE / Restart / Clean restart", add two actions: a terminal on the chosen service (its repo directory) and a terminal on the service's container when one exists. The user types commands, sees results, scrolls, and can go full screen, reusing whatever the Logs tab already offers for that.
2. **Actions available in Logs.** Every service action (Open in IDE, Restart, Clean restart, plus the two new terminals) must also be reachable from the Logs tab. Today Logs only has hard-wired `R` (restart, mode from `logs.restartMode`) and `O` (open in IDE).
3. **Shared Types tab UX** (the "sh" tab = `zones/shared-types`). Actions are only discoverable through keys hidden in hint lines. The post-publish "chain into propagation" choice is a condensed dim line (`C chain into propagation with this version, Esc stop`) that users miss.

Evidence: `shared-types-zone.tsx` (`SHARED_TYPES_CHAIN_HINT`, `P publish`, `H version history`, `R reload` as single dim `Text` lines); `logs-zone.tsx` (`input === 'R'` / `'O'` branches duplicate availability rules that `core/service-actions` already owns); `service-actions-row` is consumed only by the Dashboard.

## 2. Impact Analysis

**Epics**
- No existing epic is broken. Epic 8 stays done; Epics 4 and 5 are untouched in their existing stories.
- **New Epic 9: Service Terminals & Unified Service Actions** (6 stories).

**PRD**: add FR-39 (service/container terminal), FR-40 (unified service actions across Dashboard and Logs), FR-41 (Shared Types action discoverability and post-publish choice). No NFR change.

**Architecture**
- **AD-21 (service action registry) is extended**: the registry gains `terminal-service` and `terminal-container` entries; consumers keep rendering whatever it lists.
- **New AD-22 — Shell session port.** `core/ports/shell-session.ts` + driven adapter `adapters/driven/shell-session/`. Line-oriented (decision below): each submitted command runs via `child_process` in the service directory (`sh -c`), or `docker exec <container> sh -c` for the container; cwd persists across commands in the service shell (tracked by a `pwd` sentinel); output streams back as lines tagged stdout/stderr; `cancel()` sends SIGINT/kills the process group. No `child_process` in `core` or `driving` (existing depcruise rule holds).
- No new dependency. Interactive programs (vim, htop, prompts waiting on a TTY) are explicitly out of scope; a command that needs a TTY fails fast with a visible hint.

**UX**: new "Terminal" view pattern (output buffer + prompt line, history, full screen) and new "action bar" + "choice screen" patterns in Shared Types. Key bindings must respect UX-DR36 and `Ctrl+O/R/L`, `R`, `e` on the Dashboard.

**Code impact (indicative)**
- `core/service-actions/index.ts`: two entries, availability (`no container`, container not `up` → reason).
- New `core/shell/` use-case (run, cancel, history, bounded output retention) over the new port.
- TUI: shared `ScrollableOutput`/fullscreen primitives extracted from `logs/fullscreen-pane.tsx` and `logs-pane-view.tsx` so Logs and Terminal share scroll, wrap and fullscreen; a Terminal zone/overlay; Logs zone replaces its `R`/`O` branches by a registry-driven action menu; Shared Types zone refactor.
- Command history: reuse Story 5.6's shared input-history primitive.
- Registry of dialogs/zones and `bounds-*.test.tsx` / bounded-rendering guard must be updated (AGENTS.md).

## 3. Recommended Approach

**Direct Adjustment** — new Epic 9 on branch `epic-9-service-terminals-unified-service-actions` from `devlopment`, one branch per story, as per CLAUDE.md. Rationale: all pieces plug into existing seams (AD-21 registry, Logs fullscreen, history primitive); a separate epic keeps the Epic 8 close-out intact. Effort: medium-high (the shell port + shared scroll/fullscreen extraction are the real work). Risk: medium (process lifetime/cancel, bounded output, key collisions). Timeline: no impact on closed epics.

Decision recorded: **line-by-line shell, no PTY** (no native dependency). The port is shaped so a PTY adapter could replace it later (optional backlog item 9.7, not scheduled).

## 4. Detailed Change Proposals

### 4.1 PRD (`prds/prd-tui-back-2026-08-10/prd.md` and the FR inventory in `epics.md`)

```
NEW FR-39: A developer can open a command terminal on a service (its repo directory) and, when the
service has a container, on that container, inside the tool: type commands, read results, scroll
back, cancel a running command, use full screen. Line-oriented; no interactive TTY programs.
NEW FR-40: Every per-service action (open in IDE, restart, clean restart, service terminal,
container terminal) is available from the Dashboard and from the Logs tab, from the same registry,
with the same availability rules.
NEW FR-41: In Shared Types, every action is visible as a labelled command with its key; after a
successful publish the next-step choices (propagate this version, back to form, close) are
presented explicitly rather than as a dim hint.
```

### 4.2 Architecture (`ARCHITECTURE-SPINE.md`)

```
AD-21 (amend): registry entries now also include terminal-service and terminal-container.
Availability: terminal-container requires a manifest container (reason "no container"); a
non-running container is "container not running".
NEW AD-22 — Shell session port (2026-11-04): ShellSessionPort in core/ports, adapter in
adapters/driven/shell-session. Line-oriented; streamed tagged lines; cancel; cwd tracking for the
service shell; container shell via `docker exec` (no -t). Output retention is bounded (ring buffer).
Not a PTY. child_process stays confined to adapters/driven.
```

### 4.3 UX (`EXPERIENCE.md` / `DESIGN.md`)

```
NEW pattern "Terminal view": scrollable output (shared with Logs fullscreen), one prompt line at
the bottom with history recall, header showing target (service / container) and cwd, running
indicator, cancel key, fullscreen toggle. Keys follow the Logs fullscreen idiom for scroll/wrap.
NEW pattern "Service action menu": the ServiceActionsRow list as a navigable menu, used in Logs.
NEW pattern "Action bar" (Shared Types): labelled commands [P] Publish  [S] Propagate  [H] History
[R] Reload with disabled reasons shown, replacing hint-only lines.
NEW pattern "Next-step choice screen": after publish success, a selectable list
(↑/↓ + Enter) — "Propagate 0.1.7 to consumers", "Back to the form", "Close" — with a one-line
explanation per choice. (Chosen over a modal popup; Esc = Close.)
```

### 4.4 Epics (`epics.md`) — new Epic 9

**Epic 9: Service Terminals & Unified Service Actions** — A developer can open a terminal on a service or its container from the Dashboard or Logs, all service actions are the same everywhere, and the Shared Types tab makes its commands and post-publish choices obvious. Covers FR-39, FR-40, FR-41.

**Story 9.1: Shell Session Port, Driven Adapter & `core/shell` Use-Case** (FR-39)
As a developer, I want a safe command-execution seam, so that terminals are testable and `child_process` stays in adapters.
- Given a service repo path, when a command is run, then stdout/stderr stream as tagged lines and the run settles with the exit code; the use-case returns `Result`, never rejects.
- Given `cd` or `cd ..` in a service shell, when the next command runs, then it executes in the new cwd; cwd never leaves existing paths silently (a bad `cd` reports an error).
- Given a running command, when cancel is requested, then the process (group) is terminated and the run settles `cancelled`.
- Given a container target, when a command is run, then it executes through `docker exec` without a TTY; a container that is not running yields `container-not-running` before anything runs.
- Given long output, when retained, then only a bounded number of lines are kept (older dropped, with a "N lines dropped" marker).
- Given a command that needs a TTY, then it fails with a clear hint, not a hang.
- Edge: blank command is a no-op; blank repo path is rejected (as in `rejectBlankRepoPath`).
- Tests per AD-13: core against fake port; adapter against the real system (temp dir; docker adapter tested through the existing docker test seam).

**Story 9.2: Registry Entries for Service & Container Terminals** (FR-39, FR-40) — depends on 9.1 and 7.12.
- Given any service, when `list` is called, then it also returns `terminal-service` and `terminal-container` with availability and reasons (`no container`, `container not running`, `operation in progress` not applicable).
- Keys proposed `Ctrl+T` (service terminal) and `Ctrl+E` (container terminal); **HALT if either collides** with UX-DR36 or an existing zone binding.
- `ServiceActionsRow` shows them with no layout code change.

**Story 9.3: Shared Scrollable Output & Fullscreen Primitive** (FR-39) — refactor, no behaviour change in Logs.
- Given the Logs fullscreen pane, when its scroll/wrap/fullscreen logic is extracted into `tui/shared/` (scroll state, wrap toggle, bounded viewport), then Logs behaves exactly as before and all existing Logs tests pass.
- Bounded rendering (AD-19) holds at every size; added to the dialog/zone registry as needed.

**Story 9.4: Terminal View in the TUI** (FR-39) — depends on 9.1–9.3.
- Given the Dashboard with a service focused, when the Terminal action is chosen, then a terminal view opens on that service, overlay owning the keys (Story 7.11), prompt at the bottom, output scrollable.
- Given a container, when the container terminal action is chosen, then the same view opens targeting the container (`docker exec`), header names the container.
- Typing runs on Enter, `Up/Down` recalls history (Story 5.6 primitive) while the prompt is focused; a scroll mode key switches focus to the output; `F` toggles fullscreen; `Ctrl+C` cancels the running command (and does not quit the app); `Esc` closes; closing with a command running asks for confirmation.
- Header shows target, cwd and a running indicator; the footer/`?` help are generated from keybinding declarations.
- Output uses stdout/stderr colouring consistent with Logs; no unbounded `.map` (AD-19).

**Story 9.5: Unified Service Actions in the Logs Tab** (FR-40) — depends on 9.2, 9.4.
- Given a Logs pane (grid or fullscreen), when the actions key is pressed, then a menu lists the registry's actions for that pane's service (Open in IDE, Restart, Clean restart, Terminal, Container terminal) with disabled reasons; Enter runs the selected one.
- Existing `R` (restart per `logs.restartMode`) and `O` keep working as shortcuts; both route through the registry (no duplicated availability rules in `logs-zone.tsx`).
- Given a container-less pane, then restart and container terminal are listed disabled with the reason.

**Story 9.6: Shared Types UX — Action Bar & Post-Publish Choice Screen** (FR-41)
- Given the Shared Types tab (form view), then an action bar lists Publish, Propagate, History, Reload with keys and disabled reasons (e.g. "History unavailable: …" already computed by `historyDisabledReason`), generated from the keybinding declarations and also shown in `?` help.
- Given a successful publish, then a choice screen replaces the dim hint: "Propagate <version> to consumers" (pre-fills the version, goes to the form with consumers listed), "Back to the form", "Close"; ↑/↓ + Enter select, Esc = Close; each choice has a one-line explanation.
- Given a failed publish, then the failure screen lists its choices (Relaunch, Back) the same way.
- Quit-mid-run guard (`q`) unchanged. Existing publish/propagate use-cases untouched; only the zone and its logic change.
- Optional backlog 9.7 (not scheduled): PTY adapter behind the same port.

### 4.5 Sprint status (`sprint-status.yaml`)

```
epic-9: backlog
9-1-shell-session-port-driven-adapter-core-shell-use-case: backlog
9-2-registry-entries-for-service-and-container-terminals: backlog
9-3-shared-scrollable-output-and-fullscreen-primitive: backlog
9-4-terminal-view-in-the-tui: backlog
9-5-unified-service-actions-in-the-logs-tab: backlog
9-6-shared-types-ux-action-bar-and-post-publish-choice-screen: backlog
epic-9-retrospective: optional
```
Order: 9.1 → 9.3 (parallelisable) → 9.2 → 9.4 → 9.5; 9.6 is independent and can run any time.

## 5. Implementation Handoff

- **Scope: Moderate.** PM/Architect-level artefacts touched are additive only (FR-39..41, AD-22, UX patterns); Developer (Amelia) implements per story via `bmad-build`, each story on its own branch from the epic branch, atomic Conventional Commits with the story number in the subject.
- Manifest surface does not change, so `docs/tui-back-manifest.md` and the manifest-generator skill need no update (memory rule checked).
- Success criteria: terminal opens from Dashboard and Logs on service and container; scroll and fullscreen share code with Logs; Logs offers all five actions through the registry; Shared Types shows labelled commands and a visible post-publish choice; `npm test && npm run typecheck && npm run depcheck` green; bounded-rendering and dialog-registry guards green.
- Risks to watch: key collisions (`Ctrl+T`/`Ctrl+E`), process-group cancel on Linux/macOS, `docker exec` without TTY behaving differently from a developer's usual shell, output flooding (ring buffer).
