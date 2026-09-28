# Epic 2 Context: EDT Workspace Management

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A developer can create, modify, safely switch between, and delete EDTs. An EDT is an isolated coding-session workspace spanning a manually chosen set of managed repos. None of this may ever lose uncommitted work. Every managed repo shows its branch and divergence, and non-member repos are guaranteed to stay on their configured shared branch. This is the first FR-bearing epic after Epic 1's navigation shell. Its branch stayed open long enough to absorb cross-cutting TUI infrastructure (command bar, settings screen, resizable multi-pane layout, structured failure display, text-input primitives). Its final batch (2.35–2.38) replaces the flat create-EDT dialog with a 4-step creation wizard (Name → Services → Branches → Activation). The wizard adds per-service branch plans, attaching remote branches and an explicit activation choice. A second batch (2.39–2.41) replaces the switch's informational dirty-repo confirm with an authoritative three-state model where dirty work outside the outgoing EDT must be explicitly adopted or discarded. The wizard batch also fixes three defects:
- TUI creates silently became the active EDT.
- The create log entry was written to the wrong EDT.
- `renameBranch` did not gate the old name.

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

## Requirements & Constraints

- Create an EDT with a unique topic and ≥1 member service. A duplicate topic or zero members is rejected up front. The wizard checks the name live on every keystroke (trimmed, case-sensitive).
- Every member always gets a branch on the TUI path. One global strategy applies by default: the base is each repo's manifest `sharedBranch` unless one is typed, and the name is the topic slug. Any service can override it: create a branch from its own base, or attach an existing local or remote branch, optionally renamed. The CLI `edt create` keeps its original shape (one base and one naming mode for the whole action), and its behavior and tests must stay unchanged. A failure on one service never aborts the others.
- A shared/protected branch (`development`, preprod, prod) can never become an EDT's own branch. The tool rejects it with an explanation before any git write, at create, modify, rename or attach time. Renaming a protected branch *away* is refused as well.
- Switching the active EDT:
  - classifies repos against the **outgoing** EDT: state 1 = outgoing member (dirty → auto-stashed with the outgoing ulid, popped on return); state 2 = member of another EDT only; state 3 = member of no EDT;
  - a dirty state-2/3 repo needs an explicit resolution — `adopt` (onto a branch registered in the outgoing EDT, never a shared one) or `discard` (consent-gated `reset --hard` + `clean -fd`, ignored files kept); unresolved → `switch-dirty-services-unresolved` with zero writes. The old fixed `tui-back:shared` stash round-trip is removed;
  - the CLI fails safe by default and takes `--adopt-dirty --adopt-branch <name>` or `--discard-dirty`; the TUI resolves through a two-panel dialog mirroring wizard Step 3;
  - resets non-member repos to their shared branch, fetching it first if it is missing locally;
  - is blocked while a locked action runs on the outgoing EDT, with a stop-and-resume offer.
- Activation after creation is always explicit, and the store never writes the active pointer on create.
  - **First EDT** (no outgoing EDT): a pre-flight runs over every repo and checks out nothing. If a checkout would overwrite uncommitted files, the flow pauses and lists those files per repo. The developer can Retry (as many times as needed), Overwrite, or stop with Esc (the EDT is created but not active). Overwrite needs a second confirmation naming every file; it is the only exception to the auto-preserve guarantee.
  - **Later EDTs**: the choice is "switch now" (the default, via the protected switch including its dirty-repo confirm step) or "create without switching".
- The action-log entry for a create always goes to the new EDT's database, never to the previously focused EDT.
- Members, branches and topic can be edited after creation without disturbing other members. A zero-member EDT is valid.
- Every managed service shows its branch plus ahead/behind counts. When there is no upstream or the repo is offline, it shows "no upstream" or "unknown (offline)" instead of a number.
- Deleting a non-active EDT offers a leave/delete choice for each member's branch, informed by merge status and uncommitted work. Deletion is blocked while the EDT is active, and for any service whose branch belongs to another EDT.
- A crash touching one EDT's SQLite file must never affect another EDT's data.
- Remote branches are read only from the local clone's remote-tracking refs. The wizard never fetches.

