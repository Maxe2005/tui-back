# Epic 2 Context: EDT Workspace Management

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A developer can create, modify, switch between and delete EDTs. An EDT is an isolated coding-session workspace over a hand-picked set of managed repos. Uncommitted work is never lost without explicit, per-file consent. Every managed repo shows its branch and divergence, and repos outside the active EDT always return to their own shared branch. The epic also absorbed cross-cutting TUI infrastructure: the command bar, settings screen, resizable multi-pane layout, structured failure display and text-input primitives. Most stories are done. The remaining work is the end of three batches plus two older stories:
- **Creation wizard (2.35–2.38):** a 4-step wizard with per-service branch plans and an explicit activation step. 2.38 is in review.
- **Switch redesign (2.39–2.41):** a three-state switch where dirty work outside the outgoing EDT is explicitly adopted or discarded. 2.41 is in review and the CLI story 2.40 is in the backlog.
- **Branch protection (2.42–2.43):** protected branches defined in each service's manifest, and branches owned by another EDT flagged and gated. Both are in the backlog.
- **Older backlog:** 2.28 (registry semantic validation) and 2.31 (`edt-create-from`).

## Stories

- Story 2.1: Create an EDT
- Story 2.2: Create dev branches at EDT creation
- Story 2.3: Git branch-scope safety gate & shared-branch rejection
- Story 2.4: Switch the active EDT without data loss
- Story 2.5: Modify an EDT after creation
- Story 2.6: Branch and divergence visibility
- Story 2.7: Canonical navigation contract (arrows/Home/End/Tab)
- Story 2.8: Fullscreen TUI rendering
- Story 2.9: EDTs zone — create, switch, and modify
- Story 2.10: Recover from an already-running TUI instance
- Story 2.11: Repo registry screen & manifest onboarding guidance
- Story 2.12: Zone arrow navigation
- Story 2.13: Manifest-gated zone tab visibility & disabled state
- Story 2.14: Command entry bar (`:`) & registered commands
- Story 2.15: EDT commands in command bar & action history in detail pane
- Story 2.16: Permanent Dashboard banner
- Story 2.17: Terminal-style command bar autocomplete & grid browser
- Story 2.18: EDT zone — active highlight, fixed detail pane, categorized services & per-service actions
- Story 2.19: Global settings screen (`:settings`)
- Story 2.20: Top bar & footer hint accuracy fixes
- Story 2.21: EDT zone — multi-splitter layout with keyboard resize-mode
- Story 2.22: EDT creation — mandatory branch creation UI
- Story 2.23: Visible text-input cursor
- Story 2.24: Modify EDT — mandatory branch on add
- Story 2.25: Structured per-repo failure display & branch-collision state
- Story 2.26: Branch-picker — 3 explicit modes
- Story 2.27: EDT creation — branch-picker reuse & manifest-aware base default
- Story 2.28: Registry — manifest semantic validation
- Story 2.29: Delete an EDT
- Story 2.30: EDT quick-pick for edt-switch / edt-modify
- Story 2.31: `edt-create-from` — clone an EDT's membership into the wizard
- Story 2.32: TextInputLine — cursor navigation & app-wide adoption
- Story 2.33: Registry — deregister stale, unreachable, or unmanaged repos
- Story 2.34: EDT zone — colored, explained service-listing issues
- Story 2.35: EDT creation core — per-service branch plans & remote branches
- Story 2.36: Creation wizard — shell, step navigation, name & services steps
- Story 2.37: Creation wizard — Step 3: global branch strategy & per-service overrides
- Story 2.38: Creation wizard — Step 4: activation & switch choice
- Story 2.39: EDT switch core — three-state partition & dirty-service resolutions
- Story 2.40: `edt switch` CLI — fail-safe dirty handling & explicit flags
- Story 2.41: EDT switch resolution dialog
- Story 2.42: Manifest-defined protected branches per service
- Story 2.43: Cross-EDT branch usage — alerts in branch choosers & rename gate

