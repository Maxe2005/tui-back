---
title: 'Static Module Registry'
type: 'feature'
created: '2026-08-13'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
context: [1-5-explicit-repo-registry, 1-4-manifest-schema-loader-validation]
warnings: []
deferred: []
baseline_revision: '4a5bf43dacac7191623efa1d516a921cadd0533d'
baseline_commit: '4a5bf43dacac7191623efa1d516a921cadd0533d'
---

<intent-contract>

## Intent

**Problem:** A manifest can select any arbitrary module id today — `src/adapters/driven/manifest/schema.ts:18` validates `modules` as a free-form `Record<string, Record<string, unknown>>` with **no check against a known module set**. Because the tool holds real (if scoped) git-write authority, a manifest that names a module id the tool does not actually know must fail loudly at load — never be silently ignored or, worse, become an arbitrary-code-execution surface if module ids ever mapped to externally supplied code (AD-5).

**Approach:** Introduce a **compiled-in static module registry** (AD-5): a small, compile-time constant in the driven adapters that maps known module ids to their implementations. The manifest adapter cross-validates every entry in a loaded manifest's `modules` map against this registry at load time; an unknown id fails the load with a clear kebab-case error naming the offending id (and the offending repo path). Real module implementations (`route-explorer`, `shared-types-consumer`) do **not** exist until Epics 6 and 4 respectively, so this story ships the *mechanism* with an **empty registry** — any non-empty `modules` entry in any repo manifest fails validation for now. `list-repos` is extended to surface a repo's active module ids alongside its identity (AC4), read from the loaded manifest's `modules` keys.

## Boundaries & Constraints

