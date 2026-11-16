# Epic 2 Context: EDT Workspace Management

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A developer can create, modify, switch between, and delete EDTs — isolated coding-session workspaces over hand-picked member services — with branch and divergence visibility across every managed repo, no uncommitted work ever lost silently, non-member repos always returned to their own shared branch, and an optional verified service restart chained after a switch.

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
- Story 2.10: Recover From an Already-Running TUI Instance
- Story 2.11: Repo Registry Screen & Manifest Onboarding Guidance
- Story 2.12: Zone Arrow Navigation
- Story 2.13: Manifest-Gated Zone Tab Visibility & Disabled State (Routes & shared-types)
- Story 2.14: Command Entry Bar (`:`) & Registered Commands
- Story 2.15: EDT Commands in Command Bar & Action History in Detail Pane
- Story 2.16: Permanent Dashboard Banner
- Story 2.17: Terminal-Style Command Bar Autocomplete & Grid Browser
- Story 2.18: EDT Zone — Active Highlight, Fixed-Width Detail Pane, Categorized Services & Per-Service Actions
- Story 2.19: Global Settings Screen (`:settings`)
- Story 2.20: Top Bar & Footer Hint Accuracy Fixes
- Story 2.21: EDT Zone — Multi-Splitter Layout with Keyboard Resize-Mode (`Ctrl+W`)
- Story 2.22: EDT Creation — Mandatory Branch Creation UI
- Story 2.23: Visible Text-Input Cursor (EDT Zone Text Fields)
- Story 2.24: Modify EDT — Mandatory Branch on Add, No More Silent Default
- Story 2.25: EDT Zone — Structured Per-Repo Failure Display & Branch-Collision State
- Story 2.26: Branch-Picker — 3 Explicit Modes (Pick Existing / Create New / Rename Current)
- Story 2.27: EDT Creation — Branch-Picker Reuse & Manifest-Aware Base-Branch Default
- Story 2.28: Registry — Manifest Semantic Validation
- Story 2.29: Delete an EDT
- Story 2.30: EDT Quick-Pick — Filterable List for `edt-switch` / `edt-modify`
- Story 2.31: `edt-create-from` — Clone an EDT's Membership as a Creation Starting Point
- Story 2.32: `TextInputLine` — Cursor Navigation & App-Wide Adoption
- Story 2.33: Registry — Deregister Stale, Unreachable, or Unmanaged Repos
- Story 2.34: EDT Zone — Colored, Explained Service-Listing Issues
- Story 2.35: EDT Creation Core — Per-Service Branch Plans & Remote Branches
- Story 2.36: EDT Creation Wizard — Shell, Step Navigation, Name & Services Steps
- Story 2.37: EDT Creation Wizard — Step 3: Global Branch Strategy & Per-Service Overrides
- Story 2.38: EDT Creation Wizard — Step 4: Activation & Switch Choice
- Story 2.39: EDT Switch Core — Three-State Partition & Dirty-Service Resolutions
- Story 2.40: `edt switch` CLI — Fail-Safe Dirty Handling & Explicit Flags
- Story 2.41: EDT Switch Resolution Dialog — Global Strategy, Per-Service Overrides & Discard Confirmation
- Story 2.42: Manifest-Defined Protected Branches per Service
- Story 2.43: Cross-EDT Branch Usage — Alerts in Branch Choosers & Rename Gate
- Story 2.44: EDT Switch — Optional Parallel Service Restart & Verified State

## Requirements & Constraints

An EDT is created with a unique topic and at least one manually selected member service; duplicates and zero-member creation are rejected before any write. Branch creation at EDT time uses a chosen base (defaulting to each service's own shared branch) with one shared name or per-service names; per-service failures are reported without aborting the others. No protected branch (service manifest's protected list plus its shared branch) may ever be registered as an EDT's own branch, at creation or later, and rejection happens before any git write with an explanation. Every git write passes a central gate that resolves the allowed branch itself and never trusts a caller-supplied name. Switching preserves uncommitted work in every affected repo (adopt or discard only on explicit per-service consent, re-verified not assumed); exactly one EDT is active afterwards, members on their registered branches, every non-member on its own shared branch (fetched if missing locally). Every managed service shows current branch plus ahead/behind divergence in both directions, member or not, including offline/no-upstream display. Deletion is blocked while the EDT is active and per-service when its branch is another EDT's own branch; each member offers leave-branch-alone vs delete, informed by merge status and uncommitted work. An optional post-switch restart (none / simple / clean, default none) runs in parallel over affected services and reports verified per-service state. Every core use-case returns a `{ok,data}` / `{ok,error}` shape with kebab-case error codes; the CLI renders human text on a TTY and exactly one JSON line otherwise, exit code only 0/1. One EDT's corruption never touches another's state. No commit or push happens without explicit approval at that moment.

