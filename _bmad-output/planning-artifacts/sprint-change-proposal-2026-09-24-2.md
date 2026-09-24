---
date: 2026-09-24
trigger: 'Max reviewed the current `edt switch` business logic and found it distinguishes only "member of the target EDT" vs "non-member", whereas the business model has three states (member of the outgoing EDT / member of another EDT / non-member). Dirty services in the last two states are silently stashed and re-applied on the wrong branch (or orphaned) instead of being surfaced to the developer with an explicit choice: adopt into the outgoing EDT, or discard.'
mode: batch
epic_impact: 'Epic 2 (in-progress) — three new stories appended (2.39-2.41), Story 2.38 (backlog) amended in place. PRD FR-6, FR-8 and the Safety — Data Loss bar amended. No new epic.'
scope_classification: moderate
---

# Sprint Change Proposal — 2026-09-24 (2)

## 1. Issue Summary

**Trigger — business-model correction on a shipped feature.** `switchActiveEdt`
(`src/core/edt/switch.ts`, Stories 2.4 + the `fix-edt-switch-dirty-service-confirmation` fix,
already merged into `epic-2-edt-workspace-management`) partitions every managed repo on a single
question — *"is it a member of the **target** EDT?"* (`targetMembersByPath`). The business model
has three states, decided by membership of the **outgoing** EDT:

1. **Member of the outgoing EDT** — its dirty work belongs to the context being left.
2. **Member of another EDT (not the outgoing one)** — including the *target* EDT itself.
3. **Non-member** of any EDT.

**Defects (evidence, all in `switch.ts`):**

| # | Case | What the code does | Consequence |
|---|---|---|---|
| D1 | Dirty repo that is a member of the **outgoing** EDT but **not** of the target | Falls into `switchNonMemberRepo` (lines 325-371): stash `tui-back:shared`, checkout `sharedBranch`, **pop immediately** | The outgoing EDT's WIP follows the repo onto the shared branch (pollution), and is never preserved for the return trip. |
| D2 | Dirty repo that is a member of the **target** but **not** of the outgoing EDT | `switchMemberRepo` (lines 281-323) stashes with `stashTagUlid` = the **outgoing** ulid, checks out the target branch, pops only the *target*-tagged stash | The stash is tagged for an EDT that does not own the repo, so switching back to the outgoing EDT never pops it (`switchNonMemberRepo` only pops `tui-back:shared`) — **orphaned stash**, invisible to `git status`. |
| D3 | Dirty repo in state 2 or 3 (non-member) | Stash + immediate pop onto `sharedBranch` (the fix in `26af642`); the TUI seam (`onDirtyReposBeforeSwitch`) is informative only: `proceed` / `cancel` | The developer is *told* but cannot *decide*: no way to keep the work with the outgoing EDT, no way to throw it away so the shared branch stays clean. |

Only the case "member of the outgoing **and** of the target" is handled exactly as the business
model wants (stash tagged with the outgoing ulid, popped on return).

**Decisions validated by Max (2026-09-24):**

- State 1: unchanged intent — dirty → stash tagged `tui-back:<outgoing ulid>`, no prompt, popped only when returning into the outgoing EDT.
- States 2 and 3, **dirty** → notify, and require a choice per service:
  - **Adopt** (solution 1): add the service to the outgoing EDT and stash its changes under the outgoing ulid. The branch for the new membership is **always chosen by the developer**: if the repo sits on a shared/protected branch a new branch must be created (name entered by the developer); if it sits on a non-shared branch the developer is still asked (keep it, or a new name).
  - **Discard** (solution 2): overwrite **everything, tracked and untracked**, so nothing pollutes the shared branch after checkout.
  - **Cancel**: abort, zero repo touched.
- Granularity: a **global** choice plus **per-service overrides**, mirroring Stories 2.35-2.38 (edt-create Step 3: global strategy + per-service table + override box).
- CLI: no dialog → a dirty state-2/3 service **fails by default** (fail-safe, zero repo touched), with explicit `--adopt-dirty` / `--discard-dirty` flags.

