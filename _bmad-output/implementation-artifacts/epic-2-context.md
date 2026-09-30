# Epic 2 Context: EDT Workspace Management

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A developer can create, modify, safely switch between and delete EDTs. An EDT is an isolated coding-session workspace spanning a manually chosen set of managed repos. None of this may ever lose uncommitted work unless the developer explicitly consents, file by file. Every managed repo shows its branch and divergence. Non-member repos always return to their own shared branch. The epic's branch also absorbed cross-cutting TUI infrastructure: the command bar, settings screen, resizable multi-pane layout, structured failure display and text-input primitives. Its remaining batches are:
- **Creation wizard (2.35–2.38):** a 4-step wizard (Name → Services → Branches → Activation) with per-service branch plans, remote branches and an explicit activation choice.
- **Switch redesign (2.39–2.41):** an authoritative three-state switch in which dirty work outside the outgoing EDT is explicitly adopted or discarded.
- **Branch protection (2.42–2.43):** each service's manifest defines its protected branches, and branches owned by another EDT are flagged in every chooser and can be neither attached nor renamed.

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
- Story 2.23: Visible text-input cursor (EDT zone text fields)
- Story 2.24: Modify EDT — mandatory branch on add, no silent default
- Story 2.25: EDT zone — structured per-repo failure display & branch-collision state
- Story 2.26: Branch-picker — 3 explicit modes (pick existing / create new / rename current)
- Story 2.27: EDT creation — branch-picker reuse & manifest-aware base-branch default
- Story 2.28: Registry — manifest semantic validation
- Story 2.29: Delete an EDT
- Story 2.30: EDT quick-pick — filterable list for edt-switch / edt-modify
- Story 2.31: edt-create-from — clone an EDT's membership as a creation starting point (re-targeted to the wizard)
- Story 2.32: TextInputLine — cursor navigation & app-wide adoption
- Story 2.33: Registry — deregister stale, unreachable, or unmanaged repos
- Story 2.34: EDT zone — colored, explained service-listing issues
- Story 2.35: EDT creation core — per-service branch plans & remote branches
- Story 2.36: EDT creation wizard — shell, step navigation, name & services steps
- Story 2.37: EDT creation wizard — Step 3: global branch strategy & per-service overrides
- Story 2.38: EDT creation wizard — Step 4: activation & switch choice
- Story 2.39: EDT switch core — three-state partition & dirty-service resolutions
- Story 2.40: `edt switch` CLI — fail-safe dirty handling & explicit flags
- Story 2.41: EDT switch resolution dialog — global strategy, per-service overrides & discard confirmation
- Story 2.42: Manifest-defined protected branches per service
- Story 2.43: Cross-EDT branch usage — alerts in branch choosers & rename gate

## Requirements & Constraints

- **Create:**
  - An EDT needs a unique topic and at least one member service. A duplicate topic or zero members is rejected before any file is written. The wizard checks the name live on every keystroke (trimmed, case-sensitive).
  - Every member always gets a branch on the TUI path. A global strategy applies by default: the base is each repo's manifest `sharedBranch` unless one is typed, and the name is the topic slug.
  - Any service can override the global strategy by creating from its own base, or by attaching an existing local or remote branch (optionally renamed).
  - The CLI `edt create` keeps its original shape: one base and one naming mode for the whole action. Its behavior and tests stay unchanged.
  - A failure on one service never aborts the others.
- **Protected branches:**
  - A service's protected set is exactly its manifest `protectedBranches` plus its `sharedBranch`. `sharedBranch` is always protected and defaults to `development`. Without `protectedBranches`, only `sharedBranch` is protected. `development`, preprod and prod are no longer protected implicitly.
  - A protected branch can never become an EDT's own branch. Renaming onto or away from a protected name is refused.
  - The tool rejects these before any git write, with a message naming the branch and the manifest that protects it.
  - The `manifest-generator` skill must emit `protectedBranches: [development, preprod, prod]` by default. Existing manifests need that line added by hand to keep today's protection.
- **Cross-EDT ownership:**
  - A branch registered as another EDT's own branch for a service can be neither attached nor renamed, whether as the old or the new name. Otherwise that EDT would break silently.
  - Using an owned branch only as a *base* is allowed, since creating from it never modifies it; it is still annotated.
- **Switch:**
  - Repos are classified against the **outgoing** EDT:
    - **State 1**, a member of the outgoing EDT: a dirty repo is auto-stashed with the outgoing ulid and popped when the developer switches back.
    - **State 2**, a member of another EDT only.
    - **State 3**, a member of no EDT.
  - A dirty state-2/3 repo needs an explicit resolution. With none, the switch returns `switch-dirty-services-unresolved` and writes nothing.
    - `adopt` moves the work onto a branch registered in the outgoing EDT, never a protected one. It is rejected when there is no outgoing EDT.
    - `discard` runs a consent-gated `reset --hard` + `clean -fd`, keeps ignored files, and records the discarded paths.
  - The old fixed `tui-back:shared` stash round-trip is removed.
  - The CLI fails safe by default and accepts `--adopt-dirty --adopt-branch <name>` or `--discard-dirty` (the two are mutually exclusive).
  - Non-member repos go back to their shared branch, which is fetched first if it is missing locally.
  - The switch is blocked while a locked action runs on the outgoing EDT, with an offer to stop the action and resume it later.
