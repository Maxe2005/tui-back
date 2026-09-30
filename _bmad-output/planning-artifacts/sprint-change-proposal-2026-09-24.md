---
date: 2026-09-24
trigger: 'Max requested a full UX/UI redesign of the TUI `edt-create` command into a 4-step wizard (Name → Services → Branches → Activation) with per-service branch overrides, plus two defects found while documenting the current flow: every TUI-driven create silently becomes the active EDT, and the create action-log entry is written to the previously focused EDT instead of the new one.'
mode: batch
epic_impact: 'Epic 2 (in-progress) — four new stories appended (2.35-2.38), Story 2.31 (backlog) amended in place, epic-3 merged into epic-2 as a prerequisite. PRD FR-4 and the Safety — Data Loss bar amended. No new epic.'
scope_classification: moderate
---

# Sprint Change Proposal — 2026-09-24

## 1. Issue Summary

**Trigger — new requirement.** Max wants the TUI's `edt-create` flow rebuilt as an explicit
4-step wizard with a breadcrumb (`[1. Nom] ── [2. Services] ── [3. Branches] ── [4. Activation]`),
a per-service branch table with overrides (create from a custom base, attach an existing branch,
optionally rename it), and an explicit activation step. Today's dialog
(`src/adapters/driving/tui/zones/edts/dialogs/create-dialog.tsx`, Stories 2.9/2.22/2.27) is a
single flat Tab-cycle (topic → member checklist → base → naming mode → name field(s)) that:

- offers one base-branch choice and one naming mode for the whole action (FR-4), so a single
  service that must start from `staging`, or that should reuse an in-flight branch, cannot be
  expressed;
- has no notion of "attach an existing branch" in the TUI at all since Story 2.22 made branch
  creation mandatory;
- gives no live feedback on topic uniqueness (only a post-submit `edt-topic-exists` error);
- has no activation choice.

**Defects found while tracing the current flow (evidence):**

1. `edt-slice.ts:280-291` — `createEdt` in the store *unconditionally* writes the new EDT as the
   active one (`deps.state.writeActiveEdt`). Its own comment justifies this with "the TUI's create
   dialog is only ever reachable via AC1's zero-EDT prompt", which stopped being true when Story
   2.15 added the `edt-create` command. Every TUI create now silently changes the active EDT
   *without* the protected switch (no stash, no non-member reset — FR-6/FR-8 bypassed).
2. `create-dialog.tsx:491-510` — the create action-log entry is written to `deps.focusedEdt` (the
   EDT that was focused *before* the create), never to the new EDT; with zero EDTs nothing is
   logged at all.
3. `adapters/driven/git/index.ts:620` — `renameBranch` gates only the *new* name; renaming a
   shared branch (e.g. `development`) *away* is not rejected. Harmless today (no caller offers it),
   but the new "attach existing branch + rename" path would expose it.

## 2. Impact Analysis

### Checklist summary

| Item | Status | Note |
|---|---|---|
| 1.1 Trigger | [x] | Direct request + 2.15 regression (defect 1) |
| 1.2 Problem type | [x] | New requirement + latent defects |
| 1.3 Evidence | [x] | File/line references above |
| 2.1 Current epic viable | [x] | Epic 2 absorbs it via appended stories |
| 2.2 Epic changes | [x] | 4 new stories, 1 amended (2.31) |
| 2.3 Other epics | [x] | Epic 3 merged in (prerequisite), not modified |
| 2.4 Obsolete/new epics | [N/A] | |
| 2.5 Reordering | [x] | 2.31 must now sequence after 2.37 |
| 3.1 PRD | [!] | FR-4 + Safety — Data Loss amended (below) |
| 3.2 Architecture | [x] | Additive only: 2 `GitPort` methods, 1 new core use-case, no AD change |
| 3.3 UX | [!] | Keybinding contract + UJ-1 + 2 new component patterns (left for implementation) |
| 3.4 Other artifacts | [x] | `deferred-work.md`, `sprint-status.yaml` |
| 4.x Path | [x] | Direct Adjustment |

