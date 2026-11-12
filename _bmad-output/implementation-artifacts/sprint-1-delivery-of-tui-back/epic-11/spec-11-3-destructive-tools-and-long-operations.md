---
title: 'Story 11.3: Destructive Tools and Long Operations'
type: 'feature'
created: '2026-11-12'
status: 'done'
baseline_commit: '8434b332f69fbd2f3e2290ad3d1ccd4154d41a91'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The agent cannot yet run the destructive commands (`edt delete`, `edt switch --discard-dirty`, `register --reset`, `registry clean`, `request-delete`, `update`), and `update` is long-running, so it needs progress and cancellation.

**Approach:** Register these as `destructive` tools behind the existing 11.2 gate, with prompts naming exactly what is lost or changed. `registry clean` previews its stale entries before the prompt and removes only those. `update` reports MCP progress notifications and stops cooperatively on cancellation.

## Boundaries & Constraints

**Always:** Reuse the 11.2 gate unchanged (per-call approval, never cached, fail closed). Destructive tools carry `destructiveHint: true`. Flag-injection guards on every string argument. No stdin read. Locks stay the serialization mechanism; a held lock surfaces as the usual `lock-held` envelope error. `update --all` is allowed only because the human approves that exact call (the approval replaces `--yes`).

**Ask First:** If `update` cancellation cannot be made cooperative without touching `core/` semantics beyond a new optional param, HALT.