## Requirements & Constraints

- **Data-loss rule:**
  - Uncommitted work is always preserved automatically.
  - There are exactly two consent-gated exceptions: the first-EDT overwrite at activation and a per-service discard during a switch.
- **Create:**
  - The topic must be unique (trimmed, case-sensitive) and there must be at least one member. Both are checked before anything is written.
  - On the TUI path, every member gets a branch. By default each one comes from the service's manifest `sharedBranch` and is named with the topic slug, and any service can override that.
  - The CLI `edt create` keeps one base and one naming mode for the whole action, unchanged.
  - A failure on one service never aborts the others.
  - The action-log entry always goes to the **new** EDT's database.
- **Activation:**
  - Activation is always explicit, and the store never sets the active pointer on create.
  - **First EDT:** a pre-flight that checks nothing out lists the files at risk per repo. The developer can then:
    - Retry, as many times as needed;
    - Overwrite, after a second confirmation;
    - or stop, which leaves the EDT created but inactive.
  - **Later EDTs:** "switch now" (the default) goes through the protected switch. The alternative is "create without switching".
  - A create with a partial failure never activates.
- **Switch:**
  - Each repo is classified against the **outgoing** EDT:
    - **State 1**, a member of the outgoing EDT: its dirty work is auto-stashed and tagged with the outgoing ulid.
    - **State 2**, a member of another EDT only.
    - **State 3**, a member of no EDT.
  - A dirty state-2/3 repo needs an `adopt` or `discard` resolution. Otherwise the result is `switch-dirty-services-unresolved` and nothing is written.
  - `adopt` is not allowed when there is no outgoing EDT (`switch-adopt-without-outgoing`).
  - `discard` keeps ignored files and records the discarded paths.
  - Non-member repos go to their `sharedBranch`, which is fetched first if it is missing locally.
- **CLI switch (2.40):**
  - The default is fail-safe.
  - `--discard-dirty` discards the dirty work in every state-2/3 repo.
  - `--adopt-dirty --adopt-branch <name>`:
    - Repos on a shared branch get the new branch `<name>`. Other repos keep their current branch.
    - If any repo is on a shared branch and no name is given, the command fails with `missing-argument`.
  - Passing both flags fails with `invalid-argument`.
  - Help text, docs and e2e tests must be updated.
- **Protected branches (2.42):**
  - A service's protected set is exactly its manifest `protectedBranches` plus its `sharedBranch` (which defaults to `development`). Nothing is protected implicitly.
  - A rejection names the branch and the manifest that protects it.
  - The `manifest-generator` skill emits `protectedBranches: [development, preprod, prod]` by default.
- **Cross-EDT ownership (2.43):**
  - A branch registered as another EDT's own branch can be neither attached nor renamed, as either the old or the new name.
  - Using such a branch only as a *base* is allowed, but it is still annotated.
- **Modify / Delete:**
  - Members, branches and topic can be edited without disturbing other members. A zero-member EDT is valid, and adding a member requires an explicit branch.
  - Delete is blocked while the EDT is active. Each member's branch gets its own leave/delete choice, informed by merge status and dirty state. A branch that another EDT uses blocks deletion for that service.
- **Visibility:** every managed service shows its branch with ahead/behind counts. Without an upstream it shows "no upstream", and offline it shows "unknown (offline)".
- **Registry validation (2.28):**
  - Adds a "Validate registered repos" action on the registry screen and `tui-back registry validate` for CLI parity.
  - Checks are an extensible registry. The only check for now is that `sharedBranch` exists, locally or fetchable.
  - A manifest that fails to load is reported with its existing load error.
- **Isolation:** a crash in one EDT's SQLite file never affects another EDT. Remote branches come only from local remote-tracking refs, and the wizard never fetches.

## Technical Decisions

