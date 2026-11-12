---
title: 'Story 11.2: Authorization Gate and Write Tools'
type: 'feature'
created: '2026-11-12'
status: 'in-progress'
baseline_commit: '821a1d4b17743e9d9180ca8c894d9750308dbaad'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The MCP server exposes only read tools. Write tools are needed, but an agent must not change the workspace without the human's explicit approval, enforced by the server and not by the model's behaviour.

**Approach:** Add one authorization gate in the MCP adapter that asks the human through MCP elicitation before any `write`/`destructive` tool runs, failing closed when the client cannot elicit. Register the write tools through it.

## Boundaries & Constraints

**Always:** The gate lives in one place (server layer, applied to every non-`read` tool); a tool cannot be registered without a safety class. Approval is per call and never cached. The prompt shows the tool, its exact arguments and the repos/EDTs affected. Header values and any secret never appear in a prompt or a result. Denial, cancel, timeout or elicitation error runs nothing and returns an AD-3 envelope. String arguments reuse the `-`-prefix flag-injection guard. Stdout stays protocol-only; no stdin read.

**Ask First:** Real-Claude-Code elicitation could not be verified in 11.1; if a live check shows it does not elicit, report it (fail-closed behaviour stays correct).

**Never:** Registering destructive tools (`edt delete`, `edt switch --discard-dirty`, `register --reset`, `registry clean`, `request-delete`, `update` — story 11.3), progress notifications, `install`/README docs (11.4), remembering approvals, trusting `readOnlyHint`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Accept | write tool, client accepts | command runs, its envelope returned | N/A |
| Decline / cancel | client declines or cancels | nothing runs | `authorization-denied` |
| Timeout / elicit throws | no answer within the timeout | nothing runs | `authorization-denied` (message says timeout) |
| No elicitation | client lacks `capabilities.elicitation` | nothing runs, read tools still work | `authorization-unavailable` + reason |
| Second identical call | same tool and args again | prompts again | never remembered |
| Secrets | `fire-request` with `--header 'Authorization: x'` | prompt shows header names only; result carries no cookie/token | N/A |
| Unclassified tool | definition without class | registration throws | fail fast |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/mcp/tool-registry.ts` -- `ToolDefinition`/`buildToolRegistry` (L113 fail-fast checks), `EXCLUDED_SUBCOMMANDS` (L32), `repoPathArg`; add write definitions + optional `describeTargets(input)`; shrink exclusions to the 11.3 set.
- `src/adapters/driving/mcp/server.ts` -- `createMcpServer`; tool callback is where the gate wraps `runToEnvelope`; `server.server.getClientCapabilities()` / `elicitInput()` (SDK 1.32.2).
- `src/adapters/driving/cli/subcommands.ts` -- argv contracts: `register` L143, `scan` L170, `edt` verbs L226 (usages L40-64), `realign` L348 (L92), `heal` L353 (L97), `fire-request` L389 (L548), `request-fire` L486 (L551).
- `src/core/routes/fire-request.ts` -- session cookie never in message/details; `FireResult` has no headers.
- `src/bin/mcp.ts` -- entry; unchanged unless the gate needs a timeout option.
- `src/bin/tui-back.e2e.test.ts` L2646 -- coverage guard; `edt` is covered by `edt-*` tools, remaining exclusions need updated reasons.
- `src/adapters/driving/mcp/{server,tool-registry}.test.ts` -- in-memory client pattern to extend.

## Tasks & Acceptance

**Execution:**
- [ ] `src/adapters/driving/mcp/authorization-gate.ts` (+ test) -- `createAuthorizationGate({ getCapabilities, elicit, timeoutMs })` returning a Result; builds the prompt (tool, redacted argv, targets), maps accept/decline/cancel/timeout/throw/no-capability -- single enforcement point
- [ ] `src/adapters/driving/mcp/server.ts` -- run the gate before every non-`read` tool; read tools bypass it -- fail closed
- [ ] `src/adapters/driving/mcp/tool-registry.ts` -- add `register`, `scan`, `edt-create`, `edt-modify`, `edt-switch` (no discard flags), `realign`, `heal`, `fire-request` (incl. `save`), `request-fire` (incl. `overwrite`/`saveAs`) as `write`; typed zod inputs, header values redacted in prompt, `describeTargets` per tool; update `EXCLUDED_SUBCOMMANDS`
- [ ] `src/adapters/driving/mcp/*.test.ts` -- fake client covering accept, decline, timeout, no-elicitation for a write tool and a test-only destructive tool; unclassified tool rejected; read tool unaffected; no secret in prompt/result; no caching across two calls
- [ ] `src/bin/tui-back.e2e.test.ts` -- adjust the guard for the new tool set (write tools listed with `readOnlyHint: false`)
- [ ] Spike note -- record in "Spike Result" whether a live Claude Code session elicited (or that it was not checked)

**Acceptance Criteria:**
- Given any write tool, when the client accepts, then the command runs and its envelope is returned; otherwise nothing runs and the code is `authorization-denied` or `authorization-unavailable`.
- Given a registry of tools, when one has no safety class, then startup throws.
- Given `tools/list`, then write tools carry `readOnlyHint: false` and a safety class in `_meta`.

## Spec Change Log

## Spike Result

Live elicitation in a real Claude Code session was not checked (no interactive client available during implementation). Verified against the SDK 1.32.2 in-memory client only (accept, decline, cancel, throw, timeout, no capability). The gate fails closed if a client does not elicit.

## Verification

**Commands:**
- `npm run typecheck` -- expected: no errors
- `npm test` -- expected: all green
- `npm run depcheck` -- expected: no violations