## Technical Decisions

Hexagonal layout with one-way dependencies: domain core owns EDT lifecycle, driving adapters (TUI, CLI) call the same core use-cases directly and never touch driven adapters, driven adapters implement ports declared in core. A repo is managed only if it carries a root manifest, schema-validated on load, declaring service identity, optional container (absent means no plain restart, health, or log stream), optional migration command (absent means skip that phase cleanly), optional restart recipe, optional shared branch defaulting to `development`, optional protected branches, and a module-id map selecting only keys from a compiled-in static registry. The managed-path set lives in an explicit registry file populated by an explicit register action; scanning only proposes candidates and validates manifests semantically. Storage is one SQLite file per EDT named by generated ULID (never the topic), one narrow global store, an active-EDT pointer plus transient UI state in a state file, and a validated per-user settings file; each database migrates via hand-rolled numbered SQL tracked by a schema-version table. Concurrency uses two mechanisms: the interactive TUI refuses a second TUI instance, and every mutating use-case takes a short-lived advisory lock scoped to the EDT id / repo paths it touches. Cross-zone state lives in one central store whose active-EDT field is a hydrated cache of the state file, re-synced when the file changes; per-service actions and post-switch verification are declared once in core behind ports (editor launch, container health plus optional manifest health-URL probe — core never does inline HTTP), with the post-switch restart as a second use-case call over a bounded worker pool, leaving the switch itself unchanged.

## UX & Interaction Patterns

Atelier shell throughout: permanent top bar (app name, active EDT, filter/command affordances), zone-tab bar with active/disabled/omitted states and background-event badges, footer hint reflecting live keybindings, resizable list/detail split with single-character splitter, modal dialogs where Escape always cancels and Enter always confirms, dry-factual primary line plus optional dim wink line, glyph always paired with color, single braille-glyph spinner as the only animation. Lists use the shared row vocabulary (selected cursor, emphasized driver row, discreet active suffix, trailing dim branch/divergence meta) inside bounded scroll windows with more-above/below indicators; every rendered region is bounded on both axes with ellipsis, windowing, or an explicit too-small screen. Canonical keys: `j`/`k` move, `g`/`G` top/bottom, `Space` toggle, `Enter` confirm, `Esc` cancel, `Tab` cycle (`Shift+Tab` always reverses), `Ctrl+W` resize mode, `/` filter, `:` command, `?` help, `q` quit (confirms mid-run); `Left`/`Right` switch zones with wrapping, single-letter zone mnemonics, one shared zone-layout contract declaring panes/boundaries/ratios with per-zone persisted sizes, one shared focus-navigation primitive, and an open overlay as the sole key consumer. Command bar is a dialog with no list on open: `Tab` on empty input shows the full grid, on input autocompletes a single match or longest shared prefix (second `Tab` reveals the grid); unmatched `Enter` shows inline unknown-command, history recalls with `↑` preserving the draft. Grid browser is multi-column arrow-navigable with truncation and horizontal scroll, reused for filter/command history. Settings is a tab-organized dialog reachable only as a command, applying immediately with no save step. EDT surfaces categorize member vs other services with per-service contextual actions, structured per-repo failure rows distinguishing branch-collision, inline protected/cross-EDT warnings in every branch chooser, filterable quick-pick for switch/modify, and a four-step creation wizard (name, services, global strategy plus per-service override table with configure box, activation with pre-flighted checkout and pause panel) navigated by `Ctrl+N`/`P` with cursor-addressable text inputs everywhere.

## Cross-Story Dependencies

Branch creation, modification, switch, delete, branch-picker, wizard, and cross-EDT rename gating all depend on the central git safety gate and the per-EDT store; the gate's protected set must be manifest-defined before chooser alerts can annotate it. Switch depends on the action lock and is blocked while a group update runs, and conflicts with standalone restarts; post-switch restart builds on the shared service-action registry. Registry plus semantic manifest validation precede any EDT membership work. The command bar, autocomplete grid, settings screen, zone arrow navigation, multi-splitter layout, bounded-list primitive, and text-input primitive are shared foundations consumed by every later EDT-zone story. Creation-wizard steps build in order (core branch plans, shell, branch strategy, activation); switch redesign builds in order (core three-state partition, CLI flags, resolution dialog, then restart chaining).
