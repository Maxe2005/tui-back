---
title: 'Explicit Repo Registry'
type: 'feature'
created: '2026-08-12'
status: 'complete'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: [oversized]
deferred: []
baseline_revision: '314d2bac3e453095cefa32fb80f3b2ef543fa58a'
---

<intent-contract>

## Intent

**Problem:** The tool has no way to know which local repo paths it manages. Without an explicit registry it would fall back to assuming a single-machine directory layout, exactly what AD-6 forbids. Story 1.5 is also the first real Must-scope action — proving FR-1's standalone, idempotent, shell-invocable pattern that every later epic builds on.

**Approach:** Introduce a `RegistryPort` (declared in `core/ports`) implemented by a new driven `registry` adapter that persists a list of registered paths to `XDG_CONFIG_HOME/tui-back/registry.yaml` (reusing Story 1.2's XDG resolution). Three core use-cases — `registerRepo`, `listRepos`, `scanRepos` — are wrapped by three new CLI subcommands (`register <path>`, `list-repos`, `scan <root>`). `scan` proposes candidate manifest-carrying dirs and never auto-registers (AD-6).

## Boundaries & Constraints

**Always:**
- AD-1: `core/` never imports from `adapters/`; the driven `registry` adapter implements `RegistryPort` declared in `core/ports`. depcheck enforces this — keep imports first in every file.
- AD-2: each subcommand is a thin wrapper around exactly one core use-case; the TUI (Epic 2+) calls the same use-cases in-process.
- AD-3: every use-case returns `Result<T>` from `src/core/result.ts` with kebab-case `error.code`; the CLI envelope/exit-code machinery already exists — do not reinvent it.
- AD-6 / FR-2: `scan` only proposes, never registers; unmanaged dirs (no valid `.tui-back.yaml`) are silently skipped by `list-repos`; no name-based special-casing of repo/service ids anywhere.
- Deterministic, idempotent output: registry ordering is stable; `scan` results sorted — FR-1's idempotency AC.
- NodeNext imports (`../foo.js`), imports first, functional style (no classes), zod 4.4.3 + yaml 2.9.0 already pinned.

**Block If:**
- None identified. All decisions below are derivable from AD-2/AD-3/AD-6/FR-2, the ACs, and prior-story precedent. (If one surfaces mid-run, HALT with `blocked` + the question.)

**Never:**
- No auto-registration during `scan`; no dynamic module loading (Story 1.6); no module-id validation (Story 1.6).
- No TUI work, no SQLite, no git/docker/process adapters, no locking (Story 1.7).
- Do not modify `loadManifest`'s `manifest-not-found` contract or `envelope.ts`/`dispatch.ts` internals — the existence probe that distinguishes "unreachable" from "unmanaged" lives in `RegistryPort.exists`, not in the manifest loader.
- No example `.tui-back.yaml` shipping (separate deferred item).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| register happy path | `register /abs/repo` | Path persisted to `registry.yaml` (configDir ensured); `ok`, exit 0 | No error expected |
| register missing arg | `register` | `err('missing-argument')`, usage in message | exit 1 |
| register relative path | `register ./repo` | `err('invalid-argument')` — registry stores only absolute paths | exit 1 |
| register already-present path | register `/abs/repo` twice | Second call is a no-op success (deduped), registry unchanged — idempotent (FR-1) | No error expected |
| list-repos mixed states | registry holds managed, unmanaged, and nonexistent paths | `data: { repos: ManagedRepo[], unreachable: string[], errors: RegistryEntryError[] }`; unmanaged silently omitted; exit 0 | No error expected |
| list-repos idempotency | `list-repos` twice, no intervening change | Byte-identical stdout | No error expected |
| list-repos empty registry | no `registry.yaml` | `ok` with empty `repos`/`unreachable`/`errors`; exit 0 | No error expected |
| list-repos corrupt registry | `registry.yaml` malformed YAML / wrong shape | `err('registry-invalid-yaml'|'registry-invalid-format')`, never a crash | exit 1 |
| scan happy path | `scan /abs/root` with 2 manifest-carrying subdirs | `data: { candidates: string[] }` (absolute, sorted); registry unchanged — nothing registered | No error expected |
| scan missing arg | `scan` | `err('missing-argument')`, usage in message | exit 1 |
| scan nonexistent root | `scan /does/not/exist` | `err('scan-root-not-found')`, never a crash | exit 1 |
| scan with no candidates | `scan` over a manifest-less root | `ok` with empty `candidates`; exit 0 | No error expected |

</intent-contract>

## Code Map

- `src/core/result.ts` -- `ok`/`err` envelope every use-case returns (AD-3). Do not reinvent.
- `src/core/ports/manifest.ts` -- existing `Manifest` + `ManifestPort.load(repoPath)`. `listRepos` consumes this; do not change its shape.
- `src/core/ports/registry.ts` -- NEW. `RegistryPort { list(): Promise<Result<string[]>>; add(path): Promise<Result<void>>; exists(path): Promise<Result<boolean>>; scan(root): Promise<Result<string[]>>; }`.
- `src/core/scripts/register.ts`, `list-repos.ts`, `scan.ts` -- NEW use-cases (Spine tree `core/scripts/` = script/subcommand use-cases). Functional, injected ports.
- `src/adapters/driven/registry/index.ts` + `schema.ts` + `index.test.ts` -- NEW driven adapter (Spine tree `driven/registry/` = managed-repo path registry). Persists/reads `registry.yaml`; `scanRoot` walks a root proposing candidate dirs.
- `src/adapters/driven/xdg/index.ts` -- `resolveXdgPaths()` (→ `configDir`) + `ensureXdgDir()`; registry file = `join(configDir, 'registry.yaml')`.
- `src/adapters/driven/manifest/schema.ts` -- add a type-level `satisfies z.ZodType<Manifest>` assertion (closes deferred item "no type-level link between schema and core Manifest", now that Story 1.5 is a real consumer).
- `src/adapters/driving/cli/subcommands.ts` -- NEW. `buildSubcommands(deps: { registry: RegistryPort; manifest: ManifestPort }): Subcommand[]` + `assertUniqueSubcommandNames(...)` (closes deferred item "no duplicate-subcommand-name guard in runCli" — 1.5 is the first story registering multiple subcommands).
- `src/bin/main.ts` -- wire `RegistryPort` (from `resolveXdgPaths()`) + `ManifestPort` (from `loadManifest`), call `buildSubcommands`, feed `runCli`. Keep `ping`.
- `src/bin/tui-back.e2e.test.ts` -- extend with black-box `register`/`list-repos`/`scan` using a temp `XDG_CONFIG_HOME` env override.
- `src/adapters/driving/cli/dispatch.test.ts` -- add the duplicate-name guard test.

## Tasks & Acceptance

**Execution:**
- `git` -- branch `story-1-5-explicit-repo-registry` from `epic-1-foundation-navigation-shell`; all work + commits on it; `--no-ff` merge only after review.
- `src/core/ports/registry.ts` -- NEW `RegistryPort` interface (list/add/exists/scan). Imports first; zero adapter imports (AD-1); no barrel re-export (no consumer in `src/core/index.ts` until a TUI needs it).
- `src/adapters/driven/registry/schema.ts` -- NEW zod schema for `registry.yaml` (`{ repos: string[] }`, `.strict()`), mirroring the manifest-schema conventions.
- `src/adapters/driven/registry/index.ts` -- NEW driven adapter: `listRegistry(registryFile)`, `addRegistry(registryFile, path)` (dedupe + `ensureXdgDir` on configDir + write via yaml `stringify`), `registryPathExists(path)` (stat probe), `scanRoot(root)` (recursive walk, skip dot-dirs + `node_modules`, don't follow dir symlinks, sorted output). Missing file → empty list; malformed YAML/shape → kebab error codes (`registry-invalid-yaml`, `registry-invalid-format`).
- `src/core/scripts/register.ts` -- `registerRepo(registry, path)`: missing arg → `missing-argument`; non-absolute → `invalid-argument`; else `registry.add(path)`.
- `src/core/scripts/list-repos.ts` -- `listRepos(registry, manifest)`: for each registered path, `exists()` → false → `unreachable`; else `manifest.load()` → ok → `repos` (path, service, container, sharedBranch) | `manifest-not-found` → skip silently | other error → `errors`.
- `src/core/scripts/scan.ts` -- `scanRepos(registry, root)`: missing arg → `missing-argument`; root probe failure → `scan-root-not-found`; else `registry.scan(root)` → `{ candidates }`.
- `src/adapters/driven/manifest/schema.ts` -- add `satisfies z.ZodType<Manifest>` to `manifestSchema` (typecheck-driven; if the exact generic form is rejected, annotate the const explicitly). Closes a deferred item.
- `src/adapters/driving/cli/subcommands.ts` -- NEW `buildSubcommands` returning `register`, `list-repos`, `scan`, plus `ping`; `assertUniqueSubcommandNames` throws on duplicates.
- `src/bin/main.ts` -- construct `registryFile = resolveRegistryFile(resolveXdgPaths())`; build ports; wire subcommands; keep the existing `runCli`/exit-code handling untouched.
- Tests -- `core/scripts/*.test.ts` (fake ports, unit); `src/adapters/driven/registry/index.test.ts` (real temp dirs, integration); `dispatch.test.ts` + `tui-back.e2e.test.ts` (black-box with temp `XDG_CONFIG_HOME`).
- Gates -- `npm test && npm run typecheck && npm run depcheck`; AD-1 round-trip (inject a `core → adapters` import, confirm `no-core-to-adapters`, remove).
- Commit -- atomic conventional commits, `(story 1.5)` in subject.

**Acceptance Criteria:**
- Given no prior registration, when `tui-back register <path>` runs, then the path is added to `XDG_CONFIG_HOME/tui-back/registry.yaml` and the command succeeds with the AD-3 envelope.
- Given registered paths, when `tui-back list-repos` runs, then every managed repo's identity (path + service/container/sharedBranch) is listed and unmanaged directories are silently skipped.
- Given no intervening registry change, when `tui-back list-repos` runs twice, then both runs produce identical output (FR-1 idempotency).
- Given a registered path that no longer exists on disk, when `list-repos` runs, then that entry is reported unreachable rather than crashing the listing.
- Given a `tui-back scan <root>` subcommand, when run, then it proposes candidate manifest-carrying directories without ever auto-registering any (AD-6).
- Given the production subcommand registry, when inspected, then no two subcommand names collide (duplicate-name guard).

## Spec Change Log

- 2026-08-12 — **Implementation deviation (documented, intent preserved):** the manifest-schema type-level link uses an explicit `z.ZodType<Manifest>` annotation instead of `.satisfies(z.ZodType<Manifest>)` — zod 4.4.3 ships no runtime `.satisfies()` method (`z.object(...).strict().satisfies` throws `TypeError: ... .satisfies is not a function`). The spec already anticipated this fallback ("if the exact generic form is rejected, annotate the const explicitly"). The type-level link intent is intact: a drift between `manifestSchema` and core `Manifest` fails typecheck in either direction. Behavior unchanged.
- 2026-08-12 — **Implementation notes recorded:** `RegistryPort` has no barrel re-export (no `src/core/index.ts` consumer yet, per spec). `register` returns `ok({ path })` on success (informative AD-3 data, not specified by the matrix). `addRegistry` surfaces write failures as `registry-write-error`; `registryPathExists` stat failures as `registry-stat-error` — both kebab-case, surfaced via `listRepos`'s `errors` array. Both deferred-work items this story closes are reflected in the Code Map's changed files.

## Review Triage Log

_Empty until the first review pass._

## Design Notes

- **`exists()` lives on `RegistryPort`, not in the manifest loader.** Story 1.4's deferred-work flags that `manifest-not-found` conflates "no manifest" and "path doesn't exist". Rather than rewiring the loader's contract (pre-existing, out of scope), the driven registry adapter owns the filesystem probe — listRepos distinguishes unreachable (`!exists`) from unmanaged (`exists` but `manifest-not-found`) with no change to Story 1.4 code.
- **Registry file shape:** `registry.yaml` is a strict `{ repos: string[] }` map (not a bare list) so future fields (e.g. per-path annotations) don't need a format migration. yaml 2.9.0 `parse`/`stringify` mirror the manifest adapter.
- **Determinism:** `list-repos` preserves registry-file order; `scan` sorts candidates; both are prerequisites for the FR-1 idempotency AC and are cheap to assert in tests.
- **Register is deliberately shallow:** AC1 only requires the path be added, so `register` does no manifest/existence validation of the target — a path may be registered before its repo exists (that's what `unreachable` reporting is for). Relative paths are rejected to keep stored paths unambiguous.
- **`errors` array:** a registered path whose manifest fails validation/YAML/read is surfaced as an error entry, not silently dropped and not a crash — consistent with AD-3's "errors surface, never hide" spirit, while AC3's silent skip applies only to the genuinely unmanaged case.

## Verification

**Commands:**
- `npm test` -- expected: all suites green, including new `core/scripts`, `registry` integration, dispatch, and e2e cases.
- `npm run typecheck` -- expected: clean.
- `npm run depcheck` -- expected: clean; AD-1 round-trip confirms `no-core-to-adapters` fires.
- `node src/bin/tui-back.mjs register <tmp>/repo && node src/bin/tui-back.mjs list-repos && node src/bin/tui-back.mjs scan <tmp>` -- expected: AD-3 envelopes; run `list-repos` twice and diff output (identical).

**Manual checks (if no CLI):**
- Inspect a temp `XDG_CONFIG_HOME`-scoped `registry.yaml` after `register` to confirm exact file shape.
