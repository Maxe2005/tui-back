---
title: "Smoke Run of the EDT's Favorite Routes — Core & CLI"
type: 'feature'
created: '2026-11-25'
status: 'done'
baseline_commit: '3a42eef8efc2bbe4fcf85fb1d440390b698033bf'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/sprint-1-delivery-of-tui-back/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After a switch or restart there is no single gesture to learn which of an EDT's favorite routes are up; each must be opened and fired by hand.

**Approach:** A core use-case `smokeRunFavorites` fires the EDT's non-stale favorites through the existing `fireRequest` path and returns a closed-outcome table; the CLI `tui-back routes smoke` exposes it (AD-3 envelope). The TUI (6.15) reuses the same use-case.

## Boundaries & Constraints

**Always:** Non-stale favorites fire via `fireRequest` only (no second HTTP path), through `runPool` with `concurrency` (CLI: `settings.update.concurrency`, fallback default) and `keyOf = repoPath` (never two in flight on one repo). Request = optional caller-supplied draft per route, else the default draft: path params from scanner `example`, `bodyExample` as body (never on GET/HEAD), no query/headers. Skip order: `stale` → `skipped (mutating)` (POST/PUT/PATCH/DELETE unless `includeMutating`) → `missing params: a, b` (unfilled required path params). Outcome ∈ `ok` (status < 400) / `client-error` (4xx) / `server-error` (5xx) / `auth-error` (`auth-unauthorized`/`auth-forbidden`) / `network-error` (any other fire error) / `skipped`. Each row: repoPath, method, path, outcome, status, durationMs, size (bytes of the returned body), reason/errorCode when relevant. The use-case never rejects; one failure never stops the others; rows keep favorites order. Optional `onRow(index,row)` (pending→firing→final) and `signal` (unstarted rows become `skipped: cancelled`) serve 6.15. `--repo` filters favorites to that repo.

**Ask First:** Any change to `fire-request` or `favorites` signatures; any new dependency.

**Never:** No fire of a mutating route without the explicit flag. No persistence of results. No new HTTP/auth path. No TUI work (6.15).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| All healthy | GET favorites, 200s | rows `ok`, summary counts, CLI exit 0 | N/A |
| Mutating | POST favorite, no flag | `skipped (mutating)`, nothing sent | N/A |
| Mutating allowed | `--include-mutating` | fired with default draft | N/A |
| Stale / missing | stale route; `{id}` without example | `skipped` reason `stale` / `missing params: id` | never `failed` |
| Auth | 401 after re-auth / 403 | `auth-error` row | N/A |
| Down | fetch fails | `network-error` row, others continue | N/A |
| Failures | any fired row not `ok` | CLI exit 1, envelope error `smoke-run-failed` with rows+summary in `details` | N/A |
| No favorites | EDT without favorites | ok, empty rows | N/A |
| Unknown EDT | `--edt nope` | `edt-not-found`, nothing fired | rejected up front |

</frozen-after-approval>

## Code Map

- `src/core/insight/routes/favorites.ts` -- `listFavoriteRoutes` gives favorites + `stale`; EDT resolution reused, not duplicated.
- `src/core/insight/routes/fire-request.ts` -- `fireRequest(deps, repoPath, method, path, {body,query,headers})`; error codes `auth-unauthorized`, `auth-forbidden`, `request-failed`.
- `src/core/workspace/scripts/update-support/run-pool.ts` -- `runPool` (`keyOf`, `onCancelled`, `onError`); reuse for bounded concurrency.
- `src/core/ports/modules/route-scanner.ts` -- `Route.parameters/bodyExample` for the default draft.
- `src/adapters/driving/tui/zones/routes/logic/routes-request.logic.ts` -- `seedRequestDraft`/`buildFireRequest`/`substitutePathParams`: TUI-side equivalent of the default draft; core gets its own small pure version (hexagonal: core must not import TUI). Deduplication deferred.
- `src/adapters/driving/cli/commands/routes.ts` -- `routes favorites …` parser; add `smoke` group; flags are all value flags today, `--include-mutating` is boolean.
- `src/adapters/driving/cli/commands/update.ts` (l.51-60) -- settings load/fallback pattern for `update.concurrency`.
- `src/adapters/driving/cli/completion-spec.ts`, `cli/commands/routes.test.ts`, `cli/dispatch/dispatch.routes-requests.test.ts` -- completion and CLI test patterns.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/insight/routes/smoke-run.ts` + `.test.ts` -- `smokeRunFavorites` (skips, default draft, outcome mapping, pool, `onRow`, `signal`, summary) -- covers the I/O matrix
- [x] `src/adapters/driving/cli/commands/routes.ts` + `routes.test.ts`, `completion-spec.ts` -- `routes smoke [--edt] [--repo] [--include-mutating]`, settings concurrency, exit 1 on any non-ok fired row, usage/completion -- FR-1 parity
- [x] `src/adapters/driving/cli/dispatch/dispatch.routes-requests.test.ts` -- envelope + exit code end-to-end

**Acceptance Criteria:**
- Given an EDT with favorites, when the smoke run starts, then each non-stale favorite is fired sequentially per repo through `fireRequest`, bounded by `update.concurrency`.
- Given mutating, stale or incomplete favorites, when run without the flag, then they are `skipped` with their reason and never sent.
- Given `tui-back routes smoke`, when any fired row is not `ok`, then the AD-3 envelope carries rows and the exit code is 1.

## Spec Change Log

## Design Notes

Core returns `ok({rows, summary})` always; only the CLI adapter turns "some fired row not ok" into the exit-1 error (details keep the table), so the TUI consumes the plain table. `summary` = count per outcome.

## Verification

**Commands:**
- `npx tsc --noEmit` -- expected: no errors
- `npx vitest run` -- expected: all green
- `npm run lint` -- expected: clean (if defined)

## Suggested Review Order

**Core use-case**

- Entry point: skip order, default draft, bounded pool, outcome rows.
  [`smoke-run.ts:115`](../../../../../src/core/insight/routes/smoke-run.ts#L115)

- Default draft built from scanner examples; body never on GET/HEAD.
  [`smoke-run.ts:82`](../../../../../src/core/insight/routes/smoke-run.ts#L82)

- Status to closed outcome mapping.
  [`smoke-run.ts:107`](../../../../../src/core/insight/routes/smoke-run.ts#L107)

- Predicate the CLI uses to decide exit 1.
  [`smoke-run.ts:258`](../../../../../src/core/insight/routes/smoke-run.ts#L258)

**CLI**

- `routes smoke` flag parsing, settings concurrency, `smoke-run-failed` envelope.
  [`routes.ts:52`](../../../../../src/adapters/driving/cli/commands/routes.ts#L52)

**Tests**

- Matrix coverage for the use-case.
  [`smoke-run.test.ts:53`](../../../../../src/core/insight/routes/smoke-run.test.ts#L53)

- End-to-end envelope, exit code and completion line.
  [`dispatch.routes-requests.test.ts`](../../../../../src/adapters/driving/cli/dispatch/dispatch.routes-requests.test.ts)
