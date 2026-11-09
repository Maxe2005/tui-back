# Sprint Change Proposal — 2026-11-05: Epic 10 — Distribution (npx installer, aliases, bash completion, `tui` routing) + Epic 11 — MCP server + Stories 5.8, 5.9 and 5.10 — hide/show-only log filters, stackable filter rules, then saved rule sets

Mode: Batch. Scope: **Moderate** (two new epics: Epic 10 with 4 stories and Epic 11 with 4 stories; 3 new FRs, two architecture amendments and one new AD, a package/bin change, public publication of the repo; no rollback, no manifest schema change). Epic 11 (MCP server) and Stories 5.8 (hide / show-only log filters), 5.9 (stackable filter rules) and 5.10 (saved rule sets) were added to this proposal on 2026-11-05 at Max's request. Stories 5.8, 5.9 and 5.10 reopen the closed Epic 5.

## 1. Issue Summary

The tool is meant to be handed to colleagues, and nothing in the repo supports that today. AD-14 deferred packaging "until teammate distribution becomes a real goal"; that moment has come. A review of the repo found the following, each verified against the code:

| # | Finding | Evidence |
|---|---------|----------|
| 1 | **The `bin` map is broken.** | `package.json` maps `tui-back` → `src/bin/tui-back.mjs`, which imports `./tui.ts` (the TUI launcher). `tui-back-tui` → `src/bin/tui-back-tui.mjs`, which does not exist. The real CLI (`cli-back.mjs` → `main.ts`) is exposed nowhere. The e2e test (`tui-back.e2e.test.ts:145`) only checks the key names, not that the targets exist. |
| 2 | **`tsx` is a devDependency but needed at runtime.** | Both shims do `import { register } from 'tsx/esm/api'`. A global install would fail with `Cannot find package 'tsx'`. |
| 3 | **AD-14 says packaging is deferred.** | `ARCHITECTURE-SPINE.md` § AD-14 and the "Deferred" list. |
| 4 | **The repo is not publishable.** | No git remote, no `README.md`, no `LICENSE` (ISC is declared in `package.json` only), `"private": true`, no `files`/`repository` field. |
| 5 | **No BMad artifact covers distribution.** | Highest FR is FR-45 (Epic 9); no epic mentions install, alias or completion. |
| 7 | **The Logs filter can only keep matching lines.** | Story 5.2 / FR-17: one text or regex query keeps the lines that contain it. Max's `WebResto` logs are flooded with repeated `WARN`/`ERROR` lines from one use case (`Aucun service de restauration trouvé pour l'utilisateur …`), which the filter cannot remove; the only way to see the rest is to craft a positive regex for everything else. Even with a hide option, one pattern per filter forces a long regex alternation as soon as several kinds of noise must be hidden together, or whole lines and bare text hidden at once. Filter history (Story 5.4) stores plain query strings per scope+mode, with no room for a hide/show choice. |
| 6 | **No way for an AI agent to drive the tool.** | Max wants an MCP server. Every CLI subcommand already returns an AD-3 envelope from a `core` use-case (`subcommands.ts`), so the seam exists; nothing exposes it over MCP. |

## 2. Impact Analysis

**Epics**
- New **Epic 10** (4 stories) and new **Epic 11** (4 stories, MCP server). No existing story changes its acceptance criteria.
- **Epic 5** (done) is reopened for three new stories: **5.8** (hide / show-only filters with line or match-only scope), **5.9** (a stack of such rules per scope), then **5.10** (rules and named rule sets that survive a restart). They build on 5.2 (filter), 5.4 (history) and 5.5 (bounded editor); 5.9 needs 5.8 and 5.10 needs 5.9.  `epic-5` goes back to `in-progress` in `sprint-status.yaml` and returns to `done` when 5.10 is merged.
- Epic 11 depends on Story 10.1 (single `tui-back` binary) and on Story 10.3 for its install-time registration (11.4).
- Epic 9 was merged into `devlopment` on 2026-11-05 (merge 8ad7b011), after this analysis began. Story 10.2 therefore sees its subcommands (`heal`, `dashboard` and others); no sequencing constraint remains.

**PRD**: **FR-17** is amended and new **FR-49** added (log filter action and target, see §4.2); new **FR-48** (MCP server with human authorization, see §4.2), and **FR-46** (single installable binary with `tui` routing) and **FR-47** (guided install: aliases, bash completion, uninstall). The plan said "FR-46/47, to verify": verified, FR-44 and FR-45 are already used by SCP 2026-11-04-3, so 46/47 are the next free numbers. No NFR change. §6.2 "Guided onboarding/installation wizard — out of scope for v1" is superseded in part (see §4.3).

**Architecture**: **AD-14 is amended**, a new **AD-24** records the installer's placement, and a new **AD-25** records the MCP exposure and authorization policy (§4.3). The "Deferred" bullet on packaging mechanism is updated.

**UX**: no TUI screen changes. CLI only: `tui-back --help` gains `tui`, `completion`, `install`, `mcp`. For Epic 11 the human sees authorization prompts in their MCP client, not in this tool.

**Code and repo impact (indicative)**
- `src/bin/`: one unified shim `tui-back.mjs` (routes on `argv[2] === 'tui'`); `cli-back.mjs` deleted. `tui.ts:45` message becomes `tui-back tui requires an interactive terminal`.
- `package.json`: single `bin`, `tsx` → `dependencies`, `repository`, `files`, `private` spike result.
- `adapters/driving/cli`: `dispatch.ts` help line for `tui`; new `completion-spec.ts`; new `install` subcommand; `subcommands.ts` registration.
- Root: `install.sh`, `README.md`, `LICENSE`.
- Docs: `AGENTS.md` (§ Commands line 8, § Testing line 33), `CLAUDE.md` (tsx troubleshooting line), `docs/tui-back-manifest.md` is **not** affected (no manifest surface change).
- Tests: `tui-back.e2e.test.ts` (`scriptPath`, bin-target check), new e2e for `completion` and `install` with a stubbed `npm` on `PATH` and a temp `HOME`.

**Story 5.8 code impact (indicative)**
- `core/logs`: the filter model gains `action: 'show' | 'hide'` and `target: 'line' | 'match'`; a pure `applyLogFilter(line, filter)` returns the line to render (possibly rewritten) or nothing.
- `ports/state.ts` + `adapters/driven/state`: filter-history entries carry the action and the target. Lists stay keyed by scope+mode. A reader tolerant of legacy plain strings (read as `show` + `line`) means no migration step.
- 5.10 persists the rules and a library of named sets through the `StatePort` (state file), with a tolerant reader.
- 5.9 adds the rule list on top: `core/logs` pipeline `applyLogRules`, a rule-list component in `tui/logs`, and per-scope rule state in the Logs slice (not persisted).
- `tui/logs`: the filter editor gets the two toggles and shows the active combination; the Logs zone renders rewritten lines through the existing bounded primitives (AD-19). Keybinding declarations updated (the `?` help reads them).
- `:settings` Logs tab: history-clear actions are unchanged; no new setting.
- No CLI or MCP impact (there is no `logs` subcommand).

**Epic 11 code impact (indicative)**
- New `adapters/driving/mcp/`: server, a declarative tool registry (one entry per subcommand with its zod input schema and a safety class), the authorization gate.
- `bin/main.ts` composition root: extract the port wiring into a shared factory so the CLI and the MCP server build the same registry in-process.
- `subcommands.ts`: registered `mcp` subcommand (stdio transport). New dependency `@modelcontextprotocol/sdk`, pinned to an exact version checked at implementation time.

**Risks identified**
- **MCP (Epic 11):** an agent can reach destructive commands (`edt delete`, `edt switch --discard-dirty`, `reset`, `registry clean`, `update`). The authorization must be enforced by the server, not left to the model's good behaviour (see AD-25 in §4.3).
- `better-sqlite3` is a native module. A prebuild is usually available for Node 24; otherwise a toolchain is needed. `install.sh` must say so in plain words.
- `private: true` with `npm install -g github:…`: believed fine (`private` only blocks `npm publish`), but unverified. It is a spike in 10.1.
- `files` in `package.json` must apply to git installs; if not, a `.npmignore` is needed (verified in 10.4).
- The installer edits `~/.bashrc`. It must be idempotent, bounded by markers, and fully reversible.

## 3. Recommended Approach

**Direct Adjustment: add Epic 10.** Effort: medium (10.1 small, 10.2 small-to-medium, 10.3 medium, 10.4 medium plus manual steps). Risk: medium, concentrated in 10.4 (public publication, clean-machine run) and the native dependency. No rollback is needed.

### Decisions recorded (validated by Max before this proposal)

1. **Channel**: public GitHub repo, installed with `npx -y github:<owner>/tui-back install` (bmad-method pattern). No compiled binary; the tool stays on `tsx`/`node`.
2. **Commands**: one npm binary, `tui-back` (CLI) and `tui-back tui` (TUI).
3. **Shell**: bash only. Aliases `tb` (CLI) and `tbt` (TUI).
4. **Missing Node**: `install.sh` detects it and prints the exact commands (nvm/apt/brew). It never modifies the machine.
5. **Process**: full BMad epic (epics.md, sprint-status, one branch per story).

### Story 5.8 decisions (from Max's request, defaults proposed by this analysis)

9. **Two new choices on a filter, both stored in history:** the **action** (`show` = keep only what matches, today's behaviour; `hide` = remove what matches) and the **target** (`line` = act on the whole line; `match` = act only on the matched text).
10. **Meaning of `match`:** `hide` + `match` removes the matched text from each line that contains it and keeps the rest of the line; `show` + `match` displays only the matched text of the lines that contain it (like `grep -o`). A line left empty after removal is not displayed.
11. **Default is today's behaviour** (`show` + `line`). Existing history entries and existing habits are unchanged.
12. **5.8 keeps one rule per filter editor, as today.** Several patterns at once are expressed with regex alternation (`Aucun service|n'est pas mappé`). Validated by Max: **Story 5.9 is prepared now** and adds the stack of rules (decisions 15–18). 5.8 must already define the rule shape (`query`, `mode`, `action`, `target`) as a named type so that 5.9 only adds a list around it.
13. **Filtering stays a view concern.** The log buffer is never rewritten, so clearing the filter (`Esc`) restores every original line, and the existing AND combination with service and level filters (5.2) is unchanged. An invalid regex is still rejected inline.
14. **Delivery.** Epic 5 is closed and merged. *Recommendation:* implement 5.8 on a `story-5-8-…` branch and merge it into `devlopment` by pull request, (Epic 9, including Story 9.5 on the same Logs zone, is already merged).