## Technical Decisions

- Storage: one SQLite file per EDT at `XDG_DATA_HOME/tui-back/edts/<ulid>.db`, with the topic stored inside the file. Settings live in `XDG_CONFIG_HOME/tui-back/settings.yaml`, behind a zod-validated `SettingsPort`.
- Every git write goes through the centralized `adapters/driven/git` gate, which resolves the allowed branch itself and never trusts a branch passed in by a caller.
  - `GitPort` gains `listBranches`, `renameBranch` (gates both old and new names), `isBranchMerged`, `deleteBranch`, `listRemoteBranches` (`origin/<x>` minus `origin/HEAD`, never fetches) and `createTrackingBranch` (gated like `createBranch`).
  - It also gains `diffNameOnly(from, to)`, which is read-only and not gated.
  - `listBranches` stays local-only for all existing callers.
- `createEdt` takes an optional `memberPlans: Record<repoPath, MemberBranchPlan>`.
  - Plan shape: `{kind:'create', base, name}` or `{kind:'existing', branch, renameTo?}`.
  - When present, it is authoritative and a missing member is rejected with `invalid-argument`. When absent, the existing `branchOptions` path runs unchanged. The two paths stay side by side, and `branchOptions` is not converted into plans.
  - Outcomes: `created | existing-branch | renamed | failed`. Rollback force-deletes created and tracking branches and renames renamed branches back. A rollback failure is logged per branch and never thrown.
- New core use-case `core/edt/activate.ts` (`activateEdt`), used only by the wizard. It reuses the switch's per-repo target computation but does no stash tagging. It takes an explicit per-repo `overwrite: string[]`, which it passes to `git.discardPaths`. The files at risk are the uncommitted paths that also appear in `diffNameOnly(current, target)`.
- Adding a member in `core/edt/modify.ts` always needs an explicit target branch. If none is given, it fails with `branch-required` rather than falling back to the current branch.
- Partial failures (switch, create, modify, add-to-edt, delete, activate) render as a structured per-repo `FailedResultList`. It has an extensible `resolveAssistedAction(code)` registry, currently with one entry, `branch-already-claimed`.
- Shared components:
  - `TextInputLine`: visible cursor, Left/Right/Home/End.
  - `BranchPicker`: pick existing / create new / rename current.
  - `BranchAutocompleteInput`: comes from Epic 3 and must be reused, never copied.
- The wizard lives in `dialogs/create-wizard/`, with one file per step and a pure, unit-tested `wizard.logic.ts`. It retires `CreateDialogState`, `CreateFormFocus`, `advanceCreateFormFocus`, `prefillBaseBranches` and `resolveBaseBranchMode`. Step 3 loads each service's local and remote branches once, through the store.
- The EDTs zone is the first multi-splitter zone (`Ctrl+W` resize mode). Pane ratios are saved per zone in `state.json`. The active EDT stays in sync through `state.json` + `fs.watch`, so a change made from the CLI reaches an open TUI.

## UX & Interaction Patterns