- **Activation after creation** is always explicit. The store never writes the active pointer on create.
  - **First EDT:** a pre-flight checks out nothing and lists, per repo, the uncommitted files a checkout would overwrite. The developer can Retry (repeatable), Overwrite (needs a second confirmation naming every file) or press Esc (the EDT stays created but inactive).
  - **Later EDTs:** "switch now" (the default, through the protected switch) or "create without switching".
- **Data-loss rule:** uncommitted work is always auto-preserved. There are exactly two consent-gated exceptions: first-EDT overwrite and a per-service switch discard.
- The create action-log entry always goes to the **new** EDT's database.
- Members, branches and topic are editable after creation without disturbing other members. A zero-member EDT is valid. Adding a member requires an explicit branch.
- Every managed service shows its branch plus ahead/behind counts. Without an upstream it shows "no upstream", and offline it shows "unknown (offline)".
- **Delete:** deleting a non-active EDT offers a leave/delete choice for each member's branch, informed by merge status and uncommitted work. Deletion is blocked while the EDT is active, and for any service whose branch another EDT uses.
- A crash affecting one EDT's SQLite file never affects another EDT. Remote branches come only from local remote-tracking refs, and the wizard never fetches.

## Technical Decisions

- **Storage:** one SQLite file per EDT at `XDG_DATA_HOME/tui-back/edts/<ulid>.db`, with the topic stored inside it. Settings live in `XDG_CONFIG_HOME/tui-back/settings.yaml`, behind a zod-validated `SettingsPort`. The active EDT is recorded in `XDG_STATE_HOME/tui-back/state.json`.
- **Git gate:** every git write goes through the centralized `adapters/driven/git` gate. It resolves the allowed branch from EDT and manifest state at write time and never trusts a branch passed in by the caller.
  - The gate rejects a protected branch, any branch that is not the current EDT's own branch, and a rename whose old or new name is owned by another EDT.
  - A single core helper, `isProtectedBranch(name, manifest)`, replaces `SHARED_BRANCHES`/`isSharedBranch`. No hardcoded branch list may remain in `src/`.
- **Manifest:** the schema gains an optional `protectedBranches: string[]` (entries trimmed and non-empty; a malformed value is a schema error). `ServiceBranchDivergence` carries `protectedBranches` next to `sharedBranch`.
- **`GitPort` additions:**
  - `listBranches` stays local-only.
  - `listRemoteBranches`: `origin/<x>` refs minus `origin/HEAD`; never fetches.
  - `renameBranch(…, edtId?)`: gates both names. When `edtId` is omitted, any registered owner blocks the rename. Callers pass their own EDT's ulid.
  - `createTrackingBranch`: gated like `createBranch`.
  - `isBranchMerged`, `deleteBranch`.
  - `diffNameOnly(from, to)`: read-only, not gated.
  - `listDirtyPaths`.
  - `discardAll`: the only consent-gated destructive primitive; its only caller is `switch.ts` under a `discard` resolution.
- **`createEdt`** takes an optional `memberPlans: Record<repoPath, MemberBranchPlan>` (`{kind:'create', base, name}` | `{kind:'existing', branch, renameTo?}`).
  - When present, it is authoritative: a member missing from it is rejected with `invalid-argument`.
  - When absent, the `branchOptions` path runs unchanged. The two paths stay side by side.
  - Outcomes: `created | existing-branch | renamed | failed`.
  - Rollback deletes created branches, renames renamed ones back, and logs a rollback failure without throwing.
- **`core/edt/activate.ts`** is used only by the wizard. It reuses the switch's per-repo target computation without stash tagging, and discards only the explicit `overwrite` paths (uncommitted paths ∩ `diffNameOnly(current, target)`).
- **`switch.ts`:**
  - A pure `classifySwitchRepos` helper does the classification.
  - Resolutions: `dirtyResolutions: Record<repoPath, {kind:'adopt', branch} | {kind:'discard'}>`, plus a CLI `dirtyPolicy` sugar that expands after the core's classification.
  - The `onDirtyReposBeforeSwitch` seam returns `cancel | proceed(resolutions)`.
  - `adopt` runs: gate → stash → create branch if needed → add to the outgoing EDT → checkout. A failure restores the stash.
- **Cross-EDT ownership:** a pure `branchOwners(edts, repoPath, branch, excludeUlid)` helper reads the store's loaded EDT list; no new port. `BranchAutocompleteInput` gains a generic `annotations?: Record<branch, string>` prop and stays EDT-agnostic.
- **Shared components:**
  - `TextInputLine`: cursor with Left/Right/Home/End.
  - `BranchPicker`: pick existing / create new / rename current.
  - `BranchAutocompleteInput` (from Epic 3): reuse it, never copy it.
  - `FailedResultList`: structured per-repo failures, with a `resolveAssistedAction(code)` registry, e.g. `branch-already-claimed`.
