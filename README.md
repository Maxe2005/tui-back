# tui-back

A terminal UI and CLI to manage a set of backend micro-service repositories as one working unit (EDTs, updates, logs, routes).

Requires Node >= 24, git and bash.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/Maxe2005/tui-back/HEAD/install.sh | bash
```

`install.sh` itself writes nothing: it checks `git` and Node >= 24 (printing nvm/apt/brew instructions and stopping if one is missing), then runs the npm installer. That installer modifies the global npm prefix, `~/.bashrc` and `<XDG data dir>/tui-back/completion.bash`. To pass flags through the pipe, use `bash -s -- --uninstall`. You can skip it:

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

## MCP server

`tui-back mcp` runs an MCP server over stdio so an AI agent can drive tui-back. Register it with your client (the installer prints these but never edits any client config):

```bash
claude mcp add tui-back -- tui-back mcp
```

```json
{ "mcpServers": { "tui-back": { "command": "tui-back", "args": ["mcp"] } } }
```

The command registers the server at Claude Code's default (local) scope; add `--scope user` to make it available from every directory. `tui-back` must be on the `PATH` of the client's environment (the global npm install provides it). `tui-back mcp` is stdio-only and takes no flags.

To remove it: `claude mcp remove tui-back`, or delete the `tui-back` entry from the other client's config.

### Tools by safety class

#### read

Run freely, no approval.

`dashboard`, `edts`, `list-repos`, `list-routes`, `request-list`, `ping`, `registry-validate`

#### write

Change workspace state; each call needs your approval.

`register`, `scan`, `edt-create`, `edt-modify`, `edt-switch`, `realign`, `heal`, `fire-request`, `request-fire`

#### destructive

Can delete or overwrite data; each call needs your approval, and the prompt names what will be lost.

`edt-delete`, `edt-switch-discard`, `register-reset`, `request-delete`, `update`, `registry-clean`

### Authorization

- Every write and destructive call triggers an approval prompt (MCP elicitation) showing the tool, its exact arguments and the repos or EDTs affected.
- Approvals are per call and never cached: the next call asks again.
- Decline, cancel or timeout runs nothing and returns an error (`authorization-denied`).
- Fail closed: if the client does not support elicitation, write and destructive tools are refused with `authorization-unavailable`. Read tools keep working.
- Secrets such as dev-auth tokens never appear in tool results or prompts.

Warning: `fire-request` and `request-fire` send requests to real endpoints. Approve them only for targets you intend to hit.

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
