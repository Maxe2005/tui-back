---
title: 'Save, Customize, and Re-Fire a Request'
type: 'feature'
created: '2026-10-06'
status: 'done'
review_loop_iteration: 0
baseline_commit: '422be0eecdbb1d4b39c59b8b572bc51fdee056d6'
context:
  - '/home/mchoisel/Documents/IANORD/tui-back-epic-6/_bmad-output/implementation-artifacts/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every fired request evaporates — 6.9 keeps drafts and responses in session-only per-route maps, so a realistic example cannot survive a restart or travel across EDTs.

**Approach:** Add a global saved-request library in `global.db` behind a `SavedRequestPort`; the Request tab saves its draft via `s` plus an inline name prompt (overwrite vs. save-as-new chosen per fire), a `FilterablePickList` picker reloads saved requests, and the CLI mirrors everything with flags plus `request-*` subcommands.

## Boundaries & Constraints

**Always:**
- `core/` never imports `adapters/` (AD-1); every use-case returns `Result<T>` with kebab-case `error.code` (AD-3); imports first, relative imports end in `.js`.
- `global.db` lives at `<dataDir>/global.db` (same XDG resolution as other stores), hand-rolled numbered SQL (`001.sql`) with a `schema_version` table, `CREATE TABLE IF NOT EXISTS` on open — no migration framework (AD-7). `001.sql` carries only `saved_requests`; hide/favorite columns arrive with 6.5's own `002.sql`.
- `SavedRequest{id ULID, name (unique, exact match), repoPath, method, path (template form), query, headers, bodyText?, contentType?, treeState?, createdAt, updatedAt}` (ISO 8601 dates). The session cookie is never persisted — auth stays out of the library. Empty query/header values are dropped and body sent only when defined (6.9 rules).
- Stale is advisory and computed at list time per repo via a fresh scan (exact-or-template match, the 6.9 rule). The hard gate stays at fire time: `fireRequest`'s route-exists check rejects a vanished route with `unknown-route`, so a stale request is never fired silently even if the list scan failed.
- TUI: Request tab `s` opens an inline name prompt (`TextInputLine`, prefilled with the origin name when the draft came from a saved request). `Enter` on a fresh name saves; on a colliding name it shows an inline collision error and `Ctrl+O` overwrites through a `modal-dialog` confirm (destructive per UX-DR36). List `s` opens the saved picker (`FilterablePickList`): `Enter` loads draft + body + tree state into the Request tab and focuses the pane; stale rows render dim with a `stale` suffix and cannot be loaded; `d` on a stale row deletes through a `modal-dialog` confirm. While any inline input is open it owns every key (6.9 rule); footer hints show only bound keys (UX-DR7).
- Slice: a `draftOrigins: Record<routeKey, savedId>` map (same 50-entry LRU prune as the other per-route maps) tracks which saved request a draft came from; loading seeds `requestDraft`, the `#body` draft and `jsonTreeStates` from the saved record. Same-repo reload keeps origins; another repo drops them with the other maps.
- CLI: `fire-request` gains `--save <name>` (duplicate → `duplicate-request-name`, exit 1); `request-list [--repo <path>]` shows stale flags; `request-fire <name> [--body/--query/--header overrides] [--overwrite | --save-as <new>]` (collision on `--save-as` → `duplicate-request-name`); `request-delete <name>`; unknown name → `saved-request-not-found`. Both `main.ts` and `tui.ts` inject the store dep exactly like `scanner`/`auth`.

**Ask First:** A live dev-gateway `baseUrl` for a manual end-to-end fire check; any change to the `global.db` location.

