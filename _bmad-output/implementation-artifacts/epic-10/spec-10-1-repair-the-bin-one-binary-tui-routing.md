---
title: 'Story 10.1: Repair the bin — one binary, `tui` routing'
type: 'feature'
created: '2026-11-09'
status: 'done'
baseline_commit: 'b57abb90479d691ee175a9e7f9a5a2def59c06cf'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-10-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `package.json` declares `bin.tui-back-tui` pointing at a file that does not exist, and the real CLI shim is `cli-back.mjs` while `tui-back.mjs` launches the TUI, so a global install cannot work.

**Approach:** Make `src/bin/tui-back.mjs` the single binary: `tui` as first arg loads `./tui.ts`, anything else loads `./main.ts`. Delete `cli-back.mjs`, list `tui` statically in `--help`, and fix tests and docs.

## Boundaries & Constraints

**Always:** `bin` is exactly `{ "tui-back": "./src/bin/tui-back.mjs" }`; `tsx` moves to `dependencies`; the TUI bypasses the AD-3 envelope and keeps the raw terminal; `npm run depcheck` passes with the `.mjs` shim in the graph; `tui.ts` keeps its top-level `process.exit(1)`.

**Ask First:** If the global-install spike (`npm pack` + `npm i -g`, or `github:`) fails with `private: true`, remove `private` only after recording the reason in this file.

**Never:** Register `tui` in the subcommand registry; touch other TUI behavior; push or publish anything.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| TUI route | `tui-back tui`, TTY stdin | `tui.ts` runs | N/A |
| CLI route | `tui-back list-repos` etc. | `main.ts` runs, AD-3 envelope | N/A |
| Non-TTY TUI | `tui-back tui`, piped stdin | exit 1, stderr `tui-back tui requires an interactive terminal` | N/A |
| Help | `tui-back --help` | JSON `commands` includes static `tui` entry | N/A |

</frozen-after-approval>

## Code Map

- `package.json` -- `bin` has a dangling `tui-back-tui`; `tsx` is a devDependency; `private: true`.
- `src/bin/tui-back.mjs` -- currently loads `tui.ts` only; becomes the router.
- `src/bin/cli-back.mjs` -- to delete (CLI shim).
- `src/bin/tui.ts:45` -- non-TTY message to update.
- `src/adapters/driving/cli/dispatch.ts` -- `buildHelp` (static `tui` entry); `dispatch.test.ts` covers help.
- `src/bin/tui-back.e2e.test.ts` -- `scriptPath` (line 15) and bin-keys test (line ~141).
- `AGENTS.md` (lines 8, 33), `CLAUDE.md` (line 18) -- stale references.

## Tasks & Acceptance

**Execution:**
- [ ] `src/bin/tui-back.mjs`, `src/bin/cli-back.mjs` -- route on `argv[2]`; delete the old shim -- single binary
- [ ] `package.json`, `package-lock.json` -- fix `bin`, move `tsx` to dependencies -- installable package
- [ ] `src/bin/tui.ts` -- update non-TTY message -- matches new command name
- [ ] `src/adapters/driving/cli/dispatch.ts` + `dispatch.test.ts` -- static `tui` help entry, tested
- [ ] `src/bin/tui-back.e2e.test.ts` -- point at unified shim; assert bin keys `['tui-back']`, target exists and is executable; non-TTY `tui` message
- [ ] `AGENTS.md`, `CLAUDE.md` -- drop `cli-back.mjs` / `tui-back-tui` mentions
- [ ] Spike -- local `npm pack` + `npm i -g` with a temp prefix; record result under Design Notes

**Acceptance Criteria:**
- Given the repo, when grepping for `cli-back` or `tui-back-tui` outside `_bmad-output`, then nothing matches.
- Given the full suite, typecheck and depcheck, when run, then all pass.

## Spec Change Log

## Design Notes

Spike result: `npm pack` + `npm i -g --prefix <tmp> ./tui-back-1.0.0.tgz` succeeds with `private: true` (private only blocks `npm publish`). Installed `tui-back --help` lists `tui`; `tui-back tui </dev/null` exits 1 with the interactive-terminal message. `private` kept. Note: the tarball still includes `_bmad-output` etc. (story 10.4 adds `files`/`.npmignore`).

## Verification

**Commands:**
- `npm test` -- expected: all green
- `npm run typecheck && npm run depcheck` -- expected: no errors
- `node src/bin/tui-back.mjs --help` -- expected: JSON listing `tui`

## Suggested Review Order

**Single-binary routing**

- Entry point: `argv[2] === 'tui'` picks the TUI, otherwise the CLI.
  [`tui-back.mjs:6`](../../../src/bin/tui-back.mjs#L6)

- Dangling `tui-back-tui` bin removed; `tsx` now a runtime dependency.
  [`package.json:9`](../../../package.json#L9)

- `tui` is listed statically in `--help`, outside the subcommand registry.
  [`dispatch.ts:23`](../../../src/adapters/driving/cli/dispatch.ts#L23)

- Non-TTY message renamed to match the new command.
  [`tui.ts:45`](../../../src/bin/tui.ts#L45)

**Tests and docs**

- Bin keys, executable target, non-TTY `tui` exit and help entry.
  [`tui-back.e2e.test.ts:142`](../../../src/bin/tui-back.e2e.test.ts#L142)

- Help expectation includes the static entry.
  [`dispatch.test.ts:118`](../../../src/adapters/driving/cli/dispatch.test.ts#L118)

- Stale `cli-back.mjs` / `tui-back-tui` mentions dropped.
  [`AGENTS.md:8`](../../../AGENTS.md#L8)
