# AGENTS.md

## Commands

- `npm test` — Vitest, all tests (colocated `*.test.ts`). Single file: `npx vitest run src/core/result.test.ts`.
- `npm run typecheck` — `tsc --noEmit` (no build step exists; TS runs via `tsx`).
- `npm run depcheck` — dependency-cruiser over `src/**/*.{ts,tsx,mjs}`, enforces the AD-1 `core → adapters` boundary rule.
- Run the CLI: `node src/bin/tui-back.mjs <subcommand>` (needs Node ≥24). No `npm run` wrapper for it.
- Order when changing code: `npm test && npm run typecheck && npm run depcheck`.

## Architecture (hexagonal, AD-1..AD-15)

Full invariants: `_bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/ARCHITECTURE-SPINE.md`. The rules that bite daily:

- `src/core/` = domain/application, must never import from `src/adapters/` (AD-1). Implementations of core's future ports live in `src/adapters/driven/`; inbound adapters (CLI, future TUI) in `src/adapters/driving/`; `src/bin/` is the composition root.
- Every core use-case returns `Result<T>` from `src/core/result.ts` (`{ok:true,data}` / `{ok:false,error:{code,message,details}}`); `error.code` is kebab-case (AD-3). CLI renders human text on a TTY, exactly one JSON line otherwise; exit code is only `0`/`1` (AD-3).
- `main.ts` sets `process.exitCode`, never calls `process.exit()` — exit() right after stdout.write() does not guarantee flush on a pipe.
- Never let an exception escape: dispatch in `src/adapters/driving/cli/dispatch.ts` maps all throws to `internal-error` (stderr may carry the real stack).

## Code conventions (non-obvious)

- **NodeNext imports**: relative imports must end in `.js` even though files are `.ts` — `import { x } from './foo.js'`. No extension or `.ts` extension fails typecheck.
- **Imports always first in a file.** dependency-cruiser@18.2.0 cannot parse TS itself (the project pins `typescript@7.0.2` past depcruise's hard gate), so it strips via acorn fallback; a generic function returning a locally-defined generic union type (the `Result<T>`/`ok<T>()` shape) silently drops that file's imports from the graph *unless* the imports are the first statements. `dependency-cruiser.config.test.ts` locks this in — see `_bmad-output/implementation-artifacts/deferred-work.md`.
- Don't "fix" the unanchored `to: { path: 'adapters(/|$)' }` in `.dependency-cruiser.cjs` — depcruise records NodeNext imports as unresolved raw specifiers (`../adapters/foo.js`), so a `^src/` anchor would silently disable the boundary rule.

## Testing (AD-13)

- `core/` unit-tested against fake ports, no real git/docker/sqlite.
- `adapters/driven/*` integration-tested against the real system (e.g. XDG uses a temp-dir fixture).
- `adapters/driving/cli` tested black-box: `src/bin/tui-back.e2e.test.ts` spawns the shipped `tui-back.mjs` as a child process and asserts the AD-3 envelope. No pty lib exists, so e2e only exercises the non-TTY JSON branch; TTY/human rendering is covered directly in `envelope.test.ts`.

## Workflow & planning artifacts

- Workflow is BMad-driven (skills under `.agents/skills/`; `bmad-build` is the implementation method). This is a story-based build: story specs + acceptance criteria live in `_bmad-output/planning-artifacts/epics.md` (Story 1.4 manifest schema/loader/validation is next, currently `backlog`); per-story progress in `_bmad-output/implementation-artifacts/<epic>/<story>.md`; status in `sprint-status.yaml`; known landmines/deferred work in `deferred-work.md`. Check these before starting work.
- Git workflow: see `CLAUDE.md`. Key points: one branch per epic (from root branch `devlopment`, note the spelling), one branch per story, conventional commits with the story number in the subject (`feat(core): ... (story 1.1)`), story→epic merge with `git merge --no-ff`, epic→`devlopment` only via PR.