- **Storage:**
  - One SQLite file per EDT at `XDG_DATA_HOME/tui-back/edts/<ulid>.db`.
  - The active pointer and per-zone pane ratios live in `XDG_STATE_HOME/tui-back/state.json`. `fs.watch` lets CLI changes reach an open TUI.
  - Settings live in `XDG_CONFIG_HOME/tui-back/settings.yaml`, behind a zod-validated `SettingsPort`.
- **Git gate:**
  - Every git write goes through `adapters/driven/git`. The gate resolves the allowed branch from EDT and manifest state at write time and never trusts the caller.
  - With 2.42, one core helper, `isProtectedBranch(name, manifest)`, replaces `SHARED_BRANCHES`/`isSharedBranch`. No hardcoded branch list may remain in `src/`.
  - The manifest schema gains an optional `protectedBranches: string[]` (trimmed, non-empty).
  - `ServiceBranchDivergence` carries `protectedBranches`.
  - Hardcoded test fixtures become manifest fixtures.
- **`GitPort`:**
  - `listBranches` covers local branches only.
  - `listRemoteBranches` returns `origin/*` without `origin/HEAD` and never fetches.
  - `createTrackingBranch` is gated.
  - `renameBranch(…, edtId?)`:
    - With 2.43 it also gates both names against cross-EDT ownership (`branch-owned-by-other-edt`). Without an `edtId`, any owner blocks the rename.
    - Callers pass their EDT's ulid: modify, Add-to-EDT, create, and create's rollback.
  - `diffNameOnly(from, to)` is read-only and not gated.
  - `discardPaths` (exact paths) is used by activation.
  - `discardAll` runs `reset --hard` then `clean -fd`, never `-x`. Its only caller is `switch.ts` under `discard`.
- **`createEdt`:**
  - Takes optional `memberPlans` (`{kind:'create', base, name}` | `{kind:'existing', branch, renameTo?}`).
  - When the plans are present they are authoritative, and a missing member gives `invalid-argument`. Otherwise the older `branchOptions` path runs unchanged.
  - Rollback deletes created branches, renames renamed ones back, and logs any rollback failure without throwing.
- **`core/edt/activate.ts` (2.38):**
  - Reuses the switch's per-repo target computation without stash tagging.
  - Discards only the confirmed `overwrite` paths: uncommitted paths that also differ between the current and target branch.
- **`switch.ts`:**
  - Classification is done by a pure `classifySwitchRepos` helper.
  - Resolutions come as `dirtyResolutions: Record<repoPath, {kind:'adopt', branch} | {kind:'discard'}>`.
  - The CLI passes `dirtyPolicy` sugar, which is expanded *after* the core classifies the repos; the CLI never classifies.
  - The seam `onDirtyReposBeforeSwitch` returns `cancel | proceed(resolutions)`.
  - `adopt` runs gate → stash → create branch → add to the outgoing EDT → checkout, and restores the stash if any step fails.
- **Cross-EDT ownership:**
  - A pure `branchOwners(edts, repoPath, branch, excludeUlid)` helper works from the store's loaded EDT list, with paths compared via `resolve()`. No new port.
  - `BranchAutocompleteInput` gains a generic `annotations?: Record<branch, string>` prop and stays EDT-agnostic.
- **Shared components (reuse, never copy):**
  - `TextInputLine` and `nextTextInputValue`;
  - `BranchPicker` (pick / create / rename);
  - `BranchAutocompleteInput`;
  - `FailedResultList`, with its `resolveAssistedAction(code)` registry;
  - `BoundedList`;
  - the shared filterable pick list behind the EDT quick-pick.
- **Wizard:**
  - Lives in `dialogs/create-wizard/` with one file per step and a pure `wizard.logic.ts`.
  - Step 3's table and override box are reused by the switch dialog, whose own pure logic is in `switch-resolution.logic.ts`.
  - 2.31 adds `seedFromEdt` to the wizard's initial state.

## UX & Interaction Patterns

