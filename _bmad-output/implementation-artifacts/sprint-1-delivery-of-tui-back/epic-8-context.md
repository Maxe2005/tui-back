# Epic 8 Context: Dashboard

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Give the developer a landing Dashboard that answers "should I worry about anything?" at a glance: the active EDT's services with state, branch and divergence, the shared per-service actions, an Attention block and a registry-health summary, all under the permanent banner. It replaces the former stories 7.5/7.6 (removed 2026-10-15). The epic also covers branch drift: detecting repos that left the branch they should be on and realigning a chosen selection of them in one step. Visual reference: `ux-designs/ux-tui-back-2026-08-10/mockups/key-dashboard.html`.

## Stories

- Story 8.1: Dashboard Snapshot Use-Case & CLI
- Story 8.2: Dashboard Shell — States, Fixed Banner & Refresh
- Story 8.3: Dashboard — Active-EDT Services Table & Per-Service Actions
- Story 8.4: Dashboard — Attention Block & Registry Health
- Story 8.5: Dashboard — EDT Actions & Visual Finish
- Story 8.6: Branch Drift Detection — Snapshot & Attention
- Story 8.7: `realign` Use-Case & CLI — Selective Branch Realignment
- Story 8.8: Realign Dialog, Shortcut & Settings Defaults

## Requirements & Constraints

- The Dashboard is read-only apart from the per-service actions and the EDT actions; it is refreshed on mount and on `R`, with no live polling and no background-event badge or group-update outcome.
- One snapshot feeds both the TUI and a standalone `dashboard` CLI command (standard JSON envelope, per-service results as `{service, outcome, detail?}`-style uniform shapes where applicable).
- A probe failure (docker or git) degrades only the affected field/row/section to an explicit error state.
- Container-less services show a distinct "no container" state (glyph + dim text), never "down".
- An empty registry keeps the existing empty-registry prompt as top precedence; registry without EDT prompts to create/choose one; no active EDT is distinct from an empty registry.
- Shared-branch divergence: a member is flagged when `behind > 0`, no configurable threshold; "no upstream" and "unknown (offline)" are explicit states.
- The banner is permanent and never compacted; when it cannot fit, a "terminal too small" screen is shown instead.
- Rendering is bounded at every terminal size (ellipsis truncation, windowed scroll region, too-small screen); an overlay open means the Dashboard is inert.
- Drift: a member service drifts when its current branch differs from the branch defined for the active EDT (detached HEAD counts); a non-member managed service drifts when off its `sharedBranch` (exposed in a separate `others` collection, existing member fields unchanged). A failed probe yields an explicit `unknown` state, never drifted or aligned. No active EDT means no drift data.
- Realign checks out the expected branch for selected services (members: EDT branch; non-members: `sharedBranch`); aligned services are `unchanged` and untouched. Dirty work is preserved or the service skipped with a reason, never discarded; merge/rebase in progress or a failing branch-scope gate fails/skips only that service. Per-service closed results: `realigned`/`unchanged`/`skipped`/`failed`; action-log entry records selection and outcomes; the run never rejects.
- Optional post-realign restart (`none`/`simple`/`clean`) applies only to services whose branch changed and that have a container; others are `skipped` in the restart report; a restart failure never rolls back the realign. Realign shares the action lock with update/switch (rejected both ways).
- CLI `realign` takes scope (`none|edt|all`), service names and restart flags; absent flags use settings defaults; unknown values/services are rejected before anything is touched; exit non-zero on any failed realign or failed/down/unhealthy restart. Settings: `realign.defaultScope` (default `edt`) and `realign.restartMode` (default `none`), persisted and applied live.
- `R` (refresh) and `Ctrl+R` (restart) are distinct; footer and `?` help are generated from the keybinding declarations.

## Technical Decisions

- Realign lives in `core/realign`, pure with ports injected; the checkout-with-preservation step is extracted from the switch core (one shared implementation) and the restart phase reuses the existing runPool/ServiceActions/verifyService logic. Drift reuses the existing branch/divergence computation with no extra git call per service beyond the current-branch read.
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
- Attention block gains one line per drifted service (name, current vs expected branch, member or "other"), ordered after the protected-branch line and before "behind shared branch"; counted in the header; a realign shortcut is offered when any exists.
- Realign dialog (`:realign` or the Dashboard shortcut, registered in the dialog registry, input gated on overlay ownership): selection table of drifted services only (members first), checkbox, name, current and expected branch, member/other marker as text; presets None / EDT services / All act on listed rows; Space toggles a row; restart selector None / simple / clean (this run only); live per-service rows then summary with non-green first; "all services are aligned" empty state; confirm disabled with "no service selected". Shortcut must not collide with `R`, `Ctrl+O/R/L`, `e`.
- Atelier tokens: one accent colour, status colours only for status, square corners, dim secondary text. Footer: `[↑/↓] service`, `[Enter] open`, `[Ctrl+O]` `[Ctrl+R]` `[Ctrl+L]` when a service is focused, `[R] refresh`, `[e] EDTs`.

## Cross-Story Dependencies

- 8.1 is the foundation: 8.2–8.5 consume its snapshot.
- 8.3 depends on Story 7.12 (service action registry) and 7.7 (focus navigation); 8.2/8.5 depend on 7.3 (layout) and 7.9 (bounded rendering); 8.2 on 7.11 (overlay owns keys).
- 8.1 reuses Stories 2.6 (divergence), 2.34 (registry classification), 2.42/2.43 (protected/shared branches), 7.2 (container-less).
- 8.6 extends 8.1 (snapshot) and 8.4 (Attention); 8.7 consumes 8.6's drift model; 8.8 builds on 8.7 and mirrors the Update configuration screen table (3.7/3.20).
- 8.7 is blocked until Story 2.44 (restart phase) is done and merged: halt rather than re-implement it. It also depends on the Epic 2 switch core (safety gate, dirty handling) and the Story 3.16 action lock; 8.8 depends on 7.11 (overlay ownership).
- 8.5 closes the deferred "banner clips on short terminals" entry.
