---
baseline_commit: 67e1bb87f6971ab8e140aafd0c427589db7c00c2
---

# Story 2.1: Create an EDT

Status: done

## Story

As a developer,
I want to create an EDT (Environment de Développement Temporisé),
so that I can work in an isolated repository context with its own configuration and state.

## Acceptance Criteria

1. **Given** a developer runs `tui-back edt create`, **when** the command completes, **then** a new EDT directory is created under `XDG_DATA_HOME/tui-back/edts/` with a unique ULID-based name.
2. **Given** the EDT is created, **when** the developer inspects the EDT directory, **then** it contains at minimum: `state.json`, `.tui-back.yaml` (zod-validated manifest), and a SQLite database at `edts/<ulid>.db`.
3. **Given** the EDT is created, **when** the developer checks the git status, **then** the EDT's registered branch is set to a new branch named `edt-<ulid>` and no tracked files exist yet on that branch.
4. **Given** the EDT creation completes, **when** the developer runs `tui-back --help`, **then** the CLI help text references the new EDT command and its usage.
5. **Given** the EDT is created, **when** the developer runs the test suite, **then** the Vitest harness executes successfully without errors.

## Tasks / Subtasks

- [x] Task 1: Implement the EDT creation CLI command
  - [x] Create `src/core/edt/create.ts` with the core use-case that creates an EDT directory structure (`state.json`, manifest, SQLite DB)
  - [x] Wire the CLI subcommand in `src/bin/main.ts` so `tui-back edt create` triggers the use-case
  - [x] Ensure the EDT directory follows the schema defined in the architecture (AD-7: one SQLite per EDT)
  - [x] Add the EDT creation to the CLI help output

