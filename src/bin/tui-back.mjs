#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { register } from 'tsx/esm/api'
// Pin the package's own tsconfig (jsx: react-jsx): tsx otherwise reads the tsconfig of the
// *current directory*, so an installed `tui-back tui` crashed with "React is not defined".
register({ tsconfig: fileURLToPath(new URL('../../tsconfig.json', import.meta.url)) })
// Single binary: `tui-back tui` opens the TUI (raw terminal, no AD-3 envelope);
// `tui-back mcp` serves MCP over stdio; anything else is the CLI.
const entries = { tui: './tui.ts', mcp: './mcp.ts' }
const entry = Object.hasOwn(entries, process.argv[2]) ? entries[process.argv[2]] : './main.ts'
await import(entry)
