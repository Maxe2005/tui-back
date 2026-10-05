# Sprint Change Proposal — 2026-10-05

**Project:** tui-back
**Author:** Max (via epic-4 re-discussion)
**Mode:** Interactive
**Status:** Approved by Max on 2026-10-05 — artifacts updated

---

## 1. Issue Summary

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

---

## 2. Impact Analysis

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

---

## 3. Recommended Approach

**Direct adjustment** of Epic 4 (no rollback, no MVP change). Effort: medium–high (six stories). Risk: medium, concentrated in Story 4.5 (merge-conflict automation) and the Epic 3 dependency.

Suggested order: 4.1 → 4.2 → 4.3 → 4.4 → 4.5 → 4.6. Stories 4.1–4.3 can start as soon as Epic 7 is done; 4.4 and 4.5 additionally need Epic 3 on `devlopment`.

---

## 4. Detailed Change Proposals

### 4.1 PRD

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

---

## 5. Implementation Handoff

- **Scope:** Moderate (backlog reorganisation + PRD/architecture/UX amendments), no impact on done stories.
- **Gate before Epic 4 stories:** Epic 7 closed; Epic 3 merged into `devlopment` via PR (needed from 4.4).
- **Branches:** `epic-4-shared-types-propagation` (exists, worktree `tui-back-epic-4`), then one `story-4-N-…` branch per story per CLAUDE.md.
- **Success criteria:** a developer can bump `shared-types` across an EDT without opening any `package.json`, and a group update including `shared-types` finishes with consumers on the new version and no manual conflict resolution when only that line differed.
