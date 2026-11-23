# Epic 6 Context: Route Explorer

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A developer can discover a repo's routes, fire a request with automatic dev-mode auth, save/customize/re-fire requests in a global library, keep the active EDT's favorite routes at hand, and re-fire or smoke-run them quickly. This replaces the cluttered generated Swagger UI and keeps the edit-code, fire, read loop fast. Logs are read in the Logs zone (Epic 5), not in Routes. The epic was amended on 2026-11-16: the response-plus-logs and library-management stories were removed, and the favorites, recent, smoke-run, raw-editor and method-color stories were added.

## Stories

- Story 6.1: Route Discovery via a Pluggable Scanner Module
- Story 6.2: Fire a Request with Automatic Dev-Mode Auth
- Story 6.3: Save, Customize, and Re-Fire a Request
- Story 6.6: Scanner Extension — Parameters & Request-Body Skeletons
- Story 6.7: JsonTree Component — Read-Only Navigation, Collapse & Session Filters
- Story 6.8: JsonTree Edit Mode — Request Body Editing
- Story 6.9: Routes Right Pane — Mandatory Request Step & Request/Response Sub-Tabs
- Story 6.10: Routes Keys Free of Zone Mnemonics & No `d` on Request Editors
- Story 6.11: Favorite Routes per EDT — Persistence, Use-Cases & CLI
- Story 6.12: Favorites Pane Above the Routes List & Add-to-Favorites Key
- Story 6.13: Recent Routes & Quick Re-Fire
- Story 6.14: Smoke Run of the EDT's Favorite Routes — Core & CLI
- Story 6.15: Smoke Run in the Routes Zone
- Story 6.16: Raw Body Mode as a Full Multi-Line Text Editor
- Story 6.17: HTTP Method Colors

(Stories 6.4 and 6.5 were removed; the numbers are not reused.)

## Requirements & Constraints

- Route exploration is available only on repos whose manifest activates it. Adding it to a new repo is manifest-only, never a core change.
- A failed scan and a genuinely empty route list are visibly distinct states.
- Firing never requires manual token handling. Auth is automatic per session, expired dev tokens refresh silently, and a permission mismatch surfaces as a distinct auth error, not a generic failure.
- Ad-hoc customize-then-fire works without saving. Saving captures method, path, body and headers. Re-firing a saved request allows edits, then a per-fire choice of overwrite or save-as-new. A name collision is rejected with a prompt for another name.
- A saved or favorite route that a rescan no longer discovers is flagged stale. It is never dropped or fired silently, and the developer can remove it.
- Saved requests form one global library, usable from any EDT.
- Favorites are per EDT, stored on the EDT entry as `favoriteRoutes: [{ repoPath, method, path }]`. Method is upper-cased, path stays in discovered template form, toggling is idempotent with no duplicates, and the field is optional so older `edts.yaml` files stay valid. Deleting an EDT deletes its favorites.
- Recent routes are session-only: the last 10 distinct fired routes of the displayed repo, with last status and duration.
- Smoke run:
  - It fires non-stale favorites sequentially through the existing `fireRequest` path. Concurrency is bounded by `update.concurrency`, and never two requests at once on the same repo.
  - Mutating methods (POST/PUT/PATCH/DELETE) are skipped unless explicitly included (`--include-mutating`, or a TUI confirm listing the exact routes).
  - Unfilled required params or stale routes are `skipped` with a reason, never `failed`.
  - The closed outcome set is ok / client-error / server-error / auth-error / network-error / skipped.
  - The run never rejects, and one failure never stops the others.
  - The CLI exit code is non-zero if any fired row is not ok.
- Every action is available from both the TUI and the CLI, with the shared AD-3 envelope and exit code 0/1 (FR-1 parity). The CLI commands are `tui-back routes favorites list|add|remove` and `tui-back routes smoke`. An unknown EDT or invalid method is rejected before anything is written.
- The request workbench: the scanner feeds a pre-filled request editor (JSON tree with session-only per-route filters; hidden lines are still sent). Firing always passes through a Request step. The right pane has Request/Response sub-tabs switched with Ctrl+→/←.
- Body editing:
  - The body tree editor and the Query/Headers rows have no delete: `d`/`D` is a no-op there (add, edit, change type and raw mode remain). Path params cannot be removed.
  - Raw mode (`r`) is a full multi-line editor:
    - navigation and Shift-selection, indent-aware Enter, undo/redo, bracketed paste, a format key, and a visible line/column.
    - leaving it with invalid JSON keeps the user in the editor at the error position and preserves the previous valid body.