- **Wizard:** lives in `dialogs/create-wizard/`, with one file per step and a pure, unit-tested `wizard.logic.ts`. Step 3's reusable table and override-box components are shared with the switch dialog, which gets its own pure `switch-resolution.logic.ts`.
- **EDTs zone:** the first multi-splitter zone (`Ctrl+W` resize mode), with pane ratios saved per zone in `state.json`. The active EDT stays in sync through `state.json` + `fs.watch`, so CLI changes reach an open TUI.

## UX & Interaction Patterns

- **EDT selector:** the focused row gets the `emphasized` style (accent + bold). The tool-wide active EDT gets a separate, discreet `" active"` suffix.
- **Per-service `Enter` menu:** members get Remove and Change-branch; Restart is shown disabled until Epic 5. Non-members get Add-to-EDT.
- **Command bar:** `:` registers `edt-create`, `edt-switch`, `edt-modify`, `edt-delete` and `edt-create-from`. Run without an argument, switch, modify and create-from open a filterable quick-pick.
- **Wizard** (all labels in French):
  - Breadcrumb: `[1. Nom] ── [2. Services] ── [3. Branches] ── [4. Activation]`. The current step shows `▶ … ◀`, completed steps show a summary, unreachable steps are dim, and each step opens with a short intro.
  - Keys:
    - `Ctrl+→`/`Ctrl+N` go forward, only if the current step is valid.
    - `Ctrl+←` goes back and keeps the step's state.
    - `Tab` moves within a step.
    - `Enter` advances on Steps 1–2.
    - `Esc` closes the innermost field first, then cancels with nothing written. With zero EDTs, it requests quit.
  - These wizard-scoped keys belong in the keybinding contract.
- **Step 3:**
  - Panel A ("STRATÉGIE GLOBALE"):
    - The base shows a dim `<shared-branch>` placeholder, and any row without a match shows `✖ branche introuvable`, which blocks advancing.
    - The name follows the topic slug until the developer edits it.
  - Panel B: a height-bounded table `Service | Mode | Base / Source | Branche cible`.
    - Modes are `[Créer (Global)]`, `[Créer (Perso)]`, `[Existante]` and `[Renommer]`.
    - `Enter` opens a "Configurer" box, and `Ctrl+R` reverts the row to the global strategy.
- **Step 4:**
  - First EDT: activation is locked to "Oui", with an `[R] Réessayer` / `[E] Écraser` / `[Esc]` pause panel when files are at risk.
  - Later EDTs: a switch/stay radio choice, plus a list of the shared branch each non-member returns to.
- **Switch resolution dialog:** it mirrors Step 3.
  - Panel A: "Adopter dans <outgoing> / Écraser", plus a global branch name for rows on a protected branch.
  - Panel B: `Service | Portée | Branche actuelle | Action | Branche cible`, with state-1 rows shown dim and read-only.
  - Any `[Écraser]` row triggers a second confirmation that lists every file. Its default action is *Retour*.
  - `Esc` cancels the switch.
- **Owned-branch annotation:** in every branch chooser (the Step 3 box and `BranchPicker` pick-existing/rename), a branch owned by another EDT shows `⚠ EDT « <topic> »` (glyph + warning color, never color alone). Attaching or renaming it is refused inline with "utilisée par l'EDT « <topic> » — la reprendre ou la renommer casserait cet EDT", and an affected Step 3 row blocks `Ctrl+N`.
- **Delete confirmation:** lists each member's branch with its merge and uncommitted-work status, each with its own leave/delete toggle. Unreachable services show a severity-colored summary and an `[i] details` dialog.

## Cross-Story Dependencies

- **Git gate (2.3):** underlies every story that writes branches. 2.42 changes its protected-set rule and 2.43 extends its rename check. Epic 3's group update inherits both through the same gate.
- **Earlier foundations:**
  - Story 2.6 feeds the EDTs zone lists and Story 2.34's issue counts.
  - `TextInputLine` comes from 2.23 and 2.32.
  - `FailedResultList` comes from 2.25.
  - The command bar (2.14) comes before 2.15, 2.19, 2.29, 2.30 and 2.31.
- **Wizard:** 2.35, 2.36 and 2.37 are done. The epic-3 → epic-2 merge (bringing `BranchAutocompleteInput`) has landed.
- **Switch batch:** 2.39 (core) → 2.40 (CLI) and 2.41 (TUI dialog). 2.41 also reuses 2.37's table and box.
- **2.38** needs 2.39 and 2.41, and is sequenced after 2.41. Until it lands, Step 4 is a plain confirm.
- **2.31** needs 2.30 and 2.37. It pre-selects Step 2 and pre-sets Step 3 rows to `[Créer (Perso)]` from the source EDT.
- **2.42 and 2.43** build on 2.37's `shared-branches.ts` and Step 3. They are independent of each other, and either can go first. 2.41's inline protected-branch check must call the core helper, so it picks up 2.42's rule.
- **Other epics:** Epics 3–5 depend on this epic's gate and assisted resolution, and Restart depends on Epic 5. The epic-2 → `devlopment` PR will also carry the Epic 3 stories already merged in.
