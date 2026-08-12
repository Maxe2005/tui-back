---
baseline_commit: f7a4068a6fd2eddc8a07c40ea554548907063af9
---

# Story 1.4: Manifest Schema, Loader & Validation

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want the tool to recognize a repo only through a versioned manifest file,
so that an unmanaged repo is never accidentally touched.

## Acceptance Criteria

1. **Given** a repo with a root `.tui-back.yaml` declaring `service`, `container`, `migrationCommand`, `modules`, **when** loaded, **then** it validates against the zod schema and exposes the identity/modules to core.
2. **Given** a manifest missing a required field, **when** loaded, **then** loading fails with a clear validation error naming the field — never a generic crash.
3. **Given** a repo with no `.tui-back.yaml`, **when** scanned, **then** it is treated as unmanaged and excluded from every action, with no special-case code (FR-2).
4. **Given** a manifest without an explicit `sharedBranch`, **when** loaded, **then** it defaults to `development` (AD-4).
5. **Given** a manifest declaring a `modules` map, **when** loaded, **then** the declared ids and config are exposed as-is (validation against the module registry happens in Story 1.6).

## Tasks / Subtasks

- [ ] Task 1: Branch for this story (no AC — repo convention, `CLAUDE.md`)
  - [ ] From `epic-1-foundation-navigation-shell`, create `story-1-4-manifest-schema-loader-validation`
  - [ ] Do all work for this story on that branch; do not commit directly to the epic branch
  - [ ] Verify against the current epic-branch HEAD (`f7a4068`, baseline_commit above) so the diff is exactly this story's work

