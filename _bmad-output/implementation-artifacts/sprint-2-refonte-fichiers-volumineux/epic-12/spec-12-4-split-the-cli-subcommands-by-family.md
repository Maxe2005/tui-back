---
title: 'Split the CLI Subcommands by Family'
type: 'refactor'
created: '2026-11-16'
status: 'done'
baseline_commit: '7edbb613dd6f6c60aac666c9ec883394c23a8114'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/sprint-2-refonte-fichiers-volumineux/epic-12-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `cli/subcommands.ts` (1665 lines) mixes usage strings, flag parsers and `runXxx` functions of every CLI command with the `buildSubcommands` registry.

**Approach:** Move each command family into `cli/commands/*.ts` (usage + parser + runner + a `xxxSubcommand(deps)` entry builder); `subcommands.ts` keeps only `buildSubcommands` (registration, install, completion) and `assertUniqueSubcommandNames`. Moves first, edits second.

## Boundaries & Constraints

**Always:** Behaviour-preserving; code moved verbatim. `subcommands.js` keeps exporting `buildSubcommands` and `assertUniqueSubcommandNames`. Each new file has a header comment, one responsibility, under ~400 lines. Gates: `npm test && npm run typecheck && npm run depcheck`.

**Never:** Edit `dispatch.test.ts`, change usage strings, error codes/messages, subcommand order or names, or the completion/MCP registry guards. Split test files (epic 13).

</frozen-after-approval>

## Code Map

- `src/adapters/driving/cli/subcommands.ts` -- now 64 lines: registry order preserved, `install` then `completion` appended last, `assertUniqueSubcommandNames`.
- `cli/commands/deps.ts` (`SubcommandDeps`), `shared.ts` (`loadSettingsOrDefaults`), `basic.ts` (register, list-repos, scan, ping, edts, dashboard).
- `cli/commands/edt-{create,switch,modify,delete}.ts` + `edt.ts` (verb dispatch, composed `EDT_USAGE`).
- `cli/commands/{update,realign,heal,registry,request}.ts` -- `request.ts` holds list-routes, fire-request, request-list/fire/delete and their parsers (333 lines).

## Tasks & Acceptance

**Execution:**
- [x] Extract every family into `cli/commands/` and reduce `subcommands.ts` to registration (single commit: the modules depend on each other and the shrunk registry, so no intermediate state compiles)

**Acceptance Criteria:**
- Given the split, when `dispatch.test.ts`, the completion guard and the MCP registry guard run unchanged, then they pass.
- Given `npm test && npm run typecheck && npm run depcheck`, then all are green except the pre-existing `app-shell.interaction.test.tsx` `:reset` failure (also failing on the baseline commit, unrelated).

## Spec Change Log

## Verification

**Commands:**
- `npx vitest run --configLoader runner` (plain `npm test` fails to load vitest.config.ts in this environment: rolldown `sourcemapPathTransform` error), `npm run typecheck`, `npm run depcheck`.

## Suggested Review Order

**Registry kept thin**

- `buildSubcommands` now only lists the family factories in the original order, then install and completion.
  [`subcommands.ts:20`](../../../../src/adapters/driving/cli/subcommands.ts#L20)

**Shared types and helpers**

- `SubcommandDeps` is the dependency bag every factory takes.
  [`deps.ts:1`](../../../../src/adapters/driving/cli/commands/deps.ts#L1)

**Verb-dispatch families**

- `edt` dispatches to the four `edt-*` runners; usage composed here.
  [`edt.ts:1`](../../../../src/adapters/driving/cli/commands/edt.ts#L1)

- `registry` holds `clean` (interactive) and `validate`.
  [`registry.ts:1`](../../../../src/adapters/driving/cli/commands/registry.ts#L1)

**Other families**

- Update flows and override flags; largest inline entry.
  [`update.ts:1`](../../../../src/adapters/driving/cli/commands/update.ts#L1)

- Routes, fire-request and saved-request commands with their parsers.
  [`request.ts:1`](../../../../src/adapters/driving/cli/commands/request.ts#L1)
