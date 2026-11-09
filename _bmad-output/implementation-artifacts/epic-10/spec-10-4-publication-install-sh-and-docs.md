---
title: 'Story 10.4: Publication, `install.sh` and Docs'
type: 'feature'
created: '2026-11-09'
status: 'in-review'
baseline_commit: '4545bdf94f87b3c1099bd367cc68b73f7dccbfd5'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-10-context.md'
  - '{project-root}/AGENTS.md'
  - '{project-root}/docs/tui-back-install.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The repo is not shareable from a URL: no `install.sh`, no README, no LICENSE, and the installed package would ship `_bmad-output`, `.agents` and other planning folders.

**Approach:** Add a bash `install.sh` that checks `git` and Node >= 24 then runs `npx -y github:Maxe2005/tui-back install`; add a README, an ISC LICENSE and a `package.json` `files` allow-list (with `.npmignore` only if `files` is not honoured by git installs); record the memlog entry for the AD-14 amendment and AD-24 (already in the spine).

## Boundaries & Constraints

**Always:** `install.sh` passes `bash -n`, is executable, modifies nothing when a check fails (exit 1, precise instructions: nvm/apt/brew for Node, apt/brew for git). Owner is `Maxe2005` (origin remote). README is in English and covers installation, commands, `tb`/`tbt` aliases, completion, update (re-run install), uninstall, and the `build-essential` fallback when the `better-sqlite3` prebuild fails. Docs stay consistent with `docs/tui-back-install.md`.

**Ask First:** Dropping `private: true`; any change to the `install` subcommand's behaviour.

**Never:** Create the GitHub repo, push, or publish to npm (manual steps for Max); change Node; edit the spine ADs (already present); new dependencies.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | `git` present, Node >= 24 | runs `npx -y github:Maxe2005/tui-back install`, propagates its exit code | N/A |
| Old Node | Node < 24 | nothing run, nvm/apt/brew instructions | exit 1 |
| No Node / no npx | `node` or `npx` absent | install instructions | exit 1 |
| No git | `git` absent | install instructions | exit 1 |

</frozen-after-approval>

## Code Map

- `package.json` -- has `repository` and `private: true`, no `files`; add `files` allow-list (`src`, minus tests) and keep `private`.
- `src/bin/tui-back.mjs`, `src/bin/main.ts`, `src/bin/tui.ts` -- runtime entries that must stay in the package; `tsx` is a runtime dep.
- `src/adapters/driving/cli/install.ts` -- derives the `github:` spec from `repository`; `install.sh` must target the same repo.
- `src/bin/tui-back.e2e.test.ts` -- stub-on-`PATH` technique (docker stub ~L1935-1992) to reuse for stubbing `node`/`git` in an `install.sh` test.
- `docs/tui-back-install.md` -- existing install reference; README links to it.
- `_bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/.memlog.md` -- no 2026-11-05 entry yet; append one for the AD-14 amendment and AD-24.
- `ARCHITECTURE-SPINE.md` (same folder) -- AD-14 (L160) and AD-24 (L273) already present; read-only.
- `AGENTS.md` -- mention README/`install.sh` if it lists repo files.

## Tasks & Acceptance

**Execution:**
- [x] `install.sh` -- bash script: `set -eu`, check git, node, npx, Node major >= 24, then `exec npx -y github:Maxe2005/tui-back install "$@"`; executable bit
- [x] `src/bin/install-sh.e2e.test.ts` -- `bash -n`; stubbed `PATH` cases from the matrix (no git, old Node, happy path with stub `npx` recording its args)
- [x] `LICENSE` -- ISC text, copyright Maxence Choisel
- [x] `package.json` -- add `files`; verify with `npm pack --dry-run` that `_bmad-output`, `.agents`, `.claude`, `.opencode`, `.bmad-loop` are absent and `src/bin/tui-back.mjs` present; add `.npmignore` only if needed
- [x] `README.md` -- install one-liner (curl `install.sh` and `npx`), commands, aliases, completion, update, uninstall, `build-essential` fallback, link to docs
- [x] `.memlog.md` -- append (decision) entry: AD-14 amendment + AD-24 added 2026-11-05
- [x] `_bmad-output/implementation-artifacts/epic-10/spec-10-4-publication-install-sh-and-docs.md` -- record the clean-machine result (container run if available, else mark as pending manual step for Max)

**Acceptance Criteria:**
- Given `install.sh`, when `bash -n` runs, then it passes; when a check fails, then exit 1 and nothing is installed.
- Given `npm pack --dry-run`, then no planning/agent folder is listed.
- Given `npm test && npm run typecheck && npm run depcheck`, then all pass.

## Design Notes

The `npx` install ends with the existing `install` subcommand (Story 10.3), so `install.sh` stays a thin precheck; it never writes files itself.

## Verification

**Commands:**
- `bash -n install.sh` -- expected: no output
- `npm pack --dry-run 2>&1 | grep -E "_bmad|\.agents|\.claude"` -- expected: no match
- `npm test && npm run typecheck && npm run depcheck` -- expected: all pass

**Manual checks (if no CLI):**
- Clean-container run of `install.sh` (needs the public repo and first push, which only Max can approve).

## Implementation Notes

- `npm pack --dry-run`: 266 files, no `_bmad-output`, `.agents`, `.claude`, `.opencode`, `.bmad-loop`, no test files; `src/bin/tui-back.mjs` present. `files` is honoured, so no `.npmignore`.
- Clean-machine run of `install.sh`: PENDING manual step for Max (needs the public repo and first push). Stubbed-PATH e2e covers the matrix.
- `npm test`: one pre-existing failure, `app-shell.interaction.test.tsx` (reset screen), also fails on the baseline without these changes. typecheck and depcheck pass.