**Assumptions taken (flag to veto):**

- A1. A dialog is raised **only when a decision is required** (≥1 dirty state-2/3 repo); state-1 dirty repos are listed in it as read-only "will be stashed for <outgoing>" rows. A switch where only state-1 repos are dirty runs silently (auto-preserve, as FR-6 already says). This drops the informational-only dialog added by `43d4087` for that case.
- A2. With **no outgoing EDT** (very first switch, `state.json` empty) *adopt* is unavailable (nothing to adopt into): the choices are discard or cancel.
- A3. Discard = `git reset --hard` + `git clean -fd`. **Ignored files (`.gitignore`, e.g. `node_modules`) are kept** — "untracked" means what `git status` lists, not `clean -x`.
- A4. Adopt keeps the stash → checkout → later-pop symmetry: the branch is created from the repo's current HEAD (never checked out by the tool), so the stash re-applies cleanly onto it when the outgoing EDT is re-entered.

## 2. Impact Analysis

### Checklist summary

| Item | Status | Note |
|---|---|---|
| 1.1 Trigger | [x] | Business-model review by Max; D1/D2 are real defects, D3 a missing capability |
| 1.2 Problem type | [x] | Misunderstanding of business rules in a delivered story + new requirement |
| 1.3 Evidence | [x] | `switch.ts` line references above |
| 2.1 Current epic viable | [x] | Epic 2 absorbs it via appended stories |
| 2.2 Epic changes | [x] | 3 new stories, 1 amended (2.38) |
| 2.3 Other epics | [N/A] | Epic 3 has no dependency on switch semantics |
| 2.4 Obsolete/new epics | [N/A] | |
| 2.5 Reordering | [x] | 2.41 should land before 2.38 (see Story Impact) |
| 3.1 PRD | [!] | FR-6, FR-8, Safety — Data Loss amended (below) |
| 3.2 Architecture | [!] | One new destructive `GitPort` write outside the branch-scope gate model (AD-8) — consent-gated, documented below |
| 3.3 UX | [!] | New switch-resolution dialog pattern (left for implementation, same precedent as prior proposals) |
| 3.4 Other artifacts | [x] | `sprint-status.yaml`, `deferred-work.md`, CLI e2e expectations |
| 4.x Path | [x] | Direct Adjustment |

### Epic Impact

Epic 2 (`in-progress`, branch still open) absorbs **2.39–2.41** after 2.38 — same "appended
after the last story" precedent as 2.27–2.38. No `done` story is rolled back: 2.4's core
(lock peek, AD-8 re-verification, registry writes under lock, idempotency) and the confirm-seam
plumbing (`edt-slice.ts` `switchDirtyRepos` / `resolveSwitchDirtyRepos`, `switch-dialog.tsx`) are
extended, not replaced.

### Story Impact

