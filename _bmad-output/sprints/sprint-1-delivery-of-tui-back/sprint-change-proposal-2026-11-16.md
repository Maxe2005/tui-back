# Sprint Change Proposal — 2026-11-16: Routes tab for daily use (per-EDT favorites, recents, smoke run, key fixes, no `d` on request rows, full-text raw body editor, method colors) + Story 2.45 — switch restarts only services whose checkout really moved

Mode: Batch. Scope: **Moderate** (Epic 6 reorganised: 2 stories removed, 8 added; Epic 2 reopened for one story; 1 FR withdrawn, 1 FR replaced, 2 FRs added, FR-37 clarified; one optional field added to the `edts.yaml` schema; no rollback). Sprint: **sprint-1** (Epics 6 and 2 live there; sprint-2 stays the active sprint, this work is filed against sprint-1).

## 1. Issue Summary

Seven requests from Max, verified against the code on 2026-11-16:

| # | Request | Finding |
|---|---------|---------|
| 1 | Remove Stories 6.4 and 6.5, obsolete. | 6.4 (response + correlated logs in the Routes pane, FR-22) is superseded by the Logs zone (Epic 5); 6.5 (global saved-request library with per-EDT hide / favorite, FR-23) is superseded by route favorites per EDT (below). Both are `backlog`; nothing was built. Story 6.9's `Logs` sub-tab placeholder, Epic 6's goal sentence, FR-22/FR-23 in the PRD and UX-DR23/34 still reference them. |
| 2 | A "favorite routes of the EDT" pane above the routes list; one key adds the selected route to it, whether browsing the list or with a route open. | Nothing exists. Saved requests are global (`global.db`); `EdtRegistryEntry` (`core/ports/edt-registry.ts`, `edts.yaml`, strict zod schema) has no per-EDT routes data. |
| 3 | The save key `s` collides with the shared-types zone mnemonic. | `shouldSwitchZone` (`app-shell.tsx:109`) consumes `s` before the Routes zone whenever the pane is not focused, so the list's `s` (global saved picker, `routes-zone.tsx:1656`, hint `[s] saved`) is **dead**. Inside the right pane `s` still saves (`routes-zone.tsx:1368`, the pane captures input, `app-shell.tsx:359`), but its hints (`footer-contexts.ts:308-329`) share the same letter. Zone mnemonics in use: `d e u l r s`. |
| 4 | It must not be possible to delete a line / parameter in a request (body, Query, Headers); the other uses of `d` stay. | The body editor binds `d` to `delete-entry` (`routes-zone.tsx:795`, `removeEntryAtPath`) and shows `d delete` in its hints. Query and Headers rows have their own `d` (`routes-zone.tsx:1547`); path params already refuse it. Kept as is: `d` on a saved request (Saved tab `:1400`, picker's stale row `:1180`, both behind a confirm) and `d` / `Space` on JsonTree filter rules (`:1483`, `:1604`). |
| 5 | On an EDT switch, only services that change branch must restart. | The filter exists (FR-37, `restartAfterSwitch` → `isChangedSwitchOutcome`) but its input is wrong: `switchMemberRepo` / `switchNonMemberRepo` (`core/edt/switch.ts`) never compare the current branch to the target, so a repo already on the target branch still returns `outcome: 'switched'` and is restarted. `realign` already has the missing `unchanged` outcome; `switch` does not. |

| 6 | The raw body mode (`r`) is too limited: it must be navigable like a full text editor. | The raw editor is a single `TextInputState` (`value` + `cursor`); the only key it adds is `Enter` → `\n` (`routes-zone.tsx:1263-1271`). No vertical movement, no line/word/document jumps, no selection, no undo, no paste handling, no line numbers. |
| 7 | Distinct colors per HTTP method (GET, POST, …) so routes are recognisable in the list. | The method is plain text everywhere; no method tokens in the theme. |

Max also asked to think about what makes the Routes tab easy to use every day for tests and development; the retained ideas are Stories 6.13–6.15 (recents, quick re-fire, smoke run of the favorites), plus 6.16 (full-text raw body editor) and 6.17 (method colors) from Max's follow-up. Deferred on purpose (listed in §5): auth identity per EDT, response curl/copy/diff, rescan diff after a switch, variables chained between requests.

## 2. Impact Analysis

**Epics**
- **Epic 6** (`in-progress`): Stories 6.4 and 6.5 deleted; new Stories 6.10 to 6.17. Epic goal rewritten (no "correlated logs", no global-library management).
- **Epic 2** (`done`): reopened for Story 2.45 (`in-progress` again until merged).
- Epic 5 (Logs) is untouched; it is now the only log surface.

**PRD**
- **FR-22 withdrawn** (superseded by the Logs zone; the affected-service learning is dropped).
- **FR-23 amended**: the saved-request library stays global (already delivered by 6.3 / 6.3b); per-EDT hide, per-EDT / global favorites **of saved requests** are withdrawn.
- **FR-50 added**: favorite routes per EDT, recents, quick re-fire.
- **FR-51 added**: smoke run of an EDT's favorite routes.
- **FR-37 clarified**: "branch changed" means the checkout actually moved or the working tree was touched (stash saved / restored, discard, adoption).
- SM-5 and UX-DR23 / UX-DR34 wording updated; the journey in §2 (route explorer climax) no longer promises logs in the same view.

**Architecture**: no new AD. AD-1/AD-2 apply to the new use-cases (core, in-process); the `edts.yaml` entry gets an optional `favoriteRoutes` field (registry stays strict; an absent field means none, no migration).

**UX**: Routes zone: a Favorites (and Recent) pane above the list, key changes, body editor without delete. Switch result list shows an `unchanged` row. Details in §4.

**Code and docs (indicative)**
- `core/ports/edt-registry.ts` + `adapters/driven/edt-registry/schema.ts`: `favoriteRoutes?: { repoPath, method, path }[]`; `update()` patch gains it. New `core/routes/favorites.ts` (toggle / list / prune), `core/routes/smoke-run.ts`.
- `adapters/driving/cli`: `routes favorites list|add|remove`, `routes smoke` (CLI parity, FR-1; MCP exposes them automatically, Epic 11).
- TUI: `zones/routes/routes-zone.tsx` (the file is large; new pane in its own `routes-favorites-pane.tsx` + `.logic.ts`, per Epic 12 conventions), `keybindings/footer-contexts.ts`, `store/slices/routes-slice.ts`.
- `core/edt/switch.ts`, `core/edt/switch-restart.ts`, `switch-dialog.tsx`, `switch-resolution.logic.ts:546`, `activate.ts` (outcome union), CLI script envelope and MCP schema (additive `unchanged`).
- Docs: README / AGENTS.md key tables if they list the Routes keys. `docs/tui-back-manifest.md` and the manifest-generator skill are **not** affected (no manifest surface change).

## 3. Recommended Approach

**Direct Adjustment** within the existing plan. No rollback, no MVP change. Effort: Medium (Epic 6 stories are small and sequential; 2.45 is small but crosses core, CLI, TUI and the MCP schema). Risk: low to medium. The two real risks: (a) the smoke run can fire mutating requests, so it is read-only by default (6.14); (b) the favorites pane adds a second focus area to a zone that already has list / pane / sub-editors, so focus rules are spelled out in 6.12.

Order: 6.10 → 6.17 (colors, tiny) → 6.11 → 6.12 → 6.13 → 6.14 → 6.15 (6.14 only needs 6.11); 6.16 (raw editor) is independent after 6.10; 2.45 is independent and can run in parallel.

Assumptions made (flag if wrong):
1. Favorites are keyed by `repoPath + method + path` and the pane shows the favorites of the **repo currently displayed** in the Routes zone (the zone shows one repo at a time); a cross-repo EDT-wide view is not built.
2. "No deleting a line / parameter" targets the editors of the request (body tree, Query and Headers rows). The raw text mode (Story 6.16) is a real text editor, so it can of course remove text; it is the deliberate escape hatch and the previous valid body is preserved on invalid JSON. Query / Headers rows can still be added (`a`) and emptied by editing their value, but not removed.
3. Method colors are theme tokens used wherever a route is listed (list, Favorites / Recent panes, smoke table, Request tab header); the method text stays printed, so color is never the only signal.
4. Recents are session-only (like the per-route drafts and responses); favorites persist.

## 4. Detailed Change Proposals

### 4.1 Stories — Epic 6

**Story 6.4 — See Response and Relevant Logs Together**: DELETE the whole section (`epics.md`, Epic 6). Rationale: superseded by the Logs zone (Epic 5).
**Story 6.5 — Manage the Saved-Request Library Across EDTs**: DELETE the whole section. Rationale: superseded by route favorites per EDT (6.11, 6.12).

Epic 6 header, OLD → NEW:
- OLD: "A developer can discover a repo's routes, fire a request with automatic dev-mode auth, save/customize/re-fire requests in a global library, and see the response and correlated logs together."
- NEW: "A developer can discover a repo's routes, fire a request with automatic dev-mode auth, save/customize/re-fire requests in a global library, keep the EDT's favorite routes at hand, and re-fire or smoke-run them quickly. Logs are read in the Logs zone (Epic 5)."
- Coverage lines: `FRs covered: FR-19, FR-20, FR-21, FR-23 (amended), FR-50, FR-51` (FR-22 withdrawn).

**Story 6.9** (Routes Right Pane), AC "…a third **Logs** tab is displayed only once Story 6.4 provides it (the tab model supports it)" → "The tab strip shows the active tab; the tab model stays extensible, no Logs tab is planned (logs are read in the Logs zone)." Add an amendment note dated 2026-11-16.

**New Story 6.10: Routes Keys Free of Zone Mnemonics & No `d` on Request Editors**

As a developer, I want the Routes shortcuts to work wherever I am and the request to keep its shape, so that no key is silently swallowed by another zone and I cannot delete a field, header or query row by accident.

Acceptance Criteria:
- **Given** the Routes list has the focus **When** `p` is pressed **Then** the global saved-request picker opens (it was `s`, dead because `s` switches to the shared-types zone); `s` on the list keeps switching zone.
- **Given** the right pane's Request tab **When** `w` is pressed **Then** the save-name prompt opens (it was `s`); `s` is no longer bound in the pane.
- **Given** the Routes footer and `?` help **When** rendered **Then** they show `p picker` / `w save` and no Routes context mentions `s` for saving or picking (`footer-contexts.ts`: `routes-list`, `routes-list-editable`, `routes-section`, `routes-rows-readonly`, `routes-rows`, `routes-rows-empty`).
- **Given** the body tree editor **When** `d` / `D` is pressed on any line **Then** nothing happens and the body hints no longer show `d delete`; `a` (add), value edit, `t` (change type) and `r` (raw mode) keep working.
- **Given** the Query and Headers sections **When** `d` / `D` is pressed on a row **Then** nothing happens and the `d delete` hint is gone from `routes-rows`; `a` still adds a row and editing a value (including emptying it) still works; path params still cannot be removed.
- **Given** the other uses of `d` **Then** they are unchanged: `d` on a Saved-tab row (with its confirm), `d` on a stale row of the picker, `d` / `Space` on a JsonTree filter rule.

Implementation notes: remove the `delete-entry` action from the body editor key map and `routes-zone.tsx` (plus `remapErrorsForDelete` if it becomes unused) and the Query/Headers branch at `:1547` (`removeRequestRow` if unreferenced); delete the pure `removeEntry` / `removeEntryAtPath` and their tests when nothing references them (AD-17: no dead code). Update the interaction tests that press `s` or `d`; add assertions that `d` leaves body, Query and Headers unchanged.

**New Story 6.11: Favorite Routes per EDT — Persistence, Use-Cases & CLI**

As a developer, I want each EDT to remember its favorite routes, so that the routes I test for this task are one keypress away and do not follow me into other EDTs.

Acceptance Criteria:
- **Given** an EDT **When** a route is marked favorite **Then** `edts.yaml` stores it on that EDT's entry as `favoriteRoutes: [{ repoPath, method, path }]` (method upper-cased, path in template form as discovered); marking it again is a no-op (toggle off removes it); no duplicates.
- **Given** an `edts.yaml` written before this story **When** loaded **Then** it validates unchanged (field optional) and an EDT without it has no favorites.
- **Given** another EDT is active **When** favorites are read **Then** only that EDT's favorites are returned; deleting an EDT removes its favorites with its entry.
- **Given** a favorite whose route a rescan no longer discovers **When** favorites are listed **Then** it is returned flagged `stale` (never silently dropped, never fired silently); the developer can remove it.
- **Given** the CLI **When** `tui-back routes favorites list|add|remove` is run (`--edt <topic>` defaulting to the active EDT, `--repo`, `--method`, `--path`) **Then** it uses the same core use-cases and the AD-3 envelope (FR-1 parity); an unknown EDT or an invalid method is rejected before anything is written.

Implementation notes: `EdtRegistryPort.update` patch gains `favoriteRoutes`; use-cases in `core/routes/favorites.ts` (`toggleFavoriteRoute`, `listFavoriteRoutes` with stale flag from the cached scan). Writes go through the registry's existing per-resource lock (AD-9).

**New Story 6.12: Favorites Pane Above the Routes List & Add-to-Favorites Key**

As a developer, I want a "Favorites of this EDT" pane above the routes list and a key that favorites the route I am on, so that I reach my usual routes without searching.

Acceptance Criteria:
- **Given** the Routes zone **When** it renders **Then** a **Favorites** pane sits above the list (bounded, scrollable, AD-19) showing `METHOD path` and the summary; it shows a teaching line when empty ("press `*` on a route to add it") and is hidden-height-aware on small terminals (the list always keeps a minimum height).
- **Given** the list has the focus **When** `*` is pressed on a route **Then** that route is toggled in the active EDT's favorites and the pane updates immediately.
- **Given** a route is open (focus in the right pane, any tab, not inside an inline text editor) **When** `*` is pressed **Then** the open route is toggled the same way; inside an inline editor (a field, the name prompt, the filter) the key types `*` normally.
- **Given** the list has the focus **When** `Tab` / `Shift+Tab` is pressed **Then** the focus moves between the list and the Favorites pane; in the pane arrows / `j` / `k` move and `Enter` selects that route in the list and opens the right pane on **Request** (same mandatory request step as 6.9, never fires directly); `*` or `d` on a favorite removes it; `Esc` returns to the list.
- **Given** a stale favorite **When** rendered **Then** it is dim with a `stale` suffix, `Enter` on it is refused with a message, and it can be removed.
- **Given** the active EDT changes **When** the zone re-renders **Then** the pane shows the new EDT's favorites; a favorite whose repo is not the displayed repo is not listed (assumption 1).
- **Given** the footer and `?` help **When** the focus is in the list, the pane or the right pane **Then** they show `* favorite` and the pane's own keys, declared in `footer-contexts.ts` (UX-DR7).

Implementation notes: new `zones/routes/routes-favorites-pane.tsx` + `routes-favorites.logic.ts` (pure focus / cursor logic, unit-tested); the zone only wires it; the store slice gains `favoriteRoutes` + `toggleFavoriteRoute` calling the 6.11 use-case. Touch `routes-zone.tsx` minimally (it is on Epic 12's list of large files).

**New Story 6.13: Recent Routes & Quick Re-Fire**

As a developer iterating on a route, I want to see the routes I just fired and re-fire the last request in one keypress, so that edit-code → fire → read becomes a tight loop.

Acceptance Criteria:
- **Given** requests were fired this session **When** the Favorites pane renders **Then** a **Recent** section below the favorites lists the last 10 distinct fired routes of the displayed repo (most recent first) with the last status code and duration; it is session-only and empty-hidden.
- **Given** the list, the Favorites pane or a Recent row has the focus **When** `Ctrl+R` is pressed **Then** the selected route's current draft is re-fired (same `fireRequest` core path, same required-parameter and auth rules as 6.9); the pane switches to **Response**; a route never fired or with missing required params opens **Request** with the missing names listed instead, nothing sent.
- **Given** the Response tab **When** `Ctrl+R` is pressed **Then** the same draft is re-fired in place (already the case for Request; the Response tab gains it).
- **Given** Enter on a Recent row **Then** it behaves like Enter on a favorite (opens Request, never fires).

**New Story 6.14: Smoke Run of the EDT's Favorite Routes — Core & CLI**

As a developer, I want to fire all my favorite routes at once and see a status table, so that after a switch or a restart I know in one gesture what is up.

Acceptance Criteria:
- **Given** an EDT with favorites **When** the smoke run starts **Then** each non-stale favorite of the repo is fired sequentially (bounded concurrency from `update.concurrency`, never two on the same repo at once) through the existing `fireRequest` core path with its current draft, or its default draft (path params from `example`, 6.6 `bodyExample`).
- **Given** a favorite with a mutating method (`POST`, `PUT`, `PATCH`, `DELETE`) **When** the smoke run is not explicitly allowed to include them **Then** it is reported `skipped (mutating)` and never sent; `--include-mutating` (CLI) or a confirmation listing the exact routes (TUI, 6.15) is required to fire them.
- **Given** a favorite with unfilled required path parameters or a stale route **Then** it is `skipped` with its reason (`missing params: id`, `stale`), never `failed`.
- **Given** a result **When** reported **Then** each row has status code, duration, size and a closed outcome `ok` (2xx) / `client-error` / `server-error` / `auth-error` (distinct, as in 6.2) / `network-error` / `skipped`; the run never rejects; one failure never stops the others.
- **Given** the CLI `tui-back routes smoke [--edt] [--repo] [--include-mutating]` **When** run **Then** rows are emitted in the AD-3 envelope and the exit code is non-zero if any fired row is not `ok`.

**New Story 6.15: Smoke Run in the Routes Zone**

As a developer, I want to run the smoke test from the Favorites pane and read the table in place, so that I do not leave the TUI to check my routes.

Acceptance Criteria:
- **Given** the Favorites pane has favorites **When** `t` is pressed (verified free in the zone at implementation; otherwise the next free letter, recorded in the spec) **Then** the smoke run starts; rows update live (`pending → firing → outcome`) with glyph **and** colour (never colour alone), the table is bounded (AD-19), the TUI stays responsive and the developer may leave the zone.
- **Given** mutating favorites exist **When** the run is started **Then** a confirm dialog lists them by `METHOD path`; confirming includes them, declining runs the safe ones only.
- **Given** a result row **When** `Enter` is pressed **Then** the route opens in the right pane on **Response** with that fire's response kept as the route's last response.
- **Given** a run in flight **When** the developer starts another smoke run **Then** it is rejected with a clear message; `Esc` cancels pending (not yet fired) rows.
- **Given** the summary line **When** the run ends **Then** it counts ok / client-error / server-error / auth-error / network-error / skipped.

**New Story 6.16: Raw Body Mode as a Full Multi-Line Text Editor**

> Amends Story 6.8's raw-text mode (`r`).

As a developer, I want the raw body mode to behave like a real text editor, so that I can navigate, select, paste and fix a JSON payload without fighting the cursor.

Acceptance Criteria:
- **Given** raw mode opened with `r` **When** it renders **Then** the buffer is shown as numbered lines, windowed to the pane height (AD-19), with a visible cursor and the line/column in the status; long lines scroll horizontally or wrap consistently (decided in the spec, covered by tests).
- **Given** the cursor **When** `←/→/↑/↓`, `Home`/`End` (line), `Ctrl+Home`/`Ctrl+End` (document), `PgUp`/`PgDn` and `Ctrl+←`/`Ctrl+→` (word) are pressed **Then** it moves as in a standard editor, keeping the desired column across shorter lines and scrolling the window to follow it.
- **Given** `Shift` + a movement key **When** pressed **Then** a selection extends and is rendered; typing, `Backspace` or `Delete` replaces or removes it; `Ctrl+A` selects all.
- **Given** editing keys **When** pressed **Then** `Enter` splits the line and keeps the current indentation (one more level after `{` or `[`), `Tab` inserts two spaces, `Backspace`/`Delete` join lines at their ends, and `Ctrl+K` removes from the cursor to the end of the line.
- **Given** a multi-line paste into the terminal **When** received **Then** it is inserted at the cursor as one edit (bracketed paste when the terminal supports it), including large payloads, without being interpreted as key presses.
- **Given** `Ctrl+Z` / `Ctrl+Y` **When** pressed **Then** the last edits are undone / redone (bounded history).
- **Given** a format key (a free key, shown in the footer; chosen and verified at implementation) **When** pressed on valid JSON **Then** the buffer is pretty-printed with two-space indentation; on invalid JSON it is refused with the parse error.
- **Given** leaving raw mode **When** the buffer is invalid JSON **Then** the developer stays in raw mode, the error (with line/column) is shown, and the cursor jumps to the error position; the previous valid body is preserved. A valid buffer replaces the body, as today (6.8).
- **Given** the footer and `?` help **When** raw mode is active **Then** the raw-mode keys are declared in `footer-contexts.ts` (UX-DR7); no raw-mode key collides with the tab navigation (`Ctrl+→`/`Ctrl+←` are word movement **only** inside the raw editor, which owns input there; leaving it restores the tab keys).

Implementation notes: a pure, fully unit-tested multi-line buffer model in `shared/text-edit` (lines, cursor, selection, undo stack, word / page / document movement, indent rules, paste insert); `JsonRawEditor` renders it and `routes-zone.tsx` only forwards keys (no new logic in the large zone file). `TextInputState` and the single-line `TextInputLine` stay untouched for the other inputs. Check Ink's key mapping for `Ctrl+Home` / `Ctrl+End` / `Shift+arrows` / `PgUp` / `PgDn` and bracketed paste before fixing the key table; any key the terminal cannot report gets a documented fallback.

**New Story 6.17: HTTP Method Colors**

As a developer scanning the routes list, I want each method in its own color, so that I recognise GET, POST, PUT, PATCH and DELETE at a glance.

Acceptance Criteria:
- **Given** the theme module **When** extended **Then** it exposes one token per method (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`, plus a neutral fallback for `HEAD`/`OPTIONS`/others), defined for the supported color depths and checked by the theme's existing contrast / palette tests.
- **Given** the Routes list, the Favorites and Recent panes (6.12, 6.13), the Saved tab and picker rows, the smoke-run table (6.15) and the Request tab header **When** a route is rendered **Then** its method text is drawn in its method color; the method is always printed as text, so color is never the only signal (works with `NO_COLOR` / monochrome).
- **Given** a selected or stale (dim) row **When** rendered **Then** selection and stale styling still read correctly (the method color is kept for selection; a stale row is dimmed whole).
- **Given** an unknown method **Then** the fallback color is used, never an error.

Implementation notes: a single `methodColor(method)` helper in `shared/theme` used by every surface; no per-zone color literals.

### 4.2 Story — Epic 2

**New Story 2.45: EDT Switch — Restart Only the Services Whose Checkout Actually Moved**

> Amends FR-37 (Story 2.44's rule "targets are the services whose branch changed in this switch" was never true for a repo already on the target branch).

As a developer, I want a switch to restart only the services that really changed branch, so that I do not restart every container for nothing.

Acceptance Criteria:
- **Given** a switch **When** a repo is already on the branch the switch would check out **and** nothing was stashed, restored, discarded or adopted for it **Then** its result row is `unchanged` (new outcome, detail "already on `<branch>`"), no checkout is run, and it is **not** a restart target (`skipped (unchanged)` in the restart report).
- **Given** a repo already on the target branch **When** its dirty work is stashed, a target-tagged stash is restored, uncommitted paths are discarded, or work is adopted **Then** the working tree changed: its row keeps `switched` / `adopted` / `discarded` and it is a restart target.
- **Given** a repo whose branch differs from the target **When** switched **Then** behaviour is exactly today's (`switched`, restart target, `no container` skipped as before).
- **Given** the TUI switch dialog, the EDT-creation wizard Step 4 and the quick-pick **When** they show results **Then** an `unchanged` row is rendered dim like `switched` and never counts as needing attention (`switch-resolution.logic.ts:546` stays correct: `unchanged` is not a failure).
- **Given** the CLI `edt switch` and the MCP tool **When** they emit the envelope **Then** `unchanged` is an additive value of the row outcome (documented in the output schema); existing values are unchanged; the restart rows' `unchanged` skip reason is already supported.
- **Given** the switch sequence **Then** FR-37's consequence text is satisfied literally: only services whose branch changed in the switch and that declare a container are restarted.

Implementation notes: in `switchMemberRepo` / `switchNonMemberRepo`, compare `git.currentBranch` (already read during classification, `switch.ts:480`) with the resolved target; if equal and the dirty plan is `none` and no target stash exists (`hasStash` is already a non-destructive existence check, `GitPort`), return `unchanged` before `checkoutExpectedBranch`. Verify `restoreStash` reports whether it actually restored (today `Result<void>`); extend the result if not. `CHANGED_OUTCOMES` stays `switched|adopted|discarded`. Tests: same-branch repo not restarted; same-branch with stash restore restarted; mixed switch (3 repos: 1 moved, 1 already there, 1 no container); CLI and MCP envelope.

### 4.3 PRD

- **FR-22**: replace the body with "Withdrawn 2026-11-16 (Sprint Change Proposal): logs are read in the Logs zone (FR-16, FR-17, FR-49); a fired request no longer opens correlated logs, and no affected-service set is learned per route." Keep the number (no renumbering).
- **FR-23**, OLD: "…Each EDT can independently hide individual saved requests from its own view … and mark others as favorites …; a request can also be marked a global favorite…" → NEW: "A developer's saved requests (FR-21) form one global library, not siloed per EDT — a request saved while working in one EDT is discoverable and fireable from any other EDT too. (Per-EDT hide and per-EDT / global favorites of saved requests withdrawn 2026-11-16; favoriting is done on routes, FR-50.)" Consequences lines about hide / favorite / "only means of managing clutter" are removed.
- **FR-37** consequence 1 gains: "A service already on the target branch, with nothing stashed, restored, discarded or adopted, is reported `unchanged` and is not restarted." (Story 2.45)
- **FR-50 (added 2026-11-16)**: "Each EDT keeps its own favorite routes (repo, method, path), shown in a pane above the routes list; one key adds or removes the selected or open route; the last fired routes of the session are listed with their status, and the last request can be re-fired in one keypress."
- **FR-51 (added 2026-11-16)**: "The favorite routes of an EDT can be fired together (smoke run) and reported as a status table; mutating requests are never sent unless explicitly included."
- **SM-5** and the §2 journey climax: drop "relevant logs", read "fire a saved or favorite route request, read the response, get back to coding" and "Validates FR-20, FR-21, FR-50".
- **UX-DR23 / UX-DR34**: remove "fired/response view with correlated logs", "unlearned-affected-service-set flow" and "library hide/favorite behavior (per-EDT vs. global)"; add the Favorites/Recent pane, the smoke-run table, per-method colors, the full-text raw body editor and the key map (`*` favorite, `w` save, `p` picker, `t` smoke run, `Ctrl+R` re-fire; no `d` on request editors); "Logs added by Story 6.4" removed.

### 4.4 `epics.md` requirements and coverage map

- Requirements list: FR-22 marked withdrawn; FR-23 reworded; FR-50 and FR-51 added; FR-37 gains the clarification.
- Coverage map: `FR-22: withdrawn (2026-11-16)`; `FR-23: Epic 6 - saved-request library is global (Stories 6.3, 6.3b); hide/favorite of saved requests withdrawn`; `FR-50: Epic 6 - Stories 6.11 to 6.13`; `FR-20/FR-21 (UX): Stories 6.10, 6.16, 6.17`; `FR-51: Epic 6 - Stories 6.14, 6.15`; `FR-37: Epic 2 - … (clarified 2026-11-16 — Story 2.45)`.

### 4.5 `sprint-status.yaml` (sprint-1)

```
epic-2: done        →  epic-2: in-progress
+ 2-45-edt-switch-restart-only-services-whose-checkout-moved: backlog
6-4-see-response-and-relevant-logs-together: backlog                    →  (removed)
6-5-manage-the-saved-request-library-across-edts: backlog               →  (removed)
+ 6-10-routes-keys-free-of-zone-mnemonics-and-no-d-on-request-editors: backlog
+ 6-11-favorite-routes-per-edt-persistence-use-cases-and-cli: backlog
+ 6-12-favorites-pane-above-the-routes-list-and-add-to-favorites-key: backlog
+ 6-13-recent-routes-and-quick-re-fire: backlog
+ 6-14-smoke-run-of-the-edts-favorite-routes-core-and-cli: backlog
+ 6-15-smoke-run-in-the-routes-zone: backlog
+ 6-16-raw-body-mode-as-a-full-multi-line-text-editor: backlog
+ 6-17-http-method-colors: backlog
```
`epic-2-retrospective` / `epic-6-retrospective` stay `optional`.

## 5. Implementation Handoff

**Scope: Moderate.** Product Owner / Developer: backlog reorganisation (the edits in §4 to `epics.md`, the PRD and `sprint-status.yaml`), then Developer agent per story with `bmad-build`.

Branches (CLAUDE.md): Epic 6 stories on `story-6-N-…` branches off `epic-6-route-explorer`; Story 2.45 on `story-2-45-…` off `epic-2-edt-workspace-management`. Both epic branches already exist and are merged; they are reopened, not recreated. Merge each story with `--no-ff` into its epic branch; the epic branches go back to `devlopment` by pull request (or `/worktree-merge`) once Epic 6 and the Story 2.45 are closed.

Success criteria: `s` never swallowed in Routes; `d` inert on body, Query and Headers; raw mode navigable like a text editor; methods recognisable by color; favorites survive restart and stay per EDT; smoke run never sends a mutating request unasked; a switch restarts exactly the services whose checkout or working tree changed.

Deferred ideas (not in this proposal, revisit after 6.15): auth identity (user / roles of the dev JWT) per EDT; response copy-as-curl, copy body, diff against the previous response; rescan diff after a switch ("3 new routes"); variables extracted from a response and reused in the next request.
