---
title: 'Favorite Routes per EDT — Persistence, Use-Cases & CLI'
type: 'feature'
created: '2026-11-23'
status: 'done'
baseline_commit: 'c4206c2ca8aef7adebf087e93f27879b7eff1252'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/sprint-1-delivery-of-tui-back/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Routes tested for one task are lost among every discovered route, and nothing remembers them per EDT, so they would leak into other EDTs if stored globally.

**Approach:** Persist `favoriteRoutes: [{ repoPath, method, path }]` on each EDT entry in `edts.yaml`; expose core use-cases (toggle, list with `stale` flag) and a `tui-back routes favorites list|add|remove` CLI on the same use-cases and AD-3 envelope. The TUI pane is story 6.12, not this one.

## Boundaries & Constraints

**Always:** Method upper-cased, path in discovered template form, no duplicates. `favoriteRoutes` is optional in the schema (legacy files validate unchanged). Writes go through `EdtRegistryPort.update` under `withActionLock` on `edtRegistryResourceKey` (AD-9). Stale = a fresh per-repo scan no longer discovers the route; a manifest/scan failure is NOT stale (same precedent as `listSavedRequests`). Stale favorites are returned, never dropped, never fired.

**Ask First:** Any change to `edts.yaml` beyond the optional `favoriteRoutes` field.

**Never:** No TUI work (6.12/6.13). No global favorites store. No firing from favorites. No new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Toggle on | route not favorite, `get /x` | stored `GET /x`, returns `{favorite:true}` | N/A |
| Toggle off | route already favorite | removed, returns `{favorite:false}` | N/A |
| CLI add twice | same route | second call is a no-op, ok | N/A |
| Other EDT | favorites read for EDT B | only B's favorites | N/A |
| Vanished route | favorite absent from rescan | listed with `stale:true` | N/A |
| Bad input | unknown `--edt`, or method not a valid HTTP verb, blank repo/path | rejected, nothing written | `edt-not-found` / `invalid-argument` / `missing-argument` |
| Legacy file | `edts.yaml` without the field | validates; no favorites | N/A |
| No active EDT | `--edt` omitted | rejected | `edt-not-found` |

</frozen-after-approval>

## Code Map

- `src/core/ports/storage/edt-registry.ts` -- `EdtRegistryEntry` + `update` patch: add `FavoriteRoute` type and `favoriteRoutes?`.
- `src/adapters/driven/storage/edt-registry/schema.ts` -- add optional strict `favoriteRoutes` array to the entry schema.
- `src/adapters/driven/storage/edt-registry/index.ts` -- `updateEdtEntry` applies `patch.favoriteRoutes` (empty array → drop the key). `remove` already deletes favorites with the entry.
- `src/core/insight/routes/saved-requests.ts` -- `isRoutePresent`/`matchTemplate` (unexported): export `isRoutePresent` for reuse, do not duplicate.
- `src/core/insight/routes/favorites.ts` (new) -- `toggleFavoriteRoute`, `addFavoriteRoute`, `removeFavoriteRoute`, `listFavoriteRoutes`; active EDT via `state.readActiveEdt()` (see `core/workspace/edt/shared-edt/resolve-tab-visibility.ts:60`).
- `src/adapters/driving/cli/commands/routes.ts` (or a `routes/` folder if the reorganized layout groups by family) (new) -- `routes` verb-dispatch like `commands/edt/edt.ts`; flags `--edt <topic>`, `--repo`, `--method`, `--path`.
- `src/adapters/driving/cli/subcommands.ts` -- register `routesSubcommand` (completion spec follows automatically; check `dispatch.test.ts:317` name list).
- `src/core/index.ts` -- re-export if the other routes use-cases are.

## Tasks & Acceptance

**Execution:**
- [ ] `src/core/ports/storage/edt-registry.ts`, `schema.ts`, `storage/edt-registry/index.ts` -- persist optional `favoriteRoutes` -- AC 1-3; test in `edt-registry/index.test.ts` (round-trip, legacy file, remove with entry)
- [ ] `src/core/insight/routes/saved-requests.ts` -- export `isRoutePresent` -- reuse, no drift
- [ ] `src/core/insight/routes/favorites.ts` + `favorites.test.ts` -- use-cases covering the I/O matrix (dedupe, per-EDT isolation, stale, validation before write)
- [ ] `src/adapters/driving/cli/commands/routes.ts` (or a `routes/` folder if the reorganized layout groups by family), `subcommands.ts`, `dispatch.test.ts` -- CLI list|add|remove -- FR-1 parity; add the new command name to the wiring test

**Acceptance Criteria:**
- Given an EDT, when a route is toggled twice, then it is stored once then removed, with method upper-cased.
- Given a pre-6.11 `edts.yaml`, when loaded, then it validates and the EDT has no favorites.
- Given favorites on EDT A, when EDT B's are read, then none of A's appear; deleting A removes them.
- Given a favorite no longer scanned, when listed, then `stale: true`; `remove` deletes it.
- Given `tui-back routes favorites add --method FOO ...` or an unknown `--edt`, then it fails before any write, in the standard envelope.

## Design Notes

Identity of a favorite is `(repoPath, method, path)` exact on the stored template form; stale detection uses the lenient `isRoutePresent` match.

## Verification

**Commands:**
- `npx tsc --noEmit` -- expected: no errors
- `npx vitest run` -- expected: all green
- `npm run lint` -- expected: clean (if defined)

## Suggested Review Order

**Use-case design**

- Entry point: one `mutate` path serves toggle/add/remove under the registry lock.
  [`favorites.ts:108`](../../../../../src/core/insight/routes/favorites.ts#L108)

- Input normalization: upper-cased verb, single trailing slash stripped, absolute repo only.
  [`favorites.ts:43`](../../../../../src/core/insight/routes/favorites.ts#L43)

- Stale flag from one scan per repo; scan or manifest failure stays "unknown", never stale.
  [`favorites.ts:144`](../../../../../src/core/insight/routes/favorites.ts#L144)

**Persistence**

- Optional field on the EDT entry, so legacy `edts.yaml` validates unchanged.
  [`schema.ts:29`](../../../../../src/adapters/driven/storage/edt-registry/schema.ts#L29)

- `update` patch applies favorites; an empty list drops the key.
  [`index.ts:182`](../../../../../src/adapters/driven/storage/edt-registry/index.ts#L182)

- Port type and patch contract.
  [`edt-registry.ts:36`](../../../../../src/core/ports/storage/edt-registry.ts#L36)

**CLI**

- `routes favorites list|add|remove` on the same use-cases; `--repo` resolved to absolute.
  [`routes.ts:42`](../../../../../src/adapters/driving/cli/commands/routes.ts#L42)

- Registered in the subcommand list.
  [`subcommands.ts:39`](../../../../../src/adapters/driving/cli/subcommands.ts#L39)

**Tests**

- Use-case matrix: dedupe, isolation, stale, normalization, readonly refusal.
  [`favorites.test.ts:1`](../../../../../src/core/insight/routes/favorites.test.ts#L1)

- CLI flag parsing, dispatch and error codes.
  [`routes.test.ts:1`](../../../../../src/adapters/driving/cli/commands/routes.test.ts#L1)
