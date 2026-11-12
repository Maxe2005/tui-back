---
title: 'Fire a Request with Automatic Dev-Mode Auth'
type: 'feature'
created: '2026-09-22'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'eeda2d625eeef6b6eab4d8f3a1e7aa4f0d317e31'
context:
  - '/home/mchoisel/Documents/IANORD/tui-back-epic-6/_bmad-output/implementation-artifacts/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Developers can list discovered routes (Story 6.1) but cannot fire them without hand-crafting tokens mid-session.

**Approach:** Add a generic `core/routes` fire use-case behind a pluggable `DevAuthPort`, ship a cookie-session auth module driven by the service's `/auth/me` route with re-auth on 401, expose it as `tui-back fire-request`, and fire from the Routes zone via `Enter`.

## Boundaries & Constraints

**Always:**
- `core/` never imports from `adapters/` (AD-1); every use-case returns `Result<T>` with kebab-case `error.code` (AD-3).
- Relative imports end in `.js`; imports are the first statements in every file.
- Module implementations are statically compiled in `module-registry.ts`; manifests only select keys, never load code (AD-5).
- `baseUrl`, optional `authPath` (default `/auth/me`), optional `sessionTtlSec` (default `300`) come from the manifest `route-explorer` config only — no core hardcoding, no second config source (AD-4).
- Auth is a cookie session: the module calls `GET {baseUrl}{authPath}`, stores the `Set-Cookie` value, and core attaches it as a `Cookie` header on every fired request (human decision 2026-09-22: no per-route protection detection, no scanner change).
- The session refreshes silently before expiry (TTL minus 30s skew) and on demand whenever a fired request returns 401; at most 2 consecutive re-auths per fire, then the 401 stands as an error.
- CLI renders human text on TTY, exactly one JSON line otherwise; exit `0`/`1` only; `main.ts` sets `process.exitCode`, never calls `process.exit()`.
- Never log or echo the session cookie anywhere (stdout, stderr, TUI, error details).

**Ask First:**
- Live dev-gateway `baseUrl` for a manual end-to-end fire check, if the human can provide one; otherwise verification stays on fakes and stubs.

