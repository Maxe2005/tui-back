---
baseline_commit: b47baa8638c26f30341bc2e79f45f602e66f3cdd
---

# Story 1.2: XDG State Layout Resolution

Status: review

## Story

As a developer,
I want the tool's config/data/state/cache to live in standard XDG locations,
so that they never collide with a bespoke directory layout.

## Acceptance Criteria

1. **Given** `XDG_CONFIG_HOME`/`XDG_DATA_HOME`/`XDG_STATE_HOME` are set, **when** the tool resolves storage paths, **then** it uses `$XDG_*_HOME/tui-back/` respectively.
2. **Given** none are set, **when** resolved, **then** the tool falls back to the XDG-specified defaults (`~/.config`, `~/.local/share`, `~/.local/state`).
3. **Given** any of `tui-back`'s XDG-namespaced directories doesn't exist yet, **when** a component (e.g. a future config or data write) needs to create a file under it for the first time, **then** the tool creates the directory automatically rather than failing.
4. **Given** `XDG_CACHE_HOME`, **when** resolved, **then** the path is available but nothing is written there yet.

## Tasks / Subtasks

- [x] Task 1: Close out Story 1.1 and branch for this story (no AC — repo convention, `CLAUDE.md`)
  - [x] Check `git status` on `story-1-1-project-scaffolding-hexagonal-skeleton`: the review-fix changes (`.dependency-cruiser.cjs`, `package.json`, `package-lock.json`, `src/bin/main.ts`, story doc, `sprint-status.yaml`, new `deferred-work.md`) are uncommitted as of this story's creation — commit them (e.g. `fix(scaffold): address code review findings (story 1.1)`), then merge `story-1-1-project-scaffolding-hexagonal-skeleton` into `epic-1-foundation-navigation-shell` with `git merge --no-ff`
  - [x] From `epic-1-foundation-navigation-shell`, create `story-1-2-xdg-state-layout-resolution`
  - [x] Do all work for this story on that branch; do not commit directly to the epic branch

