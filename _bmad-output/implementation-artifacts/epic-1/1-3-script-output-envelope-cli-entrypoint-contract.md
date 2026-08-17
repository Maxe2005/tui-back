---
baseline_commit: cdcccff8b498eb1c28627f944d8053bd8698b533
---

# Story 1.3: Script Output Envelope & CLI Entrypoint Contract

Status: done

## Story

As a developer,
I want every CLI subcommand and its underlying core use-case to share one output contract,
so that a script run by hand and the same action triggered from the TUI are provably identical.

## Acceptance Criteria

1. **Given** a core use-case, **when** it completes, **then** it returns exactly `{ok: true, data: T}` on success or `{ok: false, error: {code, message, details?}}` on failure (AD-3).
2. **Given** a CLI subcommand, **when** stdout is a TTY, **then** it renders human-readable text; **and when** stdout is not a TTY, **then** it prints exactly one final JSON line matching the envelope.
3. **Given** a CLI subcommand, **when** the use-case succeeds, **then** the process exits 0; **and when** it fails, **then** it exits 1 — no other exit code is ever used.
4. **Given** the CLI binary, **when** invoked with an unknown subcommand, **then** it prints usage help and exits 1 without crashing.
5. **Given** the CLI entrypoint, **when** defined, **then** it is one umbrella binary (`tui-back <subcommand>`) — no per-action separate executable exists (AD-2).

## Tasks / Subtasks

- [x] Task 1: Branch for this story (no AC — repo convention, `CLAUDE.md`)
  - [x] From `epic-1-foundation-navigation-shell`, create `story-1-3-script-output-envelope-cli-entrypoint-contract`
  - [x] Do all work for this story on that branch; do not commit directly to the epic branch

- [x] Task 2: Define the core `Result` envelope type & helpers (AC: 1)
  - [x] New file `src/core/result.ts` (core root, sibling to `src/core/index.ts` — no `core/ports/` port is appropriate here: this is a cross-cutting shape every future use-case returns, not something a driven adapter implements)
  - [x] Export:
    ```ts
    export interface ResultError {
      code: string;
      message: string;
      details?: unknown;
    }

    export type Result<T> =
      | { ok: true; data: T }
      | { ok: false; error: ResultError };

    export function ok<T>(data: T): Result<T> {
      return { ok: true, data };
    }

    export function err(code: string, message: string, details?: unknown): Result<never> {
      return { ok: false, error: details === undefined ? { code, message } : { code, message, details } };
    }
    ```
  - [x] `error.code` values are kebab-case strings (e.g. `unknown-subcommand`, `internal-error`) — this story sets that precedent; every later use-case's error codes should follow it (no casing convention for error codes exists yet in the Architecture Spine's Consistency Conventions table)
  - [x] Naming: kebab-case file (`result.ts`), `PascalCase` types (`Result`, `ResultError`), `camelCase` functions (`ok`, `err`)
  - [x] Unit tests `src/core/result.test.ts`: `ok(data)` returns `{ok:true, data}`; `err(code, message)` returns `{ok:false, error:{code, message}}` with no `details` key present when omitted (not `details: undefined`); `err(code, message, details)` includes `details`

