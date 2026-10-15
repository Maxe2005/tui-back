# Epic 6 Context: Route Explorer

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A developer can browse any managed repo's API routes, fire requests with dev-mode auth handled automatically, build a reusable library of saved requests, and see each response together with the relevant service logs — replacing the cluttered generated Swagger UI and keeping the mid-coding trace → fix → resume loop fast enough not to break flow.

## Stories

- Story 6.1: Route Discovery via a Pluggable Scanner Module
- Story 6.2: Fire a Request with Automatic Dev-Mode Auth
- Story 6.3: Save, Customize, and Re-Fire a Request
- Story 6.4: See Response and Relevant Logs Together
- Story 6.5: Manage the Saved-Request Library Across EDTs
- Story 6.6: Scanner Extension — Parameters & Request-Body Skeletons
- Story 6.7: JsonTree Component — Read-Only Navigation, Collapse & Session Filters
- Story 6.8: JsonTree Edit Mode — Request Body Editing
- Story 6.9: Routes Right Pane — Mandatory Request Step & Request/Response Sub-Tabs

## Requirements & Constraints

- Route exploration is available only on repos whose manifest activates it; everywhere else no route list is offered. Adding it to a new repo is manifest-only, never a core change.
- A failed scan and a genuinely empty route list are visibly distinct states; a failure is never rendered as an empty list.
- Firing a request never requires manual token handling: protected-route auth is automatic per session across repos, expired dev tokens refresh silently, and a permission mismatch surfaces as a distinct auth error rather than a generic failure.
- Ad-hoc customize-then-fire always works without saving first. Saving captures method, path, body, and headers; re-firing a saved request allows further edits, then a per-fire choice of overwriting the original or saving as new.
- Save-as-new with a colliding name is rejected with a prompt for a different name. A saved request whose route is no longer discovered is flagged stale and deletable, never fired silently.
- Every fire shows the response together with the relevant aggregated logs in the same view, immediately, with no separate correlation step.
- The affected-service set per route is learned, not pre-configured: first fire proposes active-EDT members with logs windowed around the fire; the developer can adjust before or after firing; the adjusted set is saved against the route, reused automatically, and editable/resettable later.
- Saved requests form one global library visible and fireable from any EDT. Each EDT can independently hide requests and mark per-EDT favorites; a request can also be a global favorite shown in every EDT by default. Hiding never deletes. No folders or tagging in v1.
- The request workbench (stories 6.6–6.9) is built before saving/logs: an extended scanner feeds a pre-filled request editor (JSON tree, session-only per-route filters; hidden lines are still sent), firing requires passing through a request step, and the right pane uses Request/Response sub-tabs (Logs added later) switched with Ctrl+→/← (fallback Ctrl+N/P). Execution order: 6.6 → 6.9, then 6.3, 6.4, 6.5.
- Every action is identically invocable from the TUI and as a standalone CLI subcommand with the shared ok/data-or-error envelope and exit code 0/1 only. The fire → logs → resume loop must stay fast enough not to break coding flow.

## Technical Decisions

- Hexagonal split: generic browse/fire/save mechanics live in core routes logic; only route scanning and dev-auth are pluggable per-repo modules behind scanner and auth ports.
- This backend's module pair is OpenAPI-based scanning plus dev-JWT auth; a differently-stacked repo plugs in its own scanner/auth implementation with no core change. Only the gateway repo activates the module today.
- Module implementations are statically compiled into a registry keyed by manifest module id; manifests only select keys, never load external code. The manifest is a single root YAML file, schema-validated on load.
- Saved requests, per-EDT hide/favorite flags, and global favorites live in a narrowly-scoped global store separate from per-EDT state, so a bug on either side cannot corrupt the other; schema evolves via hand-rolled numbered SQL files with a version table, no migration framework.
- The Routes TUI zone maps 1:1 to the core routes capability (dashboard excepted, read-only aggregate). Stack pins: OpenAPI tooling and JWT library versions fixed by architecture.
- Deferred/open: proving the generic-core split against a second, structurally different stack is out of v1; the canonical route-identity key across scanner implementations is left to the scanner port contract.

## UX & Interaction Patterns

- Routes zone follows the standard resizable list/detail split: route/saved-request list on the left, fired response plus correlated logs together in the detail pane — the clearest single-source-of-truth instance, illustrated by the key-screen mock.
- Named zone states: scan-in-progress spinner, scan-failure vs. empty, fired/response view, distinct auth error, first-fire unlearned-service proposal with checkbox-list adjust-and-save, stale-request flag, save-as-new collision rejection, per-EDT vs. global hide/favorite.
- Purpose-built minimal route list, never a generic Swagger-style schema browser; affected-service editing reuses the checkbox multi-select pattern.
- Zone tab is manifest-gated at two levels: fully omitted when no registered repo activates the module, disabled-with-explanation when the module exists in the registry but not on an active-EDT member. Direct zone mnemonic plus standard list keys, footer hints, and modal confirmations apply uniformly.

## Cross-Story Dependencies

- The scanner port's optional route fields (parameters, request-body example) are neutral data; scanner-specific vocabulary never crosses the port, and scanners that omit them keep working.
- Route discovery is the prerequisite for firing, saving, and log correlation; saving precedes library management.
- Response-plus-logs reuses the aggregated log stream capability — this epic consumes it, not rebuilds it.
- Builds on the foundation epic's manifest/module registry, storage layout, and script-envelope contract; no new cross-epic runtime dependency beyond the log stream.