**Never:** No hide/favorite reads or writes (6.5 owns them, schema included); no folders or tagging; no Logs tab (6.4); no new runtime dependency (`better-sqlite3` is already pinned); no wholesale persistence of drafts/responses — only explicit saves.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Save new | Request draft, `s`, fresh name, `Enter` | saved, prompt closes, hint confirms | N/A |
| Ad-hoc fire | `Ctrl+R` without saving | fires exactly as in 6.9 | N/A |
| Re-fire + overwrite | saved-derived draft edited, `s`, `Ctrl+O`, confirm | original updated (`updatedAt` bumped) | Modal cancel aborts |
| Re-fire + save-as-new | same, fresh name | new record, original untouched | N/A |
| Collision | existing name, `Enter` | inline `"<name>" is already used — [ctrl+o] overwrite`, stays in prompt | No save |
| Stale list | rescan dropped the route | row dimmed + `stale` suffix | Never auto-deleted |
| Stale delete | `d` on stale row, confirm | record removed | Modal cancel aborts |
| Stale fire (CLI) | `request-fire` on stale name | `unknown-route`, nothing sent | Exit 1 |
| Unknown name | `request-fire`/`request-delete` on missing name | `saved-request-not-found` | Exit 1 |
| Cookie hygiene | save any request | stored record contains no `Cookie`/`Set-Cookie` material | N/A |

</frozen-after-approval>

## Code Map

