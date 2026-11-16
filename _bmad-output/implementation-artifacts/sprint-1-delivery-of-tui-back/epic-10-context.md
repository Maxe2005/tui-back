# Epic 10 Context: Distribution — npx Installer, Aliases & Shell Completion

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A colleague installs the tool with a single command, gets the `tb` and `tbt` aliases and bash completion, and can update or remove it the same way. This turns the repo into something shareable from a URL: one working global binary, a generated completion script, an idempotent installer, and a published repo with an install script and README.

## Stories

- Story 10.1: Repair the Bin — One Binary, `tui` Routing
- Story 10.2: `completion bash` Subcommand
- Story 10.3: `install` Subcommand
- Story 10.4: Publication, `install.sh` and Docs

## Requirements & Constraints

- The package exposes exactly one bin, `tui-back`. `tui-back <subcommand>` runs the CLI; `tui-back tui` opens the TUI and exits 1 with a clear message when stdin is not a TTY.
- `tui-back --help` must list `tui` even though it is not in the subcommand registry.
- `npx -y github:<owner>/tui-back install` installs globally via npm, adds `tb` (`tui-back`) and `tbt` (`tui-back tui`) aliases and bash completion through a marked, idempotent `~/.bashrc` block. Running it twice leaves one block. It ends by telling the user to reload the shell.
- `install --uninstall` removes the rc block, completion file and global package; missing pieces are not errors.
- Node below 24 stops the install with exact nvm/apt/brew instructions and changes nothing; the installer never changes Node itself. On `EACCES` it prints the npm prefix remedy and exits 1.
- Bash is the only supported shell; other shells get a warning while the npm install still proceeds.
- The installed package must exclude planning/agent folders (`_bmad-output`, `.agents`) via `files` or `.npmignore`; license is ISC.
- Dynamic completion (EDT topics, repo paths) is out of scope for v1. A guided wizard remains out of scope.
- `install.sh` checks `git` and Node >= 24, then runs the npx install; if `better-sqlite3` prebuild fails, the README notes the `build-essential` fallback.

## Technical Decisions

- No compiled binary: the tool keeps running on `tsx`/`node`, so `tsx` is a runtime dependency. A single `.mjs` shim routes on `argv[2]`: `tui` loads the TUI entry (bypassing the AD-3 envelope, raw terminal), anything else loads the CLI main. The old second shim is deleted and docs referencing it are updated.
- The installer and `completion` live in `adapters/driving/cli`, not `core/`, a deliberate and non-precedent-setting exception. They are not Must-scope actions so CLI/TUI parity does not apply, but they use the standard AD-3 envelope: human text on a TTY, one JSON line when piped, exit code 0/1 only.
- The completion generator is a pure function over the subcommand registry, callable in-process (the installer uses it) and producing script that passes `bash -n`. `completion bash` prints the raw script on a TTY, else carries it in `data.script`.
- Paths (completion file under the XDG data dir) come from the existing XDG helper so tests can redirect them. Rc-file block uses fixed markers `# >>> tui-back >>>` / `# <<< tui-back <<<`.
- The installer only prints MCP registration commands (Epic 11) and never edits client config.
- Tests: guard test that subcommand names in `--help` and in the completion output match both ways; e2e tests use temp `HOME`/`XDG_DATA_HOME` and a stub `npm` on `PATH` (same technique as the docker stubs); the real `~/.bashrc` is never touched. e2e also asserts bin keys equal `['tui-back']`, target exists and is executable. `npm run depcheck` must still pass with `.mjs` shims.
- 10.1 includes a spike: global install from GitHub or local `npm pack` with `private: true`; if it fails, drop `private` and record why in the story file.
- The AD-14 amendment and AD-24 are recorded in the architecture spine with a memlog entry.

## Cross-Story Dependencies

- 10.1 blocks everything; order is 10.1 → 10.2 → 10.3 → 10.4.
- 10.2 needs Epic 9's subcommands (already merged into `devlopment`) so completion sees them.
- 10.3 consumes 10.2's generator in-process.
- 10.4 depends on 10.1–10.3; creating the public GitHub repo, confirming the default branch and the first push are manual steps for the maintainer, and nothing is pushed without approval.
- Epic 11 (MCP server) extends the installer later by printing registration commands.
