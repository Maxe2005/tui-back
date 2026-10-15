# Epic 8 Context: Dashboard

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Give the developer a landing Dashboard that answers "should I worry about anything?" at a glance: the active EDT's services with state, branch and divergence, the shared per-service actions, an Attention block and a registry-health summary, all under the permanent banner. It replaces the former stories 7.5/7.6 (removed 2026-10-15). Visual reference: `ux-designs/ux-tui-back-2026-08-10/mockups/key-dashboard.html`.

## Stories

- Story 8.1: Dashboard Snapshot Use-Case & CLI
- Story 8.2: Dashboard Shell — States, Fixed Banner & Refresh
- Story 8.3: Dashboard — Active-EDT Services Table & Per-Service Actions
- Story 8.4: Dashboard — Attention Block & Registry Health
- Story 8.5: Dashboard — EDT Actions & Visual Finish

## Requirements & Constraints

- The Dashboard is read-only apart from the per-service actions and the EDT actions; it is refreshed on mount and on `R`, with no live polling and no background-event badge or group-update outcome.
- One snapshot feeds both the TUI and a standalone `dashboard` CLI command (standard JSON envelope, per-service results as `{service, outcome, detail?}`-style uniform shapes where applicable).
- A probe failure (docker or git) degrades only the affected field/row/section to an explicit error state.
- Container-less services show a distinct "no container" state (glyph + dim text), never "down".
- An empty registry keeps the existing empty-registry prompt as top precedence; registry without EDT prompts to create/choose one; no active EDT is distinct from an empty registry.
- Shared-branch divergence: a member is flagged when `behind > 0`, no configurable threshold; "no upstream" and "unknown (offline)" are explicit states.
- The banner is permanent and never compacted; when it cannot fit, a "terminal too small" screen is shown instead.
- Rendering is bounded at every terminal size (ellipsis truncation, windowed scroll region, too-small screen); an overlay open means the Dashboard is inert.
- `R` (refresh) and `Ctrl+R` (restart) are distinct; footer and `?` help are generated from the keybinding declarations.

## Technical Decisions

- Hexagonal: the snapshot lives in `core/dashboard`, pure, ports injected (container, git, registry, edt-state); no TUI imports; use-cases return `Result<T>`; kebab-case error codes.
- The `dashboard/` TUI zone is the one zone allowed to read (never write) across all capability areas; shared visual components live in `tui/shared/`.
- Container status reuses the Update zone's health logic (no third copy); ahead/behind reuses the existing divergence computation; protected-branch and branch-used-by-another-EDT flags reuse the existing EDT/manifest logic.
- Service actions (open in IDE, simple/clean restart) come only from the AD-21 registry via `ServiceActionsRow`; a new registered action appears with no layout change. Actions disabled with their reason (no container, no recipe, operation in progress, held lock name).
- Focus navigation uses the shared focus-navigation component; zone layout uses the shared layout contract and bounded primitives.
- Zustand store holds cross-zone TUI state.

## UX & Interaction Patterns

- Layout: banner, EDT line, services table (state glyph+text, issue marker, branch, ahead/behind), focused-row reason line and action row, Attention block (ordered by severity, count in header, single success line when clear), registry-health summary (`[:registry]` shortcut).
- Each section has its own spinner and fills independently; a dim "updated Ns ago" line; load failure shows `[R] retry`.
- EDT actions: default "Enter [EDT]", `[e]` for choose/create (quick-pick); `Enter` on an attention line focuses that service's row.
- Atelier tokens: one accent colour, status colours only for status, square corners, dim secondary text. Footer: `[↑/↓] service`, `[Enter] open`, `[Ctrl+O]` `[Ctrl+R]` `[Ctrl+L]` when a service is focused, `[R] refresh`, `[e] EDTs`.

## Cross-Story Dependencies

- 8.1 is the foundation: 8.2–8.5 consume its snapshot.
- 8.3 depends on Story 7.12 (service action registry) and 7.7 (focus navigation); 8.2/8.5 depend on 7.3 (layout) and 7.9 (bounded rendering); 8.2 on 7.11 (overlay owns keys).
- 8.1 reuses Stories 2.6 (divergence), 2.34 (registry classification), 2.42/2.43 (protected/shared branches), 7.2 (container-less).
- 8.5 closes the deferred "banner clips on short terminals" entry.
