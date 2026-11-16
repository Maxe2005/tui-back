# Epic 11 Context: MCP Server

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

An AI agent can drive tui-back through MCP (`tui-back mcp`, stdio), while anything that changes or destroys workspace state requires the human's explicit approval, enforced by the server itself and not left to the model's behaviour. This lets agents inspect and operate the workspace without being able to silently modify or delete it.

## Stories

- Story 11.1: MCP Skeleton and Read-Only Tools
- Story 11.2: Authorization Gate and Write Tools
- Story 11.3: Destructive Tools and Long Operations
- Story 11.4: Install Registration and Docs

## Requirements & Constraints

- Every subcommand is reachable as an MCP tool. Read-only tools run freely; tools that change or destroy state run only after the human approves that exact call.
- Approvals are per call, never remembered for later calls in the session.
- If the connected client cannot elicit, write and destructive tools are refused (fail closed) with a clear error; read tools keep working.
- Denied, cancelled or timed-out approvals run nothing and return an error envelope with a kebab-case code (e.g. `authorization-denied`, `authorization-unavailable`).
- Stdout carries MCP protocol messages only. Tools must never read stdin (commands that normally prompt, such as `registry clean`, get their confirmation through the gate).
- Secrets (dev-auth tokens, e.g. from `fire-request`) must never appear in tool results or authorization prompts. `fire-request` hits real endpoints, which the docs must warn about.
- Existing locks must still serialize conflicting operations between MCP and the TUI.

## Technical Decisions

- The MCP server is a driving adapter in `adapters/driving/mcp/`, running in-process over the same subcommand registry as the CLI. The port wiring in `bin/main.ts` is extracted into a shared composition factory used by both the CLI and the MCP server.
- Tool registry is declarative: one entry per tool with name, zod input schema, wrapped subcommand and safety class `read | write | destructive`. A tool cannot be registered without a class (registration error). The authorization gate lives in one place.
- Tool results are the AD-3 envelope (`{ok,data}` / `{ok,error:{code,message,details}}`).
- Annotations (`readOnlyHint`, `destructiveHint`) are set for clients but are advisory only and never relied upon.
- A black-box guard test (same pattern as the completion guard) requires every subcommand in `tui-back --help` to be either in the registry with a class or in an explicit exclusion list with a reason.
- New dependency `@modelcontextprotocol/sdk`, pinned to an exact version checked at implementation time. Story 11.1 includes a spike recording the SDK version and whether Claude Code supports elicitation; the result goes in the story file and decides 11.2's wording.
- Elicitation prompts show the tool, its exact arguments and the repos or EDTs affected; destructive prompts name exactly what will be lost or changed. Tests use a fake client covering accept, decline, timeout and no-elicitation per class.
- `update` reports MCP progress notifications and honours cancellation (the AD-20 bounded run still applies).
- The installer (AD-24) only prints MCP registration commands (`claude mcp add tui-back -- tui-back mcp` plus JSON config for other clients) and never edits client config.

## Cross-Story Dependencies

- Order: 11.1 -> 11.2 -> 11.3 -> 11.4; the epic starts after Story 10.1.
- 11.2 builds on 11.1's registry and the spike result; 11.3 reuses 11.2's gate for destructive tools.
- 11.4 also needs Story 10.3 (the `install` command) and 11.3 (the final tool list for the README).