- All wizard and dialog labels are in **French**.
- **Wizard breadcrumb:** `[1. Nom] ── [2. Services] ── [3. Branches] ── [4. Activation]`. Keys:
  - `Ctrl+→`/`Ctrl+N` go to the next step, only if the current step is valid.
  - `Ctrl+←`/`Ctrl+P` go back and keep the step's choices.
  - `Tab` moves within a step.
  - `Esc` closes the innermost field first, then cancels with nothing written.
  - These wizard-scoped keys belong in the keybinding contract.
- **Step 3:**
  - Panel A, "STRATÉGIE GLOBALE": the base shows a dim `<shared-branch>` placeholder, and the name follows the topic slug until it is edited.
  - Panel B: a height-bounded table `Service | Mode | Base / Source | Branche cible`.
    - Modes: `[Créer (Global)]`, `[Créer (Perso)]`, `[Existante]`, `[Renommer]`.
    - `✖ branche introuvable` blocks `Ctrl+N`.
    - `Enter` opens the "Configurer" box, and `Ctrl+R` reverts the row to the global strategy.
- **Step 4:**
  - First EDT: locked on "Oui". The pause panel offers `R` (retry), `E` (open the overwrite confirmation, which lists every file; `Ctrl+E` confirms) and `Esc`.
  - Later EDTs: a radio choice, with the shared branch each non-member returns to listed by name.
- **Switch resolution dialog:** it mirrors Step 3.
  - Panel A: "Adopter dans <outgoing> / Écraser", plus a global branch name for repos on a shared branch.
  - Panel B: `Service | Portée | Branche actuelle | Action | Branche cible`. State-1 rows are shown dim and read-only.
  - Any `[Écraser]` row requires a second confirmation that lists every file. Its default is *Retour*.
  - `Esc` cancels the switch.
- **Owned-branch annotation (2.43):**
  - A branch owned by another EDT shows `⚠ EDT « <topic> »` (glyph + warning color, never color alone) in the Step 3 box and in `BranchPicker` pick-existing/rename.
  - Choosing it is refused inline with "utilisée par l'EDT « <topic> » — la reprendre ou la renommer casserait cet EDT". An affected Step 3 row blocks `Ctrl+N`.
- **Command bar:**
  - `edt-create`, `edt-switch`, `edt-modify`, `edt-delete` and `edt-create-from` are registered commands.
  - Without an argument, switch, modify and create-from open the quick-pick. `edt-create-from <topic>` skips it, and an unknown topic gives "EDT not found".
- **2.31 seeding:** Step 2 is pre-checked with the root EDT's members and stays editable. Inherited members' rows start as `[Créer (Perso)]`, with the member's root-EDT branch as base. The topic is always typed fresh.

## Cross-Story Dependencies

- **Git gate (2.3):** underlies every branch-writing story, including Epic 3's group update. 2.42 changes its protected-set rule and 2.43 extends its rename check.
- **Ordering:**
  - 2.42 and 2.43 each require 2.37, whose `src/core/edt/shared-branches.ts` must be merged first; otherwise HALT. They are independent of each other.
  - Every inline protected-branch check, including 2.41's, must call the core helper so that it picks up 2.42's rule.
  - 2.40 builds on 2.39's core and only wires the CLI.
  - 2.38 builds on 2.39 and 2.41.
  - 2.31 builds on 2.30 and 2.37.
- **Epic 5:**
  - Story 5.6 adds `↑`/`↓` history recall to the `:` command bar through a shared input-history primitive. Whichever of 5.6 and the `TextInputLine` adoption lands second puts the cursor at the end of the value on recall.
  - Story 5.5's `BoundedList` bounds the EDTs zone's service lists.
  - Per-service Restart stays disabled until Epic 5.
- **Rollout:** the epic-2 → `devlopment` PR also carries the Epic 3 and Epic 5 work already merged into this branch. Existing `.tui-back.yaml` files need `protectedBranches` added by hand to keep today's protection.
