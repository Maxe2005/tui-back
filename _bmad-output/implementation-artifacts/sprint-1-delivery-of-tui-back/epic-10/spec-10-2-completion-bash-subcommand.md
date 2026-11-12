---
title: 'Story 10.2: `completion bash` subcommand'
type: 'feature'
created: '2026-11-09'
status: 'done'
baseline_commit: '192c9fecf233b12d912c8fdfe73ee367cf9af893'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-10-context.md'
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `tui-back` has ~15 subcommands, `edt`/`registry` verbs and many flags; colleagues must remember them all. No shell completion exists.

**Approach:** A pure generator `generateBashCompletion(commands)` builds a bash completion script from the live subcommand registry (names, verbs and flags parsed from the `usage` strings) plus static `tui`, `--help`, `-h`. A `completion bash` subcommand exposes it: raw script on a TTY, AD-3 envelope with `data.script` otherwise.

## Boundaries & Constraints

**Always:** Generator is a pure function in `src/adapters/driving/cli/completion-spec.ts` (no I/O, importable by Story 10.3). Completion is derived from `Subcommand[]` — never a hand-maintained name list. `bash -n` must pass on the output. Keep the AD-3 contract (exit 0/1 only, errors via `err()`). `completion` appears in `--help` and in its own completion.

**Ask First:** Any change to `Subcommand`/`renderResult` signatures beyond one optional TTY-text hook.

**Never:** Dynamic completion (EDT topics, repo paths); zsh/fish; writing files or touching `~/.bashrc` (Story 10.3); adding dependencies.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Piped | `completion bash`, stdout not TTY | one JSON line `{ok:true,data:{script}}`, exit 0 | N/A |
| TTY | `completion bash`, stdout TTY | raw script only, exit 0 | N/A |
| Verb flags | `tui-back edt <TAB>` / `edt switch --<TAB>` | verbs `create switch modify delete` / that verb's flags | N/A |
| Bad shell | `completion zsh` or no arg | exit 1, `invalid-argument` with usage | `err('invalid-argument', 'Usage: tui-back completion bash')` |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/cli/dispatch.ts` -- `Subcommand` interface, `buildHelp` (static `tui` entry), `runCli`; add optional TTY-text hook.
- `src/adapters/driving/cli/envelope.ts` -- `renderResult`/`renderHuman`; honors the hook for raw TTY output.
- `src/adapters/driving/cli/subcommands.ts` -- `buildSubcommands` (usage constants `EDT_USAGE`, `REGISTRY_USAGE`, per-verb usage lines at ~L50-104); `assertUniqueSubcommandNames` at end.
- `src/bin/main.ts` -- composition root; passes `subcommands` to `runCli`.
- `src/bin/tui-back.e2e.test.ts` -- black-box pattern (`runCli` helper, non-TTY only).
- `src/adapters/driving/cli/dispatch.test.ts` -- in-process tests of dispatch.

## Tasks & Acceptance

**Execution:**
- [x] `src/adapters/driving/cli/completion-spec.ts` -- `generateBashCompletion({commands:{name,usage}[]}): string`; parse verbs (`tui-back <name> <verb>` lines, only for `edt`, `registry`) and `--flag` tokens per command/verb; emit `_tui_back()` + `complete -F _tui_back tui-back` (also `tb`) -- pure, reusable by 10.3
- [x] `src/adapters/driving/cli/completion-spec.test.ts` -- unit tests: names, verbs, per-verb flags, `tui`/`--help` present, `bash -n` passes on output (spawn `bash -n`)
- [x] `src/adapters/driving/cli/dispatch.ts`, `envelope.ts` -- optional `humanText?(data): string | undefined` on `Subcommand`, forwarded to `renderResult` for the TTY branch
- [x] `src/adapters/driving/cli/subcommands.ts` -- add `completion` subcommand (`bash` only) built over the final list (closure after construction so it sees itself)
- [x] `src/adapters/driving/cli/dispatch.test.ts` / `envelope.test.ts` -- TTY raw vs piped envelope, bad arg
- [x] `src/bin/tui-back.e2e.test.ts` -- guard (dialog-registry pattern): names in `--help` JSON == names recognized in `completion bash` script (both directions, ignoring `--help`/`-h`/`tui` static entries symmetrically)
- [x] `AGENTS.md`, `docs/` -- document `completion bash` usage (`source <(tui-back completion bash)` is NOT valid piped → document `eval "$(tui-back completion bash | jq -r .data.script)"`; installer handles it in 10.3)

**Acceptance Criteria:**
- Given `tui-back completion bash` piped, then stdout is one JSON line with a non-empty `data.script` and exit 0.
- Given the registry gains a subcommand, when the script is regenerated, then it appears without editing the generator.
- Given `bash -n` on the script, then exit 0.
- Given `npm test && npm run typecheck && npm run depcheck`, then all pass.

## Design Notes

Completion word 1 → names + `--help -h`; word 2 after `edt`/`registry` → verbs; later words starting with `-` → flags of the (command|verb) via a `case`. Flags are scraped with `/--[a-z][a-z-]*/g` from each usage line; parenthetical remarks may add noise (e.g. `--restart`), which is harmless as they are real flags.

## Verification

**Commands:**
- `npm test` -- expected: all green
- `npm run typecheck && npm run depcheck` -- expected: no errors
- `node src/bin/tui-back.mjs completion bash | jq -r .data.script | bash -n` -- expected: exit 0

## Suggested Review Order

**Generator**

- Pure entry point: names, derived verbs and flags become one bash script.
  [`completion-spec.ts:36`](../../../src/adapters/driving/cli/completion-spec.ts#L36)

- Verb-style commands are derived from usage lines, not a hand-kept list.
  [`completion-spec.ts:22`](../../../src/adapters/driving/cli/completion-spec.ts#L22)

**Subcommand and TTY output**

- `completion bash` closes over the final list so it completes itself.
  [`subcommands.ts:530`](../../../src/adapters/driving/cli/subcommands.ts#L530)

- Optional hook prints the raw script on a TTY, envelope otherwise.
  [`envelope.ts:19`](../../../src/adapters/driving/cli/envelope.ts#L19)

- Dispatch forwards the subcommand's hook to the renderer.
  [`dispatch.ts:68`](../../../src/adapters/driving/cli/dispatch.ts#L68)

**Tests**

- Black-box: bash -n, sourced probes, help-vs-script name guard.
  [`tui-back.e2e.test.ts:2589`](../../../src/bin/tui-back.e2e.test.ts#L2589)
