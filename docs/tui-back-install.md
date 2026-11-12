# Installing tui-back

```
tui-back install [--uninstall]
```

`install` does three things, in this order, and changes nothing if the first fails:

1. Checks Node >= 24. On an older Node it exits 1 with `unsupported-node` and nvm/apt/brew instructions; it never changes Node itself.
2. Runs `npm install -g github:<owner>/tui-back` (the URL comes from `package.json` `repository`). On `EACCES` it exits 1 with `permission-denied` and the remedy: `npm config set prefix ~/.local`, then add `~/.local/bin` to `PATH`.
3. Writes `<dataDir>/completion.bash` (XDG data dir, normally `~/.local/share/tui-back/`) and maintains one block in `~/.bashrc`:

```
# >>> tui-back >>>
alias tb='tui-back'
alias tbt='tui-back tui'
[ -f "<dataDir>/completion.bash" ] && source "<dataDir>/completion.bash"
# <<< tui-back <<<
```

Running it again replaces the block in place; the rest of `~/.bashrc` is preserved. Run `source ~/.bashrc` afterwards.

Only bash is supported. With another `$SHELL` the npm install still runs and the result carries a `shellWarning`.

`--uninstall` removes the rc block, the completion file and the global package. A missing piece is skipped, never an error.

Piped output is one JSON line: `{ npmInstalled, completionFile, rcFile, shellWarning, nextStep, mcp }` (uninstall: `{ npmRemoved, completionRemoved, rcBlockRemoved, completionFile, rcFile, nextStep, mcpNote }`).

## MCP registration

On success, `install` adds `mcp: { command, config }` to its result: `command` is `claude mcp add tui-back -- tui-back mcp` and `config` is `{"mcpServers":{"tui-back":{"command":"tui-back","args":["mcp"]}}}` for other clients. Human text prints both, labelled "not applied". The installer never runs the command and never edits `~/.claude.json`, `.mcp.json` or any client config; it writes only the files listed above. On any error no registration text is returned.

`--uninstall` adds `mcpNote`, naming `claude mcp remove tui-back` and removing the `tui-back` entry from other clients' config by hand.

## Error codes

`unsupported-node`, `permission-denied`, `npm-not-found`, `npm-failed`, `repository-unresolved`, `io-failed`, `rc-block-corrupt` (a start marker without its end marker in `~/.bashrc`: fix it by hand), `invalid-argument`. All exit 1.

`--uninstall` runs `npm uninstall -g` first; if that fails, the rc block and completion file are left untouched so a retry works. If `npm` is not found, the package removal is skipped and the local pieces are still removed. Only the completion file is deleted: the rest of the data directory is left in place.
