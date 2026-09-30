---
title: 'Scanner Extension — Parameters & Request-Body Skeletons'
type: 'feature'
created: '2026-09-30'
status: 'in-review'
review_loop_iteration: 0
baseline_commit: 'e55ef39a72eae6f037cffe9ef29fcd9c31aff822'
context:
  - '/home/mchoisel/Documents/IANORD/tui-back-epic-6/_bmad-output/implementation-artifacts/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The scanner returns only `{method, path, summary?}`, so the request editor planned in Stories 6.8/6.9 would open blank: no parameters, no body skeleton.

**Approach:** Extend the `Route` port shape with optional, scanner-agnostic `parameters`, `bodyContentType` and `bodyExample`, filled by the `nestjs-openapi` adapter from `parameters`/`requestBody`/`components` with a pure, bounded schema-to-example generator.

## Boundaries & Constraints

**Always:**
- `core/` never imports from `adapters/` (AD-1); imports first, relative imports end in `.js`.
- New `Route` fields are optional and omitted (not `[]`/`undefined`-valued keys) when absent, so 6.1/6.2 behavior and tests are unchanged; scanner-specific vocabulary (OpenAPI, schema, `$ref`) never crosses the port (AD-5).
- Parameters: `path`/`query`/`header` only (cookie ignored), shape `{name, in, required, example?}`; operation-level entries override path-item ones with the same `name`+`in`. Path parameters are always `required: true`.
- Only local `#/components/...` `$ref`s are resolved (parameters, requestBody, schemas); anything else degrades.
- Content type choice: `application/json`, else any `*/json` or `*+json`, else the first declared type. `bodyExample` exists only for a JSON type.
- Example priority: media `example`, else first `examples[*].value`, else schema `example`, else generated: `string→""`, `number|integer→0`, `boolean→false`, `array→[one item]`, `object→every property`, `enum→first`, property `default`/`example` win; `allOf` merges properties, `oneOf`/`anyOf` take the first branch.
- Generation is depth-bounded (8) and cycle-safe (a cyclic branch yields `null`); it never throws or loops.
- A malformed `parameters`/`requestBody`/`$ref` degrades that operation to a plain route; a scan only fails on the conditions 6.1 already defines.

**Ask First:** Any change to `Route.method`/`path` identity or to `list-routes` semantics.

**Never:**
- No schema-to-example logic in `core/`; no new dependency (`yaml` already present).
- No TUI/store/`fireRequest` change (Stories 6.8/6.9); no non-JSON body fabrication (multipart, form-urlencoded, binary → `bodyContentType` only).
- No external (`http`/file) `$ref` fetching.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Params merged | path-item `id` (path) + operation `limit` (query) | route `parameters` lists both; same name+in → operation wins | N/A |
| Explicit example | requestBody media `example` present | `bodyExample` = it, `bodyContentType` `application/json` | N/A |
| Generated skeleton | `$ref` schema, nested object + array + enum | skeleton per generation rules | N/A |
| Recursive schema | schema references itself | bounded skeleton, cyclic branch `null` | No throw |
| Non-JSON body | `multipart/form-data` only | `bodyContentType` set, no `bodyExample` | N/A |
| No extras | operation without parameters/requestBody | route keys exactly as before | N/A |
| Malformed extras | `parameters` not an array / unresolvable `$ref` | plain route still listed | Degrade, no failure |

</frozen-after-approval>

## Code Map

- `src/core/ports/route-scanner.ts:14` -- `Route`; gains `RouteParameter` and the three optional fields; header comment records the neutral-data rule.
- `src/adapters/driven/modules/route-explorer/nestjs-openapi.ts:64` -- `extractRoutes`; per-operation extras built here; `isRecord` helper reused.
- `src/adapters/driven/modules/route-explorer/schema-example.ts` -- new pure module: `$ref` resolution + example generation (unit-testable without files).
- `src/adapters/driven/modules/route-explorer/nestjs-openapi.test.ts` -- real temp-dir integration style (AD-13); `SPEC` fixture pattern.
- `src/core/routes/list-routes.ts:33` -- passes `Route[]` through; CLI `list-routes` JSON therefore carries the new fields (accepted, no change).
- `src/core/routes/fire-request.ts:100` -- consumes scanner only for `method+path`; unaffected.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/ports/route-scanner.ts` -- add `RouteParameter{name,in,required,example?}` and `Route.parameters?/bodyContentType?/bodyExample?` -- neutral port data.
- [x] `src/adapters/driven/modules/route-explorer/schema-example.ts` + `.test.ts` -- `resolveLocalRef`, `generateExample`, depth/cycle guards -- pure, all generation rules covered.
- [x] `src/adapters/driven/modules/route-explorer/nestjs-openapi.ts` + test -- parameter merge, requestBody content-type choice, example priority, degradation per operation -- I/O matrix rows.
- [ ] Extend existing `nestjs-openapi` tests so the plain-route rows still equal their pre-6.6 shape.

**Acceptance Criteria:**
- Given an operation with path-item and operation-level parameters, when scanned, then the route carries the merged neutral list.
- Given a JSON requestBody, when scanned, then `bodyExample` is the spec example or a generated skeleton with `$ref`s resolved.
- Given a self-referencing schema, when scanned, then generation terminates and the route is listed.
- Given a non-JSON body or a spec lacking these details, when scanned, then no `bodyExample` is fabricated and existing 6.1/6.2 behavior is intact.

## Spec Change Log

## Verification

**Commands:**
- `npm test` -- expected: Vitest green, incl. new schema-example and scanner tests.
- `npm run typecheck` -- expected: `tsc --noEmit` clean.
- `npm run depcheck` -- expected: no `core → adapters` violation.