- Method colors:
  - Every method (GET, POST, PUT, PATCH, DELETE, plus a neutral fallback) has a color via a single `methodColor(method)` helper in `shared/theme`.
  - The method is always printed as text, so it works under `NO_COLOR`.
  - No per-zone color literals.
  - Stale rows are dimmed whole.

## Technical Decisions

- Hexagonal split: generic browse/fire/save/favorites/smoke mechanics live in core routes logic. Only route scanning and dev-auth are pluggable per-repo modules behind ports. This backend's pair is OpenAPI scanning plus dev-JWT auth (`jose`).
- Modules are statically compiled into a registry keyed by manifest module id. Manifests only select keys.
- Saved requests live in `global.db` (AD-7), a narrow store separate from per-EDT state. Schema evolves via numbered SQL files with a version table. Favorites live in `edts.yaml` (the EDT registry).
- `EdtRegistryPort.update` patch gains `favoriteRoutes`. Favorite use-cases are in `core/routes/favorites.ts` (`toggleFavoriteRoute`, `listFavoriteRoutes` with a stale flag from the cached scan). Writes use the registry's per-resource lock (AD-9).
- Scanner port optional fields (parameters, `bodyExample`, path-param `example`) are neutral data. Scanners that omit them keep working.
- Pane and list rendering is bounded and scrollable (AD-19). There is no dead code (AD-17): remove `delete-entry`, `removeEntry`/`removeEntryAtPath` and `removeRequestRow` when unreferenced.
- `routes-zone.tsx` is a large file on Epic 12's refactor list. Touch it minimally and put new logic in separate modules:
  - `zones/routes/routes-favorites-pane.tsx` and `routes-favorites.logic.ts` (pure focus/cursor logic)
  - a pure multi-line buffer model in `shared/text-edit` (the single-line `TextInputState` and `TextInputLine` stay untouched)
  - `JsonRawEditor` rendering the buffer model
- Footer and `?` help keys are declared in `footer-contexts.ts` (UX-DR7).

## UX & Interaction Patterns

- The Routes zone is a resizable list/detail split with a purpose-built minimal route list, not a Swagger-style browser.
- Named states: scan-in-progress, scan-failure vs. empty, auth error, stale flag, name-collision rejection.
- Key map:
  - Zone mnemonics must not shadow Routes keys: `p` opens the saved-request picker from the list, `w` saves from the Request tab, and `s` keeps switching zone.
  - `*` toggles favorite on the list or on an open route, and types normally inside inline editors.
  - Tab/Shift+Tab moves focus between the list and the Favorites pane.
  - Enter on a favorite or Recent row opens Request and never fires. A stale favorite refuses Enter with a message.
  - `d`/`*` removes a favorite, and Esc returns to the list.
  - `Ctrl+R` re-fires the selected draft and switches to Response. With missing required params, it opens Request listing them instead.
  - `t` starts the smoke run, or the next free letter, recorded in the spec.
- The Favorites pane sits above the list, shows `METHOD path` plus summary, and has a teaching line when empty. The Recent section sits below it, hidden when empty. The list always keeps a minimum height on small terminals.
- Smoke table:
  - Rows update live (`pending → firing → outcome`) with a glyph and a color.
  - The summary line counts each outcome.
  - A confirm dialog lists mutating routes.
  - Enter on a row opens Response with that fire's response kept.
  - A second concurrent run is rejected, and Esc cancels the rows not yet fired.
- Raw editor:
  - Ctrl+←/→ means word movement only inside the raw editor, and tab keys are restored on leaving.
  - Other raw keys: Tab inserts two spaces, Ctrl+K deletes to end of line, Ctrl+A selects all, Ctrl+Z/Y undo/redo.

## Cross-Story Dependencies

- 6.1 (discovery) precedes 6.2 (fire) and 6.3 (save). 6.6 (scanner params and body skeletons) feeds 6.7 and 6.8 (JsonTree read-only, then edit), and 6.9 builds the Request/Response pane on them.
- 6.10 changes the keys of 6.3, 6.8 and 6.9. 6.16 amends 6.8's raw mode.
- 6.11 (persistence and CLI) precedes 6.12 (pane), 6.13 (recent and Ctrl+R) and 6.14 (smoke core). 6.14 precedes 6.15 (smoke UI), which reuses the 6.12 pane.
- 6.17 colors surfaces from 6.12, 6.13 and 6.15, and the list, Saved tab, picker and Request header.
- Builds on Epic 1's manifest/module registry, storage layout and envelope contract. Logs are read in Epic 5's Logs zone, with no runtime dependency from Routes.