- [x] Task 2: Resolve the dependency-cruiser / TypeScript 7 parsing gap **before** writing real TS syntax (carries over from Story 1.1's deferred-work item 1 — read `_bmad-output/implementation-artifacts/deferred-work.md` item 1 first)
  - [x] `dependency-cruiser@18.2.0`'s bundled TS extraction is hard-gated to `typescript >=2.0.0 <7.0.0` (`node_modules/dependency-cruiser/src/meta.cjs`); with `typescript@7.0.2` pinned, `npm run depcheck` only "worked" in Story 1.1 because zero files contained real TS-only syntax. This story is the first to need one (an `XdgPaths` type) — verify what actually happens before relying on it
  - [x] Reproduce: add a throwaway `interface Probe { x: string }` (or the real `XdgPaths` type from Task 3) to a `.ts` file under `src/`, run `npm run depcheck`, observe whether it (a) crashes with a parse error, (b) silently drops the file from the graph (false-clean pass — the Story 1.1 failure mode), or (c) parses fine
  - [x] Check whether a newer `dependency-cruiser` release lifts the `typescript@7` gate (`npm view dependency-cruiser versions` / changelog) before falling back to a workaround
  - [x] If still broken: pick a pragmatic path and document the choice in Dev Notes — e.g. keep this module's public type as a plain interface but confirm acorn actually parses `interface` declarations (it may; acorn chokes on `type` aliases/generics/enums more reliably than on `interface`), or restructure to avoid the syntax acorn can't handle. Do not silently ship a `depcheck` that has stopped scanning files — if no clean fix exists, log a fresh, explicit deferred-work/review item stating exactly what `depcheck` can and cannot catch after this story
  - [x] This is a blocking investigation, not optional polish — a `depcheck` that silently stops working defeats AC5 of Story 1.1 for every story from here on

- [x] Task 3: Implement pure XDG path resolution (AC: 1, 2)
  - [x] New file `src/adapters/driven/xdg/index.ts` — lives in `adapters/driven/`, **not** `core/`: the architecture's `core/` tree entry explicitly requires "zero import of ... fs" (AD-1), and resolving `os.homedir()`/`process.env` plus the directory-creation in Task 4 are adapter-layer infrastructure, not a core concern. No `core/ports/` port is required for this story — nothing in `core/` consumes these paths yet
  - [x] Export a `resolveXdgPaths()` function returning `{ configDir, dataDir, stateDir, cacheDir }` (all absolute paths, each namespaced under `tui-back`, e.g. `$XDG_CONFIG_HOME/tui-back`)
  - [x] Make it a **pure, side-effect-free** function: no `fs` calls, only `node:path`/`node:os`/`node:process`. Accept `env: NodeJS.ProcessEnv = process.env` and `homedir: string = os.homedir()` as optional parameters — this is what makes it testable without mutating real `process.env` or the real `$HOME` (matches AD-13's "no real ... touching real state" testing posture for adapters)
  - [x] Env-var handling, per the XDG Base Directory Specification v0.8 (not spelled out in epics.md's ACs, but required for correct behavior and likely to be review-flagged if skipped): treat an XDG env var as "not set" — i.e. fall through to the default — when it is unset, empty, **or not an absolute path** (the spec: "If an implementation encounters a relative path in any of these variables, it should consider the path invalid and ignore it")
  - [x] Defaults (used whenever the corresponding env var is absent/empty/relative): `XDG_CONFIG_HOME` → `<home>/.config`, `XDG_DATA_HOME` → `<home>/.local/share`, `XDG_STATE_HOME` → `<home>/.local/state`, `XDG_CACHE_HOME` → `<home>/.cache` (this last default isn't stated in the epics AC2 text — it's a decision made in this story, sourced from the spec, since AC2 only enumerates config/data/state; see References)
  - [x] Naming: kebab-case file/dir (`xdg/index.ts`), `PascalCase` for the returned-shape type (e.g. `XdgPaths`), `camelCase` for the function (`resolveXdgPaths`)

- [x] Task 4: Implement on-demand directory creation (AC: 3)
  - [x] Export `ensureXdgDir(dirPath: string): void` from the same module — creates the directory (and any missing parents) if it doesn't exist yet, using `fs.mkdirSync(dirPath, { recursive: true })`. `recursive: true` already no-ops safely if the directory exists, so no separate existence check is needed
  - [x] This function is deliberately **not** called automatically by `resolveXdgPaths()` — AC3 says creation happens "when a component needs to create a file", i.e. on demand by whichever future adapter (persistence, registry, manifest — Stories 1.4/1.5+) is about to write. This story only has to prove the primitive works; it has no file-writing consumer yet
  - [x] Do not call `ensureXdgDir` anywhere for the cache directory in this story (see Task 5 / AC4)

- [x] Task 5: Prove AC4's "resolvable but untouched" cache path (AC: 4)
  - [x] No dedicated cache-writing code exists anywhere in this story (matches the architecture doc's own Deferred note: `XDG_CACHE_HOME` is "left unused until one emerges") — the only obligation is that `resolveXdgPaths().cacheDir` returns a correct path and that nothing in this module's code path touches the filesystem for it
  - [x] Cover this with a test (see Task 6) that spies/mocks `fs.mkdirSync`/`fs.existsSync` around a `resolveXdgPaths()` call and asserts zero filesystem calls — demonstrating the resolution stays pure and cache is never eagerly created

- [x] Task 6: Unit tests (AC: 1, 2, 3, 4)
  - [x] New file `src/adapters/driven/xdg/index.test.ts`, colocated per project convention, Vitest (`describe`/`it`/`expect`)
  - [x] AC1: call `resolveXdgPaths()` with an injected `env` object where `XDG_CONFIG_HOME`/`XDG_DATA_HOME`/`XDG_STATE_HOME` are set to distinct fake absolute paths (e.g. under `os.tmpdir()`) — assert each returned dir equals `<fake>/tui-back`
  - [x] AC2: call with an `env` object where those three vars are absent, and an injected fake `homedir` — assert the returned dirs equal `<fake-home>/.config/tui-back`, `<fake-home>/.local/share/tui-back`, `<fake-home>/.local/state/tui-back`
  - [x] Edge cases (spec compliance, not literal in the epics ACs but required — see Task 3): env var set to `''` → falls back to default; env var set to a relative path (e.g. `foo/bar`) → falls back to default
  - [x] AC3: call `ensureXdgDir()` against a path under a fresh unique temp directory (`fs.mkdtempSync(path.join(os.tmpdir(), ...))`) that does not exist yet — assert `fs.existsSync(dir)` is true afterward; call it a second time on the same path — assert it does not throw (idempotent); clean up the temp dir after each test
  - [x] AC4: per Task 5, assert `resolveXdgPaths()` performs zero `fs` calls (mock/spy `node:fs`'s `mkdirSync`/`existsSync`/`writeFileSync` and assert none were invoked) while still returning a `cacheDir` value that follows the same `<base>/tui-back` shape as the other three

- [x] Task 7: Verify quality gates and finalize (no dedicated AC — project-wide gates from Story 1.1)
  - [x] `npm run typecheck` — clean
  - [x] `npm run depcheck` — clean, and re-confirm (per Task 2's investigation) that it is actually scanning the new file, not silently skipping it
  - [x] `npm test` — all green, including the new suite
  - [x] Optional, not required by any AC: re-export the new module from `src/adapters/driven/index.ts`'s barrel for discoverability by later stories — skip if it adds noise without a consumer yet (decision: **skipped** — no consumer exists yet, matches the task's own guidance)

- [x] Task 8: Commit atomically (no AC — repo convention from `CLAUDE.md`)
  - [x] Separate commits for: the Story 1.1 branch/merge housekeeping (Task 1, if not already done in a prior session), the dependency-cruiser/TS7 investigation outcome if it required a config or code change (Task 2), the path-resolution implementation (Tasks 3–5), and the test suite (Task 6) — each a Conventional Commit in English with `(story 1.2)` in the subject, body explaining *why*

## Dev Notes

**Where this code lives and why (`ARCHITECTURE-SPINE.md`):**
- `core/` must have "zero import of Ink/React/dockerode/child_process/better-sqlite3/fs" — this is the hard constraint that rules out putting path resolution in `core/`. It belongs in `adapters/driven/`, alongside the not-yet-created `persistence/`, `registry/`, `manifest/` adapters that will *consume* these resolved paths in later stories (1.4, 1.5, and Epic 2's EDT persistence).
- No pre-existing folder name is reserved for this concern in the architecture's `src/` tree (only `git/`, `docker/`, `process/`, `persistence/`, `manifest/`, `registry/`, `modules/` are named under `adapters/driven/`). This story introduces a new leaf folder, `adapters/driven/xdg/` — a reasonable, minimal choice consistent with the existing one-concern-per-folder pattern; not an architecture-mandated name, just this story's decision.
- No `core/ports/` port is being added for this story. The named port list (`GitPort, ContainerPort, ProcessPort, ManifestPort, EdtStorePort, GlobalStorePort, RegistryPort, RouteScannerPort, DevAuthPort, SharedTypesPort`) doesn't include a paths port, and nothing in `core/` needs to know *where* things live yet — only the driven adapters that will read/write files do. Don't add a `PathsPort` speculatively.
- **AD-13 (testing strategy by layer):** this module lives in `adapters/driven/`, so it gets "targeted integration tests against the real system" — but this story keeps `resolveXdgPaths()` itself pure (no real fs touch) specifically so its tests don't need a real-system fixture at all; only `ensureXdgDir()`'s test needs a real (temp) directory, matching the "temp file for persistence" pattern the doc prescribes for sibling adapters.
- **Scope boundary vs. Story 1.3** (Script Output Envelope & CLI Entrypoint Contract, AD-2/AD-3): do **not** touch `src/bin/main.ts`, add a CLI subcommand, or implement any `{ok,data}`/exit-code behavior in this story. This module is a pure, CLI-invisible utility — Story 1.3 owns everything CLI-facing, and Stories 1.4/1.5 own the adapters that will actually call `ensureXdgDir()` when writing a manifest/registry file.
- **AD-6 / AD-7** (for context, not this story's job to implement): once this module exists, `registry/` will read/write `XDG_CONFIG_HOME/tui-back/registry.yaml` (Story 1.5, and the *only* place in epics.md that names Story 1.2 by number as a dependency), and `persistence/` will place `XDG_DATA_HOME/tui-back/edts/<ulid>.db`, `XDG_DATA_HOME/tui-back/global.db`, and `XDG_STATE_HOME/tui-back/state.json`. This story only needs to produce the four base directories — it must not create `registry.yaml`, `state.json`, or any `.db` file itself.
- **Consistency Conventions:** kebab-case files/directories, `PascalCase` types/classes, `camelCase` functions/variables.

**No XDG library in the Stack table** (`typescript`, `zod`, `ulid`, `vitest`, `tsx` are listed; no `xdg-basedir`/`env-paths`/similar) and none is currently in `package.json`. Consistent with the project's hand-rolled-over-framework posture (e.g. AD-7's "no external migration framework") — implement this with `node:os`/`node:path`/`node:fs` only, no new dependency. If you find yourself reaching for a library, treat that as a HALT-worthy new-dependency decision (per the dev-story workflow), not a default.

**The single biggest risk carried into this story** is the dependency-cruiser/TypeScript 7 parsing gap flagged in Story 1.1's review and `deferred-work.md` item 1: `depcheck` currently "passes clean" partly because no real TS syntax (`interface`, `type`, generics, enums) exists anywhere in `src/`. This story's `XdgPaths` type is the first one. Task 2 makes resolving/verifying this a first-class, ordered step — don't discover it accidentally partway through Task 3.

**Env-var edge cases** (empty string, relative path) are not literal ACs in epics.md, but are required by the XDG Base Directory Specification v0.8 itself and are cheap to get right the first time — treat them as part of "resolves storage paths" (AC1/AC2), not scope creep.

**Product context:** `tui-back` is a solo-developer TUI admin tool (Ink/React, TypeScript/Node.js) for a 10-service NestJS microservices backend, replacing fragile bash scripts, built hexagonal-core-first so every action is a standalone script runnable identically via TUI or CLI. Strictly local-machine-only, single-user, single-instance. (No PRD/UX content beyond the one NFR quoted below bears directly on this story — `DESIGN.md`/`EXPERIENCE.md` contain no path-resolution screens, flows, or copy; there is no in-app "where is my data stored" surface to build.)

### Project Structure Notes

- New: `src/adapters/driven/xdg/index.ts`, `src/adapters/driven/xdg/index.test.ts` — first leaf folder under `adapters/driven/` other than the placeholder barrel.
- Touched, maybe: `src/adapters/driven/index.ts` (currently just a boundary-comment placeholder) — optional barrel re-export, see Task 7.
- Not touched: `src/core/**`, `src/bin/**`, `src/adapters/driving/**` — this story has no core, CLI, or TUI surface.
- No variance from the architecture's `src/` tree — `adapters/driven/xdg/` is additive, matching the documented pattern that leaf folders are created by the story that first needs them (established explicitly in Story 1.1).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.2: XDG State Layout Resolution]
- [Source: _bmad-output/planning-artifacts/epics.md#NFR-5 — Local state layout]
- [Source: _bmad-output/planning-artifacts/epics.md#AD-6 — Repo registry]
- [Source: _bmad-output/planning-artifacts/epics.md#AD-7 — Storage topology]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.5: Explicit Repo Registry — the only story that cites "Story 1.2" by number]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/ARCHITECTURE-SPINE.md#Stack]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/ARCHITECTURE-SPINE.md#src/ tree — core/ "zero import of ... fs"]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/ARCHITECTURE-SPINE.md#AD-13 — Testing strategy by layer]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/ARCHITECTURE-SPINE.md#Deferred — XDG_CACHE_HOME unused]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/ARCHITECTURE-SPINE.md#Consistency Conventions]
- [Source: _bmad-output/planning-artifacts/prds/prd-tui-back-2026-08-10/prd.md#Cross-Cutting NFRs — Local state layout]
- [Source: _bmad-output/planning-artifacts/prds/prd-tui-back-2026-08-10/prd.md#6.1 MVP Scope — storage topology deferred to architecture]
- [Source: _bmad-output/implementation-artifacts/1-1-project-scaffolding-hexagonal-skeleton.md — Review Findings item 1, dependency-cruiser/TypeScript 7 parsing gap]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md — item 1]
- [Source: CLAUDE.md#Git workflow]
- [Source: XDG Base Directory Specification v0.8 (freedesktop.org, 2021-05-08) — default paths and relative/empty-value handling, https://specifications.freedesktop.org/basedir/latest/ (per 2026-08-11 web verification)]

## Dev Agent Record

### Agent Model Used

### Debug Log References

- Task 2 investigation (dependency-cruiser/TS7 gap): reproduced with throwaway probe files under `src/core/probe_tmp/` and `src/adapters/driven/probe_consumer_tmp.ts` (removed after investigation, never committed). Confirmed `interface`/typed-signature syntax parses fine via depcruise's fallback path; confirmed the *real* gap is that NodeNext-style relative `./foo.js` imports (resolving to `./foo.ts`) are recorded as edges but flagged `couldNotResolve: true`, so the `no-core-to-adapters` rule never fires on them. `npm view dependency-cruiser versions` confirms `18.2.0` is latest (no fix available). `options.tsConfig` doesn't fix resolution (only adds a `missing-typescript-transpiler` warning); `options.enhancedResolveOptions.extensionAlias` is rejected by the config schema. Full write-up logged as a new deferred-work item (see `deferred-work.md`, "Deferred from: dev of story-1-2..."). This story's own `xdg/` module does not cross the core/adapters boundary, so the gap doesn't block this story — it's a forward-looking risk for the first story that adds a real cross-folder relative import.

### Completion Notes List

- Task 1: Story 1.1's review-fix changes were already committed and merged (`e4160a3`, `b3341c7`) and `story-1-2-xdg-state-layout-resolution` was already branched from `epic-1-foundation-navigation-shell` before this session started; verified via `git log`/`git branch`, no action needed.
- Task 2: Investigated the dependency-cruiser/TypeScript 7 gap carried over from Story 1.1. Confirmed `interface`/typed-signature syntax parses fine through depcruise's fallback path. Found a more serious, previously-unexercised gap: this project's mandatory NodeNext-style relative imports (`./foo.js` resolving to `./foo.ts`) are recorded as edges but flagged `couldNotResolve`, so the `no-core-to-adapters` rule can't fire on them — confirmed with a deliberate real violation. No dependency-cruiser config option or newer release fixes this. Logged as a new deferred-work item; doesn't block this story since `xdg/` doesn't cross the core/adapters boundary.
- Tasks 3–5: Implemented `resolveXdgPaths()` (pure, injectable `env`/`homedir`, XDG-spec-compliant fallback for unset/empty/relative env vars) and `ensureXdgDir()` (idempotent `mkdirSync` with `recursive: true`) in `src/adapters/driven/xdg/index.ts`. `resolveXdgPaths()` never touches `fs`; `cacheDir` is resolved but nothing writes to it, satisfying AC4.
- Task 6: Added `src/adapters/driven/xdg/index.test.ts` (Vitest) — 7 tests covering AC1 (explicit env vars), AC2 (defaults), empty/relative-path edge cases, AC4 (zero `fs` calls, using a `vi.mock('node:fs', ...)` wrapper since ESM namespaces can't be `vi.spyOn`'d directly), and AC3 (real temp-directory creation + idempotency for `ensureXdgDir`). Confirmed RED (missing module) before implementing, then GREEN after.
- Task 7: `npm run typecheck`, `npm run depcheck` (14 modules cruised, up from 8 — confirmed the new files are actually scanned, not silently dropped), and `npm test` (2 files, 8 tests) all pass. Skipped the optional barrel re-export from `src/adapters/driven/index.ts` — no consumer yet.
- Task 8: Committed in 4 atomic commits — Task 2's investigation write-up, the `resolveXdgPaths`/`ensureXdgDir` implementation, the test suite, and this story-file completion update.

### File List

- `src/adapters/driven/xdg/index.ts` (new)
- `src/adapters/driven/xdg/index.test.ts` (new)
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified — new item documenting the depcheck NodeNext-resolution gap)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — story status)
- `_bmad-output/implementation-artifacts/1-2-xdg-state-layout-resolution.md` (this file)

## Change Log

| Date | Change | Author |
| --- | --- | --- |
| 2026-08-12 | Investigated and documented the dependency-cruiser NodeNext-resolution gap (deferred, non-blocking for this story). Implemented `resolveXdgPaths()`/`ensureXdgDir()` in `src/adapters/driven/xdg/index.ts` with full unit-test coverage. All 4 ACs verified; story moved to review. | Claude Sonnet 5 (dev agent) |
