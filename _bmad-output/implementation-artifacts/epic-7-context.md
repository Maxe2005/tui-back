# Epic 7 Context: TUI Consistency, Dashboard & Code Hygiene

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Turn the functionally complete tool into a consistent, readable one: a codebase whose comments explain the code rather than its history, first-class support for services that have no Docker container, every TUI zone built from one layout contract (with `Ctrl+W` resize everywhere) and one interaction vocabulary, and a Dashboard that actually summarizes the workspace and is a real starting point.

## Stories

- Story 7.1: Source Comment Hygiene (AD-17)
- Story 7.2: Container-less Managed Services (FR-29) + C1 graft (2026-10-05): info-only "services without container" Logs group (all registry, greyed/unselectable/Tab-excluded), focus-scoped Ctrl+A, health badge on every row, explicit restarting
- Story 7.3: Shared Zone Layout Contract & `Ctrl+W` Resize in Every Zone (UX-DR35)
- Story 7.7: Shared Focus-Navigation Component (FR-31) — before 7.4; Shift+Tab reverses Tab everywhere via one per-zone configurable primitive
- Story 7.4: Interaction Consistency Audit & Alignment (UX-DR36)
- Story 7.5: Dashboard — Workspace Summary & Last-Update Persistence (UX-DR19)
- Story 7.6: Dashboard — Alerts, Quick Actions, Registry Health & Operation Indicator
- Story 7.8: Update Per-Service Last-Run Detail (FR-30, session-only) — parallelizable with the 7.2 graft

## Requirements & Constraints

- Comment convention: each `src/` file may open with a header of at most 5 lines stating its responsibility; any other comment explains only something difficult, surprising or deliberately different. No story/AC/review-patch references anywhere in `src/`, test names included; a guard test greps for `\b[Ss]tory \d+\.\d+|\bAC\d+\b|review patch`. Traceability lives in commits and story files.
- A manifest may omit `container` (an empty string is still rejected). Container-less services are never polled or restarted through the container port; restart phases report `skipped` with detail `no container`, never `failed`.
- Pane ratios persist per zone through the state port; a persisted ratio array of the wrong length falls back to that zone's defaults.
- Footer hints and the `?` help screen are generated from the same keybinding declarations.
- Group-update outcomes (finished-at, scope, counts) persist through the state port for the Dashboard.

## Technical Decisions

- Hexagonal boundaries hold: `core` never imports adapters; use-cases return `Result<T>`; TUI cross-zone state lives in the single Zustand store.
- Explanations that `AGENTS.md` relies on stay in the code, shortened: the dependency-cruiser import-ordering constraint, NodeNext `.js` imports, the unanchored depcruise boundary path, Ink's ctrl+letter parsing.
- One shared zone-layout primitive renders panes and splitters for every zone; no zone hand-rolls a split.
- Shared components (TextInputLine, FilterablePickList, BranchAutocompleteInput) replace ad-hoc list/input/confirm implementations after the consistency audit.

## Cross-Story Dependencies

- 7.1 runs first, while no other story branch is open (it touches most files, comments only).
- 7.2-graft (C1) lands on the still-open story branch before the epic merge.
- 7.8 is session-only and core-led; it never touches 7.5's persisted datum.
- 7.7 lands before 7.4 so alignment consumes the nav primitive; 7.4's inventory is unchanged.
- 7.5 builds on 7.3's layout contract and reuses the Update zone's health-poll logic; 7.6 builds on 7.5 and on 7.4's canonical keys.
- 7.5 builds on 7.3's layout contract and reuses the Update zone's health-poll logic; 7.6 builds on 7.5 and on 7.4's canonical keys.
- 7.2's container-less state is shown by 7.5's Dashboard summary.
