#!/usr/bin/env node
import { register } from 'tsx/esm/api'
register()
// Single binary: `tui-back tui` opens the TUI (raw terminal, no AD-3 envelope);
// `tui-back mcp` serves MCP over stdio; anything else is the CLI.
const entries = { tui: './tui.ts', mcp: './mcp.ts' }
const entry = Object.hasOwn(entries, process.argv[2]) ? entries[process.argv[2]] : './main.ts'
await import(entry)
