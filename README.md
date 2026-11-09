# tui-back

A terminal UI and CLI to manage a set of backend micro-service repositories as one working unit (EDTs, updates, logs, routes).

Requires Node >= 24, git and bash.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/Maxe2005/tui-back/HEAD/install.sh | bash
```

`install.sh` only checks `git` and Node >= 24 (it changes nothing and prints nvm/apt/brew instructions if one is missing), then runs the npm installer. You can skip it:

```bash
npx -y github:Maxe2005/tui-back install
```

The installer runs `npm install -g`, adds the `tb` and `tbt` aliases and bash completion through one marked block in `~/.bashrc`, then asks you to reload your shell:

```bash
source ~/.bashrc
```

Details, error codes and permission remedies: [docs/tui-back-install.md](docs/tui-back-install.md).

### If `better-sqlite3` fails to build

`better-sqlite3` normally ships a prebuilt binary. If none matches your platform, npm compiles it and needs a toolchain:

```bash
sudo apt install build-essential python3   # Debian/Ubuntu
xcode-select --install                      # macOS
```

Then re-run the install.

## Usage

```bash
tui-back --help        # list subcommands
tui-back <subcommand>  # CLI: one JSON line when piped, human text on a TTY
tui-back tui           # open the TUI (needs an interactive terminal)
```

Aliases: `tb` is `tui-back`, `tbt` is `tui-back tui`.

Completion: `tui-back completion bash` prints the bash completion script; `install` wires it up for you.

## Update

Re-run the install command. The `~/.bashrc` block is replaced in place, never duplicated.

## Uninstall

```bash
tui-back install --uninstall
```

This removes the `~/.bashrc` block, the completion file and the global package. The rest of the data directory is left in place.

## Development

```bash
npm ci
npm test && npm run typecheck && npm run depcheck
node src/bin/tui-back.mjs --help
```

## License

ISC
