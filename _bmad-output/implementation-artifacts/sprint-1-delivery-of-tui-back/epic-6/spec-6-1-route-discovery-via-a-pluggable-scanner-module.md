---
title: 'Route Discovery via a Pluggable Scanner Module'
type: 'feature'
created: '2026-09-22'
status: 'done'
review_loop_iteration: 0
baseline_commit: '92f2a4c44789962dede2d43c3e2147dc68523c9b'
context:
  - '/home/mchoisel/Documents/IANORD/tui-back-epic-6/_bmad-output/implementation-artifacts/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Developers must fight the generated Swagger UI to browse a repo API; there is no minimal in-tool route list.

**Approach:** Add a generic `core/routes` list use-case behind a pluggable `RouteScannerPort`, ship the `nestjs-openapi` scanner as a statically-registered `route-explorer` module, expose it as `tui-back list-routes`, and render it in the Routes zone list pane.

## Boundaries & Constraints

**Always:**
- `core/` never imports from `adapters/` (AD-1); every use-case returns `Result<T>` from `src/core/result.ts` with kebab-case `error.code` (AD-3).
- Relative imports end in `.js`; imports are the first statements in every file.
- Module implementations are statically compiled in `module-registry.ts` keyed by manifest module id; manifests only select keys, never load code (AD-5).
- A repo offers routes iff its manifest activates `route-explorer`; otherwise no list is offered, no special-case in core (AD-4, FR-19).
- Scan failure and genuinely-empty list are visibly distinct states; failure is never rendered as empty.
- No firing, no auth, no saving, no log correlation in this story (Stories 6.2-6.4 territory).
- CLI renders human text on TTY, exactly one JSON line otherwise; exit `0`/`1` only; `main.ts` sets `process.exitCode`, never calls `process.exit()`.

**Ask First:**
- OpenAPI spec source location per repo (file path vs. live URL) if the manifest config shape proves insufficient during implementation.

**Never:**
- No generic Swagger schema browser; minimal purpose-built route list only.
- No second-stack validation in v1; no canonical cross-scanner route-identity standard beyond `method + path`.
- No dynamic `require()`/`import()` of manifest-supplied paths.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| List routes, module active | `list-routes <repoPath>`, manifest has `route-explorer` | `{ok:true, data:{routes:[{method,path,summary?}]}}`, CLI lists `METHOD path` rows | N/A |
| Module not activated | manifest without `route-explorer` | `{ok:false, error:{code:route-exploration-not-activated}}`, CLI + zone show "no route list for this repo" | Named error, never empty list |
| Scan failure | OpenAPI spec unparsable / unreadable | `{ok:false, error:{code:route-scan-failed, details:{reason}}}`; zone shows distinct failure state | Never rendered as empty |
| Genuinely empty | Scanner succeeds, zero routes | `{ok:true, data:{routes:[]}}`; zone shows distinct empty state | N/A |
| Unknown module id | manifest declares unknown id | Manifest loader rejects with `unknown-module` naming the id | Never silently ignored |

</frozen-after-approval>

## Code Map

