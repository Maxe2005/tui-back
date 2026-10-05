# Sprint Change Proposal — 2026-10-05

**Project:** tui-back
<<<<<<< HEAD
**Author:** Max (via epic-4 re-discussion)
**Mode:** Interactive
=======
**Author:** Max (via bmad-correct-course)
**Mode:** Incremental (C1, C2, C3 each approved individually)
>>>>>>> epic-7-tui-consistency-dashboard-code-hygiene
**Status:** Approved by Max on 2026-10-05 — artifacts updated

---

## 1. Issue Summary

<<<<<<< HEAD
Epic 4 (`shared-types` Propagation) was written before Epics 2, 3, 5, 6 and the 2026-10-01 change proposal existed. Re-reading it against the code now in place and Max's actual business workflow (2026-10-05) shows its shape is wrong:

| # | Finding | Category |
|---|---------|----------|
| F1 | The epic is built around **publish** and a **git-ancestry "behind/on-latest" status**. The real workflow is: *enter a version number → rewrite the dependency line in each receiving service → optionally install/clean-restart → optionally commit (never push)*. | Misunderstood requirement |
| F2 | The big value is a **smart group update**: when an update includes `shared-types`, process it first, publish a new version, propagate it, commit, then let every other service's merge auto-resolve conflicts that touch only the `shared-types` line. This is not in the epic at all. | New requirement |
| F3 | Git-ancestry resolution (amended 2026-08-24, flagged as an open architecture question) is no longer needed for the main flow. It survives only as a **niche drift view**, computed by comparing declared versions in `package.json` files. | Simplification |
| F4 | `shared-types-source` / `shared-types-consumer` are referenced by Story 2.13's tab gating but **do not exist in the module registry** (`module-registry.ts` only knows `route-explorer`), and their parameters were never defined. | Missing design |
| F5 | `shared-types` is a library with no container. It cannot be registered until Story 7.2 (container-less services) lands. | Dependency |
| F6 | The smart update extends Epic 3's group update (3.1), config dialog (3.7), clean-restart recipe (3.8) and conflict assistance (3.4). Epic 3 is **not yet merged into `devlopment`**. | Dependency |

**Decisions taken by Max (2026-10-05):**

1. Story 7.2 and the rest of Epic 7 (layout contract 7.3, interaction audit 7.4) are finished **before** Epic 4 starts; the zone is built on those contracts.
2. `npm run v` pushes the `shared-types` repo itself; "never push" applies to the **propagation commits in consumer services**.
3. After publication, the new version is read from `shared-types`'s `package.json` and **verified on the npm registry**.
4. Manual version input is a text field pre-filled with `0.1.` and always editable; the version's **existence is verified before execution**.
5. Propagation commits stage **only `package.json` and `package-lock.json`**, never anything else. A consumer on a protected/shared branch goes through the existing git safety gate (AD-8).
6. Conflict auto-resolution proceeds **only if the sole conflicting hunk in `package.json` is the `shared-types` dependency line**; otherwise the user resolves.
7. "Install (`npm i`)" and "clean restart" are **not mutually exclusive**; commit happens after them if they are chosen.
8. The zone keeps a **Publish** button which may or may not chain into propagation.
9. A consumer whose `package.json`/`package-lock.json` is already modified is skipped with a reason; other dirty files do not block it and are never staged.
=======
Three changes from day-to-day use after Story 7.2 (container-less services) landed on its unmerged story branch. C1 was approved for grafting onto Story 7.2 before its epic merge; C2 and C3 become new Epic 7 stories.

| # | Change | Category |
|---|--------|----------|
| C1 | **Logs third group + scoped Ctrl+A + always-visible health + explicit restarting.** Container-less services get an info-only "services without container" section (all registry services, greyed, unselectable, Tab-excluded); Ctrl+A toggles the focused list; health badges render on every row; the `restarting` state is made explicit. | New requirement (grows FR-29), grafted to 7.2 |
| C2 | **Per-service last-run detail in Update (session-only).** Merge vs already-up-to-date (+N/−M lines, F files), migrations ran vs none (+command/output excerpt), kept in memory and replaced by the next run. | New requirement (FR-30) |
| C3 | **Shared focus-navigation component.** Shift+Tab reverses Tab everywhere; each zone declares its mode (H/V arrows, Tab/Shift+Tab, Ctrl+N/P) through one primitive instead of hand-rolled handlers. Runs before 7.4 so alignment consumes it. | UX debt + new requirement |