- `src/core/ports/saved-request.ts` (new) -- `SavedRequestPort{save/get/list/remove}` returning `Result`, mirroring `edt-registry.ts:33-49`; `SavedRequest`/`SavedRequestInput` types live here.
- `src/core/routes/saved-requests.ts` (new) -- `saveRequest/listSavedRequests/deleteSavedRequest/fireSavedRequest` use-cases; stale via injected `scanner` per distinct `repoPath`; reuses `fire-request.ts:129` route-exists + fire path and `matchTemplate:63-91`.
- `src/adapters/driven/saved-requests/index.ts` + `schema-001.sql` (new) -- `createSavedRequestPort(dbPath)` + `resolveGlobalDbFile(xdg)`; `CREATE TABLE IF NOT EXISTS saved_requests` + `schema_version`; UNIQUE(name); mirrors `edt-registry/index.ts:208-233` on-demand schema and `*_index.ts:15-22` XDG resolvers.
- `src/adapters/driving/cli/subcommands.ts:268` -- `fire-request` wrapper + `parseFireRequestFlags:309-359` gain `--save`; new `request-list`/`request-fire`/`request-delete` wrappers follow the `list-routes:253` and `edt delete:686-776` shapes.
- `src/adapters/driving/tui/store/slices/routes-slice.ts:66` -- `draftOrigins` map + `saveRequestDraft/loadSavedRequest/deleteSavedRequest` actions beside `fireRoute:308-373`; same LRU prune (`touchEntry:107-112`) and repo-switch reset (`:270-293`).
- `src/adapters/driving/tui/zones/routes/routes-zone.tsx:1037` (Request-tab keys), `:1234` (list keys) -- `s` bindings, name prompt, `FilterablePickList` picker dialog, `modal-dialog` confirms; footer hints at `:1340-1375`.
- `src/adapters/driving/tui/shared/components/filterable-pick-list.tsx:18-74` -- picker primitive (`FilterablePickItem{key,label,meta,value}`, `handleFilterablePickListKey`); stale rows passed with `stale` meta and blocked at select time.
- `src/bin/main.ts:55-80`, `src/bin/tui.ts:114-140` -- inject the store dep alongside `scanner`/`auth` into `buildSubcommands`/`createAppStore`.
- Tests to extend: `fire-request.test.ts` (untouched), new `saved-requests.test.ts` (fake port + stub fetch, full matrix), driven adapter test on temp dir (AD-13 precedent), CLI e2e envelope block, `routes-slice.test.ts`, `routes-zone*.test.tsx`.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/ports/saved-request.ts` + `src/core/routes/saved-requests.ts` + test -- port, save/list/delete/fire use-cases, stale computation, cookie exclusion -- matrix core rows.
- [x] `src/adapters/driven/saved-requests/index.ts` + `schema-001.sql` + test -- XDG-backed sqlite store, UNIQUE(name), schema_version -- temp-dir fixture, no real user data.
- [x] `src/adapters/driving/cli/subcommands.ts` + test -- `--save` flag, `request-list`/`request-fire`/`request-delete` -- CLI parity (AD-2/AD-3).
- [x] `store/slices/routes-slice.ts` + test -- `draftOrigins`, save/load/delete actions, LRU + repo-switch reset.
- [x] `zones/routes/routes-zone.tsx` + picker/prompt/confirms/hints + zone tests -- `s` flows, collision inline error, stale display, confirms.
- [x] `src/bin/main.ts` + `src/bin/tui.ts` -- wire the store dep into both composition roots.

**Acceptance Criteria:**
- Given a discovered route, when a developer fires it without saving first, then the ad-hoc customize-then-fire flow works exactly as in 6.9.
- Given a saved request re-fired with further edits, when the developer confirms, then both overwrite-original and save-as-new are offered and applied per fire.
- Given a save-as-new name colliding with an existing name, when attempted, then it is rejected and a different name is prompted for.
- Given a rescan no longer discovers a saved request's route, when the list is viewed, then the request is flagged stale and deletable, never fired silently.

## Spec Change Log

## Design Notes

`fireSavedRequest` loads the record, applies CLI overrides (or the TUI draft, which the slice passes as options), then delegates to `fireRequest` — one fire path, so the 401/auth, template-match and 64 KB-cap semantics cannot drift. Tree state is stored verbatim (`jsonTreeStates[routeKey]` shape from 6.7, already serializable by design) and re-seeded on load, so a saved request reopens with the same view.

## Verification

**Commands:**
- `npm test` -- expected: Vitest green (6.2/6.9 tests untouched).
- `npm run typecheck` -- expected: clean.
- `npm run depcheck` -- expected: no `core → adapters` violation.

## Suggested Review Order

**Core library (start here)**

- One fire path: load, override, fire, persist back with fired details
  [`saved-requests.ts:280`](../../../src/core/routes/saved-requests.ts#L280)

- Fail-open stale per repo; fire-time unknown-route stays the hard gate
  [`saved-requests.ts:200`](../../../src/core/routes/saved-requests.ts#L200)

- Port contract: input-owned identity, overwrite preserves id/name
  [`saved-request.ts:33`](../../../src/core/ports/saved-request.ts#L33)

**Storage**

- global.db factory, schema-on-open, named store errors
  [`index.ts:112`](../../../src/adapters/driven/saved-requests/index.ts#L112)

- Row validation fails loud and named, never silently drops
  [`index.ts:35`](../../../src/adapters/driven/saved-requests/index.ts#L35)

- 001 carries only saved_requests plus a repo_path index
  [`schema-001.sql:1`](../../../src/adapters/driven/saved-requests/schema-001.sql#L1)

**CLI parity**

- --save pre-checks the collision before anything is fired
  [`subcommands.ts:280`](../../../src/adapters/driving/cli/subcommands.ts#L280)

- request-fire forwards overrides plus overwrite/save-as choice
  [`subcommands.ts:375`](../../../src/adapters/driving/cli/subcommands.ts#L375)

- Both composition roots inject the store like scanner/auth
  [`main.ts:41`](../../../src/bin/main.ts#L41)

**TUI**

- Save prompt owns every key; Ctrl+O only on confirmed duplicates
  [`routes-zone.tsx:1030`](../../../src/adapters/driving/tui/zones/routes/routes-zone.tsx#L1030)

- Picker blocks stale rows with feedback, d deletes with confirm
  [`routes-zone.tsx:1062`](../../../src/adapters/driving/tui/zones/routes/routes-zone.tsx#L1062)

- Slice keeps origins, cache and drafts coherent across reloads
  [`routes-slice.ts:432`](../../../src/adapters/driving/tui/store/slices/routes-slice.ts#L432)

- Footer hints show only bound keys per context
  [`routes-zone.tsx:1551`](../../../src/adapters/driving/tui/zones/routes/routes-zone.tsx#L1551)

**Tests (last)**

- Core matrix plus manifest-failure and two-repo stale proofs
  [`saved-requests.test.ts:62`](../../../src/core/routes/saved-requests.test.ts#L62)

- Real-keypress save/collision/picker/delete flows end to end
  [`routes-zone.interaction.test.tsx:1191`](../../../src/adapters/driving/tui/zones/routes/routes-zone.interaction.test.tsx#L1191)