### Story 5.9 decisions (Max asked to prepare it with 5.8; defaults proposed by this analysis)

15. **A filter becomes an ordered list of rules**, per scope (global, or one service), each rule being the 5.8 shape plus an `enabled` flag. A scope with no rule behaves as unfiltered.
16. **Rules apply as a pipeline, top to bottom** (like `grep a | grep -v b`): each rule receives the lines the previous one produced. Consequences: two `show` rules combine as AND (use regex alternation for OR); a `hide` + `match` rule rewrites lines for the rules below it, so order matters and rules can be moved up and down. Disabled rules are skipped.
17. **In 5.9 the rule list stays ephemeral** (Story 5.2's boundary), while each rule's text keeps going to the filter history (Story 5.4). Max wants rule sets kept across restarts; that is **Story 5.10**, kept separate because it reverses 5.2's boundary on purpose (decisions 19–21).
18. **Bounded.** At most 10 rules per scope (constant, not a setting); the list is a windowed, keyboard-driven list (AD-19). Regexes are compiled once per rule-list change, not per line.

### Story 5.10 decisions (Max wants the rule sets kept; delivered in its own story)

19. **Two things persist:** (a) the **active rule list of each scope** (global, and each service), restored when the Logs tab opens after a restart, so noise rules do not have to be rebuilt; (b) **named rule sets**, a library of rule lists the developer saves under a name and can apply later to any scope.
20. **Applying a set copies its rules into the scope's active list**, replacing it after a confirmation if the list is not empty. A set is a snapshot: editing the active list afterwards does not change the saved set unless the developer saves it again under the same name (overwrite asks to confirm).
21. **Storage is the state file**, next to the filter history, through the `StatePort`; a missing or corrupt value falls back to an empty library with the usual warning, and a stored rule whose regex no longer compiles is dropped with a visible warning rather than crashing the view. The 5.2 "never persisted" boundary is amended to "the *stream and buffer* are never persisted; filter rules are".

### Epic 11 decisions (validated by Max on 2026-11-05)

6. **Separate Epic 11**, depending on Story 10.1. Epic 10 stays about distribution.
7. **Full surface exposed: read, write and destructive.** Every subcommand is reachable over MCP, but each tool carries a safety class (`read`, `write`, `destructive`) and anything above `read` requires an explicit authorization from the human, never from the model alone.
8. **Authorization is enforced by the server, fail closed.** Write and destructive tools ask the human through MCP elicitation (a prompt the client shows to the user). If the connected client does not support elicitation, those tools are refused with a clear error; they never run unconfirmed. Tool annotations (`readOnlyHint`, `destructiveHint`) are also set so clients can add their own prompt, but they are advisory and not relied upon.

### Points raised by this analysis (recommendation first)

1. **Sequencing against Epic 9. Resolved:** Epic 9 was merged into `devlopment` (8ad7b011) while this proposal was being written, so the Epic 10 branch can be created from `devlopment` now. Original analysis, kept for the record: the branch had to wait for the merge. Stories 10.1, 10.3 and 10.4 do not depend on Epic 9, but 10.2's guard test compares `--help` with the completion output, and its generator must list the Epic 9 subcommands. Alternative if you want to start sooner: branch now, run 10.1 first, and rebase before 10.2. The working tree was on `story-9-9-dashboard-heal-action` with uncommitted changes when this started; it is now on `devlopment`, clean.
2. **Where the installer lives.** The plan puts `install` in `adapters/driving/cli` (spawning `npm`, writing `~/.bashrc`). *Recommendation:* accept it. It is a distribution concern, not a Must-scope action, so FR-1 script/CLI parity does not apply. It still goes through the dispatch envelope (AD-3). Record this as AD-24 so the deviation from "business logic lives in `core/`" is deliberate and not a precedent. Resolve paths through the existing XDG helper (`resolveXdgPaths`) rather than hardcoding `~/.local/share`, so tests can redirect them with `XDG_DATA_HOME`.
3. **README language.** *Recommendation:* English, like every document in this repo except `docs/tui-back-manifest.md`. Say so if the colleagues need French.
4. **Default branch name.** `install.sh` is fetched from a raw URL that embeds the branch. The plan keeps `devlopment` (spelling kept). *Recommendation:* decide in 10.4 whether to rename the default branch at the GitHub side before the first public push; a typo in a public URL is costly to change later.

## 4. Detailed Change Proposals

### 4.1 Epics (`epics.md`)

**FR Coverage Map**, append:

```
FR-46: Epic 10 - Single installable binary: `tui-back` (CLI) and `tui-back tui` (TUI) (added 2026-11-05 — Story 10.1)
FR-47: Epic 10 - Guided install and uninstall: global npm install, aliases, bash completion (added 2026-11-05 — Stories 10.2, 10.3, 10.4)
FR-49: Epic 5 - Log filter action (show/hide) and target (line/match), stored in filter history (added 2026-11-05 — Story 5.8; stackable rules: Story 5.9; persisted rules and named sets: Story 5.10)
FR-48: Epic 11 - MCP server exposing every subcommand, with human authorization for write and destructive tools (added 2026-11-05 — Stories 11.1–11.4)
```

**Epic List**, append (Epic 10, then Epic 11 below):

```
### Epic 10: Distribution — npx Installer, Aliases & Shell Completion
> Added 2026-11-05 (Sprint Change Proposal `sprint-change-proposal-2026-11-05.md`). Amends AD-14, adds AD-24.

A colleague installs the tool with one command, gets `tb` and `tbt` aliases and bash completion, and can update or remove it the same way.
**FRs covered:** FR-46, FR-47
**Implementation notes:** Order: 10.1 → 10.2 → 10.3 → 10.4 (10.1 blocks the others). Epic 9 is already merged into `devlopment` (merge 8ad7b011, 2026-11-05), so 10.2 sees its subcommands. Branch: `epic-10-distribution-npx-installer-shell-completion`.
```

**NEW — Epic 10 section** (four stories; Epic 11 follows in the same subsection):

```
## Epic 10: Distribution — npx Installer, Aliases & Shell Completion

### Story 10.1: Repair the Bin — One Binary, `tui` Routing

As a colleague installing the tool, I want one `tui-back` command that runs the CLI and, with `tui`, the TUI, so that a global install actually works.

**Acceptance Criteria:**

**Given** `package.json` **Then** `bin` is exactly `{ "tui-back": "./src/bin/tui-back.mjs" }` and `tsx` is in `dependencies`.

**Given** `src/bin/tui-back.mjs` **When** `argv[2] === 'tui'` **Then** it loads `./tui.ts` (the TUI bypasses the AD-3 envelope and keeps the raw terminal); **otherwise** it loads `./main.ts`. `cli-back.mjs` is deleted.

**Given** a non-TTY stdin **When** `tui-back tui` runs **Then** exit code is 1 and stderr says `tui-back tui requires an interactive terminal` (message updated in `tui.ts`).

**Given** `tui-back --help` **Then** the JSON lists a static `tui` entry (it is not in the subcommand registry).

**Given** the e2e suite **Then** it asserts the `bin` keys equal `['tui-back']` and that the target file exists and is executable, and `scriptPath` points at the unified shim.

**Given** `AGENTS.md` (§ Commands, § Testing) and `CLAUDE.md` (tsx troubleshooting) **Then** they no longer mention `cli-back.mjs` or `tui-back-tui`.

**Given** the spike **Then** `npm install -g github:…` (or an equivalent local `npm pack` + `npm i -g`) of the package with `private: true` is tried; if it fails, `private` is removed and the reason is recorded in the story file.

**Implementation notes:** `tui.ts` keeps its top-level `process.exit(1)`; only the message changes. `npm run depcheck` must still pass with `.mjs` shims in the graph.

### Story 10.2: `completion bash` Subcommand

As a colleague, I want tab completion for `tui-back`, so that I do not have to remember subcommands and actions.

**Acceptance Criteria:**

**Given** `src/adapters/driving/cli/completion-spec.ts` **Then** it generates a bash script from the subcommand registry (subcommand names, `edt` and `registry` actions, flags documented in the usage strings), plus `tui` and `--help`.

**Given** `tui-back completion bash` **When** stdout is a TTY **Then** the raw script is printed; **otherwise** the AD-3 JSON envelope carries it in `data.script`.

**Given** the guard test (black-box, dialog-registry pattern) **Then** every subcommand name in `tui-back --help` appears in the `completion bash` output and vice versa.

**Given** the generator **Then** it is a pure function callable in-process (used by Story 10.3), with `bash -n` passing on its output.

**Out of scope (v1):** dynamic completion (EDT topics, repo paths).

**Prerequisites:** 10.1; Epic 9 merged (subcommand list).

### Story 10.3: `install` Subcommand

As a colleague, I want `npx -y github:<owner>/tui-back install` to set everything up, so that I get the command, the aliases and the completion in one step.

**Acceptance Criteria:**

**Given** `tui-back install` **When** `process.version` is below 24 **Then** it exits 1 with the exact nvm/apt/brew instructions and changes nothing.

**Given** a supported Node **Then** it runs `npm install -g github:<owner>/tui-back` (URL derived from `package.json` `repository`); on `EACCES` it prints the remedy (`npm config set prefix ~/.local`, add to `PATH`) and exits 1.

**Given** a successful install **Then** `completion.bash` is written under the XDG data dir (`<XDG_DATA_HOME>/tui-back/`), generated in-process by Story 10.2's generator.

**Given** `~/.bashrc` **Then** an idempotent block between `# >>> tui-back >>>` and `# <<< tui-back <<<` defines `alias tb='tui-back'`, `alias tbt='tui-back tui'` and sources the completion file if present. Running install twice leaves exactly one block. The command ends by telling the user to `source ~/.bashrc`.

**Given** `$SHELL` is not bash **Then** a warning says only bash is supported; the npm install still happens.

**Given** `tui-back install --uninstall` **Then** the block, the completion file and the global package are removed; a missing piece is not an error.

**Given** the AD-3 contract **Then** the result is one JSON envelope when piped and human text on a TTY; exit code 0 or 1 only.

**Given** the e2e tests **Then** they use a temp `HOME`/`XDG_DATA_HOME` and a stub `npm` on `PATH` (same technique as the docker stubs), covering idempotence, alias presence, envelope shape and `--uninstall`. The real `~/.bashrc` is never touched.

**Prerequisites:** 10.1, 10.2.

### Story 10.4: Publication, `install.sh` and Docs

As the maintainer, I want the repo published with an install script and a README, so that a colleague can start from a URL.

**Acceptance Criteria:**

**Given** `install.sh` at the repo root **Then** it passes `bash -n`; it checks `git` and Node ≥ 24 (otherwise prints precise instructions, exit 1, modifies nothing), then runs `npx -y github:<owner>/tui-back install`.

**Given** `README.md` **Then** it covers installation, the commands, the `tb`/`tbt` aliases, completion, update (re-run install) and uninstall, and notes the `build-essential` fallback if the `better-sqlite3` prebuild fails.

**Given** `LICENSE` (ISC) and `package.json` `repository` and `files` **Then** `_bmad-output` and `.agents` are excluded from the installed package; if `files` is not honoured for git installs, a `.npmignore` does it.

**Given** the planning artifacts **Then** the AD-14 amendment and AD-24 are in `ARCHITECTURE-SPINE.md`, with the memlog entry.

**Given** a clean machine (container without Node or build tools) **When** `install.sh` then the `npx … install` run **Then** `tb`, `tbt` and `<TAB>` completion work; the result is recorded in the story file.

**Manual steps (Max):** create the public GitHub repo `<owner>/tui-back`, confirm the default branch, and approve the first push. Nothing is pushed without that approval.

**Prerequisites:** 10.1–10.3.
```


**NEW — Story 5.8** (appended to the Epic 5 section; Epic 5's header note gains `Reopened 2026-11-05 (sprint-change-proposal-2026-11-05.md) for Stories 5.8, 5.9 and 5.10.`):

```
### Story 5.8: Hide / Show-Only Log Filters

> Added 2026-11-05 (Sprint Change Proposal). Extends Story 5.2 (filter) and Story 5.4 (history).

As a developer,
I want to hide the log lines (or just the text) that match a pattern, or show only what matches,
So that repeated noise does not bury the lines I care about.

**Acceptance Criteria:**

**Given** the filter editor (global or per-service) **Then** besides the text/regex mode it offers an **action** (`show` or `hide`) and a **target** (`line` or `match`), each switchable from the keyboard with keys taken from the keybinding declarations; the active combination is always visible next to the query. The default is `show` + `line`, which is exactly the Story 5.2 behaviour.

**Given** action `hide` and target `line` **When** a line matches **Then** the whole line is not displayed.

**Given** action `show` and target `line` **Then** only the matching lines are displayed (unchanged).

**Given** action `hide` and target `match` **When** a line matches **Then** the line is displayed with each matched text removed and the rest kept; a line that is empty after removal is not displayed.

**Given** action `show` and target `match` **When** a line matches **Then** only the matched text(s) of that line are displayed; non-matching lines are not displayed.

**Given** a regex that can match an empty string (for example `a*`) **Then** empty matches are ignored, so a filter never hides or shows "nothing" in an endless loop.

**Given** the filter is committed **Then** its action and target are pushed to the history together with the query, in the same scope+mode list; recalling an entry (arrow browse or grid browser) restores query, action and target; two entries are duplicates only if all three are equal; a history entry written before this story reads as `show` + `line`.

**Given** the filter is combined with the service and level filters **Then** they still combine with AND (Story 5.2), and applying or clearing the filter never interrupts the stream or alters the buffered original lines (`Esc` restores them all).

**Given** an invalid regex **Then** it is rejected inline, whatever the action and target.

**Given** a long line, a small terminal or a rewritten line **Then** the Logs zone still respects bounded rendering (AD-19); the editor's added indicator is truncated, not wrapped.

**Given** the unit and render tests **Then** a pure `applyLogFilter` is tested for the four action/target combinations with Max's `[Nest] … WARN [AffectationJoursUseCase] Aucun service de restauration trouvé pour l'utilisateur …` lines as fixtures, history round-trip is tested with legacy and new entries, and the keybinding help lists the new keys.

**Implementation notes:** the rewrite happens when a line is rendered, not when it is stored (AD-11 ring buffer unchanged). `README`/help text mention the two choices. UX-DR32's history recall and EXPERIENCE.md's filter-editor row gain one sentence each.
```

**NEW — Story 5.9** (appended after 5.8 in the Epic 5 section):

```
### Story 5.9: Stackable Log Filter Rules

> Added 2026-11-05 (Sprint Change Proposal). Extends Story 5.8: a scope holds several rules instead of one.

As a developer,
I want to keep several independent hide / show rules active at once and manage them as a list,
So that I can silence each kind of noise separately and keep the rest of the stream readable.

**Acceptance Criteria:**

**Given** the filter editor of a scope (global or per-service) **Then** it shows the list of that scope's rules, each with its query, mode (text/regex), action (`show`/`hide`), target (`line`/`match`) and enabled state; an empty list means no filter.

**Given** the rule list **When** the developer adds, edits, enables/disables, deletes or moves a rule **Then** the stream is not interrupted and the new result applies immediately; editing a rule uses the Story 5.8 editor, including history recall (Story 5.4).

**Given** several enabled rules **Then** they apply as a pipeline from top to bottom: each rule filters or rewrites the output of the previous one; a disabled rule is skipped; moving a rule changes the result accordingly.

**Given** two `show` rules **Then** a line must satisfy both (AND); **Given** a `hide` + `match` rule above a `show` rule **Then** the `show` rule sees the rewritten line.

**Given** an invalid regex in a rule **Then** the rule is rejected inline when committed and never enters the list; a stored rule can therefore never crash the view.

**Given** a scope already holding 10 rules **When** another is added **Then** the add is refused with a visible message; the list is a windowed, cursor-driven list with more-above/below indicators (AD-19), its keys come from the keybinding declarations and appear in the `?` help.

**Given** the service and level filters (Story 5.2) **Then** they still combine with the rule pipeline by AND, and the global and per-service rule lists both apply (global first, then the service's own).

**Given** the app restarts **Then** the rule list is empty again until Story 5.10 (live filter state stays ephemeral, Story 5.2), while the history of committed rules is still available (Story 5.4).

**Given** the unit tests **Then** the pipeline is tested for ordering (hide-match above/below show), AND of two show rules, disabled rules, the 10-rule cap, and the real `[Nest] … AffectationJoursUseCase` lines as fixtures.

**Implementation notes:** `applyLogFilter` (5.8) becomes `applyLogRules(line, rules)` reducing over the list; the single-rule editor of 5.8 is reused as the rule editor. The `Esc` contract (Story 1.13): `Esc` steps out of the rule editor to the list, then closes the editor; clearing all rules is an explicit action, not an accident of `Esc`.

**Prerequisites:** 5.8.
```

**NEW — Story 5.10** (appended after 5.9 in the Epic 5 section):

```
### Story 5.10: Persisted Filter Rules and Named Rule Sets

> Added 2026-11-05 (Sprint Change Proposal). Amends Story 5.2's boundary: filter rules are persisted; the log stream and buffer still never are.

As a developer,
I want my hide / show rules to survive a restart and to save them as named sets,
So that I do not rebuild my noise filters every day and can switch between setups.

**Acceptance Criteria:**

**Given** a scope (global or one service) with rules **When** the app restarts and the Logs tab opens **Then** that scope's rule list is restored as it was, including each rule's enabled state and order.

**Given** the rule list **When** the developer saves it as a set with a name **Then** it appears in the rule-set library; saving under an existing name asks to confirm the overwrite; an empty name is refused.

**Given** the library **When** the developer applies a set to a scope **Then** its rules are copied into that scope's active list; a non-empty list is replaced only after confirmation; later edits to the active list do not change the saved set.

**Given** the library **When** the developer renames or deletes a set **Then** only that set changes; deleting asks to confirm (destructive-action confirmation, UX-DR36); no active list is affected.

**Given** a stored rule whose regex no longer compiles, or a corrupt stored value **Then** the offending rule (or the whole value) is dropped with a visible warning naming the field; the Logs tab still opens.

**Given** a persisted rule list for a service that is no longer registered **Then** it is kept and ignored, so re-registering the service brings the rules back.

**Given** the `:settings` Logs tab **Then** it offers clearing all persisted rules of one scope and deleting the whole library as separate actions, never clearing more than what is targeted.

**Given** the library and rule lists **Then** they are bounded in size (at most 20 sets, 10 rules per set) and rendered with windowed lists (AD-19); keys come from the keybinding declarations and the `?` help.

**Given** the tests **Then** the state adapter is integration-tested against a temp file (round-trip, corrupt value, uncompilable regex), and the library operations (save, overwrite, apply, rename, delete) are tested in core against a fake `StatePort`.

**Implementation notes:** `StatePort` gains read/write for the active rule lists (keyed by scope) and for the library; keep the same tolerant-reader approach as the filter history. EXPERIENCE.md's filter-editor row and UX-DR32 mention persistence and sets. The 5.2 "ephemeral" wording in `epics.md` gets an amendment note.

**Prerequisites:** 5.9.
```

**NEW — Epic 11 list entry:**

```
### Epic 11: MCP Server
> Added 2026-11-05 (Sprint Change Proposal `sprint-change-proposal-2026-11-05.md`). Adds AD-25; extends AD-24.

An AI agent can drive the tool through MCP; anything that changes or destroys state needs the human's explicit approval.
**FRs covered:** FR-48
**Implementation notes:** Order: 11.1 → 11.2 → 11.3 → 11.4. Starts after Story 10.1; 11.4 needs 10.3. Branch: `epic-11-mcp-server`.
```

**NEW — Epic 11 section:**

```
## Epic 11: MCP Server

### Story 11.1: MCP Skeleton and Read-Only Tools

As a developer, I want `tui-back mcp` to expose the read-only commands to an AI agent, so that it can inspect my workspace.

**Acceptance Criteria:**

**Given** `tui-back mcp` **Then** it serves MCP over stdio; nothing but protocol messages is ever written to stdout.

**Given** the MCP tool registry (`adapters/driving/mcp/`) **Then** each tool declares a name, a zod input schema, the subcommand it wraps and a safety class `read | write | destructive`; the server builds the same subcommand registry as `main.ts` in-process, from a shared composition factory.

**Given** the `read` tools (at least `dashboard`, `edts`, `list-repos`, `list-routes`, `request-list`, `ping`, `registry validate`) **Then** each returns the AD-3 envelope as the tool result, with `readOnlyHint: true`.

**Given** the guard test (black-box, completion-guard pattern) **Then** every subcommand in `tui-back --help` is either in the tool registry with a safety class or in an explicit exclusion list with a reason; adding a subcommand without deciding fails the test.

**Given** a tool whose command would prompt on stdin (`registry clean`) **Then** the MCP path never reads stdin; its confirmation comes from Story 11.2's gate.

**Spike:** record which MCP SDK version is used and whether the target client (Claude Code) supports elicitation; the result is written in the story file and decides 11.2's wording.

**Prerequisites:** 10.1.

### Story 11.2: Authorization Gate and Write Tools

As a developer, I want every state-changing tool to ask me before it runs, so that an agent cannot change my workspace on its own.

**Acceptance Criteria:**

**Given** a `write` or `destructive` tool call **Then** the server first asks the human through MCP elicitation, showing the tool, its exact arguments and the repos or EDTs affected; it runs only on an explicit accept.

**Given** a decline, a cancel or a timeout **Then** nothing runs and the result is an AD-3 error envelope with a kebab-case code (`authorization-denied`).

**Given** a client without elicitation support **Then** every `write` and `destructive` tool is refused with `authorization-unavailable` and a message explaining why; read tools keep working (fail closed).

**Given** the `write` tools (at least `register`, `scan`, `edt create`, `edt modify`, `edt switch` without discard, `realign`, `heal`, `request-fire`, `fire-request`, `request save` equivalents) **Then** each is wired through the gate; the gate lives in one place and a tool cannot be registered without a safety class.

**Given** `fire-request` **Then** the dev-auth token never appears in the tool result or in the authorization prompt.

**Given** tests **Then** a fake client covers accept, decline, timeout and no-elicitation for one tool of each class; an unclassified tool is a registration error.

**Prerequisites:** 11.1.

### Story 11.3: Destructive Tools and Long Operations

As a developer, I want the destructive and long-running commands available to the agent, still behind my approval.

**Acceptance Criteria:**

**Given** the `destructive` tools (`edt delete`, `edt switch` with `--discard-dirty`, `reset`, `registry clean`, `request-delete`, `update`) **Then** each carries `destructiveHint: true` and passes through the gate with a prompt that names exactly what will be lost or changed.

**Given** a destructive tool **Then** the approval applies to that single call and those exact arguments; it is never remembered for later calls in the session.

**Given** `registry clean` **Then** the stale entries are listed in the prompt and only the confirmed ones are removed; no stdin prompt is used.

**Given** `update` **Then** it reports progress through MCP progress notifications and honours cancellation (AD-20 bounded run still applies).

**Given** concurrent use with the TUI **Then** the existing locks still serialize conflicting operations; a held lock returns the usual envelope error and is covered by a test.

**Prerequisites:** 11.2.

### Story 11.4: Install Registration and Docs

As a colleague, I want the install to offer the MCP registration, so that I do not have to write the config by hand.

**Acceptance Criteria:**

**Given** `tui-back install` **Then** it prints the exact `claude mcp add tui-back -- tui-back mcp` command (and the JSON config for other clients) and does not edit any client config by itself; `--uninstall` mentions removing it.

**Given** `README.md` **Then** it documents the tool list by safety class, the authorization behaviour, the fail-closed rule for clients without elicitation, and a warning that `fire-request` hits real endpoints.

**Prerequisites:** 10.3, 11.3.
```

### 4.2 PRD (`prds/prd-tui-back-2026-08-10/prd.md`)

**NEW — after FR-45:**

```
#### FR-46: Single installable binary (added 2026-11-05, Sprint Change Proposal)

The package exposes one `tui-back` binary. `tui-back <subcommand>` runs the CLI (AD-3 envelope); `tui-back tui` opens the interactive TUI and exits 1 when no terminal is attached.

#### FR-47: Guided install and uninstall (added 2026-11-05, Sprint Change Proposal)

`npx -y github:<owner>/tui-back install` installs the tool globally, adds the `tb` and `tbt` aliases and bash completion through a marked, idempotent block in `~/.bashrc`, and tells the developer to reload the shell. `--uninstall` reverses every step. A Node version below 24 stops the install with the exact commands to fix it; the installer never changes Node itself. Bash is the only supported shell.
```

**FR-17** gains (amended 2026-11-05): `A filter can also hide what matches instead of keeping it, and can act on the whole line or only on the matched text (FR-49).`

**NEW — after FR-47:**

```
#### FR-49: Hide / show-only log filters (added 2026-11-05, Sprint Change Proposal)

The log filter is a list of rules (one in the first delivery, several afterwards, applied in order). Each rule is a text or regex query with an action (keep only what matches, or hide what matches) and a target (the whole line, or only the matched text); the default rule is today's behaviour. The choices apply to the live view only, never alter the buffered lines, rule lists and named rule sets are kept across restarts (FR-49 extension, Story 5.10), and the choices are recorded with the query in the filter history so recalling a filter restores them.

#### FR-48: MCP server with human authorization (added 2026-11-05, Sprint Change Proposal)

`tui-back mcp` exposes every subcommand to an MCP client as a tool. Read-only tools run freely. Any tool that changes or destroys state runs only after the human explicitly approves that exact call; if the client cannot ask the human, those tools are refused. Approvals are per call and never remembered.
```

**§6.2**: the "Guided onboarding/installation wizard" exclusion gains: `Superseded in part by FR-47 (2026-11-05): a non-interactive installer is in scope; a wizard still is not.`

### 4.3 Architecture (`ARCHITECTURE-SPINE.md`)

**AD-14** — retitle and replace:

OLD:
```
### AD-14 — Packaging is deferred
…
- **Rule:** v1 runs via `tsx`/`node` directly (a `package.json` bin, `npm link` for a local global command) — no compiled binary. A packaging mechanism (Node SEA / `pkg` / `bun --compile`) is chosen only when teammate distribution becomes a real goal, not before.
```
NEW:
```
### AD-14 — Distribution: GitHub + npx, no compiled binary (amended 2026-11-05)

- **Binds:** deployment envelope, FR-46, FR-47, Epic 10
- **Prevents:** a build artifact nobody keeps in sync with daily usage, and a bin map that points at the wrong or a missing file.
- **Rule:** the distribution channel is a public GitHub repo installed with `npx -y github:<owner>/tui-back install`. The tool keeps running on `tsx`/`node` (so `tsx` is a runtime dependency); no compiled binary (Node SEA / `pkg` / `bun --compile` stay rejected until a real need appears). The package exposes one bin, `tui-back`; `tui-back tui` routes to the TUI entrypoint, which bypasses the AD-3 envelope.
```

**Deferred list**: the "Packaging mechanism specifics" bullet becomes `Compiled-binary packaging (Node SEA / pkg / bun --compile) — rejected for now by the AD-14 amendment; revisit only if install friction becomes a real problem.`

**NEW — AD-24:**

```
### AD-24 — The installer is a driving-adapter concern (added 2026-11-05)

- **Binds:** FR-47, Stories 10.2, 10.3
- **Prevents:** distribution logic (spawning `npm`, editing shell rc files) leaking into `core/`, and tests touching a developer's real `~/.bashrc`.
- **Rule:** `install` and `completion` live in `adapters/driving/cli`. They are not Must-scope actions, so FR-1 script/CLI parity does not apply, but they use the AD-3 envelope like any subcommand. Paths come from the XDG helper so tests redirect them; the rc-file block is delimited by fixed markers and is idempotent. The completion generator is a pure function over the subcommand registry, called in-process by `install`.
```

**NEW — AD-25:**

```
### AD-25 — MCP exposure and human authorization (added 2026-11-05)

- **Binds:** FR-48, Epic 11
- **Prevents:** an agent changing or deleting a developer's workspace without a human decision, and a new subcommand becoming reachable over MCP by accident.
- **Rule:** the MCP server is a driving adapter (`adapters/driving/mcp/`) over the same subcommand registry as the CLI, in-process. Each tool declares a safety class (`read | write | destructive`) in one registry; an unclassified subcommand fails a guard test. The server itself enforces authorization: `write` and `destructive` calls go through MCP elicitation, per call, with the exact arguments shown, and are refused (fail closed) when the client cannot elicit. Tool annotations are set for clients but never relied on. Stdout carries protocol messages only. Secrets (dev-auth tokens) never appear in results or prompts.
```

**AD-24** gains: `Extension (2026-11-05): the MCP adapter (AD-25) is also a driving adapter; the installer only prints MCP registration commands and never edits client config.`

Add AD-24 to the capability-to-module table only if an Epic-10 row is wanted; otherwise leave the table unchanged.

**UX (`ux-designs/ux-tui-back-2026-08-10/EXPERIENCE.md`)**: the Logs filter-editor row gains `Action (show/hide) and target (line/match) toggles, shown beside the query and restored by history recall (Story 5.8).` UX-DR32 gains the same sentence.

### 4.4 Project instructions

- **`AGENTS.md` § Commands (line 8)**: replace `node src/bin/cli-back.mjs <subcommand>` with `node src/bin/tui-back.mjs <subcommand>`, and the TUI with `node src/bin/tui-back.mjs tui`.
- **`AGENTS.md` § Testing (line 33)**: `spawns the shipped cli-back.mjs` → `spawns the shipped tui-back.mjs`.
- **`CLAUDE.md`**: the tsx troubleshooting line now reads `node src/bin/tui-back.mjs`, and notes `tsx` is a runtime dependency.

### 4.5 Sprint status (`sprint-status.yaml`)

Set `epic-5: in-progress` (it was `done`) and add under it `5-8-hide-show-only-log-filters: backlog` `5-9-stackable-log-filter-rules: backlog` and `5-10-persisted-filter-rules-and-named-rule-sets: backlog` (5.8 → 5.9 → 5.10); `epic-5` returns to `done` when 5.10 is merged. Append after the Epic 9 block:

```
  epic-10: backlog
  # Distribution (2026-11-05): sprint-change-proposal-2026-11-05.md. Order: 10-1 -> 10-2 -> 10-3 -> 10-4. Epic 9 already merged into devlopment (8ad7b011).
  10-1-repair-the-bin-one-binary-tui-routing: backlog
  10-2-completion-bash-subcommand: backlog
  10-3-install-subcommand: backlog
  10-4-publication-install-sh-and-docs: backlog
  epic-10-retrospective: optional

  epic-11: backlog
  # MCP server (2026-11-05): sprint-change-proposal-2026-11-05.md. Order: 11-1 -> 11-2 -> 11-3 -> 11-4. Starts after 10-1; 11-4 needs 10-3.
  11-1-mcp-skeleton-and-read-only-tools: backlog
  11-2-authorization-gate-and-write-tools: backlog
  11-3-destructive-tools-and-long-operations: backlog
  11-4-install-registration-and-docs: backlog
  epic-11-retrospective: optional
```

## 5. Implementation Handoff

**Scope: Moderate.** Backlog reorganisation (new epic) plus developer implementation.

- **PO / planning (this workflow, after approval):** apply §4.1–4.3 and §4.5 to `epics.md`, the PRD, `ARCHITECTURE-SPINE.md` (plus memlog) and `sprint-status.yaml`; apply §4.4 in Story 10.1.
- **Stories 5.8, 5.9 then 5.10** have no prerequisite besides Epic 9 being merged (shared Logs zone) and each other; it can be built independently of Epics 10 and 11.
- **Developer (`bmad-build`):** one story branch per story off its epic branch (`epic-10-distribution-npx-installer-shell-completion`, `epic-11-mcp-server`), merged with `--no-ff`; each epic branch goes to `devlopment` by pull request only. Run `npm test && npm run typecheck && npm run depcheck` after each story.
- **Max (manual):** create the public GitHub repo, pick the default branch, approve the first push, and run the clean-machine smoke test or authorise a container for it.

**Success criteria**
- `npm i -g` of the package puts a working `tui-back` on `PATH`; `tui-back tui` without a TTY exits 1 with the new message.
- The `bin` e2e checks target existence, not just key names.
- `install` run twice leaves one `~/.bashrc` block; `--uninstall` leaves none; tests never touch the real home.
- The completion guard test fails if a subcommand is added without being completable.
- Story 5.10: rule lists and named sets survive a restart, applying a set copies it, a bad stored regex is dropped with a warning, and nothing else about the log stream is persisted.
- Story 5.9: several rules combine as an ordered pipeline, can be edited, toggled, moved and deleted live, are capped at 10 per scope, and the list is empty after a restart (until 5.10).
- Story 5.8: `hide`/`show` × `line`/`match` behave as specified on the real-log fixtures, history recall restores all three fields, legacy history still loads, and clearing the filter restores every original line.
- Epic 11: no `write` or `destructive` tool ever runs without an explicit per-call human accept; a client without elicitation gets `authorization-unavailable`; the tool-registry guard test fails on an unclassified subcommand; no token appears in any tool result.
- On a clean machine, `install.sh` → `npx … install` → `tb`, `tbt` and `<TAB>` work.