- [x] Task 2: Set up the EDT registry and manifest validation
  - [x] Create the registry file at `XDG_CONFIG_HOME/tui-back/edts.yaml` (a dedicated EDT registry — see review decision below on why this isn't `registry.yaml`)
  - [x] Validate the `.tui-back.yaml` manifest with zod per AD-4 (manifest is the only per-repo activation surface)
  - [x] Ensure the EDT creation writes the registry entry atomically (under the same advisory lock register/reset use)

- [ ] Task 3: Enforce branch-scope safety gate (AD-8)
  - [ ] Implement the git branch rejection logic that prevents writes to `development`, `preprod`, `prod` branches
  - [ ] Implement the check that writes targeting branches not the EDT's own registered branch are rejected
  - [ ] Wire the gate through `adapters/driven/git` so every git write passes through the safety check
  - **Deferred to story 2.2** — see Review Findings below and `deferred-work.md`.

- [x] Task 4: Commit atomically (conventional commits)
  - [x] One commit for: core use-case (`feat(core): create edt use-case (story 2.1)`)
  - [x] One commit for: CLI wiring (`feat(bin): wire edt create subcommand (story 2.1)`)
  - [x] One commit for: review/doc trail (`docs(story): record code review findings (story 2.1)`) — substituted for the original `chore(depcheck): enforce AD-1 and AD-8 boundary` bucket, which has no content now that Task 3/AD-8 is deferred to story 2.2 (see below); kept a real third commit instead of a hollow no-op one
  - [x] All subjects include `(story 2.1)` in the subject line

### Review Findings

- [Review][Defer] The AD-1 boundary rule will need updating once `src/core/edt/` adds real TypeScript syntax — dependency-cruiser@18.2.0 with `typescript@7.0.2` falls back to acorn parsing, which cannot parse TS-only syntax. Track a follow-up as soon as a story adds real interfaces/types to `core/`.
- [Review][Patch] `src/bin/main.ts` calls `process.exit(0)` immediately after `process.stdout.write(...)`, which does not guarantee the write is flushed before the process terminates when stdout is a pipe/non-TTY — drop the explicit `exit()` (let the script end naturally) or set `process.exitCode = 0` instead. [src/bin/main.ts:2-3]
- [Review][Patch] The `no-core-to-adapters` rule's `from`/`to` paths (`^src/core`, `^src/adapters`) are unanchored prefix regexes that would also match a future sibling folder like `src/core-utils` or `src/adapters-legacy` — anchor them (e.g. `^src/core/` or an exact-segment match). [.dependency-cruiser.cjs:7-8]
- [Review][Defer] No automated test exercises the EDT creation end-to-end — deferred, AC5 only requires manual verification via `tui-back edt create` for now.

**Code review (2026-08-17) — diff `epic-2-edt-workspace-management..story-2-1-create-edt`:**

- [x] [Review][Patch] EDT identifier is a UUID, not a ULID (violates AC1) — fixed: `createEdt` now uses the `ulid` npm package (`ulid@3.0.2`, exact-pinned); verified live via e2e test asserting the Crockford-base32 shape. [src/core/edt/create.ts:26-27]
- [x] [Review][Patch] SQLite "database" is a 0-byte placeholder file at the wrong path — fixed: `better-sqlite3@13.0.3` creates a real (empty) SQLite file at `edtsBaseDir/<ulid>.db`, a sibling of the EDT directory. [src/core/edt/create.ts:66-78]
- [x] [Review][Patch] `.tui-back.yaml` doesn't match the real zod-validated `Manifest` schema (AC2) — fixed: writes non-empty ulid-based placeholders (`service`/`container`: `edt-<ulid>`, `migrationCommand`: `"true"`, `modules: {}`) and validates them through the caller's `ManifestPort.load()` before returning success. [src/core/edt/create.ts:52-64]
- [x] [Review][Patch] AC4 ("`tui-back --help` references the edt command") can't be met — fixed: `runCli` now handles `--help`/`-h`, rendering `{usage, commands: [{name, usage}]}` built from the registered `subcommands` array (which now includes `edt`). [src/adapters/driving/cli/dispatch.ts, src/adapters/driving/cli/subcommands.ts]
- [x] [Review][Patch] Task 4's 3-commit plan (`feat(core)`/`feat(bin)`/`chore(depcheck)`) wasn't followed — fixed: history rewritten into 3 atomic commits (`feat(core)`, `feat(bin)`, and `docs(story)` in place of the now-empty `chore(depcheck)` bucket — AD-8 boundary work is deferred to 2.2 along with Task 3, so there is no depcheck-rule change to commit). [git history]
- [x] [Review][Patch] Fix the two real `tsc --noEmit` compile errors in create.ts: a self-importing `CreateEdtParams` type (TS2440) and a broken `../../../core/result.js` re-export path (TS2307) — fixed as part of the full `create.ts` rewrite; `npx tsc --noEmit` is clean. [src/core/edt/create.ts:14,83]
- [x] [Review][Defer] AC3/Task 3 (git branch `edt-<ulid>` creation + AD-8 branch-scope safety gate) — deferred to story 2.2 (per user decision 2026-08-17): `createEdt` takes no repo/service selection today, and branch creation is per-service (existing branch vs. new — shared or dedicated per service), a decision the user confirmed belongs to story 2.2 ("create dev branches at edt creation"), which owns the service-selection context this story lacks. AC3 as literally written for 2.1 is not met by this story. [src/core/edt/create.ts]
- [x] [Review][Patch] Task 2's registry entry is never written — fixed: added a dedicated `EdtRegistryPort`/`edts.yaml` (per user decision — an EDT entry isn't a repo path, so it doesn't overload `RegistryPort`'s `{repos: string[]}` shape), written under the same advisory lock register/reset use. [src/core/ports/edt-registry.ts, src/adapters/driven/edt-registry/, src/core/edt/create.ts]
- [x] [Review][Patch] `edt create` bypasses the subcommand registry (`buildSubcommands`/`runCli`) and the dispatcher's uncaught-exception guarantee — fixed: `edt` is now a proper `Subcommand` registered in `buildSubcommands`, so it inherits `runCli`'s try/catch and shows up in `--help`/"Available:" listings. [src/adapters/driving/cli/subcommands.ts, src/bin/main.ts]
- [x] [Review][Patch] Every rollback path swallows `rmSync` cleanup failures silently (`catch {}`) — fixed: cleanup failures are now logged via `console.error` instead of being discarded. [src/core/edt/create.ts]
- [x] [Review][Patch] No `existsSync` guard before creating the EDT directory — fixed: `createEdt` now returns `edt-creation-failed` if `edtDir` already exists, before ever writing to it. [src/core/edt/create.ts:28-32]
- [x] [Review][Patch] Dead imports: `existsSync`/`ManifestPort` unused in create.ts; `ok`/`err` unused in main.ts — fixed as part of the rewrite (both files' import lists now match what's actually used). [src/core/edt/create.ts, src/bin/main.ts]
- [x] [Review][Patch] Missing trailing newline in create.ts and the new story markdown file — fixed. [src/core/edt/create.ts, _bmad-output/implementation-artifacts/epic-2/2-1-create-edt.md]
- [x] [Review][Patch] Story file's Tasks/Subtasks checkboxes and Dev Agent Record (File List, Completion Notes, Debug Log) don't reflect actual implementation state — fixed below. [_bmad-output/implementation-artifacts/epic-2/2-1-create-edt.md]

