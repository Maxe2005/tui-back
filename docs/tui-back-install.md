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

Piped output is one JSON line: `{ npmInstalled, completionFile, rcFile, shellWarning, nextStep }` (uninstall: `{ npmRemoved, completionRemoved, rcBlockRemoved, completionFile, rcFile, nextStep }`).
