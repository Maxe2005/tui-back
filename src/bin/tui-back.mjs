#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { register } from 'tsx/esm/api'
// Pin the package's own tsconfig (jsx: react-jsx): tsx otherwise reads the tsconfig of the
// *current directory*, so an installed `tui-back tui` crashed with "React is not defined".
register({ tsconfig: fileURLToPath(new URL('../../tsconfig.json', import.meta.url)) })
// Single binary: `tui-back tui` opens the TUI (raw terminal, no AD-3 envelope);
// anything else is the CLI.
await import(process.argv[2] === 'tui' ? './tui.ts' : './main.ts')