| Story | Change |
|---|---|
| 2.39 (new) | Core: 3-state partition by outgoing membership; per-repo `DirtyResolution` (`adopt` / `discard`); `GitPort.discardAll`; removes the `tui-back:shared` tag + immediate pop; fixes D1/D2; fail-safe when a dirty state-2/3 repo has no resolution. |
| 2.40 (new) | CLI: fail-safe default + `--adopt-dirty [--adopt-branch <name>]` / `--discard-dirty`; e2e expectations. |
| 2.41 (new) | TUI: switch-resolution dialog (global strategy + per-service table + override box + irreversible-discard confirmation), replacing the informative-only confirm. |
| 2.38 (amended) | "Basculer immédiatement" reuses the 2.41 resolution dialog; info block wording updated. Sequence 2.41 **before** 2.38 (2.38's first-EDT activation path is unaffected). |

### Artifact Conflicts

- **PRD**
  - **FR-6** — gains the three-state evaluation and the "dirty repos that belong to no outgoing member are never silently moved" consequence.
  - **FR-8** — "uncommitted work in a non-member repo is preserved, not discarded" becomes "preserved (adopted into the outgoing EDT) *or* discarded only on explicit per-service consent".
  - **Safety — Data Loss** — second consent-gated exception (the first is Story 2.38's first-EDT overwrite). Amendments in §4.3.
  - FR-3, FR-5, FR-7, FR-9: unchanged (FR-7 is *exercised* by adopt: the chosen branch goes through the AD-8 gate).
- **Architecture** — additive only, no AD amended:
  - `core/ports/git.ts`: `discardAll(repoPath)` — `git reset --hard` + `git clean -fd`. It is the first `GitPort` write that is neither branch-scoped nor path-scoped, so AD-8's branch gate cannot apply; the guard is instead **structural**: the only caller is `switch.ts`, it runs only for a repo carrying an explicit `discard` resolution *and* still dirty at execution time, and never on a repo the tool could not first list (`listDirtyPaths`). Documented in the port's doc comment.
  - `EdtRegistryPort`: adopt needs "add member to an existing EDT" from inside the switch. Reuse the existing `modifyEdt` add-member path (`core/edt/modify.ts`) rather than a second writer; it already handles the registry lock (AD-9).
  - No SQLite schema, lock, or XDG change. `edt:<ulid>` lock-peek unchanged.
- **UX (`EXPERIENCE.md` / `DESIGN.md`)** — left for 2.41: a "switch-resolution" dialog reusing the 2.37 `branch-plan-table` + override-box patterns.
- **`deferred-work.md`** — new entry (see §4.6).
- **CLI contract** — `tui-back edt switch` becomes stricter: a dirty state-2/3 repo used to be auto-stashed-and-popped; it now fails with `switch-dirty-services-unresolved` unless a flag says otherwise. Intentional, documented, e2e updated (2.40).

### Technical Impact

- `OnDirtyReposBeforeSwitch` changes from `Promise<'proceed'|'cancel'>` to a resolver returning `{ kind: 'cancel' } | { kind: 'proceed'; resolutions: Record<repoPath, DirtyResolution> }`. Callers: `edt-slice.ts`, `subcommands.ts`, tests.
- `SwitchEdtRepoResult.outcome` widens to `switched | adopted | discarded | failed`; `detail` for `discarded` carries the discarded paths (audit + action log).
- **Interim behaviour between 2.39 and 2.41:** the TUI's slice keeps compiling by passing a resolver that cancels with an explanatory message when a state-2/3 repo is dirty — safe (zero writes), but a temporary usability regression. Implement 2.39 and 2.41 back to back.
- **Risk — TOCTOU.** The dirty preview and the execution are separated by user think-time. The core therefore **re-reads dirtiness at execution** and, before any git write, validates that every currently-dirty state-2/3 repo has a resolution; otherwise it returns `switch-dirty-services-unresolved` with zero writes. The same mechanism makes the CLI fail-safe by default.
- **Risk — adopt atomicity.** Order per repo: validate branch (AD-8 with the outgoing `edtId`) → stash (outgoing tag) → create branch → register member. A failure after the stash restores it (`restoreStash`) so no orphan is left; the row is `failed`.

## 3. Recommended Approach

**Direct Adjustment — viable, effort High (3 stories), risk Medium.**

- Additive to the switch's proven skeleton; D1/D2 are fixed by the partition change, not by patches.
- No rollback: nothing shipped is reverted.
- No MVP review: no scope cut — this deepens FR-6/FR-8's no-data-loss promise and makes the one destructive path explicit and consent-gated.

**Why Moderate, not Minor:** three interdependent stories, a PRD safety amendment, a new destructive git primitive, a CLI behaviour change, and a re-sequencing note on 2.38.

## 4. Detailed Change Proposals

### 4.1 `epics.md` — new stories (inserted after Story 2.38, before "## Epic 3")

### Story 2.39: EDT Switch Core — Three-State Partition & Dirty-Service Resolutions

> Added 2026-09-24 (Sprint Change Proposal): fixes `switch.ts` D1/D2 and replaces the informational dirty-repo seam with an authoritative per-service resolution. CLI wiring lands in 2.40, TUI dialog in 2.41.

As a developer, I want a switch to know exactly whose uncommitted work each repo holds, so that the outgoing EDT's work is preserved for its return, and work that belongs to no outgoing member is never silently moved — I decide what happens to it.

**Acceptance Criteria:**

**Given** a switch **When** repos are classified **Then** membership is evaluated against the **outgoing** EDT: *state 1* = member of the outgoing EDT; *state 2* = member of another EDT (including the target) but not the outgoing one; *state 3* = member of no EDT. The target's membership still decides the destination branch (its own registered branch if a target member, else the repo's manifest `sharedBranch`, fetched first if absent locally — FR-8).

**Given** a **state-1** repo that is dirty **When** switched **Then** it is stashed with `tui-back:<outgoing ulid>` **before** checkout, no resolution is needed, and it is popped only by a later switch **into** the outgoing EDT (that switch's `switchMemberRepo` pops the target-ulid-tagged stash, unchanged). A state-1 repo that is also a target member additionally pops its target-tagged stash after checkout (unchanged).

**Given** a **state-2 or state-3** repo that is dirty **When** switched **Then** it requires an entry in the caller-supplied `dirtyResolutions: Record<repoPath, DirtyResolution>` where `DirtyResolution = { kind: 'adopt'; branch: string } | { kind: 'discard' }`. The fixed `NON_MEMBER_STASH_TAG` and its unconditional post-checkout pop are **removed**; D1 and D2 no longer exist (a target-only dirty member is state 2 and goes through resolution, never through an outgoing-tagged stash).

**Given** the pre-flight **When** the switch starts **Then**, before any git write, dirtiness of every registered repo is re-read (`hasUncommittedChanges`); if any dirty state-2/3 repo has no resolution, the switch returns `switch-dirty-services-unresolved` whose `details` lists `{service, repoPath, scope: 'member-of-other-edt' | 'non-member', currentBranch}` per repo, with **zero repos touched** and `state.json`/`edts.yaml` untouched.

**Given** the `onDirtyReposBeforeSwitch` seam **When** at least one state-2/3 repo is dirty **Then** it is invoked once with every dirty repo (state-1 rows flagged `resolution: 'auto-stash'` as read-only information; state-2/3 rows carrying their scope, current branch, whether that branch is shared, and the owning EDT topic(s) when state 2) and returns `{ kind: 'cancel' }` (→ `switch-cancelled-by-user`, zero writes) or `{ kind: 'proceed', resolutions }`. When only state-1 repos are dirty the seam is **not** invoked. Explicit `dirtyResolutions` in params take precedence and skip the seam (CLI path).

**Given** an `adopt` resolution **When** executed **Then**, in order: (1) `git.assertAllowedBranch(repo, branch, outgoing.ulid)` — a shared/protected name or a branch claimed by another EDT for this repo is rejected before any write (FR-7, AD-8); (2) `stashSave` with `tui-back:<outgoing ulid>`; (3) if `branch` differs from the repo's current branch, `createBranch(repo, branch, <current HEAD branch>)` — never checked out; if it equals the current branch it must itself pass step 1 (i.e. not shared); (4) the repo is added to the outgoing EDT with `branch` as its registered branch (existing `modifyEdt` add-member path, under the edts.yaml lock); (5) checkout to the destination branch. A failure at any step after the stash restores the stash and reports `failed` — never an orphaned stash. Outcome `adopted`.

**Given** a `discard` resolution **When** executed **Then** the repo must still be dirty at that instant, its dirty paths are captured via `git.listDirtyPaths` (untracked expanded to files), `git.discardAll(repo)` runs, then checkout to the destination branch. Outcome `discarded`, with `detail.discardedPaths` carrying the captured list. Ignored files are never touched.

**Given** no outgoing EDT (first switch) **When** a state-2/3 repo is dirty **Then** an `adopt` resolution is rejected (`switch-adopt-without-outgoing`); only `discard` or cancel apply.

**Given** the new `GitPort.discardAll(repoPath)` **When** implemented **Then** it runs `git reset --hard` then `git clean -fd` (never `-x`, never `-ff`), returns `git-discard-error` on failure, and its port doc comment records that it is the one consent-gated destructive primitive whose only permitted caller is `switch.ts` under an explicit `discard` resolution.

**Given** a discard/adopt failure on one repo **When** reported **Then** it is a `failed` row for that repo; the others proceed (per-repo isolation unchanged). Idempotency, lock-peek/`--force`, AD-8 member re-verification and the final `state.json`/`edts.yaml` writes are unchanged.

**Given** the TUI slice **When** this story lands **Then** its seam implementation compiles against the new signature and, for a dirty state-2/3 repo, returns `cancel` with an explanatory message (interim, safe; replaced by 2.41).

**Implementation notes:** classification is a pure helper `classifySwitchRepos(registered, outgoing, target, allEdts)` unit-tested directly; `switchMemberRepo`/`switchNonMemberRepo` keep their names but take the resolved state + resolution. Unit tests use fake ports (AD-13); `discardAll` gets a real-git integration test (tracked-modified, untracked file, untracked dir, ignored file survives). Existing `switch.test.ts` cases that assert the `tui-back:shared` round-trip are rewritten, not patched.

### Story 2.40: `edt switch` CLI — Fail-Safe Dirty Handling & Explicit Flags

> Added 2026-09-24 (Sprint Change Proposal): CLI side of the 2.39 model. No dialog exists on this path.

As a developer scripting or hand-running `tui-back edt switch`, I want a dirty service that belongs to no outgoing member to stop the switch unless I said what to do with it, so that no script ever silently moves or destroys work.

**Acceptance Criteria:**

**Given** `tui-back edt switch --to <topic>` **When** a state-2/3 repo is dirty and no dirty flag is passed **Then** the command fails with `switch-dirty-services-unresolved` (exit 1, AD-3 envelope; `details` lists each service, scope and current branch) and touches nothing.

**Given** `--discard-dirty` **When** passed **Then** every dirty state-2/3 repo is resolved as `discard` (2.39), and the JSON result lists each discarded path under that service's `detail.discardedPaths` (audit trail); the flag is the explicit consent — no interactive prompt on this path.

**Given** `--adopt-dirty --adopt-branch <name>` **When** passed **Then** every dirty state-2/3 repo currently on a **shared** branch is adopted onto a new branch `<name>`, and every one on a **non-shared** branch is adopted keeping its current branch; a name rejected by the AD-8 gate or already existing in that repo fails that repo's row (`failed`), others proceed. `--adopt-dirty` without `--adopt-branch` while any such repo sits on a shared branch fails up front with `missing-argument` (zero writes).

**Given** `--adopt-dirty` and `--discard-dirty` **When** both passed **Then** `invalid-argument`, zero writes. With no outgoing EDT, `--adopt-dirty` fails with `switch-adopt-without-outgoing`.

**Given** the help text and `docs` for `edt switch` **When** updated **Then** both flags and the fail-safe default are documented, including that the previous silent stash-and-restore for these repos no longer happens.

**Given** `tui-back.e2e.test.ts` **When** run **Then** its `edt switch` expectations are updated (dirty non-member → `switch-dirty-services-unresolved`; both flags exercised black-box in the non-TTY JSON branch).

**Implementation notes:** `subcommands.ts:436` stops passing `onDirtyReposBeforeSwitch: undefined` and instead builds `dirtyResolutions` lazily: the flags produce a *policy* (`adopt(name)` | `discard`) that is turned into per-repo resolutions **after** the core's pre-flight classification (the CLI does not classify repos itself). Simplest shape: core accepts `dirtyPolicy?: { kind: 'adopt'; branch: string } | { kind: 'discard' }` as sugar that expands to resolutions per dirty state-2/3 repo (adopt: current branch kept when non-shared).

### Story 2.41: EDT Switch Resolution Dialog — Global Strategy, Per-Service Overrides & Discard Confirmation

> Added 2026-09-24 (Sprint Change Proposal): TUI side of the 2.39 model; mirrors the edt-create Step 3 pattern (Stories 2.35-2.37). Replaces the informative-only confirm added by `43d4087`.

As a developer switching EDT with uncommitted work in services that don't belong to the EDT I'm leaving, I want to see exactly which services are affected and decide once for all of them — or service by service — whether to keep that work with my current EDT or throw it away, so that nothing is lost by accident and nothing pollutes the shared branches.

**Acceptance Criteria:**

**Prerequisite (blocking) — Given** the story starts **When** the developer begins **Then** confirm Story 2.39 is `done` in `sprint-status.yaml` and merged into the epic branch (`dirtyResolutions`, `discardAll`, resolver-shaped seam present), and that Story 2.37's reusable table/override-box components exist on the epic branch (`branch-plan-table`); otherwise **HALT** — never re-implement either here.

**Given** a switch with ≥1 dirty state-2/3 repo **When** the seam fires **Then** the SWITCH EDT dialog shows a two-panel resolution view — **A "STRATÉGIE GLOBALE"** (focused by default) and **B "SERVICES CONCERNÉS"** — with a footer `[Tab] Changer de zone • [Entrée] Configurer la ligne • [Ctrl+N] Confirmer • [Esc] Annuler le switch`; an intro states which EDT is being left and that state-1 services are handled automatically.

**Given** Panel A **When** navigated **Then** it has a line "Action par défaut" toggling `(•) Adopter dans <outgoing topic>  ( ) Écraser` (`Space`/`←→`) and, when *Adopter*, a line "Nom global de la branche" (a `TextInputLine`, pre-filled with the slug of the outgoing EDT's topic via `suggestBranchNameFromTopic`, touched-flag convention of Story 2.22) applied to every row on a **shared** branch. With no outgoing EDT only *Écraser* is offered, with an explanation.

**Given** Panel B **When** rendered **Then** it is a height-bounded table (NFR-7) `Service | Portée | Branche actuelle | Action | Branche cible`, one row per dirty state-2/3 service (`Portée` = "membre de <topic>" or "hors EDT"); state-1 dirty services appear below as read-only dim rows "sera mis de côté pour <outgoing> (restauré au retour)"; modes per row: `[Adopter (Global)]`, `[Adopter (Perso)]`, `[Écraser]`; `↑/↓` move, `Enter` opens the override box.

**Given** the override box "Configurer <service>" **When** open **Then** it offers `Action : (•) Adopter ( ) Écraser`; for *Adopter*, "Branche" is a `TextInputLine` — **always editable and pre-filled** (global name when the repo is on a shared branch, its current branch name otherwise) — validated live inline: a shared/protected name is rejected (FR-7), a name that already exists locally in that repo is rejected, an empty name is rejected; `Enter` on `[ Appliquer ]` sets the row to `[Adopter (Perso)]` or `[Écraser]`; `Ctrl+R` returns the row to the global strategy.

**Given** `Ctrl+N` **When** every row is valid **Then**: if no row is `[Écraser]` the switch proceeds with the resolutions; if any row is `[Écraser]` a **second confirmation** first lists, per service, every file that will be destroyed (tracked modifications and untracked files, from `listDirtyPaths`), states that the action is irreversible and that ignored files are kept, and requires an explicit confirmation key (default action is *Retour*); `Esc` there returns to the table. Invalid rows block `Ctrl+N` with the inline error.

**Given** `Esc` on the main view **When** pressed **Then** the switch is cancelled (`switch-cancelled-by-user`), nothing touched, and a message says so.

**Given** the switch completes **When** results return **Then** `adopted` / `discarded` / `switched` / `failed` rows are shown via the existing structured result display (`FailedResultList` for failures), and the action-log entry (written to the **new active** EDT's database) records adopted branches and discarded paths.

**Given** the `edt-*` auto-switch-tab command path (Story 670bfcb) and the quick-pick (Story 2.30) **When** they trigger a switch **Then** they go through the same seam, unchanged.

**Implementation notes:** `edt-slice.ts` already parks the core call on a pending promise (`switchDirtyRepos` + `resolveSwitchDirtyRepos`); widen the resolver payload to the `{kind, resolutions}` shape and hold the dialog's draft state in the slice or dialog, not in core. Pure helpers in a new `switch-resolution.logic.ts`: `buildRows(dirty, global)`, `validateRow(row, branchesByService)`, `buildResolutions(rows)`. Per-service branch lists come from `listMemberBranches`.

### 4.2 `epics.md` — Story 2.38 amended in place

**Section:** Story header note and the "Basculer immédiatement" ACs.

OLD:
```
Relies on the switch dirty-repo confirm seam (branch `fix-edt-switch-dirty-service-confirmation`), which must be merged into epic-2 first.
...
**Given** "Basculer immédiatement" **When** confirmed **Then** `createEdt` runs, then the existing protected switch (`switchEdt`, including the dirty-repo confirm seam) runs to the new EDT — never a direct `writeActiveEdt`.
```

NEW:
```
Relies on the switch resolution dialog of Story 2.41 (which supersedes the confirm seam of branch `fix-edt-switch-dirty-service-confirmation`); Stories 2.39 and 2.41 must be merged into epic-2 first.
...
**Given** "Basculer immédiatement" **When** confirmed **Then** `createEdt` runs, then the existing protected switch (`switchActiveEdt`, including the Story 2.41 dirty-service resolution dialog) runs to the new EDT — never a direct `writeActiveEdt`.
```

Also in the info-block AC: "uncommitted work in the outgoing EDT is auto-preserved (stash)" → "uncommitted work in the outgoing EDT's services is auto-preserved (stash); uncommitted work in any other service is listed and you choose to adopt it into the outgoing EDT or discard it".

Rationale: 2.38's "switch" path must not bypass or duplicate the new decision point; the first-EDT activation path (no outgoing EDT, its own overwrite panel) is unchanged.

### 4.3 PRD amendments (`prd.md`)

**FR-6** — add consequences:

```
- On switch, every managed repo is classified against the *outgoing* EDT: (1) a member of the outgoing EDT has its uncommitted work auto-preserved (tagged to that EDT, restored when it is re-entered); (2) a member of another EDT, or (3) a non-member, that holds uncommitted work is never silently moved: the developer is told which services are affected and chooses, per service, to adopt the work into the outgoing EDT (on a branch of their choosing) or to discard it — or cancels the switch with nothing touched.

> Amended 2026-09-24 (Sprint Change Proposal, Stories 2.39-2.41): three-state evaluation added; previously only membership of the target EDT was considered.
```

**FR-8** — replace "This switch follows the same no-data-loss guarantee as FR-6 — uncommitted work in a non-member repo is preserved, not discarded." with:

```
- This switch follows the same no-data-loss rule as FR-6: uncommitted work in a non-member repo is either adopted into the outgoing EDT (preserved) or discarded **only on explicit per-service consent** — never silently moved onto `development`.

> Amended 2026-09-24 (Sprint Change Proposal, Stories 2.39-2.41).
```

**Safety — Data Loss** — append after the existing Story 2.38 amendment:

```
> Amended 2026-09-24 (Sprint Change Proposal, Stories 2.39-2.41): second consent-gated exception —
> on an EDT switch, a dirty service that is not a member of the outgoing EDT may be **discarded**
> (tracked changes and untracked files; ignored files kept) if the developer explicitly chooses so
> for that service, after a confirmation naming every affected file (TUI), or by passing
> `--discard-dirty` (CLI, which otherwise refuses to proceed). The alternative — adopting the work
> into the outgoing EDT — preserves it. Members of the outgoing EDT keep the unconditional
> auto-preserve guarantee. Nothing is ever discarded without that explicit, per-service consent.
```

### 4.4 Architecture (`ARCHITECTURE-SPINE.md`)

No AD amended. One sentence added to the AD-8 section: "`GitPort.discardAll` is the single destructive, non-branch-scoped write; it is guarded structurally (explicit per-repo `discard` resolution, still-dirty re-check, sole caller `switch.ts`) rather than by the branch-scope gate."

### 4.5 `sprint-status.yaml`

```
2-39-edt-switch-core-three-state-partition-dirty-service-resolutions: backlog
2-40-edt-switch-cli-fail-safe-dirty-handling-explicit-flags: backlog
2-41-edt-switch-resolution-dialog-global-strategy-per-service-overrides-discard-confirmation: backlog
```
plus a header comment line dated 2026-09-24 pointing at this proposal, and a note that 2-38 now sequences after 2-41.

### 4.6 `deferred-work.md` — new entry

```
- source_spec: sprint-change-proposal-2026-09-24-2.md
  summary: Removing a member from an EDT (Story 2.24 modify / 2.29 delete) while a stash tagged `tui-back:<that ulid>` is still pending for that repo leaves the stash orphaned — nothing pops it once the repo is no longer a member of that EDT.
  evidence: state-1 stashes (Story 2.39) and adopt stashes are popped only by a switch into the owning EDT where the repo is still a member (`switchMemberRepo`). Not introduced by this change (same gap exists today for member stashes) but made more reachable by adopt. **Track:** on member removal / EDT delete, either warn about a pending tagged stash (`git.hasStash`) or offer to restore/drop it.
```

### Recommended sequencing

`2.35 → 2.36 → 2.37 → 2.39 → 2.41 → 2.38`, with `2.40` after `2.39` at any point. 2.39 and 2.41 back to back (see Technical Impact).

## 5. Implementation Handoff

**Scope: Moderate.** Backlog reorganisation (3 stories added, 2.38 re-sequenced) plus a PRD safety amendment.

- **Product Owner / Developer agents:** apply §4.1–§4.6 to `epics.md`, `prd.md`, `ARCHITECTURE-SPINE.md`, `sprint-status.yaml`, `deferred-work.md`; commit as `docs(epic-2): sprint change proposal 2026-09-24 (2) — edt switch three-state model (stories 2.39-2.41)`.
- **Developer agent (`bmad-build`):** implement 2.39 → 2.41 → (2.40) → 2.38, one branch per story from `epic-2-edt-workspace-management`, atomic Conventional Commits with the story number in the subject, `--no-ff` merge into the epic branch (CLAUDE.md).

**Success criteria:**

1. Dirty work in an outgoing-EDT member is never popped onto a shared branch and is restored on return to that EDT (D1 gone).
2. No `git stash list` entry is ever left tagged for an EDT that does not own the repo (D2 gone); no `tui-back:shared` stash is ever created.
3. A switch with a dirty state-2/3 repo never proceeds without an explicit per-service resolution (TUI) or flag (CLI); the fail-safe path writes nothing.
4. Discard removes tracked and untracked changes, keeps ignored files, lists exactly what it removed, and only ever runs after an explicit consent.
5. `npm test && npm run typecheck && npm run depcheck` green; `switch.test.ts`, `edt-slice.test.ts`, `edts-zone.interaction.test.tsx`, `tui-back.e2e.test.ts` updated accordingly.