**Evidence gathered (2026-10-05):**

- **C1:** `logs-zone.tsx:559` handles Ctrl+A only in the `edt-list` focus branch (`other-list` has none); only two lists exist (`logsEdtSelected`/`logsOtherSelected`); health badges render at the cursor/pane level, not per unselected row. Ctrl+A/Ctrl+Shift+A are indistinguishable on virtually every terminal (`logs-zone.logic.ts:291`), while Shift+Tab (`ESC[Z`) is distinguishable.
- **C2:** `GitPort.mergeBranch` returns `Result<void>` (`core/ports/git.ts:82`) — no merge stats exist; already-up-to-date is detectable via HEAD comparison without output parsing, but +/−/files need a new port method. `MigrationPort.run` returns `{output}` for a single per-service command — a generic per-file migration count does not exist (approved scope: ran/skipped + command + excerpt). Session-only approved, so 7.5's persisted datum is untouched.
- **C3:** `shared/keys/tab-navigation.ts` covers only Ctrl+→/Ctrl+N sub-tab stepping; every zone hand-rolls Tab focus handling. Overlaps 7.4 (consistency audit) — sequenced before its alignment phase.
>>>>>>> epic-7-tui-consistency-dashboard-code-hygiene

---

## 2. Impact Analysis

<<<<<<< HEAD
### 2.1 Epic impact

- **Epic 4:** rewritten (see §4.4). Old 4.1/4.2/4.3 are replaced by 4.1–4.6.
- **Epic 3:** unchanged, but Stories 4.4 and 4.5 hook into its code. Epic 3 must be merged into `devlopment` (by PR, per CLAUDE.md) before those two stories start.
- **Epic 7:** prerequisite (7.2, 7.3, 7.4) — no change.
- **Epics 5, 6:** unaffected.

### 2.2 Artifact conflicts

| Artifact | Change |
|----------|--------|
| PRD | FR-13 amended, FR-14 demoted to optional/niche, FR-15 amended, **new FR-30** (smart update), **new FR-31** (st-only conflict auto-resolution) |
| Architecture | AD-4: document `shared-types-source` / `shared-types-consumer` parameters. AD-5: register both modules. **New AD-18** records the port and declared-version model. Git-ancestry mechanism no longer required |
| UX | UX-DR24 rewritten (version-entry form, consumer checklist, options step, per-service result, publish progress, drift view). UX-DR21 (Update config dialog) gains a `shared-types` strategy row |
| `epics.md` / `sprint-status.yaml` | Epic 4 section and FR mapping rewritten; story keys replaced |

### 2.3 Technical impact

- New port in `core/ports` (e.g. `shared-types.ts`) and adapter under `adapters/driven/modules/shared-types/`, registered in `moduleRegistry`. `ModuleImplementation` is currently route-explorer-shaped (`scanner`, `auth`) and needs to become a discriminated union.
- Manifest module parameters (validated, kebab-case ids):
  - `shared-types-source`: `publishCommand` (default `npm run v`), `packageName` (default `@ianord/shared-types`).
  - `shared-types-consumer`: `dependency` (default `@ianord/shared-types`), `packageJsonPath` (default `package.json`).
- Editing the dependency line must be a targeted text edit preserving formatting, not a JSON re-serialisation.
- The update flow gains a "shared-types first" pre-phase and a post-merge conflict hook; both reuse the detect → auto-fix-known-safe → re-verify mechanic of Story 3.4.
=======
### 2.1 Checklist results

