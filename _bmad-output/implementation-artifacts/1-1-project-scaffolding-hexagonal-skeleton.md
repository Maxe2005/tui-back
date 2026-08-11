---
baseline_commit: 046cd668561072a05ac4709d33f37d85a5464d5a
---

# Story 1.1: Project Scaffolding & Hexagonal Skeleton

Status: review

## Story

As a developer,
I want the project scaffolded with the hexagonal folder structure and toolchain,
so that every subsequent story has a consistent place to add code and can be run without a compiled build step.

## Acceptance Criteria

1. **Given** a fresh clone of the repository, **when** a developer installs dependencies, **then** they install cleanly on Node.js 24 with TypeScript 7.0.2 resolved.
2. **Given** the scaffolded project, **when** a developer inspects the source tree, **then** it matches `src/core/`, `src/adapters/driven/`, `src/adapters/driving/`, `src/bin/` exactly, and `core/` contains no import of Ink/React/dockerode/child_process/better-sqlite3/fs.
3. **Given** the scaffolded project, **when** a developer runs the app via `tsx`/`node` (`npm link` then `tui-back`), **then** the command resolves and prints placeholder output, and no compiled binary exists (AD-14).
4. **Given** the scaffolded project, **when** a developer runs the test command, **then** Vitest executes successfully, confirming the harness is wired.
5. **Given** the scaffolded project, **when** a file under `core/` imports from `adapters/`, **then** a lint/type-check rule flags it (AD-1, structurally enforced).

## Tasks / Subtasks

- [x] Task 1: Set up git branches per `CLAUDE.md`'s workflow (no AC — repo convention)
  - [x] From `devlopment`, create epic branch `epic-1-foundation-navigation-shell`
  - [x] From that epic branch, create story branch `story-1-1-project-scaffolding-hexagonal-skeleton`
  - [x] All work for this story happens on the story branch; do not commit directly to the epic branch

