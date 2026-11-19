# Sprint Change Proposal — 2026-11-16 (3): A preconfigured "shared branches" EDT — every service on its shared branch, updated in one go, enabled from the settings

Mode: Batch. Scope: **Moderate** (Epic 2 gets two more stories; one new FR; one new AD and an AD-8 / FR-7 carve-out; one new setting; no manifest change, no rollback).

## 1. Issue Summary

Max wants a special EDT that gathers **every managed service on its shared branch**, so that all local shared branches can be brought up to date in one gesture. It is not created by hand: it is already there, preconfigured, and only becomes visible (listed among the EDTs and activatable) when switched on in the settings.

Semantics chosen by Max: **activating it is a real switch** (every repo goes to its `sharedBranch`, the outgoing EDT's uncommitted work is preserved like any switch), then the normal update makes those branches advance.

Findings, verified against the code:

| # | Finding | Evidence |
|---|---------|----------|
| 1 | An EDT is a persisted entry `{ulid, topic, createdAt, status, members[{service, repoPath, branch}]}` in `edts.yaml` (strict zod schema); everything (switch, update scope `edt`, wizard, branch-owners, dashboard) reads it through `EdtRegistryPort`. | `core/ports/edt-registry.ts`, `adapters/driven/edt-registry/schema.ts` |
| 2 | An EDT may never own a protected branch, and `sharedBranch` is always protected (FR-7); the git adapter's gate also rejects any write on a branch that is not the current EDT's own registered branch (AD-8). | PRD FR-7; AD-8 |
| 3 | The switch core already knows how to put a repo on its shared branch: a non-member repo is checked out to its manifest `sharedBranch` (fetched first if absent locally); dirty work is stashed / adopted / discarded per the resolution dialog; FR-37's restart then restarts only services whose checkout moved (with Story 2.45). | `core/edt/switch.ts` `switchNonMemberRepo`; Story 2.44 / 2.45 |
| 4 | The EDT-scoped update already operates on a member's recorded branch and refuses a repo that is not on it (`group-update.ts:929`); on the shared branch it pulls (`sourceBranch == currentBranch → pull`), diverging local commits go through the unpushed-commits blocker. The `all` scope updates whatever is checked out, without switching. | `core/scripts/group-update.ts:880-1040` |
| 5 | The `:settings` screen has an `edts` group (hidden hints / action types); no setting controls EDT visibility. | `core/ports/settings.ts` |
| 6 | `GitPort.fetch(repoPath, branch)` can advance a local branch without checkout. Not used here (Max chose the real-switch semantics) but it stays available for a later "update without switching" action. | `core/ports/git.ts:68` |

## 2. Impact Analysis

**Epics**: **Epic 2** (`in-progress` since Story 2.45) gets Stories **2.46** (model, guards, setting, switch and update support), **2.47** (EDTs zone and settings screen) and the optional **2.48** (quick fast-forward without switching). Epics 3 and 4 untouched (the existing update engine is reused).

**PRD**
- **FR-53 added**: the shared-branches EDT.
- **FR-7** gets a carve-out sentence: the shared-branches EDT is the only EDT that sits on shared branches, and only by being the system EDT.
- **FR-24** (delete), the modify / rename / member add-remove actions and EDT creation all refuse the system EDT.
- FR-37 / FR-6 apply as they are (it is a normal switch).

**Architecture**
- **New AD-27 — System EDTs are synthesized, never persisted** (§4.1).
- **AD-8 amended**: one narrow carve-out in the gate (§4.1); no other write rule is relaxed.
- AD-4 unchanged (no manifest key): the members and their branches come from the registry of managed repos and each manifest's `sharedBranch`.

**Code (indicative)**
- `core/edt/shared-edt.ts` (new): `SHARED_EDT_ULID` constant, `buildSharedEdt(repos, manifests)` (pure), `isSystemEdt(entry)`.
- `core/ports/edt-registry.ts`: `EdtRegistryEntry` gains an optional `kind?: 'system-shared'`; the registry adapter (`adapters/driven/edt-registry`) appends the synthesized entry to `list()` when the setting is on and never writes it; `add/update/remove/setStatus` on it fail `edt-system-readonly` (`setStatus` is the one exception, see §4.1).
- `core/ports/settings.ts` + `adapters/driven/settings/schema.ts`: `edts.sharedBranchesEdtEnabled: boolean` (default `false`).
- `adapters/driven/git`: AD-8 carve-out; `core/edt/{create,modify,delete,switch,activate}.ts`, `core/edt/branch-owners.ts`, `core/edt/shared-branches.ts`: guards and exemptions.
- TUI: `zones/edts/*` (list row, detail pane, hidden actions), `shared/settings-screen` (EDTs tab control), quick-pick switch, wizard (never offers it).
- CLI / MCP: `edt list` (additive `kind` field), `edt switch <topic>` works on it, `edt create|modify|delete` reject it; MCP inherits (AD-25 classes unchanged).
- Docs: README / AGENTS.md EDT notes if they list EDT kinds. `docs/tui-back-manifest.md` and the `manifest-generator` skill are **not** affected (no manifest surface change).

## 3. Recommended Approach

**Direct Adjustment.** Effort: Medium (2.48 adds a small optional story). Risk: medium, concentrated in the git-safety carve-out, which is why it is spelled out and tested rather than left implicit.

Design decisions taken (flag if wrong):

1. **Synthesized, not stored.** The entry is computed from the registry of managed repos and their manifests (`members = every registered managed repo, branch = its sharedBranch`), so a service registered or removed later is reflected at once and a manifest's `sharedBranch` change needs no migration. Nothing is written to `edts.yaml`; a corrupted or hand-edited `edts.yaml` can neither create nor destroy it.
2. **Fixed identity.** ULID constant `shared-branches`, topic `Shared branches`. Its `status` (`active` / `inactive`) is persisted through the existing active-EDT pointer in `state.json`, not in `edts.yaml`.
3. **Setting off = invisible and unreachable** everywhere (list, quick-pick, CLI `edt list`, MCP). **Turning it off while it is the active EDT is refused** with a message naming the EDT to switch to first, so the workspace is never left on a vanished active EDT. A previously active pointer found on a machine where the setting is off (hand-edited settings) falls back to "no active EDT" with a warning.
4. **Never ownable work.** The system EDT cannot own a non-shared branch, so the "adopt uncommitted work into the outgoing EDT" resolution is unavailable when it is the outgoing EDT (stash or discard only); the dialog and the CLI (`--adopt-branch`) say why. Adopting *onto* it is not offered either.
5. **Update = the existing EDT-scoped update.** Pull on each service's shared branch, per-service migrate and restart toggles as usual; a service whose local shared branch has diverged goes through the existing unpushed-commits blocker; a conflict goes through the assisted flow and the auto-resolvers (Stories 4.5, 4.8, 4.9).

## 4. Detailed Change Proposals

### 4.1 Architecture

**New AD-27 — System EDTs are synthesized, never persisted (added 2026-11-16, SCP 3)**
- **Binds:** FR-53, FR-6, FR-7, FR-24
- **Prevents:** a hand-made or stale copy of the "shared branches" EDT drifting from the registry of managed repos, and a second EDT claiming shared branches.
- **Rule:** the shared-branches EDT is built in memory from `RegistryPort` + each repo's manifest (`members = {service, repoPath, branch: sharedBranch}`), appended by the EDT registry adapter's `list()` only while `edts.sharedBranchesEdtEnabled` is on, and never written to `edts.yaml`. `EdtRegistryEntry.kind = 'system-shared'` marks it; every mutation (create with its topic, modify, rename, add/remove member, delete) fails `edt-system-readonly` before any write. Core switch / update treat it as any EDT.

**AD-8 amendment**: for an EDT with `kind = 'system-shared'`, the gate accepts a service's `sharedBranch` as that EDT's own registered branch for **checkout and for the update's fast-forward pull only**. Commit, merge of another branch, rename, delete, push and every other write on a protected branch stay rejected exactly as today. The carve-out keys on the entry's kind read from the registry at write time (never on a caller-supplied value).

**FR-7 note**: "An EDT never claims a shared branch" gains: "The only exception is the system shared-branches EDT (FR-53), which sits on shared branches by definition and is not user-creatable."

### 4.2 New Story 2.46 — Shared-Branches EDT: Model, Guards, Setting, Switch & Update

> Added 2026-11-16 (Sprint Change Proposal 3). Adds FR-53; adds AD-27; amends AD-8 and FR-7. Builds on Stories 2.39–2.41 (switch core), 2.44/2.45 (restart) and Epic 3 (update).

As a developer, I want a preconfigured EDT that puts every service on its shared branch and updates them together, so that I can refresh all my shared branches in one move without creating or maintaining an EDT for it.

**Acceptance Criteria:**

- **Given** `settings.yaml` **When** it has no `edts.sharedBranchesEdtEnabled` **Then** the default is `false`, nothing changes anywhere, and an invalid value falls back to the default with the usual warning.
- **Given** the setting is `true` **When** the EDT list is read (TUI, `tui-back edt list`, MCP) **Then** it contains one extra entry, topic `Shared branches`, `kind: "system-shared"`, whose members are every registered managed repo on its manifest `sharedBranch`; with the setting `false` the entry is absent from every listing and `edt switch shared-branches` fails `edt-not-found`.
- **Given** a repo is registered or removed, or a manifest's `sharedBranch` changes **When** the EDT is listed again **Then** it reflects it at once; `edts.yaml` is never written by any of this.
- **Given** any mutation of the system EDT (modify topic, rename, add / remove a member, delete, or creating an EDT named like it) **When** attempted from the TUI, the CLI or MCP **Then** it fails `edt-system-readonly` with an explanation, before any write.
- **Given** the system EDT **When** switching to it **Then** the normal switch runs: each repo's dirty work is handled per the resolution dialog / flags, then each repo is checked out to its `sharedBranch` (fetched first if absent locally); the AD-8 gate accepts those checkouts (and only those) through the carve-out; per-repo outcomes and the optional post-switch restart (FR-37, only services whose checkout moved — Story 2.45) work unchanged.
- **Given** the system EDT is the outgoing EDT **When** a switch finds a dirty repo **Then** "adopt into the outgoing EDT" is unavailable (stash or discard only), the dialog says why, and the CLI rejects `--adopt-branch` for it before touching anything.
- **Given** the system EDT is active **When** a group update runs with the EDT scope **Then** every service pulls its shared branch (fast-forward semantics of today's `pull`), with the usual migrate / restart toggles, concurrency, live tracking and assisted resolution; a service not on its shared branch (checked out elsewhere since the switch) is reported as such and skipped, never switched silently.
- **Given** the setting is turned off **When** the system EDT is the active EDT **Then** the change is refused with a message naming the switch to make first; when it is not active, it disappears immediately.
- **Given** the active-EDT pointer names the system EDT while the setting is off **When** the app starts **Then** it falls back to no active EDT with a warning, nothing is written to any repo.
- **Given** the AD-8 carve-out **When** tested **Then** commit, merge, rename, delete and push on a shared branch are still rejected for the system EDT, and the same checkout is still rejected for an ordinary EDT.

**Implementation notes:** build order, one commit each: setting + schema → `shared-edt.ts` pure builder → registry adapter synthesis + readonly guards → AD-8 carve-out + tests → switch dirty-resolution rule (no adopt) → update on the system EDT (skip-if-not-on-shared) → CLI `edt list` field and rejections → MCP schema (additive). Reuse `branch-owners` (it must not list the system EDT as "using" a shared branch in branch choosers, Story 2.43).

### 4.3 New Story 2.47 — Shared-Branches EDT in the EDTs Zone and the Settings Screen

> Added 2026-11-16 (Sprint Change Proposal 3). Depends on Story 2.46.

As a developer, I want to switch the feature on in the settings and then see and activate the EDT like any other, so that using it needs no new concept in the interface.

**Acceptance Criteria:**

- **Given** the `:settings` EDTs tab **When** rendered **Then** a toggle "Show the shared-branches EDT" (off by default, `Space` toggles, persisted and applied live, UX-DR7 hints) is shown with a one-line description; turning it off while the EDT is active shows the refusal message inline.
- **Given** the setting is on **When** the EDTs zone renders **Then** the system EDT appears in the list with a distinct marker (`shared` badge, text, not colour alone) and sorts first or last (decided in the spec), a detail pane showing its members and each service's shared branch, and its recent actions like any EDT.
- **Given** the system EDT is selected **When** the zone's actions are offered **Then** `switch` (the existing dialog, with the adopt choice hidden per Story 2.46) and `update` are available; modify, rename, member editing and delete are not offered, and their keys show the `edt-system-readonly` explanation instead of acting.
- **Given** the EDT-creation wizard and the quick-pick switch **When** opened **Then** the wizard never offers the system EDT as a template or a name, and the quick-pick lists it only while enabled.
- **Given** the system EDT is active **When** the footer and the Update zone render **Then** they show the active EDT as `Shared branches` and the update scope label "all shared branches"; the Dashboard and branch-owners views treat it as any EDT without flagging its branches as "used by another EDT".
- **Given** the keybinding help (`?`) **When** the zone is focused **Then** every key shown for the system EDT row is declared in `footer-contexts.ts`.

### 4.4 New Story 2.48 — Fast-Forward the Shared Branches Without Switching (optional, backlog)

> Added 2026-11-16 (Sprint Change Proposal 3), at Max's follow-up: the update on the shared-branches EDT runs fast-forward **and** migrations; when only speed matters, a quick fast-forward without switching is useful. Depends on Story 2.46; ship it after 2.47 if the daily use confirms the need.

As a developer, I want to bring every local shared branch up to date without leaving my current EDT, so that I can start a new EDT or compare against fresh shared branches in seconds.

**Acceptance Criteria:**

- **Given** the shared-branches EDT is enabled **When** the quick fast-forward is triggered (a key on its row in the EDTs zone, keys declared in `footer-contexts.ts`; `tui-back edt fast-forward-shared`; the matching MCP tool, class `write`) **Then** each managed service's **local shared branch** is fast-forwarded from `origin` (`GitPort.fetch(repoPath, sharedBranch)`), with the active EDT, every working tree and every checked-out branch left untouched.
- **Given** a service whose shared branch is the one checked out **When** its worktree is clean **Then** it is fast-forwarded in place (`pull`, fast-forward only); **When** it is dirty, or the branch has diverged (local commits not on origin) **Then** it is reported `skipped` with its reason (`dirty` / `diverged`), never forced, never stashed.
- **Given** a service whose shared branch is absent locally **Then** it is fetched into a new local branch; a missing or unreachable `origin` is reported `failed` for that service only.
- **Given** the run **When** it ends **Then** per-service rows (`fast-forwarded` / `already up to date` / `skipped (reason)` / `failed`) are shown in a bounded list (AD-19) and emitted in the AD-3 envelope; no migration and no restart is run (that is what the full update on the active EDT is for); the exit code is non-zero if any row `failed`.
- **Given** the AD-8 gate **When** the fast-forward runs **Then** it passes through a second narrow carve-out for the system EDT's quick action: fast-forward of a local shared branch from its own `origin` counterpart only; no other write on a protected branch is allowed.
- **Given** the setting is off **Then** the action is unavailable in the TUI and refused by the CLI and MCP with `edt-not-found`.

## 5. Implementation Handoff

**Scope: Moderate.** Product Owner / Developer: apply the edits below, then Developer agent per story with `bmad-build`, in order 2.46 → 2.47 (Epic 2 branch `epic-2-edt-workspace-management`, reopened; story branches off it, `--no-ff` merges; epic back to `devlopment` by PR).

**Edits to apply on approval**
- PRD: add **FR-53 (added 2026-11-16, SCP 3)** after FR-52: "A preconfigured, non-creatable 'shared branches' EDT, enabled from the settings, gathers every managed service on its shared branch; activating it switches every repo to its shared branch and its update refreshes them all." Add the FR-7 note and the FR-24 sentence (system EDT cannot be deleted).
- `epics.md`: requirements list and coverage map (`FR-53: Epic 2 - Shared-branches EDT (added 2026-11-16 — Stories 2.46, 2.47)`), Epic 2 **FRs covered** gains FR-53, Stories 2.46 and 2.47 inserted after Story 2.45 (before Epic 3).
- Architecture spine: AD-27 and the AD-8 amendment (§4.1).
- `sprint-status.yaml` (sprint-1): add `2-46-shared-branches-edt-model-guards-setting-switch-and-update: backlog`, `2-47-shared-branches-edt-in-the-edts-zone-and-the-settings-screen: backlog` under `epic-2` (already `in-progress`).

Success criteria: with the setting off the product behaves exactly as before; with it on, one switch puts every service on its shared branch and one update advances them all; nothing can create, edit or delete the system EDT; no write other than the checkout and the fast-forward pull is possible on a shared branch.

Story 2.48 (quick fast-forward without switching) is optional: it is filed in the backlog and built only if daily use asks for it.