| Item | Status | Notes |
|------|--------|-------|
| 1.1 Triggering story | [x] | Story 7.2 (container-less state exists, Logs presentation missing) + Update/UX gaps |
| 1.2 Core problem | [x] | See table above; all three are new requirements / UX debt, no story failure |
| 1.3 Evidence | [x] | Code anchors above |
| 2.1 Current epic | [x] | Epic 7 completes as planned + 2 stories; 7.2 reopens briefly |
| 2.2 Epic-level changes | [x] | No new epic; 7.2 amended, stories 7.7 + 7.8 added |
| 2.3 Remaining epics | [x] | Epics 2–6 unaffected; 7.3 notes Logs third-list compat (no rework) |
| 2.4 Obsolete/new epics | [x] | None obsoleted; none created |
| 2.5 Ordering | [x] | 7.2-graft → 7.8 (parallel OK) → 7.3 → 7.7 → 7.4 → 7.5/7.6 |
| 3.1 PRD | [!] | FR-29 amended; new FR-30 (C2) + FR-31 (C3) |
| 3.2 Architecture | [!] | GitPort extended (C2, AD-16); shared nav primitive (C3, 7.3-adjacent) |
| 3.3 UX | [!] | UX-DR22, UX-DR21 amended; UX-DR36 amended + nav contract |
| 3.4 Other artifacts | [!] | `sprint-status.yaml`; story-7.2 epic merge delayed |
| 4.1 Direct adjustment | Viable | Effort M/M/M–H; risk Low–Medium/Medium/Medium |
| 4.2 Rollback | Not viable | Nothing to revert |
| 4.3 MVP review | Not needed | Additive; MVP intact |
| 4.4 Path | [x] | **Direct Adjustment** (Option 1) |

### 2.2 Epic impact

- **Epic 7 (in-progress):** Story 7.2 reopens (`done` → `in-progress`, graft commits on `story-7-2-…`, epic merge delayed). New **Story 7.7** (shared navigation, before 7.4) and **Story 7.8** (Update last-run detail, parallelizable). 7.4's inventory is unchanged; its alignment phase adopts 7.7's primitive. 7.5 unchanged (C2 is session-only by explicit decision).

### 2.3 Artifact conflicts

| Artifact | Section | Change |
|----------|---------|--------|
| PRD | FR-29 | +1 consequence (C1: info-only third group, scoped Ctrl+A, always-visible health, explicit restarting) |
| PRD | §new | **FR-30**: per-service last-run merge/migration detail, session-only |
| PRD | §new | **FR-31**: Shift+Tab reverses Tab everywhere; one configurable focus-navigation primitive |
| Architecture | AD-16/GitPort | New method (e.g. `diffStat`) for merge +/−/files; HEAD comparison for up-to-date detection |
| Architecture | TUI shared | Nav primitive contract + interface note with 7.3's layout contract |
| EXPERIENCE.md | State Patterns › Logs | Third-group row (greyed, unselectable, Tab-excluded) |
| EXPERIENCE.md | State Patterns › Update | Last-run detail rows (merged/up-to-date, migrations ran/none) |
| EXPERIENCE.md | Interaction Primitives | Shift+Tab rule + nav-component contract (UX-DR36 amendment) |
| epics.md | Epic 7 | 7.2 ACs appended; stories 7.7, 7.8; ordering note |
| sprint-status.yaml | — | 7.2 → `in-progress`; `7-7-shared-focus-navigation: backlog`; `7-8-update-per-service-last-run-detail: backlog` |

### 2.4 Technical impact

- **C1** touches the Logs zone lists, slice selection actions, and badge rendering — the same files 7.3 will migrate to the layout contract; graft now so 7.3 migrates once.
- **C2** changes a core port shape (`GitPort` + driven impl + fakes) and enriches `GroupUpdateRepoResult` details; the Update detail pane renders them from the in-memory last run.
- **C3** touches every zone's input handling; Ink receives Shift+Tab distinctly (`ESC[Z`), so no terminal-protocol risk.
>>>>>>> epic-7-tui-consistency-dashboard-code-hygiene

---

## 3. Recommended Approach

<<<<<<< HEAD
**Direct adjustment** of Epic 4 (no rollback, no MVP change). Effort: medium–high (six stories). Risk: medium, concentrated in Story 4.5 (merge-conflict automation) and the Epic 3 dependency.

Suggested order: 4.1 → 4.2 → 4.3 → 4.4 → 4.5 → 4.6. Stories 4.1–4.3 can start as soon as Epic 7 is done; 4.4 and 4.5 additionally need Epic 3 on `devlopment`.
=======
**Direct Adjustment.** Amend one story, add two stories. No rollback, no MVP change.

**Sequencing:**

