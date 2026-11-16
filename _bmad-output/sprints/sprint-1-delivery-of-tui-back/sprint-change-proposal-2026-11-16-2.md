# Sprint Change Proposal — 2026-11-16 (2): Manifest-declared generated files — update merge conflicts on `index.ts` barrels are settled by regenerating them (`npm run barrels`), in the TUI and in the CLI/MCP

Mode: Batch. Scope: **Moderate** (Epic 4 reopened for two stories; one new FR, one new AD, one amended AD; one optional key added to the manifest schema; one new dependency for glob matching; no rollback, no change to existing manifests).

## 1. Issue Summary

During an update involving the `shared-types` repo (the source of the package), merge conflicts regularly land on the generated barrel files (`index.ts`). They are not real conflicts: the files are rebuilt by `npm run barrels`, which regenerates them from the sources. Today each one stops the run and goes to the assisted-resolution menu (Story 3.4), although the right answer is mechanical.

Max asked for the rule ("leave the conflict on `index.ts`, run `npm run barrels`, it regenerates them") and, in the same breath, how such stack- or service-specific rules are meant to live in a tool that may one day manage a non-npm (e.g. Java) architecture. Findings, verified against the code:

| # | Finding | Evidence |
|---|---------|----------|
| 1 | Conflict auto-resolution has a generic seam, but only one implementation, and it is `shared-types` + npm specific. | `AutoResolveConflict` (`core/scripts/group-update.ts:217`) is a generic `({service, repoPath}) → {touched, issue?}`. Its only implementation is `autoResolveSharedTypesConflict` (`core/shared-types/resolve-conflict.ts`), hard-wired to `package.json`, `package-lock.json` and `npm i`, built in `update-slice.ts:830` from the `shared-types-consumer` module. |
| 2 | The seam accepts exactly one resolver. | `groupUpdate` takes a single `autoResolveConflict`; `buildAutoResolveConflict` returns `null` when the consumer module is not wired, so a repo with no consumer config gets no auto-resolution at all. |
| 3 | Rules specific to a repo live in the manifest (`.tui-back.yaml`) or in a compiled-in module, never in core. | AD-4 (manifest keys such as `restartCommands`, `migrationCommand`), AD-5 (static module registry), AD-18 (core never names `shared-types`). |
| 4 | The CLI and MCP never auto-resolve. | `adapters/driving/cli/commands/update.ts` calls `groupUpdate` without `autoResolveConflict` (three call sites); only the TUI's `update-slice.ts:1005` passes it. MCP exposes the CLI subcommands, so it inherits the gap. FR-31 itself therefore does not run outside the TUI, against FR-1 (script parity). |
| 5 | No glob matcher is a dependency today. | `package.json` has no `picomatch` / `minimatch` / `micromatch` / `glob`. |

## 2. Impact Analysis