**Never:**
- No body/header customization in CLI flags or TUI inputs (Story 6.3 territory); fire uses the discovered `method + path` as-is.
- No saving, no saved-request library (Story 6.3); no response-plus-logs correlation (Story 6.4).
- No local JWT minting and no `jose` dependency: the service owns token issuance, the module only carries its cookie (deviation from the architecture spine's `jose-dev-jwt` name, recorded in Design Notes).
- No OAuth/OIDC/token endpoint beyond the service's own `authPath` route.
- No change to scanner behavior or the `Route` shape; no second-stack auth implementation in v1.
- No dynamic `require()`/`import()` of manifest-supplied paths.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy fire | `fire-request <repo> POST /api/orders`, module active, `baseUrl` set | `{ok:true, data:{status, durationMs, body}}`; 2xx and non-auth 4xx/5xx both returned as data | N/A |
| Module not activated | manifest without `route-explorer` | `{ok:false, error:{code:route-exploration-not-activated}}` | Reuse 6.1 code, never an empty result |
| Missing baseUrl | module active, no `baseUrl` key | `{ok:false, error:{code:missing-base-url}}` | Named error before any network call |
| Unknown route | `method + path` absent from fresh scan | `{ok:false, error:{code:unknown-route}}` | Never fired silently |
| Scan failure passthrough | scanner fails during route check | Scanner's `route-scan-failed` passes through verbatim | No wrapping |
| Session acquired | first fire, valid `/auth/me` | Module stores `Set-Cookie`, fire proceeds with `Cookie` header | N/A |
| Session expired | cached session older than TTL minus 30s skew | Silent re-auth before send, single fire observed downstream | No developer action |
| 401 then success | server 401, re-auth succeeds | Retry with the fresh cookie, result returned as data | Transparent to caller |
| 401 persistent | still 401 after 2 consecutive re-auths | `{ok:false, error:{code:auth-unauthorized}}` | No further retries |
| Auth endpoint down | `/auth/me` non-2xx or network failure | `{ok:false, error:{code:auth-endpoint-failed, details:{reason}}}` | Cookie never logged; no fire attempted |
| 403 permission mismatch | server 403 on fired request | `{ok:false, error:{code:auth-forbidden}}` | Distinct from generic failure, no retry |
| Network failure | fetch throws / timeout (8s) | `{ok:false, error:{code:request-failed, details:{reason}}}` | Never throw |

</frozen-after-approval>

## Code Map

- `src/core/routes/list-routes.ts:19` -- Reference gate-then-delegate use-case; `fire-request` mirrors its manifest gate (`modules[ROUTES_MODULE_ID]`, `ROUTES_MODULE_ID` from `core/edt/resolve-tab-visibility.js`).
- `src/core/ports/route-scanner.ts:14` -- `Route{method,path,summary?}`, identity `method + path`; reuse scanner to validate the fired route exists.
- `src/adapters/driven/modules/module-registry.ts:12` -- `ModuleImplementation{kind, scanner}` gains optional `auth?`; register the cookie-session auth instance under `'route-explorer'`; `knownModuleIds` stays derived.
- `src/adapters/driven/modules/route-explorer/nestjs-openapi.ts:101` -- Module config probing pattern (`configuredSource`); scanner ignores the new `baseUrl`/`authPath`/`sessionTtlSec` keys.
- `src/adapters/driven/manifest/schema.ts:15` -- `moduleConfigSchema` is an open record: new keys pass through with zero schema change; unknown module ids still rejected.
- `src/adapters/driving/cli/subcommands.ts:193` -- `list-routes` declaration/dispatch pattern (`missing-argument` on 0 args, `invalid-argument` on bad arity); add `fire-request <repoPath> <METHOD> <path>`.
- `src/adapters/driving/cli/dispatch.ts:46` -- `try/catch` → `internal-error`; envelope TTY vs single-JSON-line in `envelope.ts:13`.
- `src/adapters/driving/tui/store/slices/routes-slice.ts:29` -- `RoutesSlice` state machine (`idle|loading|ready|error`); add `fireStatus: idle|firing|fired|error`, `fireResult`, `fireError`, `fireRoute(method, path)`.
- `src/adapters/driving/tui/zones/routes/routes-zone.tsx:36` -- State rendering (spinner, failure vs empty); detail pane gains fired view `status + duration + body` and distinct auth-error messages; `Enter` fires the selected route (UX: `[enter] tirer`).
- `src/bin/main.ts:56` + `src/bin/tui.ts:118` -- Both roots resolve `'route-explorer'` via `resolveModule`; inject `routeExplorer.auth` alongside `scanner`.
- `src/core/result.ts:11` -- `Result<T>` + kebab-case codes; precedents `route-exploration-not-activated`, `route-scan-failed`, `missing-argument`, `invalid-argument`.
- `package.json:29` -- No new runtime dependency: HTTP stays native `fetch` (scanner precedent: `AbortSignal.timeout(8000)`); `jose` is NOT added since the service mints its own JWT.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/ports/dev-auth.ts` -- `DevAuthPort{getSession(config, opts?:{forceRefresh?:boolean}): Promise<Result<{cookie:string}>>}` -- RATIONALE: pluggable auth behind a port, session cache + refresh hidden in the module.
- [x] `src/core/routes/fire-request.ts` -- `fireRequest(deps{manifest,scanner,auth,fetchFn?}, repoPath, method, path)`: manifest gate → `baseUrl` check → scanner route-exists check → session cookie → `fetch(baseUrl+path,{headers:{Cookie},signal:timeout(8000)})` → on 401 force-refresh + retry (max 2 consecutive re-auths, then `auth-unauthorized`) → map 403 to `auth-forbidden`, auth-endpoint failures pass through, other statuses to `FireResult{status,durationMs,body}` (text body, 64KB cap) -- RATIONALE: whole story in one use-case; `fetchFn` defaults to global `fetch` so unit tests inject a stub shared by the fire and the `/auth/me` call.
- [x] `src/adapters/driven/modules/route-explorer/cookie-session-auth.ts` -- `GET {baseUrl}{authPath}` (default `/auth/me`), parse `Set-Cookie` into a `Cookie` header value; per-repo session cache with TTL (`sessionTtlSec` default 300) minus 30s skew; `forceRefresh` bypasses cache; endpoint non-2xx/network failure → `auth-endpoint-failed`, never throws -- RATIONALE: the service owns issuance; the module only acquires and carries the cookie.
- [x] `src/adapters/driven/modules/module-registry.ts` -- `ModuleImplementation` gains optional `auth: DevAuthPort`; register the cookie-session instance on `'route-explorer'` -- RATIONALE: static registry (AD-5), manifest selects the key only.
- [x] `src/adapters/driving/cli/subcommands.ts` -- `fire-request <repoPath> <METHOD> <path>` with `usage`, same arg-validation shape as `list-routes` -- RATIONALE: TUI/CLI parity (AD-3 envelope).
- [x] `src/adapters/driving/tui/store/slices/routes-slice.ts` + `src/adapters/driving/tui/zones/routes/routes-zone.tsx` -- `fireRoute` state machine, `Enter` fires selected route, detail pane shows spinner → `status + duration + body` or distinct auth error -- RATIONALE: `Enter = tirer` per UX mockup; no logs pane (Story 6.4).
- [x] `src/bin/main.ts` + `src/bin/tui.ts` -- Inject `routeExplorer.auth` into subcommands and store alongside `scanner` -- RATIONALE: both composition roots fire identically.
- [ ] Tests: `src/core/routes/fire-request.test.ts` (fake manifest/scanner/auth + stub `fetchFn` covering every I/O-matrix row) + `src/adapters/driven/modules/route-explorer/cookie-session-auth.test.ts` (stub fetch: Set-Cookie parsing, TTL skew, `auth-endpoint-failed` rows) + CLI e2e AD-3 envelope block for `fire-request` arg-validation (no network) -- RATIONALE: I/O matrix proven without a live server.

**Acceptance Criteria:**
- Given a route discovered via Story 6.1, when a developer fires it, then the request carries the service's session cookie from that repo's active auth module with no manual token handling.
- Given a session firing across multiple repos, when each is fired, then no manual re-authentication is needed for any of them.
- Given an expired session cookie, when a request is fired, then the session refreshes automatically via the auth route with no developer action.
- Given a permission mismatch on the target route, when the response arrives, then it surfaces as a distinct auth error, not a generic failure.

## Spec Change Log

## Design Notes

Auth is a cookie session, not a locally-minted JWT: the service owns issuance via `GET {baseUrl}{authPath}` (default `/auth/me`, 5min cookie), the module only acquires and carries it. This deviates from the architecture spine's `jose-dev-jwt` module name — deliberate for this first service instance; a future stack plugs its own `DevAuthPort` implementation with no core change. Cache key is repo + baseUrl; multi-repo no-re-auth falls out naturally since each fire resolves its own repo config.

```ts
type FireResult = { status: number; durationMs: number; body: string };
getSession(config, { forceRefresh: true }) // on 401; max 2 consecutive re-auths per fire
```

## Verification

**Commands:**
- `npm test` -- expected: Vitest green, new `fire-request` unit + `cookie-session-auth` + slice + CLI e2e pass.
- `npm run typecheck` -- expected: `tsc --noEmit` clean (NodeNext `.js` imports, imports-first).
- `npm run depcheck` -- expected: no `core → adapters` violation.
- `node src/bin/cli-back.mjs fire-request <repoPath> <METHOD> <path>` (piped, non-TTY) -- expected: exactly one JSON line matching the AD-3 envelope.

## Suggested Review Order

**Core fire loop**
- Whole story in one use-case: gate, route check, cookie, 401 budget
  [`fire-request.ts:62`](../../../src/core/routes/fire-request.ts#L62)
- Retry budget semantics: 1 try plus up to 2 re-auths
  [`fire-request.ts:126`](../../../src/core/routes/fire-request.ts#L126)
- Auth port contract behind the pluggable boundary
  [`dev-auth.ts:23`](../../../src/core/ports/dev-auth.ts#L23)

**Cookie session module**
- Session acquisition with TTL cache and in-flight dedupe
  [`cookie-session-auth.ts:92`](../../../src/adapters/driven/modules/route-explorer/cookie-session-auth.ts#L92)
- Freshness check with stored TTL and clamped skew
  [`cookie-session-auth.ts:44`](../../../src/adapters/driven/modules/route-explorer/cookie-session-auth.ts#L44)

**Wiring**
- Static registry gains optional auth instance
  [`module-registry.ts:18`](../../../src/adapters/driven/modules/module-registry.ts#L18)
- Thin CLI wrapper over the core use-case
  [`subcommands.ts:214`](../../../src/adapters/driving/cli/subcommands.ts#L214)
- Both composition roots inject the auth port
  [`main.ts:60`](../../../src/bin/main.ts#L60)

**TUI firing**
- Enter dispatch extracted as pure testable helper
  [`routes-zone.logic.ts:83`](../../../src/adapters/driving/tui/zones/routes/routes-zone.logic.ts#L83)
- Zone binds Enter and renders response or auth error
  [`routes-zone.tsx:79`](../../../src/adapters/driving/tui/zones/routes/routes-zone.tsx#L79)
- Slice state machine with concurrency guard
  [`routes-slice.ts:134`](../../../src/adapters/driving/tui/store/slices/routes-slice.ts#L134)

**Tests**
- I/O-matrix coverage against fake ports and stub fetch
  [`fire-request.test.ts:1`](../../../src/core/routes/fire-request.test.ts#L1)
- Set-Cookie parsing, TTL skew, endpoint failures
  [`cookie-session-auth.test.ts:1`](../../../src/adapters/driven/modules/route-explorer/cookie-session-auth.test.ts#L1)