```
7.2-graft (C1: third group, scoped Ctrl+A, health everywhere, restarting) — first, delays epic merge
7.8 (C2: last-run detail) — parallelizable with the graft (core vs TUI-Logs, minimal overlap)
7.3 (layout contract — must compose with the Logs third list)
7.7 (C3: shared navigation component)
7.4 (audit unchanged; alignment adopts 7.7)
7.5 / 7.6 (unchanged)
```

**Effort and risk:**

| Story | Effort | Risk |
|-------|--------|------|
| 7.2-graft (C1) | M | Low–Medium |
| 7.8 (C2) | M | Medium (port shape) |
| 7.7 (C3) | M–H | Medium (all zones' input) |

**Git:**

- Graft commits land on `story-7-2-container-less-managed-services` (still unmerged — no new branch).
- 7.7 and 7.8 each get their own `story-7-N-…` branch from `epic-7-tui-consistency-dashboard-code-hygiene` after the 7.2 merge.
- `sprint-status.yaml`: 7.2 back to `in-progress` on approval; new backlog entries for 7.7/7.8.
>>>>>>> epic-7-tui-consistency-dashboard-code-hygiene

---

## 4. Detailed Change Proposals

### 4.1 PRD

<<<<<<< HEAD
- **FR-13 (amended 2026-10-05):** A developer can publish a new `shared-types` version through the tool (runs the source repo's publish command, default `npm run v`; per-step progress, resume from the failed step, publication verified on the registry), gated on the active EDT including the `shared-types-source` repo; publication may optionally chain into propagation.
- **FR-14 (amended 2026-10-05, priority: niche):** The tool shows, per consumer service of the active EDT, the `shared-types` version declared in its `package.json` compared with the version declared by the `shared-types` repo on the EDT's branch. No git-ancestry resolution.
- **FR-15 (amended 2026-10-05):** A developer enters a version; the tool rewrites the dependency line in every selected consumer service's `package.json`, then optionally runs `npm i` and/or a clean restart, and optionally commits (only `package.json`/`package-lock.json`) with a message identifying the tool. It never pushes consumer commits.
- **FR-30 (new):** Smart group update — when an update covers `shared-types`, it is processed first; after its merge (always, or only if the merge changed something — configurable) a new version is published, propagated to the EDT's consumers and committed, before the remaining services are updated.
- **FR-31 (new):** When a consumer's merge conflicts only on the `shared-types` dependency line of `package.json` (and the resulting lockfile), the tool resolves it automatically in favour of the EDT's current value, runs `npm i`, stages `package-lock.json` if it changed and completes the merge; any other conflict is left to the user.

### 4.2 Architecture

- AD-4: manifest module parameters as listed in §2.3.
- AD-5: `shared-types-source` and `shared-types-consumer` registered; `ModuleImplementation` becomes a discriminated union on `kind`.
- Remove the "mechanism to be specified by `bmad-architecture`" note on Story 4.2.

### 4.3 UX

- UX-DR24 rewritten around: no-members / disabled states (unchanged from 2.13), version-entry field (`0.1.` prefix), consumer `checkbox-list-item` list, options step (`npm i`, clean restart, commit — independent toggles), per-service result with independent retry, publish progress with spinner and resume, quit-mid-run confirmation, drift view.
- UX-DR21 (Update configuration): add a `shared-types` row — *off / publish if the merge changed something / always publish* — shown only when the EDT contains the source repo.

### 4.4 Epics (`epics.md`) — replacement for the Epic 4 section

**Epic 4: `shared-types` Propagation & Smart Update**
A developer can propagate a `shared-types` version to the active EDT's consuming services, publish new versions, and let a group update handle `shared-types` automatically — publish, propagate, commit and conflict resolution — so that bumping the dependency is never a manual task.
**FRs covered:** FR-13, FR-14, FR-15, FR-30, FR-31
**Prerequisites:** Epic 7 done (7.2 container-less services, 7.3 layout, 7.4 interaction audit); Epic 3 merged into `devlopment` for 4.4/4.5.

#### Story 4.1: `shared-types` Modules & Manifest Parameters
As a developer, I want the manifest to declare which repo is the `shared-types` source and which services consume it, so that the tool knows where to publish from and where to rewrite the dependency.
- **Given** a manifest declaring `shared-types-source` or `shared-types-consumer` **When** loaded **Then** the module ids are known to the registry and their parameters validated with defaults (§2.3); unknown parameters are rejected with a clear message.
- **Given** the Story 2.13 tab gating **When** the modules exist **Then** the `shared-types` tab shows/omits/disables as specified there, with the source/consumer carrying services named.
- **Given** a source repo without a container (Story 7.2) **When** registered **Then** it is accepted as an EDT member.
- A `shared-types` port + adapter exist with read-version, write-version-line and verify-published operations, fully unit-tested against a fake filesystem/registry.

#### Story 4.2: Propagate a Version to Chosen Services
As a developer, I want to enter a `shared-types` version and apply it to some or all consuming services of my active EDT, so that I never edit each `package.json` by hand.
- **Given** the zone **When** opened **Then** a version field is pre-filled with `0.1.` and fully editable, followed by the consumer checklist (all consumers of the active EDT, `checkbox-list-item`).
- **Given** a version **When** the developer confirms **Then** its existence on the registry is verified first; a non-existent version blocks execution with an explicit message.
- **Given** selected consumers **When** propagation runs **Then** only the dependency line in each `package.json` is rewritten, preserving all other formatting.
- **Given** the options step **When** shown **Then** `npm i`, clean restart (via the manifest recipe, Story 3.8) and commit are independent toggles; clean restart and `npm i` may both be on; commit happens after them.
- **Given** commit is chosen **When** it runs **Then** only `package.json` and `package-lock.json` are staged, the message states the tool performed it (e.g. `chore(deps): bump @ianord/shared-types to 0.1.3674 [tui-back]`), and **nothing is ever pushed**.
- **Given** a consumer on a protected or shared branch **When** targeted **Then** the AD-8 safety gate applies as elsewhere.
- **Given** a consumer whose `package.json` is already dirty **When** targeted **Then** it is skipped with an explicit reason (other dirty files do not block, and are never staged).
- **Given** one service fails **When** it happens **Then** it is independently retriable and does not block the others.
- **Given** a run is in progress **When** `q` is pressed **Then** confirmation is required.

#### Story 4.3: Publish a New `shared-types` Version
As a developer, I want to publish `shared-types` from the tool and optionally propagate straight away, so that I don't run the release script by hand or lose track of the failing step.
- Publish is only offered when the active EDT includes the `shared-types-source` repo (Story 2.13 rule).
- Runs the configured publish command with per-step progress (bump → build → publish → push) and a spinner on the running step; a failure names the exact step.
- A re-trigger after a partial failure resumes from the failed step; on completion the new version is read from the source's `package.json` and **verified on the registry** before being marked published.
- On success the tool offers to chain into Story 4.2's flow with the published version pre-filled, or to stop.
- `q` during a run requires confirmation.

#### Story 4.4: Smart Group Update — `shared-types` First
As a developer, I want a group update that includes `shared-types` to publish and propagate a new version automatically, so that consumers merge on top of an already-bumped dependency.
- **Given** the Update configuration (Story 3.7) **When** the EDT contains the source repo **Then** a `shared-types` row offers *off / publish if the merge changed something / always publish*.
- **Given** the row is not off **When** the update runs **Then** `shared-types` is merged first, then (per the setting) published (4.3), propagated to all consumers of the EDT and committed (4.2, commit on, push never).
- **Given** a single-service update of `shared-types` alone **When** it runs **Then** the same behaviour applies.
- **Given** a failure in the `shared-types` phase **When** it occurs **Then** the remaining services are not updated silently: the run pauses with an explicit choice (retry, skip `shared-types` handling, abort), and the live run tracking (Story 3.10) shows the phase.

#### Story 4.5: Auto-Resolve `shared-types`-Only Merge Conflicts
As a developer, I want conflicts caused only by the `shared-types` version bump to resolve themselves during an update, so that I only handle real conflicts.
- **Given** a consumer's merge conflicts **When** the only conflicting hunk in `package.json` is the `shared-types` dependency line **Then** it is resolved to the EDT's current value, `npm i` is run, `package-lock.json` is staged if changed, and the merge is completed.
- **Given** any other conflicting hunk in `package.json`, or any conflict in another file **When** detected **Then** nothing is auto-resolved and the existing assisted-resolution flow (Story 3.4) takes over untouched.
- **Given** `package-lock.json` conflicts alongside a st-only `package.json` conflict **When** resolving **Then** the lockfile is taken from the EDT side and regenerated by `npm i` rather than hunk-merged.
- The outcome (auto-resolved / left to user) is shown per service in the run tracking.

#### Story 4.6: Declared-Version Drift View *(niche, optional)*
As a developer, I want to see which consumers declare a different `shared-types` version from my EDT's `shared-types` branch, so that I spot stale services at a glance.
- Compares each consumer's declared version with the one declared by the source repo's `package.json` on the EDT's branch; no git-ancestry walk, no caching.
- Consumers on the same version are marked in sync; others show both values and offer a one-key jump into Story 4.2 with the source version pre-filled.
- Explicit "no members" state when the EDT has none.

### 4.5 Other artifacts

- `sprint-status.yaml`: replace `4-1…4-3` keys by `4-1-shared-types-modules-manifest-parameters`, `4-2-propagate-a-version-to-chosen-services`, `4-3-publish-a-new-shared-types-version`, `4-4-smart-group-update-shared-types-first`, `4-5-auto-resolve-shared-types-only-merge-conflicts`, `4-6-declared-version-drift-view`, all `backlog`.
- `epics.md`: FR mapping adds FR-30 and FR-31 to Epic 4; Story 2.13's note about "the git-ancestry version-resolution mechanism" is struck.
=======
**4.1.a: FR-29, append consequence (C1)**

```
- In the Logs zone, services without a container appear in an info-only "services
  without container" section covering every such registry service (members included):
  greyed, unselectable, excluded from Tab order and from Ctrl+A. Ctrl+A toggles the
  focused list only (active EDT members / other services). Every service row shows its
  health badge (up/down/restarting/no container) whether or not the cursor is on it,
  and a restarting service states explicitly that a restart was requested and the
  container state is being re-verified. (Amended 2026-10-05, Sprint Change Proposal.)
```

**4.1.b: New FR-30 (C2)**

```
#### FR-30: Per-service last-run detail in Update (added 2026-10-05, Sprint Change Proposal)

After a group update, the Update zone's detail pane reports per service what really
happened: a successful merge that advanced the branch shows +N/−M lines and F files;
a successful merge with an unchanged HEAD shows "already up to date"; the migrate phase
shows "ran (<command>)" with an output excerpt, or "none" when absent/disabled.
The detail lives in memory only — the next run replaces it, a restart drops it.

**Consequences (testable):**
- HEAD-unchanged-after-merge ⇒ "already up to date", never a diffstat.
- Advanced merge ⇒ +N/−M lines and F files via the GitPort diff capability.
- Migration ran ⇒ command + excerpt; absent/disabled ⇒ "migrations: none".
- CLI parity (FR-1): the same details ride the JSON line additively.
```

**4.1.c: New FR-31 (C3)**

```
#### FR-31: Reversible, unified focus navigation (added 2026-10-05, Sprint Change Proposal)

Wherever Tab advances focus, Shift+Tab moves it back. Every zone declares its focus
movement through one shared navigation primitive (configurable per zone: H/V arrows,
Tab/Shift+Tab, Ctrl+N/P) instead of hand-rolled handlers; the footer and `?` help
reflect the active bindings.
```

### 4.2 Architecture

- **AD-16/GitPort:** add a diff capability (e.g. `diffStat(repoPath, from, to): Result<{files, insertions, deletions}>`) used to render merge +/−/files; up-to-date detection compares HEAD before/after a successful merge (no output parsing). Fakes updated; `ContainerPort`-style "never called with empty" discipline applies to new methods.
- **TUI shared:** new focus-navigation primitive (`resolveFocusStep` + per-zone mode declaration) living beside `shared/keys/tab-navigation.ts`; interface note: it composes with 7.3's zone-layout contract (layout owns panes, nav owns focus order).

### 4.3 UX

- **EXPERIENCE.md › State Patterns › Logs:** add row — `| Without-container group | All registry services without a container (members included), greyed, unselectable, skipped by Tab and Ctrl+A; info only. |`
- **EXPERIENCE.md › State Patterns › Update:** add rows — merged/up-to-date/migrations-ran/migrations-none per §4.1.b.
- **EXPERIENCE.md › Interaction Primitives + UX-DR36:** Shift+Tab rule (always reverses Tab) and the nav-component contract (mode declaration per zone; deviations documented).

### 4.4 Epics (`epics.md`)

**4.4.a: Story 7.2 — append ACs (C1 graft)**

```
- Given the Logs zone listing services, when rendered, then an info-only
  "services without container" section groups every container-less registry
  service (members included): greyed, unselectable, excluded from Tab order
  and Ctrl+A.
- Given focus on "active edt members" or "other services", when Ctrl+A, then
  the select-all toggle applies to the focused list only.
- Given any service row with known health, when rendered, then its
  up/down/restarting/no-container badge is visible with or without cursor.
- Given a restarting service, when displayed, then the state explicitly
  reports "restart requested → container state re-verified" (exact treatment
  at spec: post-restart poll + label), not the bare `restarting` badge.
```

**4.4.b: New Story 7.7 — Shared Focus-Navigation Component (C3, before 7.4)**

```
As a developer, I want one shared navigation primitive so Tab/Shift+Tab move
focus the same way in every zone, with Shift+Tab always reversing Tab.

ACs:
- Given the `focus-navigation` primitive, when Tab advances, then Shift+Tab
  retreats everywhere Tab navigates (lists, sub-zones, panes).
- Given the per-zone mode declaration, when configured, then each zone uses
  H/V arrows, Tab/Shift+Tab, or Ctrl+N/P with no ad-hoc Tab handler left.
- Given all zones migrated, when rendered, then footer and `?` reflect the
  active bindings from the same declarations.
```

**4.4.c: New Story 7.8 — Update Per-Service Last-Run Detail (C2, parallelizable)**

```
As a developer, after a group update I want the detail pane to report per
service what really happened, so I trust the run without re-checking by hand.

ACs:
- Given a successful merge with unchanged HEAD, when shown, then
  "already up to date", never a diffstat.
- Given an advancing merge, when shown, then +N/−M lines and F files.
- Given the migrate phase ran, when shown, then "ran (<command>)" plus an
  output excerpt; when absent/disabled, then "migrations: none".
- Given a new run finishes, when it lands, then it replaces the previous
  detail (session-only, never persisted).
- Given the CLI, when a run ends, then the same details ride the JSON line.
```

### 4.5 Other artifacts

- **`sprint-status.yaml`:** `7-2-container-less-managed-services: in-progress`; add `7-7-shared-focus-navigation: backlog`, `7-8-update-per-service-last-run-detail: backlog` (+ execution-order note update).
- **Git:** story-7.2 epic merge stays pending until the graft lands.
>>>>>>> epic-7-tui-consistency-dashboard-code-hygiene

---

## 5. Implementation Handoff

<<<<<<< HEAD
- **Scope:** Moderate (backlog reorganisation + PRD/architecture/UX amendments), no impact on done stories.
- **Gate before Epic 4 stories:** Epic 7 closed; Epic 3 merged into `devlopment` via PR (needed from 4.4).
- **Branches:** `epic-4-shared-types-propagation` (exists, worktree `tui-back-epic-4`), then one `story-4-N-…` branch per story per CLAUDE.md.
- **Success criteria:** a developer can bump `shared-types` across an EDT without opening any `package.json`, and a group update including `shared-types` finishes with consumers on the new version and no manual conflict resolution when only that line differed.
=======
**Scope classification: Moderate.** One story amended pre-merge, two stories added, additive PRD/architecture/UX amendments, no replan.

| Role | Responsibility |
|------|----------------|
| Developer agent (bmad-build) | 7.2 graft first on the open story branch; then 7.8; then 7.3 → 7.7 → 7.4 → 7.5/7.6 |
| Developer (Max) | Approve this proposal; merge story-7.2 into epic-7 after the graft; validate 7.7's mode table before zone migration |
| PO (sprint-status) | Status flips + new entries on approval |

**Success criteria:**

- C1: third group renders info-only; Ctrl+A is focus-scoped; health on every row; restarting is explicit.
- C2: up-to-date vs merged + diffstat + migrations ran/none per service, session-only, CLI parity.
- C3: Shift+Tab reverses Tab everywhere; zero hand-rolled Tab handlers; footer/`?` generated from declarations.
- Green `npm test && npm run typecheck && npm run depcheck` throughout.
>>>>>>> epic-7-tui-consistency-dashboard-code-hygiene