- [x] Task 2: Initialize `package.json` and pin the toolchain (AC: 1)
  - [x] `npm init` → name `tui-back`, `"private": true`, `"type": "module"` (Ink 7/React 19 and `tsx`'s ESM API both require ESM)
  - [x] `"engines": { "node": ">=24" }`
  - [x] `npm install --save-dev typescript@7.0.2 tsx@4.23.12 vitest@4.1.10 dependency-cruiser@latest` — exact versions per Architecture Spine's Stack table for the first three; `dependency-cruiser` isn't in that table (Architecture leaves the boundary-lint *tool choice* open), so let npm resolve its current latest (no pin mandated)
  - [x] Verify: `node --version` reports ≥24, `npx tsc --version` reports `7.0.2`

- [x] Task 3: Add `tsconfig.json` (AC: 1, 5)
  - [x] `compilerOptions`: `"target": "ES2023"`, `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, `"strict": true`, `"esModuleInterop": true`, `"skipLibCheck": true`, `"noEmit": true` (type-checking only — no compiled output ships, per AD-14), `"resolveJsonModule": true`, `"forceConsistentCasingInFileNames": true`
  - [x] `"include": ["src"]`
  - [x] Add `"typecheck": "tsc --noEmit"` to `package.json` scripts; run it once to confirm a clean pass on the empty skeleton

- [x] Task 4: Scaffold the hexagonal folder structure exactly (AC: 2)
  - [x] Create `src/core/`, `src/adapters/driven/`, `src/adapters/driving/`, `src/bin/` — top-level only, no leaf subfolders yet (e.g. `core/edt/`, `adapters/driven/git/` etc. are created by the stories that first need them, not here)
  - [x] Each of `src/core/`, `src/adapters/driven/`, `src/adapters/driving/` gets one placeholder `index.ts` containing only a header comment (e.g. `// core: domain + application layer — zero import of Ink/React/dockerode/child_process/better-sqlite3/fs (AD-1)`) — git doesn't track empty directories, and this also gives `tsc`/`dependency-cruiser` a real file to analyze
  - [x] kebab-case for every file/directory name, per the epics' Consistency Conventions table

- [x] Task 5: Wire the CLI entrypoint without a build step (AC: 3)
  - [x] `src/bin/main.ts` — placeholder logic only: print `tui-back — not yet implemented` to stdout, exit 0
  - [x] `src/bin/tui-back.mjs` — the executable shim, using `tsx`'s documented Node API for exactly this "ship a CLI as source, no build step" case:
    ```js
    #!/usr/bin/env node
    import { register } from 'tsx/esm/api'
    register()
    await import('./main.ts')
    ```
    Mark it executable (`chmod +x`).
    Deviation from the story's snippet: the import specifier is `./main.ts`, not `../src/bin/main.ts` — the shim lives at `src/bin/tui-back.mjs`, so a relative import resolves against that directory; `../src/bin/main.ts` from there pointed at the non-existent `src/src/bin/main.ts` and failed with `ERR_MODULE_NOT_FOUND` (verified before fixing).
  - [x] `package.json`: `"bin": { "tui-back": "./src/bin/tui-back.mjs" }`
  - [x] `npm link`, then run `tui-back` from any directory — confirm it prints the placeholder line and exits 0
  - [x] Confirm no build/compile step ran to produce this — `tsc` was only used for `--noEmit` type-checking in Task 3

- [x] Task 6: Wire the test harness (AC: 4)
  - [x] One trivial colocated test, e.g. `src/core/index.test.ts`, asserting something true (e.g. `1 + 1 === 2`) — Vitest's default glob picks up `*.test.ts` with zero config, so no `vitest.config.ts` is needed yet (add one later only when coverage thresholds or path aliases are needed)
  - [x] `"test": "vitest run"` script in `package.json`; run it, confirm the one test passes

- [x] Task 7: Enforce the `core` → `adapters` boundary (AC: 5)
  - [x] `.dependency-cruiser.cjs`:
    ```js
    module.exports = {
      forbidden: [
        {
          name: 'no-core-to-adapters',
          comment: 'core is the domain/application layer; it must never import from adapters (AD-1)',
          severity: 'error',
          from: { path: '^src/core' },
          to: { path: '^src/adapters' },
        },
      ],
    }
    ```
  - [x] `"depcheck": "depcruise \"src/**/*.ts\" \"src/**/*.mjs\" --config .dependency-cruiser.cjs"` script in `package.json` — deviation from the story's literal `depcruise src ...`: dependency-cruiser@18.2.0's bundled TypeScript support is hard-gated to `typescript >=2.0.0 <7.0.0` (`node_modules/dependency-cruiser/src/meta.cjs`); with the Architecture-pinned `typescript@7.0.2` it silently drops `.ts` from its scannable extensions, so pointing it at the `src` directory made it cruise 0 `.ts` files and report a false-clean pass. Passing explicit `src/**/*.ts`/`src/**/*.mjs` globs routes through dependency-cruiser's glob expansion, which bypasses that extension gate at the file-gathering stage; extraction then falls back to its default acorn parser (no TS-only syntax exists yet in these files, so acorn parses them fine). Confirmed real detection by round-tripping the violation below before finalizing this form.
  - [x] Verify the rule actually fires: temporarily add `import '../adapters/driven/index.ts'` to `src/core/index.ts`, run `npm run depcheck`, confirm it fails with `no-core-to-adapters`, then remove the temporary import
  - [x] Run `npm run depcheck` clean (no violations) as the final state

- [x] Task 8: Commit atomically (no AC — repo convention from `CLAUDE.md`)
  - [x] Separate commits for: toolchain/tsconfig; folder skeleton; CLI entrypoint; test harness; boundary rule — each a `feat(...)`/`chore(...)` Conventional Commit, English, with `(story 1.1)` in the subject line, body explaining *why* not just what

## Dev Notes

**Architecture context (`ARCHITECTURE-SPINE.md`):**
- **AD-1 (dependency direction):** `core/` never imports from `adapters/`; this story's Task 7 is the structural enforcement of that rule from the very first commit — every later story that adds real code to `core/` inherits this guardrail automatically, no extra setup needed.
- **AD-14 (packaging deferred):** v1 runs via `tsx`/`node` directly — a `package.json` bin, `npm link` for a local global command — no compiled binary. Don't add a `build`/`dist` step; `tsc --noEmit` in this story is type-checking only.
- **Stack table:** TypeScript 7.0.2, Node.js 24, Vitest 4.1.10, `tsx` 4.23.12 are Architecture-pinned exact versions — install exactly these, don't let npm float them to a newer minor/major.
- **Naming conventions (Consistency Conventions table):** kebab-case files/directories; `PascalCase` types/classes; `camelCase` functions/variables — applies from this story's first file onward.

**Not yet relevant to this story (don't build ahead):** AD-2/AD-3 (CLI subcommand contract, output envelope), AD-4/AD-5 (manifest, module registry), AD-7 (storage), AD-8 (git safety gate), AD-9 (locks), AD-13 (full testing-by-layer strategy — Story 1.1 only proves the Vitest harness runs, it doesn't yet need fakes/integration/black-box tests since there's no real port/adapter/CLI-subcommand/TUI code yet). These land in their own stories (1.2 onward, Epic 2+).

**Git workflow (`CLAUDE.md` — binding project convention, not optional):**
- One branch per epic (`epic-1-foundation-navigation-shell`, from `devlopment`), one branch per story (`story-1-1-project-scaffolding-hexagonal-skeleton`, from the epic branch) — this is Epic 1's first story, so both branches are created fresh in Task 1.
- Atomic commits: one logical unit of work per commit, not one giant commit for the whole story.
- Conventional Commits in English, subject line must include `(story 1.1)`.
- Do **not** merge the story branch into the epic branch as part of this story — that happens via `git merge --no-ff` after implementation is reviewed (handled by the review workflow, not this one).

**Why `tsx/esm/api`'s `register()` for the bin shim, not a plain shebang on the `.ts` file directly:** a `#!/usr/bin/env tsx` shebang on `src/bin/main.ts` would require `tsx` to be globally resolvable on `PATH`, which isn't guaranteed after `npm link` (only the package's own `devDependencies` are linked, not installed globally). Registering `tsx`'s loader programmatically from a plain Node-executable `.mjs` shim avoids that dependency entirely — confirmed against `tsx`'s current documented API (`import { register } from 'tsx/esm/api'`).

**Why `dependency-cruiser` for the AD-1 boundary check:** single-purpose devDependency, config-only, no broader ESLint setup required (ESLint itself isn't in the Stack table). Confirmed current `forbidden`-rule config shape (`{ forbidden: [{ name, severity, from: { path }, to: { path } }] }`) against the tool's own docs rather than assumed from memory.

### Project Structure Notes

- This is the first story — there is no existing structure to align with or diverge from. The tree created here (`src/core/`, `src/adapters/driven/`, `src/adapters/driving/`, `src/bin/`) is exactly and only the top level from Architecture's `src/` tree; every leaf folder shown in that tree (`core/edt/`, `adapters/driven/git/`, `adapters/driving/tui/dashboard/`, etc.) belongs to the story that first needs it — do not pre-create them here.
- No conflicts or variances to record.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.1: Project Scaffolding & Hexagonal Skeleton]
- [Source: _bmad-output/planning-artifacts/epics.md#Additional Requirements] — "No starter/greenfield template specified" item
- [Source: _bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/ARCHITECTURE-SPINE.md#AD-1 — Dependency direction is one-way, driving adapters never touch driven adapters directly]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/ARCHITECTURE-SPINE.md#AD-14 — Packaging is deferred]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/ARCHITECTURE-SPINE.md#Stack]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/ARCHITECTURE-SPINE.md#Consistency Conventions]
- [Source: CLAUDE.md#Git workflow]
- [Source: tsx documentation — `tsx/esm/api`'s `register()`, https://tsx.is (per 2026-08-11 web verification)]
- [Source: dependency-cruiser documentation — `forbidden` rule config shape, https://github.com/sverweij/dependency-cruiser (per 2026-08-11 web verification)]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- `npm run typecheck` initially failed with `TS2591: Cannot find name 'process'` after Task 5 added `src/bin/main.ts`; root-caused to TypeScript 7.0.2's automatic `@types` inclusion not picking up `@types/node` (unlike `@types/chai`/`@types/deep-eql`, pulled in transitively via vitest, which *were* auto-included). Fixed with an explicit `"types": ["node"]` in `tsconfig.json` after installing `@types/node` (user-approved addition — see Completion Notes).
- `npm run depcheck` reported a false "no violations" even with a deliberately-forbidden `core → adapters` import present, when invoked as `depcruise src --config ...`. Root cause: dependency-cruiser@18.2.0 gates `.ts` support to `typescript >=2.0.0 <7.0.0` (`node_modules/dependency-cruiser/src/meta.cjs`); with `typescript@7.0.2` installed, `.ts` silently drops out of its scannable extensions during directory-based gathering, so zero `.ts` files were ever cruised. Tried `options.extraExtensionsToScan: ['.ts']` first — that got `.ts` files listed as modules again, but `extractDependencies` explicitly *skips* dependency extraction for any extension present in `extraExtensionsToScan`, so it was a red herring (files present, edges still never extracted). Fixed by invoking depcruise with explicit `src/**/*.ts`/`src/**/*.mjs` globs instead of the `src` directory — dependency-cruiser's own glob expansion path bypasses the scannable-extension gate entirely, and its extraction step falls back to the default acorn parser for `.ts` (fine here since these files use no TS-only syntax yet). Re-verified with the deliberate violation before and after the fix.
- `src/bin/tui-back.mjs`'s dynamic import path from the story's own code snippet (`../src/bin/main.ts`) failed with `ERR_MODULE_NOT_FOUND` when run — the shim lives at `src/bin/tui-back.mjs`, so that relative path resolved to the non-existent `src/src/bin/main.ts`. Fixed to `./main.ts`.

### Completion Notes List

- All 5 acceptance criteria verified directly: `npm install` resolves cleanly with `node --version` ≥24 and `npx tsc --version` → `7.0.2` (AC1); `src/core/`, `src/adapters/driven/`, `src/adapters/driving/`, `src/bin/` created exactly, `core/` carries only the AD-1 boundary comment (AC2); `npm link` + `tui-back` from `/tmp` prints the placeholder line and exits 0, no build/dist step introduced (AC3); `npm test` runs the one Vitest test green (AC4); `npm run depcheck` flags a deliberately-introduced `core → adapters` import and passes clean once removed (AC5).
- Three deviations from the story's literal instructions, all necessary to make the acceptance criteria actually pass rather than just "look" satisfied — each documented inline in the relevant task and in the Debug Log above:
  1. CLI shim's dynamic import: `./main.ts` instead of `../src/bin/main.ts` (path bug in the story's snippet).
  2. `depcheck` invoked with `src/**/*.ts src/**/*.mjs` globs instead of `depcruise src` (dependency-cruiser@18.2.0 / typescript@7.0.2 incompatibility — see Debug Log).
  3. Added `@types/node` as a devDependency plus `"types": ["node"]` in `tsconfig.json`, not listed in the story's Task 2 dependency set — needed for `tsc --noEmit` to recognize the `process` global used in `src/bin/main.ts`. Flagged to the user as a HALT-worthy new dependency per the dev-story workflow; user approved adding it over the alternative of avoiding `process` in the placeholder.
- `.gitignore` already existed in the repo before this story (`.bmad-loop/`, `_bmad/render/` entries); appended `node_modules/` to it rather than overwriting — first attempt clobbered the file and was corrected before committing.
- Commit history was reordered once via `git reset --soft`/`git reset` (no push had happened) so the `tsconfig.json` `"types": ["node"]` addition lands in the CLI-entrypoint commit (where `@types/node` is introduced) rather than leaking into the earlier toolchain/tsconfig commit.

### File List

- `.gitignore` (modified — added `node_modules/`)
- `package.json` (created)
- `package-lock.json` (created)
- `tsconfig.json` (created)
- `src/core/index.ts` (created)
- `src/adapters/driven/index.ts` (created)
- `src/adapters/driving/index.ts` (created)
- `src/bin/main.ts` (created)
- `src/bin/tui-back.mjs` (created)
- `src/core/index.test.ts` (created)
- `.dependency-cruiser.cjs` (created)

## Change Log

| Date | Change | Author |
| --- | --- | --- |
| 2026-08-11 | Scaffolded the hexagonal project (toolchain, tsconfig, `src/core`/`adapters`/`bin` skeleton, CLI entrypoint, Vitest harness, dependency-cruiser AD-1 boundary rule). All 5 ACs verified; story moved to review. | Claude Sonnet 5 (dev agent) |