**Epics**: **Epic 4** (`done`) reopened (`in-progress`) for Stories **4.8** and **4.9**. Epic 3 (the update engine and Story 3.4's assisted flow) is untouched: the new resolver plugs into the existing seam.

**PRD**
- **FR-52 added**: manifest-declared generated files regenerated on update conflict.
- **FR-31** clarified: it applies to the CLI and MCP updates as well (Story 4.9).
- No change to FR-30 or FR-13–FR-15.

**Architecture**
- **AD-4 amended**: the manifest gains an optional `generatedFiles` key.
- **New AD-26**: generated-file conflict resolution is declared per repo in the manifest; core owns the algorithm and never names a stack or a file type; resolvers compose through one seam. This is the answer to the portability question: a Java/Gradle repo declares its own generated files and its own command, with no code change (AD-5 still reserves *module implementations*, such as a Maven `shared-types`, for compiled-in code).
- AD-18 unchanged (the `shared-types` consumer resolver stays as the specialised handler of `package.json`).

**Manifest and docs** (CLAUDE.md memory rule: manifest changes need docs + skill): `docs/tui-back-manifest.md` (new `generatedFiles` section, error table, example for the `shared-types` source repo) **and** the `manifest-generator` skill (detects a `barrels`-like script or generated-file tooling and offers the entry) are updated in Story 4.8.

**Code (indicative)**
- `core/ports/manifest.ts`, `adapters/driven/manifest/schema.ts`: optional `generatedFiles: { glob: string; command: string }[]` (strict objects, non-blank strings, relative POSIX globs, no `..` and no absolute path).
- New `core/scripts/auto-resolve-generated.ts` (the algorithm, pure over `GitPort` + a command-runner port) and `core/scripts/compose-auto-resolvers.ts`.
- Command execution: a neutral command-runner port shaped like `RestartPort` / `MigrationPort` (repoPath + one command in, `{output}` or failure out). Reusing `RestartPort.run` as-is is acceptable if the spec records the rename-free choice; a thin `CommandPort` that `RestartPort` extends is preferred.
- `adapters/driving/tui/store/slices/update-slice.ts` (`buildAutoResolveConflict`): composes the `shared-types` resolver (when wired) and the generated-files resolver (when the repo's manifest declares it).
- `adapters/driving/cli/commands/update.ts` (+ the MCP tool inherited from it): same composition (Story 4.9).
- Dependency: one small glob matcher (`picomatch` suggested), pinned to an exact version like the rest of the stack; recorded in the stack list.
- The `shared-types` repo's own `.tui-back.yaml` (outside this repo) gets the entry — see §4.4.

## 3. Recommended Approach

**Direct Adjustment.** Option B chosen by Max (generic manifest key rather than a `shared-types-source` module parameter). Effort: Medium (core algorithm + manifest + composition are small; docs, skill and CLI/MCP parity add breadth). Risk: low to medium. The risks are deliberate and handled in the ACs:

1. Running a repo-declared shell command during a merge executes arbitrary text from the manifest. This is the same trust model as `migrationCommand` and `restartCommands` (AD-4: the manifest is the repo's own file, run in that repo's directory); no new trust boundary, but it is stated in the docs and the command always runs in the declared repo only.
2. A generator run while real source conflicts remain could read conflict-marked source files. Mitigation: the command runs only once every other conflicted path is settled (the resolver is idempotent and re-run after the developer's edits, like FR-31's).
3. A command may change files beyond the declared globs. Only files matching a declared glob are staged; anything else the command touched is left alone and reported.

Order: 4.8 first (it can ship TUI-only); 4.9 after 4.8 (it wires both resolvers into the CLI).

## 4. Detailed Change Proposals

### 4.1 New Story 4.8 — Manifest-Declared Generated Files, Regenerated on Update Conflict

> Added 2026-11-16 (Sprint Change Proposal 2). Adds FR-52; amends AD-4; adds AD-26. Builds on Stories 3.4 (assisted resolution), 4.5 (the resolver seam) and 3.8 (`restartCommands`).

As a developer, I want conflicts on files that a command regenerates to be settled by running that command, so that a barrel (`index.ts`) conflict never interrupts an update.

**Acceptance Criteria:**

- **Given** a manifest declaring `generatedFiles: [{ glob: "**/index.ts", command: "npm run barrels" }]` **When** it is loaded **Then** it validates; an entry with a blank `glob` or `command`, an absolute or `..` glob, or an unknown key fails validation with a precise message (`manifest-validation-failed`); an absent key means no generated files and changes nothing for existing manifests.
- **Given** a merge or pull conflict in a repo declaring `generatedFiles` **When** the conflicted paths all match a declared glob **Then** the declared command runs once in the repo directory, no conflict marker remains in the matched files afterwards, the matched files that differ are staged (`GitPort.stagePaths`, AD-8), and the merge completes through the existing flow; the row's conflict outcome is `auto-resolved`.
- **Given** conflicted paths that match no declared glob **When** the resolver runs **Then** it does not touch them: they stay conflicted and the existing assisted-resolution flow (Story 3.4) presents them; the generated files are regenerated **only once every other conflicted path is settled** (the resolver is idempotent and is re-run after the developer's edits and before each menu presentation); until then the row's outcome is `partial`.
- **Given** the declared command fails (non-zero exit, unspawnable shell, or a conflict marker still present in a matched file) **When** it ran **Then** nothing is staged, the conflict stays open, and the run tracking shows the issue (command, exit status, first lines of output); the developer can fix and retry through the same menu.
- **Given** the command modified files that match no declared glob **When** it finished **Then** those files are neither staged nor reverted, and the issue line lists them.
- **Given** two declared entries with the same `command` **When** both match **Then** the command runs once.
- **Given** a repo that also has the `shared-types-consumer` module **When** its merge conflicts on `package.json` and on `index.ts` **Then** both resolvers run through one composed seam (each settles only its own files); the outcome is `auto-resolved` only if together they settled every conflicted path, otherwise `partial`.
- **Given** the docs **When** updated **Then** `docs/tui-back-manifest.md` documents `generatedFiles` (semantics, glob rules, ordering, failure behaviour, the trust note, an example for the `shared-types` source repo, the error row) **and** the `manifest-generator` skill detects likely candidates (a `barrels`/`generate`-style script, generated-file headers) and offers the entry.

**Implementation notes:** `core/scripts/auto-resolve-generated.ts` returns the existing `AutoResolveResult`; `compose-auto-resolvers.ts` folds N resolvers into one `AutoResolveConflict` (results merged: `touched` OR-ed, issues joined) so `groupUpdate`'s signature is unchanged. No git write beyond `stagePaths` (the generator overwrites the conflicted files itself). Tests: pure resolver with a fake git and command port (all-generated, mixed, command failure, marker left, extra files touched, duplicate commands, idempotent rerun); schema tests; composition tests; manifest docs and skill updated in the same commits as the schema (one commit each: schema → resolver → composition + TUI wiring → docs + skill).

### 4.2 New Story 4.9 — Update Conflict Auto-Resolution in the CLI and MCP

> Added 2026-11-16 (Sprint Change Proposal 2). Closes the FR-31 parity gap found in §1 (finding 4).

As a developer or an agent running `tui-back update`, I want the same automatic conflict resolution the TUI has, so that a script or an MCP session does not stop on a conflict the tool can settle.

**Acceptance Criteria:**

- **Given** the CLI `tui-back update …` (main, all-repos, single-service) **When** a service's merge conflicts **Then** the composed auto-resolvers of Story 4.8 (the `shared-types` consumer resolver when its module is declared, the generated-files resolver when `generatedFiles` is declared) run exactly as in the TUI.
- **Given** the resolvers settle every conflicted path **When** the run continues **Then** the service completes (migrate → restart) and the envelope row carries `conflict: "auto-resolved"`.
- **Given** a conflict the resolvers cannot fully settle **When** run non-interactively **Then** behaviour is exactly today's for the CLI (the service is skipped or paused as it is now, repo left mid-merge with the issue named); the envelope row carries `conflict: "partial"` or `"left-to-user"` and the resolver's `issue` text.
- **Given** the MCP `update` tool **When** invoked **Then** it behaves as the CLI (same use-case and wiring); no new tool and no change to the authorization policy (AD-25: it was already a write tool).
- **Given** the existing TUI behaviour **When** this story lands **Then** it is unchanged (one shared builder of the composed resolver replaces the TUI-local one; no duplicated wiring).

**Implementation notes:** extract `buildAutoResolveConflict` from `update-slice.ts` into a driving-neutral factory (`core` use-case wiring helper or a shared function in `adapters/driving`), used by both the slice and `commands/update.ts`; the envelope's conflict field already exists in `GroupUpdateRunDetail` (`group-update.ts:83-86`). Tests: CLI e2e with a conflicting fixture repo for each resolver and for a mixed conflict.

### 4.3 PRD, architecture, epics and status

- **PRD**: add FR-52 under §4.4 after FR-31:

  > **FR-52: Manifest-declared generated files regenerated on update conflict (added 2026-11-16, Sprint Change Proposal 2).** A service's manifest may declare generated files (a glob) and the command that rebuilds them (`generatedFiles`). When an update's merge conflicts, and once every other conflict is settled, the tool re-runs the command in place of hand-resolution, verifies no conflict marker remains, stages the regenerated files and completes the merge; otherwise the conflict is left to the developer with the command's error. Applies to the TUI, the CLI and MCP updates. FR-31's `shared-types` auto-resolution also applies to the CLI and MCP (Story 4.9).

  Epics.md requirements list and coverage map: `FR-52: Epic 4 - Generated-file conflict resolution (added 2026-11-16 — Stories 4.8, 4.9)`; Epic 4's **FRs covered** gains FR-52; FR-31's coverage line gains "(also CLI/MCP — Story 4.9)".
- **Architecture**: amend **AD-4** (list `generatedFiles` among the optional manifest keys, with its semantics); add **AD-26 — Generated-file conflict resolution is manifest-declared** (Binds FR-52, FR-31; Prevents: stack- or service-specific merge rules entering core or a compiled-in module when a manifest line can carry them; Rule: core runs the declared command on a conflict whose paths match the declared globs, composes resolvers behind the single `AutoResolveConflict` seam, stages only matching files, and never names a language, a tool or `shared-types`; a stack-specific *understanding* of a file, such as a lockfile or a dependency line, stays in a compiled-in module (AD-5, AD-18) behind the same seam).
- **sprint-status.yaml** (sprint-1): `epic-4: done → in-progress`; add `4-8-manifest-declared-generated-files-regenerated-on-update-conflict: backlog` and `4-9-update-conflict-auto-resolution-in-the-cli-and-mcp: backlog`.

### 4.4 Entry to add to the `shared-types` repo's own manifest (done by Max, outside this repo)

```yaml
generatedFiles:
  - glob: "**/index.ts"
    command: "npm run barrels"
```

## 5. Implementation Handoff

**Scope: Moderate.** Product Owner / Developer: apply the §4.3 edits to `epics.md`, the PRD, the architecture spine and `sprint-status.yaml`; then Developer agent per story with `bmad-build`.

Branches (CLAUDE.md): `story-4-8-…` and `story-4-9-…` off `epic-4-shared-types-propagation` (already merged, reopened); merge each into the epic branch with `--no-ff`; the epic branch returns to `devlopment` by pull request (or `/worktree-merge`).

Success criteria: an update whose only conflicts are `index.ts` barrels completes without a menu in the TUI, the CLI and MCP; a mixed conflict leaves only the real conflicts to the developer; a manifest without `generatedFiles` behaves exactly as before; the manifest doc and the `manifest-generator` skill describe the new key.

Deferred (not in this proposal): a Java/Gradle `shared-types` module (a compiled-in module, AD-5) — only needed if the package-version concept itself must be managed in `pom.xml` / `build.gradle`; `generatedFiles` alone already covers any generated file of any stack.