- EDT selector: the row that drives the services split gets the `emphasized` style (accent + bold). The tool-wide active EDT gets a separate, discreet `" active"` suffix.
- Per-service `Enter` menu: members get Remove and Change-branch (Restart is shown disabled with "Available with Epic 5"). Non-members get Add-to-EDT.
- The `:` bar registers `edt-create`, `edt-switch`, `edt-modify`, `edt-delete` and `edt-create-from`. Run without an argument, switch, modify and create-from open a filterable quick-pick.
- Creation wizard modal. All wizard labels are in French.
  - Breadcrumb: `[1. Nom] ── [2. Services] ── [3. Branches] ── [4. Activation]`. The current step shows `▶ … ◀` in the accent color, completed steps show a summary, and unreachable steps are dim. Each step opens with a short intro.
  - Keys:
    - `Ctrl+→`/`Ctrl+N`: next step, only if the current step is valid.
    - `Ctrl+←`: back one step; always allowed and keeps the step's state.
    - `Tab`: moves within the current step.
    - `Enter`: advances on Steps 1–2 only.
    - `Esc`: closes the innermost field or box first, then cancels with nothing written. With zero EDTs, it requests quit.
  - These wizard-only keys must be added to the keybinding contract. Ctrl+Arrow may not reach Ink on every terminal, so `Ctrl+N` is the fallback. Check for `Ctrl+N` collisions.
  - Step 3 panel A ("STRATÉGIE GLOBALE"):
    - Base line: empty shows a dim `<shared-branch>` placeholder. Otherwise it is resolved live per service (exact match, local branch preferred over `origin/x`). A red `✖ branche introuvable` on any row blocks advancing.
    - Name line: pre-filled with the topic slug and keeps tracking the topic until edited (touched-flag convention).
  - Step 3 panel B: a height-bounded table `Service | Mode | Base / Source | Branche cible`. Modes are `[Créer (Global)]`, `[Créer (Perso)]`, `[Existante]` and `[Renommer]`.
    - `Enter` opens a per-service override box with Créer nouvelle / Choisir existante and an optional rename. Protected names are rejected inline.
    - `Ctrl+R` (proposed) reverts the row to the global strategy.
  - Step 4:
    - First EDT: the activation choice is locked to "Oui". If files are at risk, the step shows the `[R] Réessayer` / `[E] Écraser` / `[Esc]` pause panel.
    - Later EDTs: a radio choice between switch and stay. An info block lists, per service, the shared branch each non-member returns to.
- Delete confirmation lists each member's branch, merge status and uncommitted-work status, each with its own leave/delete toggle. Unreachable or errored services show a severity-colored summary plus an `[i] details` dialog.

## Cross-Story Dependencies

- Story 2.3 (git safety gate) underlies every story that changes branches: 2.2, 2.4, 2.5, 2.22, 2.24, 2.26, 2.29, 2.35 and 2.38.
- Story 2.6 feeds the EDTs zone lists (2.9, 2.18) and Story 2.34's issue counts.
- `TextInputLine`: Story 2.23 builds it and 2.32 extends it to the whole app. 2.22, 2.24, 2.26 and 2.36 use it.
- Story 2.25's structured failure list is reused by 2.24, 2.26, 2.28, 2.33, 2.34 and 2.38.
- Story 2.14 (command bar) must come before 2.15, 2.19, 2.29, 2.30 and 2.31.
- Story 2.18's multi-splitter layout is completed by 2.21.
- Wizard order:
  - 2.35 (core) and 2.36 (shell) can proceed independently of each other.
  - 2.37 **blocks until** 2.35 is done and merged **and** `epic-3-group-update-migrations` is merged into epic-2. That merge brings `BranchAutocompleteInput` and has 4 expected conflicts. It had not happened when this was compiled.
  - 2.38 needs 2.35, 2.36, 2.39 and 2.41 (the switch resolution dialog supersedes the `fix-edt-switch-dirty-service-confirmation` confirm seam); it is sequenced after 2.41.
  - Switch batch: 2.39 (core) → 2.40 (CLI) and 2.41 (TUI dialog); 2.41 also needs 2.37's reusable table/override-box components.
  - 2.31 comes after 2.30 and 2.37. It pre-selects Step 2 and pre-sets Step 3 rows to `[Créer (Perso)]` from the root EDT.
  - Until 2.37 and 2.38 land, Steps 3 and 4 keep today's branch setup and plain confirm, so the epic branch stays shippable.
- Epics 3–5 depend on this epic's git safety gate and its assisted-resolution mechanism. The deferred "Restart" action depends on Epic 5 (Story 5.3). Merging epic-3 into epic-2 means the epic-2 → `devlopment` PR will also carry Stories 3.6–3.8.
