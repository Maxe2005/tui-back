# Story 1.1: Project Scaffolding & Hexagonal Skeleton

Status: ready-for-dev

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

- [ ] Task 1: Set up git branches per `CLAUDE.md`'s workflow (no AC — repo convention)
  - [ ] From `devlopment`, create epic branch `epic-1-foundation-navigation-shell`
  - [ ] From that epic branch, create story branch `story-1-1-project-scaffolding-hexagonal-skeleton`
  - [ ] All work for this story happens on the story branch; do not commit directly to the epic branch

- [ ] Task 2: Initialize `package.json` and pin the toolchain (AC: 1)
  - [ ] `npm init` → name `tui-back`, `"private": true`, `"type": "module"` (Ink 7/React 19 and `tsx`'s ESM API both require ESM)
  - [ ] `"engines": { "node": ">=24" }`
  - [ ] `npm install --save-dev typescript@7.0.2 tsx@4.23.12 vitest@4.1.10 dependency-cruiser@latest` — exact versions per Architecture Spine's Stack table for the first three; `dependency-cruiser` isn't in that table (Architecture leaves the boundary-lint *tool choice* open), so let npm resolve its current latest (no pin mandated)
  - [ ] Verify: `node --version` reports ≥24, `npx tsc --version` reports `7.0.2`

- [ ] Task 3: Add `tsconfig.json` (AC: 1, 5)
  - [ ] `compilerOptions`: `"target": "ES2023"`, `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, `"strict": true`, `"esModuleInterop": true`, `"skipLibCheck": true`, `"noEmit": true` (type-checking only — no compiled output ships, per AD-14), `"resolveJsonModule": true`, `"forceConsistentCasingInFileNames": true`
  - [ ] `"include": ["src"]`
  - [ ] Add `"typecheck": "tsc --noEmit"` to `package.json` scripts; run it once to confirm a clean pass on the empty skeleton

- [ ] Task 4: Scaffold the hexagonal folder structure exactly (AC: 2)
  - [ ] Create `src/core/`, `src/adapters/driven/`, `src/adapters/driving/`, `src/bin/` — top-level only, no leaf subfolders yet (e.g. `core/edt/`, `adapters/driven/git/` etc. are created by the stories that first need them, not here)
  - [ ] Each of `src/core/`, `src/adapters/driven/`, `src/adapters/driving/` gets one placeholder `index.ts` containing only a header comment (e.g. `// core: domain + application layer — zero import of Ink/React/dockerode/child_process/better-sqlite3/fs (AD-1)`) — git doesn't track empty directories, and this also gives `tsc`/`dependency-cruiser` a real file to analyze
  - [ ] kebab-case for every file/directory name, per the epics' Consistency Conventions table

- [ ] Task 5: Wire the CLI entrypoint without a build step (AC: 3)
  - [ ] `src/bin/main.ts` — placeholder logic only: print `tui-back — not yet implemented` to stdout, exit 0
  - [ ] `src/bin/tui-back.mjs` — the executable shim, using `tsx`'s documented Node API for exactly this "ship a CLI as source, no build step" case:
    ```js
    #!/usr/bin/env node
    import { register } from 'tsx/esm/api'
    register()
    await import('../src/bin/main.ts')
    ```
    Mark it executable (`chmod +x`).
  - [ ] `package.json`: `"bin": { "tui-back": "./src/bin/tui-back.mjs" }`
  - [ ] `npm link`, then run `tui-back` from any directory — confirm it prints the placeholder line and exits 0
  - [ ] Confirm no build/compile step ran to produce this — `tsc` was only used for `--noEmit` type-checking in Task 3

- [ ] Task 6: Wire the test harness (AC: 4)
  - [ ] One trivial colocated test, e.g. `src/core/index.test.ts`, asserting something true (e.g. `1 + 1 === 2`) — Vitest's default glob picks up `*.test.ts` with zero config, so no `vitest.config.ts` is needed yet (add one later only when coverage thresholds or path aliases are needed)
  - [ ] `"test": "vitest run"` script in `package.json`; run it, confirm the one test passes

- [ ] Task 7: Enforce the `core` → `adapters` boundary (AC: 5)
  - [ ] `.dependency-cruiser.cjs`:
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
  - [ ] `"depcheck": "depcruise src --config .dependency-cruiser.cjs"` script in `package.json`
  - [ ] Verify the rule actually fires: temporarily add `import '../adapters/driven'` (or similar) to `src/core/index.ts`, run `npm run depcheck`, confirm it fails with `no-core-to-adapters`, then remove the temporary import
  - [ ] Run `npm run depcheck` clean (no violations) as the final state

- [ ] Task 8: Commit atomically (no AC — repo convention from `CLAUDE.md`)
  - [ ] Separate commits for: toolchain/tsconfig; folder skeleton; CLI entrypoint; test harness; boundary rule — each a `feat(...)`/`chore(...)` Conventional Commit, English, with `(story 1.1)` in the subject line, body explaining *why* not just what

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

_(to be filled in by the implementing dev agent)_

### Debug Log References

### Completion Notes List

### File List
