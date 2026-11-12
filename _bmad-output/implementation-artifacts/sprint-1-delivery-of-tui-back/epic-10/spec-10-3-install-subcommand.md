---
title: 'Story 10.3: `install` subcommand'
type: 'feature'
created: '2026-11-09'
status: 'done'
baseline_commit: 'd75b734f6b5d3d09952ee5ddef4c89aea8bf8c06'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-10-context.md'
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A colleague has no single step to get `tui-back`, the `tb`/`tbt` aliases and bash completion onto their machine.

**Approach:** An `install` subcommand checks Node >= 24, runs `npm install -g github:<owner>/tui-back` (URL derived from `package.json` `repository`), writes `completion.bash` under `<dataDir>/` using Story 10.2's generator, and maintains one idempotent marked block in `~/.bashrc`. `--uninstall` reverses all three.

## Boundaries & Constraints

**Always:** AD-3 envelope (JSON line when piped, human text on TTY, exit 0/1 only). Process spawning and file I/O live in a driven adapter (`adapters/driven/installer`) behind an `InstallerPort` interface declared in `adapters/driving/cli/install.ts`; the dependency-cruiser rule forbids `child_process` in driving adapters. Paths from `resolveXdgPaths`. Rc block markers are exactly `# >>> tui-back >>>` / `# <<< tui-back <<<`; block defines `alias tb='tui-back'`, `alias tbt='tui-back tui'` and sources the completion file if present. Node check runs first and changes nothing on failure. Output ends by telling the user to `source ~/.bashrc`.

**Ask First:** Any change to `Subcommand`/`renderResult` signatures; dropping `private: true`.

**Never:** Changing Node itself; editing MCP client config (Epic 11); zsh/fish rc support; touching a real `~/.bashrc` in tests; new dependencies.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Old Node | `process.version` < 24 | nothing changed, nvm/apt/brew instructions | exit 1, `unsupported-node` |
| Happy path | Node >= 24, stub npm ok | npm global install, completion file written, block appended | ok envelope with `{npmInstalled, completionFile, rcFile, shellWarning}` |
| Second run | block already present | block replaced in place, exactly one block remains | N/A |
| EACCES | npm fails with EACCES | remedy printed (`npm config set prefix ~/.local`, add to `PATH`) | exit 1, `permission-denied` |
| Other shell | `$SHELL` not bash | warning in result; npm install still done | N/A |
| Uninstall | `--uninstall`, pieces missing | block, completion file, global package removed; missing piece skipped | never an error for absence |
| Bad args | unknown flag / extra arg | usage | exit 1, `invalid-argument` |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/cli/subcommands.ts` -- registry; `completion` is pushed last (~L525) and `install` must be pushed before it so completion lists it. `COMPLETION_USAGE` const at L106; deps object at L108.
- `src/adapters/driving/cli/completion-spec.ts` -- `generateBashCompletion({commands})`, pure; reuse in-process.
- `src/adapters/driven/xdg/index.ts` -- `resolveXdgPaths(env, homedir)` gives `dataDir`; pass env/home explicitly for tests.
- `src/adapters/driven/` -- sibling adapters (`docker`, `process.ts`) show spawn conventions; add `installer/index.ts` here.
- `src/bin/main.ts` -- composition root (~L87); add the installer to `buildSubcommands` deps.
- `src/bin/tui-back.e2e.test.ts` -- docker stub pattern (~L1935-1992: `makeLoggingDockerStub`, `withDocker`); reuse for a stub `npm`. Also holds the help-vs-completion name guard, which will cover `install` automatically.
- `package.json` -- has no `repository` field; add `"repository": {"type":"git","url":"git+https://github.com/Maxe2005/tui-back.git"}` (origin remote confirms owner).
- `AGENTS.md`, `docs/` -- document `install` / `--uninstall`.

## Tasks & Acceptance

**Execution:**
- [ ] `package.json` -- add `repository`; keep `private: true`
- [ ] `src/adapters/driving/cli/install.ts` -- `InstallerPort`, pure helpers: Node-version check, `github:` spec from repository URL, rc block render/replace/remove -- pure and unit-testable
- [ ] `src/adapters/driving/cli/install.test.ts` -- unit tests: version parse, URL derivation, block idempotence, removal, no-op removal
- [ ] `src/adapters/driven/installer/index.ts` -- real port: `npm install -g`/`uninstall -g` via spawn (EACCES detection), read/write rc file, write/remove completion file
- [ ] `src/adapters/driving/cli/subcommands.ts`, `src/bin/main.ts` -- register `install` before `completion`; wire installer, `process.version`, env and homedir
- [ ] `src/bin/tui-back.e2e.test.ts` -- temp `HOME`/`XDG_DATA_HOME`, stub `npm` on `PATH`: idempotence, aliases, envelope shape, `--uninstall`, EACCES, non-bash shell, Node-too-old path if injectable
- [ ] `AGENTS.md`, `docs/` -- document the command

**Acceptance Criteria:**
- Given the installer runs twice, then `~/.bashrc` contains exactly one marked block.
- Given `--uninstall` on a clean machine, then exit 0 and nothing is created.
- Given `npm test && npm run typecheck && npm run depcheck`, then all pass.

## Design Notes

Block shape:
```
# >>> tui-back >>>
alias tb='tui-back'
alias tbt='tui-back tui'
[ -f "<dataDir>/completion.bash" ] && source "<dataDir>/completion.bash"
# <<< tui-back <<<
```
Replace/remove touches only text between the markers; the rest of the rc file is preserved byte for byte.

## Verification

**Commands:**
- `npm test` -- expected: all green
- `npm run typecheck && npm run depcheck` -- expected: no errors

## Suggested Review Order

**Install flow**

- Entry point: Node gate, rc pre-read, npm, completion file, rc block, uninstall in reverse.
  [`install.ts:195`](../../../src/adapters/driving/cli/install.ts#L195)

- Idempotent marked block: upsert replaces in place, corrupt markers refuse.
  [`install.ts:127`](../../../src/adapters/driving/cli/install.ts#L127)

- Repository host anchored to github.com before it reaches npm.
  [`install.ts:60`](../../../src/adapters/driving/cli/install.ts#L60)

**Side effects (driven adapter)**

- Real port: npm via shared process runner, EACCES detection, file I/O.
  [`index.ts:12`](../../../src/adapters/driven/installer/index.ts#L12)

**Wiring**

- Registered before `completion` so the generated script lists `install`.
  [`subcommands.ts:531`](../../../src/adapters/driving/cli/subcommands.ts#L531)

- Composition root injects installer, Node version, env, home and data dir.
  [`main.ts:99`](../../../src/bin/main.ts#L99)

**Tests**

- Unit: helpers, partial failures, corrupt blocks, TTY text.
  [`install.test.ts:77`](../../../src/adapters/driving/cli/install.test.ts#L77)

- Black-box with temp HOME and stub npm.
  [`tui-back.e2e.test.ts:2645`](../../../src/bin/tui-back.e2e.test.ts#L2645)