**Always:**
- AD-1: `core/` never imports from `adapters/`. The compiled-in registry is a *driven-adapter concern* (it lives under `src/adapters/driven/`), and the validation rule is applied inside the driven manifest adapter — NOT in `core/`. depcheck enforces the boundary; keep imports first in every file (acorn-fallback landmine, see deferred-work.md).
- AD-5: module implementations are statically registered, never dynamically loaded. **No dynamic loading of externally supplied paths exists anywhere.** A manifest's `modules` entry only selects a key from the compiled-in registry.
- AD-3: every use-case returns `Result<T>` from `src/core/result.ts` with kebab-case `error.code`. The CLI envelope/exit-code machinery is generic and already exists (`src/adapters/driving/cli/envelope.ts`, `dispatch.ts`) — do not reinvent it.
- AD-4: a manifest's `modules` is a map of module-id → per-module config; **every entry is a config object, `{}` when the module needs no parameters, never a bare boolean** (AD-4 architecture review invariant, already enforced by `moduleConfigSchema` in `schema.ts:10`).
- **Empty modules stays valid:** a repo with `modules: {}` (or an omitted-modules manifest via a loader decision, see Does-not-reject below) is a valid, module-free repo. AC3's failure is scoped to *unknown ids*, not to having modules at all.
- Keep the `manifest-not-found` loader contract (`src/adapters/driven/manifest/index.ts`) untouched — distinguishing "no manifest" from "module validation failed" is a separate error path, never a rewording of the ENOENT path.
- Validation failure must name the offending module id **and** the repo path it came from — a generic "manifest invalid" is not acceptable (AD-3's "errors surface, never hide").
- NodeNext imports (`../foo.js`), imports first, functional style (no classes), zod 4.4.3 + yaml 2.9.0 already pinned; kebab-case module ids, PascalCase types, camelCase functions.

**Block If:**
- A need surfaces to actually implement a real module (`route-explorer`, `shared-types-consumer`, or a new scanner/auth module) to make validation pass — that is NOT this story; the registry is empty by design and later epics add implementations. HALT with `blocked` and the question if the ACs are interpreted to require a live module implementation.

**Never:**
- No dynamic/module-loading code of any kind; no filesystem walking for modules; no plugin loader.
- No real module implementations in the registry this story (empty registry by design — see Block If).
- No TUI work, no SQLite, no git/docker/process adapters, no locking (Story 1.7), no registry.yaml changes.
- Do not change `service`/`container`/`migrationCommand`/`sharedBranch` semantics or the `modules` *value* shape (still `Record<string, unknown>`).
- Do not silently drop or auto-ignore an unknown module id — it must fail the load.
- No barrel re-export of the new registry from `src/adapters/driven/index.ts` unless a consumer needs it (nothing does yet).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Empty modules (AC2 baseline) | repo `.tui-back.yaml` with `modules: {}` | Loads `ok`; `modules` empty map (AD-4-valid). `list-repos` shows repo with `moduleIds: []` | No error expected |
| Known module id selected | manifest with `modules: { <id>: {} }` where `<id>` IS in the compiled-in registry | Loads `ok`; module resolved/activated for the repo (AC2) | No error expected |
| Unknown module id (AC3) | manifest with `modules: { route-explorer: {} }` but registry empty / id unknown | Load fails with `err('unknown-module')`, message naming the offending id **and** the repo path; never silently ignored | exit 1 |
| Multiple module ids, one unknown | manifest with `modules: { known: {}, unknown-x: {} }` | Fails with `unknown-module` naming the first unknown id encountered (deterministic order) | exit 1 |
| Multiple unknown ids | manifest with `modules: { a: {}, b: {} }` both unknown | Fails naming the first unknown id (deterministic); message may enumerate additional offenders | exit 1 |
| Modules value is a bare boolean | manifest with `modules: { x: true }` | Fails with existing AD-4 shape error (`moduleConfigSchema` rejects) — unchanged behavior, regression guard | exit 1 |
| Existing manifest with no modules validity | any manifest currently loading `ok` in Story 1.5 paths | Must continue to load exactly as before when it has no non-empty `modules` | No error expected |
| list-repos with active modules (AC4) | registered managed repo whose manifest `modules` has entries | `ManagedRepo.moduleIds` lists the module ids (keys), alongside service/container/sharedBranch; output order deterministic | No error expected |
| list-repos with no modules | registered managed repo, `modules: {}` | `ManagedRepo.moduleIds` is `[]`; identity fields unchanged | No error expected |

</intent-contract>

## Code Map

- `src/core/result.ts` -- `ok`/`err` envelope (AD-3). Do not reinvent.
- `src/core/ports/manifest.ts` -- existing `Manifest` + `ManifestPort`. `Manifest.modules` shape is `Record<string, Record<string, unknown>>`; **do not change** (module id keys already present; validation is an adapter concern).
- `src/adapters/driven/modules/module-registry.ts` -- NEW. The compiled-in static registry (AD-5): an exported constant mapping module id → implementation, plus a `knownModuleIds` set and a `resolveModule`/validation helper. **Empty by design** for this story (no real implementations yet); the shape must be the one later epics fill.
- `src/adapters/driven/modules/module-registry.test.ts` -- NEW unit/integration test for the registry constants and helpers (empty mapping, lookups, deterministic).
- `src/adapters/driven/manifest/schema.ts` -- UPDATE. Add a zod cross-validation (`.superRefine`/`.crossRefine`) on the `modules` field: every module id key must be present in the compiled-in registry's known set; an unknown id produces a kebab-case error (e.g. `unknown-module`) naming the id. **Must not import from `core/`** (adapter→driven only; imports from `../modules/module-registry.js`).
- `src/adapters/driven/manifest/index.ts` -- UPDATE. **The current loader (`index.ts:32-42`) rewrites EVERY zod failure into a catch-all `manifest-validation-failed` keyed on the first issue, losing the module-id specificity AC3/AD-3 need (it would say only `modules.route-explorer — Unknown module id ...` with no distinct code).** Extend it so an unknown-module validation issue surfaces a **distinct `unknown-module` error code** naming the offending module id AND the `repoPath` (the loader owns `repoPath`; the schema does not). Preserve the `manifest-not-found` ENOENT path (index.ts:17-19) and the generic `manifest-validation-failed` path for non-module schema errors exactly as-is. Do not crash; do not let a module-id issue be swallowed into the generic code.
- `src/adapters/driven/manifest/index.test.ts` -- UPDATE. Add cases: empty modules loads; unknown id fails with message naming id+path; multiple unknown ids deterministic-first; known id (add a test-only known id or drive via a registry that is empty — see Design Notes on test seam) loads.
- `src/core/scripts/list-repos.ts` -- UPDATE. Extend `ManagedRepo` with `moduleIds: string[]` populated from `loaded.data.modules` keys (ordered deterministically — insertion order of the manifest's `modules` map, or sorted; pick one and assert it). Identity fields (service/container/sharedBranch) untouched.
- `src/core/scripts/list-repos.test.ts` -- UPDATE. Assert `moduleIds` populated and deterministic; empty-repo `moduleIds: []`; no regression to existing identity assertions.
- `src/adapters/driving/cli/envelope.ts` + `envelope.test.ts` -- REVIEW/UPDATE only if the human rendering of `list-repos` needs to show `moduleIds` (TTY branch). The JSON branch passes `ManagedRepo` through generic data rendering already.
- `src/bin/tui-back.e2e.test.ts` -- REVIEW. Add/confirm a black-box `list-repos` case showing `moduleIds` on a managed repo with modules (needs a registry entry + manifest with a known id; see Design Notes test seam for what "known id" is in an empty-registry world).

## Tasks & Acceptance

**Execution:**
- `git` -- branch `story-1-6-static-module-registry` from `epic-1-foundation-navigation-shell`; all work + commits on it; `--no-ff` merge only after code review. Conventional commits with `(story 1.6)` in the subject.
- `src/adapters/driven/modules/module-registry.ts` -- NEW compiled-in registry constant. Shape: `Record<ModuleId, ModuleImplementation>` (or, for an empty registry, `object` of `Record<string, never>`-typed entries) plus `knownModuleIds: ReadonlySet<string>` derived from it and a pure `isKnownModuleId(id): boolean` helper. Functions must be generic functions returning a value derived from a locally-defined type ONLY if imports stay first (acorn landmine — keep imports at the very top of the file). Zero `core/` imports (AD-1); imports `../manifest` types via the core port type import is FORBIDDEN — the registry references module ids as plain `string`/kebab-case, not core types.
- `src/adapters/driven/manifest/schema.ts` -- UPDATE: on the `modules` field add a refine that iterates the map keys and rejects any key not in `knownModuleIds`. The refine raises an issue whose **path is `modules.<id>`** and whose message names the offending module id (`Unknown module id "<id>"`); zod refines normalize to a `custom` issue, so the *kebab-case code* (`unknown-module`) is assigned by the loader (index.ts) when it detects an issue rooted at `modules.` — the schema itself does not fabricate the error code. The repo path is appended by the loader. Empty modules (`{}`) must pass.
- `src/adapters/driven/manifest/index.ts` -- UPDATE: inspect the schema result's issues; when the first issue's path is rooted at `modules.` (an unknown-module refine issue), return `err('unknown-module', 'Unknown module id "<id>" in <repoPath>', ...)` instead of the generic `manifest-validation-failed`. Any other schema issue keeps the existing `manifest-validation-failed` path (index.ts:32-42). Never crash; never alter the `manifest-not-found` path.
- `src/core/scripts/list-repos.ts` -- UPDATE: add `moduleIds: string[]` to `ManagedRepo`; fill from `loaded.data.modules` keys in deterministic order (sorted ascending by default — assert it). Existing `ListReposData` shape otherwise unchanged.
- Tests -- `module-registry.test.ts` (registry + helper invariants); `manifest/index.test.ts` (mount loader against real temp-dir manifests: empty-, single-known-, mixed-, all-unknown-, bare-boolean-`modules` cases); `core/scripts/list-repos.test.ts` (fake manifest port returning a known-id manifest → moduleIds filled; empty → `[]`); `tui-back.e2e.test.ts` (black-box `list-repos` with a temp `XDG_CONFIG_HOME` + a temp repo manifest, asserting `moduleIds` in the JSON envelope).
- Gates -- `npm test && npm run typecheck && npm run depcheck`; AD-1 round-trip (inject a `core → adapters` import in a new file, confirm `no-core-to-adapters` fires, remove it).
- Commit -- atomic conventional commits, `(story 1.6)` in subject.

**Acceptance Criteria:**
- Given the tool's source, when built, then it ships one compiled-in registry mapping module id to implementation, and no dynamic loading of externally supplied paths exists anywhere (AC1).
- Given a manifest declaring a module id present in the registry, when loaded, then that module is resolved and activated for the repo (AC2).
- Given a manifest declaring an unknown module id, when loaded, then loading fails with a clear error naming the offending id — never silently ignored (AC3).
- Given `tui-back list-repos` run against a repo with an active module, when displayed, then the repo's active module ids show alongside its identity (AC4).

## Dev Notes

- **Read the files being modified before changing them:** `src/adapters/driven/manifest/schema.ts` (zod, already type-linked to `Manifest`), `src/adapters/driven/manifest/index.ts` + test (loader + `manifest-not-found` contract), `src/core/scripts/list-repos.ts` + test (`ManagedRepo`), `src/adapters/driving/cli/envelope.ts`/`dispatch.ts`, `src/bin/main.ts`, `src/bin/tui-back.e2e.test.ts`. Preserve every existing behavior those tests assert.
- **Registry is a driven-adapter concern, not core.** Adding the registry to `core/` would break AD-1 the moment a real module implementation (route-explorer scanner, shared-types) needs adapter-only dependencies (OpenAPI parsing, git, process). Keep it under `src/adapters/driven/modules/`. The manifest adapter imports it; core never sees it.
- **Empty-registry test seam (design decision, D1):** with zero known module ids, "AC2 loads a known id" cannot be exercised against the *production* empty registry. Options: (a) export a factory that accepts an injected registry map so tests pass a fake known-id registry (keeps production empty but testable), or (b) register a test-only known id. Prefer (a): `resolveModule(registry, id)`/`validateModules(modules, registry)` as pure functions taking the registry as an argument, with a production `moduleRegistry` constant defaulting to empty. Do NOT bake a fake id into production.
- **Where the repo path reaches the error (D2, resolved):** the zod `schema.ts` refine cannot know `repoPath`, so it raises an issue rooted at `modules.<id>` naming the id; the loader (`index.ts`) detects that root, appends `repoPath`, and assigns the `unknown-module` code. This is mechanism-option (b) — the schema returns the bare id, the loader enriches it with the path and the kebab-case code.
- **Determinism:** iterate `modules` keys in a stable order when validating and when building `moduleIds` (prefer sorted ascending). This keeps `list-repos` byte-idempotent (FR-1) and makes "first unknown id" in the error deterministic and testable.
- **Do not break the AD-4 shape rule:** the bare-boolean rejection and `moduleConfigSchema` (`schema.ts:10`) are pre-existing; the new refine is *additive* (module-id membership) on top of the value-shape check.
- **lib/framework:** none beyond the pinned zod 4.4.3 for validation. No new dependency. The registry is a plain TS constant + functions.

### Project Structure Notes

- New driven folder `src/adapters/driven/modules/` is aligned with the Spine tree (`ARCHITECTURE-SPINE.md` maps `driven/modules/*` for company-specific modules; AD-5). Only the *registry mechanism* lives here this story; real per-module subfolders (`route-explorer/`, `shared-types/`) fill in from Epics 6/4.
- No `src/core/` changes beyond the `list-repos.ts` `ManagedRepo` field (core already structurally holds `modules` keys as plain strings; AD-5 keeps the authoritative registry on the adapter side).

### References

- [Source: `_bmad-output/planning-artifacts/epics.md#Story-1.6` (lines 310-333)] — user story, AC1-AC4 verbatim.
- [Source: `_bmad-output/planning-artifacts/architecture/.../ARCHITECTURE-SPINE.md#AD-5`] — "module implementations are statically registered, never dynamically loaded"; manifest selects a key; kebab-case module ids.
- [Source: `ARCHITECTURE-SPINE.md` AD-4] — modules is a map, every entry a config object never a bare boolean; repo/module absent → invisible.
- [Source: `_bmad-output/implementation-artifacts/1-4-manifest-schema-loader-validation.md`] — manifest loader + `manifest-not-found` contract; deferred item "bare `modules:` (null) fails validation; only explicit `{}` expresses empty map — decide whether to accept null as empty."
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md`] — acorn-fallback landmine (imports first), `manifestSchema` widened to `z.ZodType<Manifest>` (zod 4.4.3 has no runtime `.satisfies()`), the `no-core-to-adapters` boundary rule and its unanchored `adapters(/|$)` matching.
- [Source: `_bmad-output/implementation-artifacts/1-5-explicit-repo-registry.md`] — prior-story patterns: `ManagedRepo` (path/service/container/sharedBranch), adapter-owns-filesystem, error-matrix conventions, Review Triage Log format.
- [Source: `_bmad-output/implementation-artifacts/epic-1-context.md`] — Epic 1 goal, cross-story deps (1.4 underpins 1.6 module resolution/validation; unknown-id failure rides on 1.4's validation).

## Task / Acceptance Traceability

- AC1 (compiled-in registry + no dynamic loading) → Code Map `module-registry.ts` (NEW) + Tasks registry/helper + tests.
- AC2 (known id resolves/activates) → Code Map `schema.ts` refine accepting known ids + `manifest/index.test.ts` (via injected fake registry).
- AC3 (unknown id → clear named error, never ignored) → Code Map `schema.ts`/`index.ts` `unknown-module` + tests + I/O matrix rows 4-6.
- AC4 (list-repos shows module ids) → Code Map `list-repos.ts` `moduleIds` + tests + e2e.

## Dev Agent Record

### Agent Model Used

(opencode/deepseek-v4-flash-free — story-authored by create-story workflow, 2026-08-13)

### Debug Log References

- 2026-08-13 — implemented story 1.6 on branch `story-1-6-static-module-registry` (from `epic-1-foundation-navigation-shell`).
- 2026-08-13 — AD-1 round-trip verified: an injected `core → adapters` import (imports-first, NodeNext `.js` specifier) against the new `module-registry.ts` correctly fires `no-core-to-adapters`; removed. Also confirmed the acorn-fallback landmine still silently drops a trailing import in the generic-union-function shape (expected, imports-first convention applies).
- 2026-08-13 — final gates: `npm test` 140 passed, `npm run typecheck` clean, `npm run depcheck` no violations (77 modules).

### Completion Notes List

- Ultimate context engine analysis completed — comprehensive developer guide created. Story implementation complete and ready for review.
- Implemented the compiled-in static module registry (`src/adapters/driven/modules/module-registry.ts`, AD-5) — empty by design this story; `knownModuleIds`/`isKnownModuleId`/`resolveModule`/`validateModules` exposed as pure functions with an injected-registry seam (D1).
- Manifest adapter cross-validates every `modules` key against the known module set: `schema.ts` gains `createManifestSchema(known)` + a `modules.*` superRefine (membership only checked for well-formed config objects, so bare-boolean/array/null stay on the AD-4 shape error — no double-report); `index.ts` detects an issue rooted at `modules.` with the `Unknown module id "…"` message and returns a distinct kebab-case `unknown-module` error naming the id AND the repo path (D2). Empty `modules: {}` stays valid.
- `list-repos`: `ManagedRepo` gains `moduleIds: string[]`, populated from the loaded `modules` keys in sorted-ascending order (FR-1/determinism). Envelope needs no change — `moduleIds` flows through the generic JSON/human rendering.
- Tests: `module-registry.test.ts` (registry + helpers), new `manifest/index.test.ts` cases (empty modules loads; unknown id → `unknown-module` naming id+path; known id via injected registry; multiple-unknown deterministic-first; mixed known/unknown), `list-repos.test.ts` (moduleIds sorted populated + `[]` baseline), and black-box `tui-back.e2e.test.ts` (`moduleIds: []` in the JSON envelope; a modules-carrying manifest surfaces as `unknown-module` in `list-repos` errors, since the production registry is empty by design — a real non-empty `moduleIds` e2e case is deferred until Epics 4/6 add an implementation).
- All ACs met: AC1 (compiled-in registry, no dynamic loading), AC2 (known id resolves via injected seam), AC3 (unknown id → named error, never ignored), AC4 (list-repos shows module ids).

### File List

- NEW: `src/adapters/driven/modules/module-registry.ts`, `src/adapters/driven/modules/module-registry.test.ts`
- UPDATE: `src/adapters/driven/manifest/schema.ts`, `src/adapters/driven/manifest/index.ts`, `src/adapters/driven/manifest/index.test.ts`
- UPDATE: `src/core/scripts/list-repos.ts`, `src/core/scripts/list-repos.test.ts`
- REVIEW: `src/adapters/driving/cli/envelope.ts`, `envelope.test.ts` — reviewed, no change required (`moduleIds` flows through the generic rendering).
- UPDATE: `src/bin/tui-back.e2e.test.ts` (list-repos `moduleIds` + unknown-module error cases)
- ARTIFACT: `_bmad-output/implementation-artifacts/1-6-static-module-registry.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml`

### Change Log

- 2026-08-13 — Implemented story 1.6 Static Module Registry; mark for review. Added compiled-in static module registry (AD-5), manifest-level module-id validation surfacing a distinct `unknown-module` error, and `moduleIds` on `list-repos` managed repos. New error code surfaced and documented in the I/O matrix (rows 5-6): `unknown-module` — a manifest names a module id not in the compiled-in registry; loader returns `err('unknown-module', 'Unknown module id "<id>" in <repoPath>')`, never silently ignored.

### Review Findings

- [x] [Review][Patch] `resolveModule` returns inherited prototype members (`toString`, `constructor`, …) instead of `undefined` for a non-own id, so it falsely reports a non-module as resolved — missing own-property guard [src/adapters/driven/modules/module-registry.ts:26] — fixed with `hasOwnProperty` guard + regression test
- [x] [Review][Patch] `validateModules` returns unknown ids in insertion order (test asserts `['a','b']`), inconsistent with the schema's sorted FR-1 determinism — sort its output [src/adapters/driven/modules/module-registry.ts:33] — fixed with `.sort()` + updated/added tests
- [x] [Review][Patch] `list-repos` computes `moduleIds` with `Object.keys(loaded.data.modules)` assuming `modules` is always present on an `ok` manifest — guard non-object/undefined for the core port boundary [src/core/scripts/list-repos.ts:62] — fixed with `?? {}`
- [x] [Review][Patch] new kebab-case `unknown-module` error code not documented in the story I/O/error matrix (Story 1.5 precedent) [src/adapters/driven/manifest/index.ts:52] — fixed: documented in the I/O matrix + Change Log
- [x] [Review][Defer] TTY/human rendering of a `ListReposData` payload carrying `moduleIds` never tested — generic renderer makes regression unlikely [src/adapters/driving/cli/envelope.ts] — deferred, verification gap only
- [x] [Review][Defer] AC4 non-empty `moduleIds` never e2e-tested — intentional, production registry empty by design (needs Epics 4/6) [src/bin/tui-back.e2e.test.ts] — deferred, documented
