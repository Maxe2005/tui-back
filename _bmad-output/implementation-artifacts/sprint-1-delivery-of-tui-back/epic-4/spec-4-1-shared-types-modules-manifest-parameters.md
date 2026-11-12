---
title: '`shared-types` Modules & Manifest Parameters'
type: 'feature'
created: '2026-10-08'
status: 'done'
baseline_commit: '2ebdbea55826be73ef80227ba0f0e61c5971f8f4'
review_loop_iteration: 0
context: [_bmad-output/implementation-artifacts/epic-4-context.md]
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The manifest cannot yet declare which repo is the `shared-types` source or which services consume it, and no port exists to read, rewrite or verify a `shared-types` version, so Epic 4's propagation and publish stories have nothing to build on.

**Approach:** Register `shared-types-source` and `shared-types-consumer` in the static module registry with validated, defaulted parameters (unknown ones rejected). Add a `SharedTypesPort` plus a driven adapter with read-version, write-version-line and verify-published operations, unit-tested against a fake filesystem and registry.

## Boundaries & Constraints

**Always:** Parameters are optional with defaults: source `publishCommand: "npm run v"`, `packageName: "@ianord/shared-types"`; consumer `dependency: "@ianord/shared-types"`, `packageJsonPath: "package.json"`. `ModuleImplementation` becomes a discriminated union on `kind` (`route-explorer` unchanged, `shared-types` exposes a `SharedTypesPort`). The version-line write is a targeted text edit that preserves all other bytes, never a JSON re-serialisation. All returns are `Result<T>` with kebab-case error codes. Module ids stay kebab-case.

**Ask First:** If verifying a version on the registry requires anything other than shelling out to `npm view` through a small injectable runner, HALT and ask.

**Never:** No TUI zone, propagation, publish, commit or git work (stories 4.2 to 4.6). No git-ancestry resolution. Core code must not name `shared-types`. No dynamic module loading. No change to the tab-gating rule, only verify it.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Defaults | `modules: {shared-types-source: {}}` | Loads, config filled with defaults | N/A |
| Custom params | consumer `{dependency: "@x/y", packageJsonPath: "api/package.json"}` | Loaded as given | N/A |
| Unknown parameter | `shared-types-consumer: {bogus: 1}` | Load fails, message names the module and parameter | `manifest-validation-failed` |
| Blank parameter | `publishCommand: ""` | Rejected | `manifest-validation-failed` |
| Container-less source | Manifest without `container` plus source module | Accepted as EDT member | N/A |
| Read version | `package.json` with the dependency in `dependencies` or `devDependencies` | Declared version string returned verbatim (e.g. `0.1.3674`) | N/A |
| Dependency absent | `package.json` lacks the dependency | Explicit failure | `dependency-not-found` |
| Write version line | Valid `package.json` | Only that line's version changes, other bytes identical (indent, CRLF, trailing newline) | `package-json-unreadable` on I/O or parse failure |
| Verify published | Version exists on registry | `true` | N/A |
| Verify not found | Registry reports no such version | `false`, never a thrown error | N/A |
| Registry unreachable | Runner fails or times out | Distinct failure, not conflated with "not found" | `registry-unreachable` |

</frozen-after-approval>

## Code Map

- `src/adapters/driven/modules/module-registry.ts` -- static registry; `ModuleImplementation` is `{kind, scanner, auth?}` today. Becomes a union, register the two ids; `knownModuleIds` is derived. Callers in `src/bin/main.ts:60` and `src/bin/tui.ts:115` use `resolveModule(moduleRegistry, ROUTES_MODULE_ID)` and must narrow on `kind`.
- `src/adapters/driven/manifest/schema.ts` -- `createManifestSchema(known)`; `modules` values are `z.record(z.unknown())`. Add per-module config validation (strict, defaulted) through a config schema attached to each registry entry, preserving the sorted deterministic issue order and the `unknown-module` path.
- `src/adapters/driven/manifest/index.ts` -- loader maps zod issues to error codes; unknown-parameter issues keep `manifest-validation-failed`.
- `src/core/ports/manifest.ts` -- `Manifest.modules` shape; keep it generic (core never names `shared-types`).
- `src/core/ports/route-scanner.ts` -- port file style to mirror for the new `src/core/ports/shared-types.ts` (new).
- `src/adapters/driven/modules/shared-types/` (new) -- adapter, config schemas and tests. Mirror `route-explorer/` layout.
- `src/core/edt/resolve-tab-visibility.ts` and `.test.ts` -- gating already uses `SHARED_TYPES_MODULE_IDS`. Only verify and add a test for source/consumer carrying-service naming if missing.
- `src/core/scripts/list-repos.ts:55-61` -- container-less already supported (story 7.2). Add a test for a source repo without `container`.
- `src/adapters/driven/modules/module-registry.test.ts` -- extend for the new ids.