- `src/core/ports/manifest.ts` + `src/adapters/driven/manifest/{schema.ts,index.ts}` -- Activation via `modules['route-explorer']`; unknown id → `unknown-module`.
- `src/adapters/driven/modules/module-registry.ts` -- Empty registry today; 6.1 adds first real `'route-explorer'` entry, `knownModuleIds` derived.
- `src/core/scripts/list-repos.ts` -- Reference read-only use-case; pattern for `core/routes/list-routes.ts`.
- `src/core/edt/resolve-tab-visibility.ts` -- `ROUTES_MODULE_ID`, gating already coded, no change needed.
- `src/adapters/driving/cli/{subcommands.ts,dispatch.ts,envelope.ts}` -- Add `list-routes`; throws → `internal-error`; TTY vs single JSON line.
- `src/adapters/driving/tui/zones/routes/routes-zone.tsx` -- Placeholder today; 6.1 builds list/detail with spinner, failure vs empty.
- `src/bin/main.ts` + `src/bin/tui.ts` -- Composition roots; wire scanner port into both.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/ports/route-scanner.ts` -- `Route{method,path,summary?}`, `RouteScannerPort{scan}`, codes `route-exploration-not-activated`, `route-scan-failed`.
- [x] `src/core/routes/list-routes.ts` -- `listRoutes`: manifest gate on `route-explorer`, delegate to scanner.
- [x] `src/adapters/driven/modules/route-explorer/nestjs-openapi.ts` -- OpenAPI → `Route[]`; parse errors → `route-scan-failed`, never throw.
- [x] `src/adapters/driven/modules/module-registry.ts` -- Register `'route-explorer'`; no dynamic loading.
- [x] `src/adapters/driving/cli/subcommands.ts` -- `list-routes <repoPath>` with `usage`.
- [x] `src/adapters/driving/tui/zones/routes/routes-zone.tsx` -- List/detail, spinner `⣾`, failure vs empty, `list-row` reuse.
- [x] `src/bin/main.ts` + `src/bin/tui.ts` -- Wire scanner port into both roots.
- [x] Tests: `src/core/routes/list-routes.test.ts` (fakes, I/O matrix) + CLI e2e AD-3 envelope.

**Acceptance Criteria:**
- Given a managed repo whose manifest activates `route-explorer`, when the developer opens the Routes zone or runs `list-routes`, then every route the scanner discovers is listed.
- Given a repo whose manifest does not activate `route-explorer`, when browsed, then no route list is offered (named `route-exploration-not-activated`, not an empty list).
- Given an unparsable OpenAPI spec, when scanned, then a distinct scan-failure state shows, never an empty list.
- Given a successful scan with zero routes, when viewed, then a distinct genuinely-empty state shows.
- Given a future repo activating `route-explorer` in its manifest, when configured, then no core code change is required.

## Spec Change Log

## Verification

**Commands:**
- `npm test` -- expected: Vitest green, new `list-routes` unit + CLI e2e pass.
- `npm run typecheck` -- expected: `tsc --noEmit` clean (NodeNext `.js` imports, imports-first).
- `npm run depcheck` -- expected: no `core → adapters` violation.
- `node src/bin/cli-back.mjs list-routes <repoPath>` (piped, non-TTY) -- expected: exactly one JSON line matching the AD-3 envelope.

## Suggested Review Order

**Core use-case and port**

- Manifest gate plus scanner delegation, the whole story in one function
  [`list-routes.ts:24`](../../../src/core/routes/list-routes.ts#L24)

- Port contract: Route shape, scanner signature, canonical method-plus-path identity
  [`route-scanner.ts:20`](../../../src/core/ports/route-scanner.ts#L20)

**Scanner strictness and fetching**

- Malformed entries fail loudly instead of vanishing into an empty list
  [`nestjs-openapi.ts:64`](../../../src/adapters/driven/modules/route-explorer/nestjs-openapi.ts#L64)

- URL fetch carries an abort timeout so a dead endpoint cannot hang the zone
  [`nestjs-openapi.ts:40`](../../../src/adapters/driven/modules/route-explorer/nestjs-openapi.ts#L40)

**Static registration and wiring**

- First real registry entry; knownModuleIds derives from it automatically
  [`module-registry.ts:17`](../../../src/adapters/driven/modules/module-registry.ts#L17)

- Both composition roots resolve the same key via the shared module-id constant
  [`main.ts:56`](../../../src/bin/main.ts#L56)

- Same resolution on the TUI side so CLI and zone scan identically
  [`tui.ts:118`](../../../src/bin/tui.ts#L118)

**Driving adapters**

- Thin list-routes subcommand over the core use-case, AD-2 style
  [`subcommands.ts:194`](../../../src/adapters/driving/cli/subcommands.ts#L194)

- Slice picks the active EDT carrier else first carrier; failures stay distinct
  [`routes-slice.ts:43`](../../../src/adapters/driving/tui/store/slices/routes-slice.ts#L43)

- Zone renders loading, failure, empty, and list states without overlap
  [`routes-zone.tsx:36`](../../../src/adapters/driving/tui/zones/routes/routes-zone.tsx#L36)

**Tests**

- I/O matrix against fake ports, including strictness and alias-key cases
  [`list-routes.test.ts:1`](../../../src/core/routes/list-routes.test.ts#L1)

- Real temp-dir scanner coverage plus the no-fallthrough regression pin
  [`nestjs-openapi.test.ts:1`](../../../src/adapters/driven/modules/route-explorer/nestjs-openapi.test.ts#L1)

- Slice registry-failure branch and carrier-preference coverage
  [`routes-slice.test.ts:1`](../../../src/adapters/driving/tui/store/slices/routes-slice.test.ts#L1)

- Black-box CLI envelope block for list-routes
  [`tui-back.e2e.test.ts:1`](../../../src/bin/tui-back.e2e.test.ts#L1)