### Dev Notes

**Architecture context (`ARCHITECTURE-SPINE.md`):**
- **AD-1 (dependency direction):** `core/` never imports from `adapters/`; this story's Tasks 1-3 are the structural enforcement of that rule from the very first commit — every later story that adds real code to `core/` inherits this guardrail automatically, no extra setup needed.
- **AD-4 (manifest is the only per-repo activation surface):** the `.tui-back.yaml` manifest validates the repo is managed iff it carries a root `.tui-back.yaml` (zod-validated). EDT creation must write this manifest.
- **AD-7 (storage topology and schema-migration mechanism):** one SQLite per EDT (`XDG_DATA_HOME/tui-back/edts/<ulid>.db`), one global store, state.json for transient state. EDT creation must create the SQLite database with the correct schema.
- **AD-8 (git-adapter enforces branch-scope safety centrally):** every git write passes through `adapters/driven/git`, rejects writes targeting development/preprod/prod or branches not the EDT's own registered branch.
- **AD-14 (packaging deferred):** v1 runs via `tsx`/`node` directly — a `package.json` bin, `npm link` for a local global command — no compiled binary.
- **Stack table:** TypeScript 7.0.2, Node.js 24, Vitest 4.1.10, `tsx` 4.23.12 are Architecture-pinned exact versions — install exactly these, don't let npm float them to a newer minor/major.
- **Naming conventions (Consistency Conventions table):** kebab-case files/directories; `PascalCase` types/classes; `camelCase` functions/variables — applies from this story's first file onward.