## Tasks & Acceptance

**Execution:**
- [ ] `src/core/ports/shared-types.ts` -- define `SharedTypesPort` (`readVersion`, `writeVersionLine`, `verifyPublished`) taking explicit dependency name / package.json path / package name -- core-owned contract.
- [ ] `src/adapters/driven/modules/shared-types/` -- implement the adapter (injectable fs and registry runner), the two config schemas with defaults and `.strict()` -- AD-18.
- [ ] `src/adapters/driven/modules/module-registry.ts` -- discriminated union, register both ids, update `bin/main.ts` and `bin/tui.ts` narrowing -- AD-5.
- [ ] `src/adapters/driven/manifest/schema.ts` and `index.ts` -- validate and default each module's config using its registry schema; clear messages -- AD-4.
- [ ] Tests: adapter against fake fs and registry (all matrix rows), manifest loader (defaults, custom, unknown, blank), registry, tab gating naming source and consumer services, container-less source in `list-repos`.

**Acceptance Criteria:**
- Given a manifest declaring either module, when loaded, then both ids are known to the registry and the parameters are validated with defaults, and unknown parameters are rejected with a clear message.
- Given the `shared-types` tab gating, when the modules exist, then the tab shows, omits or disables per Story 2.13, naming the carrying services.
- Given a source repo without a container, when registered, then it is accepted as an EDT member.
- Given the port, when exercised against a fake filesystem and registry, then read, write-line and verify behave per the matrix.

## Design Notes

The config schema lives on the registry entry so `schema.ts` stays generic and never names a module. The written value can be a range like `^0.1.3`; `readVersion` returns it verbatim and later stories decide what to compare.

## Verification

**Commands:**
- `npm run typecheck` -- expected: no errors
- `npm test` -- expected: all pass
- `npm run lint` -- expected: no errors (dependency-cruiser boundaries included)

## Suggested Review Order

**Port and adapter**

- Core-owned contract: three explicit-argument operations, error codes documented.
  [`shared-types.ts:1`](../../../src/core/ports/shared-types.ts#L1)

- Targeted text edit keeps every other byte of package.json intact.
  [`npm-package.ts:109`](../../../src/adapters/driven/modules/shared-types/npm-package.ts#L109)

- Exact-version check separates "not published" from "registry unreachable".
  [`npm-package.ts:142`](../../../src/adapters/driven/modules/shared-types/npm-package.ts#L142)

**Registry and manifest validation**

- Discriminated union on `kind`; both module ids registered.
  [`module-registry.ts:34`](../../../src/adapters/driven/modules/module-registry.ts#L34)

- Parameter schemas derived from the registry, so the manifest schema never names a module.
  [`module-registry.ts:54`](../../../src/adapters/driven/modules/module-registry.ts#L54)

- Strict, defaulted per-module config validation with clear messages.
  [`schema.ts:51`](../../../src/adapters/driven/manifest/schema.ts#L51)

- Defaults for both modules; unknown and blank parameters rejected.
  [`config.ts:1`](../../../src/adapters/driven/modules/shared-types/config.ts#L1)

**Callers**

- Narrowing on `kind` after the union change.
  [`main.ts:61`](../../../src/bin/main.ts#L61)
  [`tui.ts:116`](../../../src/bin/tui.ts#L116)

**Tests**

- Adapter against fake fs and registry runner, every matrix row.
  [`npm-package.test.ts:1`](../../../src/adapters/driven/modules/shared-types/npm-package.test.ts#L1)

- Manifest loader: defaults, custom, unknown, blank.
  [`index.test.ts:536`](../../../src/adapters/driven/manifest/index.test.ts#L536)

- Container-less source accepted as a member.
  [`list-repos.test.ts:169`](../../../src/core/scripts/list-repos.test.ts#L169)