- [ ] Task 2: Add runtime dependencies `zod@4.4.3` and `yaml@2.9.0` (no AC — Stack-table pins; prerequisite for every later task)
  - [ ] `npm install --save-exact zod@4.4.3 yaml@2.9.0` — these land in `package.json` **`dependencies`** (the first runtime deps in the repo; everything so far is `devDependencies`)
  - [ ] Pin exactly, no caret: `"zod": "4.4.3"`, `"yaml": "2.9.0"` — matches the Spine Stack table
  - [ ] Do **not** use `yaml@next` (the `v3.0.0-1` prerelease); 2.9.0 is the latest stable and the pinned choice
  - [ ] Confirm `node_modules/zod` and `node_modules/yaml` resolve under NodeNext before writing code (quick `import` smoke check or rely on Task 8's typecheck)

- [ ] Task 3: Define the core `Manifest` type and `ManifestPort` interface (AC: 1 — "exposes the identity/modules to core")
  - [ ] New file `src/core/ports/manifest.ts` — **first file under `core/ports/`** (Spine tree lists `ManifestPort` there)
  - [ ] Content shape:
    ```ts
    import type { Result } from '../result.js';

    export interface Manifest {
      service: string;
      container: string;
      migrationCommand: string;
      sharedBranch: string;
      modules: Record<string, Record<string, unknown>>;
    }

    export interface ManifestPort {
      load(repoPath: string): Promise<Result<Manifest>>;
    }
    ```
  - [ ] `sharedBranch` is a non-optional `string` on the core type: the loader applies the `development` default **at load time** (AC4), so every value core ever sees is concrete — no `sharedBranch?: string` leaking the "may be absent" ambiguity into core
  - [ ] `modules` is `Record<string, Record<string, unknown>>` — module id → **config object**. A module's config is always an object (`{}` when config-less, **never a bare boolean**) — invariant from the AD-4 review (see Dev Notes; the schema in Task 4 enforces it)
  - [ ] NodeNext relative import with `.js` extension (`../result.js`, not `../result`); imports are the first statements in the file (Story 1.3's depcheck landmine convention)
  - [ ] Zero imports from `adapters/` — this file is the AD-1 boundary (depcheck enforces; Task 7 round-trips it)
  - [ ] Do **not** add a barrel re-export in `src/core/index.ts` — no consumer yet (Story 1.2/1.3 precedent: barrels only once a consumer exists)

- [ ] Task 4: Build the zod manifest schema (AC: 1, 4, 5)
  - [ ] New file `src/adapters/driven/manifest/schema.ts`; `import { z } from 'zod'` first
  - [ ] Schema (verified against `zod@4.4.3` in a sandbox on 2026-08-12 — see Dev Notes "Verified behaviors"):
    ```ts
    import { z } from 'zod';

    export const moduleConfigSchema = z.record(z.string(), z.unknown());

    export const manifestSchema = z.object({
      service: z.string().min(1),
      container: z.string().min(1),
      migrationCommand: z.string().min(1),
      sharedBranch: z.string().optional().default('development'),
      modules: z.record(z.string(), moduleConfigSchema),
    });
    ```
  - [ ] Required fields: `service`, `container`, `migrationCommand` (non-empty via `min(1)`), `modules` (may be `{}`). Only `sharedBranch` is optional-with-default (AD-4)
  - [ ] No `schemaVersion` field — the architecture decided v1 has none (single author, no migration need). Do not invent one
  - [ ] zod v4 API rules that WILL bite if you carry v3 habits (all verified):
    - `z.record` takes **two** args (`z.record(keySchema, valueSchema)`) — the one-arg form is removed, not deprecated
    - Error detail lives on `error.issues` — `error.errors` was removed in v4
    - If you add custom error text later, the option key is `error`, not `message`
    - `.default('development')` on an optional string **does** apply for a missing key (verified)
    - `z.string().min(1)` still works in v4
  - [ ] Enforce the "config object, never bare boolean" invariant (review Finding 6): a `modules` entry like `shared-types-consumer: true` must fail validation with a clear path (verified: issue at `modules.shared-types-consumer`, "expected record, received boolean"). `moduleConfigSchema = z.record(z.string(), z.unknown())` gives exactly this — do not loosen it to `z.unknown()` directly

- [ ] Task 5: Build the manifest loader (AC: 1, 2, 3, 4, 5)
  - [ ] New file `src/adapters/driven/manifest/index.ts`; imports first
  - [ ] `export async function loadManifest(repoPath: string): Promise<Result<Manifest>>` — implements the `ManifestPort.load` contract (Story 1.5's `list-repos`/`scan` will call this; no class wrapper needed, match the codebase's functional style)
  - [ ] Logic, in order:
    1. `readFile(join(repoPath, '.tui-back.yaml'), 'utf8')` from `node:fs/promises`
       - `ENOENT` → `err('manifest-not-found', ...)` — **the unmanaged primitive**. This is what Story 1.5's "unmanaged dirs are silently skipped" keys off. No crash, no special-casing of repo names
       - Any other fs error (EACCES, EISDIR, …) → `err('manifest-read-error', ...)` including the fs error text
    2. `parse(content)` — named import from `yaml` (v2.9.0) — inside `try/catch`. A thrown `YAMLParseError` (verified: malformed YAML like an unclosed flow sequence throws) → `err('manifest-invalid-yaml', ...)`
    3. `manifestSchema.safeParse(parsed)` — never `.parse()` (no throwing)
       - `!success` → `err('manifest-validation-failed', message, { issues })` where `message` **names the failing field(s)** (AC2) — e.g. `Invalid .tui-back.yaml: migrationCommand — Invalid input: expected string, received undefined`, built from `error.issues[0].path.join('.')` + `.message`, and `details.issues` carries the full list. Never a raw zod object or a generic crash escaping
       - `success` → `ok(parsed.data)` — `sharedBranch` is already `'development'`-defaulted (AC4); the object satisfies core's `Manifest` (AC1)
  - [ ] All error codes kebab-case (Story 1.3 precedent, now in the Spine Consistency Conventions): `manifest-not-found`, `manifest-read-error`, `manifest-invalid-yaml`, `manifest-validation-failed`
  - [ ] AC3 "no special-case code": nothing in this story (loader or core) may hardcode or branch on specific repo/service ids — "unmanaged" is purely the absence of `.tui-back.yaml` → `manifest-not-found`
  - [ ] The loader never writes YAML — the tool only reads manifests; repo developers author them by hand

- [ ] Task 6: Integration tests, real temp dirs (AC: 1–5; AD-13: driven adapter vs real system)
  - [ ] New file `src/adapters/driven/manifest/index.test.ts`; use `mkdtemp(join(tmpdir(), 'tui-back-manifest-'))`, write real `.tui-back.yaml` files with `node:fs/promises`, clean up in `afterEach`/`afterAll` (Story 1.2's temp-dir precedent). Do **not** mock `node:fs`
  - [ ] Cover, with RED-first each time:
    - AC1: valid manifest → `ok`; `service`/`container`/`migrationCommand`/`sharedBranch`/`modules` all present with exact values
    - AC2: omit `migrationCommand` → `err('manifest-validation-failed')`, message names `migrationCommand`, `details.issues` present, **no throw**
    - AC3: empty dir (no `.tui-back.yaml`) → `err('manifest-not-found')`, no throw
    - AC4: manifest without `sharedBranch` → `ok`, `sharedBranch === 'development'`
    - AC5: `modules: { 'route-explorer': { scanner: 'nestjs-openapi', auth: 'jose-dev-jwt' }, 'shared-types-consumer': {} }` → `ok`, ids + config exposed as-is
    - Finding-6 invariant: `modules: { 'shared-types-consumer': true }` → `manifest-validation-failed`, issue path `modules.shared-types-consumer`
    - Invalid YAML (e.g. `a: [unclosed`) → `err('manifest-invalid-yaml')`, no throw
    - Empty file (`''`) → `manifest-validation-failed` (verified: `parse('')` returns `null`; zod reports it cleanly), no crash
    - Explicit `sharedBranch: preprod` → preserved, NOT defaulted (default applies only when absent)
    - `repoPath` pointing at a plain file (or otherwise unreadable) → controlled error (`manifest-read-error` or an fs-derived error code), never a throw — this locks the `not-found` vs `read-error` distinction Story 1.5 depends on
  - [ ] Pure error-path tests can additionally assert `loadManifest` returns a `Result` that is `ok:false` — i.e. `expect(result).toMatchObject({ ok: false, error: { code: 'manifest-not-found' } })`

- [ ] Task 7: Depcheck — new files scanned + AD-1 boundary still enforced (no AC — project-wide gates from Story 1.1)
  - [ ] `npm run depcheck` — clean; confirm the module/dependency count grew by exactly the new files (`core/ports/manifest.ts`, `adapters/driven/manifest/schema.ts`, `adapters/driven/manifest/index.ts`)
  - [ ] Round-trip (Stories 1.1/1.2/1.3 precedent): temporarily add a deliberate `core → adapters` import to `src/core/ports/manifest.ts` (e.g. `import '../adapters/driven/manifest/index.js'`), run depcheck, confirm it fails with `no-core-to-adapters`, remove it, re-run clean
  - [ ] Imports-first in every new file (Story 1.3's depcheck/acorn landmine convention). Our files use zod's generic functions but don't *define* local generic-union helpers, so the landmine shouldn't trigger — the convention still must hold

- [ ] Task 8: Verify quality gates and finalize (no dedicated AC — project-wide gates)
  - [ ] `npm run typecheck` — clean. This is the first story to import third-party types into `src/`; if zod/yaml types don't resolve under NodeNext, fix before proceeding (both ship ESM-compatible declarations; verified installable)
  - [ ] `npm test` — all green, including the new manifest suite and all prior suites (no regressions)
  - [ ] `npm run depcheck` — clean (final)
  - [ ] Order: `npm test && npm run typecheck && npm run depcheck`

- [ ] Task 9: Commit atomically (no AC — repo convention from `CLAUDE.md`)
  - [ ] Separate commits for: story docs + sprint-status (Task 1), deps (Task 2), core `ManifestPort` (Task 3), schema (Task 4), loader (Task 5), tests (Task 6), depcheck verification/deferred notes if any (Task 7) — each a Conventional Commit in English with `(story 1.4)` in the subject, body explaining *why*
  - [ ] Do not merge into the epic branch — that happens only after code review, via `git merge --no-ff` (Story 1.3 precedent)

## Dev Notes

**Where this code lives and why (`ARCHITECTURE-SPINE.md`):**
- `adapters/driven/manifest/` is the Spine's designated folder — `.tui-back.yaml` read + zod validation (`# .tui-back.yaml read + zod validation` in the `src/` tree). This story creates that leaf folder.
- `core/ports/manifest.ts` is the **first file under `core/ports/`**. The `Manifest` type must live in core (not the adapter) so core use-cases can consume manifests without importing the adapter — that's AD-1's rule and the reason the Spine lists `ManifestPort` in `core/ports`. The driven adapter implements the port; `adapters/driven/manifest` may import `Result`/`Manifest` from core (allowed direction), core may never import the adapter (depcheck-enforced).
- **AD-4 is this story's core mechanism**: a repo is managed iff it carries a root `.tui-back.yaml`, zod-validated on load, declaring `service`, `container`, `migrationCommand`, optional `sharedBranch` (default `development`), and `modules` (module-id → per-module config). This story implements the load+validate surface; the module **registry** (AD-5, unknown-module-id rejection, "activated" resolution) is Story 1.6 — the loader exposes module ids/config as-is (AC5) and must NOT validate ids against any registry yet.
- **AD-3**: the loader returns `Result<Manifest>` with kebab-case `error.code`s. No envelope serialization happens in the adapter — Story 1.5+'s core use-cases receive the same `Result` and the CLI/TUI render it via the existing `renderResult`/`runCli` machinery. Do not reinvent output handling.
- **AD-13**: driven adapters get targeted integration tests against the real system — real temp dirs + real files here, mirroring Story 1.2's `ensureXdgDir` temp-dir test. Black-box CLI e2e (Story 1.3's `tui-back.e2e.test.ts`) does NOT apply — this story adds no subcommand.

**Verified behaviors (reproduced against `zod@4.4.3` + `yaml@2.9.0` in a throwaway sandbox, 2026-08-12):**
- `z.object` with `.optional().default('development')` → a missing `sharedBranch` yields `'development'`.
- `z.record(z.string(), z.record(z.string(), z.unknown()))` → accepts `{}` and nested config objects; **rejects** `modules: { 'shared-types-consumer': true }` with issue path `modules.shared-types-consumer`, message "expected record, received boolean" — exactly the Finding-6 invariant, zero extra code.
- Missing required field → `error.issues` with `path: ['migrationCommand']` and a clear message; joinable into an AC2-style "names the field" error.
- `yaml.parse('')` → `null`; `safeParse(null)` fails with clear issues (no crash). `yaml.parse('a: [unclosed')` → throws `YAMLParseError` (wrap in try/catch).
- `z.string().min(1)` rejects empty strings; `error.issues` is the v4 API (`.errors` removed).

**Scope boundary (critical — don't build ahead):**
- **NO new CLI subcommand.** Story 1.5 explicitly owns "the first real action demonstrating a Must-scope action's standalone, idempotent, shell-invocable nature" (`register`/`list-repos`). No AC in this story demands a subcommand, and the deferred-work item "no duplicate-subcommand-name guard in `runCli`" is tracked to be revisited once a *second* subcommand is registered — this story registers none. Do **not** touch `src/bin/main.ts`, `dispatch.ts`, or `envelope.ts`.
- NO module registry / module-id validation (Story 1.6). NO repo registry / `scan` / `register` / `list-repos` (Story 1.5). NO YAML writing. NO `XDG`/`ensureXdgDir` usage — the loader takes a repo path; XDG wiring belongs to Story 1.5's registry.
- Don't add a barrel re-export to `src/core/index.ts` or `src/adapters/driven/index.ts` — no consumer yet (Story 1.2/1.3 precedent).

**Library/framework requirements (web-verified 2026-08-12):**
- `zod@4.4.3` is the current npm latest and matches the Spine Stack table. Zod v4 API differences that bite if you copy v3 habits: `z.record(key, value)` two-arg form; `error.issues` not `.errors`; custom-error option key `error` not `message`; string formats moved to top-level (`z.email()` etc. — not needed here).
- `yaml@2.9.0` (eemeli) is the current npm latest — the Spine Stack table already pins 2.9.0 (a stale-verification artifact in the architecture memlog claimed 2.8.4; the version-verification review corrected it to 2.9.0). Named import `import { parse } from 'yaml'`. Do NOT use the `next`-dist-tag v3 prerelease.
- Both ship ESM-compatible type declarations; `tsconfig.json`'s NodeNext + `skipLibCheck: true` handle them. These are the repo's first runtime `dependencies`.

**Previous story intelligence (1.1–1.3):**
- Reuse `src/core/result.ts` (`ok`/`err`) — never reinvent the envelope. `err(code, message, details?)` omits `details` when absent.
- Functional, injectable style (no classes): `resolveXdgPaths`, `ping`, `runCli` are plain exported functions. Match it — no `class ManifestLoader` ceremony.
- NodeNext relative imports end in `.js` — `import { z } from 'zod'` (bare, fine) but relative ones must be `'../result.js'`. A bare `../result` fails typecheck.
- Imports always first in every `.ts` file (Story 1.3's depcheck/acorn landmine; the mitigation is a style rule, not a config change).
- The depcheck round-trip (Task 7) is the established proof the AD-1 boundary stays enforced (Stories 1.1/1.2/1.3 all did it).
- No manual `npm link` sanity check applies here — that's for CLI-visible output; this story has no subcommand. Unit + integration tests + gates suffice.
- Git: one story branch from the epic branch, atomic conventional commits with `(story 1.4)` in the subject, `--no-ff` merge only after review.

**Product context:** tui-back is a solo-developer TUI admin tool (Ink/React, TypeScript/Node) for a 10-service NestJS backend, replacing fragile bash scripts. This story makes AD-4 concrete: the single primitive every later feature gates on (Story 1.5's registry, Epic 2's EDTs, Epic 3's group update, Epic 4's `shared-types` consumers, Epic 6's route-explorer activation all read `service`/`container`/`migrationCommand`/`modules` from this loader). Getting the failure-mode contract right now (`manifest-not-found` vs `manifest-validation-failed` vs `manifest-invalid-yaml` vs `manifest-read-error`) is what makes both "unmanaged repos silently skipped" (AC3) and "clear validation errors naming the field" (AC2) true without any special-case code.

### Project Structure Notes

- New: `src/core/ports/manifest.ts` — first file under `core/ports/` (additive, matches the Spine tree; leaf folders are created by the story that first needs them).
- New: `src/adapters/driven/manifest/schema.ts`, `src/adapters/driven/manifest/index.ts`, `src/adapters/driven/manifest/index.test.ts` — first files under `adapters/driven/manifest/`.
- Modified: `package.json` + `package-lock.json` (new `dependencies` block), `_bmad-output/implementation-artifacts/sprint-status.yaml`, this story file.
- Not touched: `src/bin/**`, `src/adapters/driving/**`, `src/adapters/driven/xdg/**`, `src/core/result.ts`, `src/core/index.ts`, `src/adapters/driven/index.ts`.
- No variance from the architecture's `src/` tree.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.4: Manifest Schema, Loader & Validation]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.5: Explicit Repo Registry — "the first real action..."]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.6: Static Module Registry — where module-id validation happens]
- [Source: _bmad-output/planning-artifacts/epics.md#AD-4 — Manifest is the only per-repo activation surface]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/ARCHITECTURE-SPINE.md#AD-1, AD-3, AD-4, AD-5, AD-13]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/ARCHITECTURE-SPINE.md#src/ tree — driven/manifest, core/ports]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/ARCHITECTURE-SPINE.md#Consistency Conventions — kebab-case error codes; Stack table — zod 4.4.3, yaml 2.9.0]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/reviews/review-divergence-adversary.md#Finding 6 — modules config-object invariant ("every modules entry is a config object, {} when the module needs no parameters, never a bare boolean")]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/reviews/review-version-verification.md#Finding 1 — yaml 2.9.0 (not 2.8.4)]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/.memlog.md — "No explicit schemaVersion field in v1"]
- [Source: _bmad-output/planning-artifacts/prds/prd-tui-back-2026-08-10/prd.md#FR-2, Glossary "Manifest", §4.1]
- [Source: _bmad-output/implementation-artifacts/1-3-script-output-envelope-cli-entrypoint-contract.md — Result/envelope patterns, depcheck landmine, scope-boundary discipline]
- [Source: _bmad-output/implementation-artifacts/1-2-xdg-state-layout-resolution.md — injectable pure-function pattern, temp-dir integration-test precedent]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md — duplicate-subcommand guard (NOT triggered by this story), depcheck/acorn landmine]
- [Source: CLAUDE.md#Git workflow — branch-per-story, atomic conventional commits, --no-ff merge]
- [Verified 2026-08-12: zod@4.4.3 + yaml@2.9.0 behaviors (`.default()` on missing key, `z.record` two-arg, `error.issues`, bare-boolean module rejection, `parse('')` → `null`, `YAMLParseError` on malformed input) reproduced in a sandbox — see Dev Notes]

## Dev Agent Record

### Agent Model Used

(dev agent fills in)

### Debug Log References

(dev agent fills in)

### Completion Notes List

(dev agent fills in)

### File List

(dev agent fills in)

## Change Log

| Date | Change | Author |
| --- | --- | --- |
| 2026-08-12 | Created story 1.4 from epics.md ACs + AD-4/AD-5 + the AD-4 review finding (modules config-object invariant) + version-verification correction (yaml 2.9.0). Pre-verified zod@4.4.3/yaml@2.9.0 runtime behaviors in a sandbox so the schema/loader spec is exact. Status backlog → ready-for-dev. | create-story workflow |