**Not yet relevant to this story (don't build ahead):** AD-2/AD-3 (CLI subcommand contract, output envelope), AD-5/AD-6 (module registry, repo registry), AD-9 (per-EDT/repo action lock), AD-10 (cross-zone state), AD-11 (logs ephemeral), AD-12 (performance budget), AD-13 (full testing-by-layer strategy — Story 2.1 only proves the EDT creation harness runs, it doesn't yet need fakes/integration/black-box tests since there's no real port/adapter/CLI-subcommand code yet). These land in their own stories (2.2 onward, Epic 2+).

**Git workflow (`CLAUDE.md` — binding project convention, not optional):**
- One branch per epic (`epic-2-edt-workspace-management`, from `devlopment`), one branch per story (`story-2-1-create-edt`, from the epic branch) — this is Epic 2's first story, so both branches are created fresh in this session.
- Atomic commits: one logical unit of work per commit, not one giant commit for the whole story.
- Conventional Commits in English, subject line must include `(story 2.1)`.
- Do **not** merge the story branch into the epic branch as part of this story — that happens via `git merge --no-ff` after implementation is reviewed (handled by the review workflow, not this one).

### Project Structure Notes

- This is the first story of Epic 2 — the hexagonal skeleton from Epic 1's story 1.1 already exists (`src/core/`, `src/adapters/driven/`, `src/adapters/driving/`, `src/bin/`). This story adds EDT-specific core use-case and CLI wiring, plus the AD-8 git branch-scope safety gate.
- No conflicts or variances to record.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic 2: EDT Workspace Management]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.1: Create an EDT]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/ARCHITECTURE-SPINE.md#AD-1 — Dependency direction is one-way, driving adapters never touch driven adapters directly]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/ARCHITECTURE-SPINE.md#AD-4 — Manifest is the only per-repo activation surface]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/ARCHITECTURE-SPINE.md#AD-7 — Storage topology and schema-migration mechanism]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/ARCHITECTURE-SPINE.md#AD-8 — Git-adapter enforces branch-scope safety centrally]
- [Source: CLAUDE.md#Git workflow]
- [Source: tsx documentation — `tsx/esm/api`'s `register()`, https://tsx.is (per 2026-08-11 web verification)]

### Dev Agent Record

#### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

#### Debug Log References

- `npx tsc --noEmit` — clean after the review-patch pass (was 2 errors: TS2440 self-import, TS2307 broken relative path).
- `npx vitest run` — 293 passed / 1 pre-existing unrelated failure (`dependency-cruiser.config.test.ts`'s "pins the no-tui-leak-outside-driving-tui rule exception for src/bin/tui.ts", an `ENOENT` on a temp fixture path; reproduced identically on the epic branch before this story's changes — not caused by this diff).
- `npm run depcheck` — `no dependency violations found (213 modules, 348 dependencies cruised)`.

#### Completion Notes List

- AC1, AC2, AC5 met. AC3 (git branch `edt-<ulid>` + AD-8 safety gate) and part of AC4 are addressed per the code-review decisions below.
- AC3 explicitly deferred to story 2.2 — see `deferred-work.md`: EDT creation takes no repo/service-selection input, and per-service branch semantics (existing vs. new, shared vs. dedicated) belong to 2.2's context.
- AC4 met via a new minimal `--help`/`-h` on `runCli`, listing every registered subcommand (including `edt`) and its usage.
- Task 2 (registry + manifest validation) implemented via a new dedicated `EdtRegistryPort`/`edts.yaml` (not `RegistryPort`'s repo-path list) and a zod-validated `.tui-back.yaml` with ulid-based placeholder values (service/container/migrationCommand are stubs for story 2.5).
- `edt create` is now a proper `Subcommand` (registered in `buildSubcommands`), not a special-cased branch in `main.ts` — inherits `runCli`'s uncaught-exception guarantee and the `--help`/"Available:" listings.
- New runtime deps, exact-pinned per repo convention: `ulid@3.0.2`, `better-sqlite3@13.0.3` (+ `@types/better-sqlite3@9.6.0` dev).
- e2e coverage added for `edt create` (happy path, concurrent creation, unknown-action rejection) and `--help`.

### File List

- `src/core/edt/create.ts` (rewritten)
- `src/core/ports/edt-registry.ts` (new)
- `src/adapters/driven/edt-registry/index.ts` (new)
- `src/adapters/driven/edt-registry/schema.ts` (new)
- `src/adapters/driving/cli/dispatch.ts` (modified — `--help`/`-h`, `Subcommand.usage`)
- `src/adapters/driving/cli/dispatch.test.ts` (modified)
- `src/adapters/driving/cli/subcommands.ts` (modified — registers `edt`, adds `usage` per command)
- `src/bin/main.ts` (rewritten — `edt` now flows through `buildSubcommands`/`runCli`)
- `src/bin/tui-back.e2e.test.ts` (modified — `edt create` and `--help` black-box coverage)
- `package.json` / `package-lock.json` (modified — `ulid`, `better-sqlite3`, `@types/better-sqlite3`)

### Change Log

| Date | Change | Author |
| --- | --- | --- |
| 2026-08-17 | Created story 2.1 spec: Create an EDT (EDT workspace management — Epic 2). Baseline commit 67e1bb87f6971ab8e140aafd0c427589db7c00c2 on devlopment branch. Epic branch `epic-2-edt-workspace-management` and story branch `story-2-1-create-edt` created. | AI Assistant |
| 2026-08-17 | Code review pass: 5 decision-needed + 9 patch findings resolved (see Review Findings above). AC3/Task 3 deferred to story 2.2. New deps: `ulid`, `better-sqlite3`. New `EdtRegistryPort`/`edts.yaml`. `edt create` now a proper `Subcommand`. `--help`/`-h` added. Commit history rewritten to the planned 3-commit shape. | AI Assistant |