- [x] Task 3: Verify `depcheck` still correctly scans/enforces once this story's generic-union-type + generic-function TS syntax lands — **do this immediately after Task 2, before writing Tasks 4–6** (carries forward the open watch-item from `deferred-work.md`'s Story 1.1 entry: *"Track as soon as a future story adds real TS syntax to `core/` or `adapters/` — verify `depcheck` still catches boundary violations in that file before merging"* — this is that story, and `Result<T>`'s generic union type alias plus `ok<T>()`'s generic function are the first of their kind in this codebase)
  - [x] Reproduce and confirm (already verified once during this story's creation — re-verify against your actual files, don't skip): `npm run depcheck`'s module count includes `src/core/result.ts` after Task 2 (compare against the current clean-baseline count from `npm run depcheck`'s output, e.g. "14 modules, 11 dependencies cruised" before this story's files exist)
  - [x] **Known landmine, confirmed by direct reproduction:** a file containing a generic function whose return type references a locally-defined generic *union* type alias (e.g. `function ok<T>(data: T): Result<T> { return { ok: true, data }; }`, with `Result<T>` a union) **silently drops all of that file's own import statements from the dependency graph — but only when those imports are not the first statements in the file.** Confirmed: the same content with imports placed at the top of the file parses and is tracked correctly; interface-only, type-alias-only, or generic-function-only files (each alone) are also unaffected regardless of import position — it's specifically this combination. Root cause not identified beyond "acorn-fallback TS-stripping mis-tracks position on this exact combination"; not worth digging further given the mitigation is trivial.
  - [x] **Mitigation (mandatory for this story, and going forward): always place `import` statements at the very top of every `.ts` file, before any type/interface/function declaration.** This isn't a new rule — every existing file in this codebase already does this — but Task 4/5's dispatcher and renderer modules are exactly the shape that can trigger the landmine (generic-returning functions + imports) if that convention slips, so call it out explicitly rather than relying on habit alone
  - [x] After writing Tasks 4–6's real files, do one final check: temporarily add a deliberate `core → adapters` import to one of this story's new `core/` files, run `npm run depcheck`, confirm it fails with `no-core-to-adapters`, then remove it — the same round-trip verification Story 1.1/1.2 used, now specifically against a file containing this story's generic syntax
  - [x] Document the finding in `deferred-work.md` under a new dated entry (not blocking — the mitigation is "keep doing what every file already does" — but worth recording so a future story doesn't rediscover it the hard way)

- [x] Task 4: Build a minimal proof-of-mechanism core use-case (AC: 1; needed to exercise AC 2–5 end-to-end)
  - [x] New file `src/core/ping.ts`: `export async function ping(): Promise<Result<{ message: string }>> { return ok({ message: 'pong' }); }`
  - [x] This is **not** a new FR-mapped feature — no FR names a CLI self-check. It exists solely so this story has one real, shipped subcommand to prove the AD-2/AD-3 contract end-to-end (Task 7's black-box test needs a real subcommand to invoke as a child process; Story 1.5's `register`/`list-repos` is explicitly "the first real action demonstrating a Must-scope action's standalone, idempotent, shell-invocable nature" per epics.md — `ping` must not be confused with that). Keep it deliberately trivial: no I/O, no ports, nothing for later stories to depend on or migrate away from
  - [x] Pure — no `fs`/`process`/I/O of any kind, consistent with AD-1's `core/` constraint

- [x] Task 5: Build the CLI envelope renderer (AC: 2, 3)
  - [x] New file `src/adapters/driving/cli/envelope.ts`
  - [x] `export function renderResult(result: Result<unknown>, isTTY: boolean): { output: string; exitCode: 0 | 1 }`
  - [x] Non-TTY branch: `output` is `JSON.stringify(result) + '\n'` — exactly one line, no pretty-printing, no extra output before/after it. This is literally AD-3's envelope: `{"ok":true,"data":{...}}` or `{"ok":false,"error":{"code":"...","message":"...","details":{...}}}`
  - [x] TTY branch: human-readable text. Keep this intentionally simple and generic for this story — e.g. success: `JSON.stringify(result.data, null, 2)` (or `'OK\n'` if `data` is an empty object); failure: `` `Error: ${result.error.message} (code: ${result.error.code})\n` ``, plus a pretty-printed `details` block if present. A richer, per-command human format (e.g. a table for Story 1.5's `list-repos`) is an acceptable future refinement — don't over-build this now, and don't let per-command formatting leak into this shared function's contract
  - [x] `exitCode` is `0` when `result.ok`, `1` otherwise — nowhere else in this story computes an exit code (single source of truth for AC3's "no other exit code is ever used")
  - [x] Unit tests `src/adapters/driving/cli/envelope.test.ts`: non-TTY success → exact single-line JSON string, exit 0; non-TTY failure → exact single-line JSON string (including `details` when present, omitting the key when absent), exit 1; TTY success/failure → human-readable text (assert it's *not* raw JSON and *does* contain the message/data), correct exit codes

- [x] Task 6: Build the CLI subcommand dispatcher (AC: 2, 3, 4)
  - [x] New file `src/adapters/driving/cli/dispatch.ts`
  - [x] `export interface Subcommand { name: string; run: (args: string[]) => Promise<Result<unknown>>; }` — `run` is always async (even `ping`'s trivial body) so the dispatcher's type never has to special-case sync vs. async once real use-cases (git/docker/fs-backed, Story 1.4+) land
  - [x] `export async function runCli(argv: string[], subcommands: Subcommand[], isTTY: boolean): Promise<{ output: string; exitCode: 0 | 1 }>`
    - [x] `argv[0]` is the subcommand name, `argv.slice(1)` are its args
    - [x] Missing subcommand name (empty `argv`) and unknown subcommand name are the **same code path** — both produce `err('unknown-subcommand', ...)` listing the registered subcommand names, e.g. `` `Unknown subcommand: "${name}". Available: ${subcommands.map(s => s.name).join(', ')}` `` — routed through the *same* `renderResult()` from Task 5, not a separate ad-hoc "usage help" formatter. This keeps AC4 provably the same contract as every other subcommand outcome, per the story's own "one output contract" premise, rather than a second divergent output path
    - [x] A matched subcommand's `run(args)` is called inside a `try/catch`; any thrown error (a bug, not an expected failure) is caught and converted to `err('internal-error', String(error))` — **never let an exception escape uncaught**. An uncaught exception would let Node's default handler print a raw stack trace and bypass the envelope entirely, breaking AC2/AC3's guarantee that stdout is always either human text or a single JSON line and the exit code is always 0/1
    - [x] Whatever `Result` is produced (subcommand success/failure, unknown-subcommand, or caught exception) is passed through `renderResult(result, isTTY)` from Task 5 — one call site, no duplication
  - [x] Pure function — `argv`, `subcommands`, `isTTY` are all parameters, no direct `process.argv`/`process.stdout.isTTY` reads inside (same injectable-dependency pattern Story 1.2 used for `resolveXdgPaths`)
  - [x] Unit tests `src/adapters/driving/cli/dispatch.test.ts`, using small in-memory fake `Subcommand[]` fixtures (no real process spawn — that's Task 7's job):
    - [x] Known subcommand, success → `renderResult`'s non-TTY/TTY output for the returned `Result`, exit 0
    - [x] Known subcommand, its `run()` returns `err(...)` → failure envelope, exit 1
    - [x] Known subcommand, its `run()` throws → `internal-error` failure envelope, exit 1, no exception propagates out of `runCli`
    - [x] Unknown subcommand name → `unknown-subcommand` failure envelope (message lists the fake registry's names), exit 1
    - [x] Empty `argv` → same `unknown-subcommand` path, exit 1

- [x] Task 7: Wire the umbrella binary (AC: 3, 5)
  - [x] Rewrite `src/bin/main.ts` as a thin composition root:
    ```ts
    import { ping } from '../core/ping.js';
    import { runCli, type Subcommand } from '../adapters/driving/cli/dispatch.js';

    const subcommands: Subcommand[] = [{ name: 'ping', run: () => ping() }];

    const { output, exitCode } = await runCli(
      process.argv.slice(2),
      subcommands,
      process.stdout.isTTY === true,
    );
    process.stdout.write(output);
    process.exitCode = exitCode;
    ```
  - [x] `process.stdout.isTTY` is `true` or `undefined` — compare with `=== true`, don't rely on truthiness, so `undefined` (non-TTY) is unambiguous
  - [x] No `process.exit()` call — matches Story 1.1's review-fixed guidance: setting `process.exitCode` and letting the script end naturally lets Node drain stdout before exiting, which matters for the non-TTY JSON-line path
  - [x] `src/bin/tui-back.mjs` needs **no changes** — it already just does `await import('./main.ts')` regardless of what `main.ts` contains
  - [x] Confirm `package.json`'s `bin` field still has exactly one entry (`{ "tui-back": "./src/bin/tui-back.mjs" }`) — adding `ping` did not add a new binary; it's a subcommand inside the one umbrella entry (AD-2, AC5)

- [x] Task 8: Black-box CLI tests per AD-13 (AC: 1, 2, 3, 4, 5)
  - [x] New file `src/bin/tui-back.e2e.test.ts`, colocated with the binary. Use `node:child_process`'s `spawnSync` (not `execFileSync` — `spawnSync` returns `{status, stdout, stderr}` without throwing on a non-zero exit code, which is needed to assert AC4's exit-1 path cleanly)
  - [x] Resolve the script path robustly regardless of CWD: `fileURLToPath(new URL('./tui-back.mjs', import.meta.url))`
  - [x] Case A (AC1, AC2 non-TTY branch, AC3 success): `spawnSync('node', [scriptPath, 'ping'], { encoding: 'utf8' })` — `spawnSync`'s stdout is a pipe by default (not a TTY), so this exercises the non-TTY JSON-line branch directly, no extra flag needed. Assert `status === 0` and `JSON.parse(stdout.trim())` deep-equals `{ ok: true, data: { message: 'pong' } }`
  - [x] Case B (AC4, AC3 failure): `spawnSync('node', [scriptPath, 'bogus'], { encoding: 'utf8' })`. Assert `status === 1`, `JSON.parse(stdout.trim())` is `{ ok: false, error: { code: 'unknown-subcommand', ... } }`, and `stderr` contains no raw stack trace (never crashes — the process must exit cleanly through the envelope, not via an uncaught exception)
  - [x] Case C (AC4): same as Case B but with zero args (`[scriptPath]`) — same `unknown-subcommand` path, `status === 1`
  - [x] **Do not attempt to simulate a real TTY here.** No pty library is in the Stack table (`typescript`, `zod`, `ulid`, `vitest`, `tsx`, etc. — nothing terminal-emulation-related), and adding one for this alone would be a HALT-worthy new-dependency decision this story doesn't need. AC2's TTY/human-text branch is already covered directly by Task 5's `renderResult(result, true)` unit tests — that's the intended coverage split, not a gap
  - [x] Optional but cheap: a small assertion (here or in a trivial standalone test) that `package.json`'s `bin` object has exactly one key — locks in AC5's "no per-action separate executable" as a regression guard, similar in spirit to Story 1.2's depcruise regression fixture

- [x] Task 9: Verify quality gates and finalize (no dedicated AC — project-wide gates from Story 1.1)
  - [x] `npm run typecheck` — clean
  - [x] `npm run depcheck` — clean; confirm the module/dependency count grew by the number of new files and re-confirm Task 3's round-trip violation check passed
  - [x] `npm test` — all green, including the new suites (`result.test.ts`, `envelope.test.ts`, `dispatch.test.ts`, `tui-back.e2e.test.ts`)
  - [x] Manual sanity check (mirrors Story 1.1's `npm link` verification): `npm link`, then `tui-back ping` from any directory in an actual terminal — confirm human-readable output (TTY branch, not JSON); `tui-back ping | cat` — confirm exactly one JSON line

- [x] Task 10: Commit atomically (no AC — repo convention from `CLAUDE.md`)
  - [x] Separate commits for: the `Result` envelope type + tests (Task 2), the depcheck landmine investigation/`deferred-work.md` update (Task 3, if it produces a diff), the `ping` use-case (Task 4), the envelope renderer + tests (Task 5), the dispatcher + tests (Task 6), the umbrella binary wiring (Task 7), the black-box e2e tests (Task 8) — each a Conventional Commit in English with `(story 1.3)` in the subject, body explaining *why*

## Dev Notes

**Where this code lives and why (`ARCHITECTURE-SPINE.md`):**
- `src/core/result.ts` and `src/core/ping.ts` live at `core/` root, not under a new leaf folder — `Result<T>` is a cross-cutting shape (every future use-case's return type), not owned by any single capability area (`edt/`, `scripts/`, `logs/`, `routes/`), and `ping` is temporary scaffolding, not a capability. Don't create `core/scripts/ping.ts` — `core/scripts/` is reserved (per the Capability → Architecture Map) for real script/subcommand use-cases (`group-update`, migrations, propagation) starting Epic 3.
- `src/adapters/driving/cli/` is a new leaf folder under `adapters/driving/`, alongside the not-yet-created `tui/` — this is the first story to add real code to `driving/cli`, matching the architecture tree's `cli/ # subcommands — calls the same core use-cases`.
- **AD-2** (this story's core mechanism): the TUI will later call `core/ping.ts`'s `ping()` (and every future use-case) **directly, in-process** — never by spawning `tui-back ping` as a child process. This story only builds the CLI half; there is no TUI yet (Story 1.11+), so there's nothing to wire on that side now, but don't design `runCli`/`renderResult` in a way that would make direct in-process reuse awkward later (they already aren't — `ping()` returns a plain `Result`, independent of any CLI concern).
- **AD-3**: "every core use-case returns exactly this `{ok,data}`/`{ok,error}` shape as its TypeScript return type" — `ping()` returning `Promise<Result<{message:string}>>` is the pattern every later use-case (Story 1.4+) copies.
- **AD-13** (testing strategy by layer): `core/` (result.ts, ping.ts) gets plain Vitest unit tests, no fakes needed (nothing to fake — no ports involved). `adapters/driving/cli` gets **black-box** tests — "invoke a subcommand as a child process, assert the AD-3 envelope on stdout/exit code" — that's Task 8, and it's why this story needs a real, shipped subcommand (`ping`) rather than only testing the dispatcher with in-memory fakes (Task 6 unit tests cover the dispatcher's internal branches quickly; Task 8's e2e test is what actually proves the whole binary is wired per AD-13's letter).
- **Scope boundary vs. Story 1.4/1.5**: this story does not add manifest loading, repo registry, or any real business use-case. `ping` is deliberately inert. Story 1.5's `register`/`list-repos` is explicitly called out in epics.md as "the first real action demonstrating a Must-scope action's standalone, idempotent, shell-invocable nature" — don't let this story's `ping` be mistaken for that milestone in the story's own commit messages or completion notes.
- **Consistency Conventions:** kebab-case files/directories, `PascalCase` types/classes, `camelCase` functions/variables — this story sets the additional precedent that `error.code` values are kebab-case strings (not documented elsewhere; a decision made here, see Task 2).

**The depcheck/TypeScript-7 landmine (Task 3) is a *real*, freshly-reproduced finding, not a copy of the old Story 1.1/1.2 writeup** — verified directly while creating this story:
- A file containing a generic function whose return type references a locally-defined generic union type alias (exactly this story's `ok<T>(data: T): Result<T> { return { ok: true, data }; }` shape) silently drops *all* of that file's own imports from dependency-cruiser's graph — but **only** when those imports aren't the first statements in the file. Confirmed: `interface`-only, `type`-alias-only, and generic-function-only files are each individually unaffected regardless of import position; it's specifically the combination of (generic union type alias) + (generic function returning it) + (a later import) that breaks.
- The fix requires no tool change and no design change — it's a style rule the codebase already follows everywhere: **imports always go first in the file.** Task 3 makes verifying this explicit and mandatory rather than something the dev agent discovers by accident mid-story (Story 1.2's Task 2 set this precedent for a different depcruise gap; this continues it).
- This is unrelated to, and does not reopen, the `no-core-to-adapters` unresolved-import-path fix from Story 1.2's code review (that fix is about matching `resolved` path text; this is about whether an import is extracted from the source at all).

**Deliberately out of scope for this story** (don't build ahead):
- Any manifest/registry/persistence/git/docker adapter — Stories 1.4–1.7+.
- A `--help`/`-h` flag or a dedicated help subcommand — not required by any AC; AC4 only requires *unknown*-subcommand handling to print usage and exit 1, which Task 6 already does via the shared envelope path. Adding a separate `--help` flag is scope creep.
- Rich, per-subcommand human-text formatting (tables, colors, Atelier theming) — the Atelier theme (Story 1.8+) is for the **TUI**, not raw CLI text output; AD-3 only requires the CLI's TTY branch to be "human-readable," which Task 5's generic `JSON.stringify(data, null, 2)` / `Error: ...` formatting satisfies. Don't reach for a table/pretty-print library.
- A pty/terminal-emulation dependency to black-box-test the TTY branch — not in the Stack table; Task 5's direct unit test of `renderResult(result, true)` is the intended coverage for that branch (see Task 8's note).

**Product context:** `tui-back` is a solo-developer TUI admin tool (Ink/React, TypeScript/Node.js) for a 10-service NestJS microservices backend, replacing fragile bash scripts, built hexagonal-core-first so every action is a standalone script runnable identically via TUI or CLI. This story is the foundational proof that "runnable identically via TUI or CLI" (FR-1) has a concrete, testable shape — every subsequent Epic 1+ use-case reuses exactly this `Result`/`Subcommand`/`runCli`/`renderResult` machinery rather than each story reinventing its own output handling.

### Project Structure Notes

- New: `src/core/result.ts`, `src/core/result.test.ts`, `src/core/ping.ts` — first non-placeholder content in `core/`.
- New: `src/adapters/driving/cli/envelope.ts`, `src/adapters/driving/cli/envelope.test.ts`, `src/adapters/driving/cli/dispatch.ts`, `src/adapters/driving/cli/dispatch.test.ts` — first leaf folder under `adapters/driving/` other than the placeholder barrel.
- New: `src/bin/tui-back.e2e.test.ts`.
- Rewritten: `src/bin/main.ts` (from the Story 1.1 placeholder to the real composition root).
- Not touched: `src/bin/tui-back.mjs`, `src/adapters/driven/**` — no driven adapter exists or is needed yet.
- Maybe touched: `_bmad-output/implementation-artifacts/deferred-work.md` (Task 3's finding, if logged as a new entry rather than resolved inline).
- No variance from the architecture's `src/` tree — `adapters/driving/cli/` is additive, matching the documented pattern that leaf folders are created by the story that first needs them.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.3: Script Output Envelope & CLI Entrypoint Contract]
- [Source: _bmad-output/planning-artifacts/epics.md#AD-2 — Script/CLI parity via one umbrella binary]
- [Source: _bmad-output/planning-artifacts/epics.md#AD-3 — Script output envelope]
- [Source: _bmad-output/planning-artifacts/epics.md#AD-13 — Testing strategy by layer]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.5: Explicit Repo Registry — "the first real action demonstrating a Must-scope action's standalone, idempotent, shell-invocable nature"]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/ARCHITECTURE-SPINE.md#AD-2]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/ARCHITECTURE-SPINE.md#AD-3]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/ARCHITECTURE-SPINE.md#AD-13]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/ARCHITECTURE-SPINE.md#src/ tree — cli/ "subcommands — calls the same core use-cases"]
- [Source: _bmad-output/implementation-artifacts/1-1-project-scaffolding-hexagonal-skeleton.md#Review Findings — process.exit()/flush guidance, and the depcheck/TS7 deferred item]
- [Source: _bmad-output/implementation-artifacts/1-2-xdg-state-layout-resolution.md — injectable-parameter pure-function pattern, pure-vs-adapter split precedent]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md — Story 1.1 depcheck/TS7 item; Story 1.2's resolved `no-core-to-adapters` unresolved-import fix]
- [Source: CLAUDE.md#Git workflow]
- [Verified 2026-08-12 during story creation: direct reproduction of the depcheck generic-function-return-type + trailing-import parsing gap described in Task 3/Dev Notes, against this repo's actual `.dependency-cruiser.cjs` and `dependency-cruiser@18.2.0`]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- Task 3 investigation (depcheck/acorn-fallback landmine): reproduced with throwaway probe files under `src/core/probe_tmp/` (removed after investigation, never committed). Isolated the exact trigger via binary search across a dozen file-content variants: a generic function whose return type references a locally-defined generic *union* type alias (e.g. `function ok<T>(data: T): Result<T> { return { ok: true, data }; }`) silently drops that file's own `import` statements from dependency-cruiser's dependency graph, but only when those imports are placed after the function/type declarations rather than at the top of the file. `interface`-only, `type`-alias-only, and generic-function-only files were each individually confirmed unaffected regardless of import position. Confirmed the mitigation (imports first) round-trips correctly: a deliberate `core → adapters` import added to the top of `result.ts` was caught by `no-core-to-adapters`; removed afterward. Full write-up logged in `deferred-work.md`.

### Completion Notes List

- Task 1: Branched `story-1-3-script-output-envelope-cli-entrypoint-contract` from `epic-1-foundation-navigation-shell`; committed the story-creation artifacts (story file, sprint-status) onto it.
- Task 2: Implemented `Result<T>`/`ResultError`/`ok()`/`err()` in `src/core/result.ts`. `err()`'s `details` param stays entirely absent from the returned object when omitted (verified via `toEqual`, not `details: undefined`). 3 unit tests, RED confirmed (missing module) before implementing, then GREEN.
- Task 3: Investigated and confirmed a real, narrow `depcheck`/acorn-fallback gap (see Debug Log). Not blocking — the mitigation (imports always first) is already this codebase's universal convention. Round-tripped a deliberate boundary violation in `result.ts` to confirm the `no-core-to-adapters` rule still fires. Closed out the stale, overly-broad Story 1.1 TS7 deferred-work item and replaced it with this narrower, accurate finding.
- Task 4: Added `src/core/ping.ts` — a deliberately inert use-case (not FR-mapped) proving the AD-2/AD-3 mechanism end-to-end. 1 unit test, RED confirmed then GREEN.
- Task 5: Implemented `renderResult()` in `src/adapters/driving/cli/envelope.ts` — non-TTY branch emits exactly one `JSON.stringify(result)` line; TTY branch emits generic human-readable text (pretty-printed `data`/`Error: message (code)` + `details`). 6 unit tests covering both branches × success/failure, RED then GREEN.
- Task 6: Implemented `runCli()` in `src/adapters/driving/cli/dispatch.ts` — unknown/missing subcommand and a caught exception both route through `err()`/`renderResult()`, never a divergent formatter and never an uncaught exception. 5 unit tests using in-memory fake subcommands, RED then GREEN.
- Task 7: Rewrote `src/bin/main.ts` as the composition root wiring `ping` into the dispatcher. Manually verified via `node src/bin/tui-back.mjs`: `ping` → exit 0 success envelope; `bogus`/no-args → exit 1 unknown-subcommand envelope. `package.json`'s `bin` field confirmed unchanged (single entry).
- Task 8: Added `src/bin/tui-back.e2e.test.ts` — black-box tests per AD-13, spawning the real binary via `node:child_process`'s `spawnSync` (no `npm link` needed). Covers `ping` success, unknown subcommand, and empty-argv failure paths, plus a regression assertion that `package.json`'s `bin` object has exactly one key. TTY/human-text rendering deliberately left to `envelope.test.ts`'s direct unit tests — no pty library in the Stack table.
- Task 9: All quality gates green — `npm run typecheck`, `npm run depcheck` (33 modules/31 dependencies cruised, up from the 14/11 baseline), `npm test` (8 files, 30 tests). Manual `npm link` sanity check: `tui-back ping | cat` → single JSON line; `tui-back ping` under a real pty (via `script -qec`) → pretty-printed human text, confirming the TTY/non-TTY branch split works outside the test suite too. Unlinked afterward.
- Task 10: Committed in 9 atomic commits — story spec, `Result<T>` type, Task 1/2/3 tracking + depcheck landmine doc, `ping`, envelope renderer, dispatcher, `main.ts` wiring, black-box tests, and this closing docs commit marking the story for review (corrected during code review — the original note undercounted by one, missing the self-referential closing commit).
- All 5 acceptance criteria verified: AC1 (`ok`/`err` envelope shape, `result.test.ts`), AC2 (TTY vs. non-TTY rendering, `envelope.test.ts` + real-pty manual check), AC3 (exit 0/1 only, every test asserting `exitCode`/`status`), AC4 (unknown/missing subcommand → usage message + exit 1, no crash, `dispatch.test.ts` + `tui-back.e2e.test.ts`), AC5 (single `bin` entry, asserted in `tui-back.e2e.test.ts`).

### File List

- `src/core/result.ts` (new)
- `src/core/result.test.ts` (new)
- `src/core/ping.ts` (new)
- `src/core/ping.test.ts` (new)
- `src/adapters/driving/cli/envelope.ts` (new)
- `src/adapters/driving/cli/envelope.test.ts` (new)
- `src/adapters/driving/cli/dispatch.ts` (new)
- `src/adapters/driving/cli/dispatch.test.ts` (new)
- `src/bin/main.ts` (rewritten — from Story 1.1's placeholder to the real composition root)
- `src/bin/tui-back.e2e.test.ts` (new)
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified — new Task 3 investigation entry, closed out the stale Story 1.1 TS7 item)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — story status)
- `_bmad-output/implementation-artifacts/1-3-script-output-envelope-cli-entrypoint-contract.md` (this file)

## Change Log

| Date | Change | Author |
| --- | --- | --- |
| 2026-08-12 | Implemented the core `Result<T>` envelope (`ok`/`err`), the CLI envelope renderer and subcommand dispatcher, a `ping` proof-of-mechanism use-case, and wired `main.ts` as the umbrella binary's composition root. Investigated and documented a narrow `depcheck`/acorn-fallback parsing gap (generic-function-return-type + trailing import), mitigated by the codebase's existing imports-first convention — no code/config change required. All 5 ACs verified via unit tests, black-box child-process tests (AD-13), and a manual real-pty sanity check. Story moved to review. | Claude Sonnet 5 (dev agent) |

## Review Findings

- [x] [Review][Patch] Task 3's depcheck landmine has no regression test — Story 1.2's equivalent dependency-cruiser gap shipped a fixture-backed regression test (`dependency-cruiser.config.test.ts`); this story's landmine (generic-function-returning-generic-union-type silently drops trailing imports from the dependency graph) was reproduced during dev but the probe files were deleted, leaving only a prose mitigation ("imports always go first") in `deferred-work.md`. Decision: add a fixture-based regression test now, mirroring Story 1.2's approach. [`.dependency-cruiser.cjs`, new fixture test file under `src/`]
- [x] [Review][Patch] Kebab-case `error.code` convention not recorded in `ARCHITECTURE-SPINE.md` — this story establishes that `error.code` values are kebab-case strings (`result.ts`'s JSDoc), a precedent every future use-case's error codes should follow, but the Architecture Spine's "Consistency Conventions" table (verified on disk) has no mention of error-code casing — only generic "error shapes." Decision: update `ARCHITECTURE-SPINE.md`'s Consistency Conventions table now. [`_bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/ARCHITECTURE-SPINE.md` — Consistency Conventions table]
- [x] [Review][Patch] Caught exceptions in `dispatch.ts` discard all diagnostic detail — a thrown error is converted to `err('internal-error', String(error))` with no `stderr` logging of the original error/stack trace; for non-`Error` thrown values this can collapse to `"[object Object]"`. Decision: add `console.error(error)` to stderr in the catch block (stdout's envelope contract is unaffected — stderr is a separate stream). [`src/adapters/driving/cli/dispatch.ts:31`]
- [x] [Review][Patch] Uncaught exception can escape `runCli`, printing nothing to stdout and a raw stack trace to stderr — the final `renderResult(result, isTTY)` call in `dispatch.ts:34` sits **outside** the `try/catch` that only wraps `subcommand.run()` (lines 28–32). If rendering itself throws (e.g. `JSON.stringify` on a circular structure or a `BigInt` inside a use-case's returned `data`), the exception propagates uncaught through `runCli` and `main.ts`'s top-level `await`, crashing the process with Node's default handler. **Reproduced directly**: a subcommand returning `ok(circularObject)` produces empty stdout, a raw stack trace on stderr, and exit code 1 (matching the failure exit code only by coincidence of Node's crash default) — this is exactly the failure mode Task 6's own code comment says can never happen ("never lets an exception escape uncaught"), and it's baked into the shared dispatcher every future subcommand (Story 1.4+) inherits. Fix: wrap the `renderResult` call itself (or extend the existing `try/catch` to cover it) so a rendering failure also converts to an `err('internal-error', …)` envelope instead of escaping. Once fixed, `deferred-work.md`'s Story 1.1 item about `tui-back.mjs` lacking a `try/catch` around `import('./main.ts')` remains correctly deferred (no live trigger). [`src/adapters/driving/cli/dispatch.ts:34`, `src/adapters/driving/cli/envelope.ts:20,26,32`]
- [x] [Review][Patch] TTY human-readable branch silently discards non-object success data — `renderHuman`'s `hasData` check (`typeof result.data === 'object'`) only treats non-empty objects as "has data"; a future use-case returning `Result<string>`, `Result<number>`, `Result<boolean>`, or an empty array renders as bare `OK`, discarding the actual returned value. Latent today because `ping`'s payload (`{message: string}`) is always a non-empty object, so no current test exercises it, but this is the shared "single source of truth" formatter every future story's TTY output depends on. Fix: handle non-object/primitive `data` as its own case (e.g. render via `String(data)`) instead of folding it into the same branch as empty/absent data. [`src/adapters/driving/cli/envelope.ts:25-26`]
- [x] [Review][Patch] Completion Notes miscounts its own commits — Task 10's completion note claims "Committed in 8 atomic commits," listing 8 items, but the actual branch history (`epic-1-foundation-navigation-shell..HEAD`) has 9 commits tagged `(story 1.3)`. Fix: correct the count/list in the Completion Notes section above. [`_bmad-output/implementation-artifacts/1-3-script-output-envelope-cli-entrypoint-contract.md` — Task 10 completion note]
- [x] [Review][Defer] No duplicate-subcommand-name guard in `runCli` — `subcommands.find(candidate => candidate.name === name)` silently lets the first match win if a future registry (`main.ts`) ever contains two entries with the same `name`; nothing warns or fails. Not reachable today (only `ping` is registered); will matter once Story 1.4+ registers multiple subcommands by hand. [`src/adapters/driving/cli/dispatch.ts:19`] — deferred, pre-existing risk that only becomes live once a second subcommand is registered.
