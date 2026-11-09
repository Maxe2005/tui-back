---
title: 'Story 11.1: MCP Skeleton and Read-Only Tools'
type: 'feature'
created: '2026-11-09'
status: 'in-review'
baseline_commit: '4545bdf94f87b3c1099bd367cc68b73f7dccbfd5'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An AI agent cannot inspect a tui-back workspace; the CLI is shell-only and `src/bin/main.ts` is a composition root that runs on import, so it cannot be reused in-process.

**Approach:** Add `tui-back mcp` (MCP over stdio) as a driving adapter in `src/adapters/driving/mcp/`. A declarative tool registry exposes the read-only subcommands, wrapping `Subcommand.run()` and returning the AD-3 envelope. The port wiring is extracted into a shared composition factory used by both `main.ts` and the MCP entry.

## Boundaries & Constraints

**Always:** stdout carries MCP protocol messages only (diagnostics go to stderr). Every tool declares name, zod input schema, wrapped subcommand + args mapping, and a safety class `read | write | destructive`; registering a tool without a class is a registration error. `read` tools set `readOnlyHint: true`. Tool results are the AD-3 envelope serialized as JSON text. The MCP path never reads stdin. Core must not import adapters; no "tui" in any new import path (depcruise).

**Ask First:** Whether `mcp` is a registry subcommand (appears in `--help` and completion) or routed only in the `tui-back.mjs` shim like `tui` (needs the static lists in `dispatch.ts` / `completion-spec.ts` updated). Default: shim-routed, added to the static lists.

**Never:** Registering `write`/`destructive` tools (stories 11.2/11.3), the authorization gate, `registry clean` as a tool (stdin prompt + stdout write), editing any client config, changing existing CLI output.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Read tool OK | `tools/call list-repos` | `{ok:true,data}` JSON text, `isError` false | N/A |
| Command error | `list-routes` with no `repoPath` | `{ok:false,error:{code,message}}` text, `isError` true | envelope passed through |
| Handler throws | wrapped run() throws | `internal-error` envelope, stderr log | never crashes the server |
| Unclassified tool | registry entry lacks safety class | registration throws at startup | fail fast |
| Unknown subcommand | `--help` command absent from registry and exclusion list | guard test fails | N/A |

</frozen-after-approval>

## Code Map

- `src/bin/main.ts` -- composition root (ports L29-75, `buildSubcommands` L77-100, `runCli` L102-104); extract L29-100 into a factory.
- `src/adapters/driving/cli/dispatch.ts` -- `Subcommand` type (L8-15), `runCli`, `buildHelp` static `tui` entry (L25-30).
- `src/adapters/driving/cli/subcommands.ts` -- `buildSubcommands` (L109-540); read handlers: list-repos L162, ping L183, edts L188, dashboard L204, `registry validate` ~L358, list-routes L374, request-list L455; `registry clean` prompt L1575-1600 (excluded).
- `src/adapters/driving/cli/completion-spec.ts` -- `STATIC_WORDS` (~L12); `src/adapters/driving/cli/envelope.ts` -- AD-3 envelope.
- `src/bin/tui-back.mjs` -- shim routing `tui` vs `main.ts`; add an `mcp` branch.
- `src/bin/tui-back.e2e.test.ts` -- `--help` list L804; completion guard L2630-2641 (pattern for the new guard).
- `.dependency-cruiser.cjs` -- 3 rules; `src/adapters/driving/mcp/` is allowed.
- `package.json` -- add `@modelcontextprotocol/sdk` (npm latest checked 2026-11-09: 1.32.2; pin exact).

## Tasks & Acceptance

**Execution:**
- [ ] `package.json` -- add `@modelcontextprotocol/sdk` pinned exact; `npm install` -- stdio server + elicitation API
- [ ] `src/bin/composition.ts` -- extract the port wiring + `buildSubcommands` into `composeSubcommands()`; `main.ts` calls it -- shared by CLI and MCP, behavior unchanged
- [ ] `src/adapters/driving/mcp/tool-registry.ts` (+ test) -- declarative registry, safety class mandatory, read tools: dashboard, edts, list-repos, list-routes, request-list, ping, registry-validate
- [ ] `src/adapters/driving/mcp/server.ts` (+ test) -- SDK stdio server, `readOnlyHint`, envelope as text result, throw → `internal-error`; tested with an in-memory client
- [ ] `src/bin/mcp.ts`, `src/bin/tui-back.mjs`, `dispatch.ts`, `completion-spec.ts` -- route `mcp`, keep `--help`/completion in sync
- [ ] `src/bin/tui-back.e2e.test.ts` -- black-box guard: every `--help` subcommand is a registry tool or in an exclusion list with a reason; stdout-purity test spawning `tui-back mcp`
- [ ] Spike -- record SDK version and Claude Code elicitation support in "Spike Result" below (decides 11.2 wording)

**Acceptance Criteria:**
- Given `tui-back mcp` over stdio, when an MCP client lists tools, then the seven read tools appear with `readOnlyHint: true` and a safety class.
- Given a stdio session, when any tool runs, then stdout contains only protocol messages.
- Given a new subcommand in `--help` absent from the registry and exclusion list, when tests run, then the guard fails.
- Given `registry clean`, when the registry is built, then it is excluded and no stdin read is possible.

## Spec Change Log

## Design Notes

`registry validate` is exposed as tool `registry-validate` (args `["registry","validate"]`); tools map zod input → argv (`list-routes` → `[repoPath]`, `request-list` → `["--repo", path]`). Annotations are advisory; the safety class in the registry is authoritative.

## Spike Result

- SDK: `@modelcontextprotocol/sdk` 1.32.2 (pinned exact). Server API exposes `server.elicitInput()` (confirmed in `dist/esm/server/index.d.ts`); `McpServer` + `StdioServerTransport` work with zod 4.4.3.
- Claude Code elicitation support: NOT verified end to end in this story (no live elicitation round-trip was run; local Claude Code is 2.1.319). The server never calls `elicitInput` in 11.1. Story 11.2 must therefore keep the fail-closed path (`authorization-unavailable` when the client's `capabilities.elicitation` is absent) and verify against a real Claude Code session before documenting it as supported.

## Verification

**Commands:**
- `npm run typecheck` -- expected: no errors
- `npm test` -- expected: all green
- `npm run depcheck` -- expected: no violations
