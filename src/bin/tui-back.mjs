#!/usr/bin/env node
import { register } from 'tsx/esm/api'
register()
// Single binary: `tui-back tui` opens the TUI (raw terminal, no AD-3 envelope);
// anything else is the CLI.
await import(process.argv[2] === 'tui' ? './tui.ts' : './main.ts')