### Epic Impact

Epic 2 (`in-progress`) absorbs four new stories, **2.35–2.38**, appended after 2.34 — same
"branch still open" precedent as 2.27–2.34. Story **2.31** (`edt-create-from`, `backlog`) is
amended in place to target the wizard. Stories **2.22 / 2.27** (`done`) are not rolled back: their
core logic (`CreateBranchOptions`, manifest-aware `sharedBranch` suggestion, slug suggestion)
stays in use; only the dialog UI they built is superseded.

**Epic 3 → Epic 2 merge (prerequisite, Max's decision).** The shared `BranchAutocompleteInput`
(`src/adapters/driving/tui/shared/components/branch-autocomplete-input.tsx`) lives only on
`epic-3-group-update-migrations`. Merging epic-3 into epic-2 brings 13 commits (Stories 3.6–3.8
and the autocomplete component). A dry-run `git merge-tree` shows **4 conflicts**:
`deferred-work.md`, `sprint-status.yaml`, `sprint-change-proposal-2026-09-22.md` (add/add), and
`src/adapters/driving/tui/zones/edts/edts-zone.test.tsx`. Consequence: the eventual epic-2 → 
`devlopment` PR will also carry that Epic 3 work.

### Story Impact

| Story | Change |
|---|---|
| 2.35 (new) | Core: per-service branch plans in `createEdt` (create with global base / create with own base / attach existing / attach existing + rename), local **and remote** branch support (`GitPort.listRemoteBranches`, `createTrackingBranch`), rename gated on both names, full rollback. CLI unchanged. |
| 2.36 (new) | Wizard shell: breadcrumb, step navigation keys, per-step intro, Step 1 (live-unique name), Step 2 (≥1 service). |
| 2.37 (new) | Step 3: Panel A global strategy + Panel B per-service table + per-service override box (`BranchAutocompleteInput`). |
| 2.38 (new) | Step 4: activation — first-EDT activation (checkout members + non-members with pause/retry/overwrite), switch-or-stay toggle for later EDTs; fixes defects 1 & 2. |
| 2.31 (amended) | Seeds the wizard (Step 2 pre-checked, Step 3 rows pre-set to "Créer (Perso)" from the root EDT's branch) instead of the old dialog. |

### Artifact Conflicts

- **PRD**
  - **FR-4** — "One base-branch choice and one naming mode apply to the whole creation action"
    no longer holds in the TUI: a global strategy still exists, but any service may override it,
    and "attach an existing branch (optionally renamed)" returns per service. Amendment below.
  - **Safety — Data Loss** (§4, "Uncommitted work is always auto-preserved on any tool-triggered
    branch switch") — Max chose to keep an explicit **overwrite** option when the first EDT's
    activation checkout would overwrite uncommitted files. This is a deliberate, consent-gated
    exception; amendment below.
  - FR-3, FR-6, FR-7, FR-8: unchanged, all still satisfied (FR-7 is *strengthened* by defect 3's
    fix; FR-6/FR-8 are *restored* for TUI creates by defect 1's fix).
  - MVP scope (§6) unchanged.
- **Architecture** — additive only, no AD amended:
  - `core/ports/git.ts`: `listRemoteBranches(repoPath)` (reads local remote-tracking refs only —
    `git branch -r`, never fetches, so "only local repo copies are ever touched" still holds) and
    `createTrackingBranch(repoPath, localName, remoteRef)`. Both writes go through the AD-8 gate.
    This lifts Story 2.26's explicit "listBranches stays local-only" boundary *by adding a sibling
    method*, not by widening `listBranches` — every existing caller keeps local-only semantics.
  - `renameBranch` gate widened to the old name as well (defect 3).
  - New core use-case `core/edt/activate.ts` (first-EDT activation), AD-2 compliant (returns the
    same `Result` shape; not exposed via CLI in this change — CLI unchanged by Max's decision).
  - No SQLite schema, lock, or XDG change.
- **UX (`EXPERIENCE.md` / `DESIGN.md`)** — left for the implementing stories to apply, same
  precedent as the 2026-09-16 and 2026-09-22 proposals:
  - Canonical keybinding contract (Story 1.13: arrows/Home/End/Tab/Space/Enter/Esc) gains
    **Ctrl+←/Ctrl+→** (step jump) and **Ctrl+N** (next step), scoped to the wizard modal only.
  - UJ-1 steps 3–5 rewritten around the wizard.
  - Two new component patterns: `wizard-breadcrumb` and `branch-plan-table`.
  - The `text-input` row's "no mid-string cursor movement yet" wording is already stale since
    Story 2.32 — fix in passing.
- **`deferred-work.md`** — the Story 2.9 entry "Creating a *second* (or later) EDT from the TUI is
  not wired" gets `resolved_by: Story 2.15 (entry point) / Story 2.38 (activation choice)` once
  2.38 ships (`tracked_by` applied now).

### Technical Impact

- `CreateDialogState` is replaced by a wizard state (`step` + per-step sub-state); the flat
  `CreateFormFocus` cycle and `advanceCreateFormFocus` are retired.
- `createEdt` gains an optional `memberPlans` parameter; `branchOptions` stays for the CLI.
- **Risk — Ctrl+Arrow in Ink.** Ctrl+←/→ reach Ink as `leftArrow`/`rightArrow` with `ctrl: true`
  only on terminals that send the xterm modifier sequences (`\x1b[1;5D`/`C`). Story 2.36 must
  verify this on Max's terminal; Ctrl+N and Tab remain the always-working fallbacks.
- **Risk — Ctrl+N collision.** Check it isn't bound elsewhere while a modal owns input (the zone
  already gates global shortcuts via `setZoneInputCaptured`).

## 3. Recommended Approach

**Direct Adjustment (Option 1) — viable, effort High (4 stories), risk Medium.**

- Additive: the core keeps the CLI's call shape; the TUI dialog is replaced wholesale behind the
  same `edt-create` entry point.
- No rollback: 2.22/2.27's core helpers are reused.
- No MVP review: no scope cut, the change deepens FR-3/FR-4 rather than adding a new capability area.

**Why Moderate, not Minor:** four interdependent stories, a cross-epic branch merge, a PRD safety
amendment, and a keybinding-contract extension — it needs sequencing, not a single hand-off.

## 4. Detailed Change Proposals

### 4.1 `epics.md` — new stories (inserted after Story 2.34, before "## Epic 3")

### Story 2.35: EDT Creation Core — Per-Service Branch Plans & Remote Branches

> Added 2026-09-24 (Sprint Change Proposal): core groundwork for the `edt-create` wizard (Stories 2.36–2.38). Amends FR-4's "one base / one naming mode for the whole action" into "a global strategy with per-service overrides". CLI (`tui-back edt create`) is deliberately unchanged.

As a developer, I want EDT creation to accept an individual branch plan per member service — create from the global base, create from its own base, or attach an existing (local or remote) branch, optionally renamed — so that one EDT can mix services starting from different points without me fixing branches by hand afterwards.

**Acceptance Criteria:**

**Given** `CreateEdtParams` **When** extended **Then** it accepts an optional `memberPlans: Record<repoPath, MemberBranchPlan>` where `MemberBranchPlan = { kind: 'create'; base: string; name: string } | { kind: 'existing'; branch: string; renameTo?: string }`; when `memberPlans` is present it is authoritative for every member (a member missing from it is rejected before any write, `invalid-argument`); when absent, `branchOptions` behaves exactly as today (CLI path untouched).

**Given** a `create` plan **When** executed **Then** `git.createBranch(member, name, base)` runs, where `base` may be a local branch or a remote-tracking ref (`origin/<x>`); the branch is never checked out (Story 2.2 invariant); outcome `created`.

**Given** an `existing` plan on a **local** branch without `renameTo` **When** executed **Then** the branch must pass `git.assertAllowedBranch` (FR-7) and is recorded as the member's branch; outcome `existing-branch`.

**Given** an `existing` plan with `renameTo` **When** executed **Then** `git.renameBranch(member, branch, renameTo)` runs and the member's branch is recorded as `renameTo`; outcome `renamed` (the closed outcome set widens to `created | existing-branch | renamed | failed`).

**Given** an `existing` plan whose `branch` is a **remote-only** ref (`origin/<x>`) **When** executed **Then** a local branch tracking it is created via the new `git.createTrackingBranch(member, localName, remoteRef)` — `localName` is `renameTo` when set, else `<x>` — gated like `createBranch`; outcome `created`.

**Given** `renameBranch` **When** called **Then** it rejects (before any git write) when *either* the old or the new name is a shared/protected branch — renaming `development` away is refused exactly like renaming onto it (closes the old-name gap).

**Given** the new `GitPort.listRemoteBranches(repoPath)` **When** called **Then** it returns the repo's remote-tracking refs (`origin/<x>`, excluding `origin/HEAD`) read from the local clone only — never fetching; `listBranches` stays local-only, unchanged for every existing caller.

**Given** the EDT-registry write fails after some plans succeeded **When** rolling back **Then** created and tracking branches are force-deleted (existing behavior) **and** renamed branches are renamed back to their original name; a rollback failure is logged per branch, never thrown.

**Given** per-member failure isolation (Story 2.2/2.3) **When** any plan fails **Then** that member gets a `failed` row, is not registered, and the others proceed — unchanged.

**Implementation notes:** `resolveMemberBranch` in `core/edt/create.ts` gains a `plan` branch alongside today's `options.create` branches; keep the two paths side by side rather than converting `branchOptions` into plans, so the CLI's behavior is provably unchanged (its existing tests stay untouched). Adapter: `listRemoteBranches` = `git for-each-ref --format=%(refname:short) refs/remotes`, filter `*/HEAD`; `createTrackingBranch` = `git branch --track <local> <remoteRef>`. The TUI-side "does this base exist in this service" check (Story 2.37) is a pure function over `listBranches ∪ listRemoteBranches`, not a new port method.

### Story 2.36: EDT Creation Wizard — Shell, Step Navigation, Name & Services Steps

> Added 2026-09-24 (Sprint Change Proposal): replaces the flat create-EDT dialog (Stories 2.9/2.22/2.27) with a 4-step wizard. This story builds the shell and Steps 1–2; Steps 3–4 land in Stories 2.37/2.38.

As a developer, I want EDT creation to walk me through explicit, labelled steps with a breadcrumb showing where I am and what I've decided so far, so that I never lose track of which choices are made and which are still pending.

**Acceptance Criteria:**

**Given** the `edt-create` command or the zero-EDT auto-open **When** triggered **Then** a modal titled "EDT Wizard: Création d'un espace de travail" opens on Step 1 with a breadcrumb `[1. Nom] ── [2. Services] ── [3. Branches] ── [4. Activation]`; the current step is marked (`▶ … ◀` + accent color), completed steps show their summary (`1. Nom: auth-flow`, `2. Services (3)`), unreachable steps are dim.

**Given** any step **When** rendered **Then** it opens with a short intro explaining what the step does and what is decided in it.

**Given** navigation keys **When** pressed **Then**: `Ctrl+→` / `Ctrl+N` go to the next step only if the current step is valid (else its inline error shows); `Ctrl+←` goes back one step (always allowed, state preserved); `Tab` moves between fields/zones *within* the current step; `Enter` advances on Steps 1–2 (Step 3 uses Enter for editing — Story 2.37; Step 4 uses it for final confirmation — Story 2.38); `Esc` closes the innermost open sub-field/box first, otherwise cancels the whole creation with nothing written — except with zero existing EDTs, where it requests quit (current behavior kept).

**Given** Step 1 **When** shown **Then** a single autofocused `TextInputLine` holds the EDT name; availability is checked live on every keystroke (trimmed, case-sensitive, against the loaded EDT list) and shown with glyph + color — `✔ disponible` (`success`) / `✖ déjà pris` (`error`); an empty or taken name blocks advancing.

**Given** Step 2 **When** shown **Then** every registered managed repo is listed as a `checkbox-list-item` (`Space` toggles, `↑/↓/Home/End` move), with the existing loading/error/empty states; zero checked services blocks advancing with an inline message.

**Given** Steps 3–4 before Stories 2.37/2.38 land **When** reached **Then** Step 3 hosts today's branch-setup fields unchanged and Step 4 is a plain confirm with today's behavior, so the epic branch stays shippable between stories.

**Given** the keybinding contract (Story 1.13, `EXPERIENCE.md`) **When** this story lands **Then** it documents `Ctrl+←/→` and `Ctrl+N` as wizard-scoped additions; if the terminal does not deliver `ctrl` on arrow keys (verify in Ink), `Ctrl+N` and `Ctrl+←`'s fallback (documented) keep every step reachable.

**Implementation notes:** new `dialogs/create-wizard/` folder (one file per step + a pure `wizard.logic.ts`: `canAdvance(step, state)`, `reachableSteps(state)`, `stepSummary(step, state)`), unit-tested directly like `edts-zone.logic.ts`. `CreateDialogState`/`CreateFormFocus`/`advanceCreateFormFocus` are retired at the end of Story 2.37 once Step 3 no longer needs them.

### Story 2.37: EDT Creation Wizard — Step 3: Global Branch Strategy & Per-Service Overrides

> Added 2026-09-24 (Sprint Change Proposal): Step 3 of the wizard. Requires the epic-3 → epic-2 merge (`BranchAutocompleteInput`) and Story 2.35's `memberPlans`/remote-branch support.

As a developer, I want to set one branch rule for all selected services and then adjust individual services in a table, so that the common case takes seconds and the exceptions stay visible instead of being buried in a per-service form.

**Acceptance Criteria:**

**Given** Step 3 **When** shown **Then** it has two vertically stacked panels — **A "STRATÉGIE GLOBALE"** (focused by default) and **B "RÉSUMÉ ET EXCEPTIONS PAR SERVICE"** — and `Tab` switches between them; a footer shows `[Tab] Changer de zone • [Entrée] Configurer la ligne • [Ctrl+N] Étape suivante`.

**Given** Panel A **When** navigated **Then** `↑/↓` move between its two lines ("Branche source par défaut", "Nom global de la branche"); `Enter` enters edit mode on the focused line, `Esc` leaves it, and for the base line any printable key also enters edit mode with that character typed.

**Given** "Branche source par défaut" **When** empty **Then** it shows a dim, non-editable `<shared-branch>` placeholder meaning "each service uses its own manifest `sharedBranch`"; the first keystroke clears the placeholder and the field becomes a `TextInputLine` (`h|`); clearing it back to empty restores the placeholder.

**Given** a non-empty global base **When** typed **Then** every row in mode "Créer (Global)" re-resolves it live against *that service's* local and remote branches (exact match, local preferred over `origin/<x>`); a service with no match shows a red `✖ branche introuvable` message in its row (glyph + color); Step 3 cannot be left while any "Créer (Global)" row carries it.

**Given** "Nom global de la branche" **When** Step 3 is first entered **Then** it is pre-filled with the slug of the Step 1 name (`suggestBranchNameFromTopic`, no prefix) and keeps tracking the name until edited (touched-flag convention, Story 2.22); every edit live-updates every "Créer (Global)" row's target.

**Given** Panel B **When** rendered **Then** it is a table `Service | Mode | Base / Source | Branche cible` with one row per selected service; modes are `[Créer (Global)]`, `[Créer (Perso)]`, `[Existante]`, `[Renommer]`; for `[Renommer]` the target column reads `-> <new name>`; the list is height-bounded (NFR-7); `↑/↓` move the row cursor and `Enter` opens the override box for that service.

**Given** the override box ("Configurer <service>") **When** open **Then** it shows `Mode : (•) Créer nouvelle ( ) Choisir existante` (toggled with `Space` or `Tab` while the Mode line is focused), then mode-specific lines and an `[ Appliquer ]` action. `↑/↓` move between lines; `Enter` enters the focused field; inside a field, `Enter` commits and focuses the next line; `Esc` leaves the field; `Esc` with no field active closes the box without applying; `Enter` on `[ Appliquer ]` (or on the last field's committed value, second `Enter`) applies and closes.

**Given** mode "Créer nouvelle" in the box **When** edited **Then** "Branche de base (source)" is a `BranchAutocompleteInput` over that service's local + remote branches (pre-filled with the current row's base), and "Nom de la branche" is a `TextInputLine` pre-filled with the global name; a protected/shared target name is rejected inline (FR-7); applying sets the row to `[Créer (Perso)]` — it no longer follows Panel A changes.

**Given** mode "Choisir existante" in the box **When** edited **Then** "Branche existante" is a `BranchAutocompleteInput` over local + remote branches; a `[ ] Renommer la branche locale` checkbox (`Space`) reveals "Nouveau nom"; choosing a protected branch without a rename, or a protected new name, is rejected inline (FR-7); applying sets the row to `[Existante]` or `[Renommer]`.

**Given** a row in `[Créer (Perso)]`, `[Existante]` or `[Renommer]` **When** the developer wants the global rule back **Then** a documented key in the box (proposed: `Ctrl+R` "Revenir à la stratégie globale") resets it to `[Créer (Global)]`.

**Given** `Ctrl+N` / `Ctrl+→` **When** Step 3 is valid (no red row, every name non-empty, every base resolved) **Then** the wizard moves to Step 4 and Step 3's rows are turned into Story 2.35's `memberPlans`.

**Implementation notes:** per-service branch lists (`listBranches` + `listRemoteBranches`) are loaded once when Step 3 is first entered (and on retry), exposed through the store like `listMemberBranches` today. Pure helpers in `wizard.logic.ts`: `resolveGlobalBase(input, branchesByService)`, `buildRowView(plan, global)`, `buildMemberPlans(rows)`. Retires `CreateDialogState`'s branch-step fields, `advanceCreateFormFocus`, `prefillBaseBranches`, `resolveBaseBranchMode` if no other caller remains (Story 2.31 is re-pointed to the wizard below).

### Story 2.38: EDT Creation Wizard — Step 4: Activation & Switch Choice

> Added 2026-09-24 (Sprint Change Proposal): Step 4 of the wizard. Fixes two defects: TUI creates silently became the active EDT without a protected switch (`edt-slice.ts:280-291`), and the create action-log entry went to the previously focused EDT (`create-dialog.tsx:491-510`). Relies on the switch dirty-repo confirm seam (branch `fix-edt-switch-dirty-service-confirmation`), which must be merged into epic-2 first.

As a developer, I want the last step of EDT creation to make explicit whether the new EDT becomes active now — and, for my very first EDT, to put every repo on the right branch while showing me exactly which uncommitted files are in the way — so that creation never silently changes my working state.

**Acceptance Criteria:**

**Given** zero EDTs existed before this creation **When** Step 4 renders **Then** the activation option is visually locked on "Oui" with the label "Définir cet EDT comme espace actif immédiatement", plus an explanation that no outgoing EDT exists to preserve.

**Given** that first-EDT case **When** the developer confirms (`Enter`) **Then** `createEdt` runs, then a new core use-case `activateEdt` (`core/edt/activate.ts`) pre-flights every managed repo: members target their EDT branch, non-members target their manifest `sharedBranch` (fetched first if absent locally, FR-8); a repo whose uncommitted changes would be overwritten by that checkout is reported with the exact file list (uncommitted paths ∩ paths differing between current and target branch) and **no checkout runs anywhere yet**.

**Given** that pre-flight reported blocked repos **When** shown **Then** the wizard pauses on a panel listing each blocked service and its files, with: `[R] Réessayer` (re-runs the pre-flight after the developer fixed things by hand — repeatable indefinitely), `[E] Écraser` (a second explicit confirmation listing every file that will be discarded, then discards exactly those paths and proceeds), `[Esc]` (stop: the EDT stays created but **not** active, and the wizard says so).

**Given** a clean pre-flight (or after Retry/Overwrite) **When** activation proceeds **Then** every repo is checked out on its target branch, `state.json`'s active pointer is set to the new EDT, per-repo failures are shown via `FailedResultList`, and one failure never blocks the others.

**Given** one or more EDTs already existed **When** Step 4 renders **Then** a radio toggle (`Space`/`↑↓`) offers `(•) Basculer immédiatement sur ce nouvel EDT` (default) and `( ) Créer sans basculer (rester sur l'EDT courant)`; under the switch option an info block states that uncommitted work in the outgoing EDT is auto-preserved (stash), that non-member services return to **their own shared branch (listed by name per service)**, and that member services move to their configured branches.

**Given** "Basculer immédiatement" **When** confirmed **Then** `createEdt` runs, then the existing protected switch (`switchEdt`, including the dirty-repo confirm seam) runs to the new EDT — never a direct `writeActiveEdt`.

**Given** "Créer sans basculer" **When** confirmed **Then** only `createEdt` runs; the active EDT is unchanged.

**Given** the store's `createEdt` action **When** this story lands **Then** its unconditional `writeActiveEdt` is removed — activation only ever happens through Step 4's explicit paths above.

**Given** any creation outcome **When** logged **Then** the action-log entry is written to the **new** EDT's database (success, partial failure, or activation stopped), never to the previously focused EDT.

**Implementation notes:** `activateEdt` reuses `switch.ts`'s per-repo target computation (member → registered branch, non-member → `sharedBranch` + fetch-if-missing) but has no outgoing EDT, so no stash tagging; it takes an explicit `overwrite: string[]` per repo (paths the developer confirmed) and calls the existing `git.discardPaths` for exactly those. The overwrite path is the consent-gated exception recorded in the PRD amendment below. The pre-flight "would be overwritten" set needs one new read-only `GitPort` helper (`diffNameOnly(repoPath, from, to)`), gated nowhere (read-only).

### 4.2 `epics.md` — Story 2.31 amended in place (still `backlog`)

**OLD (AC 3 and 4, and implementation notes):**
> **Given** a root EDT is resolved **When** the create dialog opens **Then** the member checklist is pre-checked with exactly the root EDT's current members …
>
> **Given** the branch-setup step (Story 2.27) **When** a selected member *was* a member of the root EDT and naming mode reaches "Create new" for it **Then** the suggested base branch is that member's own *current* branch in the root EDT …
>
> **Implementation notes:** `initialCreateDialog` gains an optional `seedFromEdt: EdtRegistryEntry` parameter … Depends on Story 2.27 and Story 2.30 — sequence after both.

**NEW:**
> **Given** a root EDT is resolved **When** the creation wizard opens **Then** Step 2's checklist is pre-checked with exactly the root EDT's current members — still fully editable.
>
> **Given** Step 3 (Story 2.37) **When** a selected member *was* a member of the root EDT **Then** its row starts in `[Créer (Perso)]` with that member's branch in the root EDT as base (not `sharedBranch`); members not in the root EDT start in `[Créer (Global)]` as usual.
>
> **Implementation notes:** the wizard's initial state gains an optional `seedFromEdt: EdtRegistryEntry` that pre-populates Step 2's selection and Step 3's per-row plans. Depends on Stories 2.30 and **2.37** — sequence after both.

Rationale: 2.31 was specified against the flat dialog that 2.36/2.37 replace.

### 4.3 PRD (`prd.md`)

**FR-4 — append after the 2026-08-28 amendment block:**
> Amended 2026-09-24 (Sprint Change Proposal, Stories 2.35/2.37): "One base-branch choice and one
> naming mode apply to the whole creation action" becomes "one *global* branch strategy (base +
> name) applies by default, and any member service may override it individually — create from its
> own base, or attach an existing local/remote branch, optionally renamed". The TUI flow still
> always gives every member a branch; the CLI keeps the original whole-action shape.

**§4 Safety — Data Loss — append:**
> Amended 2026-09-24 (Sprint Change Proposal, Story 2.38): single, consent-gated exception — when
> activating the *first* EDT (no outgoing EDT exists to stash against), if a checkout would
> overwrite uncommitted files, the tool pauses and lists them; the developer may retry after
> fixing by hand, or explicitly choose to overwrite after a second confirmation naming every file
> that will be discarded. Nothing is ever discarded without that explicit, file-listed consent;
> every other tool-triggered switch keeps the auto-preserve guarantee unchanged.

### 4.4 `deferred-work.md`

Story 2.9 entry "Creating a *second* (or later) EDT from the TUI is not wired" — append:
` **tracked_by:** Story 2.15 (entry point, shipped) + Story 2.38 (explicit activation choice; the
store's unconditional active-pointer write is removed there) — Sprint Change Proposal 2026-09-24.`

### 4.5 `sprint-status.yaml`

Add under `epic-2`, after `2-34-…`:
```yaml
  2-35-edt-creation-core-per-service-branch-plans-remote-branches: backlog
  2-36-edt-creation-wizard-shell-step-navigation-name-services-steps: backlog
  2-37-edt-creation-wizard-step-3-global-branch-strategy-per-service-overrides: backlog
  2-38-edt-creation-wizard-step-4-activation-switch-choice: backlog
```
plus a dated header comment line, same convention as previous proposals.

## 5. Implementation Handoff

**Scope classification: Moderate.** Four sequenced stories, one cross-epic merge, one PRD safety
amendment.

**Routed to:** Developer agent (`bmad-build`), one story branch per story off
`epic-2-edt-workspace-management` (CLAUDE.md git workflow).

**Sequencing:**
1. Finish/merge `fix-edt-switch-dirty-service-confirmation` into epic-2 (Story 2.38 depends on its
   confirm seam).
2. **2.35** (core) — independent, can start immediately.
3. **2.36** (shell + Steps 1–2) — independent of 2.35.
4. **Merge `epic-3-group-update-migrations` into epic-2** (resolve the 4 conflicts; docs conflicts
   keep both sides' entries) — before 2.37.
5. **2.37** (Step 3) — after 2.35, 2.36 and the merge.
6. **2.38** (Step 4) — after 2.35, 2.36 and sequencing step 1; can run in parallel with 2.37
   against the interim Step 3.
7. **2.31** (amended) — after 2.37.

**Artifacts updated by this proposal:** `epics.md` (2.35–2.38 inserted, 2.31 amended), `prd.md`
(FR-4 + Safety — Data Loss amendments), `deferred-work.md` (tracked_by), `sprint-status.yaml`.

**Left for implementation time:** `EXPERIENCE.md` (keybinding contract, UJ-1 steps 3–5,
`wizard-breadcrumb` / `branch-plan-table` patterns, stale `text-input` wording).

**Success criteria:** each story's ACs pass; `npm test` / `npm run typecheck` / `npm run depcheck`
green; CLI `edt create` e2e tests unchanged and passing; no `core → adapters` import (AD-1); no
TUI create path writes the active-EDT pointer except Step 4's explicit activation or the protected
switch; no uncommitted file is ever discarded without the file-listed second confirmation.

**Explicitly out of scope (Max's decisions this session):**
- CLI parity for per-service plans / activation (core only).
- Fetching remotes from the wizard — remote branches are read from local remote-tracking refs as
  they currently are.