**Never:** `install`/README docs (11.4), remembering approvals, killing subprocesses on cancel (AD-20: cooperative, checked between steps), reading stdin, a `--discard-dirty` path outside `edt-switch-discard`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| registry-clean, candidates | stale entries exist | prompt lists each path, reason and `[member of EDT: …]`; after accept, only those paths removed via `--yes --path` | declined: nothing removed |
| registry-clean, none | no stale entries | returns the "no stale entries" envelope, no prompt | N/A |
| update with progress | client sent `progressToken` | `notifications/progress` per phase (`service: phase`), strictly increasing | no token: no notifications |
| update cancelled | client aborts the request | pool stops at next step boundary, rows so far returned as cancelled/skipped | no subprocess killed |
| edt-switch-discard | accepted | runs `edt switch --to X --discard-dirty`; prompt says uncommitted changes in every member repo are DISCARDED | declined: nothing runs |
| Held lock | conflicting op holds lock | tool returns the `lock-held` envelope, `isError: true` | covered by a test |
| Unknown/expired stale list | path no longer stale at removal | handled by existing `removeStaleRegistryEntries` result rows | N/A |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/mcp/tool-registry.ts` -- `ToolDefinition`/`RegisteredTool` (L10-30), `EXCLUDED_SUBCOMMANDS` (L33, drop `update`/`request-delete`), `WRITE_DEFINITIONS` pattern, `buildToolRegistry` (L299). Add `DESTRUCTIVE_DEFINITIONS`, optional `prepare` hook, and a `run(input, ctx)` context `{ signal?, onProgress?, argv? }`.
- `src/adapters/driving/mcp/server.ts` -- tool callback: call `prepare` before the gate (gate gets its targets), pass `extra.signal` and a `sendNotification('notifications/progress')` closure built from `extra._meta?.progressToken`.
- `src/adapters/driving/cli/dispatch.ts` -- `Subcommand.run(args)`; add optional second arg `ctx?: { signal?: AbortSignal; onPhase?: (service, phase) => void }`.
- `src/adapters/driving/cli/subcommands.ts` -- `update` (L246-345: `onPhase: undefined`, wire `ctx.onPhase` and `shouldCancel`), `edt` verbs L226, `register --reset` L143, `registry clean` `runRegistryClean` (L1485+: non-TTY returns `confirmation-required` with `details.candidates`; `--yes --path` removes), `request-delete` L513.
- `src/core/scripts/group-update.ts` -- `GroupUpdateParams` (L158); both `runPool` workers (L399 and L628) pass `control.cancelled` as `shouldStop`; add optional `shouldCancel?: () => boolean` and fold it into that callback (calling `control.cancel()` when true). `run-pool.ts` unchanged.
- `src/core/scripts/clean-registry.ts` -- `StaleRegistryEntry {path, reason, memberOfEdts}`.
- `src/adapters/driven/lock/index.ts` L126 -- `lock-held` code.
- `src/bin/tui-back.e2e.test.ts` L2646 -- guard: update exclusion expectations, destructive list, and drop the "registry clean is never a tool" assertion.
- `src/adapters/driving/mcp/authorization.test.ts` -- fake-client pattern to extend.

## Tasks & Acceptance

**Execution:**
- [ ] `core/scripts/group-update.ts` (+ test) -- optional `shouldCancel` cooperative stop in both pool sites; remaining services reported cancelled -- cancellation without killing processes
- [ ] `cli/dispatch.ts`, `cli/subcommands.ts` (+ test) -- `Subcommand.run` accepts an optional context; `update` forwards `onPhase` and `signal.aborted` as `shouldCancel`; CLI behaviour unchanged without a context
- [ ] `mcp/tool-registry.ts` -- add `edt-delete` (`topic`, `branches: ["<path>=<leave|delete>"]`), `edt-switch-discard` (`to`, `restart`, `force`), `register-reset` (`repoPath`), `request-delete` (`name`), `update` (`mode: edt|all|from-edt`, `fromEdt`, `runMigrations`, `cleanRestart`; `all` maps to `--all --yes`), all `destructive` with loss-naming `describeTargets` (e.g. "DELETES EDT x and its stored state; branches deleted: …", "DISCARDS uncommitted changes in EDT x members"); add `registry-clean` whose `prepare` runs `registry clean` non-interactively, lists candidates as targets, returns early when none, and executes `--yes --path …` for exactly those candidates; add `prepare`/context plumbing; update `EXCLUDED_SUBCOMMANDS`
- [ ] `mcp/server.ts` -- run `prepare` then the gate then `run` with signal and progress sender; progress counter strictly increasing; prepare/progress failures never crash or leak
- [ ] `mcp/*.test.ts` -- fake client: each destructive tool prompts and runs only on accept with exact argv; `destructiveHint` in `tools/list`; approval not reused across two identical calls; registry-clean lists then removes only listed paths and never touches stdin; update emits progress and aborts on cancel; held-lock envelope surfaced as error (real lock adapter or `lock-held` fake)
- [ ] `src/bin/tui-back.e2e.test.ts` -- adjust the guard to the final tool set

**Acceptance Criteria:**
- Given any destructive tool, when the client declines/cancels/times out/has no elicitation, then nothing runs and the code is `authorization-denied`/`authorization-unavailable`.
- Given `registry-clean`, when accepted, then only the entries listed in the prompt are removed, with no stdin prompt.
- Given `update` with a progress token, then progress notifications arrive; given the request is aborted, then the run stops cooperatively.
- Given a held lock, then the tool returns the `lock-held` envelope error.

## Spec Change Log

## Verification

**Commands:**
- `npm run typecheck` -- expected: no errors
- `npm test` -- expected: all green
- `npm run depcheck` -- expected: no violations

## Suggested Review Order

**Destructive tools and preview (design entry point)**

- Declarative destructive tools, each with a loss-naming prompt.
  [`tool-registry.ts:280`](../../../src/adapters/driving/mcp/tool-registry.ts#L280)

- `update` cross-field validation (`fromEdt` only with `from-edt`).
  [`tool-registry.ts:346`](../../../src/adapters/driving/mcp/tool-registry.ts#L346)

- `registry-clean` previews stale entries, then removes exactly those.
  [`tool-registry.ts:370`](../../../src/adapters/driving/mcp/tool-registry.ts#L370)

**Server flow: prepare, gate, run**

- Handler checks abort before and after the gate, so nothing runs once cancelled.
  [`server.ts:59`](../../../src/adapters/driving/mcp/server.ts#L59)

- Progress notifications only with a token; stop after the reply.
  [`server.ts:136`](../../../src/adapters/driving/mcp/server.ts#L136)

**Cooperative cancellation**

- Optional external cancel folded into the pool's stop check.
  [`group-update.ts:253`](../../../src/core/scripts/group-update.ts#L253)

- CLI context maps abort signal and phases into `update`.
  [`subcommands.ts:1656`](../../../src/adapters/driving/cli/subcommands.ts#L1656)

- Subcommand context type; absent context keeps CLI behaviour unchanged.
  [`dispatch.ts:9`](../../../src/adapters/driving/cli/dispatch.ts#L9)

**Tests**

- Fake-client coverage of every destructive tool, progress, abort and locks.
  [`destructive.test.ts:1`](../../../src/adapters/driving/mcp/destructive.test.ts#L1)

- Real `update` subcommand with signal and onPhase.
  [`dispatch.test.ts:1`](../../../src/adapters/driving/cli/dispatch.test.ts#L1)